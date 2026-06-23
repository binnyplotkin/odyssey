// A tiny single-consumer async channel. The voice pipeline produces frames
// from several concurrent contexts (the LLM token loop, the in-order TTS drain
// chain, trace marks), so `runVoiceStream` can't simply `yield` from each —
// they all `push()` here and the generator drains the channel in order until
// it's `close()`d. Closing with an error makes the async iterator throw, which
// is how a pre-stream validation failure (VoiceStreamHttpError) surfaces to the
// transport adapter before any frame is sent.

export interface EventQueue<T> {
  /** Enqueue a frame (no-op once closed). */
  push(item: T): void;
  /** Signal completion. Pass an error to make the iterator throw it. */
  close(err?: unknown): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = [];
  const waiters: Array<(r: IteratorResult<T>) => void> = [];
  let closed = false;
  let error: unknown = null;

  return {
    push(item: T) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value: item, done: false });
      else buffer.push(item);
    },
    close(err?: unknown) {
      if (closed) return;
      closed = true;
      error = err ?? null;
      while (waiters.length) {
        waiters.shift()!({ value: undefined as never, done: true });
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (buffer.length) {
          yield buffer.shift()!;
          continue;
        }
        if (closed) {
          if (error) throw error;
          return;
        }
        const result = await new Promise<IteratorResult<T>>((resolve) => {
          waiters.push(resolve);
        });
        if (result.done) {
          if (error) throw error;
          return;
        }
        yield result.value;
      }
    },
  };
}
