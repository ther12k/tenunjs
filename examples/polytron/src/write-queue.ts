/**
 * Serial BLE write queue — the firmware executes one command per loop
 * tick, so writes are spaced instead of dropped. The chain must SURVIVE a
 * failed write: keeping the rejected promise poisoned every later enqueue
 * (one radio error and not even STOP could be retried without a page
 * reload). Each write still reports its own failure to the caller.
 */
export interface WriteQueue {
  /** Resolves false (and reports via onFail) when THIS write failed. */
  enqueue(cmd: string): Promise<boolean>;
}

export function createWriteQueue(
  write: (cmd: string) => Promise<void>,
  onFail: (cmd: string, err: unknown) => void,
): WriteQueue {
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(cmd: string): Promise<boolean> {
      const run = chain.then(() => write(cmd));
      // Swallow the rejection HERE so the chain stays usable; the caller
      // hears about this write's failure through the return value.
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run.then(
        () => true,
        (e) => {
          onFail(cmd, e);
          return false;
        },
      );
    },
  };
}
