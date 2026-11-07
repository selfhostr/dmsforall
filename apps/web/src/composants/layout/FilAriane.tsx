import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export interface SegmentFilAriane {
  readonly cle: string;
  readonly libelle: string;
  readonly href: string;
}

interface Props {
  /**
   * Ancêtres cliquables, du plus général au plus spécifique — jamais la page courante (voir
   * `pageCourante` ci-dessous). Chacun devient un vrai `<Link>` (guide d'accessibilité web du
   * dépôt : un fil d'Ariane est fait de vrais liens, contrairement à `IdentiteClient`/
   * `IdentiteVehicule` qui restent des `<button onClick>` ailleurs dans l'app). Ce composant ne
   * construit aucune URL lui-même — l'appelant lui passe des chemins déjà résolus (`chemins.*`,
   * mêmes cibles que les blocs identité cliquables du Lot B).
   */
  readonly segments: readonly SegmentFilAriane[];
  /** Le dernier maillon, la page actuellement affichée — texte, jamais un lien. */
  readonly pageCourante: string;
  readonly className?: string;
}

/**
 * Fil d'Ariane contextuel (Lot C, `docs/plan-refonte-navigation.md`) : « qui et quoi »
 * (`Martin SA › VD 123 456 · Golf VII › OR-2026-0184`), à la place du fil de menu générique
 * (« Atelier › Ordres de réparation › Détail »). `<nav aria-label>` + liste, dernier segment
 * `aria-current="page"` — voir le guide d'accessibilité web du dépôt.
 */
export function FilAriane({ segments, pageCourante, className }: Props) {
  const { t } = useTranslation('navigation');

  return (
    <nav aria-label={t('navigation:filAriane.aria')} className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 texte-libelle text-muted-foreground">
        {segments.map((segment) => (
          <li key={segment.cle} className="flex items-center gap-1.5">
            <Link
              to={segment.href}
              className="zone-cible rounded-sm underline-offset-4 hover:text-foreground hover:underline anneau-focus"
            >
              {segment.libelle}
            </Link>
            <span aria-hidden="true">›</span>
          </li>
        ))}
        <li aria-current="page" className="font-medium text-foreground">
          {pageCourante}
        </li>
      </ol>
    </nav>
  );
}
