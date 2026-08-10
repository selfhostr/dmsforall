/**
 * Habillage commun de TOUT contrôle de saisie du produit — `Input`, `Textarea`, `DateInput`,
 * `SelectTrigger`, et tout futur champ. Une seule chaîne, un seul endroit : avant le Lot K, ces
 * quatre composants répétaient chacun leur propre liste de classes, et elles avaient déjà
 * divergé (`SelectTrigger` posait `focus:outline-none` là où `Input` posait
 * `focus-visible:outline-none` — deux comportements de focus différents pour deux champs voisins
 * dans le même formulaire).
 *
 * Les cinq états sont couverts ici, aucun composant n'a à les redéfinir :
 *
 * - REPOS     : contour `--input`, mesuré à 3.49:1 sur blanc. WCAG 1.4.11 exige 3:1 pour la
 *               limite d'un contrôle — c'est le seul repère qui dit à l'utilisateur où
 *               commence la zone où il peut écrire.
 * - SURVOL    : le contour passe à la couleur de marque. Signal de découvrabilité à la souris,
 *               sans déplacement d'un seul pixel (on ne change que la couleur, jamais
 *               l'épaisseur — un contour qui épaissit au survol fait sauter la mise en page).
 * - FOCUS     : `.anneau-focus` (voir index.css). Anneau extérieur de 2 px en couleur de
 *               marque, 8.25:1 sur blanc.
 * - ERREUR    : piloté par `aria-invalid` — jamais par une prop décorative séparée. Contour
 *               rouge + lavis rouge très clair. La couleur ne porte PAS l'information seule :
 *               l'appelant doit toujours rendre le message d'erreur associé (voir `DateInput`,
 *               qui pose `aria-describedby` sur ce message).
 * - DÉSACTIVÉ : fond `--muted` + texte `--muted-foreground`, PAS `opacity-50` comme sur les
 *               boutons. La distinction est métier : un champ désactivé contient très souvent
 *               une valeur qu'il faut encore pouvoir LIRE (n° de facture verrouillé, total
 *               calculé, plaque d'un véhicule livré) ; un bouton désactivé n'a rien à faire
 *               lire, il doit seulement paraître inerte. Réduire l'opacité d'une valeur qu'on
 *               doit lire, c'est la rendre illisible sans raison.
 *
 * `text-base` (16 px) SANS réduction sur bureau : en dessous de 16 px, iPad zoome au focus.
 * La hauteur (`h-11`, 44 px) est portée par chaque composant, parce que `Textarea` ne l'a pas.
 */
export const CLASSES_CHAMP = [
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground',
  'placeholder:text-muted-foreground',
  'transition-[color,background-color,border-color]',
  'hover:border-marque',
  'anneau-focus',
  'aria-invalid:border-destructive aria-invalid:bg-destructive/5',
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground',
].join(' ');
