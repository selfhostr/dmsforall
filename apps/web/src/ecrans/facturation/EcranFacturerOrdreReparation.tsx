import { Ban } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import {
  PAYEURS_FACTURATION_SELECTIONNABLES,
  type PayeurFacturationSelectionnable,
  type PayeurLigneOr,
  type ReponseLigneOr,
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
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { useFacturationOrdreReparation } from '@/hooks/facturation/useFacturationOrdreReparation';
import { formaterMontant } from '@/lib/formats';

/** Statuts de ligne « indécis » qui bloquent la facturation (`RF-86`) : ni réalisées (facturables),
 *  ni refusées/annulées (définitivement écartées). */
const STATUTS_INDECIS: ReadonlySet<ReponseLigneOr['statut']> = new Set([
  'proposee',
  'a_valider',
  'validee',
  'en_cours',
]);

/** `garage` n'a pas de groupe séparé (`RF-92`) : ses lignes, valorisées à `0.00` (RM-70), rejoignent
 *  le groupe `'client'` — `PAYEURS_FACTURATION_SELECTIONNABLES` (contrat gelé) exclut `'garage'` par
 *  construction, donc toute autre valeur de `PayeurLigneOr` s'y range identiquement. */
function payeurFacturable(payeur: PayeurLigneOr): PayeurFacturationSelectionnable {
  return payeur === 'garage' ? 'client' : (payeur as PayeurFacturationSelectionnable);
}

/** Clé de regroupement `(payeur, payeurClientId)` (`MD-62`) — jamais `payeur` seul : deux
 *  assurances distinctes sur le même OR (deux sinistres qui se croisent sur la même voiture) sont
 *  deux groupes, donc deux factures à deux destinataires, jamais fusionnées. */
function cleGroupe(payeur: PayeurFacturationSelectionnable, payeurClientId: string | null): string {
  return `${payeur}:${payeurClientId ?? ''}`;
}

interface GroupePayeur {
  readonly payeur: PayeurFacturationSelectionnable;
  readonly payeurClientId: string | null;
  /** Résolu depuis `or.totauxParPayeur` (destinataire projeté par le serveur, `RF-87`) ; pour le
   *  groupe `'client'`, retombe sur le client de l'OR lui-même si les totaux sont absents (rôle
   *  sans droit aux montants). */
  readonly destinataire: { readonly clientId: string; readonly nomAffiche: string } | null;
  readonly lignes: readonly ReponseLigneOr[];
  readonly totalTtcCentimes: number | undefined;
}

/** Libellé affiché du groupe — « Assurance — Zurich Assurances » pour désambiguïser deux groupes
 *  du même `payeur` (design §3.2), jamais juste « Assurance » qui redeviendrait ambigu à deux
 *  assureurs sur le même OR. */
function libelleGroupe(
  t: (cle: string, options?: Record<string, unknown>) => string,
  groupe: GroupePayeur,
): string {
  const libellePayeur = t(`or:lignes.payeurs.${groupe.payeur}`);
  if (groupe.payeur === 'client' || !groupe.destinataire) return libellePayeur;
  return `${libellePayeur} — ${groupe.destinataire.nomAffiche}`;
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
export function EcranFacturerOrdreReparation() {
  const { t } = useTranslation(['facturation', 'or', 'commun', 'erreurs']);
  const { orId } = useParams<{ orId: string }>();
  const navigate = useNavigate();

  const requete = useOrdreReparation(orId);
  const facturation = useFacturationOrdreReparation();

  const [groupesDecoches, setGroupesDecoches] = useState<ReadonlySet<string>>(new Set());
  const [motifsReportSaisis, setMotifsReportSaisis] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [inclureDemontageRefuse, setInclureDemontageRefuse] = useState(false);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const groupes = useMemo<readonly GroupePayeur[]>(() => {
    if (!requete.data) return [];
    const or = requete.data;
    const lignesFacturables = or.lignes.filter(
      (ligne) => ligne.statut === 'realisee' && ligne.factureId === null,
    );
    const parGroupe = new Map<
      string,
      {
        payeur: PayeurFacturationSelectionnable;
        payeurClientId: string | null;
        lignes: ReponseLigneOr[];
      }
    >();
    for (const ligne of lignesFacturables) {
      const payeur = payeurFacturable(ligne.payeur);
      const payeurClientId = payeur === 'client' ? null : ligne.payeurClientId;
      const cle = cleGroupe(payeur, payeurClientId);
      const existant = parGroupe.get(cle);
      if (existant) existant.lignes.push(ligne);
      else parGroupe.set(cle, { payeur, payeurClientId, lignes: [ligne] });
    }
    return [...parGroupe.values()]
      .sort((a, b) => {
        const rang =
          PAYEURS_FACTURATION_SELECTIONNABLES.indexOf(a.payeur) -
          PAYEURS_FACTURATION_SELECTIONNABLES.indexOf(b.payeur);
        return rang !== 0 ? rang : (a.payeurClientId ?? '').localeCompare(b.payeurClientId ?? '');
      })
      .map((g) => {
        const totaux = or.totauxParPayeur?.find(
          (t_) => t_.payeur === g.payeur && (t_.payeurClientId ?? null) === g.payeurClientId,
        );
        const destinataire =
          g.payeur === 'client'
            ? (totaux?.destinataire ?? { clientId: or.client.id, nomAffiche: or.client.nomAffiche })
            : (totaux?.destinataire ?? null);
        return {
          payeur: g.payeur,
          payeurClientId: g.payeurClientId,
          destinataire,
          lignes: g.lignes,
          totalTtcCentimes: totaux?.montantTtcCentimes,
        };
      });
  }, [requete.data]);

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('facturation:facturerOr.titre')}</h1>
        <p className="texte-corps text-muted-foreground">
          {t('facturation:facturerOr.chargement')}
        </p>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('facturation:facturerOr.titre')}</h1>
        <EtatErreur
          titre={t('facturation:facturerOr.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const or = requete.data;
  const lignesIndecises = or.lignes.filter((ligne) => STATUTS_INDECIS.has(ligne.statut));
  const lignesRefusees = or.lignes.filter((ligne) => ligne.statut === 'refusee');
  const bloque = lignesIndecises.length > 0;
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

  function soumettre() {
    if (!orId) return;
    const groupesSelectionnes: SelecteurGroupePayeurOr[] = groupesCoches.map((groupe) => ({
      payeur: groupe.payeur,
      payeurClientId: groupe.payeurClientId,
    }));
    // Motif de report FACULTATIF (design §3.3 : « décocher un groupe payeur sans obliger de motif »)
    // — un groupe décoché sans texte saisi reste un report valide, il n'entre simplement pas dans
    // `motifsReport` (position par défaut du contrat, pas une erreur).
    const motifsReport = groupes
      .filter((groupe) => groupesDecoches.has(cleGroupe(groupe.payeur, groupe.payeurClientId)))
      .map((groupe) => ({
        payeur: groupe.payeur,
        payeurClientId: groupe.payeurClientId,
        motif: (motifsReportSaisis[cleGroupe(groupe.payeur, groupe.payeurClientId)] ?? '').trim(),
      }))
      .filter((entree) => entree.motif !== '');

    facturation.soumettre(
      orId,
      {
        groupes: groupesSelectionnes,
        motifsReport,
        // Sans effet côté serveur si `groupes` ne contient pas de sélecteur `payeur = 'client'`
        // (contrat) — n'envoyé que quand ce groupe est effectivement coché, pour rester honnête sur
        // ce que la case à cocher affichée signifie réellement.
        inclureDemontageRefuse: clientGroupeCoche ? inclureDemontageRefuse : undefined,
      },
      { onSuccess: reponseVersFacture },
    );
  }

  if (groupes.length === 0 && !bloque) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="texte-titre-section font-semibold text-foreground">
          {t('facturation:facturerOr.titre')}
        </h1>
        <EtatVide
          titre={t('facturation:facturerOr.vide.titre')}
          description={t('facturation:facturerOr.vide.description')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
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
          className="flex flex-col gap-3 rounded-md border border-statut-danger/40 bg-statut-danger/12 p-4"
        >
          <div className="flex items-start gap-3">
            <Ban aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-danger" />
            <p className="flex-1 texte-corps font-medium text-foreground">
              {t('facturation:facturerOr.refusBloquant.titre', { count: lignesIndecises.length })}
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {lignesIndecises.map((ligne) => (
              <li key={ligne.id} className="flex items-center justify-between gap-2 texte-corps">
                <span>
                  {ligne.designation} —{' '}
                  {t(
                    `or:lignes.statuts.${ligne.statut === 'a_valider' ? 'aValider' : ligne.statut === 'en_cours' ? 'enCours' : ligne.statut}`,
                  )}
                </span>
                <button
                  type="button"
                  className="shrink-0 font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/ordres-reparation/${or.id}`)}
                >
                  {t('facturation:facturerOr.refusBloquant.resoudre')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {groupes.map((groupe) => {
        const cle = cleGroupe(groupe.payeur, groupe.payeurClientId);
        const decoche = groupesDecoches.has(cle);
        return (
          <div key={cle} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="texte-titre-section font-semibold text-foreground">
                {t('facturation:facturerOr.groupe.titre', { payeur: libelleGroupe(t, groupe) })}
              </h2>
              <label className="flex items-center gap-2 texte-corps">
                <Checkbox checked={!decoche} onCheckedChange={() => basculerGroupe(cle)} />
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
                  ? formaterMontant(groupe.totalTtcCentimes)
                  : ''}
              </span>
            </div>
            {groupe.payeur === 'client' && !decoche && or.demontageFacturablePropose ? (
              <div className="flex flex-col gap-1.5 rounded-md bg-muted px-3 py-2">
                <p className="texte-corps text-foreground">
                  {t('facturation:facturerOr.demontage.message', {
                    montant: formaterMontant(or.demontageFacturablePropose.montantTtcCentimes),
                  })}
                </p>
                <label className="flex items-center gap-2 texte-corps">
                  <Checkbox
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
          className="flex flex-col gap-2 rounded-md border border-statut-attention/40 bg-statut-attention/10 p-3"
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

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={bloque || groupesCoches.length === 0 || facturation.enCours}
          onClick={soumettre}
        >
          {facturation.enCours
            ? t('facturation:facturerOr.action.enCours')
            : groupesCoches.length <= 1
              ? t('facturation:facturerOr.action.unSingulier', {
                  payeur: groupesCoches[0] ? libelleGroupe(t, groupesCoches[0]) : '',
                  montant: formaterMontant(montantTotalCentimes),
                })
              : t('facturation:facturerOr.action.plusieurs', {
                  count: groupesCoches.length,
                  montant: formaterMontant(montantTotalCentimes),
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
    </div>
  );
}
