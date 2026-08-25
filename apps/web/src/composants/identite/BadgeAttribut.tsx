import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  /** Icône ou glyphe déjà rendu (LucideIcon dimensionné en `h-3.5 w-3.5`, ou span emoji pour
   *  `BadgeLangueCorrespondance`) — jamais posé seul comme signal : chaque badge de cette famille
   *  reste lisible par son texte, l'icône n'est qu'un renfort visuel. Optionnel : certains badges
   *  d'attribut n'en ont pas besoin. */
  readonly icone?: ReactNode;
  /** Accentue le texte (gras + `text-foreground` au lieu de `text-muted-foreground`) pour signaler
   *  un écart qui mérite l'attention (client bloqué, expertise échue) — jamais par une couleur de
   *  la palette `--statut-*`, réservée au statut d'un OR ou d'une ligne (voir `BadgeStatut`). */
  readonly accentue?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Squelette partagé des badges d'ATTRIBUT métier — famille délibérément distincte de
 * `BadgeStatut` : ceux-ci ne portent JAMAIS l'un des six tokens `--statut-*` (§5.4 du document
 * atelier — le budget couleur de statut est réservé au statut d'OR/de ligne). Un type de client,
 * une langue de correspondance ou une échéance d'expertise ne sont pas des statuts : les
 * confondre visuellement laisserait croire qu'ils progressent dans un cycle de vie.
 *
 * Compose la primitive générique `Badge` (`components/ui/badge.tsx`, variant `outline`) plutôt que
 * de reconstruire le balisage. Avant ce composant, six badges du domaine (`BadgeStatutClient`,
 * `BadgeTypeClient`, `BadgeImporte`, `BadgeIdentificationIncomplete`, `BadgeLangueCorrespondance`,
 * `BadgeEcheanceExpertise`) reproduisaient chacun, indépendamment, la même chaîne de classes
 * Tailwind (`inline-flex items-center gap-1 rounded-full border border-input bg-background
 * px-2.5 py-0.5 texte-libelle font-medium text-muted-foreground`) — `BadgeStatutClient`
 * documentait déjà cet écart par rapport à `BadgeStatut` comme un choix assumé, mais sans jamais
 * factoriser une base commune avec les cinq autres, qui divergeaient de la même façon sans le
 * documenter du tout.
 */
export function BadgeAttribut({ icone, accentue = false, className, children }: Props) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 bg-background',
        accentue ? 'font-semibold text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {icone}
      {children}
    </Badge>
  );
}
