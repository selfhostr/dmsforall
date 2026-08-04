import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { useCreerBonCommandeDossier } from '@/hooks/ventes/dossiers/useCreerBonCommandeDossier';
import {
  useAbandonnerDossierVente,
  useAnnulerDossierVente,
  useCloturerDossierVente,
  useEngagerDossierVente,
  useLivrerDossierVente,
  useMarquerDossierPretALivrer,
  usePreparerDossierVente,
} from '@/hooks/ventes/dossiers/useTransitionsDossierVente';
import { formaterMontant } from '@/lib/formats';

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

interface Props {
  readonly dossier: ReponseDossierVente;
}

/**
 * Barre d'actions du dossier de vente (§6.2, §7.3 du design) — copie conforme de `PanneauActionsOr`
 * (atelier) : LES actions listées par `dossier.actionsDisponibles`, jamais devinées depuis
 * `dossier.statut`. Chaque clic ouvre une confirmation, jamais une exécution directe.
 *
 * Exception documentée : `livrer` compose sa description de confirmation DYNAMIQUEMENT (design
 * §10.1) — les effets de bord de cette transition (détention transférée, garantie VN, reprise qui
 * entre en stock) sont invisibles autrement.
 */
export function PanneauActionsDossierVente({ dossier }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs', 'validation']);
  const [actionOuverte, setActionOuverte] = useState<ActionDossierVente | null>(null);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);
  const [derniereEntree, setDerniereEntree] = useState<object | null>(null);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  const engager = useEngagerDossierVente(dossier.id);
  const creationBonCommande = useCreerBonCommandeDossier(dossier);
  const preparer = usePreparerDossierVente(dossier.id);
  const marquerPretALivrer = useMarquerDossierPretALivrer(dossier.id);
  const livrer = useLivrerDossierVente(dossier.id);
  const cloturer = useCloturerDossierVente(dossier.id);
  const annuler = useAnnulerDossierVente(dossier.id);
  const abandonner = useAbandonnerDossierVente(dossier.id);

  const [bonCommandeDocumentId, setBonCommandeDocumentId] = useState('');
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

  const bonsCommande = dossier.documents.filter((d) => d.typeDocument === 'bon_commande');
  const repriseNegocieePresente = dossier.reprise?.statut === 'negociee';

  return (
    <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('ventes:dossier.fiche.titre')}
      >
        {actionsTransition.map((action) => {
          const cle = CLES_TRANSITION[action];
          if (!cle) return null;
          const variant =
            action === 'annuler' ? 'destructive' : action === 'engager' ? 'default' : 'outline';
          return (
            <Button key={action} type="button" variant={variant} onClick={() => ouvrir(action)}>
              {t(`ventes:dossier.transitions.${cle}`)}
            </Button>
          );
        })}
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

          {actionOuverte === 'engager' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-engager-bon-commande">
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
                      disabled={creationBonCommande.enCours}
                      onClick={() =>
                        creationBonCommande.creer({
                          onSuccess: (document) => setBonCommandeDocumentId(document.id),
                        })
                      }
                    >
                      {t('ventes:dossier.transitions.creerBonCommande')}
                    </Button>
                    {creationBonCommande.erreur ? (
                      <p className="texte-libelle text-destructive" role="alert">
                        {messageErreur(creationBonCommande.erreur, t)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <Select value={bonCommandeDocumentId} onValueChange={setBonCommandeDocumentId}>
                    <SelectTrigger id="dossier-engager-bon-commande">
                      <SelectValue placeholder={t('ventes:dossier.transitions.bonCommande')} />
                    </SelectTrigger>
                    <SelectContent>
                      {bonsCommande.map((document) => (
                        <SelectItem key={document.id} value={document.id}>
                          {document.numero ?? document.id}
                          {document.totalTtcCentimes !== undefined
                            ? ` · ${formaterMontant(document.totalTtcCentimes)}`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-engager-identite">
                  {t('ventes:dossier.transitions.identitePieceType')}
                </Label>
                <Select value={identitePieceType} onValueChange={setIdentitePieceType}>
                  <SelectTrigger id="dossier-engager-identite">
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
                  <Textarea
                    value={identitePieceAutre}
                    onChange={(evenement) => setIdentitePieceAutre(evenement.target.value)}
                  />
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-livrer-date">
                  {t('ventes:dossier.transitions.dateLivraisonEffective')}
                </Label>
                <DateInput
                  id="dossier-livrer-date"
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dossier-motif">{t('ventes:dossier.transitions.motif')}</Label>
                <Textarea
                  id="dossier-motif"
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
