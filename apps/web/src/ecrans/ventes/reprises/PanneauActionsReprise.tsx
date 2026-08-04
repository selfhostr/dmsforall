import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaActionConfirmerReprise,
  schemaActionNegocierReprise,
  schemaActionRefuserReprise,
  type ActionReprise,
  type CodeConfirmation,
  type ReponseReprise,
  type RoleUtilisateur,
} from '@dfa/shared';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import {
  useConfirmerReprise,
  useNegocierReprise,
  useRefuserReprise,
} from '@/hooks/ventes/reprises/useTransitionsReprise';

import { peutConfirmerReprise, peutEcrireReprise, peutRefuserReprise } from './droits';

interface Props {
  readonly dossierVenteId: string;
  readonly reprise: ReponseReprise;
  readonly role: RoleUtilisateur | undefined;
  readonly onModifier: () => void;
  /** Voir `CarteReprise` : appelé après CHAQUE mutation réussie (négocier/confirmer/refuser) pour
   *  que l'intégrateur (fiche dossier) puisse invalider son propre `dossier.reprise` embarqué. */
  readonly onMutationReussie?: () => void;
}

type ActionOuverte = 'negocier' | 'confirmer' | 'refuser' | null;

const CLES_ACTION: Partial<Record<ActionReprise, string>> = {
  negocier: 'negocier',
  confirmer: 'confirmer',
  refuser: 'refuser',
};

/**
 * Actions de la reprise (§8.4 du design) — un bouton par valeur de `reprise.actionsDisponibles`
 * (jamais devinée depuis `statut`), même patron que `PanneauActionsOr.tsx` : dialog de
 * confirmation, jamais d'exécution directe, erreur affichée DANS le dialog encore ouvert (§4).
 *
 * `modifier` n'est PAS une action de ce panneau (c'est un `PATCH`, pas une transition d'état) —
 * elle ouvre le formulaire porté par l'appelant (`onModifier`), même découpe que
 * `EcranFicheArticle`/`EnTeteFicheArticle`.
 *
 * `confirmer` — correction exceptionnelle (§8.4 : « normalement un effet de bord de `engager` ») —
 * reléguée dans un menu secondaire « Actions de correction », jamais dans la rangée principale.
 */
