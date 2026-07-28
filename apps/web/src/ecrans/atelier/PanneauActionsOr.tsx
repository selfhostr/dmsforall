import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaActionAnnuler,
  schemaActionReceptionner,
  schemaActionRefuserControle,
  schemaActionReprendreTravaux,
  schemaActionRestituer,
  schemaActionRouvrir,
  schemaActionTerminer,
  type ActionOrdreReparation,
  type CodeConfirmation,
  type ReponseOrdreReparation,
} from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import {
  useAnnulerOr,
  useCloturerOr,
  useDemarrerOr,
  usePasserEnControleOr,
  useReceptionnerOr,
  useRefuserControleOr,
  useReprendreTravauxOr,
  useRestituerOr,
  useRouvrirOr,
  useTerminerOr,
  useValiderControleOr,
} from '@/hooks/atelier/useTransitionsOrdreReparation';
import { useSession } from '@/hooks/useSession';

/**
 * Barre d'actions de l'OR — LES actions réellement proposées par le serveur (`actionsDisponibles`,
 * §7.7), jamais une liste devinée depuis le statut : « une action affichée mais refusée à l'appel
 * est pire que pas d'action » (consigne de ce lot). Chaque clic ouvre une confirmation, jamais une
 * exécution directe au clic — comptoir/tablette, un fat-finger sur un OR n'a pas de undo.
 *
 * Les actions LIGNE (`valider-lignes`, `refuser-lignes`, `annuler-lignes`,
 * `soumettre-lignes-a-devis`) sont volontairement absentes : elles exigent une sélection de
 * lignes que `ListeLignesOrdreReparation` ne construit pas en v1 (lecture seule) — voir son
 * commentaire d'en-tête. Les ajouter reste additif.
 *
 * Refus (invariant n°8, §3.2/§3.4) : `RefusBloquant` inline, jamais un cul-de-sac muet. Une
 * `CONFIRMATION_REQUISE` (§4.4) réémet la même requête avec `confirmations[]` après accord
 * explicite (`AvertissementConfirmable`) — rare pour une transition (les codes de
 * `CODES_CONFIRMATION` visent surtout la création), mais le chemin existe pour rester honnête
 * avec le contrat.
 */

const ACTIONS_LIGNE: ReadonlySet<ActionOrdreReparation> = new Set([
  'valider-lignes',
  'refuser-lignes',
  'annuler-lignes',
  'soumettre-lignes-a-devis',
]);

// Segment d'action (kebab-case, contrat `ACTIONS_ORDRE_REPARATION`) -> suffixe camelCase de
// `or:transitions` — mapping non trivial (`passer-en-controle` -> `passerEnControle`), explicite
// comme partout ailleurs dans ce lot.
const CLES_TRANSITION: Partial<Record<ActionOrdreReparation, string>> = {
  receptionner: 'receptionner',
  demarrer: 'demarrer',
  'reprendre-travaux': 'reprendreTravaux',
  'passer-en-controle': 'passerEnControle',
  'refuser-controle': 'refuserControle',
  'valider-controle': 'validerControle',
  terminer: 'terminer',
  rouvrir: 'rouvrir',
  restituer: 'restituer',
  cloturer: 'cloturer',
  annuler: 'annuler',
};

interface Props {
  readonly or: ReponseOrdreReparation;
}

