import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { Plaque } from '@/composants/identite/Plaque';
import { formaterDate } from '@/lib/formats';

import { BadgeStatutRendezVous } from './BadgeStatutRendezVous';
import type { RendezVousCarte } from './types';

interface Props {
  readonly rendezVous: readonly RendezVousCarte[];
  readonly onOuvrirRendezVous: (rendezVous: RendezVousCarte) => void;
  readonly enChargement?: boolean;
  readonly contenuVide?: ReactNode;
}

/** Date jj.mm.aaaa + créneau (heure souhaitée si connue, sinon le moment) — même logique que
 *  `CarteRendezVous`, le contrat ne porte pas d'heure combinée. */
function libelleCreneau(rendezVous: RendezVousCarte, t: (cle: string) => string): string {
  const date = formaterDate(rendezVous.dateLe);
  const heure = rendezVous.heureSouhaitee
    ? rendezVous.heureSouhaitee.slice(0, 5)
    : t(`planning:moments.${rendezVous.moment}`);
  return `${date} · ${heure}`;
}

/**
 * Vue Liste — chemin de secours clavier/lecteur d'écran de l'agenda, de PLEIN DROIT (pas un mode
 * dégradé, `docs/conception-rendez-vous-ecrans.md` §Accessibilité) : mêmes rendez-vous, mêmes
 * gestes, `TableComptoir` déjà conforme clavier/lecteur d'écran (utilisé par
 * `EcranListeOrdresReparation`).
 */
export function VueListeRendezVous({
  rendezVous,
  onOuvrirRendezVous,
  enChargement,
  contenuVide,
}: Props) {
  const { t } = useTranslation('planning');

  const colonnes: ColonneComptoir<RendezVousCarte>[] = [
    {
      id: 'heure',
      libelle: t('planning:vueListe.colonnes.heure'),
      rendu: (r) => libelleCreneau(r, t),
    },
    { id: 'client', libelle: t('planning:vueListe.colonnes.client'), rendu: (r) => r.clientNom },
    {
      id: 'vehicule',
      libelle: t('planning:vueListe.colonnes.vehicule'),
      rendu: (r) =>
        r.vehiculePlaque ? (
          <Plaque canton={r.vehiculeCanton} numero={r.vehiculePlaque} taille="sm" />
        ) : (
          '—'
        ),
    },
    {
      id: 'motif',
      libelle: t('planning:vueListe.colonnes.motif'),
      rendu: (r) => r.motifLibelle,
    },
    {
      id: 'statut',
      libelle: t('planning:vueListe.colonnes.statut'),
      rendu: (r) => <BadgeStatutRendezVous statut={r.statut} />,
    },
  ];

  return (
    <TableComptoir
      colonnes={colonnes}
      lignes={rendezVous}
      cleLigne={(r) => r.id}
      onOuvrirLigne={onOuvrirRendezVous}
      libelleLigne={(r) =>
        t('planning:carte.ouvrir', { client: r.clientNom, heure: libelleCreneau(r, t) })
      }
      enChargement={enChargement}
      contenuVide={contenuVide}
    />
  );
}
