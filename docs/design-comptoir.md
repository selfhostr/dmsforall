# Design — Écrans du comptoir (lot 1)

Addendum à [`design-etape-1-atelier.md`](design-etape-1-atelier.md), qui couvre l'écran d'OR, le
pointage et la signature (lots 2 et 3) mais pas les écrans du comptoir du lot 1 : liste et fiche
client, fiche véhicule, recherche par plaque/châssis/nom. Ce document comble ce trou.

Portée : tokens et primitives livrés par F1-U0 (`src/index.css`, `src/components/ui/**`), et les
patrons de composition que `expert-react` doit reprendre tels quels pour F1-U1+ sans en
réinventer la structure. Vocabulaire, densité, budget couleur : mêmes règles que le document
atelier, §0 et §5.1 y compris.

---

## 1. Grille de points d'arrêt

Reprise identique à `design-etape-1-atelier.md` §1 — aucune variante locale pour le comptoir :

| Contexte          | Largeur      | Préfixe Tailwind | Densité                   | Cible tactile  | Texte de base |
| ----------------- | ------------ | ---------------- | ------------------------- | -------------- | ------------- |
| Téléphone         | < 768 px     | (mobile-first)   | lecture + actions rapides | 48 px          | 16 px         |
| Tablette portrait | 768–1023 px  | `md:`            | `aeree`                   | 56 px          | 18 px         |
| Tablette paysage  | 1024–1279 px | `lg:`            | `aeree`                   | 48 px          | 16 px         |
| Comptoir / bureau | ≥ 1280 px    | `xl:`            | `dense`                   | 32 px (souris) | 14 px         |

Les écrans comptoir (clients, véhicules, recherche) sont **desktop-first** dans leur densité par
défaut (`dense`) : c'est le contexte principal d'usage (réception, facturation), la tablette est
un repli qui bascule en `aeree` sous `lg:`.

---

## 2. Le contrat de tokens (rappel d'usage)

Les tokens sont posés dans `src/index.css`, jamais recopiés en dur dans un composant.

