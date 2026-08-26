DESIGN.md
=========

Référence obligatoire pour tout travail visuel sur dmsforall (DFA) : palette, typographie, densité,
règles de layout, mode sombre, et les contraintes qui en découlent. Écrit pour un agent qui arrive
sans contexte — avant de toucher un écran (`apps/web/src/ecrans/`), lis ce document en entier. Il
documente des décisions de @laupernoe et des mesures de contraste réelles ; il ne documente pas des goûts.

Toute valeur chiffrée ci-dessous est mesurée, pas estimée : ratio de contraste WCAG 2.1 calculé
programmatiquement, rejoué à chaque `pnpm test` par
`apps/web/src/test/accessibilite/contraste-jetons.spec.ts` (méthode dans `contraste.ts`, lecture des
jetons dans `jetons-css.ts`). Un
nombre qui apparaît ici et qui ne correspond plus au test a divergé de la réalité — c'est le test
qu'il faut croire, pas ce document.

Historique : ce lot (socle) fait suite à un audit chiffré des griefs visuels de @laupernoe (« cartes dans
des cartes », « padding vide », « pas de mode sombre »…), consultable dans l'historique git. Trois
griefs sur cinq se sont révélés partiellement ou totalement infirmés à la mesure ; ce qui restait a
produit ce document. Les 18 domaines d'écrans (`ecrans/ventes`, `ecrans/atelier`…) ne sont **pas**
couverts par ce lot — ils appliqueront les règles ci-dessous, domaine par domaine, dans des lots
séparés.

Statut et portée
-----------------

Ce lot livre le **socle** : jetons de couleur (clair + sombre), le levier de densité de carte, la
règle de bordure, le mécanisme de bascule de thème, et l'infrastructure de mesure de contraste.
Aucun écran de `apps/web/src/ecrans/` n'est retouché par ce lot — le socle change leur rendu
(`Card` perd son contour, le fond de page change de teinte, le mode sombre devient sélectionnable)
sans qu'aucun de leurs fichiers ne soit modifié.

Deux résidus de code déjà présents avant ce lot utilisaient la variante Tailwind `dark:` par
anticipation, jamais rendue tant qu'aucune classe `.dark` n'existait dans le produit :
`apps/web/src/ecrans/console/BadgeStatutGarage.tsx:31` et
`apps/web/src/ecrans/console/BandeauContexteConsole.tsx:54` (variantes ambre). Depuis ce lot, ces
deux variantes sont **vivantes** — un utilisateur en thème sombre les voit réellement. Elles n'ont
pas été mesurées ni revues ici (hors périmètre de ce lot, `ecrans/` n'est pas touché) : à vérifier
ou à corriger dans le lot qui touchera `ecrans/console/`.

Palette — jetons de couleur
----------------------------

### La règle qui gouverne toute la palette

Le thème **clair** garde sa base shadcn existante, **inchangée** à l'exception du fond de page. Le
thème **sombre** est neuf dans ce lot, construit sur Radix Colors (`slate` pour les gris et les
surfaces, `cyan` pour la marque).

**Radix Colors ne remplace pas le clair.** Radix garantit son étape 11 (texte) contre ses étapes 1
à 2 (fond d'application), jamais contre son étape 3 (fond de composant, c'est-à-dire le fond d'un
badge de statut). Basculer le thème clair sur Radix ferait régresser quatre valeurs sous leur seuil,
dont une obligation WCAG :

| Paire Radix, en clair                     | mesuré | plancher requis   | valeur DFA actuelle |
| ----------------------------------------- | ------ | ----------------- | ------------------- |
| `blue-11` sur `blue-3`                    | 4.25:1 | 4.5:1 (AA texte)  | 5.23:1              |
| `amber-11` sur `amber-3`                  | 4.25:1 | 4.5:1 (AA texte)  | 4.92:1              |
| `green-11` sur `green-3`                  | 4.21:1 | 4.5:1 (AA texte)  | 5.18:1              |
| `slate-8` sur blanc (contour de contrôle) | 1.91:1 | 3:1 (WCAG 1.4.11) | 3.49:1 (`--input`)  |

Le clair actuel est donc plus strict que Radix. Il reste tel quel. Radix sert **exclusivement** au
sombre et aux gris — un futur agent qui voudrait « harmoniser » en migrant le clair sur Radix
romprait ces quatre garanties : ne le fais pas sans re-mesurer les quatre paires ci-dessus.

### Trois familles nommées

Le produit a trois familles de couleur, chacune avec un rôle exclusif — aucune quatrième teinte
n'existe ni ne doit être ajoutée, le travail restant est d'employer ces trois-là partout où elles
manquent, pas d'en inventer une nouvelle :

- **Sapin** — la marque (`--marque`/`--marque-fort`/`--marque-doux`, valeurs dans les tables
  « Jetons clairs »/« Jetons sombres » ci-dessous). `#083f45` en clair, `#4ccce6` en sombre : même
  jeton, valeur adaptée par thème (voir « La marque en sombre casse une doctrine » plus bas). Rôle :
  bouton principal, lien, élément de menu actif, anneau de focus. Jamais sur un badge de statut ni
  pour distinguer un état — Sapin dit « ceci est une action ou l'identité du produit », jamais
  « voici où en est ce dossier ».
- **Ardoise** — les neutres (`--foreground`, `--border`, `--input`, `--muted`/`--secondary`/
  `--accent`, `--card`/`--popover`), gris shadcn en clair, Radix `slate` en sombre (valeurs dans les
  mêmes tables). Rôle : texte, structure (bordure de contrôle, filet de tableau), surfaces neutres
  (carte, popover, survol). Jamais pour porter un sens : une carte, une bordure ou un texte en
  Ardoise ne dit ni « urgent » ni « terminé » — c'est le rôle des six feux d'atelier ci-dessous.
- **Six feux d'atelier** — les six `--statut-*`/`--statut-*-fond` (neutre, info, attention, succès,
  danger, terminal). Palette de sévérité générale, détaillée dans la section dédiée plus bas.

