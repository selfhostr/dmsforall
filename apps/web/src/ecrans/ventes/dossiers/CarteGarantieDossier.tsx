import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { SuiviGarantie } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { chemins } from '@/routes/chemins';

import { CelluleGarantieSuivi } from '../suivi/CelluleGarantieSuivi';

interface Props {
  /** `ReponseDossierVente.garantie` — `null` = pas de véhicule associé (ce composant n'est alors
   *  pas rendu du tout, voir `EcranFicheDossierVente.tsx`) ou véhicule associé sans
   *  `garantieDebut` renseigné (rendu ICI, distinct d'une garantie échue — voir
   *  `CelluleGarantieSuivi`). */
  readonly garantie: SuiviGarantie | null;
  /** `dossier.vehicule.id` (`= vehicule.id`, RV-01) — présence du véhicule déjà garantie par
   *  l'appelant avant de rendre cette carte. */
  readonly vehiculeStockId: string;
  readonly site?: string;
}

/**
 * Carte « Garantie » (constructeur, RM-33) de la fiche dossier de vente — jusqu'ici absente de
 * cette fiche (aucune section, ni consultation ni saisie), alors même que `vehicule.garantieDebut`/
 * `garantieMois`/`garantieKm` existent en base depuis `migrations/0007_vehicules.sql` (étape 1) et
 * sont déjà exploités par `GET /ventes/suivi`. Réutilise `CelluleGarantieSuivi` (`ecrans/ventes/
 * suivi/`) pour le corps — MÊME fonction serveur (`construireSuiviGarantie`), mêmes trois rendus
 * distincts (garantie inconnue ≠ garantie active ≠ garantie échue, jamais confondus, voir son
 * en-tête), plutôt qu'une seconde présentation qui pourrait diverger de celle déjà affichée sur
 * l'écran de suivi pour le MÊME dossier.
 *
 * Écriture DÉLIBÉRÉMENT absente ici : la garantie est un attribut du VÉHICULE lui-même (`PATCH
 * /vehicules/{id}`, droit `vehicule.modifier`), pas du dossier de vente — même doctrine que
 * `DialogueGarantieVehiculeStock` (`ecrans/ventes/stock/_composants/`), qui la sépare déjà
 * explicitement de la fiche de coût stock. Cette carte pointe vers la fiche du véhicule en stock
 * plutôt que de dupliquer un second formulaire de saisie avec sa propre notion de droit.
 */
export function CarteGarantieDossier({ garantie, vehiculeStockId, site }: Props) {
  const { t } = useTranslation('ventes');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('ventes:dossier.fiche.garantie.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CelluleGarantieSuivi garantie={garantie} />
        <Link
          to={chemins.ventes.stock.detail(vehiculeStockId, site)}
          className="w-fit texte-libelle text-primary underline-offset-2 hover:underline"
        >
          {t('ventes:dossier.fiche.garantie.gererSurFicheVehicule')}
        </Link>
      </CardContent>
    </Card>
  );
}
