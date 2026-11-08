import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useQueryClient } from '@tanstack/react-query';

import {
  schemaActionAbandonnerDossierVente,
  schemaActionAnnulerDossierVente,
  schemaActionCloturerDossierVente,
  schemaActionEngager,
  schemaActionLivrer,
  schemaActionMarquerPretALivrer,
  schemaActionPreparer,
  type ActionDossierVente,
  type CodeConfirmation,
  type ReponseDossierVente,
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
import { DateInput } from '@/components/ui/date-input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { ActionPrimaire, type ActionSecondaireMenu } from '@/composants/layout/ActionPrimaire';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { clesVentesDossiers } from '@/hooks/ventes/dossiers/cles';
import { useCreerBonCommandeDossier } from '@/hooks/ventes/dossiers/useCreerBonCommandeDossier';
import { useCreerFactureDossier } from '@/hooks/ventes/dossiers/useCreerFactureDossier';
import {
  useAbandonnerDossierVente,
  useAnnulerDossierVente,
  useCloturerDossierVente,
  useEngagerDossierVente,
  useLivrerDossierVente,
  useMarquerDossierPretALivrer,
  usePreparerDossierVente,
} from '@/hooks/ventes/dossiers/useTransitionsDossierVente';
import { formaterDate, formaterMontant } from '@/lib/formats';

import { CLES_STATUT_DOCUMENT } from './CarteDocumentsVente';

/** Segment d'action (§6.2, `ACTIONS_DOSSIER_VENTE`) -> suffixe camelCase de `ventes:dossier.transitions`
 *  — mapping non trivial (`marquer_pret_a_livrer` -> `marquerPretALivrer`), même doctrine que
 *  `PanneauActionsOr::CLES_TRANSITION`. `modifier` ABSENT ici volontairement : ce n'est pas une
 *  transition de statut, `DialogueModifierDossierVente` (PATCH) le couvre séparément — voir la
 *  note de `enums.ts` en tête de fichier (« `modifier` ne correspond à aucun schéma d'action »). */
const CLES_TRANSITION: Partial<Record<ActionDossierVente, string>> = {
  engager: 'engager',
  preparer: 'preparer',
  marquer_pret_a_livrer: 'marquerPretALivrer',
  livrer: 'livrer',
  cloturer: 'cloturer',
  annuler: 'annuler',
  abandonner: 'abandonner',
};

const IDENTITES_USUELLES = [
  'carte_identite',
  'passeport',
  'permis_conduire',
  'titre_sejour',
] as const;

/**
 * Actions jamais retenues comme PRIMAIRE (même doctrine que `PanneauActionsOr::RESERVEES_SECONDAIRES`,
 * atelier) : `annuler` et `abandonner` mettent fin au dossier — irréversibles (RV-38 : au-delà de
 * `pret_a_livrer`, plus aucune des deux n'est même proposée), jamais le geste attendu par défaut
 * même quand le serveur les liste comme structurellement possibles. Toutes deux restent accessibles
 * derrière le « … », chacune avec sa propre confirmation qui nomme la conséquence (texte
 * `annulerConfirmationVehicule`, déjà présent plus bas — inchangé par ce lot).
 */
const RESERVEES_SECONDAIRES: ReadonlySet<ActionDossierVente> = new Set(['annuler', 'abandonner']);

interface Props {
  readonly dossier: ReponseDossierVente;
}

/**
 * Barre d'actions du dossier de vente (§6.2, §7.3 du design) — même patron que `PanneauActionsOr`
 * (atelier, Lot C `docs/plan-refonte-navigation.md`) : une seule action mise en couleur, le reste
 * derrière un « … » — jamais plusieurs boutons à plat de poids visuel égal. LES actions listées par
 * `dossier.actionsDisponibles`, jamais devinées depuis `dossier.statut`. Chaque clic ouvre une
 * confirmation, jamais une exécution directe.
 *
 * PRIMAIRE : la première action non réservée (`RESERVEES_SECONDAIRES`) dans l'ordre déjà décidé par
 * le serveur — `engager`/`preparer`/`marquer_pret_a_livrer`/`livrer`/`cloturer` selon le statut, la
 * progression normale du dossier. Repli sur la première tout court si l'appelant n'a droit qu'à des
 * actions réservées (aucun statut ne produit ce cas aujourd'hui, la table `ACTIONS_DEPUIS_STATUT_DOSSIER`
 * associe toujours au moins une action de progression à `annuler`/`abandonner` — le repli couvre une
 * évolution future de la matrice de droits sans jamais laisser ce panneau sans aucune action mise en
 * avant).
 *
 * Doublon supprimé (chantier réduction de densité, 24.08.2026) : `EnTeteDossierVente` proposait
 * jusqu'ici sa PROPRE copie en couleur de `preparer`/`marquer_pret_a_livrer`/`cloturer` — même
 * transition, même libellé, rendue juste au-dessus de CE panneau sur le même écran (voir le
 * commentaire de tête de `composants/motifs/GabaritEcran.tsx`, « deux commandes vers la même
 * destination sur le même écran »). Ce panneau reste désormais le SEUL point d'entrée des
 * transitions ; `EnTeteDossierVente` ne garde que « Assigner un véhicule », qui n'a pas d'équivalent
 * ici.
 *
 * Exception documentée : `livrer` compose sa description de confirmation DYNAMIQUEMENT (design
 * §10.1) — les effets de bord de cette transition (détention transférée, garantie VN, reprise qui
 * entre en stock) sont invisibles autrement.
 */
export function PanneauActionsDossierVente({ dossier }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs', 'validation']);
  const queryClient = useQueryClient();
  const [actionOuverte, setActionOuverte] = useState<ActionDossierVente | null>(null);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);
  const [derniereEntree, setDerniereEntree] = useState<object | null>(null);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  const engager = useEngagerDossierVente(dossier.id);
  const creationBonCommande = useCreerBonCommandeDossier(dossier);
  const creationFacture = useCreerFactureDossier(dossier);
  const preparer = usePreparerDossierVente(dossier.id);
  const marquerPretALivrer = useMarquerDossierPretALivrer(dossier.id);
  const livrer = useLivrerDossierVente(dossier.id);
  const cloturer = useCloturerDossierVente(dossier.id);
  const annuler = useAnnulerDossierVente(dossier.id);
  const abandonner = useAbandonnerDossierVente(dossier.id);

  const [bonCommandeDocumentId, setBonCommandeDocumentId] = useState('');
  // #124 : identifiant de la facture tout juste créée par ce dialogue — le dossier n'a pas encore
  // été refetché au moment du succès (l'invalidation TanStack Query est asynchrone), donc
  // `dossier.documents` ne la porte pas encore : c'est ce champ, pas `facturesDossier` dérivé plus
  // bas, qui fait apparaître le lien immédiatement après création.
  const [factureCreeeId, setFactureCreeeId] = useState<string | null>(null);
  const [identitePieceType, setIdentitePieceType] = useState('');
  const [identitePieceAutre, setIdentitePieceAutre] = useState('');
  const [motif, setMotif] = useState('');
  const [dateLivraisonEffective, setDateLivraisonEffective] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [kilometrageDepart, setKilometrageDepart] = useState<number | null>(
    dossier.typeVehicule === 'vn' ? 0 : null,
  );

  const actionsTransition = dossier.actionsDisponibles.filter(
    (action): action is Exclude<ActionDossierVente, 'modifier'> => action !== 'modifier',
  );

  function fermer() {
    setActionOuverte(null);
    setBonCommandeDocumentId('');
    setFactureCreeeId(null);
    setIdentitePieceType('');
    setIdentitePieceAutre('');
    setMotif('');
    setDateLivraisonEffective(new Date().toISOString().slice(0, 10));
    setKilometrageDepart(dossier.typeVehicule === 'vn' ? 0 : null);
    setErreurValidation(null);
    setDerniereEntree(null);
    setConfirmationOuverte(false);
  }

  const mutationActive =
    actionOuverte === 'engager'
      ? engager
      : actionOuverte === 'preparer'
        ? preparer
        : actionOuverte === 'marquer_pret_a_livrer'
          ? marquerPretALivrer
          : actionOuverte === 'livrer'
            ? livrer
            : actionOuverte === 'cloturer'
              ? cloturer
              : actionOuverte === 'annuler'
                ? annuler
                : actionOuverte === 'abandonner'
                  ? abandonner
                  : null;

  const erreurActive = mutationActive?.error instanceof ErreurApi ? mutationActive.error : null;
  const confirmationsRequises = erreurActive?.confirmationsRequises ?? [];

  function soumettre(entree: object) {
    if (!actionOuverte || !mutationActive) return;
    setDerniereEntree(entree);
    // Même cast délibéré et borné à cette ligne que `PanneauActionsOr` : router n'importe laquelle
    // des sept transitions vers sa mutation typée dépasse ce que TypeScript peut vérifier sans
    // dupliquer sept fois ce bloc.
    (mutationActive.mutate as (valeur: unknown, options?: { onSuccess?: () => void }) => void)(
      entree,
      { onSuccess: () => fermer() },
    );
  }

  function resoumettreAvecConfirmations(confirmations: readonly CodeConfirmation[]) {
    if (!derniereEntree) return;
    setConfirmationOuverte(false);
    soumettre({ ...derniereEntree, confirmations });
  }

  function ouvrir(action: ActionDossierVente) {
    fermer();
    setActionOuverte(action);
    // Défaut corrigé : le dialogue `livrer` affichait un texte périmé (« émettez la facture pour
    // pouvoir livrer ») même APRÈS émission — la version de `dossier.documents` reçue en `props`
    // pouvait dater d'avant l'émission (posée depuis l'écran facturation, hors périmètre, qui
    // n'invalide pas le cache de CETTE fiche). Invalider systématiquement à l'OUVERTURE de ce
    // dialogue précis (pas des autres, qui ne dépendent pas du statut d'un document) garantit que
    // le statut de la facture affiché reflète l'état réel du dossier à chaque ouverture, même si le
    // composant n'a pas été démonté entre-temps.
    if (action === 'livrer') {
      void queryClient.invalidateQueries({ queryKey: clesVentesDossiers.detail(dossier.id) });
    }
  }

  if (actionsTransition.length === 0) {
    return (
      <p className="texte-libelle text-muted-foreground">
        {t('ventes:dossier.transitions.aucuneActionDisponible')}
      </p>
    );
  }

  const cleTitre = actionOuverte ? CLES_TRANSITION[actionOuverte] : undefined;
  const titreDialogue = cleTitre ? t(`ventes:dossier.transitions.${cleTitre}`) : '';

  function libelleTransition(action: ActionDossierVente): string {
    const cle = CLES_TRANSITION[action];
    return cle ? t(`ventes:dossier.transitions.${cle}`) : action;
  }

  // PRIMAIRE — voir le commentaire de tête de ce composant.
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

  const bonsCommande = dossier.documents.filter((d) => d.typeDocument === 'bon_commande');
  // #124 : au moins une facture rattachée (peu importe son statut — même un brouillon confirme
  // que le lien `/factures/{id}` existe déjà et évite d'en recréer une seconde). L'union avec
  // `factureCreeeId` (voir sa note ci-dessus) couvre l'instant entre la création et le refetch.
  const facturesDossier = dossier.documents.filter((d) => d.typeDocument === 'facture');
  const factureAAfficherId = factureCreeeId ?? facturesDossier[0]?.id;
  // Défaut corrigé : « Ajoutez les lignes et émettez la facture pour pouvoir livrer » restait
  // affiché même APRÈS émission — le message était conditionné sur « une facture est rattachée »,
  // jamais sur son STATUT réel. `livrer` (RV-37) exige une facture ÉMISE, pas seulement rattachée :
  // le texte ne doit apparaître que tant que la facture est encore un `brouillon`. Si son statut
  // n'est pas encore connu (facture tout juste créée via `factureCreeeId`, avant que le dossier ne
  // soit rechargé — voir la note sur ce champ plus haut), elle est nécessairement un brouillon fraîchement
  // posé (`lignes: []`) : traiter l'inconnu comme « pas encore complète » reste correct, jamais
  // l'inverse (une facture qu'on ne peut pas confirmer émise ne doit jamais être traitée comme si
  // elle l'était).
  const factureCourante = facturesDossier.find((d) => d.id === factureAAfficherId);
  const factureNecessiteCompletion = factureCourante
    ? factureCourante.statut === 'brouillon'
    : factureAAfficherId !== undefined;
  const repriseNegocieePresente = dossier.reprise?.statut === 'negociee';

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('ventes:dossier.fiche.titre')}
      >
        {actionPrimaire ? (
          <ActionPrimaire
            actionsSecondaires={menuSecondaire}
            libelleMenuSecondaire={t('ventes:dossier.transitions.autresActions')}
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
              estTerminal={
                dossier.statut === 'annule' ||
                dossier.statut === 'abandonne' ||
                dossier.statut === 'clos'
              }
            />
          ) : null}

          {/* DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : encart d'alerte
           *  (`role="alert"`, jetons `--statut-attention`), même patron réutilisé partout où une
           *  transition exige une confirmation serveur (`PanneauActionsFinancement.tsx`,
           *  `PanneauActionsReprise.tsx`, `EcranNouveauDossierVente.tsx`) — une vraie zone d'action
           *  (message + bouton « Continuer quand même »), pas un simple groupe de contenu. */}
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

          {actionOuverte === 'engager' ? (
            <div className="flex flex-col gap-4">
              <LegendeChampsObligatoires>
                {t('commun:formulaires.champsObligatoiresLegende')}
              </LegendeChampsObligatoires>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-engager-bon-commande" requis>
                  {t('ventes:dossier.transitions.bonCommande')}
                </Label>
                {bonsCommande.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="texte-libelle text-muted-foreground">
                      {t('ventes:dossier.transitions.aucunBonCommande')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={creationBonCommande.enCours || creationBonCommande.blocage !== null}
                      onClick={() =>
                        creationBonCommande.creer({
                          onSuccess: (document) => setBonCommandeDocumentId(document.id),
                        })
                      }
                    >
                      {t('ventes:dossier.transitions.creerBonCommande')}
                    </Button>
                    {creationBonCommande.blocage ? (
                      <p className="texte-libelle text-destructive" role="alert">
                        {t(`ventes:dossier.transitions.blocageDocument.${creationBonCommande.blocage}`)}
                      </p>
                    ) : null}
                    {creationBonCommande.erreur ? (
                      <p className="texte-libelle text-destructive" role="alert">
                        {messageErreur(creationBonCommande.erreur, t)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <Select value={bonCommandeDocumentId} onValueChange={setBonCommandeDocumentId}>
                    <SelectTrigger id="dossier-engager-bon-commande" aria-required="true">
                      <SelectValue placeholder={t('ventes:dossier.transitions.bonCommande')} />
                    </SelectTrigger>
                    <SelectContent>
                      {bonsCommande.map((document) => (
                        <SelectItem key={document.id} value={document.id}>
                          {document.numero ??
                            // #128 : un document `brouillon` n'a jamais de `numero` avant émission —
                            // afficher `document.id` exposait l'UUID brut en clair dans un libellé
                            // visible. Statut traduit + date, jamais l'identifiant technique.
                            `${t(`ventes:dossier.documents.statuts.${CLES_STATUT_DOCUMENT[document.statut]}`)} · ${formaterDate(document.dateDocument)}`}
                          {document.totalTtcCentimes !== undefined ? (
                            <span className="texte-montant">
                              {' '}
                              · {formaterMontant(document.totalTtcCentimes)}
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-engager-identite" requis>
                  {t('ventes:dossier.transitions.identitePieceType')}
                </Label>
                <Select value={identitePieceType} onValueChange={setIdentitePieceType}>
                  <SelectTrigger id="dossier-engager-identite" aria-required="true">
                    <SelectValue placeholder={t('ventes:dossier.transitions.identitePieceType')} />
                  </SelectTrigger>
                  <SelectContent>
                    {IDENTITES_USUELLES.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`ventes:dossier.transitions.identitePieceTypes.${valeur}`)}
                      </SelectItem>
                    ))}
                    <SelectItem value="autre">
                      {t('ventes:dossier.transitions.identitePieceTypes.autre')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {identitePieceType === 'autre' ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="dossier-engager-identite-autre" requis>
                      {t('ventes:dossier.transitions.identitePieceTypeAutrePrecision')}
                    </Label>
                    <Textarea
                      id="dossier-engager-identite-autre"
                      required
                      value={identitePieceAutre}
                      onChange={(evenement) => setIdentitePieceAutre(evenement.target.value)}
                    />
                  </div>
                ) : null}
              </div>

              <p className="texte-corps text-muted-foreground">
                {t('ventes:dossier.transitions.engagerConfirmation')}
                {repriseNegocieePresente
                  ? ` ${t('ventes:dossier.transitions.engagerConfirmationReprise')}`
                  : ''}
              </p>

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
                    const typeResolu =
                      identitePieceType === 'autre' ? identitePieceAutre.trim() : identitePieceType;
                    const resultat = schemaActionEngager.safeParse({
                      bonCommandeDocumentId,
                      identitePieceType: typeResolu,
                    });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('ventes:dossier.transitions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'preparer' || actionOuverte === 'marquer_pret_a_livrer' ? (
            <div className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">
                {t('ventes:dossier.transitions.confirmerAction')}
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = (
                      actionOuverte === 'preparer'
                        ? schemaActionPreparer
                        : schemaActionMarquerPretALivrer
                    ).safeParse({});
                    if (resultat.success) soumettre(resultat.data);
                  }}
                >
                  {t('ventes:dossier.transitions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'cloturer' ? (
            <div className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">
                {t('ventes:dossier.transitions.cloturerDescription')}
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const resultat = schemaActionCloturerDossierVente.safeParse({});
                    if (resultat.success) soumettre(resultat.data);
                  }}
                >
                  {t('ventes:dossier.transitions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'livrer' ? (
            <div className="flex flex-col gap-4">
              <LegendeChampsObligatoires>
                {t('commun:formulaires.champsObligatoiresLegende')}
              </LegendeChampsObligatoires>

              {/* #124 : `livrer` (RV-37) exige côté serveur une facture ÉMISE — jusqu'ici aucun
                  écran ne permettait d'en créer une depuis le dossier, ce qui rendait le parcours
                  de vente impasse. Même doctrine que le bloc « bon de commande » du dialogue
                  `engager` : un bouton, pas un formulaire, `lignes: []`, le contenu (véhicule,
                  prix, TVA) se saisit ensuite sur `/factures/{id}` (écran facturation, hors
                  périmètre) — cette carte ne fait qu'amorcer et signposter le geste suivant. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-livrer-facture">
                  {t('ventes:dossier.transitions.facture')}
                </Label>
                {factureAAfficherId === undefined ? (
                  <div className="flex flex-col gap-2">
                    <p className="texte-libelle text-muted-foreground">
                      {t('ventes:dossier.transitions.aucuneFacture')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={creationFacture.enCours || creationFacture.blocage !== null}
                      onClick={() =>
                        creationFacture.creer({
                          onSuccess: (document) => setFactureCreeeId(document.id),
                        })
                      }
                    >
                      {t('ventes:dossier.transitions.creerFacture')}
                    </Button>
                    {creationFacture.blocage ? (
                      <p className="texte-libelle text-destructive" role="alert">
                        {t(`ventes:dossier.transitions.blocageDocument.${creationFacture.blocage}`)}
                      </p>
                    ) : null}
                    {creationFacture.erreur ? (
                      <p className="texte-libelle text-destructive" role="alert">
                        {messageErreur(creationFacture.erreur, t)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Link
                      id="dossier-livrer-facture"
                      to={`/factures/${factureAAfficherId}`}
                      className="texte-corps text-primary hover:underline"
                    >
                      {t('ventes:dossier.transitions.voirFacture')}
                    </Link>
                    {factureNecessiteCompletion ? (
                      <p className="texte-libelle text-muted-foreground">
                        {t('ventes:dossier.transitions.factureACompleter')}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-livrer-date" requis>
                  {t('ventes:dossier.transitions.dateLivraisonEffective')}
                </Label>
                <DateInput
                  id="dossier-livrer-date"
                  required
                  value={dateLivraisonEffective}
                  onChange={(valeurISO: string | undefined) =>
                    setDateLivraisonEffective(valeurISO ?? '')
                  }
                />
              </div>
              <ChampKilometrage
                valeur={kilometrageDepart}
                onChangeValeur={setKilometrageDepart}
                unite="km"
                label={t('ventes:dossier.transitions.kilometrageDepart')}
                obligatoire
              />

              <p className="texte-corps text-muted-foreground">
                {t('ventes:dossier.transitions.livrerConfirmationDetention', {
                  nom: (dossier.clientConducteur ?? dossier.clientAcheteur).nomAffiche,
                })}
                {dossier.typeVehicule === 'vn'
                  ? ` ${t('ventes:dossier.transitions.livrerConfirmationGarantie')}`
                  : ''}
                {dossier.reprise?.statut === 'confirmee' &&
                dossier.reprise.valeurNegocieeCentimes !== null
                  ? ` ${t('ventes:dossier.transitions.livrerConfirmationReprise', {
                      montant: formaterMontant(dossier.reprise.valeurNegocieeCentimes),
                    })}`
                  : ''}
              </p>

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
                    const resultat = schemaActionLivrer.safeParse({
                      dateLivraisonEffective,
                      kilometrageDepart,
                      uniteKilometrage: 'km',
                    });
                    if (!resultat.success) {
                      setErreurValidation(t('validation:requis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('ventes:dossier.transitions.confirmer')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionOuverte === 'annuler' || actionOuverte === 'abandonner' ? (
            <div className="flex flex-col gap-4">
              <LegendeChampsObligatoires>
                {t('commun:formulaires.champsObligatoiresLegende')}
              </LegendeChampsObligatoires>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-motif" requis>
                  {t('ventes:dossier.transitions.motif')}
                </Label>
                <Textarea
                  id="dossier-motif"
                  required
                  value={motif}
                  onChange={(evenement) => setMotif(evenement.target.value)}
                />
                {erreurValidation ? (
                  <p className="texte-libelle text-destructive">{erreurValidation}</p>
                ) : null}
              </div>
              <p className="texte-corps text-muted-foreground">
                {t('ventes:dossier.transitions.annulerConfirmationVehicule')}
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('commun:actions.annuler')}</Button>
                </DialogClose>
                <Button
                  variant={actionOuverte === 'annuler' ? 'destructive' : 'default'}
                  disabled={mutationActive?.isPending}
                  onClick={() => {
                    const schema =
                      actionOuverte === 'annuler'
                        ? schemaActionAnnulerDossierVente
                        : schemaActionAbandonnerDossierVente;
                    const resultat = schema.safeParse({ motif });
                    if (!resultat.success) {
                      setErreurValidation(t('ventes:dossier.transitions.motifRequis'));
                      return;
                    }
                    setErreurValidation(null);
                    soumettre(resultat.data);
                  }}
                >
                  {t('ventes:dossier.transitions.confirmer')}
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
