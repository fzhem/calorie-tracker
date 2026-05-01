export type DeferredWriteOptions = {
  immediate?: boolean;
  debounceMs?: number;
};

export function createDeferredWriter<T>(
  commit: (value: T) => void | Promise<void>,
  defaultDebounceMs: number,
) {
  let pendingValue: T | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolvers: Array<() => void> = [];
  let pendingRejectors: Array<(error: unknown) => void> = [];

  function clearPendingTimer() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function resolvePendingWrites() {
    const resolvers = pendingResolvers;
    pendingResolvers = [];
    pendingRejectors = [];
    resolvers.forEach((resolve) => resolve());
  }

  function rejectPendingWrites(error: unknown) {
    const rejectors = pendingRejectors;
    pendingResolvers = [];
    pendingRejectors = [];
    rejectors.forEach((reject) => reject(error));
  }

  async function flush() {
    if (pendingValue === null) return;

    clearPendingTimer();
    const next = pendingValue;
    pendingValue = null;

    try {
      await commit(next);
      resolvePendingWrites();
    } catch (error) {
      rejectPendingWrites(error);
      throw error;
    }
  }

  async function schedule(
    value: T,
    options: DeferredWriteOptions = {},
  ): Promise<void> {
    const { immediate = false, debounceMs = defaultDebounceMs } = options;

    pendingValue = value;

    if (immediate) {
      await flush();
      return;
    }

    return await new Promise<void>((resolve, reject) => {
      pendingResolvers.push(resolve);
      pendingRejectors.push(reject);

      clearPendingTimer();
      pendingTimer = setTimeout(() => {
        void flush();
      }, debounceMs);
    });
  }

  return {
    flush,
    schedule,
    hasPendingWrite() {
      return pendingValue !== null;
    },
  };
}