- **Statuts** (`--statut-neutre|info|attention|succes|danger|terminal`) : exposés en classes
  Tailwind `bg-statut-*`, `text-statut-*`, `border-statut-*`. Réservés au statut d'OR / statut de
  ligne (hors périmètre lot 1, voir F1-U1). Un écran comptoir qui affiche un badge de statut d'OR
  (ex. colonne « dernier OR » d'une fiche client) consomme `BadgeStatutOr`, jamais un token brut.
- **Densité** : poser une classe `.densite-dense` / `.densite-aeree` / `.densite-tres-aeree` sur
  un conteneur ancêtre. Les descendants lisent `var(--densite-hauteur-ligne)`,
  `var(--densite-padding-x)`, `var(--densite-padding-y)`, `var(--densite-cible-tactile)` —
  jamais `h-10`/`px-3` en dur pour une hauteur de ligne de liste. `<Table>` (voir `table.tsx`)
  pose sa propre classe de densité via la prop `densite` (défaut `dense`) ; pour une liste
  non-tabulaire (cartes clients empilées, par ex.), poser `.densite-*` à la main sur le wrapper.
- **Typographie** : classes utilitaires `.texte-corps`, `.texte-libelle`, `.texte-titre-section`,
  `.texte-donnee-proeminente`, `.texte-chiffre-geant` — leur taille dépend de la classe
  `.densite-*` ancêtre (voir §8.3 du document atelier, repris identique). Ne jamais poser
  `text-sm`/`text-base` Tailwind nu sur un libellé de fiche ou une cellule de table dense : ça
  fige la taille indépendamment du contexte bureau/tablette et casse le contrat.

### Contraste mesuré — statuts

Méthode : calcul programmatique du ratio de contraste WCAG 2.1 (formule de luminance relative
officielle), pas d'estimation visuelle. Script Node autonome, HSL → sRGB → luminance relative →
ratio, vérifié sur trois paires pertinentes pour chaque token : texte/icône du token sur
`--background` (blanc, badge « contour »), sur `--muted` (gris clair, fond des zones secondaires),
et texte blanc sur fond plein du token (badge « plein », §5.2 du document atelier). Seuil requis :
≥ 4.5:1 (WCAG AA, texte normal).

| Token                | Sur `--background` | Sur `--muted` | Blanc sur fond plein | Conforme |
| -------------------- | ------------------ | ------------- | -------------------- | -------- |
| `--statut-neutre`    | 5.22:1             | 4.75:1        | 5.22:1               | Oui      |
| `--statut-info`      | 5.98:1             | 5.44:1        | 5.98:1               | Oui      |
| `--statut-attention` | 5.31:1             | 4.84:1        | 5.31:1               | Oui      |
| `--statut-succes`    | 5.68:1             | 5.17:1        | 5.68:1               | Oui      |
| `--statut-danger`    | 6.47:1             | 5.89:1        | 6.47:1               | Oui      |
| `--statut-terminal`  | 9.06:1             | 8.24:1        | 9.06:1               | Oui      |

Deux tokens échouaient à la mesure initiale (valeurs du document atelier §8.1, données comme « à
confirmer ») et ont été assombris avant d'être posés dans `index.css` :

- `--statut-neutre` : L 46 % → **44 %** (était 4.42:1 sur `--muted`, sous le seuil).
- `--statut-attention` : L 34 % → **30 %** (était 3.93:1 sur `--background` et sur `--muted`).

Teinte (H) et saturation (S) inchangées dans les deux cas — seule la luminosité a bougé, pour ne
pas dériver du système de couleurs proposé. Aucune application « dark mode » n'existe dans le
produit (décision explicite, voir commentaire en tête de `index.css`) : « fond sombre » ci-dessus
désigne le badge « plein » (texte clair sur remplissage saturé du token), pas un thème sombre de
l'application.

**Vérification daltonisme** : aucun de ces six tokens n'est la seule information portée par un
badge — chaque badge de statut (F1-U1) associe forme + icône lucide + mot. Cette page de tokens
ne porte donc pas seule la charge de la distinction ; voir `design-etape-1-atelier.md` §5.5 pour
la méthode complète (déjà validée, non refaite ici).

---

## 3. Primitives — composants shadcn standard sur Radix

Toutes les primitives interactives sont maintenant des copies du composant shadcn standard,
posées sur le vrai paquet Radix correspondant (`@radix-ui/react-tabs`, `react-dropdown-menu`,
`react-select`, `react-checkbox`, `react-separator`, `react-tooltip`, `react-popover`) ou sur
`cmdk` pour `command.tsx`. `dialog.tsx` l'était déjà. Il n'y a plus d'implémentation maison dans
`components/ui/**` : gestion du focus au montage/démontage, navigation clavier complète,
`aria-activedescendant`, portails et empilement, restitution du focus à la fermeture — tout vient
de Radix, pas d'ARIA écrit à la main.

Seul l'habillage (tokens, densités, cibles tactiles, échelle typographique) reste spécifique à ce
projet — c'est la partie que chaque fichier `components/ui/*.tsx` continue de porter par-dessus le
composant Radix nu :

| Primitive                                | Paquet Radix                                      | Ce que l'habillage du projet ajoute                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table.tsx`, `badge.tsx`, `textarea.tsx` | aucun (HTML pur même chez shadcn)                 | Inchangé                                                                                                                                                                                                                                                                                                                                                                |
| `separator.tsx`                          | `@radix-ui/react-separator`                       | Classes de trait (`bg-border`) et épaisseur, API `orientation`/`decorative` inchangée                                                                                                                                                                                                                                                                                   |
| `checkbox.tsx`                           | `@radix-ui/react-checkbox`                        | Racine Radix dimensionnée en cible tactile 44×44 (`h-11 w-11`), case visuelle 20px centrée dedans, stylée via `group-data-[state=checked]` sur la racine (plus de `peer` — il n'y a plus d'`<input>` frère)                                                                                                                                                             |
| `select.tsx`                             | `@radix-ui/react-select`                          | API composée standard (`Select/SelectTrigger/SelectValue/SelectContent/SelectItem`), `SelectTrigger` à `h-11`/texte 16px, `SelectItem` à hauteur minimale 44px                                                                                                                                                                                                          |
| `tabs.tsx`                               | `@radix-ui/react-tabs`                            | `TabsList`/`TabsTrigger` à `h-11`, indicateur actif en `border-primary`, aucune logique ARIA/clavier propre — Radix gère `tablist/tab/tabpanel` et les flèches                                                                                                                                                                                                          |
| `tooltip.tsx`                            | `@radix-ui/react-tooltip`                         | `TooltipProvider` réel (délai configurable côté Radix), contenu en portail. À réserver à l'information complémentaire, jamais à une donnée indispensable à la décision — même règle qu'avant, elle ne dépend pas de l'implémentation                                                                                                                                    |
| `popover.tsx`, `dropdown-menu.tsx`       | `@radix-ui/react-popover` / `react-dropdown-menu` | Contenu en portail (`Portal`) : un ancêtre `overflow-hidden`/`overflow-auto` ne rogne plus le contenu ouvert — la limite documentée avant la bascule n'existe plus                                                                                                                                                                                                      |
| `command.tsx`                            | `cmdk`                                            | `Command` posé avec `shouldFilter={false}` par défaut : la recherche par plaque/châssis/nom interroge l'API, jamais un filtre client sur une liste déjà chargée. `CommandInput` prend `value`/`onValueChange` en contrôlé pour brancher une recherche serveur (debounce côté appelant). Un appelant avec une vraie liste statique peut repasser `shouldFilter` à `true` |

Deux écarts d'API assumés par rapport à ce qui existait avant cette bascule, documentés ici pour
que `expert-react` ne les redécouvre pas en écrivant un écran :

- **`checkbox.tsx`** : `checked`/`onCheckedChange` (API Radix), plus `checked`/`onChange` natif.
- **`select.tsx`** : API composée (`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue`),
  plus `<Select><option>…</Select>`. Aucun écran ne consommait encore l'ancienne forme (F1-U1 non
  démarré au moment de la bascule) — pas de migration d'appelant à faire.

