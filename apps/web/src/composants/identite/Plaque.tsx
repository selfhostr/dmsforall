import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const variantesPlaque = cva(
  // Signature visuelle du produit (direction produit) : fond Alu dédié, filet appuyé, JetBrains Mono 600.
  // - `bg-card` plutôt que `bg-muted` : `bg-muted`/`bg-secondary`/`bg-accent` partagent tous la
  //   même valeur de jeton (voir index.css) et sont le gris générique de toute autre surface
  //   atténuée du produit (survol, fond de menu…) — une plaque qui les réutilise n'a plus de
  //   signature, elle se confond avec n'importe quel badge. `--card` est un jeton DÉDIÉ à une
  //   surface, distinct de `--muted` dans les deux thèmes (blanc plein en clair contre gris
  //   95.9 % — proche du rendu alu/inox d'une vraie plaque suisse ; plus sombre que `--muted` en
  //   sombre, lecture « plaque encastrée » plutôt que « survol »). Aucun nouveau jeton ajouté :
  //   `index.css` est hors périmètre de ce lot (voir le brief) — composition avec les jetons
  //   `@theme inline` déjà mesurés (contrastes vérifiés dans Plaque.spec.tsx).
  // - `border-2` (au lieu de `border`, 1px) : le filet « appuyé » qui donne son cadre à la plaque.
  //   Reste `border-input`, seul jeton du produit déjà mesuré ≥ 3:1 (WCAG 1.4.11) sur toutes les
  //   surfaces utilisées ici — aucune nouvelle couleur, seulement l'épaisseur.
  //   Exception légitime à « bordure structurelle uniquement » (DESIGN.md) : cette bordure ne
  //   délimite pas un groupe de contenu, elle EST la forme reconnaissable d'un objet réel (une
  //   plaque d'immatriculation a un cadre physique) — au même titre que le contour d'un contrôle
  //   de saisie que DESIGN.md cite explicitement comme cas structurel légitime.
  // - `texte-identifiant` (`index.css`) plutôt que `font-mono` cru : c'est l'utilitaire déjà posé
  //   pour cette famille (« plaque, châssis/VIN, n° d'OR… »), jamais utilisé avant ce composant.
  //   Porte JetBrains Mono + tabular-nums + un tracking dédié ; `font-semibold` (600) reste séparé
  //   pour rester la SEULE source du poids — « JetBrains Mono 600 », pas 700.
  'inline-flex w-fit items-center gap-1 rounded border-2 border-input bg-card texte-identifiant font-semibold text-foreground',
  {
    variants: {
      taille: {
        sm: 'h-5 px-1 texte-petit',
        md: 'h-6 px-1.5 texte-corps',
        // `.texte-donnee-proeminente` et non `.texte-titre-page` : une plaque n'est ni un titre
        // ni un libellé, mais à cette taille c'est la donnée mise en avant sur l'écran (fiche
        // véhicule) — exactement le rôle que la table décrit, tabular-nums et poids inclus.
        xl: 'h-10 px-3 texte-donnee-proeminente',
      },
    },
    defaultVariants: { taille: 'md' },
  },
);

interface Props extends VariantProps<typeof variantesPlaque> {
  /** Code canton (2 lettres), `null` pour une plaque étrangère sans canton connu. Sert
   *  uniquement à styliser le préfixe canton déjà présent dans `numero` (voir plus bas) — jamais
   *  à le préfixer une seconde fois. */
  readonly canton: string | null;
  /** Numéro de plaque tel que rendu par le serveur (`VehiculeResume.plaque` /
   *  `ReponseVehiculePlaque.valeur`) : le canton y est **déjà inclus** en préfixe suisse
   *  standard (`VS 123456`) — `canton` est un champ structuré redondant côté contrat, pas un
   *  fragment à concaténer. `null` si le véhicule n'en porte aucune aujourd'hui (RM-17) — le
   *  composant ne rend alors rien de saillant, juste un tiret neutre. */
  readonly numero: string | null;
  readonly className?: string;
}

/** Plaque d'immatriculation — canton + numéro, fond Alu dédié + filet appuyé + JetBrains Mono 600 (voir
 *  `variantesPlaque` plus haut), une seule variante visuelle pour tout le produit (invariant n°1 :
 *  `IdentiteVehicule` compose ce composant, ne réimplémente jamais l'affichage d'une plaque).
 *  `numero` porte déjà le canton en préfixe côté contrat ; ce composant ne fait que distinguer
 *  visuellement le préfixe canton (`text-muted-foreground`, plus atténué) du reste du numéro, il
 *  ne le RECOMPOSE jamais — le refaire produirait un doublon (`VS VS 123456`). */
export function Plaque({ canton, numero, taille, className }: Props) {
  if (!numero) {
    return <span className={cn('texte-libelle text-muted-foreground', className)}>—</span>;
  }

  const prefixeCanton = canton && numero.startsWith(`${canton} `) ? canton : null;
  const reste = prefixeCanton ? numero.slice(prefixeCanton.length + 1) : numero;

  return (
    <span className={cn(variantesPlaque({ taille }), className)}>
      {prefixeCanton ? <span className="text-muted-foreground">{prefixeCanton}</span> : null}
      <span>{reste}</span>
    </span>
  );
}
