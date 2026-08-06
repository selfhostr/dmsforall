# Refonte de la navigation — document de décision

06.08.2026. Ce document tranche. Il confronte deux études menées en parallèle —
`docs/refonte-navigation-metier.md` (usage réel du garage) et
`docs/refonte-navigation-structure.md` (architecture de l'information) — et se substitue à elles
pour la conduite du chantier. Les deux sources restent au dépôt comme trace du raisonnement ;
il n'est pas nécessaire de les relire.

Critère d'arbitrage, unique et rappelé à chaque décision : **ce qui rend le produit utilisable
pour un garagiste ET soutenable pour un homme seul qui fait le support de dix garages.**

---

## 1. Le diagnostic commun

Les deux études convergent, par des chemins différents, sur le même constat. Il tient en cinq
points, tous **mesurés dans le code**, pas supposés.

**1. Le menu est devenu la table des matières du logiciel.** Trente entrées pour `direction`,
vingt pour `technicien`, dont onze ouvertes moins d'une fois par mois — avec la même largeur et la
même dignité visuelle qu'un écran ouvert quinze fois par jour. Les cinq groupes (`pieces`,
`pointage`, `pneus`, `ventes`, `parametrage`) sont, à l'identique, les répertoires de
`apps/api/src/` : c'est un plan du code, pas un plan du travail.

**2. La barre latérale défile** — `overflow-y-auto`, `BarreLaterale.tsx:212`, vérifié. Défaut le
plus coûteux et le plus discret. Un menu de position stable se mémorise en quelques jours : la main
va au troisième item sans que l'œil lise. Un menu qui défile n'a pas de troisième item stable ;
l'utilisateur **relit à chaque fois, indéfiniment**. Ça ne coûte pas cher une fois, ça coûte cher
tous les jours pendant cinq ans.

**3. La configuration est mêlée au travail quotidien**, éclatée sur trois emplacements à trois
niveaux : « Référentiels » en premier niveau, « Paramétrage pièces » en huitième item du groupe
Pièces, et un groupe « Paramétrage ». Rien ne dit où chercher un réglage.

**4. La recherche est traitée comme une destination alors que c'est un geste.** Chercher une plaque
depuis un OR ouvert coûte : quitter l'écran, page recherche, taper, cliquer — et l'OR est perdu.
Conséquence directe : Clients, Véhicules, Ordres de réparation, Factures, Articles sont des entrées
de menu alors que ce sont des recherches. Personne ne se dit « j'ouvre la liste des clients » : on
se dit « je cherche Dupont ».

**5. Deux paires d'écrans sont le même écran.** `EcranJournalPointage` et `EcranEquipePointage`
appellent **le même `useListePointages`**, même site, même fenêtre du jour — seule l'agrégation
diffère. `EcranJeuxARelancer` interroge un jeu de données que `EcranHangarPneus` sait déjà filtrer
(`statut=a_relancer`), avec les mêmes actions. Quatre entrées de menu pour deux écrans.

**Trois constats qui frappent, à part :**

- **La borne d'atelier n'est liée depuis aucun menu.** `/pointage/borne` est routé, l'écran
  existe, et il n'est atteignable qu'en tapant l'URL à la main. Le rôle `poste_atelier` voit huit
  entrées, dont aucune n'est son travail.
- **La primitive de palette de commande est déjà là et déjà maîtrisée.** `components/ui/command.tsx`
  (cmdk) est utilisé par `PanneauResultatsRecherche.tsx`, avec gestion du focus, de l'Échap et des
  résultats typés. Nuance par rapport à l'étude structure : ce n'est pas du code mort, c'est du
  **code au bon niveau de qualité, enfermé dans un écran plein**. Le travail de palette globale est
  aux trois quarts fait — il reste à monter ce panneau dans le layout au lieu de dans une page.
- **La recherche ne connaît que quatre natures d'objet** sur les huit de l'application :
  `vehicule`, `client`, `ordre_reparation`, `document_vente`. Ni article, ni dépôt pneu, ni
  fournisseur.

