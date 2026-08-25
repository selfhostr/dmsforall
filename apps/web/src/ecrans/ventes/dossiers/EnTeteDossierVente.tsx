import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { type ReponseDossierVente } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { ActionPrimaire } from '@/composants/layout/ActionPrimaire';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
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
 * fil d'Ariane contextuel (Lot C) + statut + action primaire (Lot C) + identités (acheteur,
 * facturé si différent — RV-40/RV-41 — conducteur si différent) + véhicule (ou encart
 * d'assignation) + prix DÉRIVÉ (jamais recalculé, voir `utils.ts`) + date de livraison estimée.
 *
 * `dossier` ne porte aucun numéro court identifiable à l'oral (contrairement à `or.numero`) — écart
 * du contrat lui-même (§13 question 1 du design), pas une omission de cet écran : le titre
 * s'appuie donc sur client + véhicule, et le fil d'Ariane clôt sur un libellé générique plutôt
 * qu'un numéro qui n'existe pas.
 *
 * Doublon supprimé (chantier réduction de densité, 24.08.2026) : cet en-tête proposait jusqu'ici sa
 * PROPRE copie en couleur de `preparer`/`marquer_pret_a_livrer`/`cloturer` — même transition, même
 * libellé, que `PanneauActionsDossierVente` rendait déjà juste en dessous sur ce même écran (voir le
 * commentaire de tête de `composants/motifs/GabaritEcran.tsx`, « deux commandes vers la même
 * destination sur le même écran »). `PanneauActionsDossierVente` reste désormais le SEUL point
 * d'entrée des transitions de statut ; la seule action PRIMAIRE que cet en-tête garde est
 * « Assigner un véhicule », qui n'a pas d'équivalent ailleurs sur l'écran.
 */
export function EnTeteDossierVente({ dossier, peutAssignerVehicule, onAssignerVehicule }: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const prix = selectionnerPrixDossierVente(dossier.documents);
  const vehiculeStock = dossier.vehicule;

  // Lot C — fil d'Ariane contextuel (client › véhicule › dossier), mêmes cibles que les blocs
  // identité cliquables ci-dessous (Lot B).
  const segmentsFilAriane: SegmentFilAriane[] = [
    {
      cle: 'client',
      libelle: dossier.clientAcheteur.nomAffiche,
      href: chemins.clients.detail(dossier.clientAcheteur.id, site),
    },
  ];
  if (vehiculeStock) {
    const { canton, plaque, designation } = vehiculeStock.vehicule;
    const plaqueTexte = plaque ? `${canton ? `${canton} ` : ''}${plaque}` : null;
    const libelleVehicule = plaqueTexte ? `${plaqueTexte} · ${designation}` : designation;
    segmentsFilAriane.push({
      cle: 'vehicule',
      libelle: libelleVehicule,
      href: chemins.vehicules.detail(vehiculeStock.id, site),
    });
  }

  // Lot C — action primaire de cet en-tête : « Assigner un véhicule » tant qu'aucun n'est assigné,
  // même geste que l'encart d'assignation ci-dessous, déplacé ici en emplacement constant. Les
  // transitions de statut (`preparer`/`marquer_pret_a_livrer`/`cloturer`/…) ne sont plus dupliquées
  // ici — voir le commentaire de tête du composant : `PanneauActionsDossierVente` en est désormais
  // le SEUL point d'entrée.
  const peutAssignerMaintenant = !vehiculeStock && peutAssignerVehicule;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <FilAriane segments={segmentsFilAriane} pageCourante={t('ventes:dossier.fiche.titre')} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <BadgeStatutDossierVente statut={dossier.statut} />
          {peutAssignerMaintenant ? (
            <ActionPrimaire>
              <Button type="button" variant="default" onClick={onAssignerVehicule}>
                {t('ventes:dossier.fiche.assignerVehicule')}
              </Button>
            </ActionPrimaire>
          ) : null}
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
          <div className="rounded-md border border-dashed p-3">
            <span className="texte-corps text-muted-foreground">
              {t('ventes:dossier.fiche.aucunVehicule')}
            </span>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 texte-corps sm:grid-cols-3">
          <dt className="text-muted-foreground">{t('ventes:dossier.fiche.prix')}</dt>
          <dd className="col-span-2 sm:col-span-1">
            {/* Trois rendus visuellement distincts (jamais interchangeables, voir `utils.ts`) :
             *  - `aucun` -> texte muet, ne ressemble à aucun montant (ni chiffre ni devise) ;
             *  - `undefined` (rôle masqué, montant existant mais illisible pour ce rôle) -> `null`,
             *    RIEN n'est rendu — surtout pas un texte qui pourrait se lire comme « pas de prix » ;
             *  - `indicatif` -> montant réel, mais atténué + préfixé, jamais confondu avec un engagé ;
             *  - `engage` -> seul cas en texte proéminent, le seul qui affirme un prix ferme. */}
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
