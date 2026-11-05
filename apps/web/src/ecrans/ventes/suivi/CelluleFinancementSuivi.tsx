import { useTranslation } from 'react-i18next';

import type { SuiviFinancement } from '@dfa/shared';

import { formaterDate } from '@/lib/formats';

import { BadgeStatutFinancement } from '../financements/BadgeStatutFinancement';

interface Props {
  /** `null` : ce dossier n'a aucun financement crédit/leasing à suivre (il apparaît alors dans
   *  cette liste uniquement via sa garantie — voir l'en-tête du contrat). */
  readonly financement: SuiviFinancement | null;
}

/** `TypeFinancementVente` -> suffixe camelCase de `ventes:financement.types`, même mapping que
 *  `CarteFinancementResume`. */
const CLES_TYPE: Record<SuiviFinancement['type'], string> = {
  comptant: 'comptant',
  credit: 'credit',
  leasing: 'leasing',
};

/**
 * Colonne financement du suivi (`GET /ventes/suivi`) — RF-116 appliquée en LISANT le corps de la
 * réponse serveur, jamais en re-dérivant un droit côté client. `dureeMois`/`echeanceLe` sont des propriétés OPTIONNELLES du
 * contrat (`SuiviFinancement`) : `'echeanceLe' in financement` vaut `false` quand le serveur les a
 * OMISES (rôle sans droit financier) — un `financement.echeanceLe === undefined` a exactement la
 * même valeur JS qu'un champ omis, `in` est le seul test qui distingue fiablement « omis » de
 * « présent mais valant `undefined` » après désérialisation JSON (JSON.stringify ne sérialise
 * jamais une clé `undefined`, donc `in` reflète exactement ce que le serveur a envoyé).
 *
 * `echeanceLe === null` (clé PRÉSENTE, valeur `null`) est un cas DIFFÉRENT et légitime : le rôle
 * voit les montants, mais aucune échéance n'est calculable (financement pas encore confirmé) —
 * l'un ne doit jamais être confondu avec l'autre, ni l'un ni l'autre avec une date inventée.
 */
export function CelluleFinancementSuivi({ financement }: Props) {
  const { t } = useTranslation('ventes');

  if (!financement) {
    return (
      <span className="texte-libelle text-muted-foreground">{t('ventes:commun.nonRenseigne')}</span>
    );
  }

  const echeanceOmise = !('echeanceLe' in financement);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="texte-corps font-medium text-foreground">
          {t(`ventes:financement.types.${CLES_TYPE[financement.type]}`)}
        </span>
        <BadgeStatutFinancement statut={financement.statutConfirmation} />
      </div>
      {financement.organisme ? (
        <span className="texte-libelle text-muted-foreground">
          {financement.organisme.nomAffiche}
        </span>
      ) : null}
      <span className="texte-libelle text-muted-foreground">
        {t('ventes:suivi.financement.echeance')} :{' '}
        {echeanceOmise ? (
          <span className="italic">{t('ventes:suivi.financement.nonCommunique')}</span>
        ) : financement.echeanceLe ? (
          formaterDate(financement.echeanceLe)
        ) : (
          <span className="italic">{t('ventes:suivi.financement.nonConfirmee')}</span>
        )}
      </span>
    </div>
  );
}
