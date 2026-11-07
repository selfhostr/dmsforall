# DESIGN.md

Référence visuelle de dmsforall : palette, typographie, densité, règles de bordure, mode sombre et contraintes d'accessibilité. Lire ce document avant de créer ou de modifier un écran dans `apps/web/src/ecrans/`.

Ce document est en français. Il décrit l'état du code ; en cas de doute, le code et les tests font foi.

Les valeurs chiffrées (ratios de contraste) sont calculées selon la formule WCAG 2.1 et rejouées à chaque `pnpm test` par `apps/web/src/test/accessibilite/contraste-jetons.spec.ts`. La méthode est dans `apps/web/src/test/accessibilite/contraste.ts` et la lecture des jetons dans `jetons-css.ts`. Si un chiffre ci-dessous ne correspond plus au test, le test a raison et ce document doit être corrigé.

## Familles de couleur

Le produit a trois familles de couleur, chacune avec un rôle exclusif. Ne pas introduire de quatrième famille.

- **Marque** (`--marque`, `--marque-fort`, `--marque-doux`). Valeur `#083f45` en clair et `#4ccce6` en sombre. Rôle : bouton principal, lien, élément de menu actif, anneau de focus. La marque ne sert jamais à porter un statut.
- **Neutres** (`--foreground`, `--border`, `--input`, `--muted`, `--secondary`, `--accent`, `--card`, `--popover`). Rôle : texte, structure, surfaces. Un neutre ne porte jamais un sens.
- **Six feux d'atelier** (`--statut-*` et `--statut-*-fond`). Palette de sévérité générale : `neutre`, `info`, `attention`, `succes`, `danger`, `terminal`. Ils servent à tout ce qui se lit comme un degré de sévérité : statut d'un ordre de réparation, échéance, disponibilité d'une pièce, statut d'un dossier de vente.

Règles :

- La marque et la famille `--avertissement` ne se posent jamais sur les six feux, et inversement.
- Il n'existe pas de jeton d'urgence séparé. L'urgence se lit avec les six feux.
- **Forme, icône et mot sont obligatoires sur tout badge ou pastille qui porte un feu.** La couleur seule ne transmet jamais un statut.

## Jetons clairs

Le thème clair est la base shadcn, avec un fond de page légèrement teinté.

| Jeton                                  | Valeur    | Rôle                                           |
| -------------------------------------- | --------- | ---------------------------------------------- |
| `--background`                         | `#f0f0f3` | Fond de page                                   |
| `--foreground`                         | `#09090b` | Texte principal                                |
| `--card` / `--popover`                 | `#ffffff` | Surface de carte, menu                         |
| `--marque`                             | `#083f45` | Couleur de marque, `--primary`                 |
| `--marque-fort`                        | `#052a2e` | Survol ou appui d'une surface pleine de marque |
| `--marque-doux`                        | `#edf6f7` | Surlignage (élément actif, sélection)          |
| `--secondary` / `--muted` / `--accent` | `#f2f2f4` | Surfaces neutres (bouton secondaire, survol)   |
| `--muted-foreground`                   | `#62626a` | Texte atténué                                  |
| `--destructive`                        | `#b81e1e` | Action destructrice                            |
| `--border`                             | `#d7d7dc` | Trait décoratif (non soumis au seuil de 3:1)   |
| `--input`                              | `#888896` | Contour de contrôle de saisie (3:1 requis)     |
| `--ring`                               | `#083f45` | Anneau de focus                                |
| `--avertissement`                      | `#77420d` | Texte d'un bandeau d'alerte                    |
| `--avertissement-fond`                 | `#fef7eb` | Fond d'un bandeau d'alerte                     |

Le fond de page `#f0f0f3` sépare les cartes blanches sans bordure ni ombre. Les neutres `--muted` et `--secondary` restent proches en luminosité du fond. Toutes les paires texte restent au-dessus de leur seuil.

## Jetons sombres