**Sur « Stock » : accord des deux études pour rejeter le mot.** Le regroupement pièces + pneus part
d'une intuition juste, le mot est faux. Deux raisons indépendantes, chacune suffisante. La première
est comptable : un jeu de pneus au dépôt **appartient au client** — pas de prix d'achat, pas de
valeur d'inventaire, pas de marge, et le jour où le garage ferme ces pneus se rendent, ils ne se
liquident pas. Un écran qui promet « ce que je possède et sa valeur » en affichant quatre cents
jeux appartenant à des tiers ment sur son propre contenu ; quelqu'un finira par les compter dans un
inventaire. La seconde est plus bête et tout aussi bloquante : **le mot est déjà pris** —
`ventes/stock` désigne les véhicules VN/VO en parc. Deux sens du même mot dans le même menu, c'est
exactement ce qui fait dire d'un logiciel qu'il est illogique.

---

## 2. Le désaccord principal, tranché

### Les deux positions

**Étude structure** : une seule arborescence pour les neuf rôles, filtrée par droits, ordre
identique pour tous. Seule dérogation, la borne. Argument : neuf arborescences, c'est neuf
produits ; au téléphone, « clique sur Atelier, deuxième entrée » doit être vrai pour tout le monde.

**Étude métier** : trois postes de travail. Comptoir (six entrées), atelier (trois entrées pour le
technicien), borne (aucun menu). Argument : un menu masqué par rôle n'est pas un menu pensé par
rôle ; un technicien qui traverse chaque jour un menu conçu pour le comptoir perd du temps.

### Ce que révèle la superposition

