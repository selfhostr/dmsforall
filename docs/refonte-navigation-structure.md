$=^
Document de conception, 06.08.2026. Angle : **architecture de l'information**. Un second document
traite le même sujet sous l'angle métier ; les deux sont faits pour être confrontés.

---

1. Ce qui a été mesuré (et non supposé)

---

Sources : `apps/web/src/composants/layout/BarreLaterale.tsx`, `routes/routeur.tsx`,
`routes/droits-routes.ts`, `ecrans/pointage/droits.ts`, `packages/shared/src/contrats/enums.ts`.

- **54 fichiers `Ecran*.tsx`**, dont 5 écrans système et 2 hors application (connexion, accès
  refusé) → **47 écrans métier**. Répartition : 9 listes, 9 fiches, 5 créations, **24 écrans
  spécialisés** (un écran pour un cas). Plus **21 dialogues** dans `ecrans/`.
- **30 entrées de menu** pour `direction`. Le chiffre varie par rôle : `chef_atelier` 28,
  `comptable` 23, `magasinier` / `vendeur` / `receptionnaire` 21, `technicien` 20, `admin` 17,
  **`poste_atelier` 8**.
- **9 rôles, pas 8.** Le brief cite `receptionniste` — la valeur réelle est `receptionnaire`, et
  `vendeur` manque à la liste. `ROLES_UTILISATEUR` (`enums.ts:26`) : `admin`, `direction`,
  `vendeur`, `receptionnaire`, `chef_atelier`, `technicien`, `magasinier`, `comptable`,
  `poste_atelier`.
- **La barre latérale défile** : `overflow-y-auto` (`BarreLaterale.tsx:212`). Chez `direction` et
  `chef_atelier`, la liste dépasse la hauteur d'écran.
- **La recherche globale ne connaît que 4 natures d'objet** : `vehicule`, `client`,
  `ordre_reparation`, `document_vente` (`CONSTRUCTEURS_CHEMIN`, `EcranRecherche.tsx`). Ni article,
  ni dossier de vente, ni dépôt pneu, ni fournisseur.
- **`components/ui/command.tsx` (cmdk) existe déjà** et n'est utilisé par aucune navigation.
- **L'en-tête (64px) ne contient aucun champ de recherche** — seulement raison sociale, nom du
  site (texte passif, pas un sélecteur), langue, menu utilisateur, déconnexion.
- **`/pointage/borne` n'est lié depuis aucun menu.** Le rôle `poste_atelier` voit 8 entrées dont
  aucune n'est son travail, et son unique écran n'est atteignable qu'en tapant l'URL.

---

2. Diagnostic : pourquoi 30 entrées est un défaut mesurable

---

**2.1 Le coût n'est pas logarithmique, il est linéaire**

La loi de Hick (temps de décision ∝ log₂(n+1)) suppose un ensemble **ordonné et catégorisé** :
l'utilisateur élimine par moitiés. Elle donnerait 30 → 6 ≈ 1,8× plus rapide — un gain modeste.

Ce n'est pas le régime de ce menu. L'ordre actuel n'a aucune logique inférable : « Doublons
clients » entre Clients et Véhicules, « Référentiels » entre Relances et le groupe Pièces,
« Recherche comptoir » avant « Articles ». Sans loi de rangement, on ne peut pas éliminer par
catégorie : l'œil fait une **recherche visuelle sérielle**, dont le temps croît **linéairement**
avec n (≈ 40–100 ms par item, et le double quand la cible est absente, puisqu'il faut épuiser la
liste). Trente items, plusieurs dizaines de fois par jour.

**2.2 Une liste qui défile interdit la mémoire spatiale**

Défaut le plus coûteux, et purement structurel. Un menu de position **stable** est mémorisé en
quelques jours : la main va au 3ᵉ item sans que l'œil lise. Un menu qui défile n'a pas de 3ᵉ item
stable — l'utilisateur **relit** à chaque fois, indéfiniment, et ne progresse jamais vers
l'expertise. Un menu long ne coûte pas cher une fois ; il coûte cher **tous les jours, cinq ans**.