Toutes les autres primitives (`tabs`, `tooltip`, `popover`, `dropdown-menu`, `separator`,
`command`) gardent la même surface publique (mêmes noms d'export, mêmes props sur les cas d'usage
déjà documentés §4-§8) : rien à réapprendre pour les écrans à venir.

---

## 4. Patron — table dense

Composants : `Table`, `TableHeader`, `TableRow`, `TableHead`, `TableBody`, `TableCell` (table.tsx).

```tsx
<Table densite="dense" className="min-w-[720px]">
  <TableHeader>
    <TableRow>
      <TableHead>
        <button
          type="button"
          className="flex items-center gap-1 hover:text-foreground"
          onClick={() => trierPar('nom')}
        >
          Nom <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </TableHead>
      <TableHead>N° client</TableHead>
      <TableHead>Téléphone</TableHead>
      <TableHead className="text-right">Dernier OR</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {clients.map((client) => (
      <TableRow
        key={client.id}
        role="link"
        tabIndex={0}
        onClick={() => naviguer(`/clients/${client.id}`)}
        onKeyDown={(e) => (e.key === 'Enter' ? naviguer(`/clients/${client.id}`) : undefined)}
        className="cursor-pointer"
      >
        <TableCell>
          <IdentiteClient client={client} />
        </TableCell>
        <TableCell className="texte-libelle">{client.numero}</TableCell>
        <TableCell>{client.telephone}</TableCell>
        <TableCell className="text-right texte-donnee-proeminente">…</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

Règles :

- **En-tête triable** : le `<TableHead>` contient un `<button>`, jamais le `<th>` entier cliquable
  (cible tactile, focus visible standard d'un bouton). Icône `ArrowUpDown` (lucide) toujours
  visible ; sens actif indiqué par le mot dans un `aria-sort` sur le `<th>` (`ascending` /
  `descending` / `none`), pas seulement par l'icône.
- **Ligne cliquable** : `role="link"` + `tabIndex={0}` + gestion `Enter`/`Space` au clavier — un
  `<tr>` n'est jamais nativement focusable ni activable. Le curseur `cursor-pointer` et
  `hover:bg-muted/50` (déjà sur `TableRow`) donnent l'affordance visuelle. Ne jamais mettre le lien
  UNIQUEMENT sur un élément interne (ex. le nom) : toute la ligne est la cible.
- **Une ligne, ce qui sert à décider** : nom + identifiant + un seul indicateur d'alerte (badge
  bloqué/impayé) + la donnée qui justifie le clic (dernier OR, plaque). Le reste (adresse
  complète, historique) est **au clic**, dans la fiche — jamais une deuxième ligne empilée dans la
  table dense.
- **Pagination par curseur** : pas de numéros de page. Un seul contrôle en pied de table,
  aligné à droite : `[Précédent]  [Suivant →]`, désactivés (`disabled`, jamais masqués) en bout de
  liste. Le curseur est un paramètre d'URL opaque, jamais un numéro de page reconstruit côté client
  (contrat API — voir CONTRIBUTING.md, pagination par curseur non négociable).
- **État vide** : `EtatVideRecherche` si un filtre/une recherche est actif, `EtatVidePremierUsage`
  sinon (composants F1-U2, hors périmètre de ce document — juste le point d'ancrage : ne jamais
  rendre une `<Table>` avec un `<TableBody>` vide sans état explicite au-dessus).

---

## 5. Patron — fiche à deux colonnes

Client, véhicule : même charpente. `xl:` (≥ 1280 px) deux colonnes ; en dessous, empilé dans
l'ordre colonne principale puis colonne secondaire (jamais l'inverse — l'action et l'identité
d'abord, le contexte ensuite).

```
┌ main (px-6) ──────────────────────────────────────────────────────────────┐
│ ┌ BandeauAlerteClient — SI alerte/bloqué, sticky top-0 ─────────────────┐ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌ En-tête de fiche — h-auto, py-4, border-b ─────────────────────────────┐ │
│ │ IdentiteClient (gros)              [Action secondaire] [Action prim.] │ │  1 seul bouton
│ └─────────────────────────────────────────────────────────────────────┘ │  primaire
│ ┌ Grille xl:grid-cols-[1fr_360px] gap-6 mt-4 ──────────────────────────┐ │
│ │ COLONNE PRINCIPALE (flex-1, min-w-0)   │ COLONNE SECONDAIRE (360px,  │ │
│ │                                          │  xl:sticky xl:top-4)       │ │
│ │ Card « Coordonnées »                    │ Card « Véhicules » (liste  │ │
│ │ Card « Véhicules liés » (table dense)   │  compacte, lien fiche)     │ │
│ │ Card « Historique OR » (table dense)    │ Card « Notes internes »   │ │
│ │                                          │ Card « Documents »        │ │
│ └──────────────────────────────────────────┴────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Règles :

