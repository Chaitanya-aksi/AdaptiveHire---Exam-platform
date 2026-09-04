import {
  Logger,
  Module,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';
import type { EventEmitter } from 'node:events';
import { connectionErrorReporter } from '../redis/connection-error-log';

/**
 * Gives every BullMQ queue and worker an `error` listener.
 *
 * Without one, a Redis outage is not merely logged badly — it is logged
 * catastrophically. BullMQ's `QueueBase` overrides `emit`: it emits `error`,
 * Node's EventEmitter throws because nothing is listening, BullMQ catches that
 * and re-emits `error`, which throws again, and the final `catch` gives up with
 * a bare `console.error(err)`. That last line bypasses the application logger
 * entirely, so the output has no timestamp, no level and no context — just a
 * raw `AggregateError` stack.
 *
 * There is one of those per queue, per worker and per blocking connection, on
 * *every* reconnect attempt. A local Redis that went away for forty minutes
 * produced sixty of them, which is what made a transient outage read as a crash.
 * Meanwhile the one component that did have a handler — the shared client in
 * `redis.module.ts` — reported the same outage in a single line naming the host,
 * the port and the command to bring it back.
 *
 * So this attaches the same treatment to the other side.
 *
 * Discovered rather than wired by hand, deliberately. Attaching a listener in
 * each of the three processors and each injected `Queue` would work today and
 * silently stop covering the fourth queue somebody adds — and the failure is
 * invisible until the next outage, which is exactly how this got missed the
 * first time. Nothing here changes retry or delivery behaviour: BullMQ already
 * reconnects on its own, and a queue whose Redis is unreachable was already
 * failing. Only the reporting changes.
 */
@Injectable()
export class QueueErrorLogger implements OnApplicationBootstrap {
  private readonly logger = new Logger('Queues');

  /**
   * One reporter per label, not per emitter.
   *
   * A queue registered by two modules is two `Queue` objects behind one name —
   * `mail-queue.module.ts` explains why that happens and why it matters — and
   * both hold connections to the same server, so both fail in the same instant
   * with the same code. Keyed per object they reported the same outage twice;
   * keyed per label they report it once. Workers and queues keep separate
   * entries, because "the queue cannot be written to" and "jobs are not being
   * picked up" are different facts.
   */
  private readonly reporters = new Map<
    string,
    ReturnType<typeof connectionErrorReporter>
  >();

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      // Providers with no instance are unresolved factories and async tokens;
      // reading them here would throw long before anything is broken.
      const instance: unknown = wrapper.instance;
      if (typeof instance !== 'object' || instance === null) continue;

      if (instance instanceof Queue) {
        this.watch(instance, `queue "${instance.name}"`);
        continue;
      }

      if (instance instanceof WorkerHost) {
        // The getter throws if the worker was never started — `manualRegistration`,
        // or a processor in a module that failed to initialise. A missing
        // listener is a logging problem; refusing to boot over one would be a
        // worse outcome than the noise it prevents.
        // `WorkerHost` is generic over its worker, so the getter's type carries
        // `any` out with it; read it as `unknown` and check, rather than
        // asserting a shape this loop is walking precisely because it cannot
        // know it in advance.
        let worker: unknown;
        try {
          worker = instance.worker;
        } catch {
          continue;
        }
        if (worker instanceof Worker) {
          this.watch(worker, `worker "${worker.name}"`);
        }
      }
    }
  }

  private watch(emitter: Queue | Worker, label: string): void {
    let errors = this.reporters.get(label);
    if (!errors) {
      errors = connectionErrorReporter(
        this.logger,
        (code) =>
          `Background ${label} lost its Redis connection (${code}). ` +
          `Jobs are queued but not running until it returns.`,
      );
      this.reporters.set(label, errors);
    }

    // Through `EventEmitter`, which both extend. `Queue.on` and `Worker.on`
    // have differently-typed generic overloads, so the union of the two is not
    // callable even though every instance of it has the method.
    (emitter as EventEmitter).on('error', errors.report);

    /*
     * The reset is taken from the underlying client rather than a `ready` event
     * on the emitter, because `QueueBase` forwards only `error` from its
     * connection — a `Worker` re-emits `ready` from its blocking connection but
     * a `Queue` emits it nowhere. Listening on the emitter would therefore work
     * for workers and silently never fire for queues, so the *second* outage
     * would be deduplicated against the first and go unreported.
     *
     * Awaiting the client does not hold up boot: nothing is chained onto this,
     * and BullMQ's connection waits rather than rejecting while Redis is down,
     * so a queue that starts up unreachable simply attaches its listener
     * whenever the server appears. The `catch` is for the case where it does
     * reject — an unhandled rejection here would be the very kind of unlogged
     * noise this module exists to remove.
     */
    void emitter.client
      .then((client) => client.on('ready', errors.reset))
      .catch(() => undefined);
  }
}

@Module({
  imports: [DiscoveryModule],
  providers: [QueueErrorLogger],
})
export class QueueErrorsModule {}