L'écart réel est beaucoup plus petit que les mots ne le laissent croire. Le poste « comptoir » de
l'étude métier et l'arborescence unique de l'étude structure sont **les mêmes six entrées**, à un
libellé près : aucun désaccord. Le poste « atelier » compte trois entrées (Mon travail, Atelier,
Magasin) ; l'arborescence unique filtrée par les droits du `technicien` en laisse quatre
(Aujourd'hui, Atelier, Pièces, Clients & véhicules).

**Le désaccord porte donc sur une entrée, pour un rôle sur neuf.** Ce n'est pas un désaccord
d'architecture, c'est un désaccord de réglage — et il ne justifie pas de construire trois produits.

### Décision : une seule arborescence, ordre fixe pour tous, filtrée par droits

Quatre raisons, dans l'ordre de poids.

**1. Le support téléphonique.** Raison décisive, et propre à ce produit. Un prestataire seul, dix
garages, du dépannage au téléphone. « Troisième entrée, sous Atelier » doit être vrai pour
l'interlocuteur quel que soit son rôle, sans avoir à demander d'abord « tu es connecté avec quel
compte ? ». Trois arborescences, c'est trois fois cette question avant chaque réponse, et trois
jeux de captures d'écran à maintenir.

**2. Les casquettes changent dans la journée.** Dans un garage de cinq personnes, le réceptionnaire
fait du comptoir pièces, le chef d'atelier facture, le patron encaisse. L'étude métier le dit
elle-même : « le magasinier n'existe pas dans la majorité des cas — c'est le réceptionniste qui
fait tout ça entre deux clients ». Une navigation par rôle fige ce qui est fluide.

**3. Le grief du menu « pensé pour un autre » se dissout une fois le menu court.** Le technicien
voit aujourd'hui vingt entrées sur trente : l'écart est structurant, il traverse un logiciel qui
n'est pas le sien. Demain il en verra quatre sur six, et un écart de quatre à six ne se remarque
pas. **La longueur du menu est ce qui faisait exister la question de la navigation par rôle ; la
raccourcir dissout le problème au lieu de le contourner.** Accessoirement, le grief de la « liste
grise de choses interdites » est faux : la barre latérale filtre déjà par droits, elle ne grise rien.

**4. Le coût de maintenance.** Trois arborescences, c'est trois fois les tests de navigation et
trois décisions de rangement à chaque écran ajouté — pour un produit qui compte déjà quarante-sept
écrans métier et qui grandira.

### Ce que l'option écartée avait raison de défendre, et qui est repris

L'étude métier a raison sur le fond : **le technicien ne doit pas atterrir dans un écran conçu
pour le comptoir**. Ce besoin est réel et il est satisfait sans trois arborescences.

- **L'écran d'atterrissage varie par rôle.** Le technicien arrive directement sur « Mon travail »
  (chronomètre + ses lignes). Il n'a jamais à traverser quoi que ce soit pour y arriver : c'est sa
  page d'accueil.
- **L'onglet par défaut d'une entrée varie par rôle.** Le magasinier qui ouvre Pièces tombe sur
  Comptoir, pas sur l'inventaire.
- **« Mon travail » n'est pas une septième entrée** : c'est la première vue de l'onglet Pointage
  d'Atelier, et l'atterrissage du technicien.

| Rôle | Atterrissage |
| --- | --- |
| `technicien` | Via `/pointage/borne` partagée (voir note ci-dessous) |
| `magasinier` | Pièces › Comptoir |
| `receptionnaire`, `chef_atelier` | Aujourd'hui |
| `vendeur` | Ventes › Dossiers |
| `comptable` | Facturation › Factures |
| `direction`, `admin` | Aujourd'hui |
| `poste_atelier` | `/pointage/borne`, plein écran |

**Ce que l'option écartée perd réellement, et qu'il faut assumer :** le technicien verra deux
entrées qu'il n'ouvrira jamais (Aujourd'hui, Clients & véhicules). Deux lignes de plus dans un
menu de quatre, sur un écran qu'il regarde trente minutes par jour. C'est le prix d'un produit
unique, et il est faible.

**Exception maintenue, la borne.** `poste_atelier` n'est pas un rôle, c'est un **appareil**. Aucun
menu, aucun en-tête, aucune recherche : `/pointage/borne` en plein écran, cibles ≥ 64 px, pavé
numérique, un seul geste. Les deux études sont d'accord, la décision est prise, on n'y revient pas.

**Conséquence : les mécaniciens ne sont pas des utilisateurs quotidiens de l'arborescence principale.**
Leur point d'entrée du jour est la borne murale partagée (`/pointage/borne`). L'arborescence de navigation
est donc dimensionnée pour : réception, comptoir, chef d'atelier, magasinier, vendeur, direction, 
comptabilité — pas pour le technicien au quotidien. Le compte nominatif `technicien` reste utile pour
l'audit trail et la reprise de pointages, mais n'est pas un point d'entrée applicatif principal.

---

## 3. La cause profonde : les fiches ne mènent nulle part

C'est la découverte de l'étude métier, et elle passe devant tout le reste. Vérifiée dans le code,
en comptant les liens sortants de chaque fiche :

| Fiche | Liens sortants |
| --- | --- |
| `EcranFicheOrdreReparation.tsx` | **0** |
| `EcranFicheVehicule.tsx` | **0** |
| `EcranFicheArticle.tsx` | **0** |
| `EcranFicheFacture.tsx` | 7 |
| `EcranFicheClient.tsx` | 3 |

Depuis un véhicule, on n'atteint **ni son propriétaire, ni ses OR, ni ses factures, ni ses pneus au
dépôt**. Depuis un OR, rien : l'en-tête affiche le nom du client et la plaque, et aucun des deux
n'est cliquable.

**Voilà d'où viennent les trente entrées.** On met dans le menu ce qu'on ne peut atteindre
autrement. **Chaque lien manquant dans un écran devient une ligne de plus dans la barre latérale.**
Le menu n'est pas la maladie, c'est le symptôme — et il a grossi exactement autant que les chemins
manquaient.

**Conséquence sur l'ordre des travaux, et elle est impérative : on ne coupe pas le menu en
premier.** Retirer vingt-quatre entrées avant d'avoir posé les liens et la palette, ce n'est pas
ranger, c'est **enfermer les gens** — ils perdraient le seul chemin qu'ils ont vers des écrans qui
n'en auraient toujours aucun autre. L'ordre est donc : d'abord les chemins et la recherche, ensuite
le menu. Il est inversable dans un plan de projet, pas dans la réalité.

**Les enchaînements à poser**, dans les deux sens :

```
plaque ─→ VÉHICULE ─→ CLIENT ─→ ses autres véhicules
             │
             ├─→ historique des OR ─→ OR ─→ FACTURE ─→ encaissement
             ├─→ jeu de pneus au dépôt (emplacement, saison, date de pose)
             ├─→ échéances (MFK, prochain service, garantie)
             └─→ travaux reportés ─→ « ouvrir un OR avec ces lignes »
```

Le retour compte autant que l'aller : de la facture à l'OR, de l'OR au véhicule, du véhicule au
client. C'est ce qui permet de raccrocher le téléphone en sachant de quoi on parle.
`EcranFicheFacture.tsx` est le modèle : sept liens, il fonctionne, on le copie.

---

## 4. L'arborescence retenue

### 4.1 La règle de rangement

Trois classes, et tout écran futur se range par elles. C'est ce qui empêchera le menu de regrossir.

| Classe | Définition | Où ça vit |
| --- | --- | --- |
| **Destination** | un plan de travail qu'on ouvre sans savoir à l'avance quel objet on va manipuler | **le menu**, et rien d'autre |
| **Objet** | un client, un véhicule, un OR, une facture, un article, un dossier | la **recherche** et les liens contextuels |
| **Réglage** | configuré rarement, jamais dans le flux de travail | **Réglages**, une seule porte |

### 4.2 Le menu

| Entrée | Onglets (le premier est celui par défaut) |
| --- | --- |
| ◆ **Aujourd'hui** | Accueil + Tableau de bord fusionnés. Blocs actionnables : OR du jour, sorties du soir, attentes de pièces, garanties à échéance, jeux de pneus à relancer |
| ◆ **Atelier** | Ordres de réparation · Planning · Pointage *(Mon travail · Journal · Équipe)* · Dépôt pneus *(au dépôt · à relancer · sortis)* |
| ◆ **Clients & véhicules** | Clients *(bandeau doublons intégré)* · Véhicules |
| ◆ **Pièces** | Comptoir *(défaut du magasinier)* · Articles *(filtres : réservés · à commander)* · Approvisionnement *(À commander · Commandes · Fournisseurs)* · Consignes |
| ◆ **Facturation** | Factures *(toutes · impayées · à relancer)* · Encaissements |
| ◆ **Ventes** | Dossiers · Véhicules en parc · Suivi financement & garantie |
| ⚙ **Réglages** *(pied, séparé par un filet)* | Atelier · Sites · Facturation · Tarifs et prestations · Pièces · Relances |

**Six entrées, et le menu ne se déplie jamais.** Le second niveau vit dans l'écran, en onglets. Un
accordéon à six groupes ne réduit pas la charge : il la déplace, et il ajoute un état (quel groupe
est ouvert ?) que l'utilisateur doit gérer. Avec des onglets internes, le menu est un objet stable
de six lignes, qui ne défile sur aucun écran installé chez nos clients, et dont la position de
chaque item se mémorise dans la première semaine.

**L'ordre suit la journée**, pas la fréquence brute : le matin (Aujourd'hui), la journée (Atelier),
le téléphone (Clients & véhicules), la pièce qu'on va chercher (Pièces), le soir (Facturation), le
rythme mensuel (Ventes). Il est **identique pour tous les rôles** — un ordre variable détruirait la
mémoire spatiale et le support téléphonique pour un gain nul.

### 4.3 Les noms, là où les deux études divergeaient

| Chose | Nom retenu | Pourquoi, en une ligne |
| --- | --- | --- |
| Le stock de pièces | **Pièces** | « Magasin » n'était justifié que comme conteneur commun avec les pneus ; les pneus n'y vont pas (§4.4), le mot perd sa raison d'être. « Stock » est déjà pris par `ventes/stock`. |
| Les VN/VO en parc | **Véhicules en parc** | lève l'homonymie avec « Pièces », et dit ce que c'est plutôt que d'où ça vient. |
| Clients et véhicules | **Clients & véhicules** | « Clients » seul ne laisse pas deviner qu'on y trouve les véhicules ; le garagiste cherche une plaque avant un nom. Tient en allemand (*Kunden & Fahrzeuge*) et en italien (*Clienti e veicoli*). |
| Les pneus gardés | **Dépôt pneus** | dit la nature juridique (garde, pas propriété) et non le local. Écarte « Hangar », qui est un bâtiment chez certains et une étagère chez d'autres. |
| L'écran du matin | **Aujourd'hui** | un moment, pas un module. Écarte « Tableau de bord », qui promet des chiffres à qui vient chercher son travail. |

### 4.4 Où va le dépôt pneus — arbitrage

L'étude métier le range sous « Magasin » (même question pour celui qui travaille : où est la chose
physique ?). L'étude structure le range sous « Atelier » (test comptable : ce n'est pas du
patrimoine).

