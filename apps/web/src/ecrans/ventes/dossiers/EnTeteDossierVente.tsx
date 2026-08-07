import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ReponseDossierVente } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { formaterDate, formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutDossierVente } from './BadgeStatutDossierVente';
import { selectionnerPrixDossierVente } from './utils';

interface Props {
  readonly dossier: ReponseDossierVente;
  readonly peutAssignerVehicule: boolean;
  readonly onAssignerVehicule: () => void;
}

/**
 * En-tête de fiche dossier de vente (design §7.1), sur le modèle de `EnTeteOrdreReparation` :
 * statut + identités (acheteur, facturé si différent — RV-40/RV-41 — conducteur si différent) +
 * véhicule (ou encart d'assignation) + prix DÉRIVÉ (jamais recalculé, voir `utils.ts`) +
 * date de livraison estimée.
 *
 * `dossier` ne porte aucun numéro court identifiable à l'oral (contrairement à `or.numero`) — écart
 * du contrat lui-même (§13 question 1 du design), pas une omission de cet écran : le titre
 * s'appuie donc sur client + véhicule.
 */
export function EnTeteDossierVente({ dossier, peutAssignerVehicule, onAssignerVehicule }: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const prix = selectionnerPrixDossierVente(dossier.documents);
  const vehiculeStock = dossier.vehicule;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <BadgeStatutDossierVente statut={dossier.statut} />
        </div>

        <div className="flex flex-col gap-1">
          {/* Lot B (correction 6, vendeur) — bloc identité cliquable vers la fiche client, sur le
           *  modèle du lien inverse déjà fonctionnel d'`EcranFicheVehiculeStock.tsx` (§ commentaire
           *  de tête de ce fichier), adapté ici à `IdentiteClient.onClick` (nouveau, voir
           *  `composants/identite/IdentiteClient.tsx`) plutôt qu'à un `<Link>` séparé à côté. */}
          <IdentiteClient
            client={dossier.clientAcheteur}
            onClick={() => navigate(chemins.clients.detail(dossier.clientAcheteur.id, site))}
          />
          {dossier.clientFacture.id !== dossier.clientAcheteur.id ? (
            <p className="texte-libelle text-muted-foreground">
              {t('ventes:dossier.fiche.factureA', { nom: dossier.clientFacture.nomAffiche })}
            </p>
          ) : null}
          {dossier.clientConducteur && dossier.clientConducteur.id !== dossier.clientAcheteur.id ? (
            <p className="texte-libelle text-muted-foreground">
              {t('ventes:dossier.fiche.conducteur', { nom: dossier.clientConducteur.nomAffiche })}
            </p>
          ) : null}
        </div>

        {vehiculeStock ? (
          <IdentiteVehicule
            vehicule={vehiculeStock.vehicule}
            taillePlaque="xl"
            // `VehiculeStockResume.id` EST l'identifiant du véhicule (même enregistrement étendu,
            // pas un second objet — voir ARCHITECTURE.md et le commentaire de tête
            // d'`EcranFicheVehiculeStock.tsx`, qui navigue déjà vers `chemins.vehicules.detail(stock.id, …)`
            // avec ce même id).
            onClick={() => navigate(chemins.vehicules.detail(vehiculeStock.id, site))}
          />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
            <span className="texte-corps text-muted-foreground">
              {t('ventes:dossier.fiche.aucunVehicule')}
            </span>
            {peutAssignerVehicule ? (
              <Button variant="outline" size="sm" onClick={onAssignerVehicule}>
                {t('ventes:dossier.fiche.assignerVehicule')}
              </Button>
            ) : null}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 texte-corps sm:grid-cols-3">
          <dt className="text-muted-foreground">{t('ventes:dossier.fiche.prix')}</dt>
          <dd className="col-span-2 sm:col-span-1">
            {prix.statut === 'aucun' ? (
              <span className="text-muted-foreground">{t('ventes:dossier.fiche.prixAucun')}</span>
            ) : prix.document.totalTtcCentimes === undefined ? null : prix.statut ===
              'indicatif' ? (
              <span className="text-muted-foreground">
                {t('ventes:dossier.fiche.prixIndicatif', {
                  montant: formaterMontant(prix.document.totalTtcCentimes),
                })}
              </span>
            ) : (
              <span className="texte-donnee-proeminente">
                {formaterMontant(prix.document.totalTtcCentimes)}
              </span>
            )}
          </dd>

          <dt className="text-muted-foreground">
            {t('ventes:dossier.fiche.dateLivraisonEstimee')}
          </dt>
          <dd className="col-span-2 sm:col-span-1">
            {dossier.dateLivraisonEstimee ? formaterDate(dossier.dateLivraisonEstimee) : ''}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
