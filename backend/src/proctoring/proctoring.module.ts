import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { ProctoringLog } from './entities/proctoring-log.entity';
import { ProctoringGateway } from './proctoring.gateway';
import { ProctoringService } from './proctoring.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProctoringLog, AssessmentSession]),
    // The gateway verifies the handshake token itself — the global HTTP guards
    // never see a socket.
    JwtModule.register({}),
  ],
  providers: [ProctoringService, ProctoringGateway],
  exports: [ProctoringService],
})
export class ProctoringModule {}
