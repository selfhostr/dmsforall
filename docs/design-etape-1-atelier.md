Design — Étape 1 : l'écran d'ordre de réparation et le système visuel de l'atelier
==================================================================================

> Auteur : expert-ui. Base : `docs/specification-etape-1-atelier-clients.md` (métier, RM/CT/T/I) et
> `docs/plan-etape-1-frontend.md` (carte des écrans, arbitrages déjà pris — §2 à §11).
> **Ce document ne refait pas la carte des écrans.** Il la complète là où l'implémentation a besoin d'un
> niveau de précision supérieur : la structure exacte de l'écran d'OR, l'anatomie du bandeau, la mécanique
> clavier de la saisie de lignes, les tokens de statut, l'écran de pointage et l'écran de signature.
> Quand une décision est déjà arbitrée dans le plan, ce document y renvoie plutôt que de la répéter.
> Public : expert-react (T-R-06a/b/c, T-R-07, T-R-08), expert-ui (T-UI-01 → T-UI-08).
> Composants cités : ceux déjà nommés dans le plan (§6.3) — ce document ne renomme rien, il précise leur
> contenu et leur comportement.

---

Sommaire
--------

0. [Principe directeur](#0-principe-directeur)
1. [Grille de référence des points d'arrêt](#1-grille-de-référence-des-points-darrêt)
2. [L'écran d'OR — maquette structurelle](#2-lécran-dor--maquette-structurelle)
3. [Le bandeau d'état](#3-le-bandeau-détat)
4. [La saisie de lignes au clavier](#4-la-saisie-de-lignes-au-clavier)
5. [Le système de statuts visuels](#5-le-système-de-statuts-visuels)
6. [Le pointage sur tablette](#6-le-pointage-sur-tablette)
7. [La signature client](#7-la-signature-client)
8. [Tokens de design à ajouter au thème](#8-tokens-de-design-à-ajouter-au-thème)
9. [Traçabilité](#9-traçabilité)
10. [Checklist de conformité](#10-checklist-de-conformité)

---

0. Principe directeur

---

Auto-i et Nextlane répondent à « où en est ce dossier ? » en ouvrant cinq onglets, trois couleurs par
statut selon l'écran, et une table qui affiche quarante colonnes par défaut. Le pari de DFA est inverse :
**un seul écran répond à cinq questions sans clic, une seule table de lignes groupée par ce qui reste à
décider, une seule couleur par nature d'information.** Chaque choix de ce document est justifié par cette
règle : si un élément n'aide pas à décider en un coup d'œil, il va derrière un clic.

Règle transversale nouvelle posée ici, qui structure tout le §5 : **un seul budget couleur par écran, celui
du statut.** Payeur, origine, localisation, urgence et marqueurs se distinguent par forme et par mot, jamais
par une couleur supplémentaire. C'est ce qui évite la table de lignes bariolée typique des DMS existants.

---

1. Grille de référence des points d'arrêt

---

Le plan (§1.3) nomme des contextes d'usage sans les attacher aux préfixes Tailwind. Ce document fixe la
correspondance — elle s'applique à tout l'écran d'OR et doit être reprise telle quelle par expert-react :

- **Contexte nommé (plan §1.3)** — Téléphone
- **Largeur** — < 768 px
- **Préfixe Tailwind** — (aucun, mobile-first)
- **Densité** — lecture + actions rapides seulement
- **Cible tactile** — 48 px
- **Texte de base** — 16 px

- **Contexte nommé (plan §1.3)** — Tablette atelier portrait
- **Largeur** — 768–1023 px
- **Préfixe Tailwind** — `md:`
- **Densité** — aérée
- **Cible tactile** — 56 px
- **Texte de base** — 18 px

- **Contexte nommé (plan §1.3)** — Tablette atelier paysage
- **Largeur** — 1024–1279 px
- **Préfixe Tailwind** — `lg:`
- **Densité** — aérée
- **Cible tactile** — 48 px
- **Texte de base** — 16 px

- **Contexte nommé (plan §1.3)** — Comptoir / bureau
- **Largeur** — ≥ 1280 px
- **Préfixe Tailwind** — `xl:`
- **Densité** — dense
- **Cible tactile** — 32 px (souris)
- **Texte de base** — 14 px

L'écran de pointage (`/atelier`, §6) n'utilise **que** le premier palier utile de cette échelle : il est conçu
`lg:`-first (tablette paysage posée ou murale), avec des cibles de 72 px indépendamment du point d'arrêt —
ce n'est pas une densité qui varie avec la largeur, c'est une densité fixe imposée par l'usage (gants, mains
sales, debout).

---

2. L'écran d'OR — maquette structurelle

---

**2.1 Vue d'ensemble — bureau (`xl:`, ≥ 1280 px)**

```
┌ EnTete (AppShell, existant, défile normalement — non sticky) ──────────────────────────┐
│  dmsforall · Garage Meier SA          [FR ▾]   [Rui Costa ▾]   [Se déconnecter]        │
└──────────────────────────────────────────────────────────────────────────────────────┘
┌ main (px-6, contenu ci-dessous) ────────────────────────────────────────────────────────
│
│ ┌ BandeauAlerteClient — SI note d'alerte (RM-13) ou client bloqué (RM-08) ──────────────┐
│ │ ⚠ « Paie toujours en retard, exiger un acompte à la restitution »                     │  h-8, sticky top-0, z-40
│ └─────────────────────────────────────────────────────────────────────────────────────┘   bg = --statut-attention/12
│
│ ┌ BandeauOr — sticky (top-0 ou top-8 si alerte au-dessus), z-30, h-24, bg-background ──┐
│ │ [● En cours]  OR-2026-1042        VD 123456 · VW Touran 2.0 TDI · 2018   km 187'450  │  ligne 1 · h-10
│ │  Meier Hans                                    [Réceptionner…]  [Passer en contrôle] [⋯]│
│ │ Localisation[Atelier – pont 2▾] Restitution 27.07·16:00(2h) ▓▓▓▓▓▓░░ 620/800 Aujourd'hui 742.35 ● Rui 1h12 ● Sarah 0h20│ ligne 2 · h-10
│ └─────────────────────────────────────────────────────────────────────────────────────┘   py-2 (16px) autour des 2 lignes
│
│ ┌ Grille à deux colonnes, xl:grid-cols-[1fr_380px], gap-6, mt-4 ────────────────────────┐
│ │ COLONNE LIGNES (flex-1, min-w-0)              │ COLONNE PANNEAUX (380px, xl:sticky    │
│ │                                                │  xl:top-24 xl:self-start)             │
│ │ ┌ Groupe « À valider » — jamais replié ──────┐ │ ┌ Demandes du client (verbatim) ────┐ │
│ │ │ ⚠ 2 lignes · 940.00 TTC [Créer un devis…]  │ │ │ « ça claque à froid… »            │ │
│ │ │ ligne · ligne                               │ │ └────────────────────────────────────┘ │
│ │ └──────────────────────────────────────────────┘ │ ┌ Alertes véhicule ──────────────────┐ │
│ │ ┌ Groupe « À faire / en cours » ──────────────┐ │ │ Expertise dans 5 mois · …          │ │
│ │ │ ligne · ligne · ligne                       │ │ └────────────────────────────────────┘ │
│ │ └──────────────────────────────────────────────┘ │ ┌ Devis complémentaires ─────────────┐ │
│ │ ┌ Groupe « Fait » (replié si > 5) ────────────┐ │ │ (§3.6 du plan)                     │ │
│ │ │ ligne · ligne                               │ │ └────────────────────────────────────┘ │
│ │ └──────────────────────────────────────────────┘ │ ┌ Contrôle qualité ──────────────────┐ │
│ │ ┌ Groupe « Refusé / reporté » — jamais replié ┐ │ │ (§3.6 du plan)                     │ │
│ │ │ par défaut                                   │ │ └────────────────────────────────────┘ │
│ │ └──────────────────────────────────────────────┘ │ ┌ Véhicule de remplacement ──────────┐ │
│ │ ┌ Groupe « ▸ Annulé (2) » — replié par défaut ┐ │ └────────────────────────────────────┘ │
│ │ └──────────────────────────────────────────────┘ │ ┌ Signatures & documents ────────────┐ │
│ │                                                │ └────────────────────────────────────┘ │
│ │ ┌ BarreSaisieRapide — sticky bottom-0, z-20 ──┐ │ ┌ ▸ Journal — replié par défaut,     │ │
│ │ │ + Ajouter une ligne…                        │ │ │   chargé seulement à l'ouverture   │ │
│ │ └──────────────────────────────────────────────┘ │ └────────────────────────────────────┘ │
│ └────────────────────────────────────────────────┴──────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────────────────
```

**2.2 Table des zones — ce qui est fixe, ce qui défile, ce qui se replie**

- **Zone** — En-tête applicatif
- **Composant** — `EnTete` (existant)
- **Fixe au défilement** — Non — défile normalement
- **Hauteur** — 64 px (`h-16`)
- **Repliable** — non

- **Zone** — Bandeau alerte client
- **Composant** — `BandeauAlerteClient`
- **Fixe au défilement** — **Oui**, `sticky top-0 z-40`, présent seulement si RM-13/RM-08
- **Hauteur** — 32 px (`h-8`)
- **Repliable** — non — jamais refermable définitivement (§9.4 du plan)

- **Zone** — Bandeau d'identité
- **Composant** — `BandeauOr`
- **Fixe au défilement** — **Oui**, `sticky` — `top-0` sans alerte, `top-8` avec alerte, `z-30`
- **Hauteur** — 96 px (`h-24`) fixe, ne wrap jamais à `xl:`
- **Repliable** — non

- **Zone** — Groupe « À valider »
- **Composant** — dans `TableLignesOr`
- **Fixe au défilement** — Non (défile avec la page)
- **Hauteur** — auto
- **Repliable** — **non** — c'est l'alerte, elle doit toujours se voir en entier

- **Zone** — Groupe « À faire / en cours »
- **Composant** — idem
- **Fixe au défilement** — Non
- **Hauteur** — auto
- **Repliable** — non

- **Zone** — Groupe « Fait »
- **Composant** — idem
- **Fixe au défilement** — Non
- **Hauteur** — auto
- **Repliable** — oui — replié par défaut **si > 5 lignes**, sinon déplié

- **Zone** — Groupe « Refusé / reporté »
- **Composant** — idem
- **Fixe au défilement** — Non
- **Hauteur** — auto
- **Repliable** — oui — **déplié par défaut** (RM-73, trace de protection)

- **Zone** — Groupe « Annulé »
- **Composant** — idem
- **Fixe au défilement** — Non
- **Hauteur** — auto
- **Repliable** — oui — **replié par défaut** (RM-71)

- **Zone** — Barre de saisie rapide
- **Composant** — `BarreSaisieRapide`
- **Fixe au défilement** — **Oui**, `sticky bottom-0 z-20` dans la colonne lignes
- **Hauteur** — 56 px repos, jusqu'à 88 px si popover d'autocomplétion ouvert (§4)
- **Repliable** — non

- **Zone** — Chaque panneau latéral
- **Composant** — `Panneau*`
- **Fixe au défilement** — La **colonne** est `xl:sticky xl:top-24 xl:self-start` ; en dessous de `xl:` elle rejoint le flux normal
- **Hauteur** — auto par panneau
- **Repliable** — oui, individuellement — état par défaut : **déplié si le panneau porte une alerte active** (devis en attente, checklist incomplète, signature manquante), **replié sinon**. Le panneau Journal est toujours replié par défaut (lazy load, §3.6 du plan).

Pourquoi une colonne « sticky + self-start » plutôt qu'un panneau à défilement indépendant (deux zones de
scroll superposées) : c'est le motif le plus simple à implémenter correctement en CSS pur (`position:
sticky`), il ne demande aucun calcul de hauteur en JavaScript, et il se comporte naturellement quelle que
soit la longueur relative des deux colonnes. Ne pas complexifier ce point.

**2.3 Déclinaisons par point d'arrêt**

**`lg:` (1024–1279 px, tablette paysage)** — un seul écran d'usage réel : le chef d'atelier consulte/arbitre
un OR sur tablette posée au comptoir.

- Grille à deux colonnes → **une seule colonne**. Les panneaux latéraux passent **sous** la table des lignes,
  dans un `Accordion` (shadcn), même ordre que la colonne panneaux du bureau.
- `BandeauOr` reste sticky, se recompacte légèrement (`gap-x-3` au lieu de `gap-x-6`), passe en densité
  aérée (texte 16 px, plaque 24 px).
- **L'action primaire quitte le bandeau** : au lieu du bouton en haut à droite de la ligne 1, elle devient un
  bouton flottant en bas à droite (`fixed bottom-4 right-4`, cercle ou pilule 64 px de haut) — zone du pouce
  (§9.8 du plan, règle générale reprise ici explicitement pour l'écran d'OR). Le bandeau garde le menu `⋯`
  pour les actions secondaires.
- La barre de saisie rapide reste sticky en bas, **au-dessus** du bouton d'action flottant (elle a la
  priorité de position ; le bouton flottant se décale à gauche de la barre quand celle-ci est ouverte).

**`md:` (768–1023 px, tablette portrait)** — usage secondaire : lecture rapide, pas de saisie longue.

- Identique à `lg:` en structure, densité tactile 56 px.
- La table de lignes réduit ses colonnes visibles à **Désignation · Temps · Statut · Technicien** (RM-63/65
  restent accessibles au dépliement de la ligne — tap sur la ligne = expansion, pas de navigation).

**Base (< 768 px, téléphone)** — pas un cas d'usage de saisie complète (plan §1.3). L'écran d'OR devient une
**vue de consultation** :

- `BandeauOr` compact en 2 lignes réduites (statut + plaque + client / localisation + restitution).
- Table des lignes en liste verticale (une carte par ligne, pas de tableau).
- Pas d'action primaire de transition. À la place, une barre d'**actions rapides** fixe en bas :
  `Localisation` · `Appeler le client` · `Pointage` (RM-55, renvoi téléphonique, §4). Les transitions d'état
  et la saisie de lignes se font sur un poste plus large — l'écran le dit explicitement si on tente une
  action indisponible : « Cette action se fait depuis un poste du comptoir ou une tablette. »

---

3. Le bandeau d'état

---

**3.1 Les cinq questions → les cinq réponses**

- **#** — 1
- **Question (spéc)** — Où est le véhicule ?
- **Élément du bandeau** — `Localisation` — menu déroulant directement actionnable, ligne 2
- **Si l'information manque** — Jamais vide silencieusement : valeur par défaut `Parc` à l'ouverture de l'OR, affichée en `AvertissementConfirmable` ambre si aucune mise à jour depuis > 4 h alors que l'OR est `en_cours`

- **#** — 2
- **Question (spéc)** — Qui travaille dessus ?
- **Élément du bandeau** — `PastilleTechnicienEnCours` (une par pointage ouvert), ligne 2 droite
- **Si l'information manque** — Si aucun pointage ouvert et statut `en_cours` : zone remplacée par le texte neutre « Personne ne pointe actuellement » (jamais un vide muet)

- **#** — 3
- **Question (spéc)** — Combien ça fait aujourd'hui ?
- **Élément du bandeau** — `Total du jour` TTC, ligne 2
- **Si l'information manque** — Toujours affiché, même à 0.00

- **#** — 4
- **Question (spéc)** — Qu'est-ce qui attend un accord ?
- **Élément du bandeau** — `JaugePlafond` (ligne 2) **et** groupe « À valider » en tête de table (§2.2) — le bandeau donne le montant, la table donne le détail actionnable
- **Si l'information manque** — Si aucune ligne à valider : jauge neutre, pas de couleur d'alerte

- **#** — 5
- **Question (spéc)** — Quand ça part ?
- **Élément du bandeau** — `IndicateurRestitution` — date + heure + délai relatif, ligne 2
- **Si l'information manque** — Si jamais saisie : `AvertissementConfirmable` inline « Restitution non promise » — RM-56 attend une date, ne pas la rendre invisible

**3.2 Anatomie exacte (bureau, `xl:`)**

**Ligne 1 — identité (`h-10`, 40 px)**, de gauche à droite, `items-center gap-x-4` :

1. `BadgeStatutOr` — pastille couleur + icône + mot (§5.2), jamais l'un sans l'autre.
2. `OR-2026-1042` — 16 px, `font-mono`, `text-muted-foreground` (c'est un identifiant, pas la donnée qu'on
   lit en premier).
3. Séparateur vertical léger (`border-l h-6`).
4. `IdentiteVehicule` — plaque en 20 px `font-bold` (le plus gros texte de la ligne, RM-112/§9.1 du plan),
   puis marque/modèle/année en 14 px `text-muted-foreground` sur la même ligne.
5. `IdentiteClient` (nom + badges alerte/bloqué intégrés — badge, pas juste une couleur de texte).
6. `km entrée 187'450` — 13 px muted, affiché seulement à `xl:` (économie d'espace en dessous).
7. Espace flexible (`flex-1`).
8. Bouton d'action primaire (§3.3 table), **un seul**, plein, à droite.
9. Menu `⋯` (actions secondaires : imprimer, forcer une transition avec droit, voir le journal).

**Ligne 2 — opérationnel (`h-10`, 40 px)**, même `items-center gap-x-4`, séparateurs verticaux légers entre
groupes :

1. `Localisation ▾` — badge cliquable, icône selon valeur (§5.4), texte de la valeur courante.
2. `Restitution promise` — icône horloge, `27.07 · 16:00`, puis `(dans 2 h)` en muted ; **jamais le relatif
   seul** (invariant §11.5 du plan). Rouge (`--statut-danger`) + icône `AlertTriangle` si dépassée — pas la
   couleur seule.
3. `JaugePlafond` — barre horizontale 80 px de large, `620.00 / 800.00 TTC` en texte à côté (le texte porte
   l'information, la barre est un renfort visuel, pas l'inverse). Neutre < 80 %, icône `TriangleAlert` ambre
   ≥ 80 %, icône pleine + `--statut-danger` au dépassement.
4. `Aujourd'hui 742.35 TTC` — texte simple ; au survol (bureau) ou au tap (tablette), popover du détail par
   payeur si multi-payeurs (RM-67).
5. Espace flexible.
6. `PastilleTechnicienEnCours` × n — avatar/initiales 24 px + prénom + chrono qui court (`aria-live="off"`,
   mise à jour visuelle seulement, pas de re-render coûteux à la seconde — throttle 15 s suffisant pour
   l'affichage, le vrai temps est calculé serveur).

**3.3 États particuliers du bandeau**

- **État** — Action primaire par statut
- **Comportement** — Table exacte du plan §3.3 — reprise telle quelle, un seul bouton, jamais deux.

- **État** — `cloture` / `annule`
- **Comportement** — Le bandeau devient **`BandeauLectureSeule`** : la zone action primaire est remplacée par un badge textuel (« OR clôturé le 12.05 » / « OR annulé — motif : … »), le menu `⋯` ne garde que `Imprimer`. Localisation et jauge restent affichées mais non cliquables (curseur par défaut, pas de survol interactif).

- **État** — Refus de transition (I-01 → I-15)
- **Comportement** — Le clic sur l'action primaire ne ferme jamais silencieusement sur une erreur : un encart `RefusBloquant` s'ouvre **sous le bandeau, au-dessus de la table**, liste les éléments bloquants cliquables (I-08/I-09/I-10), et la vue défile jusqu'à lui. Le bandeau lui-même ne change pas de forme — il ne devient jamais rouge en entier, ce serait alarmant pour rien.

- **État** — Conflit de version (§5.5 du plan)
- **Comportement** — Encart identique au refus, positionné au même endroit, avec le bouton `Réappliquer ma modification`.

---

4. La saisie de lignes au clavier

---

**4.1 Disposition des champs — `BarreSaisieRapide`**

Bureau (`xl:`), une seule rangée, hauteur repos 56 px :

```
┌──────┬──────────────────────────────────────────┬──────┬────────┬────────┬───────────┬───────────┬────┐
│ [MO] │ Désignation… (autocomplétion)             │ 1    │ 1.20 h │ 95.00  │ Client ▾  │ Rui C. ▾  │ ⏎  │
│ 56px │ flex-1, min 280px                         │ 56px │ 88px   │ 96px   │ 128px     │ 152px     │48px│
└──────┴──────────────────────────────────────────┴──────┴────────┴────────┴───────────┴───────────┴────┘
  Type       Désignation                              Qté   Temps    PU       Payeur      Technicien   Ajouter
```

- `[MO]` = préfixe du **type courant**, affiché en petit badge non focusable au clavier en tabulation
  normale (changé par `Alt+…`, §4.2). Défaut à l'ouverture de la barre : dernier type utilisé dans cet OR,
  sinon `main-d'œuvre barémée`.
- Le champ Désignation est le **seul point d'entrée initial du focus** (`Ctrl+Entrée` y place le curseur
  depuis n'importe où sur l'écran, §3.5 du plan).
- Défauts pré-remplis non bloquants : Qté = 1, Payeur = `client`, Technicien = celui dont le pointage est
  actuellement ouvert sur cet OR s'il n'y en a qu'un, sinon vide (pas de choix arbitraire entre deux
  techniciens).

Sous `xl:` (tablette), la barre passe sur **deux rangées** : rangée 1 = Désignation seule (pleine largeur),
rangée 2 = Qté / Temps / PU / Payeur / Technicien / bouton Ajouter. L'ordre de tabulation logique ne change
pas, seul l'habillage visuel s'enroule.

**4.2 Carte des raccourcis — récapitulatif implémentable**

- **Touche** — `Ctrl+Entrée`
- **Contexte** — n'importe où sur l'écran d'OR
- **Effet** — Focus dans le champ Désignation de la barre de saisie

- **Touche** — `Alt+T`
- **Contexte** — focus dans la barre
- **Effet** — Type = main-d'œuvre barémée

- **Touche** — `Alt+R`
- **Contexte** — focus dans la barre
- **Effet** — Type = main-d'œuvre au temps réel

- **Touche** — `Alt+F`
- **Contexte** — focus dans la barre
- **Effet** — Type = forfait

- **Touche** — `Alt+P`
- **Contexte** — focus dans la barre
- **Effet** — Type = pièce

- **Touche** — `Alt+S`
- **Contexte** — focus dans la barre
- **Effet** — Type = sous-traitance

- **Touche** — `Alt+X`
- **Contexte** — focus dans la barre
- **Effet** — Type = texte (ligne d'information non chiffrée)

- **Touche** — flèches ↑ / ↓
- **Contexte** — popover d'autocomplétion ouvert
- **Effet** — Navigue dans les résultats, sans quitter le champ

- **Touche** — `Tab`
- **Contexte** — dans un champ de la barre
- **Effet** — Avance : Désignation → Qté → Temps → PU → Payeur → Technicien. Le badge de type n'est **pas** dans cet ordre (accessible seulement par `Alt+lettre` ou par `Maj+Tab` depuis Désignation)

- **Touche** — `Entrée`
- **Contexte** — résultat d'autocomplétion sélectionné
- **Effet** — Sélectionne, pré-remplit temps/taux/prix/TVA/catégorie depuis le catalogue, ferme le popover, garde le focus sur Désignation

- **Touche** — `Entrée`
- **Contexte** — dans un champ de la barre, popover fermé
- **Effet** — Crée la ligne, **rouvre une barre vide, focus dans Désignation** — enchaînement en rafale

- **Touche** — `Maj+Entrée`
- **Contexte** — dans un champ de la barre
- **Effet** — Crée la ligne, garde le focus sur la ligne créée (mode complément, pas rafale)

- **Touche** — `Échap` (1er appui)
- **Contexte** — popover d'autocomplétion ouvert
- **Effet** — Ferme le popover, **conserve le texte tapé** dans Désignation

- **Touche** — `Échap` (2e appui, ou 1er si popover déjà fermé)
- **Contexte** — dans la barre
- **Effet** — Abandonne la ligne en cours, vide la barre, **aucun appel serveur**

- **Touche** — `Ctrl+Entrée`
- **Contexte** — sur une ligne existante du tableau (focus dans la table, pas la barre)
- **Effet** — Passe la ligne en `validee` si le plafond le permet (RM-54)

**4.3 Autocomplétion**

- Popover ancré sous le champ Désignation, largeur = largeur du champ, `max-height: 320px`, `overflow-y:
auto`.
- Deux groupes, dans cet ordre : **Prestations du catalogue** (forfaits du garage, §7.9 de la spéc) puis
  **Désignations récentes** (historique de cet OR et des OR récents du même véhicule/client) — le premier
  groupe est prioritaire parce qu'il porte un prix figé fiable, le second aide la frappe sans rien figer.
- Chaque ligne de résultat : désignation, puis à droite un badge temps/prix si c'est un forfait catalogue, et
  l'indice clavier `↵` en fin de ligne (indication visuelle, pas un vrai raccourci supplémentaire).
- Debounce 150 ms, `keepPreviousData` — la liste ne clignote jamais pendant la frappe (même règle que
  l'omnibox, §2.0 du plan).

**4.4 Ne jamais perdre une saisie interrompue**

Deux mécanismes distincts, pour deux causes d'interruption différentes :

**a) Interruption réseau ou serveur lent — file locale visible.** La création de ligne n'est **jamais
optimiste** (R4, §5.4 du plan). Mais la barre reste utilisable pendant qu'un envoi est en cours :

- Chaque `Entrée` pousse la ligne dans une **file d'attente locale** affichée sous forme de petits jetons
  au-dessus de la barre (`⏳ Filtre à huile · en cours d'envoi`).
- Le prochain `Entrée` peut être tapé immédiatement — la barre ne se bloque jamais en attendant une réponse
  serveur.
- Un jeton réussi disparaît (la ligne apparaît alors dans le groupe correspondant du tableau) ; un jeton en
  échec devient rouge avec un bouton `Réessayer` **et reste affiché** jusqu'à résolution explicite — jamais
  supprimé silencieusement (même principe que la corbeille d'anomalies du pointage, §6.4).
- `Idempotency-Key` générée à l'ouverture de chaque jeton (au moment du `Entrée`, pas à la frappe) —
  un double `Entrée` accidentel ou un rejeu après timeout ne crée jamais deux lignes.

**b) Interruption humaine — le client au comptoir, un appel, un changement d'écran.** Le contenu **non
soumis** de la barre (ce qui est tapé mais pas encore validé par `Entrée`) est persisté :

- Sur toute perte de focus de la barre sans soumission (clic ailleurs sur la page, changement d'onglet), le
  contenu **reste affiché tel quel** dans la barre — aucune fermeture, aucun effacement automatique.
- En complément, débounce 500 ms vers `sessionStorage['brouillon:ligne-or:{orId}']`, pour couvrir le cas
  où l'utilisateur quitte complètement l'écran d'OR (autre onglet applicatif, ou rechargement accidentel).
  Au retour sur cet OR, si un brouillon existe : la barre se rouvre pré-remplie avec un léger surlignage
  (pas un bandeau pleine largeur — c'est une seule ligne, pas un formulaire entier, la reprise doit être
  discrète) et un texte inline « Reprise de votre saisie » à côté du champ, effaçable d'un `Échap`.
- Purge du brouillon local à la création réussie de la ligne, ou à l'abandon explicite (`Échap` double).

**4.5 Édition en place et verrouillage**

- Une cellule s'édite au clic ou `Entrée` (focus clavier), se valide par `Entrée`, s'annule par `Échap`.
  Aucune modale pour ajouter ou modifier une ligne — les modales sont réservées aux actions qui exigent un
  motif (annulation de ligne, correction de pointage, report de restitution, forçage), conformément à R2 et
  au plan §3.5.
- Sur un OR `facture` / `restitue` / `cloture` / `annule`, chaque cellule est **visuellement en lecture** —
  curseur par défaut, pas de contour au survol, pas seulement un refus silencieux au serveur (I-15).
- Ce qui reste **caché derrière un clic** dans la table dense de lignes (densité maîtrisée) : code
  opération/défaut constructeur, n° de sinistre/d'accord, motif d'annulation, détail d'un rabais composé,
  historique de correction de la ligne. Le clic ouvre le tiroir de détail de la ligne, pas une nouvelle page.

---

5. Le système de statuts visuels

---

**5.1 Principe : un seul budget couleur par écran**

Cinq couleurs sémantiques suffisent à tout le produit (§8.1). Elles sont réservées **exclusivement** aux deux
dimensions qui représentent un état de workflow : le **statut de l'OR** et le **statut de la ligne**.
Payeur, origine, localisation, urgence et marqueurs n'utilisent **aucune** de ces couleurs : ils se
distinguent par une icône propre à leur famille de valeurs et par le mot qui l'accompagne toujours. C'est ce
qui garde une table de dix colonnes lisible plutôt que bariolée.

Règle d'unicité : une icône doit être unique **à l'intérieur de sa propre famille de valeurs** (les 11
statuts d'OR entre eux, par exemple). La réutilisation d'une même icône entre deux familles différentes
(ex. `Wrench` pour le statut de ligne « en cours » et pour la localisation « atelier ») est acceptable, parce
que la position à l'écran et le mot qui l'accompagne lèvent toute ambiguïté — elles ne sont jamais comparées
l'une à l'autre.

**5.2 Statuts d'OR — `BadgeStatutOr`**

- **Statut** — `planifie`
- **Mot (clé `or:statuts.*`)** — Planifié
- **Couleur** — `--statut-neutre`
- **Icône (lucide-react)** — `Calendar`
- **Forme du badge** — contour

- **Statut** — `ouvert`
- **Mot (clé `or:statuts.*`)** — Ouvert
- **Couleur** — `--statut-info`
- **Icône (lucide-react)** — `Circle`
- **Forme du badge** — plein

- **Statut** — `en_cours`
- **Mot (clé `or:statuts.*`)** — En cours
- **Couleur** — `--statut-info`
- **Icône (lucide-react)** — `Wrench`
- **Forme du badge** — plein

- **Statut** — `attente_accord`
- **Mot (clé `or:statuts.*`)** — Attente d'accord
- **Couleur** — `--statut-attention`
- **Icône (lucide-react)** — `HelpCircle`
- **Forme du badge** — plein

- **Statut** — `attente_pieces`
- **Mot (clé `or:statuts.*`)** — Attente de pièces
- **Couleur** — `--statut-attention`
- **Icône (lucide-react)** — `PackageSearch`
- **Forme du badge** — plein

- **Statut** — `attente_externe`
- **Mot (clé `or:statuts.*`)** — Attente externe
- **Couleur** — `--statut-attention`
- **Icône (lucide-react)** — `Truck`
- **Forme du badge** — plein

- **Statut** — `controle`
- **Mot (clé `or:statuts.*`)** — Contrôle
- **Couleur** — `--statut-attention`
- **Icône (lucide-react)** — `Search`
- **Forme du badge** — plein

- **Statut** — `termine`
- **Mot (clé `or:statuts.*`)** — Terminé
- **Couleur** — `--statut-succes`
- **Icône (lucide-react)** — `CheckCircle2`
- **Forme du badge** — plein

- **Statut** — `facture`
- **Mot (clé `or:statuts.*`)** — Facturé
- **Couleur** — `--statut-succes`
- **Icône (lucide-react)** — `Receipt`
- **Forme du badge** — plein

- **Statut** — `restitue`
- **Mot (clé `or:statuts.*`)** — Restitué
- **Couleur** — `--statut-succes`
- **Icône (lucide-react)** — `KeyRound`
- **Forme du badge** — plein

- **Statut** — `cloture`
- **Mot (clé `or:statuts.*`)** — Clôturé
- **Couleur** — `--statut-terminal`
- **Icône (lucide-react)** — `Lock`
- **Forme du badge** — contour

- **Statut** — `annule`
- **Mot (clé `or:statuts.*`)** — Annulé
- **Couleur** — `--statut-danger`
- **Icône (lucide-react)** — `Ban`
- **Forme du badge** — contour

`Ban` (cercle barré) et jamais `Trash2` (corbeille) — le mot « supprimer » n'existe pas dans l'atelier (R2),
l'iconographie ne doit pas le suggérer non plus.

**5.3 Statuts de ligne — `BadgeStatutLigne`**

- **Statut** — `proposee`
- **Mot** — Proposée
- **Couleur** — `--statut-neutre`
- **Icône** — `PencilLine`
- **Forme** — contour pointillé

- **Statut** — `a_valider`
- **Mot** — À valider
- **Couleur** — `--statut-attention`
- **Icône** — `AlertCircle`
- **Forme** — plein

- **Statut** — `validee`
- **Mot** — Validée
- **Couleur** — `--statut-info`
- **Icône** — `Check`
- **Forme** — contour

- **Statut** — `en_cours`
- **Mot** — En cours
- **Couleur** — `--statut-info`
- **Icône** — `Loader` (statique, pas d'animation dans le badge de table)
- **Forme** — plein

- **Statut** — `realisee`
- **Mot** — Réalisée
- **Couleur** — `--statut-succes`
- **Icône** — `CheckCheck`
- **Forme** — plein

- **Statut** — `facturee`
- **Mot** — Facturée
- **Couleur** — `--statut-succes`
- **Icône** — `Receipt`
- **Forme** — contour

- **Statut** — `refusee`
- **Mot** — Refusée
- **Couleur** — `--statut-danger`
- **Icône** — `X`
- **Forme** — contour (jamais plein — c'est une décision client, pas une erreur système)

- **Statut** — `annulee`
- **Mot** — Annulée
- **Couleur** — `--statut-neutre`
- **Icône** — `Ban`
- **Forme** — contour, texte barré dans la cellule Désignation

**5.4 Payeur, origine, localisation, urgence, marqueurs — forme et mot, jamais couleur**

Aucun de ces éléments ne consomme les tokens `--statut-*`. Ils utilisent la couleur de texte par défaut
(`--foreground` / `--muted-foreground`), jamais autre chose.

- **Famille** — **Payeur** (RM-66)
- **Valeurs** — client, constructeur, assurance, tiers, garage
- **Rendu** — Texte + petite icône, cellule éditable en place
- **Icône proposée** — `User`, `Factory`, `ShieldCheck`, `Building2`, `Store`

- **Famille** — **Origine** (RM-64)
- **Valeurs** — commandée, constatée, campagne, garantie, retouche, interne
- **Rendu** — **Texte seul**, sans icône — RM-64 est trop lourd de conséquences pour être résumé par un pictogramme (repris du plan §3.4)
- **Icône proposée** — —

- **Famille** — **Localisation** (RM-55)
- **Valeurs** — parc, atelier, sous-traitant, essai routier, lavage, prêt au retrait, restitué, sorti provisoirement
- **Rendu** — Texte + icône dans le menu déroulant du bandeau
- **Icône proposée** — `MapPin`, `Wrench`, `Truck`, `Navigation`, `Droplets`, `PackageCheck`, `KeyRound`, `ArrowRightLeft`

- **Famille** — **Urgence** (constat technicien)
- **Valeurs** — urgent, à faire, à surveiller
- **Rendu** — Icône seule dans la table dense (largeur limitée), **forme distincte garantissant la lecture sans couleur** ; mot complet visible au dépliement de la ligne et en `aria-label`
- **Icône proposée** — `TriangleAlert` (urgent), `Circle` plein petit (à faire), `Eye` (à surveiller)

- **Famille** — **Marqueurs** (RM-77, RM-78, RM-90, §6.12)
- **Valeurs** — sécurité, pièce à restituer, fournie par le client, attente de pièce, temps partagé
- **Rendu** — Icône + info-bulle, jamais de couleur de la palette statut — **exception : `sécurité` peut utiliser `--statut-danger`**, c'est la seule marque autorisée à emprunter la couleur de statut, parce que son urgence justifie de rompre la règle une fois, et une seule
- **Icône proposée** — `TriangleAlert` (sécurité, rouge), `PackageCheck` (pièce à restituer), `HandCoins` (fournie par le client), `Clock3` (attente de pièce), `Users` (temps partagé)

**5.5 Vérification daltonisme**

Méthode : puisque **aucune information de ce système n'est portée par la couleur seule** (chaque badge de
statut associe forme + icône + mot ; chaque marqueur/payeur/origine/localisation n'a de toute façon pas de
couleur de statut), le système reste utilisable en simulation deutéranopie/protanopie/tritanopie par
construction — vérifié en désaturant complètement la palette proposée : les 11 statuts d'OR restent
distinguables entre eux à l'icône seule, les 8 statuts de ligne également.

Point de vigilance retenu pour la revue : `--statut-info` (bleu) et `--statut-succes` (vert) doivent rester
séparables en protanopie, où le vert peut virer vers un ton proche du gris-bleu. La combinaison retenue
(icônes `Circle`/`Wrench` vs `CheckCircle2`/`Receipt`/`KeyRound`, formes different pleines/contours) couvre
ce risque. **Contraste texte/fond à vérifier avant merge avec un outil (Stark, axe, ou équivalent)** — les
teintes proposées en §8.1 visent ≥ 4.5:1 sur fond blanc pour le texte/icône de badge, à confirmer précisément
à l'implémentation, pas seulement estimé ici.

---

6. Le pointage sur tablette

---

Le comportement hors-ligne complet (file IndexedDB, FIFO, idempotence, corbeille d'anomalies) est déjà
spécifié en détail au plan §4.3 — non répété ici. Ce qui suit précise l'écran, les tailles et le rendu visuel
concret de la tolérance à la latence et du réseau dégradé.

**6.1 Écran « au repos »**

```
┌ CoqueAtelier — barre supérieure, h-14 (56px) ──────────────────────────────────────────┐
│ [Rui C. ▾ 40px]              12:47              [● à jour ▾]        [Quitter l'atelier]│
└──────────────────────────────────────────────────────────────────────────────────────┘
┌ bandeau réseau — 6px, visible seulement si hors ligne ou anomalie, --statut-attention ─┐
└──────────────────────────────────────────────────────────────────────────────────────┘
┌ Grille de tuiles OR — auto-fill, minmax(280px,1fr), gap 16px, tuiles min 280×120 px ───┐
│ ┌ VD 123456 ────────┐ ┌ FR 4711 ───────────┐ ┌ VD 987654 ─────────┐                    │
│ │ VW Touran          │ │ Audi A3             │ │ Skoda Octavia       │  chaque tuile =    │
│ │ Service annuel      │ │ Diagnostic          │ │ Pneus hiver          │  1 cible tactile   │
│ │ 3 lignes à faire   │ │ 1 ligne à faire    │ │ 1 ligne à faire     │  entière (≥120px h)│
│ └────────────────────┘ └────────────────────┘ └────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
┌ Activités indirectes — 6 tuiles 96×72px min ───────────────────────────────────────────┐
│ [Nettoyage] [Attente pièces] [Attente accord] [Magasin] [Formation] [Pause]              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Tap 1 = ouvrir une tuile OR (liste des lignes pointables). Tap 2 = tap sur une ligne = pointage démarré.
  **Deux taps maximum** (reprend l'exigence du plan §4.2).
- Les tuiles d'activité indirecte démarrent le pointage en **un seul tap** (pas d'OR à choisir).

**6.2 Écran « en cours »**

Plein écran, aucune tuile visible :

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                              VD 123456 · VW Touran                                     │
│                         Changement de plaquettes de frein                             │
│                                                                                          │
│                                   01:12:47                        ← 56–64px, tabular-nums│
│                                                                                          │
│                  ┌──────────────────────────────────────────┐                          │
│                  │              Terminer                     │  ← 88px de haut, pleine  │
│                  └──────────────────────────────────────────┘     largeur - marges       │
│               [ Changer de ligne ]      [ Signaler un constat ]  ← 56px, secondaires     │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Le chronomètre est **calculé et affiché localement** depuis l'horodatage de début — il ne dépend d'aucun
  aller-retour serveur, il continue de tourner hors ligne sans à-coup.
- `Signaler un constat` : champ court + trois gros boutons d'urgence (Urgent / À faire / À surveiller),
  chacun ≥ 72×56 px. Crée une ligne `constatee`/`proposee` (RM-64). Le technicien ne saisit jamais de prix.

**6.3 Tolérance à la latence**

Règle unique : **aucune transition d'écran n'attend le réseau.**

1. Tap sur `Terminer` (ou sur une tuile pour démarrer) → écriture en IndexedDB, puis retour visuel en moins
   de 100 ms : l'écran revient immédiatement à la grille « au repos ». Aucun spinner, aucun état
   intermédiaire « envoi en cours » bloquant l'écran.
2. Le seul reflet de l'état réseau est l'`IndicateurSynchronisation` de la barre supérieure (§6.4) — jamais
   une modale, jamais un blocage de la tuile suivante.
3. Si l'action échoue plus tard côté serveur (4xx métier — RM-92, RM-93, RM-95), l'écran ne revient **pas**
   en arrière : le technicien a déjà avancé sur autre chose. L'anomalie apparaît dans la corbeille, et un
   bandeau discret non bloquant se glisse en haut de la grille « au repos » la prochaine fois que
   l'utilisateur y revient : `⚠ 1 pointage à corriger` (tap → corbeille).

**6.4 Réseau dégradé — ce qu'on affiche**

- **État** — Synchronisé
- **Rendu barre supérieure (pilule, min 44×44 px tap)** — pastille `--statut-succes` + « à jour »
- **Rendu supplémentaire** — bandeau réseau (6 px) absent

- **État** — En attente
- **Rendu barre supérieure (pilule, min 44×44 px tap)** — pastille `--statut-attention` + « {n} pointage(s) en attente d'envoi » (pluriel ICU)
- **Rendu supplémentaire** — bandeau réseau absent tant que < 2 min d'attente

- **État** — Hors ligne
- **Rendu barre supérieure (pilule, min 44×44 px tap)** — pastille `--statut-neutre` + icône off + « hors ligne depuis HH:MM »
- **Rendu supplémentaire** — bandeau réseau 6 px, `--statut-attention`, en haut de tout l'écran — glanceable en périphérie sans lire le texte, pour un usage mains sales/gants

- **État** — Anomalie
- **Rendu barre supérieure (pilule, min 44×44 px tap)** — pastille `--statut-danger` + « {n} pointage(s) à corriger »
- **Rendu supplémentaire** — bandeau réseau 6 px `--statut-danger` + bandeau discret sur la grille « au repos » (§6.3)

Détection réseau : ne jamais se fier à `navigator.onLine` seul (faux positif wifi associé sans route) — état
dérivé du résultat réel des requêtes, confirmé par un battement, `hors ligne` affiché seulement après un
échec confirmé (repris du plan §4.3, précisé ici pour le rendu).

Lecture hors ligne : cache app shell + OR du jour préchargés, bandeau explicite « Données du 27.07 à 08:14 »
sur les tuiles si le cache date de plus de 5 minutes — jamais de données périmées présentées comme fraîches.

---

7. La signature client

---

**7.1 Ce que le client voit — `CoqueClient`, `/or/:id/signature/:type`**

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  dmsforall — Garage Meier SA                    Ce document est en français            │  header statique,
│  Mandat de réparation — OR-2026-1042                                                    │  non interactif, h-16
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   [ contenu du document, lecture seule, défilement vertical autorisé ]                 │  zone scrollable,
│   Travaux demandés : service annuel, contrôle de l'essuie-glace…                       │  texte 18px min
│   Montant plafond autorisé : CHF 800.00                                                │
│   CGV · Essai routier autorisé · Protection des données…                               │
│                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │  pavé 220px de haut,
│   │                         Signez ici                                              │   │  bordure visible
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│              [ Effacer  56px ]                    [ Signer  56px, plein, primaire ]    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Le nom du signataire est saisi par **l'employé avant de tendre la tablette** (dans le panneau Signatures
  de l'écran d'OR), jamais demandé au client sur cet écran — un clavier de saisie de nom sur cet écran serait
  déjà une brèche potentielle vers d'autres champs.
- Bouton `Signer` désactivé tant qu'aucun trait n'a été dessiné sur le pavé (empêche une soumission vide).
- Après signature : écran de confirmation, toujours `CoqueClient`, « Signature enregistrée — merci »,
  retour automatique à l'écran d'OR après 3 secondes (ou immédiatement si l'employé reprend la tablette et
  tape l'écran) — le retour est un geste **de l'employé**, jamais une navigation que le client doit chercher.

**7.2 Ce que le client ne doit jamais pouvoir atteindre**

Liste exhaustive de ce qui est **absent** de cette route, sans exception :

- Barre latérale, en-tête applicatif, sélecteur de langue, menu utilisateur — aucun composant de `AppShell`
  n'est monté sur cette route.
- Aucun lien, aucun `<Link>`/`<a>`, aucun bouton de retour vers un autre écran de l'application. Le seul
  chemin de sortie est le retour automatique après signature.
- Aucune donnée d'un autre dossier, d'un autre client ou d'un autre montant que ceux du document affiché.
- Aucun réglage, aucun accès aux paramètres du tenant.
- Le bouton « retour » physique de la tablette (Android) ou du navigateur ne doit pas exposer d'écran
  authentifié derrière — recommandation transverse à expert-devops : configurer l'appareil en mode kiosque
  (navigateur plein écran sans barre d'adresse, retour matériel désactivé) au niveau du déploiement, hors
  périmètre de ce document.
- **Recommandation transverse à expert-auth** (hors périmètre de ce document, à statuer avec eux) : cette
  route devrait s'appuyer sur un jeton de signature à courte durée de vie et à portée strictement limitée à
  cet OR et à ce type de document, plutôt que sur la session complète de l'employé — pour qu'une
  manipulation directe de l'URL par le client ne puisse techniquement rien atteindre d'autre, même en
  contournant l'absence d'UI.

**7.3 Ce qui n'est jamais optimiste ici**

Reprend R4/§5.4 du plan sans exception : le tracé de signature reste en mémoire tant que le `201` n'est pas
revenu. En cas d'échec réseau : « Signature non enregistrée — ne fermez pas cet écran » + `Réessayer`, le
tracé n'est jamais perdu ni redemandé au client.

---

8. Tokens de design à ajouter au thème

---

Additions à `apps/web/src/index.css`, dans le même format que l'existant (triplet HSL en variable, puis
exposition via `@theme inline` pour obtenir des classes Tailwind `bg-statut-*` / `text-statut-*` /
`border-statut-*`). Aucune couleur de statut n'est utilisée en dur dans un composant — toujours via ces
tokens.

**8.1 Couleurs de statut**

```
:root {
  /* Statuts atelier — RÉSERVÉS au statut d'OR et au statut de ligne (§5.1). Ne jamais les
     réutiliser pour payeur/origine/localisation/urgence : ces familles restent en foreground/muted. */
  --statut-neutre: 240 4% 46%;      /* planifié, proposée, annulée */
  --statut-info: 217 91% 45%;       /* ouvert, en cours, validée */
  --statut-attention: 38 95% 34%;   /* attente_*, contrôle, à valider */
  --statut-succes: 142 72% 27%;     /* terminé, facturé, restitué, réalisée */
  --statut-danger: 0 72% 42%;       /* annulé, refusée, marqueur sécurité */
  --statut-terminal: 240 6% 30%;    /* clôturé */
}

@theme inline {
  --color-statut-neutre: hsl(var(--statut-neutre));
  --color-statut-info: hsl(var(--statut-info));
  --color-statut-attention: hsl(var(--statut-attention));
  --color-statut-succes: hsl(var(--statut-succes));
  --color-statut-danger: hsl(var(--statut-danger));
  --color-statut-terminal: hsl(var(--statut-terminal));
}
```

Usage des fonds teintés (badges) : pas de token de fond séparé — utiliser l'opacité Tailwind directement sur
le token de texte (`bg-statut-attention/12`, `border-statut-attention/40`, `text-statut-attention`). Ceci
garde le nombre de tokens minimal : une seule teinte par statut, déclinée en opacité au besoin, plutôt qu'un
jeu de variables `-tint`/`-border` par statut à maintenir en double.

Valeurs de luminosité (`L`) volontairement assombries par rapport à des couleurs Tailwind « vives »
standard, pour viser un contraste texte ≥ 4.5:1 sur fond blanc à 13–14 px — **à confirmer avec un outil de
contraste avant merge** (§5.5).

**8.2 Densités**

Trois densités nommées, à formaliser en constantes partagées (`lib/densites.ts` côté expert-react, ou
variables CSS `--densite-*` côté expert-ui — au choix de l'implémentation, le contrat est le tableau) :

- **Densité** — `dense`
- **Usage** — Listes bureau (`/or`, `/clients`, table de lignes à `xl:`)
- **Hauteur de ligne (table)** — 40 px
- **Padding cellule** — `px-3 py-2`
- **Cible tactile min** — 32 px

- **Densité** — `aeree`
- **Usage** — Tablette atelier générale, table de lignes à `lg:`/`md:`
- **Hauteur de ligne (table)** — 56 px
- **Padding cellule** — `px-4 py-3`
- **Cible tactile min** — 48–56 px

- **Densité** — `tres-aeree`
- **Usage** — Écran de pointage (`/atelier`)
- **Hauteur de ligne (table)** — 72 px min, 120 px pour les tuiles OR
- **Padding cellule** — `px-4 py-4`
- **Cible tactile min** — 72 px

**8.3 Échelle typographique — bureau vs atelier**

- **Rôle** — Corps de texte
- **Bureau (`xl:`, densité `dense`)** — 14 px / 20 px
- **Atelier (`lg:`/`md:`, densité `aeree`)** — 16 px / 24 px
- **Pointage (`tres-aeree`)** — 18 px / 28 px

- **Rôle** — Libellé de champ / muted
- **Bureau (`xl:`, densité `dense`)** — 12 px / 16 px
- **Atelier (`lg:`/`md:`, densité `aeree`)** — 14 px / 20 px
- **Pointage (`tres-aeree`)** — 16 px / 24 px

- **Rôle** — Titre de section
- **Bureau (`xl:`, densité `dense`)** — 16 px / 24 px, semibold
- **Atelier (`lg:`/`md:`, densité `aeree`)** — 18 px / 28 px, semibold
- **Pointage (`tres-aeree`)** — 20 px / 28 px, semibold

- **Rôle** — Donnée proéminente (plaque, montant du bandeau)
- **Bureau (`xl:`, densité `dense`)** — 20 px, bold
- **Atelier (`lg:`/`md:`, densité `aeree`)** — 24 px, bold
- **Pointage (`tres-aeree`)** — —

- **Rôle** — Chiffre géant (chronomètre)
- **Bureau (`xl:`, densité `dense`)** — —
- **Atelier (`lg:`/`md:`, densité `aeree`)** — —
- **Pointage (`tres-aeree`)** — 56–64 px, bold, `tabular-nums`

**8.4 Gouvernance des tokens**

- Un statut = un token sémantique (`--statut-*`), jamais une couleur Tailwind brute (`bg-amber-500`) posée
  directement dans un composant métier. Une revue qui trouve une couleur Tailwind nue dans `composants/**`
  hors `components/ui/**` (shadcn brut) doit la faire échouer.
- Toute nouvelle valeur de statut ajoutée côté backend (nouvel état d'OR, de ligne, de pointage) doit
  d'abord obtenir sa ligne dans les tableaux §5.2/§5.3 de ce document avant d'être codée — jamais l'inverse.
- Le mapping enum → token + icône est un objet exhaustif type-safe (même modèle que `lib/roles.ts`, déjà
  posé au plan §6.1) : si le backend ajoute une valeur d'enum, `tsc` doit échouer tant que ce document et le
  mapping ne sont pas mis à jour ensemble.

---

9. Traçabilité

---

- **Section de ce document** — §2 Maquette structurelle
- **Règles/cas couverts** — RM-55, RM-56, RM-53, RM-64/65/66, RM-73, RM-71

- **Section de ce document** — §3 Bandeau d'état
- **Règles/cas couverts** — RM-53, RM-54, RM-55, RM-56, RM-59, I-01→I-15, §3.3/§9.8 du plan

- **Section de ce document** — §4 Saisie de lignes
- **Règles/cas couverts** — RM-54, RM-63→65, §3.5 et §5.6 (idempotence) du plan, §9.2 du plan (interruption comptoir)

- **Section de ce document** — §5 Statuts visuels
- **Règles/cas couverts** — §5.1 (machine à états OR), §5.2 (ligne), RM-64, RM-66, RM-77/78, §6.12 (marqueur sécurité)

- **Section de ce document** — §6 Pointage tablette
- **Règles/cas couverts** — RM-87→99, T-21, §4 du plan (architecture hors ligne), CT-37→CT-44

- **Section de ce document** — §7 Signature client
- **Règles/cas couverts** — RM-108, RM-109, §6.6, §6.12/P-28, §2.9 et §5.4 du plan

- **Section de ce document** — §8 Tokens
- **Règles/cas couverts** — R3 (paramétrable), §1.3 et §9.6 du plan (argent/temps), accessibilité de base non négociable

---

10. Checklist de conformité

---

À vérifier par expert-react et expert-ui avant de considérer une tâche T-UI-0x / T-R-06* terminée, en
complément des critères de done déjà posés au plan §6.4 :

- [ ] Sur `xl:`, le bandeau d'OR répond aux cinq questions (§3.1) sans clic ni défilement.
- [ ] Aucune couleur `--statut-*` n'apparaît en dehors du statut d'OR et du statut de ligne.
- [ ] Chaque badge de statut porte icône **et** mot, jamais la couleur seule — vérifié en désaturant l'écran.
- [ ] La saisie de dix lignes d'affilée se fait sans toucher la souris (`userEvent.keyboard`, test dédié
      T-R-06b déjà exigé au plan).
- [ ] Une ligne tapée puis interrompue (clic ailleurs, changement d'onglet) n'est jamais perdue silencieusement.
- [ ] Aucune modale sur l'ajout/la modification d'une ligne.
- [ ] Le bouton d'action primaire change de position `xl:` → `lg:`/`md:` (bandeau → flottant zone du pouce),
      il reste unique dans les deux cas.
- [ ] `Terminer` un pointage ne bloque jamais l'écran plus de 100 ms sur le réseau.
- [ ] L'indicateur de synchronisation est toujours visible en haut de `CoqueAtelier`, jamais un toast.
- [ ] `CoqueClient` ne monte aucun composant de `AppShell` et ne contient aucun lien sortant.
- [ ] Toutes les cibles tactiles respectent le minimum de leur contexte (§1) — vérifié à la règle, pas à l'œil.
- [ ] Focus clavier visible sur tous les éléments interactifs de l'écran d'OR et de la barre de saisie.
