import { Clock, PackageCheck, ShieldAlert, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseLigneOr, StatutLigneOr, TypeLigneOr } from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
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
import { MontantMasque } from '@/composants/comptoir/MontantMasque';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVide } from '@/composants/commun/EtatVide';
import {
  peutAnnulerLigneOr,
  peutRefuserLigneOr,
  peutReporterTravail,
  peutValiderLigneOr,
} from '@/ecrans/atelier/droits';
import {
  useAnnulerLignesOr,
  useRefuserLignesOr,
  useValiderLignesOr,
} from '@/hooks/atelier/useActionsLigneOr';
import { useSession } from '@/hooks/useSession';
import { formaterMontant, formaterMontantAvecDevise, formaterPourmille } from '@/lib/formats';

import { DialogueReporterTravail } from '@/ecrans/vehicules/DialogueReporterTravail';

import { DialogueAccordClient } from './DialogueAccordClient';
import { messagesErreurMutation } from './messages-erreur-mutation';

const FORMATEUR_QUANTITE = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });

/** Millièmes (contrat `quantiteMillieme`, `2500` = 2,5) -> "2.5". Formateur local : la quantité
 *  n'est ni un montant ni un kilométrage, aucun helper partagé (`lib/formats.ts`) ne la couvre. */
function formaterQuantite(quantiteMillieme: number): string {
  return FORMATEUR_QUANTITE.format(quantiteMillieme / 1000);
}

/** Centièmes d'heure (`tempsBaremeCentiemes`/`tempsReelCentiemes`, P-03) -> "1.50 h". */
function formaterTempsHeures(centiemes: number): string {
  return `${(centiemes / 100).toFixed(2)} h`;
}

/** Mêmes deux types que `DialogueAjoutLigneOr.TYPES_MAIN_OEUVRE` (non exporté de ce fichier
 *  voisin) — seuls ceux-là portent `tauxHoraireCentimes` (§ contrat `ReponseLigneOr`). */
const TYPES_MAIN_OEUVRE: ReadonlySet<TypeLigneOr> = new Set([
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
]);

// `TypeLigneOr` -> suffixe de `or:lignes.types` : mapping NON trivial (ex. `taxe` -> `taxeElimination`,
// `main_oeuvre_bareme` -> `mainOeuvreBaremee`), donc explicite plutôt que dérivé par manipulation
// de chaîne — même précaution que `BadgeStatutOr`. Exporté : `DialogueAjoutLigneOr` réutilise CE
// mapping pour libeller son sélecteur de type, plutôt que d'en dupliquer un second qui pourrait
// diverger silencieusement du premier.
export const CLES_TYPE: Record<TypeLigneOr, string> = {
  main_oeuvre_bareme: 'mainOeuvreBaremee',
  main_oeuvre_temps_reel: 'mainOeuvreTempsReel',
  forfait: 'forfait',
  piece: 'piece',
  fourniture: 'fourniture',
  sous_traitance: 'sousTraitance',
  produit_atelier: 'produitAtelier',
  taxe: 'taxeElimination',
  remise: 'remise',
  texte: 'texte',
};

const CLES_STATUT: Record<StatutLigneOr, string> = {
  proposee: 'proposee',
  a_valider: 'aValider',
  validee: 'validee',
  en_cours: 'enCours',
  realisee: 'realisee',
  facturee: 'facturee',
  refusee: 'refusee',
  annulee: 'annulee',
};

type ActionGroupeeLigne = 'valider' | 'refuser' | 'annuler';

interface Props {
  readonly orId: string;
  readonly lignes: readonly ReponseLigneOr[];
  readonly lignesTronquees: boolean;
  /** Plafond actuel de l'OR (centimes), repris tel quel dans le devis de l'accord client. */
  readonly plafondCentimes?: number;
  /** Véhicule de l'OR : active « Reporter ce travail » sur les lignes pas encore réalisées. */
  readonly vehiculeId?: string;
}

/** Lignes qu'on peut encore décider de ne pas faire maintenant : ni réalisées, ni facturées. */
const STATUTS_REPORTABLES: ReadonlySet<ReponseLigneOr['statut']> = new Set([
  'proposee',
  'a_valider',
  'validee',
  'refusee',
]);