### Jetons clairs

Seul `--background` change dans ce lot ; tout le reste de la colonne « clair » est identique à avant
et reste défini dans `apps/web/src/index.css`, `:root` (couleurs) et le second bloc `:root`
(statuts).

| Jeton                                  | Valeur HSL       | Hex       | Rôle                                          |
| -------------------------------------- | ---------------- | --------- | --------------------------------------------- |
| `--background`                         | `240 11% 95%`    | `#f0f0f3` | Fond de page (nouveau, voir ci-dessous)       |
| `--foreground`                         | `240 10% 3.9%`   | `#09090b` | Texte principal                               |
| `--card` / `--popover`                 | `0 0% 100%`      | `#ffffff` | Surface de carte / menu                       |
| `--marque`                             | `186 80% 15%`    | `#083f45` | Couleur de marque (= `--primary`)             |
| `--marque-fort`                        | `186 80% 10%`    | `#052a2e` | Survol/appui d'une surface pleine de marque   |
| `--marque-doux`                        | `186 40% 95%`    | `#edf6f7` | Surlignage (élément de menu actif, sélection) |
| `--secondary` / `--muted` / `--accent` | `240 4.8% 95.9%` | `#f2f2f4` | Surfaces neutres (bouton secondaire, survol)  |
| `--muted-foreground`                   | `240 4% 40%`     | `#62626a` | Texte atténué (`.texte-libelle`)              |
| `--destructive`                        | `0 72% 42%`      | `#b81e1e` | Bouton/texte destructeur                      |
| `--border`                             | `240 5% 86%`     | `#d7d7dc` | Trait décoratif (exempté de 3:1)              |
| `--input`                              | `240 6% 56%`     | `#888896` | Contour de contrôle (WCAG 1.4.11, 3:1)        |
| `--ring`                               | = `--marque`     | `#083f45` | Anneau de focus                               |
| `--avertissement`                      | `30 80% 26%`     | `#77420d` | Texte de bandeau/encart d'alerte              |
| `--avertissement-fond`                 | `38 92% 96%`     | `#fef7eb` | Fond de bandeau/encart d'alerte               |

**Fond de page — l'arbitrage esthétique du lot.** Deux options mesurées : `#fcfcfd` (Radix
`slate-1`, quasi blanc, delta de 1.03:1 avec une carte blanche — presque imperceptible) et `#f0f0f3`
(delta de 1.14:1). @laupernoe a tranché `#f0f0f3` : les surfaces blanches ressortent sans bordure ni ombre,
c'est le mécanisme d'elevation par contraste de surface recommandé par Material Design 3, et c'est
plus lisible sur une tablette d'atelier en plein jour (un delta de 1.03:1 se noie dans un reflet).
Conséquence surveillée : `--muted`/`--secondary`/`--accent` (95.9 % de luminosité, inchangés)
deviennent proches en luminosité de ce nouveau fond (94.7 % visuel) — l'ordre reste correct
(fond < muted < carte, une échelle à trois paliers), mais l'écart fond/muted s'est resserré. Aucun
jeton texte n'en souffre : toutes les paires « sur `--background` » restent au-dessus de leur seuil
(`--input` : 3.49:1 → 3.10:1 ; `--statut-neutre` : 4.86:1 → 4.61:1 — marges réduites, jamais sous le
seuil).

### Jetons sombres

Nouveaux dans ce lot, définis dans `apps/web/src/index.css`, bloc `.dark` (juste après le `:root`
couleurs) et un second bloc `.dark` (juste après le `:root` statuts). Un jeton absent de cette
colonne n'a pas de valeur sombre distincte : il hérite de sa valeur claire (`--destructive`,
l'échelle d'espacement, les durées d'animation…) parce que sa lisibilité ne dépend pas du fond de
page.