export function PanneauActionsOr({ or }: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs', 'validation']);
  const session = useSession();
  const [actionOuverte, setActionOuverte] = useState<ActionOrdreReparation | null>(null);

  // Une transition = un hook = un endpoint (§7.7) : les onze sont appelés inconditionnellement
  // (règle des hooks), le formulaire actif choisit ensuite lequel utiliser.
  const receptionner = useReceptionnerOr(or.id);
  const demarrer = useDemarrerOr(or.id);
  const reprendreTravaux = useReprendreTravauxOr(or.id);
  const passerEnControle = usePasserEnControleOr(or.id);
  const refuserControle = useRefuserControleOr(or.id);
  const validerControle = useValiderControleOr(or.id);
  const terminer = useTerminerOr(or.id);
  const rouvrir = useRouvrirOr(or.id);
  const restituer = useRestituerOr(or.id);
  const cloturer = useCloturerOr(or.id);
  const annuler = useAnnulerOr(or.id);

  // Champs locaux — un seul jeu à la fois, remis à zéro à l'ouverture de chaque dialogue.
  const [kilometrage, setKilometrage] = useState<number | null>(null);
  const [signatureDifferee, setSignatureDifferee] = useState(false);
  const [motifDifferee, setMotifDifferee] = useState('');
  const [motif, setMotif] = useState('');
  const [paiementRecu, setPaiementRecu] = useState(false);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  const [derniereEntree, setDerniereEntree] = useState<object | null>(null);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const actionsNiveauOr = or.actionsDisponibles.filter((action) => !ACTIONS_LIGNE.has(action));

  function fermer() {
    setActionOuverte(null);
    setKilometrage(null);
    setSignatureDifferee(false);
    setMotifDifferee('');
    setMotif('');
    setPaiementRecu(false);
    setErreurValidation(null);
    setDerniereEntree(null);
    setConfirmationOuverte(false);
  }

  const mutationActive =
    actionOuverte === 'receptionner'
      ? receptionner
      : actionOuverte === 'demarrer'
        ? demarrer
        : actionOuverte === 'reprendre-travaux'
          ? reprendreTravaux
          : actionOuverte === 'passer-en-controle'
            ? passerEnControle
            : actionOuverte === 'refuser-controle'
              ? refuserControle
              : actionOuverte === 'valider-controle'
                ? validerControle
                : actionOuverte === 'terminer'
                  ? terminer
                  : actionOuverte === 'rouvrir'
                    ? rouvrir
                    : actionOuverte === 'restituer'
                      ? restituer
                      : actionOuverte === 'cloturer'
                        ? cloturer
                        : actionOuverte === 'annuler'
                          ? annuler
                          : null;

  const erreurActive = mutationActive?.error instanceof ErreurApi ? mutationActive.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(entree: object) {
    if (!actionOuverte || !mutationActive) return;
    setDerniereEntree(entree);
    // `mutate` est typé par action (voir `useTransitionsOrdreReparation.ts`) ; le type exact de
    // `entree` est déjà garanti par le schéma zod correspondant appelé avant chaque `soumettre`.
    // Le panneau doit rester capable de router N'IMPORTE quelle des onze actions vers SA mutation
    // typée, ce que TypeScript ne peut pas vérifier statiquement ici sans dupliquer onze fois ce
    // bloc — le cast est donc délibéré, borné à cette seule ligne.
    (mutationActive.mutate as (valeur: unknown, options?: { onSuccess?: () => void }) => void)(entree, {
      onSuccess: () => fermer(),
    });
  }

  function resoumettreAvecConfirmations(confirmations: readonly CodeConfirmation[]) {
    if (!derniereEntree) return;
    setConfirmationOuverte(false);
    soumettre({ ...derniereEntree, confirmations });
  }

  function ouvrir(action: ActionOrdreReparation) {
    fermer();
    setActionOuverte(action);
  }

  if (actionsNiveauOr.length === 0) {
    return <p className="texte-libelle text-muted-foreground">{t('or:actions.aucuneActionDisponible')}</p>;
  }

  const cleTitre = actionOuverte ? CLES_TRANSITION[actionOuverte] : undefined;
  const titreDialogue = cleTitre ? t(`or:transitions.${cleTitre}`) : '';

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('or:titre')}>
        {actionsNiveauOr.map((action) => {
          const cle = CLES_TRANSITION[action];
          if (!cle) return null;
          return (
            <Button
              key={action}
              type="button"
              variant={action === 'annuler' ? 'destructive' : action === 'receptionner' || action === 'demarrer' ? 'default' : 'outline'}
              onClick={() => ouvrir(action)}
            >
              {t(`or:transitions.${cle}`)}
            </Button>
          );
        })}
      </div>

      <Dialog open={actionOuverte !== null} onOpenChange={(ouvert) => (ouvert ? undefined : fermer())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titreDialogue}</DialogTitle>
          </DialogHeader>

          {erreurActive && confirmationsRequises.length === 0 ? (
            <RefusBloquant
              code={erreurActive.probleme.code}
              blocages={erreurActive.blocages}
              actionsProposees={erreurActive.actionsProposees}
              estTerminal={or.statut === 'annule' || or.statut === 'cloture'}
            />
          ) : null}

          {/* CONFIRMATION_REQUISE (§4.4) : la transition reste possible, un rôle habilité doit
           *  juste confirmer explicitement — jamais un second clic silencieux sur le même bouton. */}
          {confirmationsRequises.length > 0 ? (
            <div role="alert" className="rounded-md border border-statut-attention/40 bg-statut-attention/10 p-3">
              <p className="texte-corps text-statut-attention">{erreurActive ? messageErreur(erreurActive, t) : ''}</p>
              <Button type="button" variant="outline" className="mt-2" onClick={() => setConfirmationOuverte(true)}>
                {t('commun:actions.continuerQuandMeme')}
              </Button>
            </div>
          ) : null}

          {actionOuverte === 'receptionner' ? (
            <div className="flex flex-col gap-4">
              <ChampKilometrage
                valeur={kilometrage}
                onChangeValeur={setKilometrage}
                unite="km"
                label={t('or:actions.kilometrageEntree')}
                obligatoire
              />
              <label className="flex items-center gap-2 texte-corps">
                <Checkbox checked={signatureDifferee} onCheckedChange={(coche) => setSignatureDifferee(coche === true)} />
                {t('or:actions.signatureDifferee')}
              </label>
              {signatureDifferee ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="or-action-motif-differee">{t('or:actions.motifSignatureDifferee')}</Label>
                  <Textarea
                    id="or-action-motif-differee"
                    value={motifDifferee}
                    onChange={(evenement) => setMotifDifferee(evenement.target.value)}
                  />
                </div>
              ) : null}
              {erreurValidation ? <p className="texte-libelle text-destructive">{erreurValidation}</p> : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionReceptionner.safeParse({
                      kilometrageEntree: kilometrage,
                      signatureDifferee,
                      motifDifferee: motifDifferee.trim() === '' ? undefined : motifDifferee.trim(),
                    });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('or:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'reprendre-travaux' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-action-motif-reprise">{t('or:actions.motif')}</Label>
                <Textarea id="or-action-motif-reprise" value={motif} onChange={(evenement) => setMotif(evenement.target.value)} />
              </div>
              {erreurValidation ? <p className="texte-libelle text-destructive">{erreurValidation}</p> : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionReprendreTravaux.safeParse({
                      motif: motif.trim() === '' ? undefined : motif.trim(),
                    });
                    if (!resultat.success) {
                      setErreurValidation(t('or:actions.motifRequis'));
                      return;
                    }
                    soumettre(resultat.data);
                  }}
                >
                  {t('or:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {(actionOuverte === 'refuser-controle' || actionOuverte === 'rouvrir' || actionOuverte === 'annuler') ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-action-motif">{t('or:actions.motif')}</Label>
                <Textarea id="or-action-motif" value={motif} onChange={(evenement) => setMotif(evenement.target.value)} />
                {erreurValidation ? <p className="texte-libelle text-destructive">{erreurValidation}</p> : null}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  variant={actionOuverte === 'annuler' ? 'destructive' : 'default'}
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const schema =
                      actionOuverte === 'refuser-controle'
                        ? schemaActionRefuserControle
                        : actionOuverte === 'rouvrir'
                          ? schemaActionRouvrir
                          : schemaActionAnnuler;
                    const resultat = schema.safeParse({ motif });
                    if (!resultat.success) {
                      setErreurValidation(t('or:actions.motifRequis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('or:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'terminer' ? (
            <div className="flex flex-col gap-4">
              <ChampKilometrage
                valeur={kilometrage}
                onChangeValeur={setKilometrage}
                unite="km"
                label={t('or:actions.kilometrageSortie')}
              />
              {erreurValidation ? <p className="texte-libelle text-destructive">{erreurValidation}</p> : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionTerminer.safeParse({ kilometrageSortie: kilometrage });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    soumettre(resultat.data);
                  }}
                >
                  {t('or:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'restituer' ? (
            <div className="flex flex-col gap-4">
              <ChampKilometrage
                valeur={kilometrage}
                onChangeValeur={setKilometrage}
                unite="km"
                label={t('or:actions.kilometrageSortie')}
              />
              <label className="flex items-center gap-2 texte-corps">
                <Checkbox checked={paiementRecu} onCheckedChange={(coche) => setPaiementRecu(coche === true)} />
                {t('or:actions.paiementRecu')}
              </label>
              {erreurValidation ? <p className="texte-libelle text-destructive">{erreurValidation}</p> : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionRestituer.safeParse({
                      kilometrageSortie: kilometrage,
                      paiementRecu,
                    });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    soumettre(resultat.data);
                  }}
                >
                  {t('or:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'valider-controle' ? (
            <div className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">{t('or:fiche.controleurAuto')}</p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending || !session.data?.utilisateur.id}
                  onClick={() => {
                    if (!session.data) return;
                    soumettre({ controleurId: session.data.utilisateur.id, pointsControles: [] });
                  }}
                >
                  {t('or:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'demarrer' || actionOuverte === 'passer-en-controle' || actionOuverte === 'cloturer' ? (
            <div className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">{t('or:actions.confirmerAction')}</p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button disabled={mutationActive?.isPending} onClick={() => soumettre({})}>
                  {t('or:actions.confirmer')}
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
