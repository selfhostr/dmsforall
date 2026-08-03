# Exports fiduciaires — formats, cibles et questions ouvertes

> **Statut** : document de référence des **cibles d'export**. Il décrit ce que chaque adaptateur
> doit produire, et **ce qu'on ne sait pas encore**.
>
> **Règle de rédaction, non négociable pour ce document** : rien n'est écrit ici qui ne soit **sourcé
> ou explicitement marqué comme inconnu**. Un format supposé se découvre faux **au premier export
> réel** — c'est-à-dire devant le comptable du garage, au moment de la clôture. Une liste de
> questions justes vaut infiniment mieux qu'une spécification plausible.

| §                                                   | Contenu                                                             | Identifiants      |
| --------------------------------------------------- | ------------------------------------------------------------------- | ----------------- |
| [1](#1-principe-et-répartition-des-responsabilités) | Principe, ce que fait le cœur et ce que fait l'adaptateur           | `EF-01` → `EF-09` |
| [2](#2-winbiz--cible-prioritaire-du-pilote)         | **WinBIZ** — format établi et sourcé                                | `EF-10` → `EF-19` |
| [3](#3-ireach--aucun-format-établi)                 | **iReach** — ce qu'on sait, ce qu'on ignore, ce qu'il faut demander | `EF-20` → `EF-29` |
| [4](#4-csv-générique)                               | CSV générique — filet de sécurité                                   | `EF-30` → `EF-34` |
| [5](#5-cibles-différées)                            | Bexio, Banana — différées, pas abandonnées                          | `EF-35` → `EF-39` |
| [6](#6-récapitulatif-des-questions-à-poser)         | **Les questions à poser à @laupernoe et à ses fiduciaires**                | `EF-40`           |

---

## 1. Principe et répartition des responsabilités

**`EF-01`** — Le cœur produit des **écritures équilibrées et neutres** ; les adaptateurs les
**sérialisent** (`RF-101`, `RF-102`, `MD-84`). Aucun adaptateur ne calcule un montant, ne choisit un
compte, ni n'arrondit. C'est ce qui permet d'ajouter une cible sans toucher à la facturation — et
l'arbitrage A3, qui a fait entrer iReach et sortir Abacus **sans qu'une seule règle de §8 de la spec
ne bouge**, en est la première démonstration réelle.

**`EF-02`** — La tentation à refuser systématiquement : faire remonter une spécificité de cible dans
le cœur. « WinBIZ veut ce champ-là », « iReach n'accepte pas les décimales ». Céder une fois
transforme le cœur en somme des particularités de toutes les cibles connues, et le prochain export
révélera la suivante. **La particularité vit dans l'adaptateur, ou elle ne vit pas.**

**`EF-03` — Conversion des montants : au dernier moment, dans l'adaptateur.** Tout est en centimes
entiers jusqu'à la sérialisation (`RF-33`). C'est l'adaptateur, et lui seul, qui convertit
`56663` → `566.63` selon les conventions de sa cible (séparateur décimal, séparateur de milliers,
signe). Il **ne recalcule jamais** un montant à cette occasion.

**`EF-04` — Deux granularités, paramétrables par tenant et par cible** (`RF-106`, `MD-88`) :
`detaille` (une écriture par document puis par paiement) et `agrege` (jour × compte × taux). Trois
choses ne sont **jamais** agrégées (`RF-107`) : les taux de TVA entre eux, le compte de créances par
client, et les exercices.

**`EF-05` — Le mapping des comptes et des codes TVA est paramétrable par tenant et versionné par
dates** (`MD-86`, `RF-112`). On ne l'écrase jamais : on le clôt et on en ouvre un nouveau, sinon les
exports passés deviennent irreproductibles.

**`EF-06` — Aucun plan comptable n'est codé en dur.** Le plan comptable PME suisse sert de **défaut
proposé**, jamais d'hypothèse. C'est la fiduciaire qui impose ses comptes, et elle en change.

**`EF-07`** — Chaque lot transmis est conservé à vie avec son empreinte SHA-256 (`MD-91`), donc
reproductible à l'identique. Un document déjà exporté ne repart pas dans un autre lot sans action
d'exploitation tracée (`RF-109`).

**`EF-08` — La continuité des séries est vérifiée avant chaque export, de manière bloquante**
(`RF-28`, `RF-105`). Un trou ne part jamais chez une fiduciaire sans avoir été expliqué.

**`EF-09` — État de livraison, à ne pas surinterpréter.** Les codes d'erreur **`EXPORT_*`** sont
déclarés par avance dans le contrat partagé, **sans contrat HTTP complet derrière** — même parti
pris qu'au lot 1. De même, `CIBLES_EXPORT` contient `'ireach'` alors qu'**aucun format n'est
établi** pour cette cible. **Un code d'erreur déclaré et une valeur d'enum ne sont pas une
fonctionnalité livrée.** Ce paragraphe existe pour que personne n'en déduise le contraire.

---

## 2. WinBIZ — cible prioritaire du pilote

> **Niveau de preuve : élevé.** Format documenté publiquement par l'éditeur, **et** fichiers
> d'exemple officiels téléchargeables qui confirment la spécification. C'est un cas rare et
> confortable — mais voir `EF-19`, qui liste ce qui reste malgré tout à vérifier.

**`EF-10` — Éditeur et produit.** WinBIZ est édité par **FIDUCIAL WINBIZ SA** (Genève / Lausanne /
Martigny). Produit d'origine de La Gestion Electronique SA (Martigny, VS), racheté par le groupe
français Fiducial en 2013. _(Note : aucun lien avec Infoniqa, qui a racheté Sage Suisse — confusion
fréquente.)_

Documentation : <https://helpcenter.winbiz.ch>

**`EF-11` — Deux canaux d'import possibles, et le choix n'est pas neutre.**

| Canal                                              | Ce qu'il transporte                                                                                                    | Adapté à                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Import de documents** (`bizexdoc.csv` / `*.wdx`) | En-tête + adresse + lignes, avec TVA par ligne. Types `20` Facture débiteurs, `22` Note de crédit débiteur, `10` Offre | **Un DMS.** Correspond directement à la chaîne devis → facture → avoir |
| **Import d'écritures** (20 colonnes)               | Écritures comptables brutes, débit/crédit                                                                              | Une fiduciaire qui ne veut que du comptable                            |

**Recommandation : viser les deux, derrière la même interface `AccountingExporter`**, l'import de
documents comme chemin principal et l'import d'écritures comme repli. C'est la fiduciaire qui dira
lequel elle veut, et la question est en `EF-40`.

**`EF-12` — Conventions de fichier, communes aux deux canaux.** Établies par la documentation **et
confirmées par les fichiers d'exemple officiels** :

| Convention           | Valeur                        | ⚠️ Piège                                                                                                                                                                   |
| -------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Séparateur de champs | **`;`**                       | —                                                                                                                                                                          |
| Fin de ligne         | **CRLF**                      | Pas LF                                                                                                                                                                     |
| Encodage             | **Windows-1252 / ISO-8859-1** | **Pas UTF-8.** Le défaut naturel d'un backend Node est UTF-8 — c'est l'erreur à commettre en premier. Les `é`, `à`, `ü` des raisons sociales et des localités en dépendent |
| Format de date       | **`jj.mm.aaaa`**              | —                                                                                                                                                                          |
| Séparateur décimal   | **point** (`108.1`)           | Pas de virgule, pas de séparateur de milliers                                                                                                                              |
| Ligne d'en-tête      | Présente dans les exemples    | L'option « Importation du premier enregistrement » doit alors rester **décochée**                                                                                          |

**`EF-13` — Import d'écritures : les 20 champs, dans cet ordre.** La documentation précise
explicitement que **le nom des colonnes ne détermine pas le contenu — seul l'ordre fait foi.**

| #   | Nom          | Type      | Long. | Obligation                      |
| --- | ------------ | --------- | ----- | ------------------------------- |
| 1   | `Date`       | Date      | 10    | Obligatoire                     |
| 2   | `Pièce`      | Caractère | 10    | Facultatif                      |
| 3   | `Libellé`    | Caractère | 100   | Obligatoire                     |
| 4   | `Cpt_debit`  | Caractère | 12    | Obligatoire                     |
| 5   | `Cpt_credit` | Caractère | 12    | Obligatoire                     |
| 6   | `Montant`    | Numérique | 15,2  | Obligatoire                     |
| 7   | `Journal`    | Caractère | 1     | Facultatif                      |
| 8   | `ME_cours`   | Numérique | 12,6  | Obligatoire si devise étrangère |
| 9   | `ME_mnt`     | Numérique | 15,2  | Obligatoire si devise étrangère |
| 10  | `TVA_taux`   | Numérique | 5,2   | Obligatoire si TVA              |
| 11  | `TVA_mnt`    | Numérique | 15    | Obligatoire si TVA              |
| 12  | `TVA_cpt`    | Caractère | 1     | Obligatoire si TVA              |
| 13  | `TVA_typ`    | Numérique | 1     | Obligatoire si TVA              |
| 14  | `TVA_meth`   | Numérique | 1     | Obligatoire si TVA              |
| 15  | `TVA_soum`   | Numérique | 6,2   | Facultatif (défaut 100 %)       |
| 16  | `Ecr_monnai` | Numérique | 4     | **Ignoré à l'import**           |
| 17  | `Ecr_monqte` | Numérique | 6     | `0` si monnaie locale           |
| 18  | `Comment`    | Caractère | 80    | **Ignoré à l'import**           |
| 19  | `Ecr_ana`    | Caractère | 20    | N° de compte analytique         |
| 20  | `Ecr_vtcode` | Caractère | 20    | Code / chiffre TVA              |

Codes énumérés :

- **`Journal`** : `d` Divers · `s` Salaires · `a` Achats · **`v` Ventes** · `i` Inventaires ·
  `m` Amortissements · `o` Soldes initiaux · `b` Bouclement · `x` À extourner.
- **`TVA_cpt`** : `d` compte TVA au débit · `c` compte TVA au crédit.
- **`TVA_typ`** : `1` Pas de TVA · **`2` TVA due (à payer)** · `3` Impôt préalable · `4` Hors taxe.
- **`TVA_meth`** : `1` Brut · `2` Net.
- **`Ecr_vtcode`** : `<vt_code=xxx>` (code du type de TVA) ou `<vt_number=xxx>` (chiffre TVA).

Troncature autorisée : colonnes 1→6 ou 1→7 si ni devise ni TVA ; 1→9 + 16 et 17 si devises ;
**1→15 si TVA**, les colonnes de devise devant alors être présentes même vides. Les champs
facultatifs doivent **exister** mais peuvent être vides. `NULL` n'est pas fiable — utiliser la chaîne
vide ou zéro.

**`EF-14` — Deux limites structurelles de ce canal, à connaître avant de le choisir :**

1. **Écritures simples uniquement.** Les écritures multi-lignes ne sont pas importables par ce
   canal. Une écriture de facture qui débite un compte et crédite trois comptes de produits plus la
   TVA (`CF-04`) doit donc être **décomposée en écritures simples**, ou passer par l'import de
   documents. **C'est l'argument le plus fort en faveur du canal « documents ».**
2. **Renumérotation automatique** des écritures à l'import (mécanisme anti-doublon de WinBIZ). Notre
   numéro de pièce voyage dans le champ 2 `Pièce` — c'est lui qui assure la traçabilité de
   `RF-108`, pas le numéro d'écriture.

**`EF-15` — Exemple officiel de l'éditeur**, reproduit tel quel (fichier `ecr_standardv6.csv`,
en-tête + 2 lignes) :

```
date;pièce;libellé;cpt_débit;cpt_crédit;montant;journal;me_cours;me_mnt;tva_taux;tva_mnt;tva_cpt;tva_typ;tva_meth;tva_soum;Ecr_monnai;Ecr_monqte ;Comment ;Ecr_ana;Ecr_vtcode
01.02.2025;IMPSTD001;test reprise depuis type TVA;3000;1000;108.1;d;0;0;8.1;8.1;d;2;2;100;;;;;
01.02.2025;IMPSTD002;test reprise depuis type TVA;3000;1000;100;d;;;;;;;;;;;;;
```

**Ce que cet exemple prouve, sans interprétation** : le taux 8.1 % s'écrit littéralement **`8.1`**
(et non `810`, `8,1` ou `081`) ; la seconde ligne montre qu'on peut laisser tout le bloc TVA vide en
**conservant les séparateurs**.

**`EF-16` — Import de documents (`bizexdoc`) : structure.** CSV `;`, CRLF, Windows-1252, nom de
fichier `*.wdx` ou `bizexdoc.csv`. Spécification d'environ **159 champs**, structure
**dénormalisée** : chaque ligne porte en-tête + adresse + une ligne de document.

Types de document utiles à un garage : `10` Offre (= devis) · `12` Confirmation de commande ·
`14` Fiche de travaux (≈ OR) · `16` Bulletin de livraison · `18` Vente au comptant ·
**`20` Facture débiteurs** · **`22` Note de crédit débiteur (= avoir)** · `24` Paiements débiteurs ·
`60` Mouvements de stock.

**La correspondance avec la chaîne documentaire de DFA est directe** — `devis` → `10`,
`facture` → `20`, `avoir` → `22` — et c'est la seconde raison de préférer ce canal.

Champs TVA côté lignes : `61` taux % · `62` incluse/exclue (`0,1` incluse / `2` exclue) ·
`63` compte TVA · `64` méthode (`0,1` brut / `2` net) · `68` type/code/chiffre TVA · `72` arrondi
TVA (défaut `0` = 1 centime). Le champ `1` accepte la balise `<NEW>` (création avec numéro
automatique) ; les champs `11` et `12` acceptent `<AUTO>`.

> **`EF-16` a) — Point d'attention direct pour `RF-40`.** Le champ `62` distingue TVA **incluse** de
> TVA **exclue** au niveau de la ligne. Depuis l'arbitrage A1, **toutes** nos lignes sont en TVA
> incluse. L'adaptateur doit donc émettre systématiquement la valeur « incluse » — et le cas
> échéant, c'est le seul endroit de la chaîne où le mode de calcul de DFA se traduit vers l'extérieur.
> À vérifier au premier export réel : que WinBIZ recalcule bien un HT identique au nôtre au centime.

**`EF-17` — Codes TVA : il n'existe aucune liste universelle.** C'est le point le plus structurant
de tout ce paragraphe. Les « types de TVA » de WinBIZ sont **définis par l'utilisateur dans son
propre dossier comptable**, chacun portant un code unique librement saisi. Verbatim de la
documentation, champ 68 :

> « 1ère méthode : recommandée — Utiliser une balise reprenant le code unique de type TVA introduit
> dans Winbiz. Ex : `<VAT_CODE=ABC123>` […] Si cette méthode est utilisée, il n'est pas nécessaire de
> transmettre les informations dans les champs 61, 63 à 65 et 72. »
>
> « 2ème méthode : supportée mais dépréciée — 1 = Pas de TVA, 2 = TVA due, 3 = TVA en amont,
> 4 = TVA exclue. […] Cette méthode est fortement déconseillée. »

Le « chiffre TVA » (`<VAT_FIGURE=nnn>`, par ex. `220`, `300`) est un concept **distinct** : c'est le
chiffre du décompte AFC.

**Conséquence de conception, non négociable** : le mapping entre nos taux (81 / 26 / 38 ‰) et les
codes de types de TVA du dossier WinBIZ du garage **ne peut pas être codé en dur**. Il est saisi par
le garage ou sa fiduciaire, par tenant, et versionné (`EF-05`). C'est exactement ce que `MD-86`
prévoyait — la cible WinBIZ en fournit la justification concrète.

**`EF-18` — API.** Une méthode `ENTRIESIMPORT` existe, en `form-data` (`winbiz-method` =
`ENTRIESIMPORT`, `winbiz-file` = le CSV), documentée comme consommant **exactement le même format
CSV**, avec une **limite de 100 ko par fichier**. Méthodes sœurs documentées : `DocumentImport`,
`ChartOfAccounts`.

**Inconnu, et à demander** (`EF-40`) : l'URL de base réelle de l'endpoint, le schéma
d'authentification, les codes d'erreur, les conditions d'accès (option payante ? réservée
partenaires ?), et la couverture Classic vs Cloud. **Aucun SDK, aucun format XML, aucun accès base
documenté publiquement.**

**`EF-18` a) — La limite de 100 ko est une contrainte de conception**, pas un détail : un exercice
complet de garage la dépasse. Le découpage des lots doit en tenir compte dès la conception, et le
découpage doit rester **aligné sur les périodes comptables** (`RF-107` : jamais deux exercices dans
un lot).

**`EF-19` — Ce qui reste à vérifier sur WinBIZ, malgré une documentation de bonne qualité :**

| #   | Point                                                                         | Pourquoi ça compte                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Sémantique du champ `Montant` selon `TVA_meth` (brut / net) : TTC ou HT ?** | **Seul vrai bloquant technique.** L'exemple officiel montre `montant=108.1` avec `tva_mnt=8.1` et `tva_meth=2` (Net), ce qui suggère un montant TTC — mais aucune page ne l'énonce. **À trancher par un test sur un dossier réel, pas par la documentation.** Se tromper inverse le sens de chaque écriture |
| 2   | Codes des types de TVA du dossier du garage                                   | Non devinables (`EF-17`)                                                                                                                                                                                                                                                                                    |
| 3   | Plan comptable effectif du garage                                             | Comptes de CA par nature (main-d'œuvre, pièces, VN, VO), comptes TVA, compte collectif débiteurs                                                                                                                                                                                                            |
| 4   | Canal retenu : documents ou écritures ?                                       | Décide de l'essentiel de l'adaptateur (`EF-11`, `EF-14`)                                                                                                                                                                                                                                                    |
| 5   | Différences Classic / Cloud                                                   | Une seule est documentée (XLS/XLSX indisponibles en Cloud) ; le reste est inconnu                                                                                                                                                                                                                           |

**Élément favorable à signaler à @laupernoe** : WinBIZ dispose déjà d'**importateurs dédiés pour des
logiciels métier tiers** (Crésus, TCPOS, EasyTemp). L'intégration d'un logiciel tiers par fichier est
donc une pratique établie chez l'éditeur, et **obtenir un importateur dédié « dmsforall » est un
chemin réaliste** à explorer. WinBIZ traite par ailleurs nativement **camt.053 / camt.054** avec un
moteur de règles — utile à connaître pour l'articulation du rapprochement bancaire (phase 2).

---

## 3. iReach — aucun format établi

> ## ⛔ Aucun adaptateur iReach ne doit être écrit en l'état.
>
> **Il n'existe aucune spécification d'échange publique.** Ce paragraphe ne contient **aucun** nom de
> champ, aucune extension de fichier, aucune capacité produit supposée. Ce qui suit est soit sourcé,
> soit marqué comme inconnu.

**`EF-20` — La question préalable, qui prime sur toutes les autres.**

> ### « Qui utilise iReach — le garage, ou sa fiduciaire ? »

Les recherches identifient **iReach** comme un **DMS automobile** (Dealer Management System) édité
par **Automotive Systems** (Bornem, Belgique), présent en Belgique, au Luxembourg **et en Suisse**,
distribué en Suisse par **e-Car Distribution Sàrl** (indicatif fribourgeois). L'éditeur revendique
plus de 300 sites et 2 300 utilisateurs. **Le produit embarque son propre module de comptabilité**,
présenté par l'éditeur comme le module « le plus important » de l'application, avec l'argument que
les opérations se font automatiquement **sans intervention d'un comptable externe**.

**Si c'est bien ce produit, alors iReach n'est pas une cible d'export fiduciaire : c'est un DMS
concurrent** — c'est-à-dire, pour dmsforall, un sujet de **reprise de données** (`expert-migration-donnees`,
`docs/reprise-donnees.md`), pas un connecteur comptable. Ce sont deux chantiers différents, dans deux
étapes différentes, avec deux experts différents.

Les deux réponses possibles et leurs conséquences :

| Réponse                          | Ce que ça veut dire                                                                                         | Où va le travail                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Le garage utilise iReach**     | C'est son DMS actuel, celui que DFA remplace. Sa fiduciaire consulte la compta tenue **dans** iReach        | **Reprise de données**, étape de migration. **Aucun adaptateur d'export.** La fiduciaire aura besoin d'une **autre** cible — laquelle ? (`EF-40` Q4) |
| **La fiduciaire utilise iReach** | Cas surprenant — un DMS automobile chez un fiduciaire — mais pas impossible si elle est spécialisée garages | Adaptateur d'export à écrire, **après** obtention du format auprès de l'éditeur                                                                      |

**Tant que cette question n'est pas tranchée, tout développement est un pari.**

**`EF-21` — Ce qui est établi, avec sources.**

| Fait                                                                                                                                                                                               | Source                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| iReach est un DMS édité par Automotive Systems (Bornem, BE)                                                                                                                                        | <https://automotivesystems.be/fr/index.html>                                 |
| Présence Belgique / Luxembourg / **Suisse**, 300+ sites, 2 300+ utilisateurs                                                                                                                       | <https://www.automotivesystems.be/nl/index.html>                             |
| Classé ERP, intégration « On-Premise »                                                                                                                                                             | <https://www.brightanalytics.eu/integrations/ireach/>                        |
| ERP couvrant pre-sales, vente, service, CRM **et comptabilité**                                                                                                                                    | <https://www.autotechoutlook.com/automotive-systems>                         |
| Distributeur suisse : e-Car Distribution Sàrl. « Multisites et multi-société », « accès à une base de données SQL », « points d'accès facilitant les interfaces »                                  | <https://ecarsarl.com/ireach/>                                               |
| Le seul export cité par l'éditeur est **Microsoft Excel**                                                                                                                                          | pages FR et NL de l'éditeur                                                  |
| Un import comptable existe, via **« Comptabilité > Documents > importer des documents »**, en désignant un dossier de fichiers. Décrit par un **tiers** (INSYPRO / PlanManager), pas par l'éditeur | <https://faq.insypro.com/index.php?action=artikel&artlang=fr&cat=15&id=1151> |
| Dépôt de fichiers dans un répertoire prédéfini, chargé par iReach **la nuit suivante**                                                                                                             | <https://faq.insypro.com/index.php?action=artikel&artlang=nl&cat=28&id=788>  |

**`EF-22` — Ce qui est INCONNU, et qu'il ne faut pas combler par déduction :**

- **Le format des fichiers acceptés** : extension, structure, séparateur, encodage, noms de champs,
  ordre des colonnes. **Rien.** Le CSV mentionné dans les FAQ INSYPRO est le format de **sortie de
  PlanManager** — les mêmes articles existent pour Venice, Exact, Ciel, AccountView — **ce n'est pas
  une spécification iReach.**
- L'existence d'une API, d'un SDK, d'un format XML.
- La granularité attendue : écriture par facture, par document, ou journal agrégé.
- Le plan comptable et les codes TVA utilisés.
- La gestion des taux suisses (8.1 / 2.6 / 3.8), de la QR-facture, de Swissdec dans la version suisse.
- Les conditions d'accès aux données (licence, contrat, coût).
- Le mode de transmission : fichier déposé, API, accès base.

**`EF-23` — Aucune documentation développeur ni page « intégrations » n'a été trouvée** sur
`automotivesystems.be` ni `ecarsarl.com`. Aucun portail développeur, aucun manuel public.

**`EF-24` — Homonymes à écarter**, aucun n'étant suisse ni comptable : iReach Solutions (services
IT), i-Reach microlearning d'i-Context, I-Reach de MyKRIS (télécom, Malaisie), I-REACH de Teledac
(afficheurs). Les applications Google Play `be.automotivesystems.*` appartiennent bien, elles, à
l'éditeur belge.

**`EF-25` — Aucun logiciel comptable suisse nommé iReach n'a été trouvé.** Recherches en FR, DE et
EN, y compris restreintes au domaine `.ch` et au registre du commerce : aucune occurrence, ni comme
éditeur, ni comme module de WinBIZ / Abacus / Sage, ni comme portail client de fiduciaire.

**`EF-26` — Le repli, si la question reste sans réponse au moment du pilote** : le **CSV générique**
(§4). Une fiduciaire sait toujours reprendre un CSV, éventuellement à la main. C'est moins
confortable qu'un connecteur, et infiniment préférable à un connecteur qui produit un fichier que
personne ne peut lire.

---

## 4. CSV générique

**`EF-30`** — Le CSV générique est le **filet de sécurité** : il existe pour qu'aucune fiduciaire ne
soit bloquée faute de connecteur. Il n'est spécifique à aucun outil, et c'est sa raison d'être.

**`EF-31`** — Il expose les écritures dans leur forme neutre : date, numéro de pièce, libellé, compte
débit, compte crédit, montant, code TVA, base TVA, référence du document source (`RF-108`).

**`EF-32`** — Il supporte les **deux granularités** (`EF-04`). C'est à ce titre qu'il sert de
seconde cible à `CF-27` en attendant Banana.

**`EF-33`** — Conventions par défaut, **paramétrables par tenant** parce que chaque outil de reprise
a les siennes : UTF-8, séparateur `;`, dates ISO `aaaa-mm-jj`, décimales au point. **Le fait même
qu'elles soient paramétrables est la fonctionnalité** — un CSV générique rigide n'est pas générique.

**`EF-34`** — Il est le premier adaptateur à écrire après WinBIZ, parce qu'il est aussi le meilleur
**banc d'essai du cœur** : s'il est difficile à produire, c'est que les écritures ne sont pas assez
neutres, et le défaut est dans le cœur, pas dans l'adaptateur.

---

## 5. Cibles différées

> **Différées ≠ abandonnées.** Ces cibles restent au périmètre produit. Elles ne sont simplement pas
> nécessaires au **pilote**. Le travail déjà réalisé à leur sujet reste valable et **ne doit pas être
> supprimé** au motif qu'elles ne figurent pas dans `CIBLES_EXPORT`.

**`EF-35` — Bexio.** **La cible la plus fréquente du marché suisse PME**, avec une API publique
documentée. Aucune fiduciaire du pilote ne l'utilise, mais dmsforall vise plusieurs garages suisses
et Bexio reviendra. C'est la **première cible à écrire après le pilote**.

**`EF-36` — Banana.** Seule cible qui motivait originellement le mode `agrege`. Le **mode reste au
périmètre** (`EF-04`) : c'est une capacité du cœur, pas une particularité de Banana, et il est
exerçable dès maintenant via le CSV générique.

**`EF-37` — Abacus.** **Hors périmètre** (`RF-102`, §0.3 de la spec). L'adaptateur demandait un
agrément et un format à obtenir ; aucune fiduciaire du pilote ne l'utilise. À reconsidérer seulement
si un garage réel l'exige.

**`EF-38`** — Ajouter une cible différée ne demande **que** son adaptateur (`EF-01`). Si un jour ce
n'est plus vrai, c'est que `EF-02` a été violé quelque part, et c'est là qu'il faut regarder.

**`EF-39`** — L'enum `CIBLES_EXPORT` décrit **ce qui est livré** ; §5 de ce document décrit **ce qui
est prévu**. Les deux ne disent pas la même chose et ne doivent jamais être confondus (`EF-09`).

---

## 6. Récapitulatif des questions à poser

**`EF-40`** — À poser à @laupernoe, et par lui à ses fiduciaires. **Ordonnées par ce qu'elles débloquent**,
pas par ordre d'apparition.

### Bloquant absolu — avant toute ligne de code sur iReach

| #      | Question                                                                                        | Pourquoi elle prime                                                                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** | **Qui utilise iReach : le garage, ou sa fiduciaire ?**                                          | Décide s'il s'agit d'une **reprise de données** (DMS concurrent) ou d'un **adaptateur d'export**. Deux chantiers, deux étapes, deux experts (`EF-20`)                                     |
| **Q2** | Si c'est le **garage** : quel outil utilise alors sa fiduciaire pour tenir la compta ?          | C'est **cette** cible-là qu'il faut écrire, et elle n'est peut-être dans aucune de nos listes                                                                                             |
| **Q3** | Si c'est la **fiduciaire** : accepte-t-elle de demander la spécification d'import à l'éditeur ? | Contacts : Automotive Systems (helpdesk, Bornem BE) ou e-Car Distribution Sàrl (distributeur suisse). **Une demande de la fiduciaire aboutit mieux que la nôtre** — c'est elle la cliente |
| **Q4** | Le garage a-t-il **deux** fiduciaires, ou est-ce une fiduciaire et un DMS ?                     | « WinBIZ et iReach » est ambigu. Un garage à deux fiduciaires est inhabituel et changerait la conception du paramétrage (mapping par cible **et** par périmètre ?)                        |

### Si un échange iReach est confirmé — les cinq questions de format

| #      | Question                                                                                                                                                                          | Enjeu                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Q5** | **Quel format de fichier est accepté ?** Extension, structure, séparateur, encodage, jeu de caractères                                                                            | Rien ne peut être écrit sans cette réponse (`EF-22`)          |
| **Q6** | **Quelle granularité ?** Une écriture par facture, par document, ou un journal agrégé par période                                                                                 | Décide du mode `detaille` / `agrege` (`EF-04`)                |
| **Q7** | **Quel plan comptable ?** Comptes de CA par nature (main-d'œuvre, pièces, VN, VO), compte collectif débiteurs, comptes financiers par moyen de paiement, compte d'écart d'arrondi | `EF-06`, `QF-03`                                              |
| **Q8** | **Comment les taux de TVA sont-ils représentés ?** Codes propres au dossier, taux littéraux, chiffres AFC ? Et les régimes `exclu` / `exonere` ?                                  | `EF-17` montre que c'est **le** point où chaque outil diffère |
| **Q9** | **Quel mode de transmission ?** Dépôt de fichier dans un répertoire, envoi manuel, API, accès base                                                                                | Décide de l'exploitation autant que du code                   |

### WinBIZ — à confirmer avant le premier export réel

| #       | Question                                                                                                      | Enjeu                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Q10** | **Le champ `Montant` est-il TTC ou HT selon `TVA_meth` brut/net ?**                                           | **Seul vrai bloquant technique de WinBIZ** (`EF-19`). À trancher **par un test sur dossier réel**, pas par la documentation |
| **Q11** | La fiduciaire préfère-t-elle l'import de **documents** (`bizexdoc`, types 20/22) ou d'**écritures** ?         | Décide de l'essentiel de l'adaptateur (`EF-11`, `EF-14`)                                                                    |
| **Q12** | Quels sont les **codes de types de TVA** du dossier du garage, et leur chiffre AFC ?                          | Non devinables, propres à chaque dossier (`EF-17`)                                                                          |
| **Q13** | Quel est le **plan comptable effectif** du garage ?                                                           | `EF-06`                                                                                                                     |
| **Q14** | WinBIZ **Classic ou Cloud** ? Et l'API est-elle accessible (URL, authentification, conditions commerciales) ? | `EF-18`                                                                                                                     |
| **Q15** | La fiduciaire accepterait-elle de demander à Fiducial WinBIZ un **importateur dédié « dmsforall »** ?         | L'éditeur en fournit déjà pour Crésus, TCPOS, EasyTemp — le chemin est établi (`EF-19`)                                     |

### Transverse

| #       | Question                                                                                                        | Enjeu                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Q16** | Confirmer que la méthode de calcul de TVA de DFA (`Σ` des TVA de ligne, `RF-35`) convient aux deux fiduciaires  | `QF-01`. **C'est elle qui devra vivre avec l'écart.** À poser en montrant `CF-03`                                              |
| **Q17** | Confirmer le traitement des acomptes (facture d'acompte ou encaissement) selon la méthode de décompte du garage | `QF-02`. `CF-07` et `CF-23` chiffrent les deux branches — **la discussion part de deux jeux de chiffres, pas d'une intuition** |
| **Q18** | Monotonie des dates : bloquante ou simple avertissement ?                                                       | `QF-09`. **Volontairement non tranchée**, et aucun code d'erreur n'a été créé pour ne pas préjuger de la réponse               |

---

## Ce que ce document n'affirme pas

Par honnêteté sur son statut :

- **WinBIZ est sourcé** : documentation publique de l'éditeur **et** fichiers d'exemple officiels
  concordants. C'est la partie de ce document sur laquelle on peut coder. `EF-19` liste néanmoins
  cinq points à confirmer, dont un bloquant réel (le sens du champ `Montant`).
- **iReach n'est pas spécifié, et ne doit pas l'être par déduction.** Ce qui est écrit à son sujet
  est sourcé ou marqué inconnu. **Aucun champ, aucune extension, aucune capacité produit n'a été
  supposé.** L'hypothèse dominante — qu'il s'agit d'un DMS concurrent et non d'un outil de
  fiduciaire — est étiquetée comme telle et **doit être confirmée par @laupernoe** (`EF-20`).
- **Les questions de `EF-40` sont l'essentiel de ce document**, pas son annexe. Y répondre coûte un
  appel téléphonique ; y répondre après le premier export raté coûte la confiance du comptable du
  garage, au moment de la clôture.
