import { useCallback, useRef, useState } from "react";

export type SetDistinctState<T> = (nextValue: T) => boolean;
export type DistinctStateEquality<T> = (currentValue: T, nextValue: T) => boolean;

const objectIs = <T>(currentValue: T, nextValue: T): boolean => Object.is(currentValue, nextValue);

/**
 * React can still enqueue a functional state update whose reducer returns the
 * current value. For event streams and commit-phase callbacks that distinction
 * matters: an enqueued semantic no-op can participate in an update cycle.
 *
 * This hook keeps the latest requested value outside React and calls the state
 * dispatcher only for an actual `Object.is` transition. It intentionally
 * accepts concrete values rather than updater functions so the comparison is
 * complete before React is entered.
 */
export function useDistinctState<T>(
  initialValue: T,
  isEqual: DistinctStateEquality<T> = objectIs,
): readonly [value: T, setValue: SetDistinctState<T>, getValue: () => T] {
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);

  const setDistinctValue = useCallback(
    (nextValue: T): boolean => {
      if (isEqual(valueRef.current, nextValue)) return false;
      valueRef.current = nextValue;
      setValue(nextValue);
      return true;
    },
    [isEqual],
  );
  const getValue = useCallback(() => valueRef.current, []);

  return [value, setDistinctValue, getValue];
}
