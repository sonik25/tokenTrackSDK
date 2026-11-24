import { Stream } from '@anthropic-ai/sdk/streaming';

interface Branch<Event> {
  closed: boolean;
  queue: Promise<IteratorResult<Event>>[];
}

/** An SDK stream whose tee branches release their shared iterator when both close. */
export class TrackedMessageStream<Event> extends Stream<Event> {
  private teeBranch = false;

  override tee(): [Stream<Event>, Stream<Event>] {
    const controller = this.controller;
    const isRoot = !this.teeBranch;
    const source = this[Symbol.asyncIterator]();
    let pending: Promise<unknown> = Promise.resolve();
    let terminal: Promise<IteratorResult<Event>> | undefined;
    const branches: [Branch<Event>, Branch<Event>] = [
      { closed: false, queue: [] },
      { closed: false, queue: [] },
    ];

    const split = (branch: Branch<Event>) => {
      const iterator: AsyncIterator<Event> = {
        async next() {
          if (branch.closed) return { done: true, value: undefined };
          const queued = branch.queue.shift();
          if (queued) return queued;

          if (terminal) return terminal;
          const result = pending.then(async () => {
            if (terminal) return terminal;
            if (branches.every((target) => target.closed)) {
              return { done: true, value: undefined } as const;
            }
            try {
              const next = await source.next();
              if (next.done) terminal = Promise.resolve(next);
              return next;
            } catch (error) {
              terminal = Promise.reject(error);
              void terminal.catch(() => undefined);
              throw error;
            }
          });
          pending = result.catch(() => undefined);
          for (const target of branches) {
            if (target !== branch && !target.closed) target.queue.push(result);
          }
          return result;
        },
        async return() {
          if (!branch.closed) {
            branch.closed = true;
            branch.queue.length = 0;
            if (branches.every((target) => target.closed)) {
              if (!terminal && isRoot) controller.abort();
              await pending;
              await source.return?.();
            }
          }
          return { done: true, value: undefined };
        },
      };
      const stream = new TrackedMessageStream(() => iterator, this.controller);
      stream.teeBranch = true;
      return stream;
    };

    return [split(branches[0]), split(branches[1])];
  }
}
