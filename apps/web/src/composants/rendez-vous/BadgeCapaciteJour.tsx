import { CheckCircle2, Circle, HelpCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';
import { cn } from '@/lib/utils';

import { classerCapaciteJour, formaterDureeCourte, minutesRestantes } from './capacite';
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
  /**
   * `'complet'` (défaut) : la ligne complète occupé/capacité + marge, comme décrit ci-dessous — la
   * place ne manque pas (vue Jour, colonne unique). `'resume'` : le mot d'état reste toujours
   * affiché (jamais la couleur seule), mais la ligne de durée se réduit à la seule marge encore
   * libre (« encore 6h00 libres ») — pour la vue Semaine, où sept pastilles se partagent la largeur
   * (voir `GrilleAgendaSemaine`) et où la phrase complète déborde. Le détail complet reste
   * disponible au survol (`title`) et intégralement dans l'aria-label du jour (inchangé dans les
   * deux cas — porté par l'appelant, pas par ce badge).
   */
  readonly niveauDetail?: 'complet' | 'resume';
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
 * les mots « disponible »/« complet » ; sinon, l'occupation en heures sur la capacité en heures,
 * ET la marge encore libre quand il y en a une (`4h30 occupée sur 8h00 — encore 3h30 libres`) —
 * pas un nombre de rendez-vous sur un nombre de rendez-vous : la donnée réelle
 * (`GET /rendez-vous/capacite`) compte des MINUTES, jamais des créneaux. Le solde restant est omis
 * quand il est nul (jour `complet`) : le mot « Complet » porte déjà l'alerte, un « encore 0h00
 * libres » serait redondant. C'est la phrase COMPLÈTE ci-dessus, en `niveauDetail="complet"`
 * (défaut) — voir `niveauDetail` pour la variante compacte de la vue Semaine.
 */
export function BadgeCapaciteJour({
  nombreRendezVous,
  minutesOccupees,
  capaciteMinutes,
  niveauDetail = 'complet',
  className,
}: Props) {
  const { t } = useTranslation('planning');
  const etat = classerCapaciteJour(minutesOccupees, capaciteMinutes);
  const config = CONFIG_CAPACITE[etat];
  const reste = minutesRestantes(minutesOccupees, capaciteMinutes);
  const libelleEtat = t(`planning:capacite.etat.${CLES_ETAT_CAPACITE[etat]}`);

  const libelleComplet =
    capaciteMinutes === null
      ? t('planning:capacite.brut', { reserves: nombreRendezVous })
      : reste !== null && reste > 0
        ? t('planning:capacite.fractionAvecReste', {
            occupe: formaterDureeCourte(minutesOccupees),
            capacite: formaterDureeCourte(capaciteMinutes),
            reste: formaterDureeCourte(reste),
          })
        : t('planning:capacite.fraction', {
            occupe: formaterDureeCourte(minutesOccupees),
            capacite: formaterDureeCourte(capaciteMinutes),
          });

  // Résumé compact (vue Semaine) : la marge encore libre SEULE quand elle existe (l'info qui
  // répond à « puis-je encore prendre un client ce jour-là ? »), le compte brut quand la capacité
  // n'est pas paramétrée, et rien quand le jour est complet — le mot « Complet » porte déjà
  // l'alerte, même doctrine que la variante complète.
  const libelleResume =
    capaciteMinutes === null
      ? t('planning:capacite.brut', { reserves: nombreRendezVous })
      : reste !== null && reste > 0
        ? t('planning:capacite.resteSeul', { reste: formaterDureeCourte(reste) })
        : null;

  if (niveauDetail === 'resume') {
    return (
      // `block w-full min-w-0` : sans ça, ce wrapper (enfant flex de l'en-tête de jour en
      // `items-start`) se dimensionne à son propre contenu (min/max-content) au lieu de suivre la
      // largeur RÉTRÉCIE de la colonne — le `max-w-full` du badge ci-dessous n'aurait alors plus
      // rien de significatif à quoi se comparer, et la pastille déborde de la colonne (régression
      // constatée et prouvée en exécution à 1024px avant ce correctif).
      <span title={`${libelleComplet} · ${libelleEtat}`} className="block w-full min-w-0">
        <BadgeStatut
          icone={config.icone}
          token={config.token}
          forme={config.forme}
          className={cn('max-w-full items-start rounded-lg py-1 text-left', className)}
        >
          {/* PAS de `items-start` ici : sur un flex-col, il fait revenir EXACTEMENT le même piège
              que le wrapper englobant (ci-dessus) — chaque ligne reprendrait sa largeur de
              contenu au lieu de suivre celle, rétrécie, du badge, et `truncate` n'aurait plus de
              largeur de référence pour tronquer. Défaut `stretch` : chaque ligne suit la largeur
              du badge, `min-w-0` sur chacune l'autorise à rétrécir sous son propre contenu. */}
          <span className="min-w-0 leading-tight [overflow-wrap:anywhere]">
            <span>{libelleEtat}</span>
            {libelleResume ? <span> {libelleResume}</span> : null}
          </span>
        </BadgeStatut>
      </span>
    );
  }

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={cn('max-w-full', className)}
    >
      <span>{libelleComplet}</span>
      <span>· {libelleEtat}</span>
    </BadgeStatut>
  );
}
