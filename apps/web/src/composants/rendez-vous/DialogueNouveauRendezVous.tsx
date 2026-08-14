import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaCreationRendezVous,
  type ClientResume,
  type CodeConfirmation,
  type EntreeCreationRendezVous,
  type MomentRendezVous,
  type ReponseMotifRendezVous,
  type SiteResume,
  type TypeOrdreReparation,
  type VehiculeResume,
} from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useLangue } from '@/hooks/useLangue';

import { libelleMotif } from './types';

const MOMENTS: readonly MomentRendezVous[] = ['matin', 'apres_midi', 'toute_journee'];

/** Motif -> type d'OR — heuristique FRONT dérivée du référentiel garage de démonstration
 *  (`seed-rendez-vous-demo.ts`, codes `SERVICE`/`PNEUS`/`EXPERTISE-MFK`/`DIAGNOSTIC`/`PANNE`/
 *  `A-DETERMINER`) : le contrat exige `type` en plus de `motifId` (`schemaCreationRendezVous`),
 *  mais la conception d'écran ne présente aucun champ « Type » distinct au réceptionniste — le
 *  garder invisible et le déduire du motif évite un champ de plus au téléphone. Repli sur
 *  `'service'` pour un code de motif inconnu (garage qui a créé ses propres motifs) : pas la
 *  meilleure réponse possible, mais jamais un blocage de la prise de rendez-vous. */
function typeDepuisMotif(motif: ReponseMotifRendezVous): TypeOrdreReparation {
  const parCode: Readonly<Record<string, TypeOrdreReparation>> = {
    SERVICE: 'service',
    PNEUS: 'pneus',
    'EXPERTISE-MFK': 'expertise',
    DIAGNOSTIC: 'diagnostic',
    PANNE: 'reparation',
    'A-DETERMINER': 'diagnostic',
  };
  return parCode[motif.code] ?? 'service';
}

export interface Props {
  readonly ouvert: boolean;
  readonly onOpenChange: (ouvert: boolean) => void;
  /** `null` : à choisir (point d'entrée 1, depuis l'agenda) — voir `slotSelecteurClient`. */
  readonly client: ClientResume | null;
  readonly vehicule: VehiculeResume | null;
  /** Rendu SEULEMENT tant que `client` est `null` — recherche client (moteur global, à charge de
   *  l'appelant). */
  readonly slotSelecteurClient?: ReactNode;
  /** Rendu SEULEMENT quand `client` est connu et `vehicule` encore `null`. */
  readonly slotSelecteurVehicule?: ReactNode;
  /** Lien « Changer » — fourni SEULEMENT sur les points d'entrée 2/3 (client/véhicule déjà affichés
   *  à l'écran d'origine) : le sujet déjà sous les yeux du garagiste n'est jamais à rechoisir dans
   *  un sélecteur générique sans un geste explicite. */
  readonly onChangerClient?: () => void;
  readonly onChangerVehicule?: () => void;
  /** Le rendez-vous PEUT rester sans véhicule connu (§3 conception données, « souvent connu, pas
   *  toujours ») — obligatoire seulement avant de devenir un OR. */
  readonly onIgnorerVehicule?: () => void;
  readonly site: SiteResume;
  readonly dateInitiale?: string;
  readonly motifsDisponibles: readonly ReponseMotifRendezVous[];
  readonly onConfirmer: (donnees: EntreeCreationRendezVous) => void;
  readonly enCours?: boolean;
  /** Message d'échec DÉJÀ TRADUIT (dernier envoi, hors confirmation) — la saisie n'est JAMAIS
   *  vidée quand ce champ est renseigné, contre le grief du testeur (« un refus qui vide le
   *  formulaire »). */
  readonly erreur?: string | null;
  /** Codes à confirmer explicitement (409 CONFIRMATION_REQUISE, ex. CLIENT_BLOQUE) — JAMAIS
   *  `PLANNING_CAPACITE_DEPASSEE` : le surbooking n'entre jamais dans ce protocole, il n'est
   *  qu'un avertissement de la réponse (RV-06, arbitrage de @laupernoe #1 : avertir, jamais bloquer). */
  readonly confirmationsRequises?: readonly CodeConfirmation[];
  readonly onConfirmerQuandMeme?: () => void;
}

