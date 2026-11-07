import { useTranslation } from 'react-i18next';

import type { SessionCourante } from '@dfa/shared';

import { EcheancesAVenir } from '@/ecrans/accueil/composants/EcheancesAVenir';
import { useModulesActifs } from '@/hooks/modules/useModulesActifs';
import { chemins } from '@/routes/chemins';

import { CarteAccesRapide } from './composants/CarteAccesRapide';
import { CarteReapprovisionnement } from './composants/CarteReapprovisionnement';

interface Props {
  readonly site: string | undefined;
  readonly sites: SessionCourante['sites'];
}

/**
 * Magasinier — 3 blocs (`docs/design-tableau-bord-par-role.md` §3.5). Atterrit sur Pièces ›
 * Comptoir (son outil réel, `routes/atterrissage.ts`) ; ceci ne sert que s'il visite le tableau de
 * bord.
 *
 * « Réservations actives » N'EST PAS une liste ici (contrairement au design initial) : recherche
 * confirmée, `ReponseReservationPiece` ne porte ni désignation d'article ni numéro d'OR (seulement
 * des UUID bruts — même constat que `EcranReservationsPieces.tsx`) et `PageCurseur` n'expose aucun
 * total, seulement des pages (max 50 chargées) — un compte serait potentiellement faux au-delà de
 * la première page. Un LIEN honnête vers l'écran des réservations, qui sait déjà afficher cette
 * donnée brute, remplace la liste/le chiffre qu'aucun contrat ne permet de construire proprement
 * ici (voir `composants/CarteAccesRapide.tsx`).
 *
 * `useReapprovisionnement` (bloc 2) exige un site réel — `siteResolu` reprend le repli de l'ancien
 * `EcranAccueil` (premier site actif de la session) : le sélecteur global du tableau de bord permet
 * « tous les sites », ce sous-bloc ne le peut pas.
 */
export function TableauBordMagasinier({ site, sites }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);
  const siteResolu = site ?? sites.find((candidat) => candidat.actif)?.id ?? sites[0]?.id;
  // Module « Pièces » retiré : ni réservations ni réapprovisionnement à proposer.
  const { estActif } = useModulesActifs();
  const modulePieces = estActif('pieces');

  return (
    <div className="flex flex-col gap-section">
      {/* DESIGN.md grief n°2 — `items-start` : `CarteAccesRapide` (`compact`, titre+description+
          bouton) est structurellement plus courte que `CarteReapprovisionnement` (liste jusqu'à 5
          lignes) ; sans lui, la grille CSS l'étirerait à la hauteur de sa voisine. */}
      {modulePieces ? (
        <div className="grid items-start gap-groupe sm:grid-cols-2">
          <CarteAccesRapide
            titre={t('tableauBord:magasinier.reservations.titre')}
            description={t('tableauBord:magasinier.reservations.description')}
            lien={{
              to: chemins.pieces.reservations(siteResolu),
              texte: t('tableauBord:magasinier.reservations.lien'),
            }}
          />
          <CarteReapprovisionnement site={siteResolu} />
        </div>
      ) : null}

      <EcheancesAVenir site={siteResolu} />
    </div>
  );
}
