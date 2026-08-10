import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FiltreTableauBord } from '@dfa/shared';

import { versDateIsoLocale } from '@/ecrans/accueil/semaine';
import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';
import { useFinancierTableauBord } from '@/hooks/tableau-bord/useFinancierTableauBord';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { CarteChiffreRequete } from './composants/CarteChiffreRequete';
import { CarteRestitutionsJour } from './composants/CarteRestitutionsJour';
import { SelecteurPeriodeTableauBord } from './SelecteurPeriodeTableauBord';

interface Props {
  readonly site: string | undefined;
}

/**
 * Direction — 4 blocs (`docs/design-tableau-bord-par-role.md` §3.1) : l'argent qui rentre, ce qui
 * sort ce soir, si l'atelier tourne. « Répartition par statut » et « articles sous seuil » sont
 * ÉCARTÉS ici (chiffre de pilotage voulu, pas un histogramme — c'est le geste du chef d'atelier).
 *
 * Deux fenêtres temporelles COEXISTENT, volontairement découplées : le sélecteur de période
 * (mois civil par défaut) ne pilote QUE le chiffre d'affaires ; « OR ouverts » et « sorties du
 * soir » restent figés sur AUJOURD'HUI quel que soit le réglage du sélecteur — un OR ouvert le
 * mois dernier n'est pas ce que la direction veut voir en travaillant sur le CA de l'an dernier.
 *
 * « Encours clients » n'est PAS un lien filtré : `EcranListeFactures` lit son onglet depuis un
 * état local, jamais depuis l'URL (voir `composants/CarteAccesRapide.tsx` pour le même constat,
 * détaillé, côté comptable) — le lien mène donc à la liste générale des factures, pas à une vue
 * pré-filtrée « en retard », gap signalé plutôt qu'un lien qui prétendrait filtrer sans le faire.
 */
export function TableauBordDirection({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);
  const [du, setDu] = useState<string | undefined>(undefined);
  const [au, setAu] = useState<string | undefined>(undefined);

  const filtrePeriode = useMemo<FiltreTableauBord>(
    () => ({ siteId: site, du, au }),
    [site, du, au],
  );
  const filtreAujourdhui = useMemo<FiltreTableauBord>(() => {
    const iso = versDateIsoLocale(new Date());
    return { siteId: site, du: iso, au: iso };
  }, [site]);

  const financier = useFinancierTableauBord(filtrePeriode, true);
  const activiteAujourdhui = useActiviteTableauBord(filtreAujourdhui);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CarteChiffreRequete
          titre={t('tableauBord:financier.encoursClients.libelle')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          valeur={(donnees) => `CHF ${formaterMontant(donnees.encoursClientsCentimes)}`}
          lien={{
            to: chemins.facturation.liste(site),
            texte: t('tableauBord:communs.voirFactures'),
          }}
        />
        <div className="flex flex-col gap-2 sm:col-span-2 sm:row-span-1">
          <SelecteurPeriodeTableauBord
            du={du}
            au={au}
            onChangeDu={setDu}
            onChangeAu={setAu}
            periodeAppliquee={financier.data?.periode}
          />
          <CarteChiffreRequete
            titre={t('tableauBord:financier.chiffreAffaires.libelle')}
            resultat={financier}
            libelleErreur={t('tableauBord:financier.erreur.titre')}
            valeur={(donnees) => `CHF ${formaterMontant(donnees.chiffreAffaires.totalTtcCentimes)}`}
            description={(donnees) =>
              t('tableauBord:financier.chiffreAffaires.detail', {
                ht: formaterMontant(donnees.chiffreAffaires.totalHtCentimes),
                tva: formaterMontant(donnees.chiffreAffaires.totalTvaCentimes),
                nombreDocuments: donnees.chiffreAffaires.nombreDocuments,
              })
            }
          />
        </div>
        <CarteChiffreRequete
          titre={t('tableauBord:activite.ordresOuverts.libelleAujourdhui')}
          resultat={activiteAujourdhui}
          libelleErreur={t('tableauBord:activite.erreur.titre')}
          valeur={(donnees) => String(donnees.ordresReparationOuvertsPeriode)}
        />
      </div>

      <CarteRestitutionsJour
        site={site}
        titreCle="tableauBord:direction.sortiesDuSoir.titre"
        descriptionCle="tableauBord:direction.sortiesDuSoir.description"
        videTitreCle="tableauBord:direction.sortiesDuSoir.vide.titre"
        videDescriptionCle="tableauBord:direction.sortiesDuSoir.vide.description"
      />
    </div>
  );
}
