import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { BandeauLectureSeule } from '@/composants/motifs/BandeauLectureSeule';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutRendezVous } from './BadgeStatutRendezVous';
import type { RendezVousDetail } from './types';

interface Props {
  readonly ouvert: boolean;
  readonly onOpenChange: (ouvert: boolean) => void;
  readonly rendezVous: RendezVousDetail;
  readonly siteUrl?: string;
  /** `true` une fois l'heure prévue atteinte (jour J) — avant, aucune action primaire (le
   *  rendez-vous est simplement confirmé). */
  readonly estJourJOuApres: boolean;
  /** `true` seulement passé le délai de grâce configuré — jamais avant l'heure (conception, Écran
   *  3). */
  readonly delaiGracePasse: boolean;
  /** Droit d'agir sur CE rendez-vous (réceptionniste/direction : tout ; chef d'atelier : tout sauf
   *  la création, donc les actions d'ici lui restent ouvertes ; technicien : lecture seule). Un
   *  geste proposé à qui n'y a pas droit est pire que pas de geste — MASQUE, ne désactive jamais
   *  (consigne du coordinateur). */
  readonly peutAgir: boolean;
  readonly onVehiculeArrive: () => void;
  readonly onSignalerAbsence: () => void;
  readonly onAnnuler: (motif: string) => void;
  readonly enCoursAction?: boolean;
  /** Message d'échec DÉJÀ TRADUIT — jamais un enregistrement silencieux, succès comme échec. */
  readonly erreurAction?: string | null;
}

const CLES_ACTION_HISTORIQUE: Readonly<Record<string, string>> = {
  cree: 'creePar',
  modifie: 'modifiePar',
  annule: 'annulePar',
  honore: 'modifiePar',
  absent: 'modifiePar',
};

/** Heure souhaitée si connue, sinon le moment de la journée. */
function libelleCreneau(rendezVous: RendezVousDetail, t: (cle: string) => string): string {
  const date = formaterDate(rendezVous.dateLe);
  const heure = rendezVous.heureSouhaitee
    ? rendezVous.heureSouhaitee.slice(0, 5)
    : t(`planning:moments.${rendezVous.moment}`);
  return `${date} · ${heure}`;
}

/**
 * Détail d'un rendez-vous — Écran 3. UN SEUL bouton primaire selon le moment
 * (`docs/conception-rendez-vous-ecrans.md`) : avant le jour J, aucun (le rendez-vous est
 * simplement confirmé) ; le jour J à l'heure prévue ou après, **Le véhicule est arrivé** ; statut
 * `absent`, le même bouton redevient primaire (« un client en retard n'est pas définitivement
 * perdu »). Statut `annule` : lecture seule totale, aucun bouton.
 *
 * PAS de boutons Modifier/Reporter dans cette livraison (`docs/conception-rendez-vous-ecrans.md`,
 * §Priorisation : « Peut attendre » — le contournement manuel (annuler + recréer) reste correct en
 * attendant que l'écran consomme `PATCH /rendez-vous/{id}`) : un bouton qui ne ferait rien de réel
 * serait pire que son absence.
 */
