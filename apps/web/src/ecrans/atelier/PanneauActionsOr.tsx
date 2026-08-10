import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

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
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { ActionPrimaire, type ActionSecondaireMenu } from '@/composants/layout/ActionPrimaire';
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
 *
 * Exception au patron « un clic = un dialogue de confirmation » : `facturer` ne mute rien
 * ici-même. Le contrat (`RF-81`) sélectionne par GROUPE payeur `(payeur, payeurClientId)` — une
 * réparation partagée entre le client, une assurance et une garantie constructeur donne
 * plusieurs factures à plusieurs destinataires, un choix que ce panneau ne peut pas réduire à un
 * bouton unique sans risquer de fusionner deux destinataires. Le bouton est donc un lien vers
 * `EcranFacturerOrdreReparation`, qui porte lui-même ce choix groupe par groupe. La disponibilité
 * reste néanmoins gouvernée EXACTEMENT comme les dix autres : uniquement si le serveur liste
 * `facturer` dans `or.actionsDisponibles` (statut `termine` ET droit `facturation.document.creer`
 * de l'appelant courant, §`atelier/etat-affiche.ts`) — aucune règle d'état ni de droit
 * recodée côté client.
 *
 * Lot C (`docs/plan-refonte-navigation.md`) : une seule action mise en couleur (`ActionPrimaire`,
 * réutilisé tel quel depuis `EnTeteOrdreReparation`/`EnTeteFicheArticle`), le reste derrière un
 * « … » — jamais cinq boutons à plat de poids visuel égal. La PRIMAIRE est la première action de
 * `or.actionsDisponibles` (ordre serveur, `atelier/etat-affiche.ts::ACTIONS_DEPUIS_STATUT`, déjà le
 * chemin « avant » de chaque statut) qui n'est ni destructive ni de reprise
 * (`RESERVEES_SECONDAIRES`, plus bas) ni `facturer` — jamais redevinée depuis `or.statut` : le tri
 * porte sur la LISTE déjà filtrée par le serveur, pas sur une nouvelle machine à états côté client.
 *
 * « Une action indisponible doit être désactivée ou absente, jamais cliquable pour rien » : ce
 * panneau ne rend QUE `or.actionsDisponibles` (jamais un bouton grisé pour une action que le
 * serveur n'a pas listée — cf. le test « n'affiche QUE les actions listées par le serveur » plus
 * bas), donc rien n'y est jamais désactivé sans raison affichable. Pas de garde `disabled` sur le
 * déclencheur de la primaire pendant sa propre mutation non plus : `Dialog` (Radix, modal par
 * défaut) marque déjà tout le reste de l'écran `aria-hidden` + `pointer-events: none` dès qu'il est
 * ouvert — un second `disabled` sur un bouton déjà inatteignable à la souris ET retiré de l'arbre
 * d'accessibilité serait mort, invérifiable autrement qu'en contournant cet `aria-hidden` dans un
 * test (donc en testant un état qu'aucun utilisateur ne peut jamais rencontrer).
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
  facturer: 'facturer',
  rouvrir: 'rouvrir',
  restituer: 'restituer',
  cloturer: 'cloturer',
  annuler: 'annuler',
};

/**
 * Actions jamais retenues comme PRIMAIRE (Lot C, `docs/plan-refonte-navigation.md` §« Action
 * primaire unique par écran ») : destructive (`annuler`), négatives (`refuser-controle`) ou de
 * reprise/correction (`reprendre-travaux`, `rouvrir`) — jamais le chemin attendu par défaut, même
 * quand le serveur les liste comme structurellement possibles. `facturer` en est exclu par
 * construction ailleurs (voir plus bas) : `EnTeteOrdreReparation` en fait déjà SON action primaire
 * de page dès qu'elle est disponible, la dupliquer en couleur ici contredirait « une seule action
 * primaire par écran ».
 */
const RESERVEES_SECONDAIRES: ReadonlySet<ActionOrdreReparation> = new Set([
  'annuler',
  'refuser-controle',
  'reprendre-travaux',
  'rouvrir',
]);

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
    (mutationActive.mutate as (valeur: unknown, options?: { onSuccess?: () => void }) => void)(
      entree,
      {
        onSuccess: () => fermer(),
      },
    );
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
    return (
      <p className="texte-libelle text-muted-foreground">
        {t('or:actions.aucuneActionDisponible')}
      </p>
    );
  }

  const cleTitre = actionOuverte ? CLES_TRANSITION[actionOuverte] : undefined;
  const titreDialogue = cleTitre ? t(`or:transitions.${cleTitre}`) : '';

  function libelleTransition(action: ActionOrdreReparation): string {
    const cle = CLES_TRANSITION[action] ?? action;
    return t(`or:transitions.${cle}`);
  }

  // Lot C — `facturer` navigue vers `EcranFacturerOrdreReparation` (choix par groupe payeur, voir
  // le commentaire d'en-tête) : jamais une transition mutée depuis ce panneau, donc jamais
  // candidate à la PRIMAIRE ni au menu « … » (un `<Link>` dans un `DropdownMenuItem` changerait son
  // rôle ARIA de « lien » à « élément de menu », ce que `EcranFicheOrdreReparation.spec.tsx`
  // n'attend pas). Rendu à part, en second bouton visible — jamais masqué derrière le débordement.
  const actionsTransition = actionsNiveauOr.filter((action) => action !== 'facturer');
  const peutFacturer = actionsNiveauOr.includes('facturer');

  // PRIMAIRE : la première action non réservée (`RESERVEES_SECONDAIRES`) dans l'ORDRE déjà décidé
  // par le serveur — repli sur la première tout court si l'appelant n'a droit qu'à des actions
  // réservées (aucun statut ne produit ce cas aujourd'hui, mais le repli évite un panneau sans
  // aucune action mise en avant si la matrice de droits évolue).
  const actionPrimaire =
    actionsTransition.find((action) => !RESERVEES_SECONDAIRES.has(action)) ??
    actionsTransition[0] ??
    null;
  const actionsSecondaires = actionsTransition.filter((action) => action !== actionPrimaire);

  const menuSecondaire: ActionSecondaireMenu[] = actionsSecondaires.map((action) => ({
    cle: action,
    libelle: libelleTransition(action),
    onSelect: () => ouvrir(action),
  }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('or:titre')}>
        {actionPrimaire ? (
          <ActionPrimaire
            actionsSecondaires={menuSecondaire}
            libelleMenuSecondaire={t('or:actions.autresActions')}
          >
            <Button
              type="button"
              variant={actionPrimaire === 'annuler' ? 'destructive' : 'default'}
              onClick={() => ouvrir(actionPrimaire)}
            >
              {libelleTransition(actionPrimaire)}
            </Button>
          </ActionPrimaire>
        ) : null}

        {peutFacturer ? (
          <Button key="facturer" asChild variant="outline">
            <Link to={`/ordres-reparation/${or.id}/facturer`}>{libelleTransition('facturer')}</Link>
          </Button>
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
              estTerminal={or.statut === 'annule' || or.statut === 'cloture'}
            />
          ) : null}

          {/* CONFIRMATION_REQUISE (§4.4) : la transition reste possible, un rôle habilité doit
           *  juste confirmer explicitement — jamais un second clic silencieux sur le même bouton. */}
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

          {actionOuverte === 'receptionner' ? (
            <div className="flex flex-col gap-4">
              <ChampKilometrage
                valeur={kilometrage}
                onChangeValeur={setKilometrage}
                unite="km"
                label={t('or:actions.kilometrageEntree')}
                obligatoire
              />
              <label
                htmlFor="or-action-signature-differee"
                className="flex items-center gap-2 texte-corps"
              >
                <Checkbox
                  id="or-action-signature-differee"
                  checked={signatureDifferee}
                  onCheckedChange={(coche) => setSignatureDifferee(coche === true)}
                />
                {t('or:actions.signatureDifferee')}
              </label>
              {signatureDifferee ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="or-action-motif-differee">
                    {t('or:actions.motifSignatureDifferee')}
                  </Label>
                  <Textarea
                    id="or-action-motif-differee"
                    value={motifDifferee}
                    onChange={(evenement) => setMotifDifferee(evenement.target.value)}
                  />
                </div>
              ) : null}
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
                <Textarea
                  id="or-action-motif-reprise"
                  value={motif}
                  onChange={(evenement) => setMotif(evenement.target.value)}
                />
              </div>
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

          {actionOuverte === 'refuser-controle' ||
          actionOuverte === 'rouvrir' ||
          actionOuverte === 'annuler' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-action-motif">{t('or:actions.motif')}</Label>
                <Textarea
                  id="or-action-motif"
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
                    const resultat = schemaActionTerminer.safeParse({
                      kilometrageSortie: kilometrage,
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

          {actionOuverte === 'restituer' ? (
            <div className="flex flex-col gap-4">
              <ChampKilometrage
                valeur={kilometrage}
                onChangeValeur={setKilometrage}
                unite="km"
                label={t('or:actions.kilometrageSortie')}
              />
              <label
                htmlFor="or-action-paiement-recu"
                className="flex items-center gap-2 texte-corps"
              >
                <Checkbox
                  id="or-action-paiement-recu"
                  checked={paiementRecu}
                  onCheckedChange={(coche) => setPaiementRecu(coche === true)}
                />
                {t('or:actions.paiementRecu')}
              </label>
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

          {actionOuverte === 'demarrer' ||
          actionOuverte === 'passer-en-controle' ||
          actionOuverte === 'cloturer' ? (
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
