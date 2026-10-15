// Historiques AODP de plusieurs objets (gages des prêts) : requêtes séquentielles (respect du débit de l'API),
// cache sessionStorage de fetchHistory, arrêt net sur un 429 (les objets restants passent en estimation sans historique).
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, ApiError, fetchHistory, type HistoryByLoc } from './history';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HistState =
  | { state: 'loading' }
  | { state: 'ok'; data: HistoryByLoc }
  | { state: 'error'; message: string; rateLimited: boolean };

/** Au plus 25 objets interrogés par chargement de page. */
export const MAX_HISTORY_ITEMS = 25;

export function useHistories(ids: readonly string[], fetchImpl?: FetchLike): [Record<string, HistState>, () => void] {
  const [states, setStates] = useState<Record<string, HistState>>({});
  const okRef = useRef<Record<string, HistState>>({});
  const [nonce, setNonce] = useState(0);
  // Clé stable : ordre conservé (le premier objet est prioritaire), doublons écartés.
  const uniq = [...new Set(ids)].slice(0, MAX_HISTORY_ITEMS);
  const key = uniq.join(',');

  useEffect(() => {
    const ac = new AbortController();
    const list = key ? key.split(',') : [];
    const todo = list.filter((id) => okRef.current[id]?.state !== 'ok');
    if (todo.length === 0) return;
    setStates((s) => {
      const next = { ...s };
      for (const id of todo) next[id] = { state: 'loading' };
      return next;
    });
    (async () => {
      for (let i = 0; i < todo.length; i++) {
        const id = todo[i];
        try {
          const data = await fetchHistory(id, { fetchImpl, signal: ac.signal });
          if (ac.signal.aborted) return;
          okRef.current[id] = { state: 'ok', data };
          setStates((s) => ({ ...s, [id]: { state: 'ok', data } }));
        } catch (e) {
          if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
          const rateLimited = e instanceof ApiError && e.kind === 'rate-limit';
          const err: HistState = { state: 'error', message: apiErrorMessage(e), rateLimited };
          if (rateLimited) {
            // API saturée : inutile d'insister, tous les objets restants passent en repli.
            setStates((s) => {
              const next = { ...s };
              for (const rest of todo.slice(i)) next[rest] = err;
              return next;
            });
            return;
          }
          setStates((s) => ({ ...s, [id]: err }));
        }
      }
    })();
    return () => ac.abort();
  }, [key, fetchImpl, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return [states, retry];
}