**Décision : onglet d'Atelier.** Le test comptable tranche — on ne met pas un dépôt de tiers dans
le même écran que l'inventaire valorisé, sous peine de le voir compté un jour dans les actifs. Et
le hangar est un local d'atelier dont la campagne saisonnière se planifie comme une prestation.

**Mais la réserve de l'étude métier compte plus que l'arbitrage lui-même, et elle est retenue en
priorité :** le point d'entrée principal du dépôt pneus n'est pas le menu, **c'est la fiche
véhicule**. On n'ouvre pas « le hangar » pour chercher un jeu ; le client arrive, on ouvre son
véhicule, et on doit lire là *« jeu hiver au dépôt, emplacement C-14, posé le 12.11.2025 »*.
L'entrée de menu sert au magasinier qui range, deux mois par an ; la fiche véhicule sert au
réceptionnaire qui reçoit, tous les jours. Ce bloc est donc au lot B ; l'emplacement dans le menu
est secondaire.

### 4.5 Ce qui sort du menu — tableau complet

| Entrée actuelle | Où on y accède désormais |
| --- | --- |
| Accueil + Tableau de bord | fusionnés en **Aujourd'hui** |
| Recherche | **champ permanent d'en-tête + `Ctrl+K`**, en surimpression, sans quitter l'écran |
| Véhicules | onglet de Clients & véhicules · recherche · fiche client |
| Doublons clients | **bandeau dans l'écran Clients** (« 12 fiches probablement en double ») **+ détection à la frappe dans le formulaire de création** — un doublon se crée là, c'est là qu'il faut l'empêcher ; une entrée de menu attend qu'on pense à cliquer |
| Référentiels (tarifs, prestations) | **Réglages**. Un réceptionnaire ne consulte pas un tarif horaire : il ajoute une prestation sur un OR et le prix vient tout seul. S'il doit voir un prix, c'est dans le sélecteur de prestation de l'OR. |
| Relances | paliers → Réglages ; déclenchement → onglet « À relancer » de Factures |
| Pièces › Recherche comptoir | Pièces › Comptoir |
| Pièces › Articles | Pièces › Articles |
| Pièces › Réservations | **filtre** d'Articles |
| Pièces › Réapprovisionnement | Pièces › Approvisionnement, vue « À commander » |
| Pièces › Commandes fournisseur | Pièces › Approvisionnement, vue « Commandes » |
| Pièces › Fournisseurs | Pièces › Approvisionnement, vue « Fournisseurs » + recherche. Un fournisseur se consulte depuis une commande, jamais dans l'absolu. |
| Pièces › Consignes | Pièces › Consignes |
| Pièces › Paramétrage | Réglages › Pièces |
| Pointage › Saisie | Atelier › Pointage › Mon travail |
| Pointage › Journal / Équipe | Atelier › Pointage, **deux vues du même écran** (même hook, mesuré) |
| Pointage › Clôture de période | **action** en tête de la vue Équipe : on clôture ce qu'on regarde |
| Pointage › Borne | **plus dans le menu du tout** — la borne se connecte avec son propre compte et atterrit dessus |
| Pneus › Hangar | Atelier › Dépôt pneus |
| Pneus › Jeux à relancer | **filtre** de Dépôt pneus (c'est déjà ce qu'il est dans le code) + bloc actionnable dans Aujourd'hui à la saison |
| Ventes › Stock / Dossiers / Suivi | trois onglets de Ventes ; le suivi garanties alimente aussi un bloc d'Aujourd'hui |
| Paramétrage atelier / sites / facturation | Réglages |

