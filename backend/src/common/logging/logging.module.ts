import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Structured application logging.
 *
 * The default Nest logger writes prose to stdout, which is fine to read and
 * impossible to query. That matters here more than in most systems: when a
 * candidate's attempt fails, the question is always "what happened during *that*
 * session", and answering it by grepping unstructured lines means reconstructing
 * a timeline by eye from a shared log. One JSON object per line, with the
 * session id as a field, turns that into a filter.
 *
 * Human-readable output is restored in development via pino-pretty, so nothing
 * about the local experience gets worse.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('nodeEnv') !== 'production';

        return {
          pinoHttp: {
            level: config.get<string>('logLevel') ?? (isDev ? 'debug' : 'info'),

            // Pretty only in development. In production this has to stay
            // machine-readable, because that is the entire point.
            //
            // `req`/`res` are hidden rather than dropped: the serializers below
            // already trim them to a few fields, and the message line repeats
            // those, so printing the object too would just double every line.
            transport: isDev
              ? {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    translateTime: 'HH:MM:ss',
                    ignore: 'pid,hostname,req,res',
                  },
                }
              : undefined,

            /*
             * One readable line per request.
             *
             * pino-http's defaults serialise the *entire* request and response,
             * headers included — around forty fields of `sec-ch-ua`,
             * `accept-encoding` and CSP per request, which in a browser session
             * with React StrictMode doubling every call makes the console
             * unreadable and hides the lines that matter.
             *
             * What survives is what you would actually grep for: the request id
             * that ties a request's lines together, the method, the path, and
             * the status. Headers are gone entirely, which also means the
             * cookie and authorization redaction below is now belt-and-braces
             * rather than the only thing standing between a refresh token and
             * the log file.
             */
            serializers: {
              req: (req: Request & { id?: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: Response) => ({ statusCode: res.statusCode }),
            },

            customSuccessMessage: (req: Request, res: Response) =>
              `${req.method} ${req.url} ${res.statusCode}`,

            // ASCII only in anything written to a console: Windows terminals
            // default to a codepage that renders an em-dash as mojibake.
            customErrorMessage: (req: Request, res: Response, err: Error) =>
              `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,

            // Correlates every line emitted while handling one request, which is
            // what lets a single failure be read as a sequence rather than as
            // scattered lines that happen to share a timestamp.
            genReqId: (req: Request) =>
              (req.headers['x-request-id'] as string | undefined) ??
              randomUUID(),

            /*
             * Everything here would otherwise be written to disk in the clear.
             *
             * The cookie header carries the refresh token, and the invite and
             * reset flows both put a live credential in a request body — a log
             * that captured either would be a way into an account for anyone who
             * could read it, which in most deployments is more people than can
             * read the database.
             */
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.body.password',
                'req.body.newPassword',
                'req.body.currentPassword',
                'req.body.token',
              ],
              remove: true,
            },

            // Health checks are noise at info level; keep them at debug so a
            // production log is about what people did, not about uptime probes.
            customLogLevel: (_req, res: Response, err?: Error) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              if (_req.url?.startsWith('/api/health')) return 'debug';
              return 'info';
            },
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
