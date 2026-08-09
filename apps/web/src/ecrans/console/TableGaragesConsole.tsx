import { ArrowRight } from 'lucide-react';
import type { GarageConsole, NiveauSanteGarage } from '@dfa/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  TableComptoir,
  type ColonneComptoir,
  type EtatTriComptoir,
} from '@/composants/comptoir/TableComptoir';

import { BadgeExportComptableConsole } from './BadgeExportComptableConsole';
import { BadgeStatutGarage } from './BadgeStatutGarage';
import { calculerDureeEcouleeConsole } from './temps-relatif';

/** Sévérité décroissante — voir `trierGarages` : plus le poids est élevé, plus le garage remonte
 *  en tri « Statut décroissant » (conception §2 : « les garages qui ont besoin d'attention
 *  remontent seuls »). */
const POIDS_STATUT: Readonly<Record<NiveauSanteGarage, number>> = {
  critique: 2,
  attention: 1,
  ok: 0,
};

function valeurDerniereActivite(garage: GarageConsole): number {
  return garage.derniereConnexionReussieLe
    ? new Date(garage.derniereConnexionReussieLe).getTime()
    : Number.NEGATIVE_INFINITY;
}

/** Tri par défaut de la conception (§2) : Statut décroissant puis Dernière activité décroissante
 *  comme départage. Cliquer « Dernière activité » trie sur ce seul champ ; cliquer « Statut »
 *  garde le départage par activité récente à l'intérieur d'un même niveau de sévérité. */
function trierGarages(
  garages: readonly GarageConsole[],
  tri: EtatTriComptoir,
): readonly GarageConsole[] {
  const sens = tri.sens === 'asc' ? 1 : -1;
  return [...garages].sort((a, b) => {
    if (tri.colonneId === 'derniereActivite') {
      return (valeurDerniereActivite(a) - valeurDerniereActivite(b)) * sens;
    }
    const diffStatut = (POIDS_STATUT[a.niveau] - POIDS_STATUT[b.niveau]) * sens;
    if (diffStatut !== 0) return diffStatut;
    return valeurDerniereActivite(b) - valeurDerniereActivite(a);
  });
}

const TRI_DEFAUT: EtatTriComptoir = { colonneId: 'statut', sens: 'desc' };

function DerniereActiviteConsole({ iso }: { readonly iso: string | null }) {
  const { t } = useTranslation('console');
  if (iso === null) {
    return (
      <span className="text-muted-foreground">{t('console:plateforme.table.jamaisConnecte')}</span>
    );
  }
  const duree = calculerDureeEcouleeConsole(iso);
  return (
    <span>
      {t(`console:plateforme.table.derniereActivite.${duree.granularite}`, { n: duree.valeur })}
    </span>
  );
}

interface Props {
  readonly garages: readonly GarageConsole[];
  readonly enChargement: boolean;
  readonly onEntrer: (garage: GarageConsole) => void;
  readonly contenuVide: ReactNode;
}

/**
 * Table plateforme du palier 1 (§8 de la conception) — construite sur `TableComptoir`
 * (`composants/comptoir/`), pas réécrite : ce composant porte déjà exactement ce que §9 de la
 * conception exige (vrais `<th scope="col">`, tri annoncé `aria-sort`, ligne cliquable au clavier
 * ET au clic, jamais un `<div onClick>`). La conception ne le mentionne pas explicitement (base
 * explorée avant conception : `composants/layout/`, `ecrans/tableau-bord/`, `components/ui/` —
 * pas `composants/comptoir/`), mais réutiliser plutôt que dupliquer est le principe directeur
 * explicite du document (§8 : « rien n'est réinventé quand un composant existant convient »).
 *
 * Colonnes « Erreurs 24 h » et « Jobs en échec » de la conception initiale RETIRÉES : le contrat
 * réel (`GarageConsole`, `@dfa/shared`) ne porte aucune de ces deux mesures par garage (elles ne
 * sont mesurables qu'au niveau plateforme, et ne le sont même pas encore — voir
 * `resume.indicateursIndisponibles`, affiché par `IndicateursPlateformeConsole`). Remplacées par
 * deux colonnes réellement disponibles et du même ordre d'utilité opérationnelle : comptes
 * verrouillés et relances en retard.
 */
export function TableGaragesConsole({ garages, enChargement, onEntrer, contenuVide }: Props) {
  const { t } = useTranslation('console');
  const [tri, setTri] = useState<EtatTriComptoir>(TRI_DEFAUT);

  const garagesTries = useMemo(() => trierGarages(garages, tri), [garages, tri]);

  function gererTri(colonneId: string) {
    setTri((precedent) => {
      if (precedent.colonneId !== colonneId) return { colonneId, sens: 'desc' };
      return { colonneId, sens: precedent.sens === 'asc' ? 'desc' : 'asc' };
    });
  }

  const colonnes: ColonneComptoir<GarageConsole>[] = [
    {
      id: 'garage',
      libelle: t('console:plateforme.table.colonnes.garage'),
      rendu: (garage) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{garage.raisonSociale}</span>
          <span className="texte-libelle text-muted-foreground">{garage.slug}</span>
        </div>
      ),
    },
    {
      id: 'statut',
      libelle: t('console:plateforme.table.colonnes.statut'),
      triable: true,
      rendu: (garage) => <BadgeStatutGarage statut={garage.niveau} />,
    },
    {
      id: 'derniereActivite',
      libelle: t('console:plateforme.table.colonnes.derniereActivite'),
      triable: true,
      rendu: (garage) => <DerniereActiviteConsole iso={garage.derniereConnexionReussieLe} />,
    },
    {
      id: 'comptesVerrouilles',
      libelle: t('console:plateforme.table.colonnes.comptesVerrouilles'),
      alignement: 'droite',
      rendu: (garage) => <span className="tabular-nums">{garage.comptesVerrouilles}</span>,
    },
    {
      id: 'relancesEnRetard',
      libelle: t('console:plateforme.table.colonnes.relancesEnRetard'),
      alignement: 'droite',
      rendu: (garage) => <span className="tabular-nums">{garage.relancesPlanifieesEnRetard}</span>,
    },
    {
      id: 'exportCompta',
      libelle: t('console:plateforme.table.colonnes.exportCompta'),
      rendu: (garage) => (
        <BadgeExportComptableConsole statut={garage.dernierExportComptableStatut} />
      ),
    },
    {
      id: 'entrer',
      libelle: t('console:plateforme.table.colonnes.entrer'),
      actions: true,
      alignement: 'droite',
      rendu: (garage) => (
        <Button type="button" variant="outline" size="sm" onClick={() => onEntrer(garage)}>
          {t('console:plateforme.table.entrer')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <TableComptoir
      colonnes={colonnes}
      lignes={garagesTries}
      cleLigne={(garage) => garage.tenantId}
      tri={tri}
      onTrier={gererTri}
      onOuvrirLigne={onEntrer}
      libelleLigne={(garage) =>
        t('console:plateforme.table.entrerAria', { raisonSociale: garage.raisonSociale })
      }
      enChargement={enChargement}
      lignesSquelette={4}
      contenuVide={contenuVide}
    />
  );
}