**30 entrées → 6 + Réglages. Aucun écran supprimé, aucun rendu inatteignable.**

Deux avertissements. **Un onglet n'est pas une fusion, c'est un rangement** : seules deux paires
fusionnent réellement en code (pointage journal/équipe, pneus hangar/à relancer) ; Articles /
Réappro, Articles / Comptoir, Dossiers / Suivi et Réservations / Consignes ont été vérifiées et
**ne fusionnent pas**. Et **deux pastilles au maximum** dans le menu — OR ouverts sur Atelier,
factures en retard sur Facturation. Un menu qui clignote de partout ne signale plus rien.

---

## 4.6 Contraintes transverses (s'appliquent à tous les lots)

**Responsive et tactile dès la conception.** Les postes de comptoir fonctionnent sur des écrans tactiles
(≥ 24 pouces). La navigation doit être utilisable avec cliquer/taper, et dégradable vers tablette et
mobile — même si le principal cas d'usage est desktop tactile. Conséquences concrètes :
- Cibles tactiles **≥ 44 px** partout, y compris sur écran desktop (ne pas supposer clics pécis de souris).
- Bouton de recherche (loupe) **toujours visible**, pas de Cmd+K seul. Le raccourci clavier reste, mais 
  l'équivalent tactile doit exister en permanence pour ne pas supposer les raccourcis claviers.
