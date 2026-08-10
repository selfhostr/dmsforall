# Évaluation — kokonutui comme source de composants pour dmsforall

Date : 09.08.2026. Évaluation seule : aucun fichier du dépôt applicatif n'a été modifié, aucune
dépendance installée. Sources : dépôt `kokonut-labs/kokonutui` sur GitHub (README, LICENSE,
`package.json`, `components.json`, `registry.json`, contenu de plusieurs composants), et l'état réel
du dépôt DFA (`apps/web/package.json`, `apps/web/src/ecrans/`, `apps/web/src/composants/`,
`apps/web/src/components/ui/`, `docs/plan-refonte-navigation.md` §Lot K).

## Recommandation (tranchée)

**Ne pas adopter maintenant. Si un jour adopté, seulement après le Lot K, et sous forme
d'inspiration réécrite — pas de copie.** Le catalogue est à 90 % marketing/décoratif (texte
animé, boutons à particules, arrière-plans en mouvement), inutilisable tel quel sur un DMS dense ;
la poignée de composants pertinents (upload de fichier) répond à une fonctionnalité qu'on n'a pas
encore, ce qui contredit la consigne actuelle de @laupernoe (pas de nouvelle fonctionnalité tant que
l'app n'est pas entièrement fonctionnelle) ; et introduire une deuxième source de composants avant
que le Lot K ait codifié la première (tokens, typographie, densité, états) créerait une divergence
visuelle qu'on paierait ensuite à corriger.

## 1. Qu'est-ce que c'est exactement

Pas une bibliothèque installable au sens npm. `components.json` du dépôt kokonutui déclare le
schéma `https://ui.shadcn.com/schema.json` et un bloc `registries` pointant vers
`https://kokonutui.com/r/{name}.json` : c'est un **registre au format shadcn**, consommé par la CLI
`shadcn add <url>`, qui **copie le code source du composant dans le dépôt consommateur**. Aucun
`import { X } from "kokonutui"` n'existe — chaque composant récupéré devient un fichier `.tsx`
propriétaire à maintenir chez nous, exactement comme nos primitives actuelles dans
`apps/web/src/components/ui/`.

**Licence : MIT**, vérifiée dans `LICENSE` du dépôt (texte standard, autorise usage, copie,
modification, distribution commerciale, sans obligation de publication du code dérivé — seule
exigence : conserver la notice de copyright). Aucun obstacle pour un produit commercial. Ce n'est
pas le point bloquant ici.

## 2. Compatibilité réelle avec notre stack — verdict net

| Aspect    | kokonutui                                                                                             | DFA (`apps/web/package.json`)                     | Verdict                                                    |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Framework | Next.js `^16.2.10`, `rsc: true` (composants serveur par défaut)                                       | React + Vite (SPA pure, pas de Next)              | **Incompatible pour une partie du catalogue**              |
| React     | `^19.2.7`                                                                                             | `^19.0.0`                                         | Compatible (même majeure)                                  |
| Tailwind  | `^4.3.0`                                                                                              | `^4.0.6`                                          | Compatible (même majeure, format CSS-first v4)             |
| Animation | `motion` (`^12.23.25`, ex-Framer Motion) — dépendance dure de la quasi-totalité des composants animés | Aucune lib d'animation en dépendance actuellement | **Nouvelle dépendance à assumer, composant par composant** |
| Icônes    | `lucide-react`                                                                                        | `lucide-react`                                    | Compatible                                                 |

Le blocage n'est donc pas Next.js dans l'absolu — React 19 et Tailwind 4 correspondent aux
versions du dépôt. Le blocage est **au niveau de chaque fichier individuel** : inspection directe
de plusieurs composants montre que certains importent `next/image` et `next/link`
(`profile-dropdown.tsx`), inutilisables tels quels dans une SPA Vite (il faudrait les réécrire en
`<img>` et `react-router` `Link` à la main). D'autres (`file-upload.tsx`, `smooth-tab.tsx`,
`toolbar.tsx`) n'ont pas cette dépendance et ne sont bloqués que par `"use client"` — directive
inoffensive hors Next (ignorée par Vite, ne casse pas le build) — et par l'import de `motion/react`.

**Verdict net : aucun composant kokonutui n'est du copier-coller direct utilisable.** Chacun exige
une passe de portage manuelle (retirer les imports Next, décider si `motion` vaut la dépendance
pour ce cas précis, revérifier les tokens de couleur contre les nôtres). Ce n'est pas un « ajouter
un composant », c'est « réécrire un composant en s'inspirant d'un autre ».

## 3. Ce que contient réellement le catalogue