| Jeton                                  | Valeur HSL    | Hex       | Rôle                                                               |
| -------------------------------------- | ------------- | --------- | ------------------------------------------------------------------ |
| `--background`                         | `240 6% 7%`   | `#111113` | Fond de page                                                       |
| `--foreground`                         | `220 9% 94%`  | `#edeef0` | Texte principal (16.39:1 sur fond)                                 |
| `--card`                               | `220 6% 10%`  | `#18191b` | Surface de carte (1.07:1 sur fond — renfort, pas séparateur)       |
| `--popover`                            | `225 6% 14%`  | `#212225` | Surface « haute » (menu, popover — 1.20:1 sur fond)                |
| `--marque`                             | `190 75% 60%` | `#4ccce6` | Couleur de marque (Radix `cyan-11` dark)                           |
| `--marque-fort`                        | `190 75% 66%` | `#67d4e9` | Survol/appui — **éclaircie**, pas assombrie (voir plus bas)        |
| `--marque-doux`                        | `190 35% 18%` | `#1e393e` | Surlignage (tonalité sombre de la marque, pas la marque elle-même) |
| `--primary-foreground`                 | `240 6% 7%`   | `#111113` | Texte **sombre** sur bouton plein de marque (voir plus bas)        |
| `--secondary` / `--muted` / `--accent` | `225 6% 14%`  | `#212225` | Surfaces neutres (= `--popover`)                                   |
| `--muted-foreground`                   | `216 7% 71%`  | `#b0b4ba` | Texte atténué (9.06:1 sur fond, 7.55:1 sur surface haute)          |
| `--border`                             | `213 8% 23%`  | `#363a3f` | Trait décoratif (exempté de 3:1)                                   |
| `--input`                              | `219 6% 44%`  | `#696e77` | Contour de contrôle (Radix `slate-9`, voir plus bas)               |
| `--avertissement`                      | `34 95% 52%`  | `#f99410` | Texte de bandeau/encart d'alerte                                   |
| `--avertissement-fond`                 | `32 75% 10%`  | `#2d1b06` | Fond de bandeau/encart d'alerte                                    |
| `--avertissement-bordure`              | `34 85% 40%`  | `#bd720f` | Bordure d'encart (5.01:1 sur fond, ≥ 3:1)                          |

Trois choix qui ne sont pas évidents à la lecture d'une simple table de valeurs :

- **`--input` prend `slate-9`, pas `slate-8`.** `slate-8` mesure 3.01:1 sur `--background` mais
  seulement 2.81:1 sur `--card` — échec de WCAG 1.4.11 dès qu'un champ de saisie est posé dans une
  carte, ce qui est le cas partout dans ce produit. Même piège que celui déjà corrigé côté clair.
- **`--marque-fort` est plus claire que `--marque`, pas plus sombre.** En clair, l'état de survol
  d'un bouton plein assombrit la couleur (plus de encre sur fond blanc). En sombre, la couleur de
  marque est déjà claire sur un fond sombre : ajouter de l'emphase va dans l'autre sens, on
  l'éclaircit encore.
