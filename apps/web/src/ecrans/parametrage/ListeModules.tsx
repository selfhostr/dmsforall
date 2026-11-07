import {
  BellRing,
  Boxes,
  CalendarDays,
  CarFront,
  Check,
  CircleDot,
  FileOutput,
  KeyRound,
  Minus,
  Tablet,
  Timer,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ModuleApp } from '@dfa/shared';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { basculerModule, lignesModules } from './modules';

const ICONES: Readonly<Record<ModuleApp, LucideIcon>> = {
  atelier: Wrench,
  planning: CalendarDays,
  pointage: Timer,
  tablettes: Tablet,
  pieces: Boxes,
  ventes: CarFront,
  pneus: CircleDot,
  courtoisie: KeyRound,
  relances: BellRing,
  export_fiduciaire: FileOutput,
};

interface Props {
  /** Modules retirés par le garage (le choix, pas l'effet des dépendances). */
  readonly desactives: readonly ModuleApp[];
  readonly onChange: (desactives: readonly ModuleApp[]) => void;
  readonly desactiveTout?: boolean;
}

/**
 * Liste des modules du garage : icône, nom, une phrase, un interrupteur. Partagée par
 * Réglages > Modules et l'étape « Ce que vous utilisez » de l'assistant : les deux écrivent le même
 * réglage. L'état s'écrit en toutes lettres (Activé / Retiré) en plus de l'interrupteur ; la
 * dépendance s'affiche sur la ligne, jamais seulement par un interrupteur grisé.
 */
export function ListeModules({ desactives, onChange, desactiveTout = false }: Props) {
  const { t } = useTranslation('parametrage');
  const noms = (ids: readonly ModuleApp[]) =>
    ids.map((id) => t(`parametrage:modules.items.${id}.nom`)).join(', ');

  return (
    <ul className="divide-y">
      {lignesModules(desactives).map((ligne) => {
        const Icone = ICONES[ligne.id];
        const bloque = ligne.bloquePar.length > 0;
        const idNom = `module-${ligne.id}-nom`;
        const idAide = `module-${ligne.id}-aide`;
        return (
          <li key={ligne.id} className="flex items-start gap-3 py-3">
            <Icone aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p id={idNom} className="texte-corps font-medium">
                {t(`parametrage:modules.items.${ligne.id}.nom`)}
              </p>
              <p id={idAide} className="texte-corps text-muted-foreground">
                {t(`parametrage:modules.items.${ligne.id}.description`)}
              </p>
              {ligne.necessite.length > 0 ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('parametrage:modules.necessite', { modules: noms(ligne.necessite) })}
                </p>
              ) : null}
              {bloque ? (
                <p className="texte-libelle text-foreground">
                  {t('parametrage:modules.bloque', { modules: noms(ligne.bloquePar) })}
                </p>
              ) : null}
              {ligne.retireAussi.length > 0 && ligne.choisi ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('parametrage:modules.retireAussi', { modules: noms(ligne.retireAussi) })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  'flex items-center gap-1 texte-libelle',
                  ligne.actif ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {ligne.actif ? (
                  <Check aria-hidden className="h-4 w-4" />
                ) : (
                  <Minus aria-hidden className="h-4 w-4" />
                )}
                {ligne.actif
                  ? t('parametrage:modules.etat.actif')
                  : t('parametrage:modules.etat.retire')}
              </span>
              <Switch
                checked={ligne.actif}
                disabled={desactiveTout || bloque}
                aria-labelledby={idNom}
                aria-describedby={idAide}
                onCheckedChange={(coche) => onChange(basculerModule(desactives, ligne.id, coche))}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
