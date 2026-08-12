import { CheckCircle2, Circle, HelpCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

import { classerCapaciteJour, formaterDureeCourte } from './capacite';
import type { EtatCapaciteJour } from './types';

const CONFIG_CAPACITE: Readonly<
  Record<
    EtatCapaciteJour,
    { readonly icone: LucideIcon; readonly token: TokenStatut; readonly forme: FormeBadge }
  >
> = {
  disponible: { icone: CheckCircle2, token: 'succes', forme: 'plein' },
  presque_complet: { icone: TriangleAlert, token: 'attention', forme: 'plein' },
  complet: { icone: Circle, token: 'danger', forme: 'plein' },
  // Contour + neutre, comme `BadgeStatutOr` pour un état qui ne dit rien d'anormal — ici « on ne
  // sait pas », jamais confondu avec « disponible » (icône ET mot distincts, jamais la couleur
  // seule à porter cette distinction).
  non_definie: { icone: HelpCircle, token: 'neutre', forme: 'contour' },
};

/** Suffixe de la clé `planning:capacite.etat.<suffixe>` — casse camelCase du fichier de traduction,
 *  distincte de la valeur d'enum snake_case (même patron que `BadgeStatutOr`, `EntreeStatutOr.cle`). */
const CLES_ETAT_CAPACITE: Readonly<Record<EtatCapaciteJour, string>> = {
  disponible: 'disponible',
  presque_complet: 'presqueComplet',
  complet: 'complet',
  non_definie: 'nonDefinie',
};

interface Props {
  readonly nombreRendezVous: number;
  readonly minutesOccupees: number;
  /** `null` = site sans capacité configurée en paramétrage — voir `classerCapaciteJour`. */
  readonly capaciteMinutes: number | null;
  readonly className?: string;
}

/**
 * Résumé de capacité d'un jour — QUATRE états explicites (disponible / presque complet / complet /
 * capacité non définie), jamais la couleur seule (`docs/conception-rendez-vous-ecrans.md`, « Le
 * point le plus délicat »). Le mot ET l'icône portent la distinction, comme `BadgeStatutOr`.
 *
 * SIMPLIFICATION ASSUMÉE DU LOT 1 (signalée par le coordinateur) : la capacité d'un jour est
 * comparée au budget JOURNALIER du site, jamais à un budget par moment — `capaciteMinutes` est
 * donc la même valeur pour tous les rendez-vous d'un même jour, quel que soit leur `moment`.
 *
 * `capaciteMinutes === null` rend UNIQUEMENT le compte brut (`5 rendez-vous`), sans jamais employer
 * les mots « disponible »/« complet » ; sinon, l'occupation en heures sur la capacité en heures
 * (`4h30 / 8h00`) — pas un nombre de rendez-vous sur un nombre de rendez-vous : la donnée réelle
 * (`GET /rendez-vous/capacite`) compte des MINUTES, jamais des créneaux.
 */
export function BadgeCapaciteJour({
  nombreRendezVous,
  minutesOccupees,
  capaciteMinutes,
  className,
}: Props) {
  const { t } = useTranslation('planning');
  const etat = classerCapaciteJour(minutesOccupees, capaciteMinutes);
  const config = CONFIG_CAPACITE[etat];

  const libelleNombre =
    capaciteMinutes === null
      ? t('planning:capacite.brut', { reserves: nombreRendezVous })
      : t('planning:capacite.fraction', {
          occupe: formaterDureeCourte(minutesOccupees),
          capacite: formaterDureeCourte(capaciteMinutes),
        });

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      <span>{libelleNombre}</span>
      <span>· {t(`planning:capacite.etat.${CLES_ETAT_CAPACITE[etat]}`)}</span>
    </BadgeStatut>
  );
}
