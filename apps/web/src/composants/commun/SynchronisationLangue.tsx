import { useEffect } from 'react';

import { CLE_STOCKAGE_LANGUE } from '@/i18n';
import { useLangue } from '@/hooks/useLangue';
import { useSession } from '@/hooks/useSession';

/** Applique `utilisateur.langue` comme langue d'interface une fois la session connue, SAUF si
 *  l'utilisateur a déjà choisi explicitement une langue sur ce poste (présence en
 *  localStorage) — cette préférence locale reste prioritaire (voir priorité définie dans
 *  src/i18n/index.ts). Composant sans rendu, monté une fois près de la racine. */
export function SynchronisationLangue() {
  const { data: session } = useSession();
  const { langue, changerLangue } = useLangue();

  useEffect(() => {
    if (!session) return;
    const preferenceExplicite = window.localStorage.getItem(CLE_STOCKAGE_LANGUE);
    if (preferenceExplicite) return;
    if (session.utilisateur.langue !== langue) {
      changerLangue(session.utilisateur.langue);
    }
  }, [session, langue, changerLangue]);

  return null;
}