- **Une seule action primaire** dans l'en-tête (`<Button>` sans `variant`) ; toute autre action
  (modifier, imprimer, historique) en `variant="outline"` ou `variant="ghost"`, ou repliée dans un
  `DropdownMenu` (icône `⋯`) si plus de deux actions secondaires — jamais une rangée de 5 boutons
  de poids visuel égal.
- **Colonne secondaire** : uniquement du contexte qui aide la décision sans y être indispensable
  (notes, documents, véhicules liés en résumé). Si un panneau y devient l'objet principal de la
  tâche (ex. « créer un OR pour ce véhicule »), c'est une navigation vers un autre écran, pas un
  panneau plus gros dans cette colonne.
- **`Card`** (composant existant `card.tsx`) comme unité de section — `CardHeader` avec
  `CardTitle` en `.texte-titre-section`, jamais un `<h2>` Tailwind nu à côté.
- En dessous de `xl:`, la colonne secondaire passe **après** la colonne principale dans le DOM
  (ne pas dépendre de `order-*` CSS qui casserait l'ordre de lecture au clavier/lecteur d'écran).

---

## 6. Patron — encart d'alertes

Utilisé pour : alerte client (impayé, litige), échéance d'expertise proche, identification
incomplète. Un seul encart par nature d'alerte, jamais une pile de bannières redondantes.

```tsx
<div className="flex items-start gap-3 rounded-md border border-statut-attention/40 bg-statut-attention/12 p-4">
  <TriangleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-attention" />
  <div className="flex-1 texte-corps">
    <p className="font-medium text-foreground">Paie toujours en retard</p>
    <p className="text-muted-foreground">
      Exiger un acompte à la restitution — note saisie le 12.03.2026.
    </p>
  </div>
</div>
```

- Couleur : uniquement `--statut-attention` (avertissement informatif) ou `--statut-danger`
  (bloquant, ex. client bloqué qui empêche une action). Jamais `--statut-info`/`--statut-succes`
  pour un encart d'alerte — ces tokens sont réservés au statut d'OR/ligne (§5.1 du document
  atelier), une alerte comptoir n'est ni l'un ni l'autre.
- Icône + mot systématiques (même règle daltonisme que les badges de statut) : `TriangleAlert`
  pour attention, `Ban` pour bloquant — jamais l'encart seul sur fond teinté sans icône.
- Largeur pleine du conteneur parent, jamais une carte flottante à part : l'alerte fait partie du
  flux de lecture normal de la fiche, pas une notification volante.