/**
 * Nouveau rendez-vous — Écran 2, dialogue UNIQUE pour les trois points d'entrée
 * (`docs/conception-rendez-vous-ecrans.md`). Un seul bouton primaire **Confirmer le rendez-vous** ;
 * **Annuler** ferme sans confirmation supplémentaire (rien n'est encore engagé). Motif OBLIGATOIRE
 * (arbitrage de @laupernoe #2) — le référentiel porte déjà un motif générique (« À déterminer — diagnostic
 * au comptoir ») pour le client qui ne sait pas décrire sa panne : pas de sentinelle synthétique
 * ici, c'est un motif réel parmi les autres.
 */
export function DialogueNouveauRendezVous({
  ouvert,
  onOpenChange,
  client,
  vehicule,
  slotSelecteurClient,
  slotSelecteurVehicule,
  onChangerClient,
  onChangerVehicule,
  onIgnorerVehicule,
  site,
  dateInitiale,
  motifsDisponibles,
  onConfirmer,
  enCours = false,
  erreur = null,
  confirmationsRequises = [],
  onConfirmerQuandMeme,
}: Props) {
  const { t } = useTranslation(['planning', 'commun', 'validation']);
  const { langue } = useLangue();

  const [dateLe, setDateLe] = useState(dateInitiale ?? '');
  const [moment, setMoment] = useState<MomentRendezVous | ''>('');
  const [heureSouhaitee, setHeureSouhaitee] = useState('');
  const [motifId, setMotifId] = useState('');
  const [dureeEstimeeMinutes, setDureeEstimeeMinutes] = useState<number>(60);
  const [commentaire, setCommentaire] = useState('');
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({});

  // Réinitialisation à CHAQUE OUVERTURE (pas à chaque rendu) — même garde-fou que
  // `FormulaireNouveauClient` : une saisie ratée reste visible tant que le dialogue reste ouvert
  // (« conserve la saisie »), mais une NOUVELLE ouverture repart neutre.
  useEffect(() => {
    if (!ouvert) return;
    setDateLe(dateInitiale ?? '');
    setMoment('');
    setHeureSouhaitee('');
    setMotifId('');
    setDureeEstimeeMinutes(60);
    setCommentaire('');
    setErreursChamps({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- volontairement piloté par `ouvert` seul.
  }, [ouvert]);

  function gererChoixMotif(valeur: string) {
    setMotifId(valeur);
    const motif = motifsDisponibles.find((candidat) => candidat.id === valeur);
    if (motif?.dureeDefautMinutes) setDureeEstimeeMinutes(motif.dureeDefautMinutes);
  }

  function gererConfirmer() {
    const motif = motifsDisponibles.find((candidat) => candidat.id === motifId);
    const resultat = schemaCreationRendezVous.safeParse({
      siteId: site.id,
      clientId: client?.id ?? '',
      vehiculeId: vehicule?.id ?? null,
      motifId,
      type: motif ? typeDepuisMotif(motif) : 'service',
      commentaire: commentaire.trim() === '' ? undefined : commentaire.trim(),
      dateLe,
      moment: moment === '' ? undefined : moment,
      heureSouhaitee: heureSouhaitee === '' ? undefined : `${heureSouhaitee}:00`,
      dureeEstimeeMinutes,
    });

    if (!resultat.success) {
      const nouvellesErreurs: Record<string, string> = {};
      for (const probleme of resultat.error.issues) {
        const champ = String(probleme.path[0] ?? '');
        if (champ && !nouvellesErreurs[champ]) nouvellesErreurs[champ] = t('validation:requis');
      }
      setErreursChamps(nouvellesErreurs);
      return;
    }

    setErreursChamps({});
    onConfirmer(resultat.data);
  }

  const etapeChoixSujet = client === null || (vehicule === null && slotSelecteurVehicule);

  return (
    <Dialog open={ouvert} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planning:dialogueNouveau.titre')}</DialogTitle>
        </DialogHeader>

        {erreur ? (
          <p role="alert" className="texte-corps text-destructive">
            {erreur}
          </p>
        ) : null}

        {client === null ? (
          <div className="flex flex-col gap-2">
            <Label>{t('planning:champs.client')}</Label>
            {slotSelecteurClient}
          </div>
        ) : vehicule === null && slotSelecteurVehicule ? (
          <div className="flex flex-col gap-4">
            <IdentiteClient client={client} />
            <div className="flex flex-col gap-2">
              <Label>{t('planning:champs.vehicule')}</Label>
              {slotSelecteurVehicule}
              {onIgnorerVehicule ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onIgnorerVehicule}
                  className="self-start"
                >
                  {t('planning:identite.sansVehicule')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <IdentiteClient client={client} />
              {onChangerClient ? (
                <Button type="button" variant="ghost" size="sm" onClick={onChangerClient}>
                  {t('planning:identite.changer')}
                </Button>
              ) : null}
            </div>
            {vehicule ? (
              <div className="flex items-center justify-between gap-2">
                <IdentiteVehicule vehicule={vehicule} />
                {onChangerVehicule ? (
                  <Button type="button" variant="ghost" size="sm" onClick={onChangerVehicule}>
                    {t('planning:identite.changer')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label>{t('planning:champs.site')}</Label>
              <p className="texte-corps text-foreground">{site.nom}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rdv-date">{t('planning:champs.date')}</Label>
                <DateInput
                  id="rdv-date"
                  value={dateLe || null}
                  onChange={(valeur) => setDateLe(valeur ?? '')}
                />
                {erreursChamps.dateLe ? (
                  <p className="text-xs text-destructive">{erreursChamps.dateLe}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rdv-moment">{t('planning:champs.moment')}</Label>
                <Select
                  value={moment}
                  onValueChange={(valeur) => setMoment(valeur as MomentRendezVous)}
                >
                  <SelectTrigger id="rdv-moment" aria-invalid={Boolean(erreursChamps.moment)}>
                    <SelectValue placeholder={t('planning:champs.momentPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {MOMENTS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`planning:moments.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {erreursChamps.moment ? (
                  <p className="text-xs text-destructive">{erreursChamps.moment}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rdv-heure">{t('planning:champs.heureSouhaitee')}</Label>
              <Input
                id="rdv-heure"
                type="time"
                step={900}
                value={heureSouhaitee}
                onChange={(evenement) => setHeureSouhaitee(evenement.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rdv-motif">{t('planning:champs.motif')}</Label>
              <Select value={motifId} onValueChange={gererChoixMotif}>
                <SelectTrigger id="rdv-motif" aria-invalid={Boolean(erreursChamps.motifId)}>
                  <SelectValue placeholder={t('planning:champs.motifPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {motifsDisponibles.map((motif) => (
                    <SelectItem key={motif.id} value={motif.id}>
                      {libelleMotif(motif, langue)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {erreursChamps.motifId ? (
                <p className="text-xs text-destructive">{erreursChamps.motifId}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rdv-duree">{t('planning:champs.duree')}</Label>
              <Input
                id="rdv-duree"
                type="number"
                min={1}
                max={1440}
                value={dureeEstimeeMinutes}
                onChange={(evenement) => setDureeEstimeeMinutes(Number(evenement.target.value))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rdv-remarque">{t('planning:champs.remarque')}</Label>
              <Textarea
                id="rdv-remarque"
                value={commentaire}
                onChange={(evenement) => setCommentaire(evenement.target.value)}
              />
            </div>
          </div>
        )}

        {!etapeChoixSujet ? (
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('commun:actions.annuler')}
              </Button>
            </DialogClose>
            <Button type="button" disabled={enCours} onClick={gererConfirmer}>
              {enCours
                ? t('planning:dialogueNouveau.enCours')
                : t('planning:dialogueNouveau.confirmer')}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>

      {onConfirmerQuandMeme ? (
        <AvertissementConfirmable
          ouvert={confirmationsRequises.length > 0}
          onOuvertChange={(ouvertConfirmation) => {
            if (!ouvertConfirmation) onOpenChange(true);
          }}
          titre={t('planning:dialogueNouveau.titre')}
          description={erreur ?? ''}
          libelleConfirmation={t('commun:actions.continuerQuandMeme')}
          onConfirmer={onConfirmerQuandMeme}
          enCours={enCours}
        />
      ) : null}
    </Dialog>
  );
}
