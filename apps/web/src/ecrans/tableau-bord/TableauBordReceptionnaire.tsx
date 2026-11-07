import { useMemo } from 'react';

import type { FiltreTableauBord } from '@dfa/shared';

import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';

import { CarteRepartitionStatuts } from './composants/CarteRepartitionStatuts';

interface Props {
  readonly site: string | undefined;
}

/**
 * Réceptionnaire — 3 blocs, REFONDUS le 12.08.2026 (constat terrain, verbatim : « son écran du
 * lundi matin affiche trois fois "Aucun…" et un zéro »). Mesuré avant de corriger — le serveur
 * n'était PAS en cause : `GET /tableau-bord/activite` rend des données réelles (voir git-blame de
 * ce fichier pour le détail des appels). La faute était dans le CHOIX des blocs, hérité d'un écran
 * bâti avant que le domaine `rendez-vous` n'existe :
 *  - l'ancien `CalendrierEcheances` était une PRÉVERSION explicitement documentée « aucune table
 *    rendez_vous n'existe à ce jour » — obsolète depuis que ce domaine est livré (`apps/api/src/
 *    rendezvous/`) ;
 *  - `EcheancesAVenir` (pneus à relancer) n'a jamais répondu au geste du lundi matin, seulement à
 *    celui du magasinier ;
 *  - « lignes en attente de validation » était marqué INCERTAIN par son propre design
 *    (`docs/design-tableau-bord-par-role.md` §3.4 : hypothèse jamais confirmée terrain) — un ZÉRO
 *    réel affiché sans ce contexte se lit comme un écran cassé, pas comme une information utile.
 *
 * Les 3 blocs actuels répondent au VRAI besoin (recherché avec @laupernoe) : qui est attendu aujourd'hui
 * (`CarteRendezVousJour`, domaine rendez-vous), qui doit repartir aujourd'hui et qui est en retard
 * (`CarteRestitutionsJour`, même composant que Direction/Chef d'atelier — « même endpoint, même
 * composant, prop de fenêtre différente »), et l'état du parc à l'atelier en un coup d'œil
 * (`CarteRepartitionStatuts`, même composant que Chef d'atelier — remplace le zéro incertain par un
 * VRAI compte par statut, `planifie` = attendu, `en_cours`/`controle` = à l'atelier maintenant).
 */
export function TableauBordReceptionnaire({ site }: Props) {
  const filtre = useMemo<FiltreTableauBord>(() => ({ siteId: site }), [site]);
  const activite = useActiviteTableauBord(filtre);

  return (
    // Rendez-vous du jour, restitutions et OR en retard sont remontés dans « À faire aujourd'hui »
    // (`ecrans/accueil/composants/AFaireAujourdhui.tsx`, audit navigation : l'accueil commence par
    // l'action, pas par les chiffres) — il reste ici l'état du parc à l'atelier.
    <div className="grid gap-groupe lg:grid-cols-2 lg:items-start">
      <CarteRepartitionStatuts resultat={activite} />
    </div>
  );
}