export function PanneauActionsReprise({
  dossierVenteId,
  reprise,
  role,
  // TODO(ventes) : pas encore câblé sur un élément du panneau — voir la découverte remontée à
  // l'équipe Ventes (comparer `EnTeteFicheArticle.tsx`, qui câble le même contrat sur un
  // `DropdownMenuItem`). Prop publique conservée telle quelle, seule la variable locale est
  // renommée pour ne pas masquer un vrai oubli avec un `_onModifier` silencieux.
  onModifier: _onModifier,
  onMutationReussie,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs', 'validation']);
  const [actionOuverte, setActionOuverte] = useState<ActionOuverte>(null);
  const [valeurNegocieeCentimes, setValeurNegocieeCentimes] = useState<number | null>(null);
  const [motif, setMotif] = useState('');
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  const [derniereEntree, setDerniereEntree] = useState<object | null>(null);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const negocier = useNegocierReprise(dossierVenteId);
  const confirmer = useConfirmerReprise(dossierVenteId);
  const refuser = useRefuserReprise(dossierVenteId);

  function fermer() {
    setActionOuverte(null);
    setValeurNegocieeCentimes(null);
    setMotif('');
    setErreurValidation(null);
    setDerniereEntree(null);
    setConfirmationOuverte(false);
  }

  const mutationActive =
    actionOuverte === 'negocier'
      ? negocier
      : actionOuverte === 'confirmer'
        ? confirmer
        : actionOuverte === 'refuser'
          ? refuser
          : null;

  const erreurActive = mutationActive?.error instanceof ErreurApi ? mutationActive.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(entree: object) {
    if (!actionOuverte || !mutationActive) return;
    setDerniereEntree(entree);
    (mutationActive.mutate as (valeur: unknown, options?: { onSuccess?: () => void }) => void)(
      entree,
      {
        onSuccess: () => {
          fermer();
          onMutationReussie?.();
        },
      },
    );
  }

  function resoumettreAvecConfirmations(confirmations: readonly CodeConfirmation[]) {
    if (!derniereEntree) return;
    setConfirmationOuverte(false);
    soumettre({ ...derniereEntree, confirmations });
  }

  const actionsPrincipales = reprise.actionsDisponibles.filter(
    (action): action is 'negocier' | 'refuser' => action === 'negocier' || action === 'refuser',
  );
  const peutCorriger =
    reprise.actionsDisponibles.includes('confirmer') && peutConfirmerReprise(role);
  const peutEcrire = peutEcrireReprise(role);
  const peutRefuser = peutRefuserReprise(role);

  // Titre du dialog : phrase complète dédiée par action (`ventes:reprise.<action>.titre`),
  // distincte du libellé court du bouton/menu (`ventes:reprise.actions.<action>`).
  const titreDialogue =
    actionOuverte === 'negocier'
      ? t('ventes:reprise.negocier.titre')
      : actionOuverte === 'confirmer'
        ? t('ventes:reprise.confirmer.titre')
        : actionOuverte === 'refuser'
          ? t('ventes:reprise.refuser.titre')
          : '';

  if (actionsPrincipales.length === 0 && !peutCorriger) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('ventes:reprise.titre')}>
        {actionsPrincipales.map((action) => {
          if (action === 'negocier' && !peutEcrire) return null;
          if (action === 'refuser' && !peutRefuser) return null;
          const cle = CLES_ACTION[action];
          if (!cle) return null;
          return (
            <Button
              key={action}
              type="button"
              variant={action === 'refuser' ? 'outline' : 'default'}
              onClick={() => setActionOuverte(action)}
            >
              {t(`ventes:reprise.actions.${cle}`)}
            </Button>
          );
        })}

        {peutCorriger ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                {t('ventes:reprise.actions.correctionMenu')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setActionOuverte('confirmer')}>
                {t('ventes:reprise.actions.confirmer')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <Dialog
        open={actionOuverte !== null}
        onOpenChange={(ouvert) => (ouvert ? undefined : fermer())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titreDialogue}</DialogTitle>
          </DialogHeader>

          {erreurActive && confirmationsRequises.length === 0 ? (
            <RefusBloquant
              code={erreurActive.probleme.code}
              blocages={erreurActive.blocages}
              actionsProposees={erreurActive.actionsProposees}
              estTerminal={reprise.statut === 'confirmee' || reprise.statut === 'refusee'}
            />
          ) : null}

          {confirmationsRequises.length > 0 ? (
            <div
              role="alert"
              className="rounded-md border border-statut-attention/40 bg-statut-attention/10 p-3"
            >
              <p className="texte-corps text-statut-attention">
                {erreurActive ? messageErreur(erreurActive, t) : ''}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                onClick={() => setConfirmationOuverte(true)}
              >
                {t('commun:actions.continuerQuandMeme')}
              </Button>
            </div>
          ) : null}

          {actionOuverte === 'negocier' ? (
            <div className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">
                {t('ventes:reprise.negocier.aide')}
              </p>
              <ChampMontant
                label={t('ventes:reprise.negocier.champValeurNegociee')}
                obligatoire
                valeurCentimes={valeurNegocieeCentimes}
                onChangeCentimes={setValeurNegocieeCentimes}
              />
              {erreurValidation ? (
                <p className="texte-libelle text-destructive">{erreurValidation}</p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionNegocierReprise.safeParse({
                      valeurNegocieeCentimes,
                    });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('commun:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'refuser' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reprise-action-motif-refus">
                  {t('ventes:reprise.refuser.motifLabel')}
                </Label>
                <Textarea
                  id="reprise-action-motif-refus"
                  placeholder={t('ventes:reprise.refuser.motifPlaceholder')}
                  value={motif}
                  onChange={(evenement) => setMotif(evenement.target.value)}
                />
                {erreurValidation ? (
                  <p className="texte-libelle text-destructive">{erreurValidation}</p>
                ) : null}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionRefuserReprise.safeParse({ motif });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('commun:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'confirmer' ? (
            <div className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">
                {t('ventes:reprise.confirmer.aide')}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reprise-action-motif-confirmer">
                  {t('ventes:reprise.confirmer.motifLabel')}
                </Label>
                <Textarea
                  id="reprise-action-motif-confirmer"
                  value={motif}
                  onChange={(evenement) => setMotif(evenement.target.value)}
                />
                {erreurValidation ? (
                  <p className="texte-libelle text-destructive">{erreurValidation}</p>
                ) : null}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionConfirmerReprise.safeParse({ motif });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('commun:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AvertissementConfirmable
        ouvert={confirmationOuverte}
        onOuvertChange={setConfirmationOuverte}
        titre={titreDialogue}
        description={erreurActive ? messageErreur(erreurActive, t) : ''}
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() => resoumettreAvecConfirmations(confirmationsRequises)}
        enCours={mutationActive?.isPending}
      />
    </>
  );
}
