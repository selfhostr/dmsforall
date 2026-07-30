import { AlertTriangle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formaterDate } from '@/lib/formats';
import { cn } from '@/lib/utils';

/** Niveau de relance à partir duquel l'indicateur bascule en `--statut-danger` plutôt qu'en
 *  `--statut-attention` (§2.4 : « relance avancée, paramétrable »). Le paramétrage réel par tenant
 *  n'existe pas encore côté contrat — seuil fixe assumé ici, à rendre configurable le jour où
 *  `parametresAtelier`-like expose un seuil de facturation. */
const NIVEAU_RELANCE_AVANCEE = 2;

interface Props {
  readonly relanceNiveau: number;
  readonly relanceLe: string | null;
  readonly className?: string;
}

/**
 * Indicateur de retard (§2.4) — texte + icône ACCOLÉ au badge de règlement, jamais une variante de
 * couleur du badge lui-même.
 *
 * ADAPTATION AU CONTRAT RÉEL : le mockup du design (« en retard de 12 j ») suppose une date
 * d'échéance que `ReponseDocumentVente` n'expose pas (`conditionsPaiement` est un
 * `Record<string, unknown>` délibérément opaque, sans forme garantie — voir son commentaire dans
 * `document.ts`). Calculer un nombre de jours de retard à partir d'un champ dont la forme n'est pas
 * contractuelle serait une donnée fabriquée, pas lue. Cet indicateur s'appuie donc sur les deux
 * champs RÉELLEMENT dérivés et garantis par le serveur : `relanceNiveau` (0 = à jour) et
 * `relanceLe` (date de la dernière relance envoyée) — à réévaluer si une date d'échéance devient un
 * jour un champ de premier niveau du contrat.
 */
export function IndicateurRetard({ relanceNiveau, relanceLe, className }: Props) {
  const { t } = useTranslation('facturation');

  if (relanceNiveau <= 0) return null;

  const avancee = relanceNiveau >= NIVEAU_RELANCE_AVANCEE;
  const Icone = avancee ? AlertTriangle : Clock;
  const texte = avancee
    ? t('facturation:retard.relanceAvancee', { niveau: relanceNiveau })
    : t('facturation:retard.premierNiveau');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 texte-libelle',
        avancee ? 'text-statut-danger' : 'text-statut-attention',
        className,
      )}
      title={relanceLe ? t('facturation:retard.relanceLe', { date: formaterDate(relanceLe) }) : undefined}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {`· ${texte}`}
    </span>
  );
}