Liste exhaustive des 44 composants du registre (`components/kokonutui/*.tsx` du dépôt) :
`action-search-bar`, `ai-input-search`, `ai-loading`, `ai-prompt`, `ai-text-loading`, `ai-voice`,
`apple-activity-card`, `attract-button`, `avatar-picker`, `background-paths`, `beams-background`,
`bento-grid`, `card-flip`, `card-stack`, `carousel-cards`, `command-button`, `currency-transfer`,
`dynamic-text`, `file-upload`, `flow-field`, `glitch-text`, `gradient-button`, `hold-button`,
`liquid-glass-card`, `loader`, `matrix-text`, `morphic-navbar`, `mouse-effect-card`,
`particle-button`, `profile-dropdown`, `scroll-text`, `shape-hero`, `shimmer-text`, `sliced-text`,
`slide-text-button`, `smooth-drawer`, `smooth-tab`, `social-button`, `spotlight-cards`,
`swoosh-text`, `switch-button`, `swoosh-text`, `team-selector`, `toolbar`, `tweet-card`,
`type-writer`, `v0-button`.

Le nom seul est parlant : effets de texte (glitch, matrix, shimmer, sliced, swoosh, machine à
écrire), boutons à effet (particules, aimant, maintien, dégradé, glissement), arrière-plans animés
(champ de particules, faisceaux, chemins), cartes à bascule/pile, carrousel, carte de tweet. C'est
un catalogue de **page d'accueil / landing marketing**, conçu pour capter l'attention en continu —
l'exact opposé de ce qu'un comptoir sous pression demande. Sur 44 composants, une poignée seulement
touche à de l'UI fonctionnelle : `file-upload`, `smooth-drawer` (tiroir), `smooth-tab` (onglets),
`toolbar`, `profile-dropdown`, `loader`, `avatar-picker`. Et parmi ceux-là, la plupart font double
emploi avec ce qu'on a déjà : `smooth-drawer` ≈ notre `Sheet` (Radix), `smooth-tab` ≈ notre `Tabs`
(Radix, déjà utilisé pour `OngletsDomaine`), `profile-dropdown` ≈ notre `DropdownMenu` (Radix,
déjà accessible, déjà utilisé), `loader` ≈ notre `Skeleton` (déjà systématisé via `EtatChargement`).

## 4. Où un gain réel existerait — et pourquoi ce n'est pas le moment

J'ai cherché des cas où un composant apporterait une lisibilité ou une clarté d'état mesurable sur
nos écrans réels (`BlocActiviteTableauBord.tsx`, `PanneauResultatsRecherche.tsx`,
`TableComptoir.tsx`, `skeleton.tsx`). Constat honnête : je n'en trouve **qu'un seul candidat
défendable**, pas trois à cinq.

