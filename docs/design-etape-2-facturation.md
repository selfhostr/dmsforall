Design — Étape 2 : les écrans de la facturation
===============================================

> Auteur : expert-ui. Base : `docs/specification-etape-2-facturation.md` (métier, `RF-1` → `RF-120`,
> `CF-16` → `CF-27`). Continuité visuelle avec `docs/design-comptoir.md` (tokens, densité, patrons
> de table/fiche/panneau/dialogue) et `docs/design-etape-1-atelier.md` (bandeau d'OR, système de
> statuts, saisie au clavier). **Ce document ne redéfinit aucune primitive** — il compose celles déjà
> livrées et n'en ajoute que là où la facturation introduit un besoin réellement nouveau (§2, §8).
>
> Portée : les cinq écrans demandés — passage OR→facture, facture (édition/émission/verrouillage),
> encaissement, avoir, liste des factures. Public : expert-react, expert-ui (revue).
>
> **Deux décisions de @laupernoe qui structurent tout ce document, non renégociables ici :**
>
> 1. **Le prix annoncé est toujours TTC**, y compris en B2B. Le HT n'apparaît que dans le
>    récapitulatif TVA en pied de document ou sur un écran interne — jamais au-dessus d'un montant.
> 2. **Un client peut repartir sans avoir payé.** Aucun écran ne doit présenter le paiement comme un
>    passage obligé ni faire ressembler une facture non soldée à une anomalie. C'est ce qui règle
>    l'hypothèse `#1` de la spec (`RF-83`) — le design ci-dessous la tient pour acquise, sans `⚠️`.

---

Sommaire
--------