/**
 * Lignes de l'OR (travaux/pièces/forfaits…). Le montant total n'est JAMAIS recalculé côté client
 * (§ contrat) — uniquement affiché depuis `ligne.montants`, ou laissé vide (jamais « 0.00 ») pour
 * un rôle sans droit aux montants.
 *
 * Sélection multi-lignes + actions groupées (`valider-lignes`/`refuser-lignes`/`annuler-lignes`,
 * §7.8) : une colonne de case à cocher n'apparaît QUE pour un rôle qui porte au moins un des trois
 * droits de décision (`peutValiderLigneOr`/`peutRefuserLigneOr`/`peutAnnulerLigneOr`,
 * `ecrans/atelier/droits.ts`) — un rôle qui ne peut rien décider derrière (technicien, magasinier)
 * garde la table exactement lecture seule d'avant. Aucun filtrage CLIENT par statut de ligne avant
 * l'envoi (ex. n'autoriser « Valider » que sur une sélection 100% `proposee`/`a_valider`) : la
 * transition atomique tout-ou-rien est arbitrée par le serveur, qui répond `409
 * LIGNE_TRANSITION_INTERDITE` le cas échéant — même doctrine que `PanneauActionsOr` (« une action
 * affichée mais refusée à l'appel est pire que pas d'action », mais jamais un succès silencieux).
 * C'est ce qui referme la boucle du lien « Résoudre » de `EcranFacturerOrdreReparation` (facturation,
 * hors périmètre de ce fichier) : il navigue vers cette fiche SANS cibler la ligne bloquante, mais
 * un chef d'atelier/réceptionnaire qui atterrit ici peut désormais RÉELLEMENT sélectionner puis
 * valider/refuser la ligne `proposee`/`a_valider` qui bloquait — avant ce correctif, rien sur cet
 * écran ne le permettait, quel que soit le rôle.
 *
 * Pas de composant `BadgeStatutLigne` dédié à ce jour (seul `BadgeStatutOr` existe dans
 * `composants/identite/` — voir le commentaire de `components/ui/badge.tsx`) : le statut de ligne
 * utilise donc le `Badge` générique, à remplacer par un composant dédié quand il existera.
 */
