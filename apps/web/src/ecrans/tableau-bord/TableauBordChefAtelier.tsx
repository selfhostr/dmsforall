import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FiltreTableauBord } from '@dfa/shared';

import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';

import { CarteChiffreRequete } from './composants/CarteChiffreRequete';
import { CarteEquipeEnCours } from './composants/CarteEquipeEnCours';
import { CarteRepartitionStatuts } from './composants/CarteRepartitionStatuts';
import { CarteRestitutionsJour } from './composants/CarteRestitutionsJour';

interface Props {
  readonly site: string | undefined;
}

/**
 * Chef d'atelier — 4 blocs (`docs/design-tableau-bord-par-role.md` §3.3) : ce qui sort aujourd'hui,
 * ce qui bloque. Aucun sélecteur de période : tout est « aujourd'hui »/« maintenant » pour lui
 * (`lignesEnAttenteValidation`/`ordresReparationParStatut` sont des SNAPSHOTS côté contrat,
 * `packages/shared/src/contrats/tableau-bord/activite.ts` — indépendants de `du`/`au`, un seul
 * appel à `useActiviteTableauBord` suffit donc pour les deux). Aucun bloc financier (RF-115, il
 * n'a jamais eu ce droit — jamais monté, jamais un skeleton en attente, voir `EcranTableauBord`).
 */
export function TableauBordChefAtelier({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);

  const filtre = useMemo<FiltreTableauBord>(() => ({ siteId: site }), [site]);
  const activite = useActiviteTableauBord(filtre);

  return (
    <div className="flex flex-col gap-6">
      <CarteRestitutionsJour
        site={site}
        titreCle="tableauBord:chefAtelier.sortiesDuJour.titre"
        descriptionCle="tableauBord:chefAtelier.sortiesDuJour.description"
        videTitreCle="tableauBord:chefAtelier.sortiesDuJour.vide.titre"
        videDescriptionCle="tableauBord:chefAtelier.sortiesDuJour.vide.description"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <CarteChiffreRequete
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
