import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SuiviGarantie } from '@dfa/shared';

import { formaterDate, formaterKilometrage } from '@/lib/formats';
import { cn } from '@/lib/utils';

interface Props {
  /** `null` : aucune garantie à suivre pour ce dossier (`vehicule.garantieDebut` non renseigné, ou
   *  aucun véhicule associé) — voir l'en-tête du contrat. */
  readonly garantie: SuiviGarantie | null;
}

/**
 * Colonne garantie du suivi — jamais gatée par rôle (contrairement au financement, voir l'en-tête
 * du contrat : « la garantie n'est PAS une donnée financière »). Règle qui NE se contourne pas
 * ici : le serveur ne porte qu'une date de DÉBUT de garantie — `finLe` est `null` quand `mois` est
 * inconnu, et ce composant l'affiche EXPLICITEMENT comme une durée non renseignée plutôt que de
 * laisser le champ vide (silence == invention possible dans la tête du lecteur) ou d'inventer une
 * échéance. Une couverture annoncée à tort est un litige avec un client.
 */
export function CelluleGarantieSuivi({ garantie }: Props) {
  const { t } = useTranslation('ventes');

  if (!garantie) {
    return (
      <span className="texte-libelle text-muted-foreground">{t('ventes:commun.nonRenseigne')}</span>
    );
  }

  const Icone = garantie.active ? ShieldCheck : ShieldOff;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Icone
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            garantie.active ? 'text-foreground' : 'text-muted-foreground',
          )}
        />
        <span
          className={cn(
            'texte-corps',
            garantie.active ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {t(garantie.active ? 'ventes:suivi.garantie.active' : 'ventes:suivi.garantie.echue')}
        </span>
      </div>
      <span className="texte-libelle text-muted-foreground">
        {t('ventes:suivi.garantie.depuisLe', { date: formaterDate(garantie.debutLe) })}
        {garantie.finLe ? (
          <> · {t('ventes:suivi.garantie.jusquAu', { date: formaterDate(garantie.finLe) })}</>
        ) : (
          <>
            {' '}
            · <span className="italic">{t('ventes:suivi.garantie.dureeInconnue')}</span>
          </>
        )}
        {garantie.plafondKm !== null ? (
          <>
            {' '}
            ·{' '}
            {t('ventes:suivi.garantie.plafond', {
              km: formaterKilometrage(garantie.plafondKm, 'km'),
            })}
          </>
        ) : null}
      </span>
    </div>
  );
}