---

## 7. Patron — panneau latéral

`Sheet` (existant, `sheet.tsx`) pour toute action qui édite/complète sans quitter le contexte de
la fiche (ex. « modifier les coordonnées », « ajouter une note ») — jamais pour une simple
consultation (ça, c'est la colonne secondaire de la fiche, §5).

```tsx
<Sheet open={ouvert} onOpenChange={definirOuvert}>
  <SheetContent side="right" className="w-full sm:max-w-md">
    <SheetHeader>
      <SheetTitle>Modifier les coordonnées</SheetTitle>
    </SheetHeader>
    <div className="mt-6 flex flex-col gap-4">{/* champs */}</div>
    <div className="mt-6 flex justify-end gap-2 border-t pt-4">
      <SheetClose asChild>
        <Button variant="outline">Annuler</Button>
      </SheetClose>
      <Button type="submit">Enregistrer</Button>
    </div>
  </SheetContent>
</Sheet>
```

- `side="right"` par défaut (lecture gauche→droite, cohérent avec le sens de navigation du
  produit) ; `side="bottom"` réservé aux très petits écrans si un composant l'exige explicitement.
- Le bouton primaire (« Enregistrer ») est **toujours** le dernier élément du pied, aligné à
  droite ; « Annuler » (`variant="outline"`) à sa gauche. Jamais l'inverse — cohérence avec les
  dialogues.
- Champs de formulaire en 16 px minimum (`Input`/`Textarea`/`Select` existants respectent déjà
  cette contrainte) — ne pas les réduire dans un panneau sous prétexte qu'il est étroit.

---

## 8. Patron — avertissement / refus (invariant n°8, hors OR)

Même famille que `RefusBloquant`/`AvertissementConfirmable` (F1-U2, périmètre `composants/motifs/`
d'un autre lot) mais le comptoir en a besoin plus tôt : ex. tentative de suppression d'un véhicule
qui a des OR liés, ou de fusion de deux fiches client.

- **Avertissement confirmable** (l'action reste possible après confirmation) : `Dialog` (pas
  `Sheet` — une confirmation est modale et courte, pas un panneau de travail), titre = la
  question au mode indicatif (« Fusionner ces deux fiches client ? »), corps = la conséquence
  concrète en une phrase, pied = `[Annuler]` (`outline`, à gauche) et l'action qui confirme
  nommée par le verbe exact (« Fusionner », jamais « OK » ni « Confirmer »).
- **Refus bloquant** (l'action est impossible en l'état) : pas de `Dialog` modal qui interromprait
  un flux — un encart inline au même endroit que le patron d'alerte (§6), token
  `--statut-danger`, qui **liste** ce qui bloque (ex. « 3 OR ouverts liés à ce véhicule ») avec
  chaque élément cliquable vers sa source, et **aucun bouton qui prétend résoudre le blocage** —
  seulement, si pertinent, un lien vers l'écran où le résoudre. Un refus sans porte de sortie
  affichée est un défaut de contrat (même règle que `RefusBloquant`, F1-U2), pas une fin d'écran
  acceptable.

---

## 9. Checklist de conformité (F1-U0)

- [x] Contraste mesuré et consigné ≥ 4.5:1 pour les six tokens de statut, sur fond clair et sur
      fond plein (« sombre ») — §2, outil : script Node, formule de luminance relative WCAG 2.1.
- [x] Aucune couleur Tailwind nue (`bg|text|border-{red,amber,green,blue,slate,gray,orange}-N`)
      dans `apps/web/src/composants/**` — dossier inexistant à ce jour (F1-U0 ne crée aucun écran),
      vérification à revalider par la commande du plan (`grep -rE ...`) dès que F1-U1 y écrit.
- [ ] Relecture par la session principale avant que F1-U1 ne démarre.
- [x] Les trois densités sont lisibles à 60 cm sur tablette — vérifié par capture à 1024 px
      (paysage, densité `aeree`, texte 16 px de base + cible 48 px) et à 768 px (portrait, `aeree`,
      texte 18 px + cible 56 px) : marges et tailles conformes au tableau §8.2/§8.3 du document
      atelier, aucune régression visuelle en dessous des seuils WCAG de taille de cible (44 px CSS
      minimum, tenu par toutes les densités y compris `dense` qui vise 32 px pour la souris — le
      bureau `xl:` n'est pas un usage tactile, voir la grille §1).