- Mise en page flexible : pas de colonnes fixes ; breakpoints testés réellement sur mobile/tablette avant
  de laisser un lot partir en développement.

---

## 5. Ordre des travaux

Six lots. Chacun apporte de la valeur seul et peut être livré sans attendre le suivant.

**Lot 0 — Dettes préalables (une demi-journée).** Sinon la refonte sera à refaire : fusionner
`ecrans/ventes/stock/_composants/chemins-locaux.ts` et `ecrans/ventes/dossiers/chemins-dossiers.ts`
dans `routes/chemins.ts` (tous deux marqués « provisoire » par leurs auteurs), et faire atterrir
`poste_atelier` sur `/pointage/borne` — défaut isolé, indépendant de la refonte, qui rend un écran
livré inatteignable.

**Lot A — La recherche partout. ★ Le meilleur rapport valeur/effort du chantier. Sans regret, démarrable immédiatement.**
Champ permanent dans l'en-tête (le centre des 64 px est vide), `Ctrl+K` annoncé dans le champ, et
panneau de résultats **en surimpression de l'écran courant** — Échap referme, le contexte est
intact. Le composant existe déjà et est bon (`PanneauResultatsRecherche.tsx`) : le travail consiste
à le monter dans le layout au lieu d'une page, pas à l'écrire. **La palette indexe aussi les
écrans** (« réappro » → « Aller à → Réapprovisionnement ») : c'est ce qui permettra de retirer
vingt-quatre entrées du menu sans rendre un seul écran plus difficile à atteindre pour qui connaît
son nom. Livrable seul, et il améliore déjà la journée du réceptionniste.
*Prérequis API, en parallèle :* `TypeResultatRecherche` doit gagner `article`, `depot_pneu`,
`fournisseur` — sinon la palette ne couvre que quatre natures d'objet sur huit.

**Lot B — Les fiches deviennent cliquables. ★ La plus grande valeur métier absolue. Sans regret, démarrable immédiatement.**
Quatre écrans indépendants, livrables un par un, `EcranFicheFacture.tsx` comme modèle :
- **Fiche véhicule** → propriétaire · détenteurs précédents · ses OR · ses factures · son jeu de
  pneus au dépôt et son emplacement · travaux reportés avec « ouvrir un OR à partir de ces travaux »
  · échéance MFK · bouton « nouvel OR ».
