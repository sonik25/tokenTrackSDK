import { Stream } from '@anthropic-ai/sdk/streaming';

interface Branch<Event> {
  closed: boolean;
  queue: Promise<IteratorResult<Event>>[];
}

/** An SDK stream whose tee branches release their shared iterator when both close. */
export class TrackedMessageStream<Event> extends Stream<Event> {
  override tee(): [Stream<Event>, Stream<Event>] {
    const source = this[Symbol.asyncIterator]();
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

          const result = source.next();
          for (const target of branches) {
            if (target !== branch && !target.closed) target.queue.push(result);
          }
          return result;
        },
        async return() {
          if (!branch.closed) {
            branch.closed = true;
            branch.queue.length = 0;
            if (branches.every((target) => target.closed)) await source.return?.();
          }
          return { done: true, value: undefined };
        },
      };
      return new TrackedMessageStream(() => iterator, this.controller);
    };

    return [split(branches[0]), split(branches[1])];
  }
}
