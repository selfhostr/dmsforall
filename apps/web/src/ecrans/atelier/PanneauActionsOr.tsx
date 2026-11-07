import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';

import {
  schemaActionAnnuler,
  schemaActionReceptionner,
  schemaActionRefuserControle,
  schemaActionReprendreTravaux,
  schemaActionRestituer,
  schemaActionRouvrir,
  schemaActionTerminer,
  type ActionOrdreReparation,
  type ActionProposee,
  type CodeConfirmation,
  type ReponseOrdreReparation,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
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
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { ActionPrimaire, type ActionSecondaireMenu } from '@/composants/layout/ActionPrimaire';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { useAnnulerLignesOr, useMarquerLignesRealisees } from '@/hooks/atelier/useActionsLigneOr';
import { useArreterPointagesOr } from '@/hooks/atelier/useArreterPointagesOr';
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
import { usePeut } from '@/droits';
import { useSession } from '@/hooks/useSession';
import { clesQuery } from '@/api/cles';
import { chemins } from '@/routes/chemins';

import { planifierActionProposee, type ConsigneActionProposee } from './actions-proposees';
import { BoutonImprimerOr } from './BoutonImprimerOr';
import { DialogueAccordClient } from './DialogueAccordClient';
import { DialogueLignesEnAttente } from './DialogueLignesEnAttente';
import { DialogueRenseignerPo } from './DialogueRenseignerPo';
import { peutAnnulerLigneOr } from './droits';
import { messageErreurMarquage, messageErreurMutation } from './messages-erreur-mutation';

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
  const marquerRealisees = useMarquerLignesRealisees(or.id);
  const arreterPointages = useArreterPointagesOr(or.id);
  const retirerLignes = useAnnulerLignesOr(or.id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const actions = session.data?.actions;

  // Champs locaux — un seul jeu à la fois, remis à zéro à l'ouverture de chaque dialogue.
  const [kilometrage, setKilometrage] = useState<number | null>(null);
  const [signatureDifferee, setSignatureDifferee] = useState(false);
  const [motifDifferee, setMotifDifferee] = useState('');
  const [motif, setMotif] = useState('');
  const [paiementRecu, setPaiementRecu] = useState(false);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  const [derniereEntree, setDerniereEntree] = useState<object | null>(null);
  // Issues #64/#66 (même correctif que `FormulaireNouvelOrdreReparation`, son voisin naturel dans
  // ce module) : un drapeau de REJET plutôt qu'un simple `confirmationsRequises.length > 0` — la
  // modale (voir `AvertissementConfirmable` plus bas) s'ouvre désormais D'ELLE-MÊME dès que le
  // serveur exige une confirmation, jamais derrière un second clic sur un encart qu'on peut
  // manquer. Sans ce drapeau, fermer la modale par « Annuler » la rouvrirait aussitôt (l'erreur de
  // mutation reste posée tant qu'aucun nouvel envoi n'a eu lieu) : reposer la question exige un
  // nouvel envoi explicite.
  const [confirmationRejetee, setConfirmationRejetee] = useState(false);
  // Effets des actions proposées qui passent par un dialogue propre (voir `actions-proposees.ts`).
  const [accordLigneIds, setAccordLigneIds] = useState<readonly string[] | null>(null);
  const [pointagesAArreter, setPointagesAArreter] = useState<readonly string[] | null>(null);
  const [poOuvert, setPoOuvert] = useState(false);
  const [consigne, setConsigne] = useState<{
    readonly consigne: ConsigneActionProposee;
    readonly donnees?: Readonly<Record<string, unknown>>;
  } | null>(null);
  // Travaux « Proposée » qui subsistent à la fin de l'OR : la saisie en attente d'être envoyée
  // après le choix de l'utilisateur (laisser / retirer / annuler).
  const [entreeAvecLignesEnAttente, setEntreeAvecLignesEnAttente] = useState<object | null>(null);
  const lignesEnAttente = or.lignes.filter((ligne) => ligne.statut === 'proposee');
  // Travaux validés ou en cours : le serveur refuse « Travaux terminés » / « Valider le contrôle »
  // tant qu'ils ne sont pas réalisés (I-10). L'OR chargé le dit déjà : on propose le geste combiné
  // d'emblée plutôt que d'attendre un refus 409 (qui reste géré en filet, `RefusBloquant`).
  const peutMarquerRealisees = usePeut('atelier.ligne.marquer_realisee');
  const lignesARealiser = or.lignes.filter(
    (ligne) => ligne.statut === 'validee' || ligne.statut === 'en_cours',
  );
  const gesteCombine = peutMarquerRealisees && lignesARealiser.length > 0;

  const actionsNiveauOr = or.actionsDisponibles.filter((action) => !ACTIONS_LIGNE.has(action));

  function fermer() {
    marquerRealisees.reset();
    arreterPointages.reset();
    retirerLignes.reset();
    setConsigne(null);
    setEntreeAvecLignesEnAttente(null);
    setActionOuverte(null);
    setKilometrage(null);
    setSignatureDifferee(false);
    setMotifDifferee('');
    setMotif('');
    setPaiementRecu(false);
    setErreurValidation(null);
    setDerniereEntree(null);
    setConfirmationRejetee(false);
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

  function rejouerActionInitiale() {
    if (derniereEntree) soumettre(derniereEntree);
  }

  // Actions proposées par un refus (`actionsProposees`, invariant n°8) : CHAQUE code du contrat a un
  // effet réel (voir `actions-proposees.ts`, exhaustif et testé). Celles qui lèvent le blocage
  // (marquer réalisées, accord du client, arrêt des pointages, n° de commande) rejouent ensuite
  // l'action initiale avec la même saisie ; un échec reste affiché dans son dialogue et l'action
  // initiale n'est pas rejouée.
  function executerActionProposee(action: ActionProposee) {
    if (!erreurActive) return;
    setConsigne(null);
    const effet = planifierActionProposee(action, {
      blocages: erreurActive.blocages,
      actionsDisponibles: or.actionsDisponibles,
      confirmationsRequises,
    });
    switch (effet.type) {
      case 'marquer_realisees':
        marquerRealisees.mutate(effet.ligneIds, { onSuccess: rejouerActionInitiale });
        break;
      case 'accord_client':
        setAccordLigneIds(effet.ligneIds);
        break;
      case 'arreter_pointages':
        setPointagesAArreter(effet.pointageIds);
        break;
      case 'renseigner_po':
        setPoOuvert(true);
        break;
      case 'ouvrir_action':
        ouvrir(effet.action);
        break;
      case 'nouvel_or': {
        const parametres = new URLSearchParams({ vehiculeId: or.vehicule.id });
        navigate(
          `${chemins.atelier.ordresReparation.nouveau(searchParams.get('site') ?? undefined, or.client.id)}&${parametres.toString()}`,
        );
        break;
      }
      case 'rafraichir':
        mutationActive?.reset();
        void queryClient.invalidateQueries({ queryKey: clesQuery.or.detail(or.id) });
        break;
      case 'rejouer_confirme':
        resoumettreAvecConfirmations(effet.confirmations);
        break;
      case 'consigne':
        setConsigne({ consigne: effet.consigne, donnees: effet.donnees });
        break;
    }
  }

  const terminaisonAvecLignesEnAttente =
    (actionOuverte === 'terminer' || actionOuverte === 'valider-controle') &&
    lignesEnAttente.length > 0;

  // « Terminer » / « Valider le contrôle » avec des travaux encore « Proposée » : le garagiste
  // choisit (laisser en attente, retirer de l'OR, annuler) avant l'envoi — le serveur, lui, reste
  // l'arbitre de la transition.
  function soumettreEnControlantLesLignes(entree: object) {
    if (terminaisonAvecLignesEnAttente) {
      setEntreeAvecLignesEnAttente(entree);
      return;
    }
    soumettre(entree);
  }

  // Geste combiné : marque réalisées les lignes que l'OR connaît déjà comme à réaliser, puis envoie
  // la transition. Un échec de marquage s'affiche dans le dialogue et n'envoie rien.
  function marquerPuisSoumettre(entree: object) {
    marquerRealisees.mutate(
      lignesARealiser.map((ligne) => ligne.id),
      { onSuccess: () => soumettreEnControlantLesLignes(entree) },
    );
  }

  function resoumettreAvecConfirmations(confirmations: readonly CodeConfirmation[]) {
    if (!derniereEntree) return;
    soumettre({ ...derniereEntree, confirmations });
  }

  function ouvrir(action: ActionOrdreReparation) {
    fermer();
    setActionOuverte(action);
  }

  if (actionsNiveauOr.length === 0) {
    // Imprimer reste toujours proposé, même sans AUCUNE transition disponible pour ce rôle/statut
    // (ex. OR clôturé) : c'est un geste de consultation (`atelier.or.lire`), jamais gouverné par
    // `or.actionsDisponibles` — voir le commentaire d'en-tête de `BoutonImprimerOr`.
    return (
      <div className="flex flex-col items-start gap-3">
        <BoutonImprimerOr orId={or.id} />
        <p className="texte-libelle text-muted-foreground">
          {t('or:actions.aucuneActionDisponible')}
        </p>
      </div>
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

  // CORRECTIF (test d'utilisabilité novice, 11.08.2026) : sur un OR encore `ouvert` (véhicule pas
  // même réceptionné), `terminer` PEUT être l'action primaire calculée ci-dessus — non par erreur
  // de tri (il n'est pas dans `RESERVEES_SECONDAIRES`, à raison : plus loin dans le cycle, ex.
  // `en_cours`, c'est bien LE bouton attendu), mais parce que le rôle courant n'a parfois droit
  // qu'à `terminer`/`annuler` à ce statut (`demarrer`/`passer-en-controle` filtrés en amont par
  // `atelier.or.demarrer`/`atelier.or.passer_en_controle`, voir `apps/api/.../etat-affiche.ts` —
  // SIGNALÉ séparément : cette matrice de droits mérite sa propre revue, hors périmètre ici). Le
  // testeur : « Terminer quoi ? La voiture n'est même pas rentrée. » Plutôt que de RETIRER
  // `terminer` (il reste l'action structurellement possible que ce rôle peut légitimement
  // déclencher, jamais désinventée côté client), on retire seulement le POIDS VISUEL trompeur :
  // `variant="outline"`, comme `facturer` juste à côté — reconnaissable, atteignable, mais qui
  // n'affirme plus être « l'étape attendue » sur un OR dont les travaux n'ont pas commencé.
  const primaireAAttenuer = actionPrimaire === 'terminer' && or.statut === 'ouvert';

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
              variant={
                actionPrimaire === 'annuler'
                  ? 'destructive'
                  : primaireAAttenuer
                    ? 'outline'
                    : 'default'
              }
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

        <BoutonImprimerOr orId={or.id} />
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
              actionEnCours={marquerRealisees.isPending || mutationActive?.isPending}
              onActionProposee={executerActionProposee}
            />
          ) : null}

          {consigne ? (
            <p role="note" className="texte-corps text-foreground">
              {t(`or:consignes.${consigne.consigne}`, {
                km:
                  typeof consigne.donnees?.dernierConnuKm === 'number'
                    ? consigne.donnees.dernierConnuKm
                    : '',
              })}
            </p>
          ) : null}

          {marquerRealisees.isError ? (
            <p role="alert" className="texte-libelle text-destructive">
              {messageErreurMarquage(marquerRealisees.error, t)}
            </p>
          ) : null}

          {actionOuverte === 'receptionner' ? (
            <div className="flex flex-col gap-4">
              <LegendeChampsObligatoires>
                {t('commun:formulaires.champsObligatoiresLegende')}
              </LegendeChampsObligatoires>
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
                  {/* `motifDifferee` est `schemaMotif.optional()` (`schemaActionReceptionner`) au
                   *  sens strict du contrat, mais le commentaire du schéma (RM-51/§6.12) est
                   *  explicite : « la signature peut être différée, MAIS ALORS le motif est
                   *  exigé » — obligation business non capturée par zod, même patron que le PO
                   *  du client (`FormulaireNouvelOrdreReparation.tsx`). Toujours requis dans CETTE
                   *  branche puisqu'elle ne s'affiche QUE quand `signatureDifferee` est coché. */}
                  <Label htmlFor="or-action-motif-differee" requis>
                    {t('or:actions.motifSignatureDifferee')}
                  </Label>
                  <Textarea
                    id="or-action-motif-differee"
                    value={motifDifferee}
                    aria-required="true"
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
              <LegendeChampsObligatoires>
                {t('commun:formulaires.champsObligatoiresLegende')}
              </LegendeChampsObligatoires>
              {/* CORRECTIF (test d'utilisabilité novice, 11.08.2026) : « ça annule ou ça
               *  efface ? est-ce que je peux revenir ? ». `annuler` mène au statut `annule`, qui
               *  n'autorise plus AUCUNE transition (`ACTIONS_DEPUIS_STATUT.annule = []`,
               *  `apps/api/.../etat-affiche.ts`) — irréversible, à dire AVANT la confirmation,
               *  jamais après. Clé i18n `or:actions.annulerAvertissement` posée en FR/DE/IT
               *  (`i18n/locales/{fr,de,it}/or.json`). */}
              {actionOuverte === 'annuler' ? (
                <p role="note" className="texte-corps text-muted-foreground">
                  {t('or:actions.annulerAvertissement')}
                </p>
              ) : null}
              <div className="flex flex-col gap-1.5">
                {/* `motif: schemaMotif` (sans `.optional()`) dans les TROIS schémas que cette
                 *  branche partage — `schemaActionRefuserControle`, `schemaActionRouvrir`,
                 *  `schemaActionAnnuler` (`packages/shared/src/contrats/atelier/ordre-reparation.ts`)
                 *  — obligatoire dans les trois cas, jamais conditionnel ici. */}
                <Label htmlFor="or-action-motif" requis>
                  {t('or:actions.motif')}
                </Label>
                <Textarea
                  id="or-action-motif"
                  value={motif}
                  required
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
              {gesteCombine ? (
                <p role="note" className="texte-corps text-muted-foreground">
                  {t('or:lignesARealiser.avertissement', { count: lignesARealiser.length })}
                </p>
              ) : null}
              {erreurValidation ? (
                <p className="texte-libelle text-destructive">{erreurValidation}</p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending || marquerRealisees.isPending}
                  onClick={() => {
                    const resultat = schemaActionTerminer.safeParse({
                      kilometrageSortie: kilometrage,
                    });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    if (gesteCombine) marquerPuisSoumettre(resultat.data);
                    else soumettreEnControlantLesLignes(resultat.data);
                  }}
                >
                  {gesteCombine
                    ? t('or:lignesARealiser.action', { count: lignesARealiser.length })
                    : t('or:actions.confirmer')}
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
              {gesteCombine ? (
                <p role="note" className="texte-corps text-muted-foreground">
                  {t('or:lignesARealiser.avertissement', { count: lignesARealiser.length })}
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={
                    mutationActive?.isPending ||
                    marquerRealisees.isPending ||
                    !session.data?.utilisateur.id
                  }
                  onClick={() => {
                    if (!session.data) return;
                    const entree = {
                      controleurId: session.data.utilisateur.id,
                      pointsControles: [],
                    };
                    if (gesteCombine) marquerPuisSoumettre(entree);
                    else soumettreEnControlantLesLignes(entree);
                  }}
                >
                  {gesteCombine
                    ? t('or:lignesARealiser.action', { count: lignesARealiser.length })
                    : t('or:actions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'demarrer' ||
          actionOuverte === 'passer-en-controle' ||
          actionOuverte === 'cloturer' ? (
            <div className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">
                {t(`or:actions.confirmation.${cleTitre ?? 'demarrer'}`)}
              </p>
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

      <DialogueAccordClient
        orId={or.id}
        ligneIds={accordLigneIds ?? []}
        plafondCentimes={or.plafondCentimes ?? 0}
        ouvert={accordLigneIds !== null}
        onOuvertChange={(ouvertAccord) => {
          if (!ouvertAccord) setAccordLigneIds(null);
        }}
        onAccorde={rejouerActionInitiale}
      />

      <DialogueRenseignerPo
        orId={or.id}
        version={or.version}
        ouvert={poOuvert}
        onOuvertChange={setPoOuvert}
        onEnregistre={rejouerActionInitiale}
      />

      <AvertissementConfirmable
        ouvert={pointagesAArreter !== null}
        onOuvertChange={(ouvertArret) => {
          if (!ouvertArret) {
            setPointagesAArreter(null);
            arreterPointages.reset();
          }
        }}
        titre={t('or:arretPointages.titre', { count: pointagesAArreter?.length ?? 0 })}
        description={t('or:arretPointages.description', { count: pointagesAArreter?.length ?? 0 })}
        libelleConfirmation={t('or:arretPointages.confirmer', {
          count: pointagesAArreter?.length ?? 0,
        })}
        enCours={arreterPointages.isPending}
        messageErreur={
          arreterPointages.isError ? messageErreurMutation(arreterPointages.error, t) : null
        }
        onConfirmer={() => {
          if (!pointagesAArreter) return;
          arreterPointages.mutate(pointagesAArreter, {
            onSuccess: () => {
              setPointagesAArreter(null);
              rejouerActionInitiale();
            },
          });
        }}
      />

      <DialogueLignesEnAttente
        ouvert={entreeAvecLignesEnAttente !== null}
        nombre={lignesEnAttente.length}
        libelleAction={titreDialogue}
        peutRetirer={peutAnnulerLigneOr(actions)}
        enCours={retirerLignes.isPending || (mutationActive?.isPending ?? false)}
        messageErreur={retirerLignes.isError ? messageErreurMutation(retirerLignes.error, t) : null}
        onAnnuler={() => {
          setEntreeAvecLignesEnAttente(null);
          retirerLignes.reset();
        }}
        onLaisser={() => {
          const entree = entreeAvecLignesEnAttente;
          setEntreeAvecLignesEnAttente(null);
          if (entree) soumettre(entree);
        }}
        onRetirer={() => {
          const entree = entreeAvecLignesEnAttente;
          if (!entree) return;
          retirerLignes.mutate(
            {
              ligneIds: lignesEnAttente.map((ligne) => ligne.id),
              motif: t('or:lignesEnAttente.motifRetrait'),
            },
            {
              onSuccess: () => {
                setEntreeAvecLignesEnAttente(null);
                soumettre(entree);
              },
            },
          );
        }}
      />

      {/* CONFIRMATION_REQUISE (§4.4, issues #64/#66) : s'ouvre D'ELLE-MÊME dès que le serveur
       *  l'exige, jamais derrière un second clic sur un encart qu'on peut manquer — même mécanisme
       *  que `FormulaireNouvelOrdreReparation` pour ce même refus. La modale de Radix déplace le
       *  focus clavier à l'ouverture, donc autant l'œil que le clavier tombent directement sur la
       *  question. Le refus reste un geste normal (`Annuler`, Échap) : `confirmationRejetee`
       *  l'enregistre pour ne pas rouvrir la modale toute seule — reposer la question exige un
       *  nouvel envoi explicite (voir `soumettre` ci-dessus). */}
      <AvertissementConfirmable
        ouvert={confirmationsRequises.length > 0 && !confirmationRejetee}
        onOuvertChange={(ouvertConfirmation) => {
          if (!ouvertConfirmation) setConfirmationRejetee(true);
        }}
        titre={titreDialogue}
        description={erreurActive ? messageErreurMutation(erreurActive, t) : ''}
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() => resoumettreAvecConfirmations(confirmationsRequises)}
        enCours={mutationActive?.isPending}
      />
    </>
  );
}