0. [Principe directeur et continuité visuelle](#0-principe-directeur-et-continuité-visuelle)
1. [Vocabulaire à l'écran](#1-vocabulaire-à-lécran)
2. [Nouveaux tokens — statuts des documents de vente](#2-nouveaux-tokens--statuts-des-documents-de-vente)
3. [Écran 1 — Passer un OR en facture](#3-écran-1--passer-un-or-en-facture)
4. [Écran 2 — Facture : édition, émission, verrouillage](#4-écran-2--facture--édition-émission-verrouillage)
5. [Écran 3 — Encaissement](#5-écran-3--encaissement)
6. [Écran 4 — Avoir](#6-écran-4--avoir)
7. [Écran 5 — Liste des factures](#7-écran-5--liste-des-factures)
8. [Composants nouveaux à ajouter au design system](#8-composants-nouveaux-à-ajouter-au-design-system)
9. [Risques identifiés dans le parcours](#9-risques-identifiés-dans-le-parcours)
10. [Traçabilité](#10-traçabilité)
11. [Checklist de conformité](#11-checklist-de-conformité)

---

0. Principe directeur et continuité visuelle

---

L'étape 1 a établi la règle : **un seul budget couleur par écran**, réservé au statut de workflow ;
tout le reste (payeur, type, moyen de paiement) se distingue par forme et par mot. La facturation
ajoute une deuxième famille de statut — celui du **document de vente** (brouillon/émis/annulé) et
celui du **règlement** (non réglé/partiel/réglé) — sans casser la règle : ce sont deux nouvelles
familles de badges, chacune avec son propre jeu d'icônes, au même titre que `BadgeStatutOr` et
`BadgeStatutLigne` (§2).

Grille de points d'arrêt, densité, typographie, tokens de statut existants : **identiques** à
`design-comptoir.md` §1-§2. Les écrans de facturation sont **desktop-first** (densité `dense` par
défaut), au même titre que les écrans du comptoir — c'est un usage de bureau/comptoir, pas d'atelier.
Aucune variante mobile n'est conçue ici : sous `md:`, ces écrans passent en lecture (consultation
d'une facture, pas de saisie), même logique que l'écran d'OR en dessous de `768px`
(`design-etape-1-atelier.md` §2.3).

Primitives réutilisées telles quelles, sans réinterprétation : `Table` (densité `dense`), `Card`,
`Sheet`, `Dialog`, `Badge`, `Select`, `Tabs`, `DropdownMenu`, `Tooltip`, le patron `RefusBloquant` /
`AvertissementConfirmable` (`design-comptoir.md` §8), et le patron de fiche à deux colonnes (§5) pour
tout écran de type « document + contexte ».

**Un montant est toujours écrit `1'234.50`, une date toujours `jj.mm.aaaa`.** Aucune exception, y
compris dans un badge, un aria-label ou un titre de dialogue.

---

1. Vocabulaire à l'écran

---

Repris directement de `RF-1` → `RF-6`, traduit en règles de copywriting pour les écrans qui suivent :

- **Règle** — `RF-2` — « demande d'accord » ≠ « devis »
- **Application à l'écran** — Aucun des cinq écrans de ce document ne mentionne la demande d'accord de l'atelier ; le mot « devis » désigne exclusivement le document commercial. ⚠️ **À VALIDER AVEC @laupernoe** (hérité de `RF-2`) : si le terrain dit autrement, seul le libellé i18n change, pas la structure.

- **Règle** — `RF-3` — vocabulaire figé des types de document
- **Application à l'écran** — Tout badge de type utilise exactement `facturation.document.type.*` (§2.3)

- **Règle** — `RF-5` — « Émettre » est le seul verbe
- **Application à l'écran** — Aucun bouton « Valider », « Confirmer » ou « Enregistrer » sur une action qui verrouille un document. « Enregistrer » reste correct pour un brouillon ou un paiement (qui ne verrouillent rien d'irréversible au même sens)

- **Règle** — `RF-6` — le TTC est le prix annoncé
- **Application à l'écran** — Voir préambule — tenu partout, sans exception

- **Règle** — `RF-4` — « avoir » ≠ « avance client »
- **Application à l'écran** — Le mot « avoir » n'apparaît jamais pour désigner un trop-perçu non imputé (§5, §6)

---

2. Nouveaux tokens — statuts des documents de vente

---

Deux dimensions orthogonales à ajouter, **distinctes** du statut d'OR/de ligne existant (`RM-16` :
le règlement n'est pas un état du document, `RF-68`). Elles suivent la même discipline que
`design-etape-1-atelier.md` §5 : un badge = forme + icône + mot, jamais la couleur seule.

**2.1 État du document — `BadgeEtatDocument`**

- **État** — `brouillon`
- **Mot** — Brouillon
- **Couleur** — `--statut-neutre`
- **Icône** — `PencilLine`
- **Forme** — contour pointillé
- **Réutilise le patron de…** — `proposee` (ligne d'OR) — même idée : rien n'est figé

- **État** — `emis`
- **Mot** — Émise
- **Couleur** — `--statut-terminal`
- **Icône** — `Lock`
- **Forme** — contour
- **Réutilise le patron de…** — `cloture` (OR) — même idée : figé, plus aucune action de modification

- **État** — `annule_par_avoir`
- **Mot** — Annulée par avoir
- **Couleur** — `--statut-neutre`
- **Icône** — `Ban`
- **Forme** — contour
- **Réutilise le patron de…** — jamais affiché seul — **toujours accompagné du lien vers l'avoir** (`RF-32`), voir §4.6

`brouillon` et `emis` ne coexistent jamais sur le même document dans le temps — c'est une
progression, pas un choix (`RF-9`, `RF-22`). `annule_par_avoir` se pose **par-dessus** `emis` (un
document annulé reste émis, il ne redevient pas brouillon) : le badge affiché devient
`annule_par_avoir`, mais la mention « Émise le 12.05.2026 » reste visible en second niveau — le
document n'a pas cessé d'exister (`RF-32`).

**2.2 Statut de règlement — `BadgeStatutReglement`**

Réservé aux documents de nature facture/facture d'acompte. Un devis, un bon de commande ou un avoir
n'a pas de statut de règlement.

- **Statut** — `non_regle`
- **Mot** — Non réglée
- **Couleur** — `--statut-neutre`
- **Icône** — `Circle`
- **Forme** — contour

- **Statut** — `partiel`
- **Mot** — Partiellement réglée
- **Couleur** — `--statut-info`
- **Icône** — `PieChart`
- **Forme** — plein

- **Statut** — `regle`
- **Mot** — Réglée
- **Couleur** — `--statut-succes`
- **Icône** — `CheckCircle2`
- **Forme** — plein

**Décision de design directement liée au principe directeur de @laupernoe** : `non_regle` utilise le token
**neutre**, pas `--statut-attention`. Une facture fraîchement émise et non payée n'est pas une alerte
— c'est l'état normal d'une facture qui vient de sortir. La couleur d'alerte n'entre en jeu que pour
le **retard**, qui est une dimension séparée (§2.4) — jamais fusionnée dans le badge de règlement lui-
même, précisément pour ne pas colorer en orange/rouge une facture du jour qui n'est pas en retard.

**2.3 Type de document — `BadgeTypeDocument`**

Comme payeur/origine/localisation à l'étape 1 (`design-etape-1-atelier.md` §5.4) : **aucune couleur
de statut**, texte + icône sur `--foreground`/`--muted-foreground`.

- **Type** — `devis`
- **Mot (clé `facturation.document.type.*`, `RF-3`)** — Devis
- **Icône** — `FileText`

- **Type** — `bon_commande`
- **Mot (clé `facturation.document.type.*`, `RF-3`)** — Bon de commande
- **Icône** — `FileCheck`

- **Type** — `facture`
- **Mot (clé `facturation.document.type.*`, `RF-3`)** — Facture
- **Icône** — `Receipt`

- **Type** — `facture` + `nature=acompte`
- **Mot (clé `facturation.document.type.*`, `RF-3`)** — Facture d'acompte
- **Icône** — `Receipt` + libellé complet, jamais l'icône seule (distinction texte, pas pictogramme)

- **Type** — `avoir`
- **Mot (clé `facturation.document.type.*`, `RF-3`)** — Avoir
- **Icône** — `ReceiptText` (jamais `Receipt` seul — la confusion visuelle avec une facture serait le pire endroit pour économiser une icône)

- **Type** — `bulletin_paiement`
- **Mot (clé `facturation.document.type.*`, `RF-3`)** — Bulletin de versement
- **Icône** — `QrCode`

**2.4 Retard — indicateur, pas un statut**

Le retard est un **texte + icône accolé** au badge de règlement, jamais une variante de couleur du
badge lui-même :

- **Situation** — Échéance non dépassée
- **Rendu** — Rien — la date d'échéance suffit, visible au clic/survol

- **Situation** — Échéance dépassée, 1ᵉʳ niveau de relance
- **Rendu** — `· en retard de 12 j` en `--statut-attention`, icône `Clock`

- **Situation** — Échéance dépassée, relance avancée (paramétrable)
- **Rendu** — `· en retard de 46 j — 2ᵉ relance` en `--statut-danger`, icône `AlertTriangle`

---

3. Écran 1 — Passer un OR en facture

---

Route : `/or/:id/facturer`, plein écran (le geste est trop dense pour un panneau latéral). Point
d'entrée unique : le bouton d'action primaire du bandeau d'OR quand le statut est `termine`
(`design-etape-1-atelier.md` §3.3 — la table des actions par statut de ce document s'enrichit d'une
ligne `termine → « Facturer… »`).

**3.1 Ce que cet écran fait, et ne fait pas**

**Ne fait pas** : retaper un montant. Toutes les lignes affichées sont **recopiées** depuis l'OR,
figées, non éditables ici (`RF-81`) — cet écran est un **tri et une confirmation**, pas une saisie.

**Fait** : décide **quoi** facturer maintenant et **à qui**, gère les trois avertissements
spécifiques au passage atelier→facture (démontage refusé, taxe d'élimination, consigne), et bloque
tant qu'une ligne est dans un état indécis.

**3.2 Maquette structurelle**

```
┌ En-tête — repris du bandeau d'OR, compact, lecture seule ───────────────────────────────┐
│ OR-2026-1042 · VD 123456 · VW Touran · Meier Hans          [Retour à l'OR]              │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ RefusBloquant — SI lignes en état indécis (RF-86), pleine largeur ──────────────────┐ │
│ │ ⛔ 2 lignes empêchent la facturation                                                 │ │
│ │  • Diagnostic climatisation — statut « à valider »        [Résoudre →]              │ │
│ │  • Remplacement plaquettes — statut « en cours »           [Résoudre →]              │ │
│ └───────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                           │
│ ┌ Avertissement — SI démontage facturable proposé (RF-91), non bloquant ──────────────┐ │
│ │ 💡 Un démontage a été réalisé pour un devis refusé — facturable : CHF 214.04 TTC     │ │
│ │    [+ Ajouter cette ligne à la facture client]                                       │ │
│ └───────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                           │
│ ┌ Groupe payeur « Client — Meier Hans » ───────────────────────────── [✓] Facturer ──┐ │
│ │  Main-d'œuvre service annuel · 1.0 h            CHF 178.20          maintenant       │
│ │  Huile 5W30 · 5.0 L                             CHF  99.90                           │ │
│ │  Filtre à huile                                 CHF  24.80                           │ │
│ │  Retouche peinture — offert (geste commercial)  CHF   0.00                           │ │
│ │                                              Sous-total  CHF 302.90 TTC              │ │
│ └───────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Groupe payeur « Assurance — Zurich Assurances » ─────────────────── [ ] Facturer ──┐ │
│ │  ⚠ Dossier sinistre encore en attente d'accord — décochez pour reporter             │ │
│ │  MO carrosserie · 3.0 h                         CHF 535.50                          │ │
│ │  Pièce pare-choc                                CHF 735.24                          │ │
│ │                                              Sous-total  CHF 1'270.74 TTC            │ │
│ └───────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                           │
│ ┌ Note — lignes refusées (RF-89), affichage informatif seulement ─────────────────────┐ │
│ │ 1 ligne refusée par le client ne sera pas facturée — reportée dans le suivi du      │ │
│ │ véhicule. [Voir les travaux reportés →]                                             │ │
│ └───────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                           │
│ ┌ Note — consigne d'échange standard (RF-100), si applicable ─────────────────────────┐ │
│ │ Une consigne de CHF 162.15 TTC sera facturée maintenant. Au retour de l'ancienne     │ │
│ │ pièce, elle se rembourse par un avoir partiel — pas en attendant le retour.          │ │
│ └───────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                           │
│                                          [Créer 1 facture (client) — CHF 302.90 TTC]     │ ← action primaire
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

**3.3 Règles de comportement**

- **Groupement par payeur** (`RF-87`) : un groupe = un futur document. Le payeur `garage` (`RF-92`)
  n'a pas de groupe séparé — ses lignes apparaissent **dans le groupe du client**, à CHF 0.00, avec
  la mention explicite (« — offert (geste commercial) », « — offert (retouche) »). Elles ne créent
  jamais un document à part destiné à « personne ».
- **Case à cocher « Facturer maintenant » par groupe**, cochée par défaut. La décocher **reporte**
  ce groupe — ses lignes restent en attente, l'OR ne passera pas au statut `facture` tant que tous
  les groupes ne sont pas traités (`RF-84`). C'est le levier qui matérialise `RF-83` : le client
  repart, la part assurance attend l'accord six semaines. Un groupe décoché affiche une raison
  suggérée si détectable (dossier sinistre en attente, ligne `garantie` non encore validée par
  l'importateur) mais le champ reste un texte libre, jamais une liste fermée qui devinerait à tort.
- **Un seul bouton primaire**, dont le libellé et le montant s'ajustent au nombre de groupes cochés :
  « Créer 1 facture (client) — CHF 302.90 TTC » si un seul groupe coché, « Créer 2 factures — CHF
  1'573.64 TTC au total » si plusieurs. Le mot est « Créer », pas « Émettre » : cette étape produit
  des **brouillons** (§4), l'émission reste un geste séparé et délibéré sur l'écran suivant — c'est
  la marche qui donne au réceptionniste l'occasion de vérifier l'adresse ou d'ajouter le démontage
  avant que le document ne se verrouille.
- **RefusBloquant** (`RF-86`) : liste des lignes en état indécis (`validee`, `en_cours`, `proposee`,
  `a_valider`), chaque élément cliquable vers la ligne d'OR concernée (retour à `/or/:id` avec la
  ligne surlignée). Le bouton primaire est **désactivé** tant que cet encart est présent — pas de
  double message (bouton actif qui échoue au clic).
- **Ligne de démontage proposée** (`RF-91`) : jamais ajoutée automatiquement. La case à cocher
  l'ajoute au groupe client concerné et recalcule son sous-total en direct.
- **Taxe d'élimination exclue** (`RF-99`) quand la pièce est à restituer et restituée : la ligne
  n'apparaît **pas du tout** dans le groupe — pas de ligne barrée, pas de mention, elle n'existe
  simplement pas sur cette facture. Un test visuel : compter le nombre de lignes du groupe doit
  correspondre au nombre de lignes réellement facturées, sans reliquat visuel.
- ⚠️ **À VALIDER AVEC @laupernoe** (hérité de `RF-100`) : la note sur la consigne suppose que le garage
  pratique l'échange standard. Si non pratiqué, cette note n'apparaît simplement jamais (donnée
  absente de l'OR) — rien à retirer côté écran.

**3.4 États**

- **Chargement** : squelette des groupes payeur (3 lignes grisées par groupe estimé), bouton
  primaire désactivé avec libellé neutre « Chargement… ».
- **Vide impossible en pratique** (un OR `termine` a toujours au moins une ligne facturable) — si
  zéro ligne facturable après filtrage (cas limite : tout a été refusé ou annulé), état explicite :
  « Aucune ligne facturable sur cet OR » + lien retour, bouton primaire absent (pas désactivé —
  absent, il n'y a rien à créer).
- **Erreur** (échec de la création des brouillons) : la transaction n'a rien consommé côté série
  (aucun numéro alloué à ce stade, §4). Bandeau d'erreur en haut, bouton primaire réactivé,
  `Réessayer` — pas de perte des cases cochées.

---

4. Écran 2 — Facture : édition, émission, verrouillage

---

Route : `/factures/:id`. Un seul écran, deux visages selon `BadgeEtatDocument` — **brouillon**
(éditable, décrit en §4.2-4.4) et **émise** (verrouillée, décrite en §4.5-4.6). C'est la continuité
qui compte : le réceptionniste ne change pas d'écran entre l'édition et la lecture, seuls les
contrôles disparaissent.

**4.1 Charpente commune (fiche à deux colonnes, patron `design-comptoir.md` §5)**

```
┌ En-tête de fiche ─────────────────────────────────────────────────────────────────────┐
│ [Brouillon]  Facture — Meier Hans          issue de OR-2026-1042        [Émettre]      │ ← action
│                                                                                    [⋯]  │   primaire
├ Grille xl:grid-cols-[1fr_360px] ───────────────────────────────────────────────────────┤
│ COLONNE PRINCIPALE                              │ COLONNE SECONDAIRE (360px, sticky)   │
│ Card « Destinataire »                           │ Card « Récapitulatif TVA »           │
│ Card « Lignes » (table dense, lecture)          │ Card « Documents liés » (OR, devis…) │
│ Card « Remise globale » (si applicable)         │ Card « Journal » (replié)            │
│                                                  │                                       │
│                              ┌ Total TTC ─────┐ │                                       │
│                              │  CHF 302.90     │ │                                       │
│                              └─────────────────┘ │                                       │
└──────────────────────────────────────────────────┴───────────────────────────────────────┘
```

Le total TTC est le **plus gros chiffre de l'écran** (`texte-chiffre-geant` ou équivalent
`texte-donnee-proeminente` selon densité), ancré en bas de la colonne principale — c'est la dernière
chose que l'œil rencontre avant le bouton d'action, jamais noyé dans la table de lignes.

**4.2 Card « Destinataire »**

- Nom, adresse complète, éditable **en brouillon uniquement**.
- Si adresse incomplète pour le bloc débiteur QR (un des cinq champs `RF-60` manque) :
  `AvertissementConfirmable` inline, ton neutre-informatif (pas rouge) : « Adresse incomplète — le
  bulletin sera émis sans destinataire pré-rempli. » + lien « Compléter la fiche » (`RF-61`). **Ne
  bloque jamais** l'émission.

**4.3 Card « Lignes » — brouillon**

- Table dense, chaque ligne recopiée depuis l'OR est **en lecture** (`RF-81`) : fond légèrement
  estompé (`bg-muted/30`), curseur par défaut, une petite étiquette `depuis OR-2026-1042` en fin de
  ligne (pas une icône de cadenas ligne par ligne — le cadenas est un concept réservé au document
  entier, §4.5 ; ici c'est une provenance, pas un verrouillage).
- Colonne visible : Désignation · Qté · PU TTC · Montant TTC · taux TVA (badge muted, ex. `8.1%`).
  **Jamais de colonne HT** dans cette table (`RF-6`) — le HT n'existe que dans le récapitulatif TVA.
- Seules deux actions sont possibles sur cette table en brouillon : **ajouter** la ligne de démontage
  proposée si elle ne l'a pas été à l'écran 1 (même case à cocher, reprise ici en cas d'oubli), et
  **retirer** une ligne ajoutée par erreur à l'écran 1 (jamais une ligne recopiée de l'OR — celle-ci
  ne se retire qu'en repassant par l'écran 1, source de vérité du tri).
- Aucune modale pour ces deux actions (cohérence avec `design-etape-1-atelier.md` §4.5) : la case à
  cocher agit en direct.

**4.4 Card « Remise globale » — brouillon uniquement**

- Un champ, montant ou pourcentage (jamais les deux à la fois, `RF-41` — ici c'est le rabais de
  **pied** de document, `RF-42`), avec un libellé obligatoire affiché sur le document (« Remise
  fidélité », etc.).
- Rendu : une seule ligne visible « Remise fidélité 10 % : −CHF 100.00 », jamais le détail de la
  ventilation par taux — la ventilation (`RF-43`) est un calcul serveur invisible à l'écran, seul
  son résultat agrégé apparaît dans le récapitulatif TVA (§4.1, colonne secondaire).
- Si la facture ne porte qu'un seul taux de TVA, le champ se comporte identiquement — pas de
  raccourci visuel qui laisserait croire que la ventilation ne s'applique pas (`RF-43`).

**4.5 Émission — le geste et sa confirmation**

Bouton primaire **« Émettre »** (`RF-5`, jamais « Valider »/« Confirmer »). Au clic, `Dialog` de
confirmation — la seule confirmation modale de tout ce document, réservée précisément parce que
l'action est irréversible et touche de l'argent réel :

```
┌ Dialog — Émettre la facture ? ──────────────────────────────────────────┐
│ Facture pour Meier Hans — CHF 302.90 TTC                                │
│                                                                            │
│ Une fois émise, cette facture ne pourra plus être modifiée — seule       │
│ une correction par avoir sera possible ensuite.                          │
│                                                                            │
│ ⚠ Adresse incomplète — le bulletin sera émis sans destinataire pré-rempli │ ← si applicable, RF-61
│                                                                            │
│                                        [Annuler]        [Émettre]        │
└────────────────────────────────────────────────────────────────────────┘
```

- L'appel serveur porte une `Idempotency-Key` générée à l'ouverture du dialogue (pas au clic sur
  « Émettre ») — un double-clic ou un rejeu après timeout réseau rend le même document (`RF-25`).
- Pendant l'appel : le bouton `Émettre` passe en état de chargement, **le dialogue ne se ferme pas**
  tant que la réponse n'est pas arrivée (pas d'optimisme sur une émission, cohérent avec R4 déjà posé
  à l'étape 1).
- Refus serveur pour bloc créancier incomplet (`RF-54`) : **jamais découvert dans ce dialogue.**
  Cette condition ferme le tenant entier à l'émission — elle se détecte en amont, en `RefusBloquant`
  pleine largeur en haut de l'écran 2 dès l'ouverture du brouillon (« Impossible d'émettre — les
  coordonnées bancaires du garage sont incomplètes. [Compléter dans les paramètres →] »), avec le
  bouton `Émettre` **désactivé** avant même le premier clic. Un utilisateur qui ouvre le dialogue de
  confirmation doit pouvoir faire confiance à ce qu'il y voit.
- Après succès : la modale se ferme, l'écran se recharge en état **émis** (§4.6) avec le vrai numéro,
  sans navigation — même URL, contenu transformé.

⚠️ **À VALIDER AVEC @laupernoe** (hérité de `RF-62`) — si le client règle intégralement et immédiatement au
comptoir, une case à cocher optionnelle dans ce dialogue, **« Client réglé immédiatement »**,
pourrait remplacer l'impression du bulletin QR par une mention « Payé le … , montant reçu … ». Non
implémentée tant que la pratique terrain n'est pas confirmée — l'écran fonctionne à l'identique sans
elle (impression standard avec bulletin, encaissement enregistré séparément à l'écran 3 juste après).

**4.6 État émis — verrouillage et pourquoi**

```
┌ En-tête de fiche ─────────────────────────────────────────────────────────────────────┐
│ [🔒 Émise]  Facture 2026-00318 — Meier Hans     émise le 29.07.2026     [Encaisser]    │
│ [Non réglée]                                                                      [⋯]  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- Toute cellule de la table de lignes, le champ destinataire et le champ remise deviennent
  **visuellement en lecture** : pas de contour au survol, curseur par défaut (même règle que l'OR
  clôturé, `design-etape-1-atelier.md` §4.5).
- **Le clic (ou le focus clavier) sur un champ verrouillé ouvre un `Tooltip`/`Popover` court** :
  « Cette facture est émise et ne peut plus être modifiée. » + lien inline **« Corriger par un avoir
  → »** qui ouvre directement le dialogue de correction (§4.7). C'est la réponse concrète à
  l'exigence du brief : le réceptionniste qui tente « juste corriger une faute de frappe » comprend
  _pourquoi_ en une phrase, et voit _immédiatement_ quoi faire à la place — sans avoir à trouver le
  menu `⋯` par lui-même.
- Bouton primaire devient **« Encaisser »** (§5), en `variant` standard — pas un bouton alarmant. Un
  client qui repart sans payer n'a rien fait d'anormal (principe directeur de @laupernoe) ; le bouton reste
  la voie logique suivante, pas une sommation.
- Menu `⋯` : `Imprimer / télécharger le PDF`, `Envoyer par e-mail`, `Dupliquer (réimpression)`
  (`RF-19` — réimprime l'octet stocké, ne recrée rien), `Corriger cette facture` (§4.7), `Créer un
avoir` (§6), `Voir le journal`.
- Si la facture est `annule_par_avoir` (§2.1) : l'en-tête remplace `[🔒 Émise]` par
  `[Annulée par avoir]`, une bannière non alarmante en haut de la colonne principale indique
  « Cette facture a été annulée et remplacée par la facture 2026-00319 » avec les deux numéros
  cliquables. Le bouton primaire disparaît (rien à encaisser sur un document annulé), le menu `⋯` ne
  garde que `Voir le journal` et `Imprimer` (le document annulé reste consultable, `RF-32`).

**4.7 « Corriger cette facture » — le geste en un clic (`RF-11`, `RF-12`)**

Accessible uniquement sur une facture `emis` non encore `annule_par_avoir`. Portée volontairement
**limitée aux corrections qui invalident le document dans son ensemble** — adresse, destinataire,
taux global erroné, ou une erreur de montant qui touche tout le document. Les corrections
**partielles** (une ligne contestée sur vingt, un geste commercial après coup, une prestation
annulée) passent par l'écran Avoir général (§6), qui ne recrée pas de facture de remplacement — cette
séparation d'écran est un choix d'interface, pas une règle métier supplémentaire : elle évite de
proposer une refonte totale du document pour un correctif qui n'en a pas besoin.

```
┌ Dialog — Corriger la facture 2026-00318 ────────────────────────────────────────────────┐
│ ℹ Une facture émise est figée : impossible de la modifier directement. DFA va créer un   │
│   avoir qui annule cette facture, puis une nouvelle facture avec la correction. Les deux │
│   gardent leur numéro dans la série — rien ne disparaît, rien ne se renumérote.          │
│                                                                                             │
│ Motif de la correction *                                                                  │
│ [Erreur d'adresse ▾]   (erreur_adresse · erreur_destinataire · erreur_montant ·           │
│                          erreur_taux · autre — texte libre si « autre »)                  │
│                                                                                             │
│ ┌ Zone contextuelle selon le motif ───────────────────────────────────────────────────┐  │
│ │ [si erreur_adresse/destinataire] Rue et n° [Rue de Berne 12____] → [Route de Berne 12] │  │
│ │ [si erreur_montant/erreur_taux] → ouvre le panneau des lignes (§4.7.1, Sheet séparée) │  │
│ └───────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                             │
│ ☑ Corriger aussi la fiche client avec cette adresse (coché par défaut, RF-14)             │
│                                                                                             │
│                                              [Annuler]      [Corriger la facture]         │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Motif obligatoire**, liste exacte de `RF-15` restreinte aux cas de correction totale (5 des 7
  valeurs — `prestation_annulee` et `geste_commercial` ne figurent pas dans ce select, voir portée
  ci-dessus). Choisir « autre » impose un texte libre non vide.
- **Branche adresse/destinataire** (le cas `RF-11`/`RF-12` de référence) : champs d'adresse inline
  dans le dialogue, pré-remplis avec la valeur actuelle. Soumission = une seule transaction serveur :
  avoir total + nouvelle facture avec l'adresse corrigée + (si coché) mise à jour de la fiche client
  — exécutée en un clic sur « Corriger la facture », sans navigation intermédiaire.
- **Branche montant/taux** : l'ampleur de la correction (une ligne à modifier, un taux à corriger sur
  plusieurs lignes) dépasse ce qu'un dialogue compact peut contenir lisiblement. Le clic sur ces deux
  motifs remplace le `Dialog` par un `Sheet` (patron §7 de `design-comptoir.md`) intitulé « Corriger
  la facture 2026-00318 » : même bandeau d'explication en tête, puis la table de lignes recopiées,
  chacune éditable en place (même mécanique d'édition que la saisie de lignes d'OR — clic/`Entrée`
  pour éditer, `Entrée` pour valider, `Échap` pour annuler), motif et case « corriger la fiche »
  restant visibles en pied de panneau. Le bouton `Corriger la facture` y déclenche la même transaction
  atomique.
- **Après succès** : redirection vers la nouvelle facture (2026-00319), déjà **émise** — pas un
  nouveau brouillon à émettre séparément (`RF-13` consomme les trois numéros dans le même geste). Un
  bandeau de confirmation temporaire rappelle « Facture 2026-00318 corrigée → nouvelle facture
  2026-00319 » avec lien retour vers l'avoir généré.
- **Plafond de rôle** : si le réceptionniste dépasse son plafond d'avoir (`RF-117`), le bouton devient
  « Soumettre pour validation » et le texte d'explication change en conséquence — l'action crée alors
  une demande, pas le document final. ⚠️ **À VALIDER AVEC @laupernoe** : le parcours exact de cette demande
  (qui est notifié, où elle apparaît) n'est pas dans le périmètre métier tranché par la spec ; l'écran
  ci-dessus se limite à changer le libellé du bouton et à afficher le plafond dépassé, sans inventer
  de file d'attente non spécifiée.

**4.8 États**

- **Chargement** : squelette de la fiche (en-tête + 4 lignes de table + carte TVA grisée), aucune
  action disponible.
- **Vide** : sans objet (une facture existe toujours dès que la route est valide) — un id invalide
  affiche l'état d'erreur ci-dessous, pas un état vide.
- **Erreur** (facture introuvable, ou accès refusé par rôle) : page d'erreur pleine largeur avec
  message explicite et lien de retour à la liste (§7), jamais une fiche à moitié vide qui laisse
  deviner.

---

5. Écran 3 — Encaissement

---

Un `Sheet` (`side="right"`), jamais une page dédiée — l'encaissement est une action qui **complète**
le contexte d'une facture ou d'une fiche client sans en sortir (patron `design-comptoir.md` §7).
Deux points d'entrée, un seul composant :

1. Depuis `/factures/:id` (émise), bouton primaire **« Encaisser »** → panneau pré-rempli avec cette
   facture seule proposée.
2. Depuis `/clients/:id`, action secondaire **« Nouvel encaissement »** → panneau qui liste toutes
   les factures ouvertes du client, sans présélection de document.

**5.1 Maquette**

```
┌ Sheet — Encaisser · Meier Hans ──────────────────────────────────────────────┐
│                                                                                 │
│ Factures ouvertes (triées par ancienneté, RF-69)                              │
│  ☑ 2026-00318 · émise le 29.07.2026 · reste dû CHF 302.90                     │
│  ☐ 2026-00301 · émise le 02.07.2026 · reste dû CHF 118.00                     │
│                                                          Total sélectionné :   │
│                                                          CHF 302.90            │
│                                                                                 │
│ Encaissements                                                                  │
│  ┌ Moyen [Carte ▾]        Montant [CHF 100.00]                    [×] ────┐  │
│  ┌ Moyen [Espèces ▾]      Montant [CHF 202.90]  → arrondi CHF 202.90 ①    │  │
│  [+ Ajouter un moyen de paiement]                                            │
│                                                                                 │
│  Reste à encaisser : CHF 0.00                                                 │
│                                                                                 │
│                                        [Annuler]      [Enregistrer l'encaissement]│
└─────────────────────────────────────────────────────────────────────────────────┘
```

`①` — exemple **sans** écart d'arrondi (202.90 tombe déjà juste). Cas **avec** écart :

```
  ┌ Moyen [Espèces ▾]      Montant [CHF 104.30]  ⓘ arrondi −0.01 (RF-49)   [×] ┐
```

**5.2 Sélection des factures — lettrage (`RF-69`, `RF-70`)**

- Liste triée par ancienneté, une facture cochée **par défaut uniquement si un montant saisi tombe
  exactement juste sur une seule d'entre elles** (`RF-70`) — sinon, aucune présélection : deviner et
  se tromper coûte plus cher que de demander. Sur l'entrée « depuis une facture », celle-ci est
  précochée d'office (c'est le contexte de départ).
- Le panneau ne « lettre » jamais en silence : « Total sélectionné » est toujours visible et se
  recalcule en direct à chaque case cochée/décochée — c'est la confirmation explicite exigée par
  `RF-69`.
- Si le client n'a **aucune** facture ouverte (acompte avant tout document, `RF-76` dispositif 1) :
  la liste affiche l'état vide « Aucune facture ouverte » et une note : « Cet encaissement sera
  enregistré comme avance client. » — pas un blocage, un cas normal du dispositif 1.

**5.3 Moyens multiples et arrondi espèces (`RF-49` → `RF-52`, `RF-73` → `RF-75`)**

- Chaque ligne « Encaissements » est un `paiement` distinct, avec son propre moyen
  (Espèces/Carte/Virement/QR/TWINT/Compensation/Leasing). Bouton `+ Ajouter un moyen de paiement`
  pour le cas CHF 100.— carte + reste en liquide (`CF-22`).
- **Comportement d'arrondi, automatique et visible sans qu'on ait à le savoir** — c'est l'exigence
  centrale de cet écran :
  - Le champ Montant de chaque ligne se pré-remplit avec le **reste exact** à encaisser au moment où
    la ligne est ajoutée.
  - **Si et seulement si** le moyen choisi pour cette ligne est **Espèces** et que son montant, une
    fois entré, amène le total sélectionné à zéro (c'est la **dernière** ligne qui solde, `RF-50`) :
    le champ affiche automatiquement le montant **arrondi au 5 centimes** au lieu du montant exact,
    avec un petit texte inline `ⓘ arrondi −0.01` (ou `+0.02`, etc., `RF-52` — dans les deux sens).
    Le champ reste modifiable si le réceptionniste doit ajuster manuellement, mais **repart du
    montant arrondi**, pas de l'exact — c'est la valeur qui doit finir dans le tiroir.
  - Toute ligne Espèces qui n'est **pas** la dernière à solder (un acompte partiel en liquide avant
    un complément en carte, par exemple) reste au montant **exact**, sans arrondi ni indication —
    seul le tout dernier geste qui ferme le solde touche à l'arrondi (`RF-50`).
  - Le « Reste à encaisser » en pied de panneau reflète toujours le total **avant** arrondi
    jusqu'à ce que la ligne finale soit ajoutée, moment où il tombe à CHF 0.00 en tenant compte de
    l'écart matérialisé séparément (`RF-51` — l'écart part en imputation `arrondi`, jamais absorbé
    dans le montant encaissé affiché).
- **Trop-perçu** (`RF-79`) : si le total des lignes de paiement dépasse le total sélectionné, un
  encart neutre-informatif apparaît sous la liste des paiements : « Cet encaissement dépasse le
  solde de CHF X — l'excédent sera enregistré comme avance client, à affecter plus tard. » Aucune
  case à cocher pour choisir tout de suite entre remboursement/imputation future/abandon — ces trois
  issues restent des actions **séparées et explicites** menées plus tard depuis la fiche client
  (`RF-79`), jamais décidées dans le feu de l'encaissement.

**5.4 Après enregistrement**

- Le panneau se ferme, la facture repasse avec son nouveau `BadgeStatutReglement` (§2.2) mis à jour
  en direct.
- Chaque paiement enregistré est ensuite **immuable** (`RF-66`) : dans l'historique des paiements
  d'une facture (colonne secondaire de l'écran 2, carte « Paiements »), une ligne de paiement montre
  la même mécanique de verrouillage que §4.6 — clic → tooltip « Ce paiement est enregistré et ne peut
  plus être modifié. » + lien **« Enregistrer un paiement correctif → »**, qui rouvre ce même `Sheet`
  pré-rempli avec un montant négatif du même moyen, lié au paiement d'origine. La saisie fausse
  **reste visible**, jamais masquée (`RF-66`).

**5.5 États**

- **Chargement** (liste des factures ouvertes) : squelette de 2-3 lignes grisées, bouton
  `Enregistrer` désactivé.
- **Vide** : voir §5.2 (aucune facture ouverte → avance client, pas un blocage).
- **Erreur** : bandeau d'erreur en haut du panneau, contenu saisi conservé (montants, moyens), la
  demande peut être rejouée sans tout retaper.

---

6. Écran 4 — Avoir

---

Route : `/factures/:id/avoir`, plein écran (même poids qu'une édition de facture — sélection de
lignes, récapitulatif TVA, montants qui s'additionnent en direct méritent l'espace d'une page, pas
un panneau étroit). Accessible depuis le menu `⋯` d'une facture émise (§4.6) : **« Créer un avoir »**,
distinct de « Corriger cette facture » (§4.7) — cet écran couvre les avoirs **partiels** et les
motifs qui ne justifient pas une facture de remplacement (`prestation_annulee`, `geste_commercial`,
et tout avoir total qui n'a pas besoin d'un document suivant).

**6.1 Maquette**

```
┌ En-tête ──────────────────────────────────────────────────────────────────────────────┐
│ Avoir sur facture 2026-00318 — Meier Hans                          [Émettre l'avoir]   │
├ Grille xl:grid-cols-[1fr_360px] ─────────────────────────────────────────────────────┤
│ Motif *                                          │ Récapitulatif TVA                  │
│ [Geste commercial ▾]                             │  8.1 %   base −CHF 45.87  TVA −3.72 │
│                                                   │                     Total −CHF 49.59│
│ Lignes de la facture d'origine                   │                                     │
│  ☐ Main-d'œuvre service annuel        CHF 178.20 │ Total de l'avoir                    │
│  ☑ Retouche peinture — refaite         CHF  49.59│  −CHF 49.59 TTC                     │
│  ☐ Filtre à huile                     CHF  24.80 │                                     │
│  [Tout sélectionner (avoir total)]               │                                     │
│                                                   │                                     │
│ ⚠ Motif obligatoire, requis à l'émission          │                                     │
└───────────────────────────────────────────────────┴─────────────────────────────────────┘
```

**6.2 Règles de comportement**

- **Motif obligatoire** (`RF-15`), les 7 valeurs complètes ici (y compris `prestation_annulee` et
  `geste_commercial`, contrairement au dialogue §4.7). « Autre » impose un texte libre.
- **Sélection de lignes** (`RF-18`) : chaque ligne de la facture d'origine est une case à cocher,
  montant TTC affiché en lecture seule — **jamais un champ de montant libre**. Un avoir « reprend des
  lignes existantes, il n'invente pas un montant » (`RF-18`) : il n'existe donc **aucun champ pour
  saisir un montant arbitraire** sur cet écran, par construction, pas seulement par consigne.
  `Tout sélectionner` coche toutes les lignes — c'est l'équivalent d'un avoir total obtenu depuis cet
  écran généraliste plutôt que depuis le dialogue dédié de §4.7 (utile par exemple pour un motif
  `prestation_annulee` total, qui ne nécessite pas de facture de remplacement).
- **Récapitulatif TVA en négatif**, même structure que l'écran 2 (§4.1), toutes les valeurs
  précédées d'un signe moins explicite — pas seulement une couleur, le signe est le porteur
  d'information (accessibilité).
- **Plafond de rôle** (`RF-117`) : identique à §4.7 — bouton relabellisé en cas de dépassement.
  ⚠️ **À VALIDER AVEC @laupernoe** — même réserve sur le parcours de validation que §4.7.
- **Confirmation d'émission** : même `Dialog` de principe que §4.5 (irréversible, résumé du montant,
  `Idempotency-Key` à l'ouverture), libellé adapté : « Émettre l'avoir ? Il vient en réduction de la
  facture 2026-00318 et ne pourra pas être annulé une fois émis. »
- **Après émission** : l'avoir devient un document `emis` à son tour, avec son propre badge type
  (`BadgeTypeDocument` « Avoir », §2.3). S'il solde exactement la facture d'origine (avoir total), le
  lettrage se propose automatiquement en pré-coché sur cette facture (même logique que `RF-70`) ;
  s'il est partiel, il **réduit le solde dû** de la facture d'origine sans changer son
  `BadgeEtatDocument` (elle reste `emis`, seul son `BadgeStatutReglement` peut évoluer vers
  `partiel`/`regle`).

**6.3 États**

- **Chargement** : squelette de la liste de lignes + carte TVA grisée, bouton primaire désactivé.
- **Vide** : sans objet — une facture émise a toujours au moins une ligne à proposer. Si toutes les
  lignes sont déjà couvertes par un avoir antérieur au taux plein (`MD-23` : Σ avoirs ≤ total de la
  facture par taux), les cases correspondantes apparaissent **désactivées** avec la mention « déjà
  créditée » plutôt que masquées — pour que le réceptionniste comprenne pourquoi il ne peut pas les
  cocher une seconde fois (`CF-25`, second avoir sur la même ligne refusé).
- **Erreur** : bandeau d'erreur, sélection de lignes et motif conservés, `Réessayer` possible sans
  tout ressaisir.

---

7. Écran 5 — Liste des factures

---

Route `/factures`, dans la navigation principale. C'est l'écran que le patron regarde : triage
rapide, pas de saisie. Patron de table dense identique à `design-comptoir.md` §4.

**7.1 Maquette**

```
┌ Facturation ───────────────────────────────────────────────────────────────────────────┐
│ [Toutes] [Non réglées] [En retard] [À relancer]                    🔍 Rechercher…       │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ N°           Client              Émise le    Montant TTC   Statut              Retard   │
│ 2026-00318   Meier Hans          29.07.2026   CHF   302.90  ○ Non réglée                │
│ 2026-00317   Zurich Assurances   28.07.2026   CHF 1'270.74  ◔ Partielle                 │
│ 2026-00301   Dubois SA           02.07.2026   CHF   118.00  ○ Non réglée   ⚠ 27 j       │
│ 2026-00287   Meier Hans          15.06.2026   CHF   566.60  ● Réglée                    │
│                                                              [◂ Précédent] [Suivant ▸]   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Ligne cliquable entière** vers `/factures/:id`, mêmes règles d'accessibilité que
  `design-comptoir.md` §4 (`role="link"`, `tabIndex`, `Enter`/`Space`).
- **Colonnes = ce qui sert à trier** : numéro, client, date d'émission, montant TTC, statut de
  règlement, retard. Tout le reste (lignes, TVA, paiements détaillés) est au clic, dans la fiche —
  pas une deuxième ligne empilée.
- **Filtres en `Tabs`**, pas en `Select` — ce sont les quatre vues que le patron utilise
  quotidiennement, elles méritent d'être toujours visibles plutôt que repliées :
  - `Toutes` — aucun filtre, tri par date d'émission décroissante par défaut.
  - `Non réglées` — `statut_reglement` ∈ {non_regle, partiel}, tri par ancienneté croissante
    (les plus vieilles d'abord — c'est l'ordre utile pour relancer).
  - `En retard` — échéance dépassée, tri par jours de retard décroissant.
  - `À relancer` — niveau de relance atteint sans action récente (dépend du paramétrage relance,
    hors périmètre détaillé de ce document — la spec pose les niveaux, pas leur écran de
    paramétrage).
- **Onglet par défaut à l'ouverture : `Non réglées`.** C'est un choix assumé, et il ne contredit pas
  le principe « ne pas faire ressembler une facture non soldée à une anomalie » : `Non réglées` reste
  un badge neutre, pas une alerte — l'onglet organise le travail du patron, il ne l'alarme pas. Seul
  l'onglet `En retard` porte la charge visuelle d'urgence (icônes `--statut-attention`/`--statut-
danger`, §2.4).
- **Pas de bouton d'action primaire en haut de cet écran.** C'est un écran de triage, pas de saisie :
  l'action de l'utilisateur est d'ouvrir un document (clic de ligne) ou de changer d'onglet. Une
  action rapide **« Encaisser »** apparaît en survol de ligne (icône seule + tooltip, alignée à
  droite avant la flèche de navigation implicite) pour les factures à solde non nul — elle ouvre
  directement le `Sheet` d'encaissement (§5) sans passer par la fiche complète, en accélérateur pour
  le geste le plus fréquent depuis cette liste.
- ⚠️ **À VALIDER AVEC @laupernoe** (hérité de la question ouverte §11.1 de la spec, « facture comptoir sans
  OR ») : si ce cas existe, cet écran gagnera un bouton primaire « Nouvelle facture ». Tant que la
  question n'est pas tranchée, aucun bouton de création n'est conçu ici — toute facture naît d'un OR
  (écran 1) ou d'une correction (écran 2/4). Ne pas ajouter de bouton « + » qui n'aurait nulle part où
  mener.

**7.2 États**

- **Chargement** : squelette de 6 lignes grisées, onglets déjà interactifs (le changement d'onglet ne
  doit pas attendre le premier chargement pour être cliquable).
- **Vide, `Toutes`** — premier usage, aucune facture émise dans le tenant : `EtatVidePremierUsage`,
  message orienté action : « Aucune facture émise pour l'instant. Les factures se créent depuis un
  OR terminé. » + lien vers `/or` (liste des OR, filtrée `termine`).
- **Vide, onglet filtré** (`Non réglées`/`En retard`/`À relancer`) — cas positif, pas un manque :
  `EtatVideRecherche` reformulé en confirmation plutôt qu'en absence : « Aucune facture non réglée —
  tout est à jour. » C'est délibérément une bonne nouvelle affichée comme telle, pas un état vide
  neutre copié-collé depuis une liste de recherche générique.
- **Erreur** : bandeau d'erreur pleine largeur, `Réessayer`, filtres et pagination conservés.

---

8. Composants nouveaux à ajouter au design system

---

Récapitulatif de ce qui n'existait pas avant ce document, à livrer par `expert-react`/`expert-ui`
avant ou pendant l'implémentation des écrans ci-dessus :

- **Composant** — `BadgeEtatDocument`
- **Rôle** — Brouillon / Émise / Annulée par avoir (§2.1)
- **Réutilise** — Mapping type-safe identique à `BadgeStatutOr` (`design-etape-1-atelier.md` §8.4)

- **Composant** — `BadgeStatutReglement`
- **Rôle** — Non réglée / Partielle / Réglée (§2.2)
- **Réutilise** — idem

- **Composant** — `BadgeTypeDocument`
- **Rôle** — Devis / Bon de commande / Facture / Facture d'acompte / Avoir / Bulletin (§2.3)
- **Réutilise** — Patron payeur/origine sans couleur (`design-etape-1-atelier.md` §5.4)

- **Composant** — `IndicateurRetard`
- **Rôle** — `· en retard de {n} j` accolé à `BadgeStatutReglement` (§2.4)
- **Réutilise** — Nouveau, léger

- **Composant** — `RecapitulatifTVA`
- **Rôle** — Table Base HT / TVA / Total TTC par taux + total général, pied de facture/avoir (§4.1, §6.1)
- **Réutilise** — Nouveau — **seul endroit du produit où le HT est affiché en primaire**, à documenter comme tel dans son propre composant pour qu'aucun autre écran ne le réutilise par erreur hors contexte

- **Composant** — `LigneDocumentLue`
- **Rôle** — Ligne de table recopiée, non éditable, étiquette de provenance (§4.3)
- **Réutilise** — Variante de `TableRow` avec `bg-muted/30`

- **Composant** — `ChampVerrouille` (pattern, pas nécessairement un composant unique)
- **Rôle** — Tooltip/Popover « pourquoi c'est verrouillé + quoi faire » sur tout champ figé d'un document émis (§4.6)
- **Réutilise** — `Tooltip`/`Popover` existants

- **Composant** — `LignePaiement`
- **Rôle** — Ligne de moyen de paiement dans le `Sheet` d'encaissement, avec calcul d'arrondi conditionnel (§5.3)
- **Réutilise** — Nouveau

- **Composant** — `EncartAvanceClient`
- **Rôle** — Encart neutre-informatif pour trop-perçu (§5.3)
- **Réutilise** — Variante non alarmante du patron d'encart d'alertes (`design-comptoir.md` §6), sur `--muted`, pas sur un token de statut

---

9. Risques identifiés dans le parcours

---

Signalés comme demandé, distincts des hypothèses `⚠️` déjà posées par la spec (§11.1 de la spec) —
ce sont des risques de **conception d'écran**, pas des questions métier :

1. **La bascule Dialog → Sheet dans « Corriger cette facture » (§4.7) est une règle d'interface fine**
   (motif = adresse → Dialog, motif = montant/taux → Sheet). Si `expert-react` l'implémente comme
   deux composants séparés plutôt qu'un seul flux avec `motif` en entrée, il devient facile de faire
   diverger le texte d'explication ou le comportement de la case « corriger la fiche client » entre
   les deux. Recommandation : un seul composant `DialogueCorrectionFacture` qui choisit son propre
   conteneur (`Dialog` ou `Sheet`) en interne selon le motif sélectionné, jamais deux composants
   distincts appelés par l'écran parent.
2. **L'accélérateur « Encaisser » en survol de ligne (§7.1) introduit une deuxième surface qui peut
   modifier de l'argent depuis un écran de triage.** C'est délibéré (le geste le plus fréquent), mais
   cela veut dire que le `Sheet` d'encaissement doit être testé aussi depuis ce point d'entrée, pas
   seulement depuis la fiche facture — un bug qui ne casserait que l'entrée liste serait facilement
   manqué en test manuel centré sur la fiche.
3. **Le calcul d'arrondi automatique (§5.3) dépend de savoir en temps réel si une ligne Espèces est
   « la dernière qui solde ».** Si l'utilisateur réordonne ses lignes de paiement (supprime la ligne
   carte après avoir saisi l'espèces, par exemple), le champ Espèces déjà rempli ne se recalcule pas
   tout seul rétroactivement dans cette conception — il faut un bouton ou une réaction explicite
   (« recalculer ») plutôt qu'un recalcul silencieux qui changerait un montant déjà tapé sans que
   l'utilisateur l'ait demandé. Ce point n'est pas tranché dans ce document et doit être décidé au
   moment de l'implémentation (probablement : le montant déjà saisi manuellement n'est jamais
   modifié automatiquement une fois édité par l'utilisateur — seul le pré-remplissage initial est
   automatique).
4. **L'écran 1 (§3) permet de décocher un groupe payeur sans obliger de motif.** C'est volontaire
   (la case n'est pas un refus, juste un report), mais si aucune trace n'est gardée de la raison du
   report, un patron qui revient trois semaines plus tard sur un OR à moitié facturé ne saura pas
   pourquoi la part assurance attend. Recommandation à vérifier avec `expert-metier`/backend : le
   champ de raison suggéré à la décoche (§3.3) devrait être **enregistré**, même s'il reste facultatif
   à l'écran.
5. **`RecapitulatifTVA` est le seul endroit du produit qui affiche du HT en position primaire**
   (§8). Le risque n'est pas dans cet écran mais dans les suivants : un futur écran (export, tableau
   de bord) qui réutiliserait ce composant hors de son contexte de pied-de-document réintroduirait du
   HT visible en dehors des deux emplacements autorisés par `RF-6`. À garder en tête pour la revue de
   toute future demande d'affichage financier.

---

10. Traçabilité

---

- **Section de ce document** — §1 Vocabulaire
- **Règles couvertes** — `RF-1` → `RF-6`

- **Section de ce document** — §2 Tokens statuts documents
- **Règles couvertes** — `RF-9`, `RF-22`, `RF-32`, `RF-68`

- **Section de ce document** — §3 Écran 1 — OR → facture
- **Règles couvertes** — `RF-81` → `RF-92`, `RF-99`, `RF-100`

- **Section de ce document** — §4 Écran 2 — Facture
- **Règles couvertes** — `RF-5`, `RF-9`, `RF-10`, `RF-11` → `RF-19`, `RF-22`, `RF-25`, `RF-38`, `RF-41` → `RF-44`, `RF-54`, `RF-60`, `RF-61`, `RF-117`, `RF-120`

- **Section de ce document** — §5 Écran 3 — Encaissement
- **Règles couvertes** — `RF-49` → `RF-52`, `RF-65` → `RF-80`

- **Section de ce document** — §6 Écran 4 — Avoir
- **Règles couvertes** — `RF-15`, `RF-17`, `RF-18`, `RF-117`

- **Section de ce document** — §7 Écran 5 — Liste
- **Règles couvertes** — `RF-68`, orientation générale du chapitre 6-7 de la spec

- **Section de ce document** — §9 Risques
- **Règles couvertes** — aucun `RF` — observations de conception propres à ce document

---

11. Checklist de conformité

---

À vérifier par `expert-react`/`expert-ui` avant de considérer une tâche de l'étape 2 terminée :

- [ ] Aucun montant n'apparaît en HT au-dessus ou à côté d'un montant TTC — le HT n'existe que dans
      `RecapitulatifTVA` (§4.1, §6.1) et nulle part ailleurs.
- [ ] Chaque écran a une action primaire unique et identifiable ; l'écran 5 documente explicitement
      pourquoi il n'en a pas au niveau global (§7.1).
- [ ] Aucune facture non réglée n'est rendue avec un token `--statut-attention`/`--statut-danger` par
      défaut — ces tokens ne s'activent que sur un retard réel (§2.4).
- [ ] Le clic sur un champ verrouillé d'un document émis ouvre systématiquement une explication +
      une action de correction, jamais un no-op silencieux (§4.6).
- [ ] Le dialogue d'émission (facture et avoir) porte une `Idempotency-Key` générée à l'ouverture, pas
      au clic sur le bouton de confirmation (§4.5, §6.2).
- [ ] L'écran de correction (§4.7) ne propose jamais `prestation_annulee`/`geste_commercial` dans son
      select de motif — ces deux valeurs redirigent vers l'écran Avoir général (§6).
- [ ] Aucun champ de montant libre sur l'écran Avoir (§6) — seule la sélection de lignes existantes
      détermine le total.
- [ ] L'arrondi 5 centimes ne s'affiche que sur la ligne de paiement Espèces qui solde le document, et
      dans les deux sens (`−`/`+`, §5.3).
- [ ] Tous les montants au format `1'234.50`, toutes les dates au format `jj.mm.aaaa`, sans exception,
      y compris dans les titres de dialogue et les `aria-label`.
- [ ] Chaque écran gère explicitement chargement / vide / erreur (§3.4, §4.8, §5.5, §6.3, §7.2).
