import { cn } from '@/lib/utils';

/** Ratio largeur/hauteur du monogramme (viewBox 250×110) — permet de dériver la largeur depuis la
 *  seule hauteur demandée, sans jamais déformer le tracé. */
const RATIO_LARGEUR_HAUTEUR = 250 / 110;

interface Props {
  /** Hauteur rendue en pixels ; la largeur en est dérivée (le tracé ne se déforme jamais). */
  readonly hauteur?: number;
  readonly className?: string;
}

/**
 * Monogramme « DFA » — D orange plein, F et A noirs pleins, italique géométrique (un seul
 * `skewX` appliqué au groupe, jamais de police système : le rendu est identique sur toute
 * plateforme). Nom de marque, `aria-label` volontairement en dur (aucune clé i18n requise pour un
 * nom propre — voir consigne de la tâche d'intégration).
 *
 * Mêmes tracés que `apps/web/public/favicon.svg`, SANS le contour clair du F/A : ce composant ne
 * s'affiche qu'à l'intérieur de l'application, toujours sur un fond clair (aucun mode sombre
 * aujourd'hui — voir EnTete.tsx / EcranConnexion.tsx), contrairement à l'onglet du navigateur où
 * le thème sombre du système peut faire disparaître un noir sans contour.
 */
export function LogoDfa({ hauteur = 32, className }: Props) {
  const largeur = Math.round(hauteur * RATIO_LARGEUR_HAUTEUR);

  return (
    <svg
      role="img"
      aria-label="dmsforall"
      width={largeur}
      height={hauteur}
      viewBox="-25 -5 250 110"
      className={cn('shrink-0', className)}
    >
      <g transform="skewX(-12)">
        <g transform="translate(0,0)">
          <path
            fillRule="evenodd"
            fill="#F07E17"
            d="M0,0 H28 C54,0 78,22 78,50 C78,78 54,100 28,100 H0 Z M28,28 C42,28 50,36 50,50 C50,64 42,72 28,72 Z"
          />
        </g>
        <g transform="translate(75,0)">
          <path fill="#111111" d="M0,0 H68 V28 H28 V38 H58 V66 H28 V100 H0 Z" />
        </g>
        <g transform="translate(140,0)">
          <path
            fillRule="evenodd"
            fill="#111111"
            d="M26,0 L54,0 L80,100 L0,100 Z M35.8,70 L44.2,70 L52,100 L28,100 Z"
          />
        </g>
      </g>
    </svg>
  );
}