- **`file-upload` — état de dépôt de fichier (glisser-déposer, statuts idle/dragging/uploading/
  erreur).** Aujourd'hui, grep sur `ecrans/` et `composants/` ne trouve **aucun** composant
  d'upload dans toute l'application — ni pour les pièces jointes d'expertise, ni pour les photos
  VN/VO, ni pour les documents fournisseur. Le jour où l'un de ces besoins entre en spécification
  (ce n'est le cas d'aucun aujourd'hui — ni Étape 4 Ventes, ni Étape 3 Pièces ne le prévoient), la
  machine à états de `file-upload.tsx` (quatre statuts explicites, gestion d'erreur nommée) est un
  bon point de départ conceptuel. **Mais c'est une fonctionnalité qu'on n'a pas, pas un habillage
  d'écran existant** — donc hors du périmètre demandé par @laupernoe maintenant. Ce qu'on perd à ne pas
  le faire aujourd'hui : rien, puisqu'aucun écran n'en a besoin actuellement.

Les autres pistes que j'ai examinées et écartées, avec la raison précise :

- **`toolbar` (barre d'actions flottante avec tooltips)** pour une sélection multiple dans
  `TableComptoir.tsx` : séduisant en théorie (actions groupées sur plusieurs lignes de pièces),
  mais aucune fonctionnalité de sélection multiple n'existe ni n'est spécifiée dans le module
  comptoir actuel. Composant sans écran d'accueil réel — spéculatif.
- **`smooth-tab` sur `OngletsDomaine.tsx` (navigation principale)** : l'onglet animé ajoute une
  transition visuelle au changement de section. Sur une navigation consultée des dizaines de fois
  par heure par un même utilisateur, la vitesse de commutation prime sur l'effet — exactement le
  type de coût que le principe de densité proscrit. Notre `Tabs` Radix actuel change d'état
  instantanément et reste accessible au clavier ; rien à gagner, un import `motion` à payer.
  Rejeté.
- **`loader` / `ai-loading` en remplacement de `Skeleton`** : notre squelette actuel
  (`components/ui/skeleton.tsx`, `animate-pulse`) est déjà utilisé de façon disciplinée via
  `EtatChargement`, avec un compte de lignes explicite par écran (`lignes={4}` dans
  `BlocActiviteTableauBord`). Un indicateur de chargement plus « stylé » n'améliore la lisibilité
  d'aucune donnée — pure décoration à l'endroit précis où le garagiste attend un chiffre, pas un
  effet.

Aucun des cas examinés ne justifie une adoption immédiate. C'est un résultat valable : la
bibliothèque n'a simplement pas été conçue pour ce type de produit.

## 5. Ce qu'il ne faut clairement pas prendre, et pourquoi

- **Tout composant à animation continue ou déclenchée par simple survol sur une cible d'action**
  (`particle-button`, `attract-button`, `hold-button`, `gradient-button`, `slide-text-button`,
  `switch-button`) : sur un écran de comptoir, un bouton doit être identifié et actionné en une
  fraction de seconde par quelqu'un qui regarde alternativement l'écran et le client en face de
  lui. Un effet de particules ou d'aimantation retarde la perception du clic réussi et ne survit à
  aucun test `prefers-reduced-motion` sérieux — kokonutui ne semble respecter ce média-query sur
  aucun des composants inspectés (les animations sont posées en dur via `motion`, sans garde).
  Contraire au principe « un écran, une action primaire évidente ».
- **Tout effet de fond animé** (`flow-field`, `beams-background`, `background-paths`,
  `liquid-glass-card`, `mouse-effect-card`, `spotlight-cards`) : coût de rendu continu (souvent
  `requestAnimationFrame` en boucle) sur une tablette d'atelier ou un poste de comptoir qui tourne
  déjà TanStack Query, potentiellement plusieurs onglets métier ouverts. Aucune fonction
  informationnelle — décoration pure, à l'opposé de la densité scannable exigée pour les listes
  d'OR et de stock.
- **Tout effet de texte** (`glitch-text`, `matrix-text`, `shimmer-text`, `sliced-text`,
  `swoosh-text`, `type-writer`, `dynamic-text`, `scroll-text`) : un montant, un statut d'OR ou une
  échéance d'expertise doit être lu instantanément et sans ambiguïté, dans trois langues, par un
  garagiste sous pression. Un texte qui s'anime avant de se stabiliser est un obstacle direct à la
  règle « 10 secondes pour comprendre ».
- **`tweet-card`, `apple-activity-card`, `bento-grid`** : vocabulaire visuel de landing page
  (réseaux sociaux, produits Apple), sans rapport avec le vocabulaire métier garage suisse exigé
  (OR, VN/VO, expertise, pointage).

## 6. Risque de divergence avec le Lot K — réel, et évitable seulement en s'abstenant maintenant

Le Lot K (`docs/plan-refonte-navigation.md`, section « Système visuel et cohérence des
composants ») **n'est pas encore fait** : pas de famille typographique déclarée dans `index.css`,
pas de couleur d'accent tranchée (distincte des six tokens `--statut-*` réservés), audit des
divergences de composants pas encore mené, quatre états (repos/survol/focus/désactivé/chargement)
pas encore vérifiés systématiquement sur les primitives shadcn existantes. C'est explicitement le
lot qui doit dire « à quoi les choses ressemblent », alors que le reste du plan ne dit encore que
« où elles vont ».

Importer des composants kokonutui maintenant reviendrait à fixer une deuxième palette, une
deuxième échelle d'espacement et un deuxième vocabulaire d'états **avant** que la première
(shadcn/ui + tokens `apps/web/src/index.css`) soit elle-même codifiée. Deux systèmes qui n'ont
jamais été réconciliés divergent mécaniquement — c'est exactement le risque nommé dans la consigne
de cette évaluation, et il est réel ici : kokonutui a sa propre base de couleur (`baseColor: zinc`
dans son `components.json`, sans les tokens `--statut-*` de DFA), et ses composants animés
introduisent un vocabulaire de mouvement qu'aucune règle DFA ne régit encore (le Lot K le prévoit,
tâche 5 : « auditer les quatre états sur les primitives »).

**Ordre correct s'il devait y avoir adoption un jour** : Lot K d'abord (typographie, accent,
densité, états, `prefers-reduced-motion` tranché une fois pour toutes) — seulement ensuite un
composant ponctuel de kokonutui, réécrit pour porter les tokens DFA plutôt que copié tel quel.
Jamais l'inverse.

## Synthèse en trois lignes

Licence MIT, aucun problème commercial. Compatibilité technique correcte sur React/Tailwind mais
chaque composant exige un portage manuel (imports Next, dépendance `motion`) — ce n'est pas du
copier-coller shadcn malgré le format de registre identique. Le catalogue est à 90 % décoratif et
inadapté à un DMS dense ; le seul usage défendable (upload de fichier) répond à une fonctionnalité
qu'on n'a pas encore : ne pas adopter maintenant, et si jamais utile un jour, après le Lot K et en
réécriture, jamais en copie.
