import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClientResume, ReponseDossierVente, VehiculeStockResume } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { useModifierDossierVente } from '@/hooks/ventes/dossiers/useModifierDossierVente';

import { SelecteurClientDossier } from './SelecteurClientDossier';
import { SelecteurVehiculeStockDossier } from './SelecteurVehiculeStockDossier';

interface Props {
  readonly dossier: ReponseDossierVente;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
}

/**
 * `PATCH /dossiers-vente/{id}` — champs LIBRES uniquement (RV-30, RV-40, RV-41), jamais un statut
 * (les transitions vivent dans `PanneauActionsDossierVente`). Réassignation du véhicule proposée
 * UNIQUEMENT en `prospection` (`409 VENTE_DOSSIER_TRANSITION_INTERDITE` sinon, RV-32 verrouille le
 * véhicule dès `engager`) — même discipline optimiste que `PATCH /ordres-reparation/{id}` :
 * `If-Match` construit depuis `dossier.version`.
 */
export function DialogueModifierDossierVente({ dossier, ouvert, onOuvertChange }: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const mutation = useModifierDossierVente();

  const [clientFacture, setClientFacture] = useState<ClientResume | null>(dossier.clientFacture);
  const [clientConducteur, setClientConducteur] = useState<ClientResume | null>(
    dossier.clientConducteur,
  );
  const [vehicule, setVehicule] = useState<VehiculeStockResume | null>(dossier.vehicule);
  const [dateLivraisonEstimee, setDateLivraisonEstimee] = useState(
    dossier.dateLivraisonEstimee ?? '',
  );

  const peutReassignerVehicule = dossier.statut === 'prospection';

  useEffect(() => {
    if (!ouvert) return;
    setClientFacture(dossier.clientFacture);
    setClientConducteur(dossier.clientConducteur);
    setVehicule(dossier.vehicule);
    setDateLivraisonEstimee(dossier.dateLivraisonEstimee ?? '');
    mutation.reset();
    // Réinitialise à CHAQUE ouverture (pas seulement au montage) : la même instance de dialog est
    // réutilisée par plusieurs points d'entrée (bouton « assigner un véhicule », bouton
    // « modifier ») sans être démontée entre deux ouvertures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  function soumettre() {
    mutation.mutate(
      {
        id: dossier.id,
        etag: `W/"${dossier.version}"`,
        entree: {
          // `null` explicite (jamais `undefined`) dès que la valeur affichée est résolue : ce
          // dialog montre l'état COURANT, une valeur retirée par l'utilisateur doit donc revenir
          // au défaut serveur (= acheteur), pas rester inchangée silencieusement.
          clientFactureId:
            clientFacture === null || clientFacture.id === dossier.clientAcheteur.id
              ? null
              : clientFacture.id,
          clientConducteurId:
            clientConducteur === null || clientConducteur.id === dossier.clientAcheteur.id
              ? null
              : clientConducteur.id,
          vehiculeId: peutReassignerVehicule ? (vehicule?.id ?? null) : undefined,
          dateLivraisonEstimee: dateLivraisonEstimee.trim() === '' ? null : dateLivraisonEstimee,
        },
      },
      { onSuccess: () => onOuvertChange(false) },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('ventes:dossier.fiche.modifier.titre')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {mutation.error instanceof ErreurApi ? (
            <RefusBloquant
              code={mutation.error.probleme.code}
              blocages={mutation.error.blocages}
              actionsProposees={mutation.error.actionsProposees}
            />
          ) : mutation.isError ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreur(mutation.error, t)}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label>{t('ventes:dossier.fiche.modifier.vehicule')}</Label>
            {!peutReassignerVehicule ? (
              <p className="texte-libelle text-muted-foreground">
                {t('ventes:dossier.fiche.modifier.vehiculeVerrouille')}
              </p>
            ) : vehicule ? (
              <div className="flex items-center justify-between gap-3 rounded-md border p-2">
                <IdentiteVehicule vehicule={vehicule.vehicule} />
                <Button variant="ghost" size="sm" onClick={() => setVehicule(null)}>
                  {t('commun:actions.modifier')}
                </Button>
              </div>
            ) : (
              <SelecteurVehiculeStockDossier
                valeur={null}
                onChangeValeur={(_id, v) => setVehicule(v)}
                libelle={t('ventes:dossier.fiche.modifier.vehicule')}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('ventes:dossier.nouveau.clientFacture.titre')}</Label>
            {clientFacture ? (
              <div className="flex items-center justify-between gap-3 rounded-md border p-2">
                <IdentiteClient client={clientFacture} />
                <Button variant="ghost" size="sm" onClick={() => setClientFacture(null)}>
                  {t('commun:actions.modifier')}
                </Button>
              </div>
            ) : (
              <SelecteurClientDossier
                valeur={null}
                onChangeValeur={(_id, client) => setClientFacture(client)}
                libelle={t('ventes:dossier.nouveau.clientFacture.titre')}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('ventes:dossier.nouveau.clientConducteur.titre')}</Label>
            {clientConducteur ? (
              <div className="flex items-center justify-between gap-3 rounded-md border p-2">
                <IdentiteClient client={clientConducteur} />
                <Button variant="ghost" size="sm" onClick={() => setClientConducteur(null)}>
                  {t('commun:actions.modifier')}
                </Button>
              </div>
            ) : (
              <SelecteurClientDossier
                valeur={null}
                onChangeValeur={(_id, client) => setClientConducteur(client)}
                libelle={t('ventes:dossier.nouveau.clientConducteur.titre')}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dossier-vente-modifier-date-livraison">
              {t('ventes:dossier.nouveau.dateLivraisonEstimee')}
            </Label>
            <Input
              id="dossier-vente-modifier-date-livraison"
              type="date"
              value={dateLivraisonEstimee}
              onChange={(evenement) => setDateLivraisonEstimee(evenement.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('commun:actions.annuler')}</Button>
          </DialogClose>
          <Button disabled={mutation.isPending} onClick={soumettre}>
            {t('commun:actions.enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
