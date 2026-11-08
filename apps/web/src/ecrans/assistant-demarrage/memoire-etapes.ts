import { useEffect, useState } from 'react';

/** Saisies en cours de chaque étape, gardées par l'assistant : quitter puis reprendre ne perd rien. */
export type MemoireEtapes = Map<string, unknown>;

export function useMemoireEtape<T>(
  memoire: MemoireEtapes,
  id: string,
  initial: T,
): readonly [T, (valeur: T | ((precedent: T) => T)) => void] {
  const [valeur, setValeur] = useState<T>(() =>
    memoire.has(id) ? (memoire.get(id) as T) : initial,
  );
  useEffect(() => {
    memoire.set(id, valeur);
  }, [memoire, id, valeur]);
  return [valeur, setValeur] as const;
}