export function ListeLignesOrdreReparation({
  orId,
  lignes,
  lignesTronquees,
  plafondCentimes = 0,
  vehiculeId,
}: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const session = useSession();
  const role = session.data?.utilisateur.role;

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [actionOuverte, setActionOuverte] = useState<ActionGroupeeLigne | null>(null);
  const [motif, setMotif] = useState('');
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  // « Accord du client » : lignes concernées (une seule, ou tous les travaux proposés).
  const [accordLigneIds, setAccordLigneIds] = useState<readonly string[] | null>(null);
  // « Reporter ce travail » : ligne dont on garde la désignation pour la prochaine visite.
  const [ligneAReporter, setLigneAReporter] = useState<ReponseLigneOr | null>(null);

  const validerLignes = useValiderLignesOr(orId);
  const refuserLignes = useRefuserLignesOr(orId);
  const annulerLignes = useAnnulerLignesOr(orId);

  const peutValider = peutValiderLigneOr(role);
  const peutRefuser = peutRefuserLigneOr(role);
  const peutAnnuler = peutAnnulerLigneOr(role);
  const peutDecider = peutValider || peutRefuser || peutAnnuler;
  const lignesProposees = lignes.filter((ligne) => ligne.statut === 'proposee');
  const peutReporter = vehiculeId !== undefined && peutReporterTravail(role);

  function basculerSelection(ligneId: string) {
    setSelection((precedente) => {
      const suivante = new Set(precedente);
      if (suivante.has(ligneId)) {
        suivante.delete(ligneId);
      } else {
        suivante.add(ligneId);
      }
      return suivante;
    });
  }

  function fermerDialogue() {
    setActionOuverte(null);
    setMotif('');
    setErreurValidation(null);
  }

  const mutationActive =
    actionOuverte === 'valider'
      ? validerLignes
      : actionOuverte === 'refuser'
        ? refuserLignes
        : actionOuverte === 'annuler'
          ? annulerLignes
          : null;

  const erreurActive = mutationActive?.error instanceof ErreurApi ? mutationActive.error : null;

  function soumettreActionGroupee() {
    if (!actionOuverte || !mutationActive) return;
    const ligneIds = [...selection];

    if (actionOuverte === 'annuler' && motif.trim() === '') {
      setErreurValidation(t('or:actions.motifRequis'));
      return;
    }
    setErreurValidation(null);

    const entree =
      actionOuverte === 'valider'
        ? { ligneIds }
        : actionOuverte === 'refuser'
          ? { ligneIds, motif: motif.trim() === '' ? undefined : motif.trim() }
          : { ligneIds, motif: motif.trim() };

    // `mutate` est typé par action (`useValiderLignesOr`/`useRefuserLignesOr`/`useAnnulerLignesOr`
    // exposent chacun leur propre `EntreeValidationLignes`/`EntreeRefusLignes`/
    // `EntreeAnnulationLignes`) ; ce panneau route les TROIS vers la mutation active choisie
    // ci-dessus — même cast délibéré, borné à cette seule ligne, que `PanneauActionsOr.soumettre`.
    (mutationActive.mutate as (valeur: unknown, options?: { onSuccess?: () => void }) => void)(
      entree,
      {
        onSuccess: () => {
          setSelection(new Set());
          fermerDialogue();
        },
      },
    );
  }

  const colonnes: ColonneComptoir<ReponseLigneOr>[] = [
    ...(peutDecider
      ? [
          {
            id: 'selection',
            libelle: t('or:lignes.groupees.colonneSelection'),
            actions: true,
            rendu: (ligne: ReponseLigneOr) => (
              <Checkbox
                checked={selection.has(ligne.id)}
                onCheckedChange={() => basculerSelection(ligne.id)}
                aria-label={t('or:lignes.groupees.selectionnerLigne', {
                  designation: ligne.designation,
                })}
              />
            ),
          } satisfies ColonneComptoir<ReponseLigneOr>,
        ]
      : []),
    {
      id: 'designation',
      libelle: t('or:lignes.colonnes.designation'),
      rendu: (ligne) => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="texte-corps font-medium text-foreground">{ligne.designation}</span>
            {ligne.securite ? (
              <ShieldAlert
                aria-label={t('or:lignes.marqueurs.securite')}
                className="h-3.5 w-3.5 shrink-0 text-statut-danger"
              />
            ) : null}
            {ligne.fournieParClient ? (
              <UserRound
                aria-label={t('or:lignes.marqueurs.fournieParClient')}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
            {ligne.aRestituer ? (
              <PackageCheck
                aria-label={t('or:lignes.marqueurs.pieceARestituer')}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
          </div>
          <span className="texte-libelle text-muted-foreground">
            {t(`or:lignes.origines.${ligne.origine}`)}
            {ligne.referenceTexte ? ` · ${ligne.referenceTexte}` : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'type',
      libelle: t('or:lignes.colonnes.type'),
      rendu: (ligne) => (
        <span className="texte-libelle text-muted-foreground">
          {t(`or:lignes.types.${CLES_TYPE[ligne.type]}`)}
        </span>
      ),
    },
    {
      id: 'quantite',
      libelle: t('or:lignes.colonnes.quantite'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums">{formaterQuantite(ligne.quantiteMillieme)}</span>
      ),
    },
    {
      id: 'tempsBareme',
      libelle: t('or:lignes.colonnes.tempsBareme'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums text-muted-foreground">
          {ligne.tempsBaremeCentiemes !== null
            ? formaterTempsHeures(ligne.tempsBaremeCentiemes)
            : ''}
        </span>
      ),
    },
    {
      id: 'tempsPointe',
      libelle: t('or:lignes.colonnes.tempsPointe'),
      alignement: 'droite',
      // Toujours vide au lot 1 (module pointage absent) : `tempsReelCentiemes` est réellement
      // `null`, ce n'est jamais un droit manquant — rien à masquer ni à inventer.
      rendu: (ligne) => (
        <span className="tabular-nums">
          {ligne.tempsReelCentiemes !== null ? formaterTempsHeures(ligne.tempsReelCentiemes) : ''}
        </span>
      ),
    },
    {
      id: 'rabais',
      libelle: t('or:lignes.colonnes.rabais'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums text-muted-foreground">
          {ligne.rabaisPourmille !== 0 ? formaterPourmille(ligne.rabaisPourmille) : ''}
        </span>
      ),
    },
    {
      id: 'payeur',
      libelle: t('or:lignes.colonnes.payeur'),
      rendu: (ligne) => (
        <span className="texte-libelle">{t(`or:lignes.payeurs.${ligne.payeur}`)}</span>
      ),
    },
    {
      id: 'total',
      libelle: t('or:lignes.colonnes.totalTtc'),
      alignement: 'droite',
      // Absent (pas 0) pour un rôle sans droit aux montants : `ligne.montants` est alors omis en
      // bloc par le serveur (§ contrat MontantsLigneOr), jamais substitué à « 0.00 ». Issue #157 :
      // ni substitué à une cellule vide non plus — `MontantMasque` (droit manquant) ne doit
      // jamais se confondre avec une absence de donnée réelle.
      //
      // CORRECTIF issue #72 (rapport de test terrain) : « la ligne s'affiche à 156.75, d'où ça
      // sort ? Nulle part on ne me montre le tarif horaire ... pas un seul CHF ni TTC/HT ». Le
      // TTC seul restait juste mais illisible sans base de calcul. Sous le TTC (devise + mention
      // explicite, jamais un chiffre nu) : le HT, et pour une ligne de main-d'œuvre dont le taux a
      // pu être figé (`tauxHoraireCentimes`, § contrat RM-65/RM-50 — absent si la résolution du
      // taux a échoué côté serveur), le calcul « temps × taux/h » qui y mène — jamais recalculé
      // ici, seulement réaffiché depuis ce que le serveur a déjà figé.
      rendu: (ligne) => {
        if (!ligne.montants) return <MontantMasque />;
        const estMainOeuvre = TYPES_MAIN_OEUVRE.has(ligne.type);
        const tempsCentiemes = ligne.tempsBaremeCentiemes ?? ligne.tempsReelCentiemes;
        return (
          <div className="flex flex-col items-end gap-0.5">
            <span className="tabular-nums font-medium texte-montant">
              {t('or:lignes.montants.ttc', {
                montant: formaterMontantAvecDevise(ligne.montants.montantTtcCentimes, 'CHF'),
              })}
            </span>
            <span className="texte-libelle tabular-nums text-muted-foreground">
              {t('or:lignes.montants.ht', {
                montant: formaterMontant(ligne.montants.montantHtCentimes),
              })}
            </span>
            {estMainOeuvre && ligne.tauxHoraireCentimes != null && tempsCentiemes !== null ? (
              <span className="texte-libelle tabular-nums text-muted-foreground">
                {t('or:lignes.montants.calculMainOeuvre', {
                  temps: formaterTempsHeures(tempsCentiemes),
                  taux: formaterMontantAvecDevise(ligne.tauxHoraireCentimes, 'CHF'),
                })}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'statut',
      libelle: t('or:lignes.colonnes.statut'),
      // Issue #105 (rapport terrain) : le motif d'annulation (`motifAnnulation`, RM-71 le rend
      // OBLIGATOIRE à la saisie — donc toujours non-null pour une ligne `annulee` réelle) était
      // déjà envoyé par le serveur mais jamais lu ici, alors qu'il tranche à lui seul la question
      // « pourquoi cette ligne est-elle annulée ? » sans obliger la réceptionniste à aller
      // rouvrir l'historique. Même patron que la colonne `designation` juste à côté (badge +
      // sous-texte discret en `flex flex-col gap-0.5`).
      rendu: (ligne) => (
        <div className="flex flex-col gap-0.5">
          <Badge variant="secondary">{t(`or:lignes.statuts.${CLES_STATUT[ligne.statut]}`)}</Badge>
          {ligne.statut === 'annulee' && ligne.motifAnnulation ? (
            <span className="texte-libelle text-muted-foreground">{ligne.motifAnnulation}</span>
          ) : null}
          {/* « Proposée » = le client n'a rien dit : forme (icône) + mot, jamais la couleur
           *  seule. Visible de TOUS les rôles (le mécanicien voit où en est son constat) ; le
           *  geste d'enregistrer l'accord n'est offert qu'à qui peut valider une ligne. */}
          {ligne.statut === 'proposee' ? (
            <span className="inline-flex items-center gap-1 texte-libelle text-muted-foreground">
              <Clock aria-hidden className="h-3.5 w-3.5 shrink-0" />
              {t('or:lignes.attenteAccord.indicateur')}
            </span>
          ) : null}
          {ligne.statut === 'proposee' && peutValider ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setAccordLigneIds([ligne.id])}
            >
              {t('or:accordClient.action')}
              <span className="sr-only"> — {ligne.designation}</span>
            </Button>
          ) : null}
          {peutReporter && STATUTS_REPORTABLES.has(ligne.statut) ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setLigneAReporter(ligne)}
            >
              {t('or:lignes.reporter.action')}
              <span className="sr-only"> — {ligne.designation}</span>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const titreDialogue =
    actionOuverte === 'valider'
      ? t('or:lignes.groupees.validerTitre', { count: selection.size })
      : actionOuverte === 'refuser'
        ? t('or:lignes.groupees.refuserTitre', { count: selection.size })
        : actionOuverte === 'annuler'
          ? t('or:lignes.groupees.annulerTitre', { count: selection.size })
          : '';

  return (
    <div className="flex flex-col gap-2">
      {ligneAReporter && vehiculeId ? (
        <DialogueReporterTravail
          key={ligneAReporter.id}
          vehiculeId={vehiculeId}
          ouvert
          onOuvertChange={(ouvert) => (ouvert ? undefined : setLigneAReporter(null))}
          ordreReparationOrigineId={orId}
          valeursInitiales={{
            designation: ligneAReporter.designation,
            urgence: ligneAReporter.urgence,
            securite: ligneAReporter.securite,
          }}
        />
      ) : null}

      {peutValider && lignesProposees.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setAccordLigneIds(lignesProposees.map((ligne) => ligne.id))}
          >
            {t('or:accordClient.pourTous', { count: lignesProposees.length })}
          </Button>
        </div>
      ) : null}

      {peutDecider && selection.size > 0 ? (
        <div
          role="group"
          aria-label={t('or:lignes.groupees.colonneSelection')}
          className="flex flex-wrap items-center gap-2"
        >
          {peutValider ? (
            <Button type="button" variant="default" onClick={() => setActionOuverte('valider')}>
              {`${t('or:lignes.actions.valider')} (${selection.size})`}
            </Button>
          ) : null}
          {peutRefuser ? (
            <Button type="button" variant="outline" onClick={() => setActionOuverte('refuser')}>
              {`${t('or:lignes.actions.refuser')} (${selection.size})`}
            </Button>
          ) : null}
          {peutAnnuler ? (
            <Button type="button" variant="destructive" onClick={() => setActionOuverte('annuler')}>
              {`${t('or:lignes.actions.annuler')} (${selection.size})`}
            </Button>
          ) : null}
        </div>
      ) : null}

      <TableComptoir
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(ligne) => ligne.id}
        contenuVide={<EtatVide titre={t('or:lignes.titre')} description={t('or:lignes.vide')} />}
      />
      {lignesTronquees ? (
        <p className="texte-libelle text-muted-foreground">{t('or:lignes.tronquees')}</p>
      ) : null}

      <DialogueAccordClient
        orId={orId}
        ligneIds={accordLigneIds ?? []}
        plafondCentimes={plafondCentimes}
        ouvert={accordLigneIds !== null}
        onOuvertChange={(ouvertAccord) => {
          if (!ouvertAccord) setAccordLigneIds(null);
        }}
      />

      <Dialog
        open={actionOuverte !== null}
        onOpenChange={(ouvert) => (ouvert ? undefined : fermerDialogue())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titreDialogue}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {actionOuverte === 'refuser' || actionOuverte === 'annuler' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-lignes-groupees-motif">
                  {t('or:actions.motif')}
                  {actionOuverte === 'annuler' ? ' *' : ''}
                </Label>
                <Textarea
                  id="or-lignes-groupees-motif"
                  value={motif}
                  onChange={(evenement) => setMotif(evenement.target.value)}
                />
              </div>
            ) : null}

            {erreurValidation ? (
              <p className="texte-libelle text-destructive">{erreurValidation}</p>
            ) : null}
            {erreurActive
              ? messagesErreurMutation(erreurActive, t).map((message, index) => (
                  <p key={index} role="alert" className="texte-libelle text-destructive">
                    {message}
                  </p>
                ))
              : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t('commun:actions.annuler')}</Button>
            </DialogClose>
            <Button disabled={mutationActive?.isPending} onClick={soumettreActionGroupee}>
              {t('or:actions.confirmer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
