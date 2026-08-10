import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaActionConfirmerFinancement,
  schemaActionRefuserFinancement,
  type CodeConfirmation,
  type FinancementResume,
  type ReponseFinancement,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import {
  useConfirmerFinancement,
  useRefuserFinancement,
} from '@/hooks/ventes/financements/useTransitionsFinancement';

import { peutConfirmerOuRefuserFinancement } from './droits';

interface Props {
  readonly dossierVenteId: string;
  readonly financement: FinancementResume;
  readonly role: RoleUtilisateur | undefined;
  /** Appelé après toute mutation réussie — signal générique pour que l'intégrateur recharge sa
   *  requête dossier (voir l'en-tête de `CarteFinancement`). */
  readonly onMutationReussie?: () => void;
  /** Appelé avec le `ReponseFinancement` COMPLET renvoyé par `confirmer`/`refuser` — seule source
   *  de `motifRefus`/dates pour CETTE session (voir l'ÉCART SIGNALÉ dans `CarteFinancement`,
   *  `FinancementResume` ne les porte pas). */
  readonly onSucces?: (financement: ReponseFinancement) => void;
}

type ActionOuverte = 'confirmer' | 'refuser' | null;

/**
 * Actions `confirmer`/`refuser` d'UN financement (§9.3 du design) — visibles UNIQUEMENT sur
 * l'entrée `en_attente` (la machine à états du financement n'a qu'un seul état non terminal,
 * `ACTIONS_FINANCEMENT` = exactement ces deux verbes toujours valides en `en_attente`, jamais
 * ailleurs — exception délibérée à la doctrine « jamais déduire une action du statut seul »,
 * documentée dans le contrat lui-même). Même mécanique d'erreur inline que
 * `PanneauActionsReprise`/`PanneauActionsOr` (§4).
 */
export function PanneauActionsFinancement({
  dossierVenteId,
  financement,
  role,
  onMutationReussie,
  onSucces,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs', 'validation']);
  const [actionOuverte, setActionOuverte] = useState<ActionOuverte>(null);
  const [motif, setMotif] = useState('');
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  const [derniereEntree, setDerniereEntree] = useState<object | null>(null);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const confirmer = useConfirmerFinancement(dossierVenteId);
  const refuser = useRefuserFinancement(dossierVenteId);

  if (financement.statutConfirmation !== 'en_attente' || !peutConfirmerOuRefuserFinancement(role)) {
    return null;
  }

  function fermer() {
    setActionOuverte(null);
    setMotif('');
    setErreurValidation(null);
    setDerniereEntree(null);
    setConfirmationOuverte(false);
  }

  const mutationActive =
    actionOuverte === 'confirmer' ? confirmer : actionOuverte === 'refuser' ? refuser : null;
  const erreurActive = mutationActive?.error instanceof ErreurApi ? mutationActive.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(entree: object) {
    if (!actionOuverte || !mutationActive) return;
    setDerniereEntree(entree);
    (
      mutationActive.mutate as (
        valeur: { readonly financementId: string; readonly entree: object },
        options?: {
          onSuccess?: (reponse: { readonly donnees: ReponseFinancement }) => void;
        },
      ) => void
    )(
      { financementId: financement.id, entree },
      {
        onSuccess: (reponse) => {
          fermer();
          onSucces?.(reponse.donnees);
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

  const titreDialogue =
    actionOuverte === 'confirmer'
      ? t('ventes:financement.confirmer.titre')
      : actionOuverte === 'refuser'
        ? t('ventes:financement.refuser.titre')
        : '';

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setActionOuverte('confirmer')}>
          {t('ventes:financement.actions.confirmer')}
        </Button>
        <Button type="button" variant="outline" onClick={() => setActionOuverte('refuser')}>
          {t('ventes:financement.actions.refuser')}
        </Button>
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
            />
          ) : null}

          {confirmationsRequises.length > 0 ? (
            <div
              role="alert"
              className="rounded-md border border-statut-attention bg-statut-attention-fond p-3"
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

          {actionOuverte === 'confirmer' ? (
            <div className="flex flex-col gap-4">
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionConfirmerFinancement.safeParse({});
                    if (!resultat.success) return;
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
                <Label htmlFor="financement-action-motif">
                  {t('ventes:financement.refuser.motifLabel')}
                </Label>
                <Textarea
                  id="financement-action-motif"
                  placeholder={t('ventes:financement.refuser.motifPlaceholder')}
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
                    const resultat = schemaActionRefuserFinancement.safeParse({ motif });
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
