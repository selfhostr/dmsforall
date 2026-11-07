import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FiltreTableauBord } from '@dfa/shared';

import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';
import { useOrEnAttentePieces } from '@/hooks/tableau-bord/useOrEnAttentePieces';

import { CarteChiffreRequete } from './composants/CarteChiffreRequete';
import { CarteEquipeEnCours } from './composants/CarteEquipeEnCours';
import { CarteRepartitionStatuts } from './composants/CarteRepartitionStatuts';

interface Props {
  readonly site: string | undefined;
}

/**
 * Chef d'atelier — 5 blocs (`docs/design-tableau-bord-par-role.md` §3.3) : ce qui sort aujourd'hui,
 * ce qui bloque. Aucun sélecteur de période : tout est « aujourd'hui »/« maintenant » pour lui
 * (`lignesEnAttenteValidation`/`ordresReparationParStatut` sont des SNAPSHOTS côté contrat,
 * `packages/shared/src/contrats/tableau-bord/activite.ts` — indépendants de `du`/`au`, un seul
 * appel à `useActiviteTableauBord` suffit donc pour les deux). Aucun bloc financier (RF-115, il
 * n'a jamais eu ce droit — jamais monté, jamais un skeleton en attente, voir `EcranTableauBord`).
 *
 * « OR en attente de pièces » (issue #74, constat terrain du 12.08.2026 : c'est l'information que
 * le chef d'atelier cherche en priorité le matin — ce qui est bloqué faute de pièce, donc ce qui
 * demande une action de sa part) N'EST PAS une entrée de `ordresReparationParStatut` : « attente
 * pièces » n'est pas un statut mais un drapeau ORTHOGONAL au statut (A-03,
 * `contrats/atelier/enums.ts` — un OR `en_cours` peut être simultanément bloqué faute de pièce), le
 * graphique par statut ne pouvait donc structurellement pas la porter sans double-compter. Compte
 * séparé, via `useOrEnAttentePieces` (source DISTINCTE de `useActiviteTableauBord` : `GET
 * /ordres-reparation`, pas `GET /tableau-bord/activite` — voir sa doc pour la méthode et ses
 * limites assumées).
 */
export function TableauBordChefAtelier({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);

  const filtre = useMemo<FiltreTableauBord>(() => ({ siteId: site }), [site]);
  const activite = useActiviteTableauBord(filtre);
  const orEnAttentePieces = useOrEnAttentePieces(site);

  return (
    <div className="flex flex-col gap-section">
      {/* Sorties du jour et OR en retard : remontés dans « À faire aujourd'hui » (accueil). */}
      {/* DESIGN.md grief n°2 — `items-start` : `CarteEquipeEnCours` (liste jusqu'à 6 techniciens)
          est structurellement plus haute que ses deux voisines `compact`, mêmes raisons que
          `TableauBordDirection`. */}
      <div className="grid items-start gap-groupe sm:grid-cols-3">
        <CarteChiffreRequete
          compact
          titre={t('tableauBord:activite.orEnAttentePieces.libelle')}
          resultat={orEnAttentePieces}
          libelleErreur={t('tableauBord:activite.orEnAttentePieces.erreur')}
          valeur={(nombre) => String(nombre)}
          description={() => t('tableauBord:activite.orEnAttentePieces.description')}
        />
        <CarteChiffreRequete
          compact
          titre={t('tableauBord:activite.lignesEnAttenteValidation.libelle')}
          resultat={activite}
          libelleErreur={t('tableauBord:activite.erreur.titre')}
          valeur={(donnees) => String(donnees.lignesEnAttenteValidation)}
        />
        <CarteEquipeEnCours site={site} />
      </div>

      <CarteRepartitionStatuts resultat={activite} />
    </div>
  );
}
