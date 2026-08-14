import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/hooks/useSession';

export type VueAgenda = 'jour' | 'semaine';

const VUE_PAR_DEFAUT: VueAgenda = 'semaine';

function estVueAgendaValide(valeur: string | null): valeur is VueAgenda {
  return valeur === 'jour' || valeur === 'semaine';
}

/** Clé localStorage PAR UTILISATEUR (pas par session, pas globale au poste) — un réceptionniste qui
 *  bascule sur Jour pour préparer l'accueil du matin la retrouve le lendemain, même sur un poste
 *  partagé par plusieurs comptes (`docs/conception-rendez-vous-ecrans.md`, « Vue par défaut »). */
function cleStockage(utilisateurId: string): string {
  return `dfa.rendezVous.vueAgenda.${utilisateurId}`;
}

/**
 * Bascule Jour/Semaine de l'agenda de rendez-vous, mémorisée PAR UTILISATEUR (localStorage), jamais
 * par session ni devinée depuis le rôle — même l'utilisateur qui ouvre cet écran pour un usage
 * secondaire (chef d'atelier) contrôle explicitement sa propre préférence, l'écran ne la choisit
 * jamais à sa place (« un agenda qui change de forme selon qui regarde est un agenda qu'on ne peut
 * plus prévoir »).
 *
 * Avant résolution de la session (chargement), retombe sur `semaine` — la vue par défaut du produit
 * — sans jamais lire ni écrire le localStorage tant que l'identité de l'utilisateur n'est pas connue.
 */
export function useVueAgendaPreferee(): readonly [VueAgenda, (vue: VueAgenda) => void] {
  const { data: session } = useSession();
  const utilisateurId = session?.utilisateur.id;

  const [vue, setVueEtat] = useState<VueAgenda>(VUE_PAR_DEFAUT);
  // Hydratation UNE SEULE FOIS, dès que l'identité de l'utilisateur devient connue — `useSession`
  // résout de façon asynchrone (TanStack Query) : à l'affichage initial, `utilisateurId` est encore
  // `undefined`, donc l'initialiseur de `useState` ci-dessus ne peut pas lire le localStorage. Sans
  // cet effet, une préférence "jour" déjà mémorisée resterait invisible jusqu'au prochain rechargement.
  const hydrate = useRef(false);
  useEffect(() => {
    if (hydrate.current || !utilisateurId || typeof window === 'undefined') return;
    hydrate.current = true;
    const stockee = window.localStorage.getItem(cleStockage(utilisateurId));
    if (estVueAgendaValide(stockee)) setVueEtat(stockee);
  }, [utilisateurId]);

  const setVue = useCallback(
    (nouvelleVue: VueAgenda) => {
      setVueEtat(nouvelleVue);
      if (utilisateurId && typeof window !== 'undefined') {
        window.localStorage.setItem(cleStockage(utilisateurId), nouvelleVue);
      }
    },
    [utilisateurId],
  );

  return [vue, setVue] as const;
}
