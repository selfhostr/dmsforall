import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { BadgeCapaciteJour } from './BadgeCapaciteJour';
import { CarteRendezVous } from './CarteRendezVous';
import { classerCapaciteJour, formaterDureeCourte } from './capacite';
import type { JourAgenda, RendezVousCarte } from './types';

const CLES_ETAT_CAPACITE_ARIA: Record<string, string> = {
  disponible: 'disponible',
  presque_complet: 'presqueComplet',
  complet: 'complet',
  non_definie: 'nonDefinie',
};

/** Ordre d'affichage à l'intérieur d'un jour : matin -> après-midi -> toute la journée, puis heure
 *  souhaitée si connue — jamais un ordre de création, qui mélangerait les moments. */
const ORDRE_MOMENT: Record<string, number> = { matin: 0, apres_midi: 1, toute_journee: 2 };

function comparerRendezVous(a: RendezVousCarte, b: RendezVousCarte): number {
  const ordre = (ORDRE_MOMENT[a.moment] ?? 9) - (ORDRE_MOMENT[b.moment] ?? 9);
  if (ordre !== 0) return ordre;
  return (a.heureSouhaitee ?? '99:99').localeCompare(b.heureSouhaitee ?? '99:99');
}

interface Props {
  readonly jours: readonly JourAgenda[];
  /** Clic sur l'EN-TÊTE du jour (date, capacité) — bascule vers la vue Jour ou ouvre un nouveau
   *  rendez-vous si le jour n'a aucun créneau réservé, selon l'appelant. */
  readonly onCliquerJour: (jour: JourAgenda) => void;
  readonly onOuvrirRendezVous: (rendezVous: RendezVousCarte) => void;
}

/** Formateur du jour de semaine, dépendant de la LANGUE d'interface (comme `CalendrierEcheances`) —
 *  jamais du format suisse figé `lib/formats.ts` (`weekday` n'a de sens que traduit). */
function creerFormateurJourComplet(langue: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(langue, { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Vue Semaine de l'agenda — sept colonnes, chacune un jour avec sa capacité et ses rendez-vous
 * empilés par moment (`docs/conception-rendez-vous-ecrans.md`, Écran 1). C'EST l'écran du test des
 * dix secondes : le résumé de capacité (`BadgeCapaciteJour`) doit se lire sans ouvrir la colonne.
 *
 * Navigation clavier : ROVING TABINDEX sur les sept EN-TÊTES de jour (flèches gauche/droite,
 * `Entrée`/`Espace` ouvre le jour sous le focus, un seul arrêt `Tab` pour entrer/sortir de la
 * rangée d'en-têtes) — les cartes de rendez-vous à l'intérieur restent des arrêts `Tab` normaux,
 * chacune un vrai bouton (voir `CarteRendezVous`).
 */
export function GrilleAgendaSemaine({ jours, onCliquerJour, onOuvrirRendezVous }: Props) {
  const { t, i18n } = useTranslation('planning');
  const formateurJour = useMemo(() => creerFormateurJourComplet(i18n.language), [i18n.language]);
  const refsEnTetes = useRef<(HTMLButtonElement | null)[]>([]);

  // Même convention que `EcranAgendaRendezVous` (« En vue Jour : UN SEUL élément ») : cette grille
  // sert les deux vues Jour/Semaine, seul le nombre de jours reçus les distingue. Sept colonnes
  // étroites en vue Semaine n'ont pas la place pour la phrase de capacité complète — d'où le
  // résumé compact (`BadgeCapaciteJour` en `niveauDetail="resume"`) ; l'unique colonne de la vue
  // Jour, elle, a toute la largeur pour la phrase entière.
  const vueSemaine = jours.length > 1;
  const niveauDetailCapacite = vueSemaine ? 'resume' : 'complet';

  function gererClavierEnTete(evenement: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (evenement.key === 'ArrowRight') {
      evenement.preventDefault();
      const suivant = (index + 1) % jours.length;
      refsEnTetes.current[suivant]?.focus();
    } else if (evenement.key === 'ArrowLeft') {
      evenement.preventDefault();
      const precedent = (index - 1 + jours.length) % jours.length;
      refsEnTetes.current[precedent]?.focus();
    } else if (evenement.key === 'Home') {
      evenement.preventDefault();
      refsEnTetes.current[0]?.focus();
    } else if (evenement.key === 'End') {
      evenement.preventDefault();
      refsEnTetes.current[jours.length - 1]?.focus();
    }
  }

  return (
    <div
      role="grid"
      aria-label={t('planning:titre')}
      className={cn(
        'grid gap-2',
        vueSemaine ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-7' : 'grid-cols-1',
      )}
    >
      {jours.map((jour, index) => {
        const etat = classerCapaciteJour(jour.minutesOccupees, jour.capaciteMinutes);
        const ariaJour =
          jour.capaciteMinutes === null
            ? t('planning:capacite.ariaJourNonDefinie', {
                jour: formateurJour.format(jour.date),
                reserves: jour.nombreRendezVous,
              })
            : t('planning:capacite.ariaJourDefinie', {
                jour: formateurJour.format(jour.date),
                reserves: jour.nombreRendezVous,
                occupe: formaterDureeCourte(jour.minutesOccupees),
                capacite: formaterDureeCourte(jour.capaciteMinutes),
                etat: t(`planning:capacite.etat.${CLES_ETAT_CAPACITE_ARIA[etat]}`),
              });

        return (
          <div
            key={jour.dateIso}
            role="gridcell"
            className="flex min-w-0 flex-col gap-2 rounded-md border p-2"
          >
            <button
              ref={(element) => {
                refsEnTetes.current[index] = element;
              }}
              type="button"
              tabIndex={index === 0 ? 0 : -1}
              onKeyDown={(evenement) => gererClavierEnTete(evenement, index)}
              onClick={() => onCliquerJour(jour)}
              aria-label={ariaJour}
              className="flex min-h-11 min-w-0 flex-col items-start gap-1 rounded-md p-1 text-left anneau-focus hover:bg-muted"
            >
              <span className="texte-corps font-semibold capitalize text-foreground">
                {formateurJour.format(jour.date)}
              </span>
              <BadgeCapaciteJour
                nombreRendezVous={jour.nombreRendezVous}
                minutesOccupees={jour.minutesOccupees}
                capaciteMinutes={jour.capaciteMinutes}
                niveauDetail={niveauDetailCapacite}
              />
            </button>

            <div className="flex flex-col gap-champ" aria-label={t('planning:titre')}>
              {[...jour.rendezVous].sort(comparerRendezVous).map((rendezVous) => (
                <CarteRendezVous
                  key={rendezVous.id}
                  rendezVous={rendezVous}
                  onOuvrir={onOuvrirRendezVous}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