- **Fiche OR** → le client · le véhicule · l'OR précédent du même véhicule · chaque ligne pièce vers
  l'article et sa disponibilité · le devis d'origine · la facture émise · qui a pointé et combien.
- **Fiche article** → les OR qui l'ont consommé · les réservations et pour quel OR · les commandes
  fournisseur en attente · le fournisseur.
- **Dossier de vente** → le véhicule · l'OR de préparation · la reprise · la facture · le client.

**Lot C — Fil d'Ariane contextuel et action primaire unique.** Le haut d'un OR doit dire *qui* et
*quoi*, chaque morceau cliquable : `Martin SA › VD 123 456 · Golf VII › OR-2026-0184`. Pas
`Atelier > Ordres de réparation > Détail` — le premier est une carte du dossier en cours, le second
une carte du logiciel, et personne ne travaille dans un logiciel : on travaille sur une Golf qui
appartient à Martin SA. En parallèle, **une seule action primaire par écran**, en couleur, à un
endroit constant ; le reste (corriger, annuler, dupliquer, imprimer, exporter) derrière un « … ».
Sur un OR elle suit l'état : *Ajouter une ligne* en cours, *Facturer* quand tout est réalisé.
Dépend de B pour les cibles de liens.

**Lot D — Le menu à six entrées. Bloqué jusqu'à une phase d'observation terrain.** Ne peut venir qu'**après A et B**, pour
la raison du §3. **Prérequis supplémentaire : une courte mission d'observation chez un garagiste** pour
identifier les gestes réflexes hérités d'Auto-i ou Nextlane. Réduire le menu sans connaître ces habitudes
court le risque de casser un réflexe quotidien. Dès que cette observation est faite, le lot D comprend :
la barre latérale sans défilement, les onglets internes, Réglages en pied séparé par un filet, l'atterrissage et
l'onglet par défaut par rôle, et les deux fusions d'écrans confirmées (pointage journal/équipe, pneus hangar/à relancer).

**Lot E — Ce qui devient contextuel.** Bandeau doublons dans l'écran Clients et détection à la
frappe à la création ; clôture de période en action de la vue Équipe ; blocs actionnables dans
Aujourd'hui (garanties à échéance, jeux d'hiver à relancer). Un menu ne doit jamais héberger une
file d'attente.
*Prérequis signalé :* l'onglet « À relancer » de `EcranListeFactures` est **inerte** — aucun filtre
`relanceNiveau` / `enRetard` au contrat. À câbler côté API.

**Lot F — Aujourd'hui. Écran d'accueil du produit, conception décisive.** Le tableau de bord devient
l'écran de destination après connexion. Cet écran doit être réellement utile le matin — activité atelier
ouverte, à-faire du jour, garanties à relancer — sinon il se redégrade en simple entrée de menu. La conception
de « Aujourd'hui » fusionne Accueil + Tableau de bord et mérite du temps : c'est la porte d'entrée du produit,
et elle fixe la perception de la journée qui commence. Condition explicite de qualité : mesurer son usage réel
auprès d'un chef d'atelier sur une semaine avant de la figer.
*Note :* L'écran actuel tient le rôle temporairement ; ce lot apporte une conception à part entière.

---

## 6. Réponses de @laupernoe (06.08.2026) — Arbitrages figés

Huit questions adressées le 06.08.2026 pour trancher les points résiduels. Toutes reçues une réponse.
Chacune change concrètement quelque chose ; celles qui n'en changeaient pas ont été tranchées plus tôt.

**Q1 — Casquettes multiples.** Réponse : « dans les grands garages chaque personne reste dans son rôle,
mais à la base l'app est conçue pour les petits garages ; dans les garages de 1 à 5 personnes chacun
peut tout faire. »
→ **CONFIRMÉ.** L'arbitrage déjà pris est renforcé : une seule arborescence, filtrée par droits.
Le petit garage (1–5 personnes) a des droits larges donc voit presque tout le menu ; le grand garage a
des rôles stricts donc un menu filtré court. Le même menu sert les deux sans variante ni « postes de travail »
figés.