Un jeton absent du bloc `.dark` garde sa valeur claire (échelle d'espacement, durées, `--destructive`).

| Jeton                                  | Valeur    | Rôle                                    |
| -------------------------------------- | --------- | --------------------------------------- |
| `--background`                         | `#111113` | Fond de page                            |
| `--foreground`                         | `#edeef0` | Texte principal (16.39:1 sur le fond)   |
| `--card`                               | `#18191b` | Surface de carte                        |
| `--popover`                            | `#212225` | Surface haute (menu, popover)           |
| `--marque`                             | `#4ccce6` | Couleur de marque                       |
| `--marque-fort`                        | `#67d4e9` | Survol, plus clair que la marque        |
| `--marque-doux`                        | `#1e393e` | Surlignage                              |
| `--primary-foreground`                 | `#111113` | Texte sombre sur bouton plein de marque |
| `--secondary` / `--muted` / `--accent` | `#212225` | Surfaces neutres                        |
| `--muted-foreground`                   | `#b0b4ba` | Texte atténué                           |
| `--border`                             | `#363a3f` | Trait décoratif                         |
| `--input`                              | `#696e77` | Contour de contrôle (3:1 requis)        |
| `--avertissement`                      | `#f99410` | Texte d'un bandeau d'alerte             |
| `--avertissement-fond`                 | `#2d1b06` | Fond d'un bandeau d'alerte              |
| `--avertissement-bordure`              | `#bd720f` | Bordure d'encart                        |

Choix à connaître :

- `--input` vaut `slate-9` et non `slate-8` : `slate-8` ne tient pas 3:1 sur une carte.
- `--marque-fort` est plus claire que `--marque` en sombre, car la marque y est déjà claire.
- `--primary-foreground` est sombre. Aucune teinte de la famille cyan ne tient 4.5:1 en texte blanc sur fond de marque.

### Contrastes mesurés (tokens de base)

| Paire                                                 | Ratio   | Seuil |
| ----------------------------------------------------- | ------- | ----- |
| `--foreground` sur `--background` (sombre)            | 16.39:1 | 4.5:1 |
| `--muted-foreground` sur `--background` (sombre)      | 9.06:1  | 4.5:1 |
| `--marque` sur `--background` (sombre)                | 9.96:1  | 4.5:1 |
| `--primary-foreground` sur `--primary` (sombre)       | 9.96:1  | 4.5:1 |
| `--input` sur `--background` (sombre)                 | 3.68:1  | 3:1   |
| `--input` sur `--card` (sombre)                       | 3.43:1  | 3:1   |
| `--ring` sur `--card` (sombre)                        | 9.29:1  | 3:1   |
| `--avertissement` sur `--avertissement-fond` (sombre) | 7.29:1  | 4.5:1 |
| `--input` sur `--background` (clair)                  | 3.10:1  | 3:1   |
| `--statut-neutre` sur `--background` (clair)          | 4.61:1  | 4.5:1 |

Le texte blanc sur `--destructive` vaut 6.48:1 dans les deux thèmes.

### Feux d'atelier

| Feu       | Clair : texte / fond | Sombre : texte / fond |
| --------- | -------------------- | --------------------- |
| neutre    | 4.86:1               | 7.55:1                |
| info      | 5.23:1               | 7.17:1                |
| attention | 4.92:1               | 10.12:1               |
| succes    | 5.18:1               | 7.67:1                |
| danger    | 5.71:1               | 7.86:1                |
| terminal  | 7.27:1               | 9.95:1                |

Le seuil AA pour le texte normal est 4.5:1. Toutes les valeurs passent sur leur fond. En clair, la paire la plus serrée, `neutre` sur le fond de page, n'a qu'une marge de 2 % : toute modification de `--background` clair doit revérifier cette ligne.

Réserve : en sombre, `neutre` et `terminal` sont deux gris presque identiques. La distinction repose sur l'icône et le mot du badge, jamais sur la teinte seule.

## Typographie

Deux polices, auto-hébergées dans `apps/web/src/polices/` et servies par l'application. Aucune police n'est chargée depuis un CDN.

- **IBM Plex Sans** pour la lecture.
- **IBM Plex Mono** pour les identifiants (plaque, VIN, numéro d'ordre de réparation). Le zéro est barré et les caractères `1`, `l` et `I` sont distincts.

Huit rôles typographiques, définis dans `apps/web/src/index.css` (`.densite-dense`, `.densite-aeree`, `.densite-tres-aeree`). La taille d'un rôle ne change pas avec le thème. Plancher : aucun texte lu ne descend sous 13 px (le libellé compact valait 12 px avant le lot « densité et cibles »).

| Rôle               | Classe                      | Dense | Aérée | Très aérée |
| ------------------ | --------------------------- | ----- | ----- | ---------- |
| Libellé            | `.texte-libelle`            | 13/16 | 14/20 | 16/24      |
| Corps              | `.texte-corps`              | 14/20 | 16/24 | 18/28      |
| Titre de section   | `.texte-titre-section`      | 16/24 | 18/28 | 20/28      |
| Titre d'écran      | `.texte-titre-page`         | 20/28 | 22/28 | 24/32      |
| Donnée proéminente | `.texte-donnee-proeminente` | 20    | 22    | 24         |
| Chiffre à distance | `.texte-chiffre-geant`      | 32    | 40    | 48         |

## Densité et espacement

Trois densités, chacune avec son jeu de jetons `--espace-*`, hérité par toute la sous-arborescence :

- `.densite-dense` (nom d'usage : **compacte**) : souris et grand écran ;
- `.densite-aeree` : tablette ;
- `.densite-tres-aeree` : pointage (borne).

### Choix selon l'appareil

La densité de l'application est choisie par `useDensite()` (`apps/web/src/hooks/useDensite.ts`) et posée sur `<html>` par `SynchronisationDensite` (montée dans `App.tsx`). Un écran n'a rien à faire : il lit les jetons.

| Condition (mode automatique)             | Densité    | Corps | Libellé | Ligne de tableau | Barre haute |
| ---------------------------------------- | ---------- | ----- | ------- | ---------------- | ----------- |
| `(pointer: coarse)` OU largeur < 1024 px | `aeree`    | 16 px | 14 px   | 48 px            | 56 px       |
| Sinon (souris, y compris 1024-1279 px)   | `compacte` | 14 px | 13 px   | 40 px            | 44 px       |

- L'utilisateur peut forcer « Compacte » ou « Aérée » depuis le bouton `Aa` de la barre haute (`SelecteurDensite`, à côté de la bascule de thème). Le choix est stocké dans le navigateur (`localStorage`, clé `dfa-densite`), comme le thème : aucun point d'API. « Automatique » est le défaut.
- `index.html` pose `densite-dense`/`densite-aeree` avant le premier rendu (même règle que `resoudreDensite`) ; `Button size="sm"` mesure 44 px visibles en `aeree` et `tres-aeree`.
- La borne de pointage garde `densite-tres-aeree` posée localement (sa sous-arborescence l'emporte sur la racine).
- `Table` et `TableComptoir` n'ont plus de densité par défaut : ils héritent de la racine. Ne passer `densite=` que pour un cas qui diffère réellement de l'appareil.
- Aucune hauteur ou taille n'est écrite en dur dans un composant : `--densite-hauteur-ligne`, `--hauteur-barre-haute`, `--texte-*`, `--cible-tactile` (index.css).

### Cible tactile

`--cible-tactile` vaut 44 px dans toutes les densités. Tout contrôle interactif (onglet, segment, bouton icône, lien de fil d'Ariane, bouton d'identification de ligne, bouton de copie) mesure au moins 44 px de haut et de large, y compris à la souris : un poste de bureau peut devenir une tablette. Un contrôle visuellement plus petit étend sa zone avec la classe `.zone-cible` (pseudo-élément invisible, aucun effet sur la mise en page). Interdit : `h-8`, `h-9` sur un contrôle cliquable.

`--espace-carte` vaut 16, 20 et 24 px selon la densité. `--espace-carte-compacte` vaut 12, 16 et 20 px. Le composant `Card` accepte la prop `compact` pour basculer sur ce second rembourrage.

Un écran n'écrit jamais de marge en dur (`p-6`). Il lit `p-carte`, `gap-groupe` ou `gap-section`.

### Cadre

La barre haute vaut 44 px en compacte et 56 px en aérée (`--hauteur-barre-haute`). Les onglets de domaine et les vues (`OngletsDomaine`) tiennent sur UNE rangée de 44 px quand la largeur le permet, les vues à droite ; elles ne passent sur une seconde rangée que si les deux ne tiennent pas côte à côte. Hauteur avant le titre d'écran : 89 px au lieu de 104 à 148 px en compacte avec vues.

## Bordure structurelle uniquement

Une bordure sépare une zone dont le comportement diffère : contour d'un contrôle de saisie, filet entre deux lignes de tableau, cadre de l'application. Une bordure ne délimite jamais un simple groupe de contenu. Ce rôle revient à l'espacement, à l'alignement et à la typographie.

Une surface et une ombre ou une bordure ne se cumulent pas pour séparer un même bloc.

- `Card` (`apps/web/src/components/ui/card.tsx`) n'a ni bordure ni ombre. Il se sépare du fond par la différence de teinte entre `--background` et `--card`. Ce delta est faible (1.14:1 en clair, 1.07:1 en sombre). La séparation réelle entre deux cartes vient donc de l'espacement entre elles et du poids du titre. Vérifier à l'œil toute grille dense de cartes.
- `Table` (`apps/web/src/components/ui/table.tsx`) pose un filet horizontal entre les lignes, sans zébrage.
- `shadow-sm` est réservé aux éléments qui flottent au-dessus du flux : menu, popover, boîte de dialogue, panneau latéral.

## Mode sombre

### Mécanisme

- `next-themes` (version 0.4.x), avec persistance dans `localStorage` sous la clé `dfa-theme` et suivi de la préférence système. Le fournisseur est dans `apps/web/src/App.tsx`.
- La variante Tailwind `dark:` est pilotée par une classe `.dark` sur `<html>` (`@custom-variant dark` dans `index.css`), pour qu'un choix manuel l'emporte sur la préférence système.
- Un script synchrone dans `apps/web/index.html` pose la classe avant le premier rendu, pour éviter un flash clair. La clé `dfa-theme` lue par ce script doit rester identique au `storageKey` du fournisseur.
- Le bouton de bascule est `apps/web/src/composants/layout/BasculeTheme.tsx`. Il propose deux états, clair et sombre. Le mode « système » reste le point de départ avant tout clic.
- `<meta name="theme-color">` suit le thème actif, pour la barre système des téléphones.

Le choix de thème est stocké dans le navigateur uniquement. Il n'existe ni colonne en base ni point d'API pour le thème : chaque poste garde son réglage.

## Composants

Tout composant à superposition ou portail (Dialog, Popover, Select, Combobox, Menu, Tooltip, Sheet, Drawer, Toast, Command) reste sur Radix et shadcn, dans `apps/web/src/components/ui/`.

Un composant feuille, sans portail ni piège de focus, peut provenir du registre coss (MIT). Chaque fichier garde un commentaire de provenance. Base UI et Radix gèrent chacun le focus et `aria-hidden` de leurs propres couches sans se connaître : mesuré en exécution, un Dialog Radix modal ouvert avec un Popover Base UI rend ce dernier invisible aux lecteurs d'écran. Ne jamais mélanger les deux familles dans un même arbre de composants ouverts en même temps.

### Onglets, segments et badges de statut

- **Un seul composant d'onglets** : `components/ui/tabs.tsx` (Base UI). `TabsList variante="soulignee"` (défaut) pour les onglets de fiche ; `variante="segments"` pour un sélecteur segmenté. Pour un simple filtre sans panneau (bascule liste/plan, horizon, onglet de liste), utiliser `composants/commun/Segments.tsx` : `<Segments valeur onChange options ariaLabel />`. Interdit : réécrire un `tablist` à la main avec `h-9`.
- `OngletsDomaine` est une navigation par liens (`aria-current`), pas un `tablist` ; il lit les mêmes jetons de taille.
- **Un seul badge de statut** : `composants/identite/BadgeStatut.tsx` (`icone`, `token`, `forme`). Interdit de recomposer `border-statut-*` / `bg-statut-*-fond` dans un écran.

## Focus et accessibilité

- Le focus est visible partout. `.anneau-focus` (anneau extérieur) pour les contrôles du flux. `.anneau-focus-interne` (anneau intérieur, `box-shadow: inset`) pour un élément dans un conteneur `overflow: hidden`, comme un item de `Select`.
- L'anneau de focus a un contraste d'au moins 8.4:1 sur les surfaces du thème sombre.
- Un changement visuel qui casse un parcours au clavier ou une lecture d'écran n'est pas acceptable.
- Chaque écran affiche ses états de chargement, vide et erreur.
- La check-list de la skill `web-design-guidelines` doit être passée avant de déclarer un écran conforme.

## Méthode de mesure

Les ratios sont calculés par `apps/web/src/test/accessibilite/contraste.ts` (luminance relative WCAG 2.1, sans dépendance) à partir des jetons lus dans `index.css` par `jetons-css.ts`. Ce module distingue les blocs `:root` et `.dark` et reproduit la cascade CSS : un jeton absent de `.dark` retombe sur sa valeur `:root`.

`axe-core` ne mesure pas le contraste réel dans ce dépôt, car jsdom ne calcule pas les styles rendus. La mesure sur les valeurs HSL déclarées est donc la méthode retenue.

## Retour après une action

Chaque action qui réussit donne un retour visible. Mécanisme générique, branché sur le `mutationCache` de `App.tsx` (`apps/web/src/api/toast-succes-mutation.ts`) : la mutation déclare son toast dans `meta`, elle n'appelle jamais un toast elle-même.

```ts
useMutation({
  mutationFn,
  // Toast « Client créé », 8 s, sans bouton.
  meta: { succes: 'commun:toasts.clientCree' },
});

useMutation({
  mutationFn,
  // Toast « OR terminé » avec « Annuler » pendant 8 s ; `annuler` reçoit (donnees, variables)
  // et doit rétablir l'état précédent (appel API inverse) en rejetant s'il échoue.
  meta: {
    succes: 'commun:toasts.orTermine',
    annuler: (_donnees, { id }) => rouvrirOrdreReparation(id),
  },
});
```

- `succes` : clé i18n `namespace:cle`. Sans `meta.succes`, rien n'est affiché (pas de bruit pour un brouillon ou un rafraîchissement). Valeurs ICU : `succesVariables: (donnees, variables) => ({ nom })`.
- `annuler` : facultatif, réservé aux actions réellement réversibles par l'API. Le toast se met en pause au survol et au focus.
- Les clés partagées vivent dans `commun.json` sous `toasts.*` (FR, DE, IT) ; une clé propre à un domaine peut vivre dans son namespace.
- Exemples branchés : `useCreerClient`, `useCreerVehicule`, `useDeplacerRendezVous`, `useCreerArticle`, `useArreterPointage`.
- Un échec reste traité par le filet d'erreur (`FiletErreurMutation`) ; `ToastsSucces` (bas gauche, `role="status"`) et le filet d'erreur (bas droit, `role="alert"`) ne se mélangent jamais. Le toast de succès flotte sur `bg-popover` (icône `statut-succes` pour le signal) : la couleur `statut-succes-fond` reste réservée aux badges de statut « terminé ».

### Quand garder un dialogue de confirmation

Le dialogue est réservé aux actions **irréversibles ou à effet externe**. Toute action réversible passe en toast avec « Annuler ».

Dialogue obligatoire :

- émission d'une facture (verrouillée ; la correction passe par un avoir) et émission d'un avoir ;
- clôture d'une période de pointage ;
- envoi d'un document ou d'une relance au client (courriel, impression officielle) ;
- suppression définitive d'une donnée (client, véhicule, article) et rejet d'un brouillon ;
- encaissement (écriture comptable) et export fiduciaire ;
- changement de rôle ou retrait d'accès d'un utilisateur.

Toast avec « Annuler » (pas de dialogue) : démarrer ou terminer un OR, déplacer un rendez-vous, changer un statut de ligne, marquer une consigne rendue, créer une fiche.
