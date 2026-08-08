import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import {
  schemaActionCloturerDossierVente,
  schemaActionMarquerPretALivrer,
  schemaActionPreparer,
  type ActionDossierVente,
  type ReponseDossierVente,
} from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { ActionPrimaire } from '@/composants/layout/ActionPrimaire';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import {
  useCloturerDossierVente,
  useMarquerDossierPretALivrer,
  usePreparerDossierVente,
} from '@/hooks/ventes/dossiers/useTransitionsDossierVente';
import { formaterDate, formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutDossierVente } from './BadgeStatutDossierVente';
import { selectionnerPrixDossierVente } from './utils';

interface Props {
  readonly dossier: ReponseDossierVente;
  readonly peutAssignerVehicule: boolean;
  readonly onAssignerVehicule: () => void;
}

// Lot C (`docs/plan-refonte-navigation.md`) — sous-ensemble de `ACTIONS_DOSSIER_VENTE` que cet
// en-tête peut proposer comme action PRIMAIRE sans dupliquer le formulaire complet de
// `PanneauActionsDossierVente` (hors périmètre de ce lot, fiche-hors-en-tête) : `preparer`,
// `marquer_pret_a_livrer` et `cloturer` n'y prennent AUCUN champ (même confirmation nue que
// `PanneauActionsDossierVente`, `ventes:dossier.transitions.confirmerAction`/`cloturerDescription`,
// mêmes hooks de mutation qu'elle) — `engager` (bon de commande + pièce d'identité) et `livrer`
// (date + kilométrage) exigent une saisie que ce lot ne reproduit pas ici : signalé, ces deux états
// n'affichent donc aucune action primaire dans ce lot (l'écran garde `PanneauActionsDossierVente`,
// inchangé, pour les couvrir).
const ACTIONS_PRIMAIRES_SIMPLES = ['preparer', 'marquer_pret_a_livrer', 'cloturer'] as const;
type ActionPrimaireSimple = (typeof ACTIONS_PRIMAIRES_SIMPLES)[number];

const CLES_ACTION_PRIMAIRE_SIMPLE: Record<ActionPrimaireSimple, string> = {
  preparer: 'preparer',
  marquer_pret_a_livrer: 'marquerPretALivrer',
  cloturer: 'cloturer',
};

function estActionPrimaireSimple(action: ActionDossierVente): action is ActionPrimaireSimple {
  return (ACTIONS_PRIMAIRES_SIMPLES as readonly ActionDossierVente[]).includes(action);
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
 */
export function EnTeteDossierVente({ dossier, peutAssignerVehicule, onAssignerVehicule }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'navigation']);
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

  // Lot C — action primaire. Priorité 1 : aucun véhicule assigné, c'est la seule chose qui compte
  // tant que ce n'est pas fait (même geste que l'encart d'assignation ci-dessous, déplacé ici en
  // emplacement constant). Priorité 2 : la première transition SIMPLE disponible parmi
  // `dossier.actionsDisponibles` (même signal serveur que `PanneauActionsDossierVente`, non
  // deviné ici).
  const peutAssignerMaintenant = !vehiculeStock && peutAssignerVehicule;
  const actionPrimaireSimple = peutAssignerMaintenant
    ? null
    : (dossier.actionsDisponibles.find(estActionPrimaireSimple) ?? null);

  const preparer = usePreparerDossierVente(dossier.id);
  const marquerPretALivrer = useMarquerDossierPretALivrer(dossier.id);
  const cloturer = useCloturerDossierVente(dossier.id);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const mutationPrimaire =
    actionPrimaireSimple === 'preparer'
      ? preparer
      : actionPrimaireSimple === 'marquer_pret_a_livrer'
        ? marquerPretALivrer
        : actionPrimaireSimple === 'cloturer'
          ? cloturer
          : null;
  const erreurPrimaire =
    mutationPrimaire?.error instanceof ErreurApi ? mutationPrimaire.error : null;
  const libelleActionPrimaire = actionPrimaireSimple
    ? t(`ventes:dossier.transitions.${CLES_ACTION_PRIMAIRE_SIMPLE[actionPrimaireSimple]}`)
    : '';

  function confirmerActionPrimaire() {
    if (!actionPrimaireSimple || !mutationPrimaire) return;
    const schema =
      actionPrimaireSimple === 'preparer'
        ? schemaActionPreparer
        : actionPrimaireSimple === 'marquer_pret_a_livrer'
          ? schemaActionMarquerPretALivrer
          : schemaActionCloturerDossierVente;
    const resultat = schema.safeParse({});
    if (!resultat.success) return;
    // Même cast délibéré et borné à cette ligne que `PanneauActionsDossierVente::soumettre` :
    // router l'une des trois transitions simples vers sa mutation typée dépasse ce que TypeScript
    // peut vérifier sans dupliquer trois fois ce bloc.
    (mutationPrimaire.mutate as (valeur: unknown, options?: { onSuccess?: () => void }) => void)(
      resultat.data,
      { onSuccess: () => setConfirmationOuverte(false) },
    );
  }

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
          ) : actionPrimaireSimple ? (
            <ActionPrimaire>
              <Button
                type="button"
                variant="default"
                // Distinct de `PanneauActionsDossierVente` (même libellé visible, rendu juste en
                // dessous de cet en-tête — WCAG 2.5.3, même doctrine que `EnTeteOrdreReparation`
                // pour « Facturer ») : les deux DÉCLENCHENT la même transition, celui-ci est
                // seulement mis en avant.
                aria-label={t('navigation:actionPrimaire.aria', { action: libelleActionPrimaire })}
                onClick={() => setConfirmationOuverte(true)}
              >
                {libelleActionPrimaire}
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

        {erreurPrimaire ? (
          <p role="alert" className="texte-libelle text-destructive">
            {messageErreur(erreurPrimaire, t)}
          </p>
        ) : null}
      </CardContent>

      {actionPrimaireSimple ? (
        <AvertissementConfirmable
          ouvert={confirmationOuverte}
          onOuvertChange={setConfirmationOuverte}
          titre={libelleActionPrimaire}
          description={
            actionPrimaireSimple === 'cloturer'
              ? t('ventes:dossier.transitions.cloturerDescription')
              : t('ventes:dossier.transitions.confirmerAction')
          }
          libelleConfirmation={t('ventes:dossier.transitions.confirmer')}
          onConfirmer={confirmerActionPrimaire}
          enCours={mutationPrimaire?.isPending}
        />
      ) : null}
    </Card>
  );
}