**2.3 L'échec de première tentative est le vrai coût**

Cible non trouvée au scan ⇒ l'utilisateur ouvre un écran plausible : chargement, lecture, constat
d'erreur, retour, re-scan. Ce cycle vaut 10 à 20 secondes et sédimente une conviction — « ce
logiciel est compliqué » — qui ne se corrige pas par une mise à jour. C'est exactement le reproche
adressé à Auto-i et Nextlane.

**2.4 Les six défauts de structure, nommés**

**D1 — Niveaux incohérents : une entité et son sous-cas au même rang.** Mesuré, pas supposé :

**Clients**

- Rang 1 (alors que c'est un sous-cas) : Doublons clients
- Preuve : outil contextuel de la gestion clients
  **Pneus > Hangar**
- Rang 1 (alors que c'est un sous-cas) : Pneus > À relancer
- Preuve : `EcranHangarPneus` expose littéralement `SelectItem value="a_relancer"`, même endpoint, mêmes actions
  **Pièces > Articles**
- Rang 1 (alors que c'est un sous-cas) : Pièces > Réapprovisionnement
- Preuve : même domaine, projection dérivée du stock
  **Ventes > Dossiers**
- Rang 1 (alors que c'est un sous-cas) : Ventes > Suivi
- Preuve : vue dérivée, même droit `ventes.dossier.lire`
  **Pointage > Journal**
- Rang 1 (alors que c'est un sous-cas) : Pointage > Équipe
- Preuve : **même hook `useListePointages`, même site, même fenêtre du jour** — seule l'agrégation diffère

**D2 — Regroupement par module technique, pas par intention.** Les cinq groupes du menu
(`pieces`, `pointage`, `pneus`, `ventes`, `parametrage`) sont, à l'identique, les répertoires de
`apps/api/src/`. La barre latérale est un plan du code, pas un plan du travail. Symptôme direct :
« Recherche comptoir » (un poste de travail occupé huit heures par jour) et « Paramétrage pièces »
(réglé une fois par an) sont voisins dans le même tiroir.

**D3 — Configuration mêlée au travail quotidien.** La configuration est éclatée sur **trois
emplacements et trois niveaux** : « Référentiels » en premier niveau, « Paramétrage pièces » en 8ᵉ
item du groupe Pièces, et un groupe « Paramétrage » (atelier / sites / coordonnées bancaires).
Rien ne dit à l'utilisateur où chercher un réglage.

**D4 — Objets, gestes, lieux et processus mélangés dans une même liste.** « Consignes » (objet),
« Réapprovisionnement » (processus), « Recherche comptoir » (lieu + geste), « Clôture de période »
(geste), « Sites » (objet de configuration). Sans règle de nommage, personne — ni l'utilisateur,
ni le prochain développeur — ne peut inférer où ranger le 48ᵉ écran. Le menu grossira toujours.

**D5 — Le menu porte la fonction de la recherche.** Clients, Véhicules, Ordres de réparation,
Factures, Articles sont des entrées de menu alors que ce sont des **recherches**. Le geste réel
d'un réceptionnaire n'est jamais « ouvrir la liste des clients » : c'est « trouver Dupont ».
Une liste de 4 200 clients n'est pas une destination, c'est un pis-aller quand la recherche manque.

**D6 — Un rôle sans navigation du tout.** `poste_atelier` (la borne murale) voit 8 entrées, dont
zéro ne le concerne, et son unique écran (`/pointage/borne`) n'est lié nulle part. La borne n'est
pas une personne : elle n'a pas besoin d'un menu, elle a besoin d'un seul geste plein écran.

---

3. Le pivot : la recherche doit sortir du menu et absorber une partie de son rôle

---

**Verdict : oui, et c'est ce qui rend le reste de la proposition possible.**

L'API est déjà bonne. `GET /recherche` normalise côté serveur, détecte la forme saisie (2 lettres

- chiffres → plaque, 17 caractères → VIN, `@` → e-mail, `OR-` → numéro d'OR), cherche par
  fragment, gère les plaques historiques et interchangeables. C'est un moteur d'entrée sérieux.

Ce qui est faux, c'est son **emplacement** : elle est une _destination_ (un lien de menu, un écran
plein). Concrètement, chercher une plaque depuis un OR ouvert coûte : quitter l'écran courant →
page recherche → taper → cliquer → et l'OR est perdu. Une recherche qui fait perdre le contexte
n'est pas un point d'entrée, c'est un détour.

**Proposition — trois changements, dans cet ordre de priorité :**

1. **Champ permanent dans l'en-tête**, centré, largeur ~480px, placeholder « Plaque, client, VIN,
   n° d'OR ou de facture ». L'en-tête a déjà 64px et un centre vide. Raccourci `Ctrl+K` / `⌘K`,
   annoncé dans le champ lui-même.
2. **Overlay au-dessus de l'écran courant** (`components/ui/command.tsx`, déjà présent), jamais une
   navigation. `Échap` referme, le contexte est intact. Sélection = navigation vers l'objet.
3. **La palette indexe aussi les écrans.** Taper « réappro » propose « Aller à →
   Réapprovisionnement » ; « clôture » propose « Aller à → Clôture de période ». C'est ce qui
   permet de retirer 24 entrées du menu **sans rendre un seul écran plus difficile à atteindre
   pour qui connaît son nom**.

**Sans le point 3, tout le reste s'effondre** : retirer un écran du menu sans palette, c'est
l'enterrer. Avec palette, c'est le ranger. La règle qui en découle : _le menu porte ce qu'on ouvre
sans savoir ce qu'on cherche ; la recherche porte ce qu'on cherche en le sachant._

**Travail API requis** (hors périmètre de ce document, à signaler) : `TypeResultatRecherche` doit
gagner `article`, `dossier_vente`, `depot_pneu`, `fournisseur`. Sans cela la palette ne couvre que
4 des 8 natures d'objet de l'application, et le magasinier n'en tire rien.

---

4. Structure proposée

---

**4.1 Les trois classes d'accès (la règle de rangement, D4)**

****Destination****

- Définition : un plan de travail qu'on ouvre sans savoir à l'avance quel objet on va manipuler
- Où ça vit : **le menu**, et rien d'autre
  ****Objet****
- Définition : un client, un véhicule, un OR, une facture, un article, un dossier
- Où ça vit : la **recherche** + les liens contextuels
  ****Réglage****
- Définition : configuré rarement, jamais dans le flux de travail
- Où ça vit : **Réglages**, une seule porte

Tout écran futur se range par cette règle. C'est ce qui empêche le menu de regrossir.

**4.2 Arborescence**

**Six entrées de travail + Réglages en pied.** Pourquoi six : c'est le nombre au-delà duquel une
liste cesse d'être perçue d'un coup d'œil et redevient une liste à lire. Six tient sans défilement
sur toute hauteur d'écran, y compris une tablette d'atelier en paysage — condition nécessaire de
la mémoire spatiale (§2.2). Il ne s'agit pas de viser « peu » : il s'agit de viser **un menu qui
ne bouge jamais et ne défile jamais**.

```
◆ Aujourd'hui                      (Accueil + Tableau de bord fusionnés)

◆ Atelier
    ├ Ordres de réparation         ← onglet par défaut
    ├ Pointage                     (Ma saisie · Journal · Équipe)
    └ Dépôt pneus                  (filtre : au dépôt · à relancer · sortis)

◆ Pièces
    ├ Comptoir                     ← onglet par défaut du magasinier
    ├ Articles
    ├ Approvisionnement            (À commander · Commandes · Fournisseurs)
    └ Consignes

◆ Ventes
    ├ Dossiers                     ← onglet par défaut
    ├ Véhicules en parc
    └ Suivi financement & garantie

◆ Facturation
    ├ Factures                     (filtres : toutes · impayées · à relancer)
    └ Encaissements

◆ Clients & véhicules
    ├ Clients                      (bandeau doublons intégré)
    └ Véhicules

─────────────────────────────────
⚙ Réglages                         (en pied, séparé par un filet)
    Atelier · Sites · Facturation · Tarifs et prestations · Pièces · Relances
```

**Le menu ne se déplie jamais.** Le second niveau vit **dans l'écran**, en onglets. Un menu
accordéon à six groupes ouvrables ne réduit pas la charge : il la déplace, et il ajoute un état
(quel groupe est ouvert ?) que l'utilisateur doit gérer. Avec des onglets internes, le menu est un
objet stable de six lignes, la position de chaque item est mémorisable dès la première semaine, et
le support téléphonique peut dire « troisième entrée » et être compris.

**4.3 Ce qui SORT du menu, entrée par entrée**

- **Accueil + Tableau de bord** : fusionnés en « Aujourd'hui » (cf. question 6)
- **Recherche** : champ permanent d'en-tête + `Ctrl+K`
- ****Doublons clients**** : **bandeau dans l'écran Clients** (« 12 fiches probablement en double ») **+ détection à la frappe dans le formulaire de création** — c'est là qu'un doublon se crée, donc là qu'il faut l'empêcher. Une entrée de menu ne détecte rien : elle attend qu'on pense à cliquer.
- **Référentiels** : Réglages → Tarifs et prestations
- **Relances** : paliers → Réglages ; déclenchement → onglet « À relancer » de Factures, **aujourd'hui inerte faute de filtre au contrat** — à câbler
- **Pièces > Recherche comptoir** : Pièces, onglet Comptoir
- **Pièces > Articles** : Pièces, onglet Articles
- **Pièces > Réapprovisionnement** : Pièces > Approvisionnement, vue « À commander »
- **Pièces > Commandes fournisseur** : Pièces > Approvisionnement, vue « Commandes »
- **Pièces > Fournisseurs** : Pièces > Approvisionnement, vue « Fournisseurs » + recherche
- **Pièces > Consignes** : Pièces, onglet Consignes
- **Pièces > Paramétrage** : Réglages → Pièces
- **Pointage > Saisie** : Atelier > Pointage, vue « Ma saisie »
- **Pointage > Journal / Équipe** : Atelier > Pointage, deux vues du **même** écran (même hook, mesuré)
- **Pointage > Clôture de période** : **action** en tête de la vue Équipe, pas un écran : on clôture ce qu'on est en train de regarder
- **Pneus > Hangar** : Atelier > Dépôt pneus
- **Pneus > À relancer** : **filtre** de Dépôt pneus — c'est déjà exactement ce qu'il est dans le code
- **Ventes > Stock / Dossiers / Suivi** : trois onglets de Ventes
- **Paramétrage atelier / sites / facturation** : Réglages

**30 → 6 + Réglages.** Aucun écran supprimé, aucun rendu inatteignable.

**4.4 Deux fusions d'écrans confirmées par le code**

- **Pneus** : `EcranJeuxARelancer` interroge `GET /depots-pneus/a-relancer` là où `EcranHangarPneus`
  fait déjà `?statut=a_relancer` sur le même jeu de données, avec les mêmes actions Déplacer /
  Sortir. Deux différences réelles : le site est optionnel dans l'un, et le rendu est en cartes
  d'un côté, en table de l'autre. Ce sont **deux paramètres, pas deux écrans**.
- **Pointage** : `EcranJournalPointage` et `EcranEquipePointage` appellent **le même
  `useListePointages`**, même site, même fenêtre du jour ; seules l'agrégation (cumuls vs lignes
  corrigeables) et la période changent. Deux onglets d'un écran.

Les autres paires soupçonnées **ne fusionnent pas**, vérification faite : Articles / Réappro
(projections serveur distinctes), Articles / Comptoir (endpoint dédié + actions de vente),
Dossiers / Suivi (`LigneSuiviVente` porte des colonnes absentes ailleurs, dont un champ soumis à
`ventes.financement.lire`), Réservations / Consignes (entités distinctes malgré un gabarit
identique), Clients / Doublons (critères et sortie différents). **Elles se regroupent en onglets ;
elles ne se confondent pas.** Un onglet n'est pas une fusion : c'est un rangement.

---

5. Les rôles : une seule structure qui se réduit

---

**Décision : une seule arborescence pour les neuf rôles. Pas de navigation par rôle.** Trois
raisons, dans l'ordre de poids :

1. **Le support devient impossible.** Neuf arborescences, c'est neuf produits. Au téléphone,
   « clique sur Atelier, deuxième entrée » doit être vrai pour tout le monde. C'est la raison la
   plus concrète pour un produit vendu à des garages de 4 à 12 personnes par un prestataire seul.
2. **Les gens changent de casquette dans la journée.** Dans un garage suisse de cette taille, le
   réceptionnaire fait du comptoir pièces, le chef d'atelier facture, la direction encaisse. Une
   navigation par rôle fige ce qui est fluide, et rend le changement de casquette coûteux.
3. **Le filtrage par droits existe déjà et suffit.** Avec six entrées, l'écart de vue entre rôles
   devient invisible : `technicien` en voit 4 (Aujourd'hui, Atelier, Pièces, Clients & véhicules),
   `magasinier` 4, `comptable` 4, `direction` 6 + Réglages. Un écart de 4 à 6 ne se remarque pas.
   L'écart actuel de 20 à 30 est, lui, structurant — et c'est précisément parce que le menu est
   long que la question « faut-il une nav par rôle ? » se pose. **Raccourcir le menu dissout le
   problème au lieu de le contourner.**

Ce qui varie par rôle, en revanche : **l'écran d'atterrissage** (`/`), et rien d'autre.

- **`technicien`** : Atelier → Pointage, vue « Ma saisie »
- **`magasinier`** : Pièces → Comptoir
- **`receptionnaire`, `chef_atelier`** : Aujourd'hui
- **`vendeur`** : Ventes → Dossiers
- **`comptable`** : Facturation → Factures
- **`direction`, `admin`** : Aujourd'hui

**L'ordre des six entrées reste identique pour tous** — un ordre variable détruirait la mémoire
spatiale et le support téléphonique, pour un gain nul.

**Exception assumée : `poste_atelier`.** Ce n'est pas un rôle, c'est un **appareil**. Aucun menu,
aucun en-tête, aucune recherche : `/pointage/borne` en plein écran, cibles ≥ 64px, pavé numérique,
un seul geste. C'est la seule dérogation, et elle se justifie par la nature de l'utilisateur, pas
par ses droits.

---

6. Avis sur la proposition de @laupernoe : « pièces et pneus sous Stock »

---

**D'accord sur la moitié, en désaccord sur l'autre — et le désaccord porte sur le mot lui-même.**

**Contre le regroupement des pneus.** Un pneu au dépôt appartient au client. Le test qui tranche
n'est pas ergonomique, il est comptable : **à l'inventaire annuel, un jeu de pneus au dépôt ne
compte pas dans les actifs du garage.** Un écran « Stock » qui promet « ce que je possède et sa
valeur » et qui affiche 400 jeux appartenant à des tiers ment sur son propre contenu. Le dépôt
pneus est un **service rendu**, facturé, attaché à un véhicule : sa place est du côté du travail
(Atelier), pas du côté du patrimoine.

**Contre le mot « Stock », plus fondamentalement.** Il est **déjà pris** dans l'application :
`ventes/stock` désigne les véhicules VN/VO en parc, avec ses écrans, ses chemins
(`chemins.ventes.stock`) et son vocabulaire. Introduire un « Stock » qui désigne les pièces créerait
deux sens du même mot dans le même menu — exactement le genre de collision qui rend un logiciel
« illogique ». Je propose **« Pièces »** (le mot du métier, celui du magasinier) et **« Véhicules
en parc »** côté ventes, pour ne laisser aucune ambiguïté.

**D'accord, en revanche, sur le fond de l'intuition** : les huit entrées « Pièces » n'ont
effectivement rien à faire au premier niveau. La solution n'est pas un tiroir de plus, c'est
**une entrée et quatre onglets** (§4.2), avec le Comptoir en premier — parce que c'est un poste de
travail, pas une fonction de gestion du stock.

**Où va donc le dépôt pneus ?** Sous **Atelier**, comme troisième onglet. Raison : la manipulation
est physique et atelier, le hangar est un emplacement de l'atelier, et la campagne saisonnière se
planifie comme une prestation. C'est la réponse la plus défendable en l'état — mais elle dépend
de qui ouvre cet écran le matin, ce que je ne peux pas trancher seul (questions 1 et 2).

---

7. Questions à @laupernoe

---

1. **Vendez-vous des pneus neufs (article de stock), en plus de garder ceux des clients ?**
   → Si oui, deux objets homonymes coexistent (le pneu-article et le pneu-dépôt) et il faut les
   nommer différemment dans l'UI, sous peine de reproduire exactement la confusion qu'on corrige.

2. **Qui ouvre le hangar à pneus le matin : la réception (campagne, relances, rendez-vous) ou le
   mécanicien (manutention) ?**
   → Réception ⇒ « Dépôt pneus » remonte comme entrée propre ou passe côté Clients & véhicules.
   Mécanicien ⇒ il reste un onglet d'Atelier, comme proposé.

3. **Dans tes 10 garages, un employé a-t-il un seul rôle ou plusieurs casquettes dans la journée ?**
   → Plusieurs casquettes ⇒ confirme le refus de la navigation par rôle (§5). Un seul rôle strict
   par personne ⇒ l'atterrissage par rôle devient plus important que je ne l'ai supposé, et il
   faudrait peut-être aller jusqu'à masquer des onglets, pas seulement des entrées.

4. **Tes utilisateurs se servent-ils du clavier, ou tout se fait-il à la souris et au doigt ?**
   → Clavier ⇒ `Ctrl+K` est le mécanisme principal et le menu peut maigrir sans réserve.
   Souris / tactile uniquement ⇒ le champ de recherche doit être visible et cliquable en
   permanence, et je dois garder deux ou trois raccourcis de plus dans le menu.

5. **Combien de tes garages ont plus d'un site, et un employé change-t-il de site plusieurs fois
   par jour ?**
   → Souvent ⇒ le site devient un **sélecteur actif** dans l'en-tête (il n'est aujourd'hui qu'un
   texte passif, `EnTete.tsx`), à côté de la recherche. Rarement ⇒ il reste un filtre d'écran et
   je ne touche pas à l'en-tête.

6. **Un chef d'atelier ouvre-t-il le tableau de bord chaque matin, ou est-ce un écran que seule la
   direction consulte, une fois par mois ?**
   → Chaque matin ⇒ la fusion Accueil + Tableau de bord en « Aujourd'hui » est juste, et cet écran
   devient le cœur du produit. Mensuel ⇒ le tableau de bord redescend dans Réglages ou sous une
   entrée « Chiffres », et « Aujourd'hui » doit être conçu à partir de zéro comme un écran de
   travail, pas comme un tableau d'indicateurs.

---

8. Défauts hors périmètre, signalés

---

- **`/pointage/borne` n'est lié depuis aucun menu** (`BarreLaterale.tsx`) — l'écran n'est
  atteignable qu'en tapant l'URL. À corriger indépendamment de cette refonte.
- **L'onglet « À relancer » de `EcranListeFactures` est inerte** : aucun filtre `relanceNiveau` /
  `enRetard` au contrat. La proposition §4.3 en dépend.
- **`TypeResultatRecherche` couvre 4 natures d'objet sur 8.** Extension API préalable à la palette.
- **Chemins locaux non fusionnés** : `ecrans/ventes/stock/_composants/chemins-locaux.ts` et
  `ecrans/ventes/dossiers/chemins-dossiers.ts` doublonnent `routes/chemins.ts`, tous deux marqués
  « provisoire » par leurs auteurs. À traiter avant de retoucher la navigation, sinon la refonte
  devra être faite deux fois.
