import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FiltreTableauBord } from '@dfa/shared';

import { CalendrierEcheances } from '@/ecrans/accueil/composants/CalendrierEcheances';
import { EcheancesAVenir } from '@/ecrans/accueil/composants/EcheancesAVenir';
import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';

import { CarteChiffreRequete } from './composants/CarteChiffreRequete';

interface Props {
  readonly site: string | undefined;
}

/**
 * Réceptionnaire — 3 blocs (`docs/design-tableau-bord-par-role.md` §3.4) : les deux premiers sont
 * la reprise À L'IDENTIQUE de l'ancien `EcranAccueil` (`CalendrierEcheances` en vue semaine,
 * `EcheancesAVenir`) — son outil réel reste la recherche en en-tête, ce dashboard est un
 * complément léger, pas son geste principal. Le troisième (« lignes en attente de validation »,
 * même champ SNAPSHOT que le chef d'atelier) est marqué INCERTAIN par le design : hypothèse « elle
 * rappelle le client pour un devis complémentaire », pas confirmée terrain — construit quand même
 * (chiffre réel, pas inventé), à retirer si l'hypothèse s'avère fausse.
 */
export function TableauBordReceptionnaire({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);
  const filtre = useMemo<FiltreTableauBord>(() => ({ siteId: site }), [site]);
  const activite = useActiviteTableauBord(filtre);

  return (
    <div className="flex flex-col gap-6">
      <CalendrierEcheances site={site} />
      <EcheancesAVenir site={site} />
      <CarteChiffreRequete
        titre={t('tableauBord:activite.lignesEnAttenteValidation.libelle')}
        resultat={activite}
        libelleErreur={t('tableauBord:activite.erreur.titre')}
        valeur={(donnees) => String(donnees.lignesEnAttenteValidation)}
      />
    </div>
  );
}
