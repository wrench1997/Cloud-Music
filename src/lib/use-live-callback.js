import { useCallback, useLayoutEffect, useRef } from 'react';

// Stable handlers let large lists skip playback-position renders while using
// the latest account, queue and permissions when the user actually clicks.
export function useLiveCallback(callback) {
  const current = useRef(callback);
  useLayoutEffect(() => { current.current = callback; }, [callback]);
  return useCallback((...args) => current.current?.(...args), []);
}
