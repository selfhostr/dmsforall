import { Ban } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import {
  type ReponseLigneOr,
  type EntreeFacturationOrdreReparation,
  type SelecteurGroupePayeurOr,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { messageErreurMarquage } from '@/ecrans/atelier/messages-erreur-mutation';
import { useMarquerLignesRealisees } from '@/hooks/atelier/useActionsLigneOr';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { useSession } from '@/hooks/useSession';
import { useFacturationOrdreReparation } from '@/hooks/facturation/useFacturationOrdreReparation';
import { formaterMontant, formaterMontantAvecDevise } from '@/lib/formats';

import {
  calculerGroupesFacturables,
  cleGroupe,
  libelleGroupe,
  STATUTS_INDECIS,
  type GroupePayeur,
} from './groupes-facturables';
import {
  DialogueFacturerEtEncaisser,
  type DemandeFacturerEtEncaisser,
} from './DialogueFacturerEtEncaisser';
import { peutEmettreFacture, peutEncaisser } from './droits';

/** L'atelier (module `atelier`, contrat `ReponseOrdreReparation`) ne porte AUCUN champ `devise` —
 *  à la différence de `document_vente` (migration `0015`), un OR n'existe qu'en CHF, sans
 *  exception. La facture créée par cet écran est donc structurellement en CHF : ce n'est pas une
 *  valeur devinée par défaut, c'est la seule devise que ce domaine connaisse aujourd'hui. */
const DEVISE_FACTURATION_OR = 'CHF' as const;

/** Parmi les statuts indécis, ceux qu'une action « Marquer réalisées » fait avancer
 *  (`validee`/`en_cours` -> `realisee`). `proposee`/`a_valider` attendent une décision du client ou
 *  du réceptionnaire : cela se règle dans l'OR, pas ici. */
const STATUTS_MARQUABLES: ReadonlySet<ReponseLigneOr['statut']> = new Set(['validee', 'en_cours']);

/** Segment i18n du statut de ligne (`or:lignes.statuts.<segment>`). */
function segmentStatutLigne(statut: ReponseLigneOr['statut']): string {
  return statut === 'a_valider' ? 'aValider' : statut === 'en_cours' ? 'enCours' : statut;
}

/**
 * Écran 1 — Passer un OR en facture (`design-etape-2-facturation.md` §3). Route :
 * `/ordres-reparation/:orId/facturer`.
 *
 * Contrat `POST /ordres-reparation/{orId}/facturer` (`RF-81`) désormais GELÉ dans
 * `packages/shared/src/contrats/facturation/facturer-or.ts` — cet écran sélectionne des GROUPES
 * `(payeur, payeurClientId)` (`MD-62`), jamais des lignes ni un `payeur` seul.
 *
 * ÉCARTS RÉSOLUS depuis la version provisoire de cet écran : `ACTIONS_ORDRE_REPARATION` publie
 * désormais `'facturer'` ; le démontage facturable proposé (`RF-90`/`RF-91`) est exposé
 * (`or.demontageFacturablePropose`) ; le motif de report par groupe (§9, risque n°4 du design) est
 * désormais réellement envoyé au serveur (`motifsReport`), plus seulement conservé en état local.
 *
 * ÉCARTS RESTANTS, signalés plutôt que simulés :
 *  - La consigne d'échange standard (`RF-100`) n'a toujours aucune donnée porteuse sur l'OR — la clé
 *    `facturation:facturerOr.consigne.message` existe déjà en i18n mais reste inutilisée ici.
 *  - Le lien « Voir les travaux reportés » pointe vers la fiche véhicule : aucun écran dédié aux
 *    travaux reportés n'est confirmé dans ce lot.
 */
function ContenuFacturerOrdreReparation({
  onFacturerEtEncaisser,
}: {
  readonly onFacturerEtEncaisser: (demande: DemandeFacturerEtEncaisser) => void;
}) {
  const { t } = useTranslation(['facturation', 'or', 'commun', 'erreurs']);
  const { orId } = useParams<{ orId: string }>();
  const navigate = useNavigate();

  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  const requete = useOrdreReparation(orId);
  const facturation = useFacturationOrdreReparation();
  const marquerRealisees = useMarquerLignesRealisees(orId ?? '');

  const [groupesDecoches, setGroupesDecoches] = useState<ReadonlySet<string>>(new Set());
  const [motifsReportSaisis, setMotifsReportSaisis] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [inclureDemontageRefuse, setInclureDemontageRefuse] = useState(false);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const groupes = useMemo<readonly GroupePayeur[]>(
    () => (requete.data ? calculerGroupesFacturables(requete.data) : []),
    [requete.data],
  );

  // Titre unique, posé via `GabaritEcran` sur les QUATRE branches de retour de cet écran
  // (chargement/erreur/vide/normal) — chantier « titres doublés & espacements », 17.08.2026 :
  // avant ce chantier, seule la branche « vide » portait un h1 VISIBLE, les branches chargement/
  // erreur un h1 `sr-only`, et la branche normale n'en portait AUCUN. La détection automatique du
  // gabarit tranche seule la visibilité ; aucun `titreVisible` posé ici.
  if (requete.isPending) {
    return (
      <GabaritEcran titre={t('facturation:facturerOr.titre')}>
        <p className="texte-corps text-muted-foreground">
          {t('facturation:facturerOr.chargement')}
        </p>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (requete.isError) {
    return (
      <GabaritEcran titre={t('facturation:facturerOr.titre')}>
        <EtatErreur
          titre={t('facturation:facturerOr.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </GabaritEcran>
    );
  }

  const or = requete.data;
  const lignesIndecises = or.lignes.filter((ligne) => STATUTS_INDECIS.has(ligne.statut));
  const lignesRefusees = or.lignes.filter((ligne) => ligne.statut === 'refusee');
  const bloque = lignesIndecises.length > 0;
  const lignesMarquables = lignesIndecises.filter((ligne) => STATUTS_MARQUABLES.has(ligne.statut));
  const groupesCoches = groupes.filter(
    (groupe) => !groupesDecoches.has(cleGroupe(groupe.payeur, groupe.payeurClientId)),
  );
  const montantTotalCentimes = groupesCoches.reduce(
    (somme, groupe) => somme + (groupe.totalTtcCentimes ?? 0),
    0,
  );
  const clientGroupeCoche = groupesCoches.some((groupe) => groupe.payeur === 'client');

  function basculerGroupe(cle: string) {
    setGroupesDecoches((valeur) => {
      const suivant = new Set(valeur);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  }

  function reponseVersFacture(reponse: {
    readonly facturesCreees: readonly { readonly id: string }[];
  }) {
    const premiere = reponse.facturesCreees[0];
    if (premiere) navigate(`/factures/${premiere.id}`);
  }

  function construireEntree(): EntreeFacturationOrdreReparation {
    const groupesSelectionnes: SelecteurGroupePayeurOr[] = groupesCoches.map((groupe) => ({
      payeur: groupe.payeur,
      payeurClientId: groupe.payeurClientId,
    }));
    const motifsReport = groupes
      .filter((groupe) => groupesDecoches.has(cleGroupe(groupe.payeur, groupe.payeurClientId)))
      .map((groupe) => ({
        payeur: groupe.payeur,
        payeurClientId: groupe.payeurClientId,
        motif: (motifsReportSaisis[cleGroupe(groupe.payeur, groupe.payeurClientId)] ?? '').trim(),
      }))
      .filter((entree) => entree.motif !== '');
    return {
      groupes: groupesSelectionnes,
      motifsReport,
      inclureDemontageRefuse: clientGroupeCoche ? inclureDemontageRefuse : undefined,
    };
  }

  function soumettre() {
    if (!orId) return;
    facturation.soumettre(orId, construireEntree(), { onSuccess: reponseVersFacture });
  }

  // « Facturer et encaisser » : une seule facture à la fois (un seul groupe payeur coché) et un
  // rôle qui peut créer, émettre ET encaisser — sinon le parcours détaillé reste la seule voie.
  const groupeUnique = groupesCoches.length === 1 ? groupesCoches[0] : undefined;
  const peutFacturerEtEncaisser =
    groupeUnique !== undefined && peutEmettreFacture(role) && peutEncaisser(role);

  function ouvrirFacturerEtEncaisser() {
    if (!orId || !groupeUnique) return;
    onFacturerEtEncaisser({
      orId,
      entree: construireEntree(),
      totalEstimeCentimes: groupeUnique.totalTtcCentimes,
      destinataireNom: groupeUnique.destinataire?.nomAffiche ?? libelleGroupe(t, groupeUnique),
    });
  }

  if (groupes.length === 0 && !bloque) {
    return (
      <GabaritEcran titre={t('facturation:facturerOr.titre')}>
        <EtatVide
          titre={t('facturation:facturerOr.vide.titre')}
          description={t('facturation:facturerOr.vide.description')}
        />
      </GabaritEcran>
    );
  }

  return (
    <GabaritEcran titre={t('facturation:facturerOr.titre')}>
      {/* DESIGN.md « bordure structurelle » — conservée : barre de contexte qui porte une VRAIE
          action (« Retour à l'OR »), même famille que la barre de filtres/les onglets de
          `EcranListeFactures.tsx`, pas un simple regroupement d'identité. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="texte-corps font-semibold text-foreground">{or.numero}</span>
          <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />
          <IdentiteClient client={or.client} />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate(`/ordres-reparation/${or.id}`)}
        >
          {t('facturation:facturerOr.retour')}
        </Button>
      </div>

      {bloque ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-md border border-statut-danger bg-statut-danger-fond p-4"
        >
          <div className="flex items-start gap-3">
            <Ban aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-danger" />
            <p className="flex-1 texte-corps font-medium text-foreground">
              {t('facturation:facturerOr.refusBloquant.titre', { count: lignesIndecises.length })}
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {lignesIndecises.map((ligne) => {
              const marquable = STATUTS_MARQUABLES.has(ligne.statut);
              return (
                <li key={ligne.id} className="flex items-center justify-between gap-2 texte-corps">
                  <span>
                    {ligne.designation} —{' '}
                    {t(`or:lignes.statuts.${segmentStatutLigne(ligne.statut)}`)}
                    <span className="text-muted-foreground">
                      {' · '}
                      {t(
                        `facturation:facturerOr.refusBloquant.aFaire.${segmentStatutLigne(ligne.statut)}`,
                      )}
                    </span>
                  </span>
                  {marquable ? null : (
                    <button
                      type="button"
                      className="shrink-0 font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => navigate(`/ordres-reparation/${or.id}`)}
                    >
                      {t('facturation:facturerOr.refusBloquant.resoudre')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {lignesMarquables.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={marquerRealisees.isPending}
              onClick={() => marquerRealisees.mutate(lignesMarquables.map((ligne) => ligne.id))}
            >
              {marquerRealisees.isPending
                ? t('facturation:facturerOr.refusBloquant.marquageEnCours')
                : t('facturation:facturerOr.refusBloquant.marquerRealisees', {
                    count: lignesMarquables.length,
                  })}
            </Button>
          ) : null}
          {marquerRealisees.isError ? (
            <p className="texte-libelle text-destructive">
              {messageErreurMarquage(marquerRealisees.error, t)}
            </p>
          ) : null}
        </div>
      ) : null}

      {groupes.map((groupe) => {
        const cle = cleGroupe(groupe.payeur, groupe.payeurClientId);
        const decoche = groupesDecoches.has(cle);
        return (
          // DESIGN.md « bordure structurelle » — conservée : bloc gérant un VRAI contrôle
          // (case à cocher « facturer maintenant », zone de saisie du motif de report qui
          // apparaît/disparaît selon cet état), pas un simple regroupement de lignes.
          <div key={cle} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="texte-titre-section font-semibold text-foreground">
                {t('facturation:facturerOr.groupe.titre', { payeur: libelleGroupe(t, groupe) })}
              </h2>
              <label
                htmlFor={`facturer-or-groupe-${cle}`}
                className="flex items-center gap-2 texte-corps"
              >
                <Checkbox
                  id={`facturer-or-groupe-${cle}`}
                  checked={!decoche}
                  onCheckedChange={() => basculerGroupe(cle)}
                />
                {t('facturation:facturerOr.groupe.facturerMaintenant')}
              </label>
            </div>
            <ul className="flex flex-col gap-1">
              {groupe.lignes.map((ligne) => (
                <li key={ligne.id} className="flex items-center justify-between texte-corps">
                  <span>
                    {ligne.designation}
                    {ligne.payeur === 'garage' ? (
                      <span className="ml-1 texte-libelle text-muted-foreground">
                        ({t('or:lignes.payeurs.garage')})
                      </span>
                    ) : null}
                  </span>
                  {/* Pas de préfixe devise ici : toutes les lignes d'un même groupe payeur partagent
                      la devise structurellement CHF de l'OR, déjà annoncée sur le sous-total. */}
                  <span className="tabular-nums">
                    {ligne.montants ? formaterMontant(ligne.montants.montantTtcCentimes) : ''}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t pt-2 texte-corps font-medium">
              <span>{t('facturation:facturerOr.groupe.sousTotal')}</span>
              <span className="tabular-nums">
                {groupe.totalTtcCentimes !== undefined
                  ? formaterMontantAvecDevise(groupe.totalTtcCentimes, DEVISE_FACTURATION_OR)
                  : ''}
              </span>
            </div>
            {groupe.payeur === 'client' && !decoche && or.demontageFacturablePropose ? (
              <div className="flex flex-col gap-1.5 rounded-md bg-muted px-3 py-2">
                <p className="texte-corps text-foreground">
                  {t('facturation:facturerOr.demontage.message', {
                    montant: formaterMontantAvecDevise(
                      or.demontageFacturablePropose.montantTtcCentimes,
                      DEVISE_FACTURATION_OR,
                    ),
                  })}
                </p>
                <label
                  htmlFor="facturer-or-demontage-refuse"
                  className="flex items-center gap-2 texte-corps"
                >
                  <Checkbox
                    id="facturer-or-demontage-refuse"
                    checked={inclureDemontageRefuse}
                    onCheckedChange={(coche) => setInclureDemontageRefuse(coche === true)}
                  />
                  {t('facturation:facturerOr.demontage.ajouter')}
                </label>
              </div>
            ) : null}
            {decoche ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <Textarea
                  aria-label={t('facturation:facturerOr.groupe.motifReport')}
                  placeholder={t('facturation:facturerOr.groupe.motifReportPlaceholder')}
                  value={motifsReportSaisis[cle] ?? ''}
                  onChange={(evenement) =>
                    setMotifsReportSaisis((valeur) => ({
                      ...valeur,
                      [cle]: evenement.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {lignesRefusees.length > 0 ? (
        <div className="rounded-md border bg-muted px-4 py-3 texte-corps text-foreground">
          <p>
            {t('facturation:facturerOr.lignesRefusees.message', { count: lignesRefusees.length })}
          </p>
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => navigate(`/vehicules/${or.vehicule.id}`)}
          >
            {t('facturation:facturerOr.lignesRefusees.voir')}
          </button>
        </div>
      ) : null}

      {facturation.erreur ? (
        <p className="texte-libelle text-destructive">{messageErreur(facturation.erreur, t)}</p>
      ) : null}

      {facturation.confirmationsRequises.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-statut-attention bg-statut-attention-fond p-3"
        >
          <p className="texte-corps text-statut-attention">
            {facturation.erreurActive ? messageErreur(facturation.erreurActive, t) : ''}
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => setConfirmationOuverte(true)}
          >
            {t('commun:actions.continuerQuandMeme')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {peutFacturerEtEncaisser ? (
          <Button
            type="button"
            disabled={bloque || facturation.enCours}
            onClick={ouvrirFacturerEtEncaisser}
          >
            {t('facturation:facturerEncaisser.bouton')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={peutFacturerEtEncaisser ? 'outline' : 'default'}
          disabled={bloque || groupesCoches.length === 0 || facturation.enCours}
          onClick={soumettre}
        >
          {facturation.enCours
            ? t('facturation:facturerOr.action.enCours')
            : groupesCoches.length <= 1
              ? t('facturation:facturerOr.action.unSingulier', {
                  payeur: groupesCoches[0] ? libelleGroupe(t, groupesCoches[0]) : '',
                  montant: formaterMontantAvecDevise(montantTotalCentimes, DEVISE_FACTURATION_OR),
                })
              : t('facturation:facturerOr.action.plusieurs', {
                  count: groupesCoches.length,
                  montant: formaterMontantAvecDevise(montantTotalCentimes, DEVISE_FACTURATION_OR),
                })}
        </Button>
      </div>

      <AvertissementConfirmable
        ouvert={confirmationOuverte}
        onOuvertChange={setConfirmationOuverte}
        titre={t('facturation:facturerOr.titre')}
        description={facturation.erreurActive ? messageErreur(facturation.erreurActive, t) : ''}
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() => {
          setConfirmationOuverte(false);
          facturation.confirmerEtResoumettre({ onSuccess: reponseVersFacture });
        }}
        enCours={facturation.enCours}
      />
    </GabaritEcran>
  );
}

export function EcranFacturerOrdreReparation() {
  const navigate = useNavigate();
  const { orId } = useParams<{ orId: string }>();
  // L'état du dialogue vit ICI, au-dessus du contenu : une fois l'OR facturé, la liste des lignes à
  // facturer se vide et `ContenuFacturerOrdreReparation` bascule sur l'état vide — le dialogue,
  // lui, doit survivre pour afficher l'encaissement et le PDF.
  const [demande, setDemande] = useState<DemandeFacturerEtEncaisser | null>(null);

  return (
    <>
      <ContenuFacturerOrdreReparation onFacturerEtEncaisser={setDemande} />
      <DialogueFacturerEtEncaisser
        demande={demande}
        onFermer={({ factureId }) => {
          setDemande(null);
          if (factureId && orId) navigate(`/ordres-reparation/${orId}`);
        }}
        onOuvrirFacture={(factureId) => navigate(`/factures/${factureId}`)}
      />
    </>
  );
}