**Q2 — Comptes mécaniciens.** Réponse : « ils pointent sur une borne partagée. »
→ **CHANGE LA PRIORITÉ DE CONCEPTION.** Les mécaniciens ne sont pas des utilisateurs quotidiens
de l'arborescence principale ; leur point d'entrée du jour est la borne murale partagée (`/pointage/borne`).
L'arborescence est donc dimensionnée pour : réception, comptoir, chef d'atelier, magasinier, vendeur,
direction, comptabilité. Le compte nominatif `technicien` reste utile pour l'audit trail, mais n'est pas
un point d'entrée applicatif principal. *(Voir §2, table d'atterrissage et note qui suit.)*

**Q3 — Multi-sites.** Réponse : « il ne change rarement de site, peu de garages ont plusieurs sites,
mais ça arrive. »
→ **CONFIRMÉ.** Le sélecteur de site reste discret (menu profil/réglages), jamais une barre permanente en haut.
Il existe parce que le cas arrive, mais il ne structure pas la navigation.

**Q4 — Poste comptoir et écrans.** Réponse : « minimum 24 pouces, mais je veux par la suite que l'app
fonctionne sur iPad et mobile donc il faut déjà y penser ; il y a clavier-souris ET tactile. »
→ **NOUVELLE CONTRAINTE TRANSVERSE.** La navigation doit être responsive dès la conception, avec cibles
tactiles suffisantes (≥ 44 px) même sur poste desktop puisque les postes sont tactiles, et dégradable vers
tablette et mobile. La palette de commande clavier (Cmd+K, lot A) doit conserver un équivalent tactile
visible (bouton loupe) pour ne pas supposer les raccourcis claviers. Cette contrainte s'applique à **tous les lots**.
*(Voir §4.6, « Contraintes transverses ».)*

**Q5 — Pneus.** Réponse : « le gardiennage peut être facturé et les pneus neufs font partie du stock. »
→ **CONFIRMÉ.** Le dépôt de pneus client (gardiennage) reste sous Atelier / fiche véhicule. Le pneu neuf
vendu est un article de Pièces. Le gardiennage facturable se traduit par un bouton « facturer le gardiennage »
depuis le dépôt de pneus, et non par une entrée de menu dédiée. Le mot retenu reste **Pièces**.

**Q6 — Tableau de bord.** Réponse : « tous les matins, si il est bien. »
→ **CHANGE L'ORDRE DES LOTS.** Le tableau de bord devient l'écran d'accueil après connexion (le landing),
et non plus une simple entrée de menu. Il reste accessible pour y revenir, mais le défaut au login est le
tableau de bord. Condition explicite portée par le « si il est bien » : il doit être réellement utile le matin
(activité atelier ouverte, à-faire du jour) ; s'il ne l'est pas, il redevient une simple entrée de menu.
La conception de cet écran mérite du temps et une validation terrain. *(Voir lot F, §5.)*

**Q7 — Langues.** Réponse : « les 3 langues majeures de la Suisse (français, allemand, italien). »
→ **EXIGENCE DE VALIDATION.** La largeur des libellés de menu doit être dimensionnée sur le plus long des trois,
c'est-à-dire l'allemand (`Reparaturauftrag` est bien plus long qu'OR). **Tester le rendu réel du menu en
allemand avant de figer les libellés**, et faire valider les termes par un garagiste germanophone pour éviter
une retranslation qui casse la mémoire spatiale des utilisateurs.

**Q8 — Habitudes Auto-i / Nextlane.** Réponse : « je ne sais pas encore. »
→ **RISQUE OUVERT, TRAITÉ COMME TEL.** Les lots A et B sont des améliorations sans regret et peuvent démarrer
immédiatement. Le lot D (menu à six entrées) reste **BLOQUÉ** jusqu'à une courte phase d'observation chez un
garagiste — regarder un utilisateur manipuler Auto-i ou Nextlane et noter les gestes réflexes. Couper le menu
sans connaître ce qui est réflexe court le risque d'une refonte qui doit être refaite.
*(Voir lot D, §5.)*
