import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { VehiculeStockResume } from '@dfa/shared';

import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';

import { BadgeStatutVehiculeStock } from '../BadgeStatutVehiculeStock';

/**
 * « Plan du parc » (issue #142) : le besoin nommé par le testeur n'est PAS un dessin 2D du terrain
 * (aucun garage n'a numérisé son plan de site) mais « retrouver sa place exacte » — un
 * REGROUPEMENT visuel par zone, chaque zone étant la valeur libre saisie dans
 * `ChampEmplacementVehiculeStock` (« devant », « place 3 », un simple aide-mémoire texte, voir
 * `useModifierEmplacementVehicule`). Zéro coordonnée, zéro SVG : un vendeur qui cherche une
 * voiture lit le nom de la zone, pas une carte.
 *
 * Zones triées alphabétiquement (locale FR, cohérent avec le tri des emplacements saisis
 * librement) ; `SANS_EMPLACEMENT` — véhicules jamais placés, le cœur du symptôme de l'issue —
 * TOUJOURS EN DERNIER et jamais fondu dans le tri alphabétique (un garage doit d'abord voir ses
 * zones connues, l'angle mort ensuite, pas alphabétisé au hasard selon son libellé de traduction).
 */

const CLE_SANS_EMPLACEMENT = Symbol('sans-emplacement');

interface Groupe {
  readonly cle: string | typeof CLE_SANS_EMPLACEMENT;
  readonly libelle: string | null;
  readonly vehicules: readonly VehiculeStockResume[];
}

/** Pure, testée isolément — aucune dépendance à i18n ou au DOM. */
export function grouperVehiculesParEmplacement(
  vehiculesStock: readonly VehiculeStockResume[],
): readonly Groupe[] {
  const parZone = new Map<string, VehiculeStockResume[]>();
  const sansEmplacement: VehiculeStockResume[] = [];

  for (const ligne of vehiculesStock) {
    const brut = ligne.vehicule.emplacementLibre?.trim();
    if (!brut) {
      sansEmplacement.push(ligne);
      continue;
    }
    const liste = parZone.get(brut);
    if (liste) {
      liste.push(ligne);
    } else {
      parZone.set(brut, [ligne]);
    }
  }

  const zonesNommees: Groupe[] = [...parZone.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([libelle, vehicules]) => ({ cle: libelle, libelle, vehicules }));

  return sansEmplacement.length > 0
    ? [...zonesNommees, { cle: CLE_SANS_EMPLACEMENT, libelle: null, vehicules: sansEmplacement }]
    : zonesNommees;
}

interface Props {
  readonly vehiculesStock: readonly VehiculeStockResume[];
  readonly onOuvrirVehicule: (id: string) => void;
  readonly libelleOuvrirVehicule: (vehicule: VehiculeStockResume) => string;
  /** État vide de l'écran (recherche/filtre/premier usage) — même contenu que la vue Liste,
   *  calculé par l'appelant (`EcranListeVehiculesStock`), pas dupliqué ici. */
  readonly contenuVide: ReactNode;
}

export function PlanParcVehicules({
  vehiculesStock,
  onOuvrirVehicule,
  libelleOuvrirVehicule,
  contenuVide,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun']);

  if (vehiculesStock.length === 0) {
    return <>{contenuVide}</>;
  }

  const groupes = grouperVehiculesParEmplacement(vehiculesStock);

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      role="list"
      aria-label={t('ventes:stock.liste.plan.groupeLabel')}
    >
      {groupes.map((groupe) => {
        const libelleZone =
          groupe.cle === CLE_SANS_EMPLACEMENT
            ? t('ventes:stock.liste.plan.sansEmplacement')
            : (groupe.libelle ?? '');
        return (
          <section
            key={groupe.cle === CLE_SANS_EMPLACEMENT ? '__sans_emplacement__' : groupe.cle}
            role="listitem"
            className="flex flex-col gap-2 rounded-lg border bg-card p-3"
            aria-label={libelleZone}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="texte-corps font-semibold text-foreground">{libelleZone}</h3>
              <span className="texte-libelle text-muted-foreground tabular-nums">
                {t('ventes:stock.liste.plan.nombreVehicules', {
                  count: groupe.vehicules.length,
                })}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {groupe.vehicules.map((ligne) => (
                <button
                  key={ligne.id}
                  type="button"
                  onClick={() => onOuvrirVehicule(ligne.id)}
                  aria-label={libelleOuvrirVehicule(ligne)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-left transition-colors hover:border-primary anneau-focus"
                >
                  <IdentiteVehicule vehicule={ligne.vehicule} taillePlaque="sm" />
                  <BadgeStatutVehiculeStock statut={ligne.statutCommercial} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
