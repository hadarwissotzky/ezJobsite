/**
 * Load something, and keep the three outcomes apart.
 *
 * `{ loading, error, data }` rather than `data | undefined`, because the difference
 * between "still going", "it failed" and "there is nothing" is the whole story on a
 * screen like this one. CLIENT-PORTAL.md §1 is six paragraphs about what happens when
 * a page cannot tell the first from the second: a spinner, forever, with the real
 * error unhandled and invisible from every angle a person would look from.
 */
import { useCallback, useEffect, useState } from 'react';

export type Async<T> = {
  loading: boolean;
  error: unknown;
  data: T | null;
  reload: () => void;
};

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ loading: boolean; error: unknown; data: T | null }>(
    { loading: true, error: null, data: null },
  );
  const [nonce, setNonce] = useState(0);

  // `load` is a fresh closure every render; depending on it directly would reload
  // forever. The caller's `deps` are the truth about when this should run again.
  const run = useCallback(load, deps);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    run().then(
      (data) => { if (live) setState({ loading: false, error: null, data }); },
      // The error is KEPT, not logged and swallowed. Something has to render it.
      (error) => { if (live) setState({ loading: false, error, data: null }); },
    );
    // Unmounting mid-flight must not write into a dead component, and — more
    // importantly here — a fast second navigation must not have its result overwritten
    // by the first one landing late.
    return () => { live = false; };
  }, [run, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
