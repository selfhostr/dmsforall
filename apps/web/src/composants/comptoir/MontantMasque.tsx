import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Cellule de remplacement pour un montant STRUCTURELLEMENT absent du DTO parce que le rôle
 * courant n'a pas droit aux montants (`ROLES_SANS_MONTANT`, invariant front n°10 —
 * `totalTtcCentimes`/`ligne.montants` retirés CÔTÉ SERVEUR, jamais `0`/`null`).
 *
 * Issue #157 (rapport terrain) : la cellule vide (`''`) qu'on posait jusqu'ici à la place du
 * montant se lit exactement comme une absence de donnée (« aucune restitution promise », par
 * exemple) — un technicien ne peut pas distinguer « ce montant n'existe pas » de « ce montant
 * existe, vous n'avez pas le droit de le voir ». Trois façons de ne rien afficher ne doivent
 * JAMAIS se confondre (CONTRIBUTING.md) : vide *authentique*, zéro, et masqué par un droit. Ce
 * composant porte la troisième — texte court + pictogramme sobre (jamais une icône criarde, WCAG
 * AA : l'icône est décorative, `aria-hidden`, le texte seul porte le sens pour un lecteur
 * d'écran), et un `title` pour qui veut la phrase complète au survol/appui long tablette.
 *
 * Volontairement DISTINCT du tiret cadratin utilisé ailleurs pour « aucune valeur » (voir
 * `lib/formats.ts`) — un même signe pour deux significations différentes serait le même défaut
 * que la cellule vide, juste déplacé.
 */
export function MontantMasque() {
  const { t } = useTranslation('commun');

  return (
    <span
      className="inline-flex items-center gap-1 texte-libelle text-muted-foreground"
      title={t('commun:montants.masqueDescription')}
    >
      <Lock aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t('commun:montants.masque')}
    </span>
  );
}
