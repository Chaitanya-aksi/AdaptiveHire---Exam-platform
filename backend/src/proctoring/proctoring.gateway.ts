import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { UserRole } from '../common/enums';
import { ProctoringEventDto } from './dto/proctoring-event.dto';
import { ProctoringService } from './proctoring.service';

/** Set by the auth middleware once the handshake token checks out. */
interface AuthedSocket extends Socket {
  candidateId?: string;
}

export const PROCTORING_EVENT = 'proctoring:event';

/**
 * Receives proctoring signals over a socket rather than REST: these arrive in
 * bursts (a tab-switch storm, a face flickering in and out) and must not
 * compete with the candidate's answer requests for the endpoint rate limit.
 *
 * Nest's global HTTP guards never see a socket, so this gateway authenticates
 * its own connections — as Socket.IO middleware rather than in a connection
 * handler, so a bad token is refused *before* the connection is established
 * and the client gets a real `connect_error` instead of a connect immediately
 * followed by a mystery disconnect.
 */
@WebSocketGateway({
  namespace: '/proctoring',
  cors: { origin: true, credentials: true },
})
export class ProctoringGateway implements OnGatewayInit {
  private readonly logger = new Logger(ProctoringGateway.name);

  constructor(
    private readonly proctoring: ProctoringService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket: AuthedSocket, next) => {
      // Socket.IO's `auth` payload, not a header: the access token lives in
      // memory in the browser and is passed explicitly at connect time.
      const token = (socket.handshake.auth as { token?: string })?.token;
      if (!token) return next(this.reject('no token supplied'));

      try {
        const payload = this.jwt.verify<JwtPayload>(token, {
          secret: this.config.getOrThrow<string>('jwt.accessSecret'),
        });

        if (payload.role !== UserRole.CANDIDATE) {
          return next(this.reject('not a candidate'));
        }

        socket.candidateId = payload.sub;
        next();
      } catch {
        next(this.reject('invalid or expired token'));
      }
    });
  }

  @SubscribeMessage(PROCTORING_EVENT)
  async handleEvent(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    // Belt and braces: the middleware guarantees this, but an unauthenticated
    // socket must never reach the database even if that ever changes.
    if (!client.candidateId) return { ok: false };

    // Gateways bypass the global ValidationPipe, so validate explicitly —
    // otherwise anything could be written into proctoring_logs.
    const dto = plainToInstance(ProctoringEventDto, body);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      this.logger.warn(
        `Rejected proctoring event: ${errors
          .map((error) => Object.values(error.constraints ?? {}).join(', '))
          .join('; ')}`,
      );
      return { ok: false };
    }

    return { ok: await this.proctoring.record(client.candidateId, dto) };
  }

  private reject(reason: string): Error {
    this.logger.warn(`Proctoring socket refused — ${reason}`);
    return new Error(reason);
  }
}