export function PanneauDetailRendezVous({
  ouvert,
  onOpenChange,
  rendezVous,
  siteUrl,
  estJourJOuApres,
  delaiGracePasse,
  peutAgir,
  onVehiculeArrive,
  onSignalerAbsence,
  onAnnuler,
  enCoursAction = false,
  erreurAction = null,
}: Props) {
  const { t } = useTranslation(['planning', 'commun']);
  const [confirmationAnnulationOuverte, setConfirmationAnnulationOuverte] = useState(false);
  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [erreurMotif, setErreurMotif] = useState(false);

  useEffect(() => {
    if (!ouvert) {
      setConfirmationAnnulationOuverte(false);
      setMotifAnnulation('');
      setErreurMotif(false);
    }
  }, [ouvert]);

  const lectureSeule = rendezVous.statut === 'annule';
  const estArrive = rendezVous.statut === 'honore';

  function gererConfirmerAnnulation() {
    if (motifAnnulation.trim() === '') {
      setErreurMotif(true);
      return;
    }
    setErreurMotif(false);
    onAnnuler(motifAnnulation.trim());
  }

  return (
    <Sheet open={ouvert} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('planning:detail.titre')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <BadgeStatutRendezVous statut={rendezVous.statut} />
            {estArrive && rendezVous.ordreReparationId ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  to={chemins.atelier.ordresReparation.detail(
                    rendezVous.ordreReparationId,
                    siteUrl,
                  )}
                >
                  {t('planning:detail.actions.voirOrdre')}
                </Link>
              </Button>
            ) : null}
          </div>

          {lectureSeule ? <BandeauLectureSeule motif={t('planning:detail.lectureSeule')} /> : null}

          {erreurAction ? (
            <p role="alert" className="texte-corps text-destructive">
              {erreurAction}
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-3 texte-corps">
            <div>
              <dt className="text-muted-foreground">{t('planning:champs.client')}</dt>
              <dd className="text-foreground">{rendezVous.clientNom}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('planning:champs.vehicule')}</dt>
              <dd className="text-foreground">{rendezVous.vehiculeDesignation ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('planning:champs.site')}</dt>
              <dd className="text-foreground">{rendezVous.siteNom}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('planning:champs.date')}</dt>
              <dd className="text-foreground">{libelleCreneau(rendezVous, t)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">{t('planning:champs.motif')}</dt>
              <dd className="text-foreground">{rendezVous.motifLibelle}</dd>
            </div>
            {rendezVous.remarque ? (
              <div className="col-span-2">
                <dt className="text-muted-foreground">{t('planning:champs.remarque')}</dt>
                <dd className="text-foreground">{rendezVous.remarque}</dd>
              </div>
            ) : null}
            {rendezVous.motifAnnulation ? (
              <div className="col-span-2">
                <dt className="text-muted-foreground">
                  {t('planning:detail.annulation.motifLabel')}
                </dt>
                <dd className="text-foreground">{rendezVous.motifAnnulation}</dd>
              </div>
            ) : null}
          </dl>

          {!lectureSeule && !estArrive && peutAgir ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t('planning:detail.titre')}
            >
              {rendezVous.statut === 'absent' || estJourJOuApres ? (
                <Button type="button" onClick={onVehiculeArrive} disabled={enCoursAction}>
                  {t('planning:detail.actions.vehiculeArrive')}
                </Button>
              ) : null}
              {rendezVous.statut !== 'absent' && estJourJOuApres && delaiGracePasse ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onSignalerAbsence}
                  disabled={enCoursAction}
                >
                  {t('planning:detail.actions.signalerAbsence')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmationAnnulationOuverte(true)}
                disabled={enCoursAction}
              >
                {t('planning:detail.actions.annuler')}
              </Button>
            </div>
          ) : null}

          {confirmationAnnulationOuverte ? (
            <div
              role="alertdialog"
              aria-label={t('planning:detail.annulation.titre')}
              className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
            >
              <p className="texte-corps font-semibold text-foreground">
                {t('planning:detail.annulation.titre')}
              </p>
              {/* Réversibilité dite AVANT confirmation, dans le dialogue lui-même — jamais une doc à part. */}
              <p className="texte-corps text-muted-foreground">
                {t('planning:detail.annulation.description')}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rdv-motif-annulation">
                  {t('planning:detail.annulation.motifLabel')}
                </Label>
                <Textarea
                  id="rdv-motif-annulation"
                  value={motifAnnulation}
                  onChange={(evenement) => setMotifAnnulation(evenement.target.value)}
                  aria-invalid={erreurMotif}
                />
                {erreurMotif ? (
                  <p className="text-xs text-destructive">
                    {t('planning:detail.annulation.motifRequis')}
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmationAnnulationOuverte(false)}
                >
                  {t('commun:actions.annuler')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={gererConfirmerAnnulation}
                  disabled={enCoursAction}
                >
                  {t('planning:detail.annulation.confirmer')}
                </Button>
              </div>
            </div>
          ) : null}

          {rendezVous.historique.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="texte-corps font-semibold text-foreground">
                {t('planning:detail.historique.titre')}
              </p>
              <ul className="flex flex-col gap-1">
                {rendezVous.historique.map((entree, index) => (
                  <li key={index} className="texte-libelle text-muted-foreground">
                    {t(
                      `planning:detail.historique.${CLES_ACTION_HISTORIQUE[entree.action] ?? 'modifiePar'}`,
                      {
                        nom: entree.auteurNom,
                        date: formaterDate(entree.date),
                      },
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
