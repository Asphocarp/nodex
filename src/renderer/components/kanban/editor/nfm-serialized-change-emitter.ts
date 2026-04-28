export interface NfmSerializedChangeEmitter {
  schedule: () => void;
  flush: () => string | null;
  cancel: () => void;
  hasPendingChange: () => boolean;
}

interface NfmSerializedChangeEmitterOptions<TimerHandle> {
  debounceMs: number;
  serialize: () => string;
  emit: (value: string) => void;
  getLastEmitted: () => string;
  setLastEmitted: (value: string) => void;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
}

export function createNfmSerializedChangeEmitter<TimerHandle = ReturnType<typeof setTimeout>>({
  debounceMs,
  serialize,
  emit,
  getLastEmitted,
  setLastEmitted,
  setTimer = ((callback, delay) => setTimeout(callback, delay)) as (callback: () => void, delay: number) => TimerHandle,
  clearTimer = ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)) as (timer: TimerHandle) => void,
}: NfmSerializedChangeEmitterOptions<TimerHandle>): NfmSerializedChangeEmitter {
  let pendingChange = false;
  let timer: TimerHandle | null = null;

  const clearPendingTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const publish = (value: string): string | null => {
    if (value === getLastEmitted()) return null;

    setLastEmitted(value);
    emit(value);
    return value;
  };

  const flush = (): string | null => {
    if (!pendingChange) return null;

    clearPendingTimer();
    pendingChange = false;
    return publish(serialize());
  };

  return {
    schedule() {
      pendingChange = true;
      clearPendingTimer();
      timer = setTimer(() => {
        timer = null;
        void flush();
      }, debounceMs);
    },
    flush,
    cancel() {
      clearPendingTimer();
      pendingChange = false;
    },
    hasPendingChange() {
      return pendingChange;
    },
  };
}
