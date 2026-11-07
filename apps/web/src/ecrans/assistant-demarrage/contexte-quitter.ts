import { createContext, useContext } from 'react';

/** Action « Quitter pour l'instant » de l'assistant, lue par le pied de chaque étape pour
 *  l'afficher à côté de l'action principale. Absente hors de l'assistant. */
export const ContexteQuitterAssistant = createContext<(() => void) | undefined>(undefined);

export function useQuitterAssistant(): (() => void) | undefined {
  return useContext(ContexteQuitterAssistant);
}
