/**
 * Tiny in-process work queue: limited concurrency, and the same key is never queued
 * or running twice at once (repeated requests for one file/job collapse into one run).
 */
export class WorkQueue {
  private running = 0;
  private readonly pending: { key: string; run: () => Promise<void> }[] = [];
  private readonly active = new Set<string>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly onError: (key: string, err: unknown) => void,
  ) {}

  /** Returns false if this key is already queued or running. */
  push(key: string, run: () => Promise<void>): boolean {
    if (this.active.has(key)) return false;
    this.active.add(key);
    this.pending.push({ key, run });
    this.drain();
    return true;
  }

  get size(): number {
    return this.active.size;
  }

  /** Resolves once nothing is queued or running (used by tests and shutdown). */
  onIdle(): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift()!;
      this.running++;
      item
        .run()
        .catch((err) => this.onError(item.key, err))
        .finally(() => {
          this.running--;
          this.active.delete(item.key);
          if (this.active.size === 0) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            waiters.forEach((w) => w());
          }
          this.drain();
        });
    }
  }
}