- **`--primary-foreground` (le texte d'un bouton plein de marque) est sombre, pas blanc.** Vérifié
  séparément : aucune teinte de la famille sarcelle/cyan ne tient un contraste ≥ 4.5:1 en texte
  blanc, ni en clair ni en sombre (le pas « solid » standard de la famille, `#12a594`, ne mesure que
  3.07:1 en blanc). Le clair contourne le problème en assombrissant la marque elle-même (texte blanc
  sur marque foncée) ; le sombre fait l'inverse (marque claire, texte sombre dessus) — la seule
  combinaison qui tient le contraste dans les deux thèmes.

Mesures de contraste — tokens de base, sombre :

Valeurs recalculées sur les triplets HSL RÉELLEMENT stockés dans `index.css` (arrondis à l'entier,
comme toute déclaration du fichier) — pas sur les hex cibles d'origine, qui divergent parfois de
0.01 à 0.15 après cet arrondi. C'est cette colonne, pas un calcul fait à la main sur les hex, qui
correspond à ce que `contraste-jetons.spec.ts` vérifie réellement.

| Paire                                                 | Ratio   | Seuil             |
| ----------------------------------------------------- | ------- | ----------------- |
| `--foreground` sur `--background`                     | 16.39:1 | 4.5:1             |
| `--foreground` sur `--card`                           | 15.29:1 | 4.5:1             |
| `--muted-foreground` sur `--background`               | 9.06:1  | 4.5:1             |
| `--muted-foreground` sur `--popover` (= `--muted`)    | 7.55:1  | 4.5:1             |
| `--marque` (texte) sur `--background`                 | 9.96:1  | 4.5:1             |
| `--marque` (texte) sur `--card`                       | 9.29:1  | 4.5:1             |
| `--primary-foreground` sur `--primary` (bouton plein) | 9.96:1  | 4.5:1             |
| `--marque-doux-foreground` sur `--marque-doux`        | 6.48:1  | 4.5:1             |
| `--input` sur `--background`                          | 3.68:1  | 3:1 (WCAG 1.4.11) |
| `--input` sur `--card`                                | 3.43:1  | 3:1               |
| `--input` sur `--popover`/`--muted`                   | 3.07:1  | 3:1               |
| `--ring` sur `--background`                           | 9.96:1  | 3:1               |
| `--ring` sur `--card`                                 | 9.29:1  | 3:1               |
| `--ring` sur `--popover`                              | 8.30:1  | 3:1               |
| `--avertissement` sur `--avertissement-fond`          | 7.29:1  | 4.5:1             |
| `--avertissement-bordure` sur `--background`          | 5.01:1  | 3:1               |
| Texte blanc sur `--destructive` (théorique, inchangé) | 6.48:1  | 4.5:1             |

`--destructive`/`--destructive-fort`/`--destructive-foreground` ne sont **pas** redéclarés en
sombre : leur contraste (texte blanc sur rouge plein) ne dépend que de leurs deux propres couleurs,
jamais du fond de page — la même paire vaut dans les deux thèmes, vérifiée dans les deux blocs de
`contraste-jetons.spec.ts`.

### La marque en sombre casse une doctrine — c'est un arbitrage écrit, pas un oubli

Le produit applique la règle « une couleur ne dit jamais deux choses » : la teinte de marque (Sapin)
doit rester à plus de 30° d'écart de chaque jeton de sévérité (`--statut-*`, les « six feux
d'atelier ») sur le cercle chromatique, pour qu'un badge de statut et un bouton de marque ne soient
jamais confondables à l'œil. En clair, cette règle tient
(écarts de 31° à 174°). **En sombre, elle ne tient plus complètement** : la seule famille
sarcelle/cyan qui offre un contraste texte suffisant sur fond sombre (`cyan-11`, 190°) n'est qu'à
20° de `--statut-info` (210°, « en cours »). L'alternative testée (`teal-11`, 172°) ne fait que
déplacer le problème : 21° de `--statut-succes` (151°, « terminé »).

**@laupernoe a tranché : assumer cet écart réduit, à une condition explicite et non négociable.** La marque
reste identique dans les deux thèmes (une marque qui change de famille de couleur selon le thème
n'est plus une marque). Ce qui rend cet écart acceptable, ce n'est plus seulement la couleur : c'est
que **forme + icône + mot restent obligatoires sur chaque badge de statut, dans les deux thèmes,
sans exception.** Cette règle existait déjà comme bonne pratique documentée (`BadgeStatutOr`,
« la sémantique de statut ne repose jamais sur la couleur seule ») ; l'arbitrage de @laupernoe la
transforme en **contrainte de conformité** : un badge qui s'appuierait sur la seule couleur pour
distinguer « en cours » de la marque ne serait plus seulement un défaut d'ergonomie, il romprait la
condition qui rend le choix de la marque sombre défendable.

Six feux d'atelier — palette de sévérité, deux thèmes
---------------------------------------------------------

Six jetons de sévérité, chacun avec une teinte texte (`--statut-*`, contour de badge) et une teinte
fond (`--statut-*-fond`, badge « plein ») : neutre, info, attention, succès, danger, terminal.
Nommés à l'origine pour les six statuts d'un OR (Planifié, Ouvert/En cours, Contrôlé, Terminé,
Facturé, Clôturé) — c'est encore leur usage le plus visible, mais ce n'est plus le seul. Mesuré
dans le code : 54 fichiers les emploient en dehors du badge de statut d'OR lui-même, pour la
disponibilité d'une pièce, l'échéance d'un rendez-vous ou d'une relance, le statut d'un dossier de
vente, d'une reprise, d'un financement, d'une commande fournisseur, d'un règlement, d'un article, ou
la gravité d'un encart d'avertissement bloquant. Le texte normatif suit désormais cet usage réel.

Ces six jetons forment une **palette de sévérité générale**, pas un vocabulaire réservé à l'OR :

| Jeton       | Lecture                                   |
| ----------- | ----------------------------------------- |
| `neutre`    | état par défaut, sans urgence ni jugement |
| `info`      | en cours, transitoire, ne bloque rien     |
| `attention` | à traiter, en attente, demande une action |
| `succes`    | terminé, validé, disponible               |
| `danger`    | bloquant, en retard, refusé               |
| `terminal`  | clos, définitif, sans suite possible      |

N'importe quel écran peut réutiliser ces six teintes pour n'importe quelle dimension qui se lit
comme un degré de sévérité — statut d'une entité, urgence d'une échéance, disponibilité d'un stock,
gravité d'un message d'erreur.

**Ce qui reste interdit, sans exception :**

- Aucun jeton `--urgence-*` (ni aucune autre septième famille) : décision tranchée, l'urgence se lit
  avec ces six teintes, jamais avec une famille séparée.
- La couleur de marque (`--marque`/Sapin) et la famille `--avertissement` ne se posent jamais sur
  ces six jetons, et l'inverse n'est pas permis non plus — deux familles, deux rôles, jamais
  mélangées sur un même badge (voir « La marque en sombre casse une doctrine » ci-dessus).
- **Forme + icône + mot, toujours, sur tout badge ou pastille qui porte un de ces jetons — jamais la
  couleur seule.** Élargir le domaine d'emploi de la couleur renforce cette règle, il ne l'assouplit
  pas : le même bleu peut désormais signifier « OR en cours », « rendez-vous confirmé » ou
  « facture au statut info » selon l'écran. Seule la forme, l'icône et le mot lèvent l'ambiguïté —
  pour un utilisateur daltonien comme pour quiconque regarde l'écran à la volée.

Le clair est inchangé. Le sombre suit le même modèle produit, retourné : en clair, fond pâle + texte
foncé ; en sombre, fond profond + texte clair — exactement le modèle Radix (étape 3 = fond de
composant, étape 11 = texte).

Colonnes « texte/page » recalculées avec le nouveau `--background` clair (`#f0f0f3`, voir plus
haut) — plus serrées qu'avec un fond blanc pur, mais toutes encore au-dessus du seuil AA. Toutes les
valeurs ci-dessous sont les ratios RÉELS calculés sur les triplets HSL stockés dans `index.css`
(arrondis à l'entier comme toute déclaration du fichier), pas des valeurs à hex exact non arrondi —
c'est exactement ce que `contraste-jetons.spec.ts` vérifie.

| Jeton (exemple OR)        | Clair : texte/fond | Clair : texte/page | Sombre : hex texte + fond | Sombre : texte/fond | Sombre : texte/page |
| ------------------------- | ------------------ | ------------------ | ------------------------- | ------------------- | ------------------- |
| Planifié (neutre)         | 4.86:1             | 4.61:1             | `#b0b4ba` sur `#212225`   | 7.55:1              | 9.06:1              |
| Ouvert / En cours (info)  | 5.23:1             | 5.33:1             | `#70b8ff` sur `#0d2847`   | 7.17:1              | 8.97:1              |
| Contrôlé (attention)      | 4.92:1             | 4.71:1             | `#ffca16` sur `#302008`   | 10.12:1             | 12.15:1             |
| Terminé (succès)          | 5.18:1             | 5.07:1             | `#3dd68c` sur `#132d21`   | 7.67:1              | 10.06:1             |
| Facturé / annulé (danger) | 5.71:1             | 5.75:1             | `#ff9592` sur `#3b1219`   | 7.86:1              | 9.08:1              |
| Clôturé (terminal)        | 7.27:1             | 8.03:1             | `#edeef0` sur `#363a3f`   | 9.95:1              | 16.39:1             |

Seuil AA texte normal : 4.5:1. Toutes les valeurs passent. La marge s'est resserrée en clair sur la
colonne « texte/page » (conséquence directe du nouveau fond de page, voir plus haut) — la plus
basse, « planifié » à 4.61:1, ne garde que 2 % de marge au-dessus du seuil : un futur assombrissement
de `--background`, même léger, devrait revérifier cette ligne précisément. En sombre, la marge reste
large — la plus basse (« en cours », 7.17:1 sur son propre fond) reste 59 % au-dessus du seuil.

**Réserve mesurée, à ne jamais passer sous silence : `neutre` et `terminal` se rapprochent en
sombre.** Ce sont les deux seuls jetons sans teinte saturée (achromatiques) — vrai partout où ils
sont employés, pas seulement pour « planifié »/« clôturé » sur un OR. L'écart entre leurs deux
textes vaut 1.81:1 en sombre contre un écart plus large en clair ; l'écart entre leurs deux fonds
vaut 1.37:1. Conséquence directe de l'arbitrage décrit dans « La marque en sombre casse une
doctrine » ci-dessus : la distinction `neutre`/`terminal` repose **encore plus** qu'en clair sur la
forme, l'icône et le mot du badge — jamais uniquement sur la teinte de gris. Un badge qui
afficherait ces deux jetons sans icône distincte serait illisible en sombre, même si le contraste
texte mesure large.

Typographie
------------

L'échelle typographique n'a pas changé dans ce lot — un audit chiffré (grief « hiérarchie plate »)
l'a trouvée conforme : huit rôles, zéro taille brute posée à la main dans `tableau-bord/` et
`atelier/`. Elle vit dans `apps/web/src/index.css` (`.densite-dense/aeree/tres-aeree`) et reste
inchangée par le mode sombre (la couleur du texte varie par thème, jamais sa taille).

| Rôle                    | Classe                      | Dense | Aérée | Très aérée |
| ----------------------- | --------------------------- | ----- | ----- | ---------- |
| Libellé (en-tête, méta) | `.texte-libelle`            | 12/16 | 14/20 | 16/24      |
| Corps (tout le reste)   | `.texte-corps`              | 14/20 | 16/24 | 18/28      |
| Titre de section        | `.texte-titre-section`      | 16/24 | 18/28 | 20/28      |
| Titre d'écran           | `.texte-titre-page`         | 20/28 | 22/28 | 24/32      |
| Donnée proéminente      | `.texte-donnee-proeminente` | 20    | 22    | 24         |
| Chiffre à distance      | `.texte-chiffre-geant`      | 32    | 40    | 48         |

Deux polices : IBM Plex Sans (lecture) et IBM Plex Mono (identifiants — plaque, VIN, n° d'OR : zéro
barré, `1`/`l`/`I` distincts). Auto-hébergées, jamais de CDN (nLPD). Détail complet dans
`index.css:1-89`.

Densité et espacement
-----------------------

Trois densités : `.densite-dense` (bureau/comptoir), `.densite-aeree` (tablette d'atelier),
`.densite-tres-aeree` (pointage). Chacune pose son propre jeu de jetons `--espace-*`, hérité par
toute la sous-arborescence — un écran ne pose jamais `p-6` en dur, il lit `p-carte`, `gap-groupe`,
etc.

**Nouveau dans ce lot : `--espace-carte-compacte`, un second rembourrage de carte.**
`--espace-carte` seul obligeait une carte à deux lignes (un chiffre, un titre) à payer le même
rembourrage qu'une fiche d'OR à quinze champs.

| Densité               | `--espace-carte` (inchangé) | `--espace-carte-compacte` (nouveau) |
| --------------------- | --------------------------- | ----------------------------------- |
| `.densite-dense`      | 16 px                       | 12 px                               |
| `.densite-aeree`      | 20 px                       | 16 px                               |
| `.densite-tres-aeree` | 24 px                       | 20 px                               |

Écart de 4 px avec `--espace-carte` dans les trois densités — la maille de l'échelle du dépôt (base
4, sans exception). Le jeton est câblé jusqu'au composant : `Card` (`components/ui/card.tsx`)
expose une prop `compact` qui bascule `CardHeader`/`CardContent`/`CardFooter` de `p-carte` vers
`p-carte-compacte` par contexte React — un écran l'active en écrivant `<Card compact>`, rien de plus.
**Aucun écran ne l'utilise encore** : ce lot pose le jeton et le levier, pas son application (hors
périmètre de ce lot : `apps/web/src/ecrans/`). Candidats évidents pour le prochain lot : les cartes
chiffrées du tableau de bord (une carte, un chiffre, un libellé).

Rien d'autre ne bouge : `--espace-section` et `--espace-ecran` ont été resserrés récemment avec un
raisonnement écrit dans `index.css` — ne pas y retoucher sans mesure nouvelle qui le justifie.

Bordure structurelle uniquement
----------------------------------

> Une bordure est structurelle ou n'existe pas. Elle sépare une zone dont le comportement diffère
> (contour d'un contrôle de saisie, filet entre deux lignes d'un tableau, filet du cadre applicatif).
> Elle ne délimite jamais un simple groupe de contenu : ce travail-là revient à l'espacement, à
> l'alignement et à la typographie.

Cette règle vient de Material Design 3 : outline (bordure) et elevation (ombre/surface) sont deux
manières **alternatives** de séparer un bloc du fond, jamais cumulées — « card outlined » (niveau 0)
et « card elevated » (niveau 1) sont deux variantes distinctes, pas deux options qu'on additionne.

### Application à `Card`

`components/ui/card.tsx` cumulait jusqu'ici `border` **et** `shadow-sm` sur ses 85 usages du produit
— deux techniques pour dessiner la même frontière. Ce lot retire les deux : `Card` ne porte plus
qu'une surface (`bg-card`), séparée du fond par le delta de teinte (`--background` vs `--card`), pas
par un trait ni une ombre. `shadow-sm` reste réservé à ce qui flotte réellement au-dessus du flux —
menu déroulant, popover, boîte de dialogue, panneau latéral — c'est-à-dire la famille Radix/shadcn
que ce lot ne touche pas (voir « Composants », plus bas).

**Réserve honnête, à vérifier et non à ignorer.** Ce delta de surface seul est faible pris isolément :
1.14:1 en clair, 1.07:1 en sombre — personne ne « voit » un delta de 1.07:1. Ce n'est PAS le
mécanisme de séparation principal entre deux cartes voisines. Ce qui sépare réellement deux blocs,
c'est :

1. **L'espacement** entre les cartes (`gap-section`, posé par `composants/motifs/GabaritEcran.tsx`,
   hors périmètre de ce lot mais déjà en place sur les écrans existants).
2. **Le poids visuel de `CardTitle`** (16px/600, contre 14px/400 pour le corps) — une carte sans
   titre visible, posée sans espacement généreux autour, perd sa séparation.

Une grille de cartes serrées, sans espacement suffisant et sans titre, perdrait toute séparation
visible avec cette règle. Ce n'est pas une hypothèse : vérifie-le à l'œil sur chaque nouvel écran qui
pose des `Card` en grille dense, et privilégie un fond de page plus franc (voir « Fond de page —
l'arbitrage esthétique du lot » plus haut) plutôt que de réintroduire une bordure.

### Application aux tableaux

Rien ne change : `components/ui/table.tsx` pose déjà un filet horizontal seul (`border-b`) entre les
lignes, jamais un cadre par ligne ni un zebra striping en plus — exactement le pattern recommandé
par IBM Carbon pour les tableaux de données (l'un ou l'autre, jamais les deux). Ne pas introduire de
zebra striping.

### Application aux 152 blocs bordés à la main dans les écrans

Hors périmètre de ce lot (`apps/web/src/ecrans/`), mais la règle à appliquer, domaine par domaine,
est la même : une bordure qui délimite une zone d'action réelle (barre de filtres, encart d'alerte,
zone de dépôt de fichier, carte cliquable d'un repli mobile de tableau) la garde ; une bordure qui ne
fait que délimiter un groupe de contenu devient un titre + de l'espace.

Mode sombre
------------

### Mécanisme

`next-themes` (`^0.4.6`), avec persistance `localStorage` et suivi de la préférence système.

- **Fournisseur** : `<ThemeProvider attribute="class" defaultTheme="system" enableSystem
storageKey="dfa-theme" disableTransitionOnChange>` dans `apps/web/src/App.tsx`, autour de
  `QueryClientProvider`.
- **Variant Tailwind** : `@custom-variant dark (&:where(.dark, .dark *));` dans `index.css`, qui
  bascule le variant `dark:` de Tailwind (par défaut piloté par `prefers-color-scheme`) sur une
  classe — nécessaire pour qu'un choix manuel de thème l'emporte sur la préférence système.
- **Script anti-flash** : écrit à la main dans `apps/web/index.html` (~20 lignes, dans `<head>`,
  synchrone). Nécessaire parce que ce produit est une SPA React + Vite sans rendu serveur : sans ce
  script, `<html>` resterait sans classe `dark`/`light` jusqu'à ce que React monte, assez tard pour
  qu'un utilisateur en thème sombre voie un flash de fond clair avant que le bon thème ne
  s'applique. La clé `localStorage` qu'il lit (`dfa-theme`) **doit** rester synchronisée avec le
  `storageKey` du `<ThemeProvider>` — un renommage de l'un sans l'autre réintroduit le flash.
- **Bascule utilisateur** : `composants/layout/BasculeTheme.tsx`, un bouton dans le pied de la barre
  latérale, à côté du déclencheur de compte. Deux états exposés (clair/sombre), pas trois : le
  troisième état (« système ») reste le point de départ réel avant tout clic
  (`defaultTheme="system"`), mais n'est pas un choix qu'un garagiste sélectionne explicitement dans
  l'interface — un clic fixe un choix explicite qui n'est plus recalculé si la préférence système
  change ensuite.
- **Barre système (mobile)** : `<meta name="theme-color">` (`index.html`) suit le thème actif —
  posé par le script anti-flash au chargement, tenu à jour ensuite par
  `App.tsx` (`SynchroniseCouleurBarreSysteme`) à chaque bascule manuelle. Sans ça, la barre d'état
  d'un téléphone resterait claire au-dessus d'une page sombre.

**`next-themes` fonctionne hors Next.js — vérifié en exécution, pas seulement lu dans la doc.** Le
README du projet documente CRA (`Can I use this package with Gatsby or CRA? Yes, starting from the
0.3.0 version`) sans nommer Vite explicitement, mais CRA est structurellement identique à Vite pour
ce qui compte ici : une app 100 % client, sans `_document.js`, sans script anti-flash injecté côté
serveur. Prouvé dans ce lot en observant le rendu réel dans les deux thèmes (voir le rapport du lot
pour les captures) : la classe `dark`/`light` est bien posée sur `<html>`, `useTheme()` renvoie le
bon `resolvedTheme`, et le changement de thème système (sans rechargement de page) est reflété tant
qu'aucun choix manuel n'a été fait.

### Ce qui ne suit PAS l'utilisateur — arbitrage de @laupernoe

Le thème choisi vit uniquement dans le `localStorage` du navigateur. **Pas de colonne en base, pas
de point d'API.** Conséquence acceptée : un garagiste qui change de poste (comptoir le matin, bureau
l'après-midi) ne retrouve pas son thème préféré — chaque poste garde son propre réglage, comme un
réglage de navigateur ordinaire. Si ce compromis devait changer un jour, c'est un chantier API +
base, pas un chantier front seul.

Composants — coss (Base UI) contre Radix/shadcn
---------------------------------------------------

Règle du dépôt, sans exception, non modifiée par ce lot : tout composant à superposition ou portail
(Dialog, Popover, Select, Combobox, Menu, Tooltip, Sheet, Drawer, Toast, Command) reste sur
Radix/shadcn (`components/ui/`). `coss` (registre Base UI, `apps/ui/registry/default/ui/`) est
réservé aux composants **feuille** — sans portail, sans piège de focus.

Raison mesurée en exécution : Base UI et Radix gèrent chacun le focus et `aria-hidden` de leurs
propres couches sans se connaître l'un à l'autre. Un Dialog Radix modal ouvert en même temps qu'un
Popover Base UI rend le popup Base UI `aria-hidden`, donc invisible aux lecteurs d'écran. Tant
qu'une migration complète d'une famille de superposition n'est pas décidée et exécutée d'un bloc,
ne mélange jamais les deux dans un même arbre de composants ouverts simultanément.

Focus clavier et accessibilité
---------------------------------

Inchangé par ce lot, rappelé ici parce que c'est une contrainte non négociable sur tout écran :

- Focus visible partout : `.anneau-focus` (anneau extérieur, `outline`) pour tout contrôle du flux
  normal ; `.anneau-focus-interne` (anneau intérieur, `box-shadow: inset`) pour un élément dans un
  conteneur `overflow: hidden` (item de menu, de `Select`…). `--ring` (couleur de marque) porte cet
  anneau dans les deux thèmes, ≥ 8.4:1 sur les trois surfaces en sombre.
- Aucune régression fonctionnelle tolérée : un changement visuel qui casse un parcours clavier ou
  une lecture d'écran n'est pas un changement visuel acceptable.
- Avant de livrer un écran, passer la check-list mesurable de la skill `web-design-guidelines` du
  dépôt (`.assistant/skills/`) — ne jamais affirmer un écran « aux normes » sans l'avoir passée.

Méthode de mesure
-------------------

Tout ratio de contraste cité dans ce document ou dans `index.css` est calculé par
`apps/web/src/test/accessibilite/contraste.ts` (luminance relative WCAG 2.1, formule officielle,
zéro dépendance) à partir des jetons lus dans `index.css` par `jetons-css.ts`. Ces deux modules
existaient avant ce lot pour le thème clair ; `jetons-css.ts` a été corrigé dans ce lot pour devenir
conscient du thème (voir ci-dessous), condition préalable à toute mesure en sombre.

**Piège corrigé, à connaître avant de toucher ces fichiers.** `jetons-css.ts` lisait auparavant tout
le fichier `index.css` sans distinguer quel sélecteur entoure chaque déclaration. Tant qu'un seul
thème existait (tout dans `:root`), ça ne se voyait pas. Une fois qu'un bloc `.dark { --background:
...; }` a été ajouté, un scan à plat aurait mélangé les deux thèmes dans une seule table : la
déclaration la plus basse dans le fichier aurait silencieusement écrasé l'autre, quel que soit le
thème réellement demandé par un test — un test « sombre » qui mesurerait des couleurs claires sans
qu'aucune erreur ne le signale. `jetons-css.ts` repère maintenant chaque bloc `:root`/`.dark`
séparément et reproduit la cascade CSS réelle : un jeton absent de `.dark` retombe sur sa valeur
`:root`, exactement comme dans un navigateur où les deux sélecteurs ciblent le même élément
(`<html>`). `valeurHslJeton(nom, theme)` prend un thème explicite (`'clair'` par défaut, aucune
migration requise pour les appels existants).

`axe-core`/`jest-axe` ne peuvent pas mesurer le contraste réel dans ce dépôt (jsdom ne calcule pas
de styles rendus fiables, Tailwind n'est jamais injecté en test) — c'est pourquoi cette mesure
programmatique sur les valeurs HSL déclarées reste la seule méthode honnête ici, documentée en tête
de `contraste.ts`.

Références externes consultées
----------------------------------

- **Material Design 3 (elevation)** — confirmé par lecture directe
  (`m3.material.io/styles/elevation`) : surface tonale et ombre portée sont deux moyens alternatifs
  de séparer un bloc, pas cumulatifs ; l'outline est réservé à la séparation forte. Justifie la règle
  « bordure structurelle uniquement » et le retrait de `border`+`shadow-sm` sur `Card`.
- **IBM Carbon (data table)** — principe confirmé par lecture directe : un filet horizontal seul,
  jamais un filet **et** un zebra striping ensemble. Les chiffres précis de densité (40 px = taille
  « medium ») proviennent de connaissance générale du système, pas d'une page rechargée avec succès
  cette session-là (SPA React qui ne rend pas son contenu à une lecture statique) — cité comme
  direction plausible, à revérifier si le chiffre exact doit être défendu devant un tiers. Justifie
  de ne pas toucher aux hauteurs de ligne des tableaux.
- **GOV.UK Design System (focus/contraste)** — confirmé par lecture directe
  (`design-system.service.gov.uk/get-started/focus-states`) : un indicateur de focus non textuel à
  fort contraste, conforme WCAG 1.4.11. Le produit suit déjà ce principe (`--ring`, 8.25:1 en clair,
  ≥ 8.4:1 en sombre) — confirmé tenu une fois le thème sombre posé.
- **Polaris (Shopify)** — **non obtenu.** L'URL de composant a redirigé vers une page rendue en
  JavaScript, illisible par une lecture statique, dans les deux tentatives faites pendant ce
  chantier. Le produit suit déjà le principe attendu de Polaris (tons de statut fixes + libellé,
  jamais la couleur seule) mais ce n'est **pas** une confirmation par la source — seulement une
  convergence constatée. Ne pas citer Polaris comme source vérifiée dans une future justification
  écrite tant que cette lecture n'a pas réellement abouti.

Ce qui reste
--------------

Ce lot pose le socle. Les 18 domaines d'écrans (`ventes`, `pieces`, `tableau-bord`, `atelier`…)
appliqueront les règles ci-dessus domaine par domaine, dans des lots séparés — voir le backlog du
dépôt pour l'ordre et la portée retenus. Deux points de vigilance transversaux pour ces lots :

- Chaque nouvel écran qui pose des `Card` en grille dense doit vérifier à l'œil que la séparation
  entre cartes reste perceptible (voir la réserve sur le delta de surface, plus haut).
- Les deux résidus `dark:` de `ecrans/console/` (listés en tête de ce document) deviennent du code
  vivant dès ce lot — à mesurer ou à corriger dans le lot qui touchera ce domaine.
