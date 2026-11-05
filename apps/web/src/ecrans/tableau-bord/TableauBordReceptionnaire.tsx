import { useMemo } from 'react';

import type { FiltreTableauBord } from '@dfa/shared';

import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';

import { CarteOrEnRetard } from './composants/CarteOrEnRetard';
import { CarteRendezVousJour } from './composants/CarteRendezVousJour';
import { CarteRepartitionStatuts } from './composants/CarteRepartitionStatuts';
import { CarteRestitutionsJour } from './composants/CarteRestitutionsJour';

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
    // Quatre cartes indépendantes, plus jamais empilées plein-écran dès `lg` (mission « largeur
    // plutôt que défilement », ce rôle était l'écran le plus haut des quatre stacks originaux) :
    // ordre de lecture inchangé, gauche→droite puis haut→bas — qui est attendu aujourd'hui, ce qui
    // sort aujourd'hui, ce qui est en retard, l'état du parc.
    <div className="grid gap-groupe lg:grid-cols-2 lg:items-start">
      <CarteRendezVousJour site={site} />

      <CarteRestitutionsJour
        site={site}
        titreCle="tableauBord:receptionnaire.restitutionsJour.titre"
        descriptionCle="tableauBord:receptionnaire.restitutionsJour.description"
        videTitreCle="tableauBord:receptionnaire.restitutionsJour.vide.titre"
        videDescriptionCle="tableauBord:receptionnaire.restitutionsJour.vide.description"
      />

      {/* Issue #112 : `CarteRestitutionsJour` ci-dessus reste bornée à aujourd'hui — carte
       *  distincte pour ce qui traîne depuis avant, voir sa doc de tête. */}
      <CarteOrEnRetard site={site} />

      <CarteRepartitionStatuts resultat={activite} />
    </div>
  );
}
