import { Clock, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponseOrdreReparation } from '@dfa/shared';

import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { formaterDateHeure } from '@/lib/formats';
import { cn } from '@/lib/utils';

import { VehiculeGrand } from './VehiculeGrand';

interface Props {
  readonly or: ReponseOrdreReparation;
  /** Lignes assignées au technicien courant, déjà comptées par l'appelant. */
  readonly lignesAssignees: number;
  readonly onChoisir: () => void;
  readonly desactive: boolean;
  /** Borne : numéro, plaque et désignation à 24 px (lecture à 1,5 m). */
  readonly grand?: boolean;
  /** Nom du site de l'OR, à afficher seulement quand le technicien en a plusieurs. `undefined` ->
   *  pas d'étiquette. */
  readonly siteNom?: string;
  /** L'OR est d'un AUTRE site que celui de la borne : affiché, jamais proposé au pointage. */
  readonly horsSite?: boolean;
}

/**
 * Carte « Mes OR du jour » — partagée par la borne et l'écran personnel. Porte l'urgence : la
 * restitution promise (date et heure) avec, quand le serveur la dit dépassée (`enRetard`),
 * icône + mot « En retard » + rouge — jamais la couleur seule. Pas de date promise : rien
 * d'affiché (« aucune date » n'est ni un retard ni une urgence).
 */
export function CarteOrDuJour({
  or,
  lignesAssignees,
  onChoisir,
  desactive,
  grand = false,
  siteNom,
  horsSite = false,
}: Props) {
  const { t } = useTranslation('pointage');
  const enRetard = or.enRetard === true;

  return (
    <button
      type="button"
      disabled={desactive || horsSite}
      onClick={onChoisir}
      // Bordure conservée : carte cliquable de sélection d'OR, zone d'action réelle (DESIGN.md).
      className="flex min-h-[72px] flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-muted anneau-focus disabled:pointer-events-none disabled:opacity-60"
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={cn('font-mono font-semibold', grand ? 'text-2xl' : 'font-medium')}>
          {or.numero}
        </span>
        {or.restitutionPromiseLe ? (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-medium',
              grand ? 'text-2xl' : 'texte-corps',
              enRetard ? 'text-destructive' : 'text-foreground',
            )}
          >
            {enRetard ? (
              <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" />
            ) : (
              <Clock aria-hidden="true" className="h-5 w-5 shrink-0" />
            )}
            {enRetard
              ? t('technicien.mesOrs.enRetard', {
                  date: formaterDateHeure(or.restitutionPromiseLe),
                })
              : t('technicien.mesOrs.restitution', {
                  date: formaterDateHeure(or.restitutionPromiseLe),
                })}
          </span>
        ) : null}
      </div>
      {grand ? (
        <VehiculeGrand vehicule={or.vehicule} />
      ) : (
        <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />
      )}
      <IdentiteClient client={or.client} />
      <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="texte-libelle text-muted-foreground">
          {t('technicien.mesOrs.lignesAssignees', { count: lignesAssignees })}
        </span>
        {horsSite ? (
          <span className="texte-corps font-medium text-avertissement">
            {siteNom
              ? t('technicien.mesOrs.horsSite', { site: siteNom })
              : t('technicien.mesOrs.horsSiteSansNom')}
          </span>
        ) : siteNom ? (
          <span className="texte-libelle text-muted-foreground">{siteNom}</span>
        ) : null}
      </div>
    </button>
  );
}
