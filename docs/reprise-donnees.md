# Reprise des données — méthode, mapping et bascule

> Périmètre : extraction, mapping, qualité, chargement et bascule des données d'un garage depuis
> son DMS actuel (Auto-i, Nextlane, logiciel local, tableurs) vers dmsforall.
> Public : @laupernoe (terrain), expert-database, expert-facturation, expert-devops.
> Statut : **méthode de référence**. Elle ferme la question ouverte d'`ARCHITECTURE.md §7`
> (« modalités d'export inconnues ») en donnant le protocole d'investigation, pas la réponse :
> la réponse s'obtient garage par garage, sur place.
> Conventions : `D-xx` = décision de reprise · `N-xx` = règle de nettoyage/qualité ·
> `CR-xx` = contrôle de recette exécutable par le garagiste · `QG-xx` / `QE-xx` = question au
> garagiste / à l'éditeur · `R-xx` = risque juridique ou contractuel.
> Les prefixes sont distincts de ceux de la spécification étape 1 (`RM`, `CT`, `P`, `Q`) : aucune
> collision de référence.

---

## Sommaire

0. [Ce que ce document ne peut pas dire](#0-ce-que-ce-document-ne-peut-pas-dire)
1. [Plan d'investigation](#1-plan-dinvestigation)
2. [Mapping vers le modèle DFA](#2-mapping-vers-le-modèle-dfa)
3. [Ce qu'on ne reprend pas](#3-ce-quon-ne-reprend-pas)
4. [Traitement de la qualité](#4-traitement-de-la-qualité)
5. [Conception technique de l'import](#5-conception-technique-de-limport)
6. [Plan de bascule](#6-plan-de-bascule)
7. [Questions et risques](#7-questions-et-risques)
8. [Décisions à prendre et prochaines actions](#8-décisions-à-prendre-et-prochaines-actions)
9. [Ordre de bascule et graphe de dépendances](#9-ordre-de-bascule-et-graphe-de-dépendances)
10. [Contraintes réelles de la destination](#10-contraintes-réelles-de-la-destination)
11. [Pièges de correspondance — les cas du terrain suisse](#11-pièges-de-correspondance--les-cas-du-terrain-suisse)
12. [La ligne de coupe et sa preuve](#12-la-ligne-de-coupe-et-sa-preuve)
13. [Runbook du jour J et marche arrière](#13-runbook-du-jour-j-et-marche-arrière)
14. [Zones aveugles — ce que seul le terrain peut donner](#14-zones-aveugles--ce-que-seul-le-terrain-peut-donner)

---

## 0. Ce que ce document ne peut pas dire

Il faut le poser d'entrée, parce que la tentation inverse fait échouer les migrations.

**Je n'ai vu aucun export réel.** En conséquence :

- **Aucun nom de table, de colonne ou de fichier d'Auto-i ou de Nextlane n'apparaît dans ce
  document comme une donnée établie.** Les colonnes « source » des tableaux de mapping décrivent
  des **rôles fonctionnels** (« le champ qui porte le nom du client »), pas des identifiants
  réels. Toute personne qui écrit un connecteur à partir de ce document doit d'abord remplir la
  colonne source avec ce qu'elle a vu.
- Je ne sais pas si ces produits stockent en base relationnelle serveur, en base fichier locale,
  ou s'ils sont hébergés par l'éditeur. **Le nom commercial d'un DMS ne détermine pas son moteur
  de stockage** : les éditeurs consolident des produits d'origines différentes (Nextlane est un
  agrégat d'éditeurs européens rachetés), et deux garages utilisant « le même » logiciel peuvent
  tourner sur deux générations techniques différentes. C'est pourquoi la §1 est une méthode
  d'empreinte, pas une fiche produit.
- Je ne sais pas s'il existe une fonction d'export intégrée, ni ce qu'elle produit. C'est la
  **première chose à vérifier**, avant toute idée d'extraction directe (§1.5).
- Les ordres de grandeur de volumétrie donnés en §1.4 sont des **hypothèses de dimensionnement**
  pour préparer le matériel et les délais, pas des mesures.

Ce que ce document donne, en revanche, est indépendant du format source : la méthode
d'investigation, le modèle cible et ses pertes structurelles, les règles de qualité (elles
dépendent des données, pas du logiciel), l'architecture d'import (elle dépend de DFA) et le plan
de bascule.

**État du dépôt — mise à jour du 29.07.2026.** La destination n'est plus un plan : elle est en
base. `client` et ses satellites (`0006_clients.sql`), `vehicule` et les siens
(`0007_vehicules.sql`), `ordre_reparation` et `ligne_or` (`0008`), `document_vente`,
`ligne_document`, `document_vente_tva`, `paiement` (`0010_facturation.sql`) existent, avec leurs
contraintes, leurs triggers et leur RLS.

Trois conséquences, qui changent la nature de ce document :

1. **Le mapping de la §2 n'est plus une intention, il est vérifiable.** Certaines cibles qu'il
   nommait n'existent pas sous ce nom (`numero_ide` → `ide`), d'autres sont plus contraintes que
   prévu (`vehicule.marque`/`modele` sont `NOT NULL`). La **§10 corrige le mapping champ à champ
   contre le schéma réel** et prime sur la §2 partout où les deux divergent.
2. **La demande transmise à `expert-facturation` (§8.2) a été honorée.** `document_vente` porte
   `origine enum('dfa','reprise')`, `numero_origine`, `tva_non_ventilee`, `taux_tva_pourmille` au
   niveau document, `ecart_reprise_centimes`, un type de ligne `ecart_reprise`, un index unique
   `document_vente_numero_origine_uk` et un motif de bulletin `creance_reprise`. **La reprise n'a
   donc pas besoin de la table `document_repris` esquissée en §5.6** : une facture reprise est un
   `document_vente` comme un autre, avec `origine = 'reprise'`. La §10.4 remplace la §5.6.
3. **Les triggers d'immuabilité s'appliquent aussi à l'import.** Il n'existe aucune porte dérobée
   « mode migration ». L'import écrit avec les mêmes privilèges que l'API et se plie aux mêmes
   machines à états — ce qui impose un ordre d'écriture précis, décrit en §9 et §10.4.

Ce qui reste inconnu est inchangé : **la source**. Le mapping a maintenant une extrémité solide et
une extrémité vide.

---

## 1. Plan d'investigation

> Objectif d'un passage chez un garage : repartir avec une **fiche d'inventaire remplie** (§1.4)
> et, si possible, un **échantillon de 20 lignes par entité**. Pas avec une impression.
>
> 📋 **Version imprimable et exécutable** : [reprise-donnees-questionnaire.md](reprise-donnees-questionnaire.md)
> — checklist de départ, commandes d'empreinte, les **12 requêtes de profilage**, la fiche
> d'inventaire, le texte de la demande d'export à l'éditeur et les 6 questions à poser devant
> l'écran. C'est ce document-là qu'on emporte ; celui-ci est la méthode qui le justifie.

### 1.1 Avant le déplacement

| # | À faire | Pourquoi |
|---|---|---|
| 1 | Obtenir du garagiste un **mandat écrit** (une page) autorisant l'inspection en lecture de ses systèmes et le traitement de ses données à des fins de migration | C'est la base juridique de tout ce qui suit (§7, `R-05`). Sans ce papier, l'inspection est une intrusion, même avec les mots de passe. |
| 2 | Demander le **contrat de licence** du DMS actuel (PDF) | Durée, reconduction tacite, préavis, clause de réversibilité, interdiction d'accès tiers. Le contrat décide de la date de bascule (`R-01`). |
| 3 | Demander les **coordonnées du support éditeur** et l'identifiant client du garage | La demande d'export officielle part du garage, pas de @laupernoe (§1.5). |
| 4 | Prévoir : disque externe chiffré, `age` ou 7-Zip AES-256, un poste dédié, un carnet | La donnée personnelle ne transite ni par e-mail, ni par WeTransfer, ni par un cloud non suisse (§5.7). |

### 1.2 Sur place — identifier le moteur de base sans rien casser

**Règle absolue de l'inspection : lecture seule.** On n'installe rien, on ne modifie aucune
configuration, on n'arrête aucun service, on ne lance aucune requête lourde en heures d'ouverture.
Le garage doit pouvoir facturer à la seconde où on repart.

**Étape A — le logiciel se présente lui-même.**
Menu « ? » / « Aide » / « À propos » : nom exact du produit, **numéro de version**, éditeur,
parfois le nom du serveur de base. Photographier l'écran. Menus « Outils », « Administration »,
« Maintenance », « Fichier » : chercher **Export**, **Extraction**, **Sauvegarde**, **Requêtes**,
**Éditeur d'états**, **Impression liste**. Photographier chaque boîte de dialogue d'export avec
ses options de format.

**Étape B — où sont les données.**
Sur le poste ou le serveur qui héberge :

```
# Processus et services en cours (Windows) — quel moteur tourne
tasklist /svc
Get-Service | Where-Object { $_.Status -eq 'Running' } | Sort-Object DisplayName

# Ports d'écoute — le moteur se trahit par son port
netstat -ano | findstr LISTENING

# Sources ODBC déclarées — souvent le chemin le plus court vers la chaîne de connexion
odbcad32.exe          # onglets « Sources de données système » + « Pilotes »
reg query "HKLM\SOFTWARE\ODBC\ODBC.INI" /s

# Répertoire d'installation : inventaire des extensions et des tailles, sans rien ouvrir
Get-ChildItem -Recurse "C:\<repertoire_du_dms>" |
  Group-Object Extension |
  Sort-Object { ($_.Group | Measure-Object Length -Sum).Sum } -Descending |
  Select-Object Name, Count, @{n='Mo';e={[math]::Round(($_.Group|Measure-Object Length -Sum).Sum/1MB,1)}}
```

**Étape C — lire l'empreinte.** Table de correspondance (extensions, ports, services) → moteur
probable. Elle sert à orienter, elle ne conclut pas seule ; on croise toujours deux indices.

| Indice fichier | Port typique | Moteur probable | Accès en lecture |
|---|---|---|---|
| `.mdf` + `.ldf` | 1433 | Microsoft SQL Server (ou Express) | SSMS / `sqlcmd`, compte en lecture seule |
| `.db` + `.log` | 2638 | SAP/Sybase SQL Anywhere | `dbisql`, driver ODBC fourni |
| `.fdb` / `.gdb` | 3050 | Firebird / InterBase | `isql-fb`, FlameRobin |
| `.dat`/`.btr` + `FILE.DDF`, `FIELD.DDF`, `INDEX.DDF` | 1583 | Btrieve / Pervasive / Actian Zen | ODBC via les DDF ; sans DDF, dictionnaire absent |
| `.dbf` + `.cdx`/`.ntx` | — (fichiers partagés) | dBase / FoxPro / Clipper | lecture directe (Python `dbfread`, ODBC) |
| `.mdb` / `.accdb` | — | Access / JET | ODBC, ou Access en lecture seule |
| `.dbf` + `.ora`, `tnsnames.ora` | 1521 | Oracle | `sqlplus`, compte en lecture seule |
| `.frm`/`.ibd` ou `base/` + `pg_wal/` | 3306 / 5432 | MySQL/MariaDB ou PostgreSQL | client standard |
| `.d` + `.b1` + `.lg` | — | Progress OpenEdge | `sqlexp`, souvent verrouillé par licence |
| Aucun fichier local, seulement un client léger / navigateur / RDP | 443 | **Hébergé par l'éditeur** | Aucun accès direct — tout passe par la §1.5 |

> **Le cas « hébergé »** est le plus contraignant et le plus fréquent sur les offres récentes :
> il n'y a rien à inspecter, la donnée est chez l'éditeur, et la seule voie est la demande
> formelle d'export. Le détecter tôt change tout le calendrier (`R-02`).

**Étape D — le dictionnaire.** Si un moteur relationnel est accessible en lecture, la
structure se lit dans son catalogue (`INFORMATION_SCHEMA.COLUMNS` sur SQL Server / SQL Anywhere /
MySQL / PostgreSQL ; `RDB$RELATION_FIELDS` sur Firebird ; les DDF sur Pervasive). On exporte le
**catalogue seul** (noms de tables, colonnes, types, nombres de lignes) — c'est ce qui permet de
préparer le mapping sans emporter une seule donnée personnelle. Le catalogue n'est pas de la
donnée client : c'est le seul artefact qu'on peut sortir sans précaution nLPD (mais avec
précaution contractuelle, cf. `R-04`).

**Étape E — comptage non intrusif.**

```sql
-- Volumétrie par table, sans scanner les données (statistiques du catalogue)
-- SQL Server
select t.name, p.rows from sys.tables t
  join sys.partitions p on p.object_id = t.object_id and p.index_id in (0,1)
 order by p.rows desc;
-- PostgreSQL
select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc;
```

Sur une base fichier sans catalogue de statistiques, on compte avec un `count(*)` **hors heures
d'ouverture**, ou on estime par la taille des fichiers.

### 1.3 Estimer la qualité sans emporter les données

Trois requêtes de profilage par entité, exécutées sur place, dont **seuls les compteurs
ressortent** (pas les valeurs) :

1. **Remplissage** — pour chaque colonne candidate : `count(*)`, `count(colonne)`,
   `count(distinct colonne)`, `min`, `max` sur les dates et les montants.
   Verdict immédiat : une colonne remplie à 12 % n'est pas une colonne, c'est un champ libre
   qu'un employé a utilisé trois mois en 2016.
2. **Vitalité** — répartition des clients et des véhicules par **année du dernier document**.
   C'est le chiffre qui décide du périmètre de reprise (`D-01`) : typiquement une longue traîne
   inactive depuis 8 ans qui représente la moitié du fichier.
3. **Cohérence** — nombre de doublons potentiels (`group by` sur nom normalisé, sur e-mail, sur
   téléphone, sur VIN), nombre de véhicules sans VIN, nombre de plaques portées par plus d'un
   véhicule, nombre de documents dont la somme des lignes diffère du total stocké.

Ces neuf chiffres tiennent sur une page et suffisent à chiffrer la migration. Ils sont aussi le
premier argument commercial honnête : « vous avez 8 200 fiches clients, dont 3 100 actives sur
5 ans et environ 600 doublons — on reprend 3 100 fiches propres, pas 8 200 fiches douteuses ».

### 1.4 La fiche d'inventaire à rapporter

À remplir **par garage**, une fois. Elle devient l'entrée du projet de migration.

```
GARAGE ............................ tenant DFA (slug) ...........................
DMS ......................... version .............. éditeur .....................
Hébergement : [ ] serveur local  [ ] poste unique  [ ] hébergé éditeur  [ ] RDP/Citrix
Moteur identifié ..................... indices retenus ...........................
Accès obtenu : [ ] lecture seule base  [ ] export applicatif  [ ] aucun
Sauvegarde : fréquence ......... support ......... restauration testée le .........
Contrat : échéance ......... préavis ......... reconduction tacite [ ] oui [ ] non
Clause de réversibilité : [ ] oui  [ ] non  [ ] à vérifier          Frais d'export : ...

VOLUMÉTRIE                    total    dont actifs 5 ans    remarques
  Clients .................. ......    ...............
  Véhicules ................ ......    ...............
  Détentions historisées ... ......    (existe ? oui/non)
  Articles / pièces ........ ......    ...............
  Factures (par année) ..... ......    ...............
  Avoirs ................... ......
  Devis .................... ......
  OR / historique atelier .. ......
  RDV ...................... ......
  Documents PDF joints ..... ......    volume Go .......

QUALITÉ (compteurs)
  Doublons clients probables ......   Véhicules sans VIN ......
  Plaques multi-véhicules ......      Documents à total incohérent ......
  Encodage constaté ..................  Format de date constaté ..............
  TVA : [ ] par ligne  [ ] globale par document  [ ] absente

ANNÉES D'HISTORIQUE RÉELLEMENT CONSULTÉES par le garage : ......
ARCHIVES PAPIER / PDF existantes : ..............................................
FIDUCIAIRE ........................ ce qu'elle reçoit ...........................
PARTICULARITÉS (dépôt pneus, flottes, leasing, garanties, multi-sites) ..........
```

**Pièces à rapporter avec la fiche** : photo de l'écran « À propos », photos des dialogues
d'export, capture d'`odbcad32`, export du catalogue de la base (structure seule), export
d'échantillon de 20 lignes par entité si autorisé, **une facture papier récente + son PDF**
(elle sert de référence de recette, `CR-04`), le contrat de licence.

### 1.5 Obtenir l'export — l'ordre des tentatives

**D-00 — On demande toujours l'export officiel en premier, par écrit, même si l'accès direct
est possible.** Deux raisons : la trace écrite protège le garage et @laupernoe (`R-04`), et la réponse
de l'éditeur — y compris son silence — est une information contractuelle utile.

| Rang | Voie | Ce qu'on en attend | Limite |
|---|---|---|---|
| 1 | **Export applicatif** intégré (menu du logiciel) | CSV/XLSX par entité, parfois complet | Souvent partiel : les entêtes sans les lignes, les clients sans les consentements |
| 2 | **Demande formelle à l'éditeur**, signée par le garage, avec délai (30 jours) et référence à la clause de réversibilité si elle existe | Export complet + dictionnaire | Payant, lent, parfois refusé ; le refus écrit est en soi un argument |
| 3 | **Éditeur d'états / générateur de requêtes** interne au logiciel | Extraction fidèle au modèle métier de l'outil, sans toucher la base | Fastidieux, une requête par entité |
| 4 | **Lecture directe de la base**, en lecture seule, **sur une copie restaurée d'une sauvegarde**, jamais sur la production | Complétude maximale | Zone grise contractuelle (`R-04`) ; exige le mandat écrit |
| 5 | **Impression PDF de masse** (listes clients, journal des factures) | Dernier recours ; alimente l'archive froide (`D-14`), pas l'import structuré | Non structuré ; l'OCR d'une facture n'est pas une facture |

**Toujours travailler sur une copie restaurée.** L'extraction se fait sur une restauration de la
sauvegarde de la veille, sur un poste isolé. On ne se connecte jamais au moteur de production
pour extraire, même en lecture : un `count(*)` sur une base fichier verrouille des pages, et le
jour où le DMS plante à 8h05 pendant qu'on lit sa base, c'est perdu pour tout le monde —
indépendamment de la responsabilité réelle.

---

## 2. Mapping vers le modèle DFA

> Toute case « Perte / approximation » de cette section est un point à **annoncer au garagiste
> avant la bascule**, pas à découvrir avec lui après. Une perte annoncée est un choix ; la même
> perte découverte est une faute.
>
> ⚠️ **Cette section a été écrite contre le modèle *spécifié*. Le schéma *réel* est en base depuis
> les migrations 0006 à 0010 et diffère sur une dizaine de points.** Les intentions ci-dessous
> restent valables ; les **noms de colonnes, les nullabilités et les contraintes qui font échouer
> un `INSERT` sont donnés en §10**, qui prime en cas de divergence. Ne pas écrire un chargeur à
> partir de la seule §2.

### 2.1 Client → `client` (+ adresses, contacts, conditions, consentements)

| Rôle du champ source | Cible DFA (spec §7.1) | Transformation | Perte / approximation |
|---|---|---|---|
| Identifiant interne | `correspondance_reprise.cle_source` (§5.3) | conservé tel quel, jamais comme clé métier | — |
| Numéro client | `numero_origine` (nouveau champ) | conservé ; **ne consomme pas** `compteur_document` (§5.5) | Le numéro DFA (RM-11) sera différent si le format source est incompatible → deux numéros coexistent, le garagiste doit savoir lequel il lit |
| Nom / raison sociale, prénom, civilité | `type`, `nom`, `prenom`, `raison_sociale`, `civilite` | **Séparation particulier/entreprise déduite** (§4.2) | ⚠ **Perte majeure** : la plupart des systèmes anciens ont un seul champ « nom ». Le type est déduit, jamais certain. RM-01 rend le type immuable → une erreur de déduction coûte une refiche + fusion. Décision : en cas de doute, `particulier` + drapeau « type à confirmer » |
| Adresse (rue, NPA, localité, pays) | `adresse` type `principale` | normalisation NPA/pays | Les adresses de facturation et de livraison distinctes (RM-03) n'existent quasiment jamais → **une seule adresse importée**, type `principale`. Si une 2e adresse existe, elle devient `facturation` |
| Téléphones (fixe, mobile, pro, autre) | `telephone`, `mobile` + `telephone_source` | normalisation E.164 CH (§4.6) | Les systèmes anciens ont souvent 4 champs téléphone non typés → l'attribution fixe/mobile est déduite du préfixe (`07x` = mobile) ; les numéros non parsables sont conservés bruts, jamais supprimés |
| E-mail | `email` | minuscules, validation syntaxique | Adresses multiples séparées par `;` ou `/` dans un champ unique → on garde la première, les autres partent en note interne |
| Langue de correspondance | `langue` | mapping code source → `fr`/`de`/`it` | ⚠ Souvent absente. **Défaut = langue du tenant**, et non « français » en dur. Sur un garage bilingue, c'est une source d'erreur visible par le client final (facture dans la mauvaise langue) → à faire vérifier sur les 50 plus gros clients (`CR-08`) |
| N° IDE / TVA client | `numero_ide` | validation format `CHE-xxx.xxx.xxx` | Rarement rempli ; sert la déduplication entreprise quand il existe |
| Rabais MO / pièces / pneus, taux horaire spécifique | `condition_commerciale` | **une seule ligne, `valide_du` = date de bascule** | ⚠ **Perte structurelle assumée** : les conditions du source ne sont pas datées. On ne peut donc **pas** justifier a posteriori le rabais d'un OR de 2023 (RM-07). Conséquence acceptée : les documents repris portent leurs montants figés, ce qui suffit au litige ; c'est la *justification par la règle* qui est perdue, pas le montant |
| Délai / mode de paiement | `condition_commerciale` | mapping de codes | Codes maison (« 30J FDM », « CPT ») → table de correspondance à construire avec le garagiste |
| Statut (actif/bloqué) | `statut` | mapping | Le « bloqué » du source recouvre parfois « ne plus démarcher » et parfois « impayé ». À trancher avec le garagiste, sinon `actif` + note d'alerte |
| Consentements marketing | `consentement` | **non repris — remis à zéro** (`D-11`) | ⚠ **Choix nLPD délibéré**, cf. §5.7 |
| Notes libres | `note` type `interne` | conservé brut | ⚠ Les notes contiennent fréquemment des données critiques non structurées (le vrai numéro de portable, « ne pas facturer avant accord de M. X »). Elles sont importées **intégralement** et **relues** : c'est la seule façon de ne pas perdre l'information tacite du garage |
| Groupe / maison mère | `groupe_client` | si la relation existe | Souvent inexistante → non reprise, à ressaisir (rarement plus de 5 cas) |
| PO obligatoire (RM-14) | `po_obligatoire` | si le champ existe | Sinon `false` ; à identifier avec le garagiste sur ses flottes |

### 2.2 Véhicule → `vehicule` (+ plaques, détentions, kilométrages, expertises)

| Rôle du champ source | Cible DFA (spec §7.2) | Transformation | Perte / approximation |
|---|---|---|---|
| VIN | `vin` | majuscules, suppression des espaces, validation 17 car. + refus I/O/Q (RM-15) | Les VIN courts (avant 1981, imports) passent avec avertissement, pas en rejet |
| Plaque | `plaque` (historisée) | découpage canton + numéro, `du` reconstruit, `actif` | ⚠ **Historique de plaque quasi jamais présent** : une seule plaque active importée, `du = null` ou reconstruit depuis le plus ancien document du véhicule. Le cas « c'était la VD 123456 à l'époque » n'est donc pas couvert pour l'avant-bascule (§4.4) |
| Marque / modèle / version | `marque_id`, `modele`, `version` | rapprochement au référentiel marque global ; **non rapproché ⇒ texte conservé** | ⚠ Un rapprochement automatique flou sur le libellé marque (« VW », « Volkswagen », « V.W. ») est faisable ; sur le modèle, non. Le modèle reste **texte** tant que l'étape 4 n'apporte pas de référentiel |
| Code type CH | `code_type_ch` | conservé | Souvent absent → champ vide, à compléter au premier passage atelier |
| 1re mise en circulation | `date_premiere_mise_en_circulation` | parsing de date (§4.5) | Base des calculs de garantie et d'expertise → une date fausse produit une relance MFK fausse. Contrôle : refuser toute date antérieure à 1900 ou postérieure à aujourd'hui |
| Motorisation, couleur, poids, places, pneus, huile, batterie, code radio | attributs `vehicule` | conservé si présent | Reprise « au mieux » : ces champs sont un confort de comptoir, pas une donnée critique. Leur absence ne bloque rien |
| Propriétaire actuel | `detention` (`du`, `au`, `motif_fin`) | **reconstruction** (§4.4) | ⚠ **Perte majeure et structurelle.** Le source ne connaît en général qu'un propriétaire courant. L'historique de détention (RM-20) est reconstruit depuis les documents : `du` = date du plus ancien document liant ce client à ce véhicule. Les propriétaires antérieurs qui n'ont plus de document repris sont **perdus** |
| Leaser / propriétaire économique | `proprietaire_economique` | si le champ existe | Souvent noyé dans une note → non repris automatiquement |
| Kilométrage courant | `kilometrage` (historisé) | 1 relevé, `source = 'import'` | ⚠ La série historique est reconstruite depuis les OR/factures **si** le km y figure ; sinon un seul point. Conséquence : la détection de rollback (RM-24) et le calcul d'échéance d'entretien démarrent quasiment de zéro. À dire au garagiste : « les alertes d'entretien seront justes à partir du 2e passage » |
| Dernière / prochaine expertise | `expertise` | date + `source = 'import'` | Le résultat, les défauts et le délai de contre-visite sont rarement stockés → une seule ligne d'expertise, sans détail. Suffit pour la relance (RM-29), pas pour l'historique de défauts |
| Garantie constructeur | `garantie` | dates + plafond km si présents | Souvent calculée à la volée dans le source, donc absente des données → **reconstruite** depuis la 1re mise en circulation + durée paramétrée par marque, avec la mention « estimée » |
| Campagnes ouvertes | `campagne` | si le champ existe | Rarement stocké côté DMS (il vit dans le portail constructeur) → non repris |
| Travaux reportés | `travail_reporte` | depuis les lignes d'OR refusées/reportées **si** l'historique atelier est repris | Si l'historique atelier n'est pas repris (`D-08`), les travaux reportés sont perdus. C'est un vrai manque à gagner commercial → argument pour reprendre au moins les 24 derniers mois d'OR |
| Statut / archivé | `statut` | mapping | — |

### 2.3 Articles → `article` (étape 3)

**D-02 — Le catalogue fournisseur ne se reprend pas ; le stock physique se recompte.**

| Rôle du champ source | Cible DFA | Transformation | Perte / approximation |
|---|---|---|---|
| Référence | `reference` | trim, majuscules | Clé source naturelle. Attention aux références retapées avec des espaces ou des tirets variables (`04E-905-110`, `04E905110`) → normalisation obligatoire, sinon doublons |
| Désignation | `designation_fr` | encodage (§4.1) | ⚠ Une seule langue disponible → `designation_de` / `designation_it` vides. Sur un garage alémanique, la désignation source est en allemand : mapper vers `designation_de`, pas vers `designation_fr` |
| Prix d'achat / vente | `prix_*_centimes` | conversion centimes stricte (§4.6) | Non datés → une seule valeur, valide à partir de la bascule. Les documents repris gardent leurs propres prix figés, donc aucune incohérence sur l'historique |
| Taux TVA | `taux_tva_pourmille` | code source → taux réel (§4.7) | Un « code TVA 1 » n'a de sens qu'avec la table des codes du source. Si elle est inaccessible : **taux déduit de l'année du document**, jamais du taux courant |
| Emplacement, seuil, quantité | `stock` | **non repris** (`D-03`) | Voir §3 |
| Équivalences / références remplacées | `article_equivalence` | si présent | Rarement structuré → non repris |

### 2.4 Documents de vente → archive documentaire + créances ouvertes

C'est la partie la plus sensible : une facture a une valeur légale et une durée de conservation
(§7, `R-06`). Deux traitements distincts, et il ne faut jamais les confondre.

**D-04 — Une facture reprise n'est jamais recalculée.** On importe les montants tels qu'ils ont
été émis, y compris s'ils sont arithmétiquement discutables. Recalculer produirait un document
différent de celui que le client détient sur papier — c'est-à-dire un faux, exploitable contre le
garage en cas de litige. Un écart entre la somme des lignes et le total stocké est **signalé**
(`N-09`), jamais corrigé.

**D-05 — Deux destinations selon l'état du document.**

| État du document source | Destination DFA | Raison |
|---|---|---|
| Facture soldée, exercice clos | **Archive documentaire** (`document_repris`, lecture seule, §5.6) | Valeur de consultation et de litige. N'a aucune raison d'entrer dans le flux vivant |
| Facture ouverte (impayée, partiellement payée) | **Document de vente repris** dans la chaîne étape 2, verrouillé, `origine = 'reprise'` | Le garage doit pouvoir encaisser, relancer et lettrer dessus |
| Avoir rattaché à une facture reprise | Suit sa facture | La chaîne facture→avoir doit rester lisible |
| Devis accepté non encore transformé | Ressaisi manuellement s'il est encore vivant | Volume faible, valeur élevée, reprise automatique disproportionnée |
| Devis non transformé, ancien | **Non repris** (`D-09`) | §3 |

| Rôle du champ source | Cible DFA | Transformation | Perte / approximation |
|---|---|---|---|
| Numéro de facture | `numero_origine` (**pas** `numero`) | conservé **verbatim**, y compris préfixes et zéros de tête | §5.5 — c'est la continuité légale de la numérotation qui est en jeu |
| Date d'émission | `date_emission` | parsing strict (§4.5) | Détermine le **taux de TVA applicable** (§4.7) et l'exercice comptable. Une date fausse fausse la TVA |
| Client | FK résolue via `correspondance_reprise` | jamais par rapprochement de nom | Un document orphelin (client absent du fichier client) est **importé quand même**, rattaché à un client technique « Client repris non identifié », jamais rejeté : perdre une facture est pire que porter une fiche moche |
| Véhicule / plaque | FK + plaque figée | idem | Souvent seule la plaque figure en texte sur le document → conservée en texte figé, et rapprochée du véhicule si possible |
| Lignes (désignation, quantité, PU, rabais, TVA) | `document_repris_ligne` | montants en centimes (§4.6) | ⚠ **Cas fréquent : les lignes ne sont pas exportables** (seul l'entête l'est). Alors on importe l'entête + le PDF, et on l'assume : le garagiste retrouve son document et son montant, il ne peut pas le décomposer. C'est très supérieur à ne rien avoir |
| Total HT / TVA / TTC | `total_*_centimes` | conservé tel quel | ⚠ **Cas fréquent : TVA globale, non ventilée par ligne.** On ne la ventile pas rétroactivement (`D-04`). Le document porte un drapeau `tva_non_ventilee = true` et le taux du document |
| Paiements / solde | `paiement` sur les documents ouverts uniquement | conservé | L'historique de paiement des documents soldés n'est pas repris : le solde est nul, le détail vit chez la fiduciaire |
| PDF du document | pièce jointe `document_repris` | stockage objet, empreinte SHA-256 | **Le PDF est la vérité en cas de litige.** S'il existe, il prime sur tous les champs structurés |

### 2.5 Historique atelier (OR) → `ordre_reparation` repris

**D-06 — Les OR repris sont des OR clôturés et verrouillés, importés pour leur valeur
d'historique technique, pas pour être exploités.** Ils ne portent ni pointage, ni machine à
états vivante : ils entrent directement en `cloture`, avec `origine = 'reprise'`.

| Rôle du champ source | Cible DFA | Perte / approximation |
|---|---|---|
| Numéro d'OR | `numero_origine` | idem facture (§5.5) |
| Date, km d'entrée, véhicule, client | attributs figés (RM-50) | Les valeurs figées le sont depuis le source, pas recalculées |
| Lignes de travaux et de pièces | `ligne_or_reprise` | ⚠ La typologie de ligne DFA (RM-63 : 10 types) n'existe pas dans le source. Mapping au mieux : main-d'œuvre / pièce / autre. **Le reste part en `autre`** plutôt qu'en devinette |
| Origine de ligne (commandée/constatée/garantie…) | `origine` | ⚠ **Quasi jamais présent** → tout en `commandee`. Conséquence : les indicateurs de retouche et de garantie (RM-99) ne remontent pas avant la bascule. À dire au garagiste : « vos statistiques atelier démarrent le jour J » |
| Payeur | `payeur` | Idem : tout en `client` sauf si le source distingue garantie/assurance |
| Pointages | **non repris** (`D-10`) | §3 |
| Verbatim client | `demande_client` | Quand il existe, c'est de l'or pour les litiges anciens → repris intégralement |

### 2.6 Récapitulatif des pertes assumées

À lire au garagiste, mot pour mot, avant la signature.

| # | Ce qui est perdu ou approximé | Conséquence concrète pour lui | Atténuation |
|---|---|---|---|
| 1 | Historique de détention des véhicules avant le 1er document repris | « Qui possédait cette voiture en 2015 ? » sans réponse | Reconstruction depuis les documents ; archive froide |
| 2 | Série des kilométrages | Alertes d'entretien justes seulement dès le 2e passage | 1 relevé importé ; reconstruction depuis les OR si le km y figure |
| 3 | Historique des plaques | Recherche par ancienne plaque inopérante avant J | La plaque figée sur les documents repris reste cherchable |
| 4 | Ventilation TVA par ligne des anciennes factures | Le détail d'une vieille facture n'est pas décomposable | Le total et le PDF sont exacts et opposables |
| 5 | Origine des lignes d'OR (constatée / garantie / retouche) | Indicateurs atelier à zéro avant J | Assumé : les indicateurs démarrent au jour J |
| 6 | Conditions commerciales datées | Impossible de justifier par la règle un rabais ancien | Le montant figé sur le document reste la preuve |
| 7 | Consentements marketing | Aucune campagne possible sans recueil | Choix nLPD délibéré + campagne de re-permission (§5.7) |
| 8 | Adresses multiples, contacts multiples | À ressaisir pour les flottes | Volume faible, identifiable à l'avance |
| 9 | Pointages, RDV passés, devis anciens, stock | Rien | Ce sont des non-pertes (§3) |

---

## 3. Ce qu'on ne reprend pas

> C'est la section la plus utile du document. Le réflexe « on reprend tout, comme ça on est
> tranquille » est le premier facteur d'échec d'une migration : il multiplie par cinq le coût,
> il importe la saleté du système précédent, il rend la recette impossible (on ne vérifie pas
> 400 000 lignes) et il fait porter au nouvel outil la mauvaise réputation de l'ancien.
>
> Test de décision, pour chaque entité : **« que se passe-t-il concrètement, le mardi suivant la
> bascule, si cette donnée n'est pas là ? »** Si la réponse est « rien » ou « on la retrouve
> dans l'archive », on ne la reprend pas.

| # | Non repris | Pourquoi | Ce qu'on fait à la place |
|---|---|---|---|
| **D-07** | **Clients sans document ni véhicule depuis N ans** (défaut proposé : 5 ans, à valider par garage) | Ce sont des fiches mortes : elles polluent la recherche au comptoir, faussent les compteurs, et augmentent l'exposition nLPD sans aucun usage | Archive froide (`D-14`). Si le client revient, on recrée sa fiche en 30 secondes — et c'est l'occasion de vérifier son adresse |
| **D-08** | **Historique atelier au-delà de 24-36 mois** (à valider ; certains garages veulent 5 ans) | Au-delà, la valeur est consultative et l'archive PDF y répond | Archive froide + reprise des travaux reportés encore ouverts |
| **D-09** | **Devis non transformés** de plus de 6 mois, et **brouillons** de tout type | Un devis abandonné de 2014 n'a aucune valeur : ni légale (non émis), ni commerciale (le véhicule a changé de mains), ni technique | Rien. Aucune réclamation observée en pratique — à confirmer avec le garagiste (`QG-08`) |
| **D-10** | **Pointages historiques** | Les indicateurs de productivité ne sont comparables qu'à méthode de pointage identique. Importer les pointages d'un autre système produit des courbes fausses que la direction croira vraies | Les indicateurs démarrent au jour J. Le dire explicitement, et conserver un export CSV des anciens indicateurs pour comparaison manuelle |
| **D-11** | **Consentements marketing** | Un consentement se prouve (date, canal, preuve). Un consentement importé sans preuve est un consentement inventé — exposition nLPD directe | Remise à zéro + campagne de re-permission après la bascule. Les rappels **opérationnels** (RDV, véhicule prêt) ne sont pas du marketing et ne sont pas concernés (RM-09) |
| **D-12** | **Utilisateurs, mots de passe, droits** | Jamais. Les empreintes d'un système tiers n'ont rien à faire dans DFA, et les droits de l'ancien outil ne correspondent pas à la matrice rôle × action de DFA | Création manuelle des comptes, 15 minutes, et c'est l'occasion de nettoyer les comptes des employés partis |
| **D-13** | **Paramétrage** (taux horaires, forfaits, motifs, check-lists) | Le modèle de paramétrage DFA (spec §9, P-01→P-32) n'a pas d'équivalent dans le source. Un mapping automatique produirait un paramétrage bancal que personne n'oserait toucher | **Ressaisie manuelle assistée** : une demi-journée avec le garagiste. C'est un investissement, pas une corvée — c'est là qu'on comprend son métier |
| **D-14** | **Stock pièces (quantités)** | Un stock repris est un stock faux le lendemain. Toutes les migrations qui reprennent le stock finissent par un inventaire de toute façon | **Inventaire physique** le week-end de bascule, saisi dans DFA. Le catalogue (références + prix) est repris, les quantités non |
| **D-15** | **Commandes fournisseur soldées, mouvements de stock historiques** | Aucun usage opérationnel après bascule | Archive froide |
| **D-16** | **RDV passés** | Un RDV passé est déjà devenu un OR ou une absence | Les RDV **futurs** (après la date de bascule) sont repris — voir ci-dessous |
| **D-17** | **Photos et documents joints anciens** (tours de véhicule, rapports) | Volume énorme (plusieurs Go), valeur quasi nulle passé le délai de litige | Exception : les dossiers liés à un **litige en cours** ou à un **sinistre ouvert**, repris nommément, un par un |
| **D-18** | **Écritures comptables, lettrages, journaux** | DFA n'a pas de comptabilité interne (ARCHITECTURE §1) : c'est le domaine de la fiduciaire | La fiduciaire garde son historique. DFA reprend au jour J avec son export |
| **D-19** | **Agrégats et statistiques** | Recalculables, et de toute façon non comparables (`D-10`) | Rien |

**Ce qu'on reprend au contraire sans discuter** : clients actifs, véhicules et détention courante,
factures et avoirs (archive + créances ouvertes), travaux reportés ouverts, **RDV futurs**
(sinon le garage perd son carnet de commandes — c'est la donnée la plus urgente et la plus petite
du lot), dépôts de pneus en cours si le garage en fait (§7, `QG-12` — le module n'existe pas
encore, prévoir une reprise dans un tableur en attendant), et les prêts de véhicule de courtoisie
en cours.

**D-20 — L'archive froide est la contrepartie de tous les « non repris ».**
Elle est constituée au moment de la bascule : export complet des données source (CSV + PDF),
chiffré, horodaté, avec son empreinte SHA-256, stocké en Suisse, et **une procédure écrite de
consultation** (quel outil, quel mot de passe, qui détient la clé). Elle satisfait l'obligation de
conservation (`R-06`) sans peser sur la base opérationnelle. Le garagiste doit avoir compris et
accepté que « c'est dans l'archive » signifie « on le retrouve en 20 minutes, pas en 2 secondes ».

---

## 4. Traitement de la qualité

> Principe directeur : **on ne corrige jamais silencieusement.** Chaque transformation
> non triviale produit une ligne dans `reprise_anomalie` (§5.2) avec un niveau
> (`info` / `avertissement` / `bloquant`) et reste consultable après l'import.

### 4.1 `N-01` — Encodages hérités

Sur un export d'outil des années 2000, **les accents cassés sont la règle**, et la Suisse romande
et alémanique fournit exactement les caractères qui cassent : `é è à ô û ü ö ä ç`.

**Méthode, dans cet ordre :**

1. **Détecter la BOM** (`EF BB BF` = UTF-8, `FF FE` = UTF-16LE). Si BOM, c'est réglé.
2. **Chercher les signatures de mojibake** dans un échantillon de 5 000 lignes :

| Ce qu'on lit | Ce que c'est | Encodage réel |
|---|---|---|
| `GenÃ¨ve`, `ZÃ¼rich`, `MÃ¼ller` | UTF-8 lu comme CP1252 | source **UTF-8** |
| `GenÞve`, `Zldrich`, caractères de semi-graphique | CP850/CP437 (export DOS) lu comme CP1252 | source **CP850** |
| `Gen?ve`, `M?ller` | conversion déjà destructrice | ⚠ **irrécupérable** |
| `Genève` correct mais `Zürich` cassé | fichier à encodage mixte | ⚠ voir point 5 |
| `GenÃƒÂ¨ve` | double encodage | décoder deux fois |

3. **Valider par un lexique suisse** : compter les occurrences de `Genève`, `Zürich`,
   `Neuchâtel`, `Müller`, `Bâle`, `Delémont`, `Château`, `Strasse`, `Hôtel`, `chemin`, `Grand-Rue`.
   L'encodage retenu est celui qui maximise ces occurrences. C'est un test objectif, pas un
   jugement à l'œil.
4. **Décider par fichier, jamais par ligne.** Un décodage ligne à ligne produit un fichier
   incohérent que personne ne saura plus démêler.
5. **Encodage mixte** (données saisies sur 15 ans par 4 employés sur 3 postes) : c'est réel. Dans
   ce cas, décodage principal + liste des lignes non décodables → correction manuelle
   (typiquement quelques dizaines de fiches, faisable).
6. **Le caractère `?` et le losange `�` sont des pertes définitives** : ils sont signalés en
   anomalie et corrigés à la main sur les clients actifs uniquement.
7. **Contrôle final obligatoire** : @laupernoe relit **50 fiches au hasard à l'écran** avant validation
   de l'encodage. Aucun algorithme ne remplace ça.

### 4.2 `N-02` — Type particulier / entreprise

Le champ n'existe généralement pas. Heuristique (ordre de priorité) :

1. Présence d'un n° IDE valide → `entreprise` (certain).
2. Nom contenant `SA`, `Sàrl`, `SARL`, `AG`, `GmbH`, `SNC`, `Sagl`, `Ets`, `Sté`, `Transports`,
   `Garage`, `Commune de`, `Ville de`, `Hôpital`, `Fondation`, `Association` → `entreprise`.
3. Présence simultanée d'un champ `prénom` non vide et d'une civilité `M./Mme/Herr/Frau` →
   `particulier`.
4. Sinon → `particulier` + **anomalie `avertissement`** « type à confirmer ».

RM-01 rend le type **immuable** : une erreur coûte une nouvelle fiche et une fusion. On accepte
donc de sur-déclarer `particulier` (l'erreur est plus facile à vivre) et on sort la liste des
cas douteux (typiquement 2-5 % du fichier) pour relecture par le garagiste avant le jour J.

### 4.3 `N-03` — Doublons clients

**Le risque n'est pas de rater un doublon, c'est d'en fusionner deux qui n'en sont pas.** RM-06
rend la fusion irréversible pour l'utilisateur. La reprise est donc **conservatrice**.

**Normalisation avant comparaison** : minuscules, suppression des accents, de la ponctuation et
des espaces multiples, abréviations de voie normalisées (`rte`→`route`, `av`→`avenue`,
`ch`→`chemin`, `str`/`strasse`), civilités retirées, ordre nom/prénom canonique.

| Règle | Signal | Action |
|---|---|---|
| Identité forte : **IDE identique** | quasi certain | **Fusion automatique** proposée, validée en lot par le garagiste |
| **E-mail identique** (non générique) + nom normalisé proche (Levenshtein ≤ 2) | fort | Fusion automatique proposée |
| **Mobile E.164 identique** + nom normalisé proche | fort | Fusion automatique proposée |
| Nom normalisé identique + NPA identique | moyen | ⚠ **Jamais automatique.** Deux `muller/1204` à Genève, c'est banal. Liste de candidats |
| Nom proche + adresse proche | faible | Liste de candidats, priorisée par nombre de véhicules |
| Même véhicule (VIN) rattaché à deux fiches | fort mais ambigu | Peut être un **vrai changement de propriétaire** → jamais de fusion, création d'une détention historisée (§4.4) |

**Exclure des clés** : les e-mails génériques (`info@`, `contact@`, celui du garage lui-même,
celui du comptable), les téléphones du garage, les fiches « comptoir », « client de passage »,
« espèces » — elles concentrent des centaines de références et fusionner dessus détruit le fichier.

**D-21 — Les doublons non certains ne sont pas traités avant la bascule.** Ils sont importés tels
quels et sortis dans une **liste de fusion à traiter**, triée par valeur (nombre de véhicules et
de documents). Le garagiste en traite 10 par jour pendant deux semaines, dans DFA, avec la
fonction de fusion RM-06 — c'est plus sûr, et ça lui apprend l'outil sur un cas réel.

### 4.4 `N-04` — Véhicules, VIN, plaques et détention

**Véhicules sans VIN** (RM-16) : conservés, marqués « identification incomplète ». Clé de
déduplication de repli : `plaque active + marque + modèle`. Deux véhicules sans VIN, même plaque,
même modèle, dates de documents disjointes = **probablement le même véhicule** → candidat à
fusion, jamais fusion automatique (RM-32).

**Plaque portée par plusieurs véhicules** (le cas classique de la plaque réattribuée) :

1. Le véhicule qui porte le **document le plus récent** garde la plaque **active**.
2. Sur les autres, la plaque est **clôturée** : `au` = date du dernier document connu pour ce
   véhicule. La plaque reste donc cherchable, avec la mention « correspondance historique »
   (RM-17).
3. **Si aucune date ne permet de trancher** : les deux plaques sont importées **inactives**, une
   anomalie `bloquant` est levée, et le garagiste tranche avant le jour J. On ne devine pas une
   plaque active : RM-18 en dépend et une collision empêcherait la prise de RDV.
4. Cas légitimes à préserver : plaques **interchangeables** (deux véhicules, un détenteur) et
   plaques **professionnelles U** du garage. Ils doivent être identifiés avec le garagiste
   **avant** l'import, sinon l'algorithme les traite comme des collisions.

**Reconstruction de la détention** (RM-20) :

```
Pour chaque couple (véhicule, client) apparaissant dans un document repris :
    du  = date du plus ancien document de ce couple
    au  = date du plus récent document de ce couple, si un autre client
          a un document plus récent sur le même véhicule ; sinon NULL (détenteur courant)
    motif_fin = 'correction'          -- on ne sait pas si c'est une vente ou une reprise
    source = 'reconstruit'            -- traçabilité de l'approximation
Invariant vérifié après import : un seul détenteur courant par véhicule (RM-20).
```

Le propriétaire déclaré par la fiche véhicule du source **prime toujours** sur la reconstruction
pour la détention courante : c'est la donnée que le garagiste a maintenue à la main.

### 4.5 `N-05` — Dates ambiguës

| Piège | Détection | Traitement |
|---|---|---|
| `jj/mm` vs `mm/jj` | Scanner **toute la colonne** : si une seule valeur a son 1er composant > 12, la colonne est jour-en-tête ; si aucune, la colonne est **ambiguë** | Ambiguë ⇒ **anomalie bloquante**. Résolution par une référence connue : une facture papier que le garagiste identifie (`CR-04`). Ne jamais présumer le format « parce qu'on est en Suisse » : l'export peut sortir en format US |
| Année sur 2 chiffres | `> 30` ⇒ 19xx, `≤ 30` ⇒ 20xx (pivot à valider selon l'ancienneté du parc) | Le pivot est un paramètre d'import, journalisé |
| Numéro de série Excel | valeur numérique 20 000–60 000 dans une colonne date | Conversion avec l'**anomalie du 29.02.1900** d'Excel (décalage de 1 jour avant le 01.03.1900) |
| Sentinelles | `00.00.0000`, `01.01.1900`, `30.12.1899`, `01.01.1970`, `31.12.9999` | → `NULL` + anomalie `info`. Jamais importées comme dates réelles |
| Date + heure sans fuseau | colonne `datetime` | Interprétée en `Europe/Zurich` puis stockée en `timestamptz`. Les dates pures (émission de facture, 1re mise en circulation) restent des `date`, sans heure : leur donner une heure crée des bascules de jour |
| Dates impossibles | 1re mise en circulation < 1900, date de document > aujourd'hui, expertise > +5 ans | Anomalie `avertissement` + valeur conservée pour arbitrage |

### 4.6 `N-06` — Montants, en centimes, sans exception

**Interdit : `parseFloat`, `Number()`, tout calcul en virgule flottante.** La conversion se fait
par analyse de chaîne vers un entier de centimes.

Pièges réels sur des exports suisses :

- Séparateur de milliers **apostrophe** : `1'234.50`, parfois `1’234.50` (apostrophe typographique
  U+2019), parfois espace insécable.
- Séparateur décimal `.` ou `,` selon la locale d'export → détection par colonne : si un
  séparateur apparaît toujours avec exactement 2 décimales, c'est le décimal.
- Signe négatif **suffixe** (`123.45-`) ou entre parenthèses (`(123.45)`) sur les exports issus
  d'outils comptables.
- Montants stockés **déjà en centimes** dans le source (colonne entière sans décimale) — à
  vérifier sur un document dont on connaît le montant papier, pas à supposer.
- Devise : refuser tout ce qui n'est pas CHF, ou importer avec la devise et le drapeau
  correspondant. Ne **jamais** convertir un EUR historique en CHF.
- **Contrôle de cohérence obligatoire** : `somme(lignes) == total` pour chaque document. Écart
  ⇒ anomalie `avertissement`, **le total source fait foi** (`D-04`), l'écart est reporté sur une
  ligne technique « écart de reprise » visible.

```
Règle de parsing (pseudocode) :
  1. trim, retirer les apostrophes/espaces de milliers, retirer le symbole de devise
  2. normaliser le signe (suffixe et parenthèses → préfixe)
  3. valider contre ^-?\d+([.,]\d{1,2})?$  — sinon : REJET, anomalie bloquante
  4. séparer partie entière / décimale, compléter à 2 décimales
  5. entier = partie_entiere * 100 + decimales
  Aucune étape n'utilise de flottant.
```

### 4.7 `N-07` — TVA : les taux d'époque, pas le taux courant

**Une facture de 2015 porte 8.0 %, pas 8.1 %.** Appliquer le taux courant à un document ancien
fausse le montant, donc le document.

| Période | Taux normal | Taux réduit | Hébergement |
|---|---|---|---|
| 01.01.2001 – 31.12.2010 | 7.6 % | 2.4 % | 3.6 % |
| 01.01.2011 – 31.12.2017 | 8.0 % | 2.5 % | 3.8 % |
| 01.01.2018 – 31.12.2023 | 7.7 % | 2.5 % | 3.7 % |
| depuis le 01.01.2024 | 8.1 % | 2.6 % | 3.8 % |

> **À confirmer avec la fiduciaire du garage avant le premier import** (`QG-11`). Ce tableau est
> une base de travail, pas une source fiscale.

Conséquences :

- Le stockage en **pour mille** (`taux_tva_pourmille`, plan backend §5) représente tous ces taux
  exactement : 76, 80, 77, 81, 24, 25, 26, 36, 37, 38. Aucune décimale perdue. **La reprise
  valide ce choix de modélisation** — il faut qu'il tienne pour l'historique, pas seulement
  pour aujourd'hui.
- Quand le source ne donne qu'un **code TVA** sans table de correspondance : le taux est déduit
  de la **date d'émission du document** et du montant de TVA figurant sur l'entête
  (`taux ≈ tva / ht`), avec contrôle de vraisemblance contre le tableau ci-dessus. Un taux
  reconstruit qui ne tombe sur aucune valeur connue lève une anomalie bloquante.
- La date charnière du 31.12 est un piège : une facture émise le 02.01.2024 pour une prestation
  de décembre 2023 peut légitimement porter 7.7 %. **On n'arbitre pas** : on garde ce que dit le
  document.

### 4.8 `N-08` — Téléphones, NPA, champs surchargés

- **Téléphones** → E.164 : `079 123 45 67` → `+41791234567` ; `0041...` → `+41...` ; `00 33...`
  → `+33...` ; numéro à 7 chiffres sans indicatif → **non normalisable**, conservé brut dans
  `telephone_source` avec anomalie. On ne jette jamais un numéro : au comptoir, un numéro moche
  vaut mieux qu'un numéro absent.
- **NPA** : les NPA suisses vont de 1000 à 9658, sans zéro de tête — donc pas de piège Excel côté
  suisse, **mais** les NPA français (`01234`) et allemands (`04109`) en ont, et Excel les mange.
  Vérifier la longueur avant import ; recomposer depuis la localité si nécessaire.
- **Champs surchargés** : `Dupont Jean / Mme / 079 123 45 67 / ne pas appeler avant 10h` dans un
  champ « nom ». Détection : longueur anormale, présence de `/`, `-`, de chiffres dans un champ
  nom. Traitement : on **n'extrait pas automatiquement** ; le champ est importé intégralement en
  nom **et** recopié en note interne, et la ligne part en liste de nettoyage manuel. Un
  découpage automatique sur des séparateurs incohérents détruit plus qu'il ne répare.
- **Troncatures** : les systèmes anciens limitent souvent à 25-30 caractères. Une raison sociale
  coupée (`Transports International de la Bro`) est **irrécupérable** : signalée, à compléter à
  la main sur les clients actifs.

### 4.9 `N-09` — Ce qui déclenche un arrêt

Un import s'arrête (aucune écriture) si l'une de ces conditions est vraie :

| Condition | Raison |
|---|---|
| Taux d'anomalies `bloquant` > 1 % des lignes d'une entité | Le mapping est faux, pas les données |
| Encodage non déterminé | Toutes les chaînes seraient à refaire |
| Format de date ambigu non résolu | Fausse toute la chronologie et la TVA |
| Un montant sur cent ne parse pas | Le parseur ou la colonne est faux |
| Le tenant cible contient déjà des données d'un autre lot non annulé, sans `--reprise-incrementale` | Risque d'écrasement croisé |
| Le tenant cible ne correspond pas au `--confirmer-slug` fourni | Garde-fou d'isolation (§5.4) |

---

## 5. Conception technique de l'import

### 5.1 Où vit le code

```
apps/api/src/reprise/
├── reprise.module.ts              # module NestJS, non exposé en HTTP à ce stade
├── domaine/
│   ├── lot.service.ts             # cycle de vie d'un lot (ouvert → chargé → validé → purgé)
│   ├── correspondance.service.ts  # clé source → UUID DFA (le cœur de l'idempotence)
│   ├── anomalie.service.ts
│   └── reconciliation.service.ts  # rapport de recette (§6.4)
├── adaptateurs/                   # un par système source — même logique que les connecteurs (§5 ARCHITECTURE)
│   ├── adaptateur.interface.ts    # LecteurSource : lire() → flux de LigneSource brute
│   ├── csv/                       # cas générique : CSV/XLSX + descripteur de colonnes
│   └── <garage>-<systeme>/        # spécificités constatées, une par installation
├── transformation/
│   ├── montant.ts  date.ts  telephone.ts  encodage.ts  tva.ts   # §4, unitairement testés
│   └── normalisation-nom.ts
├── chargeurs/                     # un par entité, dans l'ordre des dépendances
│   ├── chargeur-client.ts  chargeur-vehicule.ts  chargeur-article.ts
│   └── chargeur-document.ts  chargeur-or.ts
└── cli/
    └── importer.ts                # point d'entrée, exécuté via tsx comme migrer.ts / seed-dev.ts
```

**Pourquoi dans `apps/api` et pas dans un outil séparé** : l'import doit réutiliser
`AccesBase.enTenant()` (le dispositif RLS, `apps/api/src/db/acces-base.service.ts`), le schéma
Drizzle, la config validée zod et les règles métier. Un outil externe rejouerait ces règles en
double et divergerait au premier changement de schéma.

**Pourquoi en CLI et pas en endpoint HTTP** : un import est une opération d'exploitation menée
par @laupernoe, pas une fonctionnalité self-service. Pas d'endpoint = pas de surface d'attaque, pas de
question d'autorisation, pas de timeout HTTP sur un chargement de 40 minutes. Le jour où un
garage voudra importer son propre tableur, ce sera un endpoint mince par-dessus le même service,
derrière un droit dédié, et via BullMQ.

**Ce que l'import n'a pas le droit de faire** : se connecter avec `DATABASE_URL_MIGRATION`
(rôle `dfa_migrator`, propriétaire des tables, donc affranchi du RLS sur `utilisateur`,
`session`, `journal_securite`). L'import utilise `DATABASE_URL` (`dfa_app`) **comme l'API**, et
passe donc sous les mêmes politiques RLS. C'est non négociable : un import est exactement le
moment où un bug d'isolation ne serait pas détecté.

### 5.2 Tables de reprise

Toutes portent `tenant_id NOT NULL`, RLS activé + `FORCE`, et politiques `USING` + `WITH CHECK` —
sinon `verifierPostureRls()` refuse le démarrage de l'API (c'est le comportement voulu).

| Table | Rôle | Colonnes structurantes |
|---|---|---|
| `lot_reprise` | Un lot = un fichier d'une entité, d'un système, à une date | `tenant_id`, `systeme_source`, `entite`, `nom_fichier`, `empreinte_sha256`, `nb_lignes`, `operateur`, `demarre_le`, `termine_le`, `statut` (`ouvert`/`charge`/`valide`/`annule`/`purge`), `mode` (`simulation`/`reel`) |
| `reprise_ligne_source` | La ligne brute, **verbatim**, avant toute transformation | `tenant_id`, `lot_id`, `numero_ligne`, `donnees jsonb`, `empreinte_ligne` |
| `correspondance_reprise` | **La table pivot.** Identifiant source → UUID DFA | `tenant_id`, `systeme_source`, `entite`, `cle_source text`, `entite_id uuid`, `lot_id`, `cree_le` · `unique (tenant_id, systeme_source, entite, cle_source)` |
| `reprise_anomalie` | Tout ce qui n'est pas passé proprement | `tenant_id`, `lot_id`, `numero_ligne`, `niveau`, `code`, `champ`, `valeur_source`, `message` |
| `document_repris` (+ `_ligne`) | Archive documentaire en lecture seule (§5.6) | voir §5.6 |

`reprise_ligne_source` est ce qui rend l'import **rejouable sans retourner chez le garage** : on
recharge depuis le staging, on ne réextrait pas. Elle est **purgée après la recette** (§5.7) ;
`lot_reprise`, `correspondance_reprise` et `reprise_anomalie` sont **conservés à vie** : ce sont
la preuve et la traçabilité.

### 5.3 Traçabilité de l'origine

Chaque table métier pouvant recevoir un import gagne **une colonne** :

```sql
alter table client add column origine_lot_id uuid null references lot_reprise(id);
create index client_origine_lot_idx on client (tenant_id, origine_lot_id)
  where origine_lot_id is not null;
```

Le reste (système source, fichier, numéro de ligne, clé source, date d'import) se retrouve par
jointure : `client.origine_lot_id → lot_reprise` et `correspondance_reprise.entite_id = client.id`.
Une colonne nullable et un index partiel plutôt que cinq colonnes dupliquées sur chaque table.

**La question à laquelle ce dispositif répond**, et c'est la seule qui compte le jour où le
garagiste conteste un chiffre : « d'où sort cette fiche ? » → système, fichier, empreinte du
fichier, ligne exacte, données brutes de la ligne, date d'import, opérateur. En trois secondes,
avec la ligne source d'origine à l'écran. Sans ça, le premier écart constaté est indéfendable.

### 5.4 Isolation tenant — comment elle est imposée

Quatre verrous, cumulés :

1. **Le `tenant_id` vient de la ligne de commande, résolu par slug**, jamais du fichier. Si le
   fichier source contient un identifiant de société, il est conservé dans
   `reprise_ligne_source.donnees` (traçabilité) et **n'est jamais lu par un chargeur**.
2. **Double confirmation** : la commande exige `--tenant <slug>` **et** `--confirmer-slug <slug>`,
   et affiche la raison sociale + le nombre d'enregistrements existants avant d'écrire.
   Un import se déclenche à 22h un vendredi ; le garde-fou doit être plus fort que la fatigue.
3. **Toute écriture passe par `AccesBase.enTenant()`** — le `set_config('app.tenant_id', …, true)`
   en portée transaction, donc le RLS s'applique. Un chargeur qui « oublierait » son
   `where tenant_id` n'écrit rien chez le voisin : la politique `WITH CHECK` rejette.
4. **Un lot est lié à un tenant à sa création**, et toutes ses lignes le sont par FK composite
   `(tenant_id, lot_id) → lot_reprise(tenant_id, id)` — le même patron que
   `site_tenant_id_uk` (`apps/api/src/db/schema/site.ts`). L'étanchéité devient une propriété du
   schéma, pas une discipline du code.

**Test d'intégration obligatoire** : lancer un import sur le tenant A pendant que le tenant B
contient des données similaires (mêmes clés sources), et vérifier qu'aucune ligne de B n'est lue,
modifiée ou rattachée. C'est le test qui protège la règle n°1 du projet.

### 5.5 Idempotence, rejeu et numérotation

**Le pipeline, en cinq phases, chacune reprenant là où la précédente s'est arrêtée :**

```
extraire → déposer (staging) → normaliser/valider → charger → réconcilier
                     ↑                                  │
                     └──── rejeu : on repart d'ici ─────┘
```

**Idempotence.** Chaque chargeur, pour chaque ligne :

```
cle = cle_source(ligne)                       -- §5.5, choix de la clé
existant = correspondance.chercher(tenant, systeme, entite, cle)
si existant est null :
    id = insérer(...)                          -- nouvelle entité
    correspondance.enregistrer(tenant, systeme, entite, cle, id, lot)
sinon :
    mettre_a_jour(existant.entite_id, ...)     -- champs d'import uniquement
                                               -- JAMAIS les champs modifiés par un utilisateur
```

Rejouer un import raté ne duplique donc rien : la deuxième passe retrouve la correspondance et
met à jour. La transaction est **par bloc de N lignes** (500), pas globale : un import de
40 000 lignes qui échoue à la ligne 39 000 ne doit pas tout perdre. Le lot mémorise
`derniere_ligne_traitee`.

**`D-22` — Choix de la clé source**, par ordre de préférence :

1. **Clé primaire du système source** (un identifiant numérique interne). C'est la bonne clé :
   stable même si le garagiste corrige un nom entre deux extractions.
2. **Clé métier naturelle** : VIN pour un véhicule, numéro de facture pour un document.
3. **Empreinte d'un n-uplet choisi**, en dernier recours (typiquement un tableur sans colonne
   d'identifiant). ⚠ **Faiblesse à annoncer** : corriger un champ de la clé entre deux
   extractions crée un doublon. Atténuation : dès la première extraction, on **ajoute une colonne
   d'identifiant au tableur source** et le garage travaille avec — l'extraction suivante est
   stable.

**Annulation d'un lot.** `importer annuler-lot <id>` supprime les entités créées par ce lot,
**et seulement si** : le lot est en mode `simulation` ou la bascule n'a pas eu lieu ; aucune
entité du lot n'a été modifiée depuis (`modifie_le > lot.termine_le` ⇒ refus) ; aucune entité
créée par un utilisateur ne la référence. Sinon, refus motivé, ligne par ligne. **C'est un outil
de mise au point avant le jour J, pas un bouton d'annulation d'après-bascule** — et le document
doit le dire, sinon quelqu'un y croira au mauvais moment.

**Numérotation — le point le plus délicat.**

**`D-23` — Un document repris ne consomme jamais la séquence DFA.**

- Le numéro d'origine est conservé **verbatim** dans `numero_origine` (préfixes, zéros de tête,
  format exotique compris). Il est affiché tel quel : c'est ce numéro que le client a sur son
  papier, c'est celui que la fiduciaire a dans ses écritures, c'est celui qu'on doit retrouver
  à la recherche.
- Le chargeur **n'appelle jamais** `ServiceParametrage.prochainNumero()`
  (`docs/plan-etape-1-backend.md`, contrat de sortie du module `parametrage`).
- **En fin d'import**, et une seule fois, le compteur DFA est **calé** :

```sql
-- Le premier document émis par DFA continue la suite du garage.
update compteur_document
   set valeur = greatest(valeur, :max_numero_source_annee_courante)
 where tenant_id = :tenant and type_document = 'facture' and annee = :annee_courante;
```

- **Contrainte de non-collision**, en base et non dans le code : un index unique commun aux
  numéros émis et aux numéros repris, par tenant / type / année. Deux documents ne peuvent pas
  porter le même numéro affiché, quelle que soit leur origine.
- **Si le format source est incompatible** avec le format DFA (`P-01`) : on ne convertit pas, on
  ne renumérote pas. Le numéro d'origine reste tel quel, et la séquence DFA démarre à une valeur
  qui ne peut pas collisionner — **ou**, bien mieux, **on bascule au changement d'année** et la
  séquence DFA repart proprement à 1 pour le nouvel exercice (§6.1). C'est l'argument le plus
  fort en faveur d'une bascule au 1er janvier.
- **Contrainte transmise à `expert-facturation` pour l'étape 2** : le modèle de document doit
  porter dès sa conception `numero_origine text null` et `origine enum('dfa','reprise')`, et la
  contrainte d'unicité doit couvrir les deux. Ajouter ça après coup impose une migration sur des
  documents verrouillés — c'est-à-dire un problème.

**`D-24` — Une facture reprise est verrouillée à l'écriture, comme une facture émise.** Aucun
écran, aucun endpoint, aucun script ne la modifie. Correction = avoir, y compris sur un document
repris. Le seul droit d'écriture est celui du chargeur, avant la bascule.

### 5.6 L'archive documentaire ⚠️ SUPERSÉDÉE PAR LA §10.4

> **Cette section décrit une table `document_repris` qui n'a pas été construite, et qui ne doit
> pas l'être.** L'étape 2 a intégré la reprise directement dans `document_vente`
> (`origine = 'reprise'`, `numero_origine`, `tva_non_ventilee`, `ecart_reprise_centimes`) —
> exactement la contrainte transmise en §8.2. Un document repris vit donc dans la même table, la
> même recherche, la même fiche client et le même écran que les documents émis par DFA, ce qui est
> très supérieur à une archive séparée : le garagiste ne se demande jamais « dans quel écran je
> cherche ». **Lire la §10.4.** Le texte ci-dessous est conservé pour la trace du raisonnement.

```
document_repris   -- NON CONSTRUIT — voir §10.4
  tenant_id, id, origine_lot_id, numero_origine, type (facture/avoir/or/devis),
  date_emission date, client_id (nullable), vehicule_id (nullable),
  client_libelle_fige text, vehicule_libelle_fige text, plaque_figee text,
  total_ht_centimes int, total_tva_centimes int, total_ttc_centimes int,
  taux_tva_pourmille smallint null, tva_non_ventilee boolean not null default false,
  devise char(3) not null default 'CHF',
  solde_centimes int not null default 0,       -- > 0 ⇒ créance ouverte, traitée en étape 2
  pdf_cle text null, pdf_sha256 text null,
  contenu_source jsonb                          -- l'entête source, verbatim
document_repris_ligne
  tenant_id, document_id, ordre, designation, quantite_millieme, pu_centimes,
  rabais_pourmille, taux_tva_pourmille, total_ligne_centimes
```

Propriétés : **lecture seule** (aucun endpoint d'écriture ; idéalement un `REVOKE UPDATE, DELETE`
sur `dfa_app` après la bascule), cherchable par numéro, client, véhicule, plaque et montant,
consultable depuis la fiche client et la fiche véhicule — c'est là que le garagiste la cherche,
pas dans un écran « migration ».

Les libellés **figés** (`client_libelle_fige`, `plaque_figee`) permettent d'afficher le document
tel qu'il a été émis même si la fiche client a été fusionnée ou renommée depuis. Sans eux,
l'archive ment progressivement.

### 5.7 nLPD et cycle de vie des fichiers intermédiaires

| Étape | Règle |
|---|---|
| Extraction | Poste dédié, disque chiffré (BitLocker), copie restaurée d'une sauvegarde, jamais la production |
| Transport | Conteneur chiffré (`age` ou 7-Zip AES-256), clé transmise par un canal distinct. **Jamais** d'e-mail, de WeTransfer, de Google Drive, de Dropbox |
| Stockage de travail | Sur l'infrastructure suisse du projet (Infomaniak/Exoscale) ou sur le disque chiffré. Le staging `reprise_ligne_source` vit dans la base DFA — donc en Suisse, sous RLS |
| Base juridique | Le garage est **responsable du traitement**, @laupernoe et DFA sont **sous-traitants** : contrat écrit (art. 9 nLPD), inscription au registre des activités, mesures techniques documentées |
| Minimisation | On n'extrait pas les colonnes qu'on ne reprend pas (§3). Un fichier qui contient des scans de permis de conduire n'a pas à sortir du garage |
| Destruction | **Fichiers bruts** détruits après la recette + 30 jours (effacement du conteneur chiffré + destruction de la clé). **`reprise_ligne_source`** purgée au même moment. **Conservés** : `lot_reprise`, `correspondance_reprise`, `reprise_anomalie`, et l'archive froide (`D-20`) — ce sont la preuve et la traçabilité, sans données personnelles superflues |
| Consentements | Non repris (`D-11`) |
| Journalisation | Chaque import écrit dans le journal d'audit : opérateur, tenant, lot, entité, volumes, anomalies. Un import est une opération sensible au même titre qu'une émission de facture |
| Droit d'effacement | Une demande nLPD post-bascule s'exécute par **anonymisation** (RM-110), et doit toucher aussi `reprise_ligne_source` si elle n'est pas encore purgée. À couvrir par un test |

---

## 6. Plan de bascule

### 6.1 Choisir la date — avant tout le reste

| Critère | Recommandation |
|---|---|
| **Exercice comptable** | **Le 1er janvier est de très loin le meilleur jour** : la numérotation repart à 1 (RM-49, P-01), l'exercice est clos, la fiduciaire a bouclé, la TVA du trimestre est déposée. À défaut : le 1er d'un trimestre, puis le 1er d'un mois |
| **Saison atelier** | **Éviter absolument** les pics de changement de pneus (mi-octobre à fin novembre, et mars-avril) : ce sont les semaines où le garage fait son chiffre et où personne n'a une minute pour apprendre un outil |
| **Contrat** | Le préavis de résiliation de l'ancien DMS dicte le calendrier (`R-01`). Le vérifier **avant** d'annoncer une date |
| **Jour de la semaine** | Bascule effective un **lundi matin**, import final le **week-end** précédent. Jamais un vendredi (personne pour corriger le samedi) |
| **Effectif** | Aucune bascule pendant les vacances du réceptionnaire : c'est lui qui porte l'outil |

### 6.2 Calendrier type (8 semaines)

| Jalon | Contenu | Sortie vérifiable |
|---|---|---|
| **S-8** | Investigation sur place (§1), demande d'export officielle (§1.5) | Fiche d'inventaire remplie + échantillons |
| **S-7** | Écriture de l'adaptateur, mapping champ à champ validé avec le garagiste | Tableau de mapping signé, pertes annoncées (§2.6) |
| **S-6 → S-4** | **Imports blancs** dans un tenant bac à sable (`<garage>-bac`), 3 itérations minimum | Le taux d'anomalies bloquantes descend sous 0.1 % |
| **S-4** | Listes de nettoyage remises au garagiste : doublons, types douteux, plaques en conflit | Il commence à trancher, dans DFA |
| **S-3** | **Recette par le garagiste** sur le bac à sable (§6.4). Paramétrage DFA saisi (`D-13`) | Les 10 contrôles `CR-xx` passent |
| **S-2** | Formation (2 demi-journées : comptoir/réception, puis atelier/facturation) | Chaque rôle a fait son geste principal 3 fois |
| **S-1** | Gel du paramétrage. Répétition générale : extraction + import complet chronométrés | Durée d'import mesurée, procédure écrite |
| **J-2 (vendredi soir)** | Dernière facturation dans l'ancien système. **Inventaire pièces** samedi (`D-14`) | Ancien système passé en lecture seule |
| **J-1 (samedi/dimanche)** | Extraction finale → import final en mode réel → contrôles automatiques → calage des compteurs (§5.5) | Rapport de réconciliation vert |
| **J (lundi 7h)** | **GO / NO-GO** avec le garagiste, sur les critères §6.3. @laupernoe sur place toute la journée | Décision tracée |
| **J → J+5** | Vigilance renforcée (§6.5). Point quotidien à 17h | Journal des incidents |
| **J+10** | Revue : anomalies restantes, listes de fusion, indicateurs | Décision de clôture de projet |
| **J+30** | Destruction des fichiers intermédiaires, purge du staging (§5.7), résiliation de l'ancien contrat | Attestation de destruction |

### 6.3 GO / NO-GO — critères objectifs, arrêtés avant le jour J

**Décidés et écrits en S-3, jamais le matin même** : le matin de la bascule, tout le monde a envie
d'y aller.

**Conditions de GO (toutes requises) :**

| # | Critère | Seuil |
|---|---|---|
| 1 | Écart de comptage sur les clients actifs, véhicules, documents repris | **0** ligne inexpliquée (un écart expliqué et documenté est acceptable) |
| 2 | Somme des totaux TTC des factures reprises, par année | **écart de 0 centime** avec le source |
| 3 | Anomalies `bloquant` restantes | **0** |
| 4 | Les 10 contrôles de recette `CR-01` → `CR-10` (§6.4) | **tous passés**, par le garagiste lui-même |
| 5 | Émission d'une facture de test dans DFA | numéro = dernier numéro source + 1, sans collision |
| 6 | Sauvegarde vérifiée de la base DFA post-import + archive froide constituée | restauration testée |
| 7 | Ancien système accessible en lecture, contrat non résilié | confirmé |

**Critères de retour arrière (un seul suffit), mesurés à J+1, J+3 et J+5 :**

| # | Symptôme | Fenêtre |
|---|---|---|
| 1 | Impossible d'émettre une facture (anomalie bloquante non contournable) | Immédiat |
| 2 | Une facture reprise est introuvable par son numéro d'origine | Immédiat |
| 3 | Collision ou trou dans la numérotation des documents émis | Immédiat |
| 4 | Écart de montant constaté sur un document repris | Immédiat |
| 5 | Fuite inter-tenant, même en lecture | Immédiat, sans discussion |
| 6 | Temps de réception d'un véhicule > 2× l'ancien système, encore vrai à J+3 | J+3 |
| 7 | Plus de 5 véhicules par jour non retrouvés au comptoir | J+3 |
| 8 | Le garagiste demande le retour arrière | Toujours recevable |

**Procédure de retour arrière** : l'ancien système repasse en écriture ; les documents émis dans
DFA pendant la fenêtre sont **ressaisis** dans l'ancien système (d'où la fenêtre courte : au-delà
de J+5 le retour coûte plus cher que la correction) ; la base DFA du tenant est conservée telle
quelle pour analyse, jamais effacée. **Prérequis contractuel** : l'ancien contrat court encore
(`R-01`) — c'est pour ça qu'on ne résilie pas avant J+30.

### 6.4 Contrôles de recette — ce que le garagiste vérifie lui-même

> « 8 000 lignes importées » ne prouve rien et ne rassure personne. « Retrouve-moi la dernière
> facture de M. Rossier » prouve tout. Ces contrôles sont exécutés **par le garagiste, sur son
> écran, avec ses propres exemples**, et chaque résultat est coché. @laupernoe ne les fait pas à sa place.

| # | Contrôle | Ce qu'il fait | Résultat attendu |
|---|---|---|---|
| **CR-01** | **« Retrouve la dernière facture de M. Rossier »** (un vrai client, choisi par lui) | Cherche le nom, ouvre la fiche, ouvre la dernière facture | Même numéro, même date, **même montant au centime** que son papier |
| **CR-02** | **« Cherche la plaque VS 12345 »** (une plaque qu'il connaît par cœur) | Tape la plaque, sans espace, en minuscules | Le bon véhicule, le bon détenteur courant, son historique |
| **CR-03** | **« Ton plus gros client »** | Ouvre la fiche | Rabais, délai de paiement, contacts, tous ses véhicules |
| **CR-04** | **10 factures tirées au hasard dans son classeur papier** | Retrouve chacune par son numéro | 10/10, montants identiques au centime, TVA au taux d'époque |
| **CR-05** | **Un véhicule vendu l'an dernier** | Ouvre le véhicule | Détention courante = nouveau propriétaire ; les anciens OR restent rattachés à l'ancien (RM-21) |
| **CR-06** | **« Combien de clients as-tu vus en 2025 ? »** | Compare avec le chiffre de l'ancien système | Même nombre, ou écart expliqué ligne à ligne |
| **CR-07** | **Chiffre d'affaires d'un mois passé** | Compare avec le chiffre de la fiduciaire | **Écart 0**. Sinon, on ne bascule pas |
| **CR-08** | **Un client au nom accentué** (Müller, Genève, Neuchâtel) | Ouvre la fiche, génère un PDF | Accents corrects **à l'écran et sur le PDF** — ce sont deux chaînes différentes |
| **CR-09** | **Le carnet de RDV de la semaine prochaine** | Ouvre le planning | Tous les RDV futurs sont là, au bon jour, avec le bon véhicule |
| **CR-10** | **Émettre une facture de test** | Facture un client fictif, puis l'annule par avoir | Le numéro suit celui de l'ancien système ; l'avoir se crée ; rien ne se modifie après émission |
| **CR-11** | **Un véhicule avec des travaux reportés** | Ouvre la fiche | Les travaux refusés au dernier passage sont proposés |
| **CR-12** | **Un client bloqué / en litige** | Ouvre la fiche | L'alerte s'affiche en rouge (RM-13) |

### 6.5 Double saisie — la position honnête

**`D-25` — On ne fait pas de double saisie générale.** C'est un réflexe rassurant sur le papier et
un mensonge en pratique : dans un garage de 5 personnes, un mardi matin à 7h30 avec six clients à
la file, personne ne saisit deux fois. La double saisie produit deux systèmes également faux, et
on ne sait plus lequel croire — ce qui est pire que d'en avoir un seul, imparfait.

**Ce qu'on fait à la place :**

- **Ancien système en lecture seule** dès J-2, accessible à tous, gardé 30 jours minimum. C'est le
  filet réel : consultation possible à tout moment, aucune divergence possible.
- **DFA seul en écriture** dès le jour J.
- **Vigilance renforcée J → J+5** : @laupernoe sur place à J (toute la journée) et à J+1 (matin), joignable
  ensuite ; point quotidien à 17h avec le réceptionnaire ; **journal des incidents** tenu à la main,
  vidé chaque soir.
- **Contrôle croisé quotidien à J+1 → J+5** : le total facturé du jour dans DFA est comparé au
  ruban de caisse / au brouillard bancaire. C'est un contrôle de 2 minutes qui détecte tout écart
  de facturation, et il ne coûte aucune double saisie.

**Le seul cas où une double saisie limitée se justifie** : une bascule imposée en milieu de période
comptable alors que la fiduciaire exige la continuité dans l'ancien outil. Alors elle porte
**uniquement sur les factures émises**, pendant **2 semaines maximum**, avec un responsable nommé.
Si cette situation se présente, la bonne réponse est presque toujours de **décaler la bascule** au
début de la période suivante (§6.1).

### 6.6 Rapport de réconciliation (automatique)

Produit par `reconciliation.service.ts` après chaque import, en une page :

```
LOT ......... TENANT ......... MODE ......... DATE .........

Comptages                     source    importé    écart    statut
  Clients (périmètre retenu)   3 104      3 104        0     OK
  Clients écartés (D-07)       5 096          –        –     archive froide
  Véhicules                    4 812      4 812        0     OK
  Détentions courantes         4 812      4 812        0     OK
  Documents repris            18 447     18 447        0     OK
  dont créances ouvertes          37         37        0     OK

Montants (centimes)                 source          importé      écart
  Total TTC factures 2024    412'883'50      412'883'50          0     OK
  Total TTC factures 2023    398'201'15      398'201'15          0     OK
  Créances ouvertes            2'314'80        2'314'80          0     OK

Numérotation
  Dernier n° facture source .......... compteur DFA calé à ..........  OK
  Collisions détectées : 0

Anomalies    bloquant 0  ·  avertissement 214  ·  info 1'038
  Top 5 : type client à confirmer (96) · téléphone non normalisable (44) ·
          date de 1re mise en circulation absente (31) · ...

Intégrité
  Documents orphelins (client non résolu) ......... 12  → client technique
  Véhicules sans détenteur courant ................  0
  Plaques actives en collision ....................  0
  Véhicules sans VIN .............................. 187 (identification incomplète)
  Candidats à fusion clients ...................... 143 (liste jointe)
```

**Écart 0 sur les montants n'est pas une cible, c'est une condition.** Un écart d'un centime
signifie que quelque chose n'est pas compris — pas qu'il est petit.

---

## 7. Questions et risques

### 7.1 À poser au garagiste

**Système et données**
- **QG-01** — Depuis combien d'années utilisez-vous ce logiciel ? Y a-t-il eu un système avant, et
  ses données ont-elles été reprises ? *(Une reprise antérieure ratée explique la moitié des
  bizarreries d'un fichier client.)*
- **QG-02** — Le logiciel tourne-t-il sur un serveur chez vous, sur un poste, ou chez l'éditeur ?
  Qui détient le mot de passe administrateur ?
- **QG-03** — Avez-vous des sauvegardes ? Depuis quand ? En avez-vous déjà restauré une ?
- **QG-04** — Combien d'années d'historique consultez-vous **réellement** ? Quand avez-vous ouvert
  pour la dernière fois une facture de plus de 3 ans, et pourquoi ?
- **QG-05** — Avez-vous des archives papier ou PDF en parallèle ?

**Périmètre**
- **QG-06** — Sur vos 8 000 fiches clients, combien voyez-vous encore ? *(La réponse est toujours
  très inférieure au fichier. C'est le point de départ de `D-07`.)*
- **QG-07** — Que faites-vous des fiches de clients qui ne viennent plus ? Les supprimez-vous ?
- **QG-08** — Vous arrive-t-il de rouvrir un devis de plus de six mois ? *(Valide `D-09`.)*
- **QG-09** — Avez-vous des factures clients impayées dans le système ? Combien, pour quel montant ?
- **QG-10** — Avez-vous des litiges ou des sinistres en cours ? Lesquels ? *(Ils déclenchent la
  reprise nommée des pièces jointes, `D-17`.)*

**Argent et fiduciaire**
- **QG-11** — Qui est votre fiduciaire, que lui envoyez-vous, sous quelle forme, à quelle
  fréquence ? Pouvons-nous lui parler ? *(Elle détient les chiffres de référence de `CR-07` et le
  tableau des taux TVA à confirmer, §4.7.)*
- **QG-12** — Faites-vous du dépôt de pneus ? Combien de jeux ? Où est cette information
  aujourd'hui ? *(Le module n'existe pas dans DFA — il faut une réponse avant de promettre.)*
- **QG-13** — Avez-vous des contrats de service, des flottes, des leasings avec facturation
  particulière ?

**Organisation de la bascule**
- **QG-14** — Quelle est votre période la plus calme de l'année ? La plus chargée ?
- **QG-15** — Qui, chez vous, sera le référent de la bascule ? *(S'il n'y en a pas, il n'y a pas
  de projet.)*
- **QG-16** — Accepteriez-vous un inventaire pièces le samedi de la bascule ? *(`D-14`.)*
- **QG-17** — Que se passe-t-il si, le mardi suivant, vous ne retrouvez pas une fiche client ?
  *(Cette question fait émerger les vraies attentes bien mieux qu'une liste de fonctionnalités.)*

### 7.2 À demander à l'éditeur — par écrit, sous la signature du garage

- **QE-01** — Demande formelle d'un **export complet des données du garage** dans un format
  ouvert (CSV, XML ou SQL), avec un **dictionnaire des champs**. Délai souhaité : 30 jours.
- **QE-02** — Quel est le **coût** de cette extraction ? Sur quelle base contractuelle ?
- **QE-03** — Le contrat comporte-t-il une **clause de réversibilité** ? Quel article ?
- **QE-04** — Quelles données sont **incluses** dans l'export et lesquelles ne le sont pas
  (lignes de documents, pièces jointes, historique) ?
- **QE-05** — Après la fin du contrat, **combien de temps** les données sont-elles conservées et
  quand sont-elles détruites ? Une attestation de destruction est-elle fournie ?
- **QE-06** — Un **accès en lecture** peut-il être maintenu N mois après la résiliation ?
- **QE-07** — Le contrat s'oppose-t-il à ce que le garage lise sa propre base de données via un
  outil tiers ?
- **QE-08** — Le logiciel permet-il de **saisir une facture en forçant son numéro** ? *(Ce n'est
  pas une question d'export : elle décide de la procédure de marche arrière, §13.4. Si l'éditeur
  ne répond pas, la réponse se teste sur la copie restaurée pendant la répétition générale de S-1.)*

**Conserver toutes les réponses, y compris les non-réponses.** Un refus écrit d'export, ou un
silence de 30 jours, est un élément utile — commercialement et, le cas échéant, juridiquement.

### 7.3 Risques juridiques et contractuels

| # | Risque | Ce qu'il faut vérifier | Atténuation |
|---|---|---|---|
| **R-01** | **Reconduction tacite** du contrat DMS avec préavis long (souvent 3 à 6 mois pour 12 mois reconduits) | Date d'échéance et préavis, **avant d'annoncer une date de bascule** | Lire le contrat en S-8. Le calendrier de migration se cale sur le préavis, jamais l'inverse |
| **R-02** | **Données hébergées chez l'éditeur** : aucun accès direct possible | Type d'hébergement (§1.2, étape C) | Détecter tôt ; la voie est exclusivement `QE-01`, avec un délai à intégrer au planning |
| **R-03** | **Frais d'extraction** facturés par l'éditeur, parfois élevés | `QE-02` | Les budgéter dès la proposition commerciale. Un garage qui découvre 3 000 CHF de frais au dernier moment annule le projet |
| **R-04** | **Clause interdisant l'accès tiers / la rétro-ingénierie** : lire directement la base peut violer la licence, même si les données appartiennent au garage | `QE-07` + le contrat | Distinguer nettement : **les données sont au garage, le schéma est à l'éditeur**. Demander l'export officiel d'abord (`D-00`) ; extraire en lecture seule sous mandat écrit ; ne pas publier ni réutiliser le schéma ; ne pas transformer l'adaptateur en produit |
| **R-05** | **Absence de base légale nLPD** pour le traitement par @laupernoe | Contrat de sous-traitance (art. 9 nLPD), registre des activités | Mandat écrit signé **avant** la première extraction (§1.1) |
| **R-06** | **Obligation de conservation** : les livres et pièces comptables se conservent **10 ans** (CO art. 958f ; à croiser avec la LTVA et la fiduciaire) | Ce que la fiduciaire conserve déjà de son côté | La migration ne libère de rien : **archive froide** (`D-20`) constituée et documentée. Ne jamais détruire les données source avant la fin du délai |
| **R-07** | **Un employé s'oppose** au traitement de ses données (comptes, pointages) | — | `D-10` et `D-12` : ni les pointages ni les comptes ne sont repris. Le risque disparaît par le périmètre |
| **R-08** | **La base source contient les données d'un autre garage** (installation mutualisée, groupe) | Vérifier à l'étape B/D de l'investigation | **Arrêt immédiat.** On n'extrait pas les données d'un tiers, même par accident. Le filtrage se fait côté source, pas après extraction |
| **R-09** | **Écart de chiffre d'affaires** constaté après bascule et imputé à la migration | — | `CR-07` avec un écart de 0 centime, tracé et signé avant le GO. C'est la seule protection |
| **R-10** | **Perte d'une donnée annoncée comme reprise** | — | §2.6 lu, ligne par ligne, avec le garagiste, et contresigné. Une perte annoncée est un choix ; une perte découverte est une faute |

---

## 8. Décisions à prendre et prochaines actions

### 8.1 À valider par @laupernoe

| # | Décision | Défaut proposé |
|---|---|---|
| 1 | Horizon de reprise des clients (`D-07`) | 5 ans sans document ni véhicule ⇒ archive froide |
| 2 | Horizon de reprise de l'historique atelier (`D-08`) | 24 mois, 36 si le volume le permet |
| 3 | Les documents anciens vont-ils en archive lecture seule (`D-05`) ou dans la chaîne étape 2 ? | Archive pour tout ce qui est soldé, chaîne pour les créances ouvertes |
| 4 | L'import est-il un CLI seul, ou aussi un endpoint admin ? | CLI seul en étape 1-2 |
| 5 | L'archive froide est-elle hébergée par DFA (service payant) ou remise au garage ? | Remise au garage + copie chiffrée chez DFA pendant 12 mois |
| 6 | Pivot d'année à 2 chiffres (`N-05`) | 30 |
| 7 | **Numéro de client d'origine** : dans `client.numero` ou dans `reference_externe` ? (`D-26`, §10.2) | Option A — `numero` = numéro source verbatim, compteur calé au maximum observé |
| 8 | **Véhicule sans marque ou sans modèle** — `NOT NULL` en base (`D-27`, §10.3) | Déduction depuis le libellé, puis sentinelle lisible `MODÈLE INCONNU` + `identification_incomplete` |
| 9 | **Date d'expertise sans résultat** (`D-28`, §10.3) | Note véhicule, **pas** de ligne `vehicule_expertise` — on n'invente pas un résultat de MFK |
| 10 | **`ordre_reparation` doit-il recevoir `origine` + `numero_origine` ?** (§10.5, `Z-17`) | Oui — coût nul aujourd'hui, élevé après la première bascule. À arbitrer avec `expert-database` |
| 11 | **Marche arrière** : l'ancien système accepte-t-il de forcer un numéro de facture ? (§13.4, `QE-08`) | À tester en S-1. Défaut si non : annulation par avoir dans DFA |

### 8.2 À transmettre aux autres experts

| Destinataire | Contrainte issue de ce document |
|---|---|
| ~~**expert-facturation** (étape 2)~~ | ✅ **HONORÉ** dans `0010_facturation.sql` : `origine enum('dfa','reprise')`, `numero_origine`, `tva_non_ventilee`, `taux_tva_pourmille` au niveau document, `ecart_reprise_centimes`, type de ligne `ecart_reprise`, régime TVA `marge` pour l'avant-2018, index `document_vente_numero_origine_uk`, motif de bulletin `creance_reprise`. **La contrainte a été prise en compte avant qu'elle ne coûte cher** — c'est le seul point du document qui soit déjà réglé. Détail et protocole d'écriture : §10.4 |
| **expert-database** (étape 1) | Colonne `origine_lot_id uuid null` + index partiel sur les tables recevant un import ; tables de reprise sous RLS `FORCE` avec `USING` **et** `WITH CHECK` ; FK composites `(tenant_id, lot_id)` sur le modèle de `site_tenant_id_uk` (§5.2, §5.4). **Rien de tout ceci n'est en base** (`Z-20`). ⚠️ **Nouveau, et urgent** : `ordre_reparation` doit recevoir `origine` + `numero_origine` comme `document_vente` (§10.5, `Z-17`) — coût nul tant qu'aucun garage n'est en production |
| **expert-metier** | Les champs sans équivalent source (origine de ligne, payeur, consentements, conditions datées) doivent tolérer un état « inconnu / repris » sans casser une règle métier. Une règle qui exige une valeur qu'aucun système source ne fournit rend la reprise impossible (§2.5) |
| **expert-tests** | Le test d'isolation d'import (§5.4) et le test d'idempotence (« deux passes du même fichier ⇒ mêmes UUID, aucun doublon ») sont des tests de la règle n°1 du projet, pas des tests de confort |
| **expert-devops** | Le staging peut peser plusieurs Go ; prévoir l'espace, la sauvegarde avant/après import, et la procédure de restauration testée exigée au GO (§6.3, critère 6) |

### 8.3 Ce qui débloque la suite, dans l'ordre

1. **Une seule visite chez un garage** avec la fiche §1.4 et la méthode §1.2. Un vrai export d'une
   vraie installation vaut plus que dix pages d'hypothèses, et transformera les colonnes
   « rôle du champ source » de la §2 en vrais noms de champs.
2. **Un contrat de licence lu** (`R-01`, `R-04`). Il peut décaler la bascule de six mois : le
   savoir maintenant coûte une heure, le savoir plus tard coûte un client.
3. **Une demande d'export envoyée à un éditeur** (`QE-01`). La réponse — ou son absence — calibre
   tout le reste et se mesure en semaines.
4. Puis seulement : écrire l'adaptateur et les chargeurs (§5.1). Le code est la partie facile et
   la dernière ; l'investigation est la partie difficile et la première.

---

## 9. Ordre de bascule et graphe de dépendances

> Écrit contre le schéma réel (`0005` → `0010`). Chaque « ce qui casse » nomme la contrainte
> PostgreSQL qui se déclenche, ou dit explicitement qu'**aucune** ne se déclenche — c'est le
> second cas qui coûte cher.

### 9.1 La règle qui gouverne l'ordre

L'intuition « clients avant véhicules, véhicules avant historique » est juste mais insuffisante.
La vraie règle est plus exigeante :

> **Une entité ne s'écrit que lorsque toutes les dates qui la datent sont connues.**

Parce que trois tables de destination sont **historisées avec une contrainte d'exclusion GiST** —
`vehicule_plaque`, `vehicule_detention`, `client_condition` — et qu'une contrainte d'exclusion ne
pardonne pas une date approximative : elle rejette la deuxième ligne, pas la mauvaise. Or les
dates qui datent un véhicule (depuis quand ce client le détient, depuis quand il porte cette
plaque) ne sont **pas** dans le fichier véhicules : elles sont dans les documents, qui se
chargent après. D'où le découpage en deux temps de la §9.3.

### 9.2 Les phases, dans l'ordre

| # | Phase | Écrit dans | Dépend de |
|---|---|---|---|
| **0** | **Socle du tenant** | `tenant`, `site`, `utilisateur` | Rien. Créé à la main, jamais importé (`D-12`) |
| **1** | **Paramétrage** | `parametre_atelier`, `parametre_site`, `taux_horaire`, `prestation`, `compteur_document` | Phase 0. Ressaisi à la main (`D-13`) |
| **2** | **Profilage des dates** — *ne écrit rien en base métier* | `reprise_ligne_source` (staging) uniquement | Extraction complète, **documents compris** |
| **3** | **Clients** | `client`, puis `client_adresse` / `contact` / `condition` / `note` | Phase 1 (compteur), phase 2 (dédoublonnage) |
| **4** | **Groupes de clients** — 2ᵉ passe sur `client` | `client.groupe_client_id` | Phase 3 complète |
| **5** | **Véhicules** | `vehicule` | Phase 3 (`proprietaire_economique_client_id`) |
| **6** | **Plaques et détentions** | `vehicule_plaque`, `vehicule_detention` | Phases 2, 3, 5 — **c'est la phase critique** |
| **7** | **Satellites véhicule** | `vehicule_kilometrage`, `_expertise`, `_campagne` | Phase 5 |
| **8** | **Ordres de réparation** | `ordre_reparation`, `ligne_or` | Phases 3, 5 (+ site, réceptionnaire) |
| **9** | **Travaux reportés** | `vehicule_travail_reporte` | Phase 8 (FK `..._fk_or_origine`, posée en `0008`) |
| **10** | **Factures reprises** | `document_vente` + `ligne_document` + `document_vente_tva` | Phases 3, 5, 8. **Deux temps** (§10.4) |
| **11** | **Avoirs repris** | `document_vente` (type `avoir`) | Phase 10 : `facture_annulee_id` doit exister |
| **12** | **Paiements et soldes** | `paiement`, `imputation_paiement` | Phase 10 |
| **13** | **Calage des compteurs** | `compteur_document` | Phases 3, 8, 10 terminées |
| **14** | **Clôture des périodes comptables** | `periode_comptable` | **Tout le reste. En dernier, sans exception** |

### 9.3 Ce qui casse, précisément

| Inversion | Ce qui se passe | Bruyant ou silencieux ? |
|---|---|---|
| **Véhicule avant client** | `vehicule_fk_proprietaire_eco` échoue — mais **seulement si** le leaser est renseigné, ce qui est rare. Puis `vehicule_detention_fk_client` échoue à la phase 6 | Bruyant, mais **tardif** : l'erreur sort 40 minutes après la vraie cause |
| **Détention avant profilage des dates** | `vehicule_detention.du` est `NOT NULL`. Sans date de premier document, le chargeur met la date d'import. Résultat : des OR et des factures **datés avant le début de la détention** du véhicule qu'ils concernent | ⚠️ **Silencieux.** Aucune contrainte ne relie la date d'un document à la période de détention. La fiche véhicule est fausse et personne ne le voit avant qu'un client conteste |
| **Deux détenteurs successifs écrits avec des périodes qui se chevauchent** | `vehicule_detention_unicite_excl` (EXCLUDE GiST) rejette la 2ᵉ ligne | Bruyant, mais le message ne dit pas *laquelle* des deux est fausse |
| **Plaque réattribuée écrite sans dates** | Deux véhicules, même plaque, `du` = date d'import, `au` = NULL ⇒ `vehicule_plaque_collision_excl` rejette. Le chargeur s'arrête sur un véhicule arbitraire — celui qui passe en second dans le fichier | Bruyant et **trompeur** : l'erreur désigne le mauvais véhicule |
| **Plaques chargées avant identification des plaques interchangeables / professionnelles** | L'EXCLUDE ne se lève que `where not interchangeable and not professionnelle and pays = 'CH'`. Un jeu de plaques interchangeables non déclaré est traité comme une collision et **une des deux voitures perd sa plaque** | Bruyant, mais la « correction » naturelle (clôturer une plaque) détruit une donnée juste |
| **Dédoublonnage clients après le chargement des véhicules et documents** | Il faut alors fusionner *a posteriori* : repointer les FK, et `client_fusionne_inactif_chk` impose `statut = 'inactif'` sur la fiche absorbée. Or `dfa_app` **n'a pas le droit `DELETE`** sur `client` : la fiche fusionnée reste à vie | ⚠️ **Irréversible.** Le fichier client porte définitivement les doublons désactivés |
| **OR avant véhicule** | `ordre_reparation_fk_vehicule` (`ordre_reparation.vehicule_id` est `NOT NULL`) | Bruyant, immédiat |
| **Facture avant OR** | Rien ne casse : `document_vente.ordre_reparation_id` est nullable. Mais le lien facture ↔ OR est **perdu**, et `ligne_document.ligne_or_id` reste vide | ⚠️ **Silencieux.** Le garagiste ouvre un OR clôturé et ne voit pas sa facture |
| **Avoir avant sa facture** | `document_vente_avoir_facture_annulee_chk` : un avoir **exige** `facture_annulee_id` | Bruyant |
| **Clôture d'une période comptable avant l'import des documents de cette période** | `document_vente_verifier_periode` lève `ZDFA5` au passage brouillon → émis. **Toutes les lignes du document ont déjà été écrites** quand l'erreur survient | Bruyant mais **coûteux** : reprise du lot après nettoyage manuel |
| **Calage du compteur avant la fin du chargement des documents** | Le compteur est calé sur un maximum partiel. La première facture DFA porte un numéro **déjà utilisé** par un document repris chargé ensuite ⇒ `document_vente_numero_uk` | Bruyant — le jour où le garage facture, c'est-à-dire au pire moment |
| **Import lancé avec `DATABASE_URL_MIGRATION`** (rôle `dfa_migrator`) | Les politiques `*_migrator` sont `using (true) with check (true)` : **le RLS ne filtre plus rien**. Un `tenant_id` erroné dans un chargeur écrit chez le voisin sans la moindre erreur | ⚠️ **Silencieux et catastrophique.** C'est exactement la faille que tout le projet évite (§5.1) |

### 9.4 Le découpage en deux temps du chargeur véhicule

C'est la conséquence pratique de la §9.1, et la seule partie de l'ordonnancement qui n'est pas
évidente :

```
Phase 2  (staging, aucune écriture métier)
  Pour chaque document source (facture, OR), extraire le triplet :
      (clé_véhicule, clé_client, date_document, plaque_imprimée_sur_le_document)
  Agréger par véhicule :
      premier_doc[véhicule], dernier_doc[véhicule]
      par (véhicule, client) : premier, dernier
      par (véhicule, plaque)  : premier, dernier
  → ces agrégats vivent dans le staging, ils sont la matière première des phases 6 et 13.

Phase 5  vehicule            -- attributs seuls, aucune date de relation
Phase 6  vehicule_plaque     -- du/au calculés en phase 2
         vehicule_detention  -- idem, invariant « un seul détenteur courant » vérifié AVANT insert
Phase 10 document_vente      -- rattaché aux véhicules et clients déjà en place
```

**Le corollaire à ne pas manquer** : même si l'on décide de **ne pas reprendre** l'historique des
documents (`D-08`), il faut quand même **l'extraire** pour dater les détentions et les plaques.
Extraction et reprise ne sont pas le même périmètre. C'est contre-intuitif, et c'est ce qui fait
que « on ne reprend que les clients et les véhicules » n'est jamais un projet plus simple.

### 9.5 Les deux passes qui n'ont pas d'ordre naturel

- **`client.groupe_client_id`** : auto-référence (`client_fk_groupe`, FK composite
  `(tenant_id, groupe_client_id) → client(tenant_id, id)`). Impossible à résoudre en une passe si
  la maison mère apparaît après sa filiale dans le fichier. Deuxième passe d'`UPDATE` après la
  phase 3, jamais un tri du fichier source (il n'y a aucune garantie qu'il soit triable).
- **`vehicule.fusionne_vers_vehicule_id` / `client.fusionne_vers_client_id`** : **jamais écrits
  par l'import** (`D-21`). La fusion est un geste du garagiste dans DFA, après la bascule.

---

## 10. Contraintes réelles de la destination

> Cette section est le contrat que le chargeur doit respecter, relevé dans les migrations
> `0005` → `0010`. Elle **remplace** la §2 en cas de divergence et **remplace** la §5.6.

### 10.1 Les sept règles non négociables

| # | Règle | Où elle est imposée | Ce qu'elle interdit à l'import |
|---|---|---|---|
| 1 | **`tenant_id` sur chaque table métier**, `NOT NULL`, avec RLS `ENABLE` + `FORCE` et politique `USING` **et** `WITH CHECK` | Toutes les migrations `0006` → `0010` | Lire un `tenant_id` depuis un fichier source (§5.4) |
| 2 | **Toute FK entre deux tables métier est composite `(tenant_id, cible_id)`** vers un `unique (tenant_id, id)` | ex. `client_adresse_fk`, `vehicule_detention_fk_client`, `document_vente_fk_facture_annulee` | Rattacher une entité d'un tenant à une entité d'un autre : c'est structurellement impossible, même RLS désactivé |
| 3 | **L'import se connecte en `dfa_app`**, jamais en `dfa_migrator` | `DATABASE_URL` vs `DATABASE_URL_MIGRATION` | Toute élévation de privilège « pour simplifier l'import ». Les politiques `*_migrator` (`using (true)`) sont réservées aux migrations de schéma |
| 4 | **Aucun `DELETE`** n'est accordé à `dfa_app`, sur aucune table métier — sauf `ligne_document` (lignes de brouillon) | `revoke delete on … from dfa_app` + assertions de fin de migration | ⚠️ **`importer annuler-lot` ne peut rien supprimer.** Voir §10.6 |
| 5 | **Append-only strict** sur `vehicule_kilometrage`, `client_consentement`, `document_vente_tva`, `imputation_paiement`, `bulletin_paiement`, `ordre_reparation_demande` : `SELECT, INSERT` seulement | grants + assertions | Corriger un relevé km importé par `UPDATE`. Un relevé faux se corrige par un **nouveau relevé** motivé |
| 6 | **Argent en centimes entiers.** `integer` sur les lignes, `bigint` sur les agrégats de document | `ligne_document.*_centimes`, `document_vente.total_*_centimes` | Tout flottant. Et tout dépassement : `ligne_document_montant_ttc_chk` plafonne à ±100 000 000 centimes (1 mio CHF) **par ligne** |
| 7 | **Immuabilité après émission** | `document_vente_verrouiller_apres_emission` (`ZDFA2`), `ordre_reparation_verrouiller_figes`, `client_verrouiller_type` (`ZDFA3`) | Rejouer un import sur un document déjà émis. L'idempotence de la §5.5 s'arrête à la porte de l'émission (§10.4) |

### 10.2 Client — corrections du mapping §2.1

| §2.1 disait | Le schéma dit | Conséquence pour le chargeur |
|---|---|---|
| `numero_ide` | **`client.ide`**, `CHECK ide ~ '^CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}$'` | Un IDE source `CHE-123.456.789 TVA`, `CHE123456789` ou `CHE-123.456.789 MWST` est **rejeté par la base**. Normaliser (retirer le suffixe, réinsérer les points) ; si le format reste invalide, `ide = NULL` + anomalie, jamais un `INSERT` qui échoue |
| `numero_origine` (nouveau champ) | **N'existe pas sur `client`.** Il y a `numero text NOT NULL` (unique par tenant) et `reference_externe text NULL` | Décision à prendre, cf. `D-26` ci-dessous |
| `type` déduit | `client_identite_chk` : `particulier` ⇒ `nom NOT NULL` · `entreprise` ⇒ `raison_sociale NOT NULL`. Trigger `client_verrouiller_type` (`ZDFA3`) | Un client source dont le seul champ nom est vide **ne peut pas être inséré du tout**. Il n'y a pas de fiche sans nom : ligne rejetée en anomalie bloquante, pas de fiche fantôme |
| `telephone`, `mobile`, `telephone_source` | **`telephone text`** (libre) et **`telephone_e164 text`** avec `CHECK ~ '^\+[1-9][0-9]{6,14}$'`. **Pas de colonne `mobile`** | La distinction fixe/mobile déduite du préfixe `07x` (§2.1) **n'a pas de destination**. Le numéro principal va en `telephone` (verbatim) et, s'il est normalisable, en `telephone_e164`. Les numéros supplémentaires vont en `client_contact` ou en note. Perte à ajouter à la §2.6 |
| `langue` par défaut = langue du tenant | `client.langue` est `NOT NULL`, enum `('fr','de','it')` | Confirmé : jamais de `NULL` possible, donc le choix du défaut est structurant. Le vérifier avec `CR-08` |
| une adresse `principale` | `client_adresse_principale_uk` : index unique partiel `(tenant_id, client_id) where type='principale' and actif` | Deux adresses source marquées principales ⇒ échec du 2ᵉ `INSERT`. Dédoublonner **avant**, la 2ᵉ devient `facturation` ou `actif = false` |
| conditions commerciales | `client_condition_periode_excl` (EXCLUDE GiST sur `daterange(valide_du, valide_au)`) | Une seule ligne à l'import, `valide_du` = date de bascule, `valide_au = NULL`. Deux lignes chevauchantes sont rejetées par la base |
| consentements | `client_consentement` : `SELECT, INSERT` seulement, append-only | Cohérent avec `D-11` (non repris). Si un jour on reprend un consentement prouvé, il s'insère, il ne se corrige jamais |

**`D-26` — Où va le numéro de client d'origine ?** Deux options, à trancher avec le garagiste :

- **Option A (recommandée)** — `client.numero` = **numéro source verbatim**,
  `reference_externe` = clé technique source. Le garagiste continue d'appeler ses clients par le
  numéro qu'il connaît ; les anciens listings papier restent utilisables. Condition : les numéros
  source sont uniques, non vides, et il faut caler `compteur_document` (`type_document = 'client'`)
  au maximum numérique observé.
- **Option B** — `client.numero` = numérotation DFA neuve, `reference_externe` = numéro source.
  À retenir uniquement si les numéros source sont en collision, absents, ou dans un format que
  DFA ne peut pas continuer. La recherche par ancien numéro doit alors porter sur
  `reference_externe`, ce qui est une exigence à vérifier auprès de `expert-api` avant de choisir.

À la différence des documents, **le numéro de client n'a pas de valeur légale** : l'option A est
un confort d'exploitation, pas une obligation. C'est pour cela qu'elle est ouverte.

### 10.3 Véhicule — corrections du mapping §2.2

| §2.2 disait | Le schéma dit | Conséquence pour le chargeur |
|---|---|---|
| `marque_id` (référentiel), `modele` | **`vehicule.marque text NOT NULL`** et **`modele text NOT NULL`**, avec `CHECK length(btrim(...)) > 0` | ⚠️ **Un véhicule sans modèle ne peut pas être inséré.** Cas fréquent sur les tableurs et les vieux fichiers. Il faut une valeur de repli — voir `D-27` |
| VIN validé 17 caractères sans I/O/Q | `vehicule_vin_format_chk` : `vin is null or length(vin) <> 17 or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'` | Un VIN de **17 caractères contenant un `O`, un `I` ou un `Q`** (la faute de frappe classique) est **rejeté par la base**. Un VIN de 16 ou 18 caractères passe sans contrôle |
| unicité du VIN | `vehicule_vin_actif_uk` : unique partiel `(tenant_id, vin) where vin is not null and statut = 'actif'` | Deux véhicules actifs avec le même VIN dans le source ⇒ échec. Il faut trancher **avant** : lequel reste `actif`, lequel passe `archive` + `motif_archivage = 'doublon'` |
| plaque, `du` reconstruit ou `null` | **`vehicule_plaque.du date NOT NULL`** + EXCLUDE `vehicule_plaque_collision_excl` | ⚠️ `du = NULL` est impossible. Voir §11.2 |
| détention, `motif_fin = 'correction'` | `motif_fin_detention` = `('vente','reprise','deces','correction','export')` · `vehicule_detention_motif_fin_chk : (au is null) = (motif_fin is null)` | ✅ Confirmé : `'correction'` existe et est le bon choix quand on ignore la cause réelle. Fermer une détention **oblige** à donner un motif |
| kilométrage, `source = 'import'` | `source_kilometrage` = `('reception','ordre_reparation','expertise','vente','declaratif','import')` | ✅ Confirmé, la valeur `'import'` existe. `releve_le timestamptz NOT NULL` : sans date source, utiliser la date du document d'où le km est tiré, jamais la date d'import |
| expertise « une seule ligne, sans détail » | **`vehicule_expertise.resultat NOT NULL`** (enum `accepte` / `accepte_avec_defauts` / `refuse`) | ⚠️ Une date d'expertise nue **ne suffit pas** à créer la ligne. Il faut inventer un résultat, ce qui est interdit. Voir `D-28` |
| travaux reportés | `urgence NOT NULL` (enum), `date_constat NOT NULL`, `designation NOT NULL` non vide | Un travail reporté sans urgence source ⇒ défaut `'a_surveiller'` (le moins engageant), jamais `'urgent'` |
| campagnes, garantie | `vehicule.garantie_debut/_mois/_km` existent · `vehicule_campagne` existe | Cohérent avec §2.2 : garantie reconstruite « estimée », campagnes non reprises |
| identification incomplète | **`vehicule.identification_incomplete boolean NOT NULL DEFAULT false`** | ✅ La colonne existe : c'est le drapeau à lever sur tout véhicule sans VIN **ou** dont le VIN a été refusé |

**`D-27` — Véhicule sans marque ou sans modèle.** `NOT NULL` sur les deux. Trois voies, par ordre
de préférence :

1. **Déduire du texte disponible** — un champ unique « VW Golf 1.6 TDI » se coupe au premier
   espace : `marque = 'VW'`, `modele = reste`. Fiable quand la marque est en tête, ce qui est la
   convention de saisie dans tous les garages observés. À valider par échantillon.
2. **Déduire du VIN** — les 3 premiers caractères (WMI) identifient le constructeur. N'aide pas
   pour le modèle.
3. **Sentinelle explicite** — `modele = 'MODÈLE INCONNU'` (jamais `'-'`, jamais une chaîne vide
   déguisée), `identification_incomplete = true`, anomalie `avertissement`, et la liste sort en
   nettoyage manuel. **Une sentinelle lisible dans l'UI vaut mieux qu'un tiret que personne ne
   sait interpréter dans deux ans.**

**`D-28` — Expertise sans résultat.** Ne pas créer la ligne `vehicule_expertise`. Une date
d'expertise sans résultat n'est pas une expertise : c'est une **échéance**. Deux issues :
soit le champ source est manifestement une *prochaine* échéance et il n'a pas sa place dans une
table d'expertises passées, soit c'est une expertise passée dont on ignore le résultat, et
inventer `'accepte'` reviendrait à certifier un contrôle technique qu'on n'a pas vu. La date part
en **note véhicule** (`nature = 'interne'`), et l'expertise réelle se saisit au premier passage.
⚠️ **À VALIDER AVEC @laupernoe** : c'est un arbitrage entre perdre la relance MFK (RM-29) sur le premier
cycle et écrire une donnée fausse. Le document tranche pour la seconde option ; le garagiste
pourrait préférer l'inverse.

### 10.4 Facture reprise — le protocole d'écriture en deux temps

**C'est la contrainte la plus contre-intuitive de tout le document.** Elle découle de deux
triggers de `0010_facturation.sql` :

```
document_vente_creation_brouillon        BEFORE INSERT
  → « tout document naît en brouillon (MD-19) — aucune insertion directe dans un autre statut »
document_vente_verrouiller_apres_emission BEFORE UPDATE
  → dès que old.statut <> 'brouillon', seule une liste blanche de 13 colonnes reste modifiable
```

**Il est donc impossible d'insérer une facture reprise directement à l'état émis.** Le chargeur
procède ainsi, par document :

```
1. INSERT  document_vente
     origine        = 'reprise'
     statut         = 'brouillon'          -- imposé par le trigger BEFORE INSERT
     numero         = NULL                 -- imposé par document_vente_numero_brouillon_chk
     numero_origine = '<numéro source verbatim>'   -- imposé par document_vente_origine_numero_chk
     numero_sequence= NULL                 -- idem : une reprise ne consomme pas la séquence
     exercice       = NULL                 -- imposé par document_vente_exercice_brouillon_chk
     emis_le        = NULL                 -- imposé par document_vente_emis_le_brouillon_chk
     client_id, site_id, client_designation_figee, langue_figee,
     adresse_facturation_figee             -- tous NOT NULL : à fabriquer, cf. ci-dessous
     total_ht_centimes, total_tva_centimes, total_ttc_centimes,
     ecart_reprise_centimes = total_ttc − total_ht − total_tva
                                           -- document_vente_totaux_coherents_chk

2. INSERT  ligne_document (× n)            -- si les lignes sont exportables
   INSERT  document_vente_tva (× régimes)  -- append-only, une ligne par (régime, taux)

3. UPDATE  document_vente SET statut='emis', numero=numero_origine,
                              exercice=year(date_document), emis_le=…
   → passe verifier_transition_document  (brouillon→emis autorisé pour les 4 types)
   → passe document_vente_verifier_periode  UNIQUEMENT si aucune période comptable close
     ne couvre date_document  (ZDFA5) — d'où la phase 14 de la §9.2

4. Le document est désormais VERROUILLÉ. Un rejeu de l'import ne peut plus le toucher.
```

**Points de vigilance issus des contraintes réelles :**

| Contrainte | Ce qu'elle impose |
|---|---|
| `document_vente.client_id NOT NULL` | Le « client technique repris non identifié » de la §2.4 n'est pas une commodité, c'est une **obligation**. Il doit être créé en phase 3, avant tout document |
| `client_designation_figee`, `langue_figee`, `adresse_facturation_figee` (jsonb) `NOT NULL` | À **fabriquer** depuis la fiche client au moment de l'import, pas depuis le document source (qui ne les porte généralement pas). ⚠️ Perte à annoncer : l'adresse figée sur une facture reprise est l'adresse **actuelle** du client, pas celle imprimée à l'époque. Si le PDF d'origine existe, il fait foi (`D-04`) |
| `document_vente.site_id NOT NULL` | Sur un garage mono-site, trivial. Sur un multi-site, le site d'émission doit être déterminé — s'il n'est pas dans le source, un seul site par défaut, décidé et journalisé |
| `document_vente_taux_tva_doc_reprise_chk` | `taux_tva_pourmille` au niveau document n'est autorisé **que** si `tva_non_ventilee = true` **et** `origine = 'reprise'`. C'est exactement le cas « TVA globale non ventilée » de la §2.4 : la base l'a prévu |
| `type_ligne_document` contient `'ecart_reprise'` | L'écart Σlignes ≠ total (§4.6, `N-06`) a une **ligne dédiée et visible**, plus une colonne `ecart_reprise_centimes` au niveau document. L'écart n'est ni absorbé ni caché |
| `ligne_document.taux_tva_pourmille NOT NULL` et `date_prestation NOT NULL` | Une ligne sans taux ni date n'existe pas. Sur un document à TVA non ventilée : soit on n'importe **aucune** ligne (entête + PDF seuls, §2.4), soit on importe les lignes avec le taux du document. Ne pas mélanger les deux au sein d'un même lot |
| `ligne_document_mode_ttc_lot_pilote_chk` | `mode_calcul_tva = 'ttc'` obligatoire au lot pilote. Un source qui raisonne en HT doit être converti **à l'import**, avec le contrôle Σ = total |
| `regime_tva` contient `'marge'` | Prévu pour « documents repris antérieurs à 2018 (imposition de la marge, abrogée au 01.01.2018) ». Le régime existe pour l'historique — l'utiliser plutôt que de forcer `'normal'` |
| `document_vente_numero_origine_uk` | Unique `(tenant_id, type_document, numero_origine)`. **C'est l'idempotence de l'import garantie par la base** : un numéro source ne peut pas être importé deux fois, même si `correspondance_reprise` est perdue |
| `document_vente_numero_uk` | Unique `(tenant_id, type_document, numero)` **sans distinction d'origine** : la non-collision entre numéros repris et numéros DFA est structurelle, comme demandé en §8.2 |
| Avoir repris | `document_vente_avoir_facture_annulee_chk` (facture obligatoire), `document_vente_avoir_motif_emis_chk` (motif obligatoire à l'émission), `document_vente_signe_avoir_chk` (**tous les totaux ≤ 0**). Un source qui stocke les avoirs en positif doit être **inversé**, et le motif absent devient `motif_avoir = 'autre'` + `motif_avoir_libre` explicite |
| `bulletin_paiement.motif` contient `'creance_reprise'` | Les créances ouvertes reprises peuvent recevoir un bulletin de versement QR sans être confondues avec une relance ordinaire |

### 10.5 Ordre de réparation repris — le trou identifié

`ordre_reparation` (`0008_atelier.sql`) porte `numero text NOT NULL` avec
`ordre_reparation_tenant_numero_uk unique (tenant_id, numero)`, mais **ni colonne `origine`, ni
colonne `numero_origine`**, à la différence de `document_vente`.

Conséquence : un OR repris n'a pas d'endroit où déposer son numéro d'origine sans occuper
`numero`, c'est-à-dire sans entrer dans la même série que les OR que DFA va émettre — ce que
`D-23` interdit pour les documents et qui pose le même problème ici (les OR ne sont pas des
pièces comptables, mais le garagiste les cite au téléphone et les retrouve sur ses fiches).

Trois issues, par ordre de préférence :

1. **Aligner `ordre_reparation` sur `document_vente`** : migration *expand* ajoutant
   `origine public.origine_document NOT NULL DEFAULT 'dfa'` et `numero_origine text NULL`, avec
   l'index unique correspondant. Le coût est **nul aujourd'hui** (aucune donnée en production) et
   élevé après la première bascule. ⚠️ **À VALIDER AVEC @laupernoe** — c'est une demande à adresser à
   `expert-database`, hors périmètre de ce document.
2. **Préfixer** les numéros d'OR repris (`R-2019-0042`) dans `numero`. Fonctionne, ne casse rien,
   mais brouille la lecture et rend le tri chronologique faux.
3. **Ne pas reprendre les OR** et se contenter des factures (§3, `D-08`). Défendable si le garage
   consulte peu son historique atelier — c'est précisément ce que mesure `QG-04`.

Autres contraintes d'un OR repris, s'il est repris : `site_id`, `client_id`, `vehicule_id`,
`client_designation_figee`, `adresse_facturation_figee`, `conditions_figees` sont **tous
`NOT NULL`** ; `statut` prend directement `'cloture'` (aucun trigger `BEFORE INSERT` ne l'interdit,
à la différence de `document_vente`) ; le trigger `ordre_reparation_verrouiller_figes` interdit de
réécrire les valeurs figées ensuite ; `ligne_or.origine` prend `'commandee'` faute de mieux
(§2.5) et `payeur` prend `'client'`.

### 10.6 `annuler-lot` — correction de la §5.5

La §5.5 annonce qu'`importer annuler-lot <id>` « supprime les entités créées par ce lot ».
**C'est impossible avec le rôle `dfa_app`** : `revoke delete … from dfa_app` est posé sur chaque
table métier, avec une assertion de fin de migration qui fait échouer la migration si le droit
réapparaît. Seule `ligne_document` accepte un `DELETE` (lignes de brouillon).

La commande doit donc être redéfinie :

| Portée | Ce que `annuler-lot` peut réellement faire |
|---|---|
| **Documents non encore émis** (brouillons) | `statut = 'abandonne'` (transition autorisée), suppression des `ligne_document` |
| **Documents émis** | **Rien.** Un document émis, même repris, ne s'annule que par avoir (`D-24`). Il n'y a pas de retour en arrière |
| **Clients** | `statut = 'inactif'`. La fiche reste. Le numéro reste consommé |
| **Véhicules** | `statut = 'archive'` + `motif_archivage`. La fiche reste |
| **Relevés km, consentements, récapitulatifs TVA** | **Rien** : append-only |

**Conséquence opérationnelle, et elle est structurante :** la mise au point d'un import ne se fait
**jamais** par annulation, mais par **re-création du tenant bac à sable**. La procédure de mise au
point est « je détruis le tenant `<garage>-bac` et je rejoue l'import complet », et elle doit être
assez rapide (`pnpm db:migrate` + import) pour être exécutée dix fois. `annuler-lot` reste utile
pour reprendre un lot interrompu en cours de route, pas pour défaire une bascule.

Corollaire pour le jour J : **la marche arrière n'est pas une suppression dans DFA** (§13.4).

### 10.7 Verdict sur `detection-doublons.ts`

`apps/api/src/clients/detection-doublons.ts` implémente `detecterDoublons(tx, tenantId, criteres)`
— quatre critères exacts après normalisation (`ide` = 1.0, `email` = 0.9, `telephone` = 0.8,
`nom + NPA` = 0.6), maximum 5 candidats par critère, tri par score décroissant.

**Sert-il à la reprise ? Partiellement, et pas là où on l'attend.**

| Usage | Verdict |
|---|---|
| **Produire la « liste de fusion à traiter » après l'import** (`D-21`) | ✅ **Oui, et c'est exactement le bon outil.** Ses critères correspondent aux règles « fusion automatique proposée » de la §4.3, sa prudence (égalité stricte, jamais de similarité floue `pg_trgm %`) correspond à la consigne conservatrice de la reprise, et son score permet de trier la liste par valeur |
| **Dédoublonner le fichier source avant insertion** | ❌ **Non.** Il compare un candidat aux clients **déjà en base**. Il ne voit pas deux lignes du fichier source qui sont doublons entre elles tant qu'aucune des deux n'est insérée. Or c'est le cas dominant à l'import : les 600 doublons sont **dans le fichier**, pas entre le fichier et la base |
| **Passer 8 000 clients** | ❌ **Non, tel quel.** La fonction fait jusqu'à 4 requêtes par client appelé — soit ~32 000 allers-retours pour un fichier moyen. Ce n'est pas un défaut de conception : elle est écrite pour le comptoir (une fiche en cours de saisie), pas pour un lot |
| **Le critère `nom + NPA`** | ⚠️ Il joint `client_adresse` (`type = 'principale' and actif`). Pendant l'import, si les adresses sont écrites après les clients (phase 3), ce critère **ne remonte rien**. Il faut écrire client + adresse dans la même transaction, ou lancer la détection après la phase 3 complète |

**Ce qu'il faut en plus — et ce qu'il ne faut pas dupliquer :**

Un **dédoublonnage ensembliste sur le staging**, en une requête `GROUP BY` sur
`reprise_ligne_source`, appliquant les **mêmes clés normalisées** que `detecterDoublons` — IDE,
`lower(email)`, téléphone E.164, `normaliser_recherche(nom) + NPA`. Le point important est de
réutiliser **la fonction SQL `normaliser_recherche()`** (posée en `0003`) et non de réécrire une
normalisation en TypeScript : deux normalisations différentes produiraient deux vérités, et le
garagiste verrait des candidats à fusion qui ne se retrouvent pas à la recherche.

Les exclusions de la §4.3 (e-mails génériques, téléphone du garage, fiches « comptoir » /
« client de passage ») sont **absentes** de `detecterDoublons`, et c'est normal : au comptoir, un
faux candidat se rejette d'un coup d'œil. À l'import, une clé de regroupement sur `info@garage.ch`
fusionnerait des centaines de fiches. **La liste d'exclusion est donc une donnée d'entrée du lot
d'import, construite avec le garagiste**, pas une constante du code.

---

## 11. Pièges de correspondance — les cas du terrain suisse

> Chaque cas ci-dessous est décrit par : ce qu'on observe, ce que la base fait si on ne fait rien,
> et la règle retenue. Les cas sont réels et récurrents ; les **volumes** attendus ne le sont pas
> et devront venir du profilage (§1.3).

### 11.1 Le VIN saisi à la main

**Ce qu'on observe.** Le VIN est recopié depuis le permis de circulation, à la main, souvent par
téléphone. Les confusions constantes : `O`↔`0`, `I`↔`1`, `Q`↔`0`, `S`↔`5`, `B`↔`8`. On voit aussi
des VIN tronqués aux 10 derniers caractères (habitude d'un ancien logiciel qui limitait le champ),
des VIN avec des espaces tous les 4 caractères, et des VIN qui sont en fait le **numéro de moteur**.

**Ce que fait la base.** `vehicule_vin_format_chk` ne contrôle **que** les VIN de 17 caractères :
`vin is null or length(vin) <> 17 or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'`. Donc :

- VIN de 17 caractères contenant un `O` ⇒ `INSERT` **rejeté**, le chargeur s'arrête.
- VIN de 10 caractères (tronqué) ⇒ **accepté sans broncher**, et il devient une clé de
  déduplication silencieusement fausse.

**Règle retenue.**

1. Normaliser d'abord ce qui est sûr : `upper()`, suppression des espaces, des tirets et des points.
2. **Ne jamais transliterer `O`→`0` automatiquement.** Un VIN corrigé à tort est pire qu'un VIN
   absent : il devient une clé, et il rattache le mauvais véhicule au mauvais client. La correction
   `O`→`0` est **proposée** dans la liste de nettoyage, appliquée par un humain.
3. VIN de 17 caractères invalide ⇒ `vin = NULL`, `identification_incomplete = true`, valeur brute
   conservée dans `reprise_ligne_source` **et** recopiée en `client_note`/note véhicule pour rester
   visible au comptoir, anomalie `avertissement`.
4. VIN de longueur ≠ 17 ⇒ accepté (la base l'accepte : véhicules d'avant 1981, machines,
   remorques), mais **jamais utilisé comme clé de déduplication** s'il fait moins de 17 caractères.
   Clé de repli : `plaque active + marque + modèle` (§4.4).
5. Un VIN identique sur deux véhicules actifs déclenche `vehicule_vin_actif_uk`. **Trancher avant
   l'insert**, jamais après : celui qui porte le document le plus récent reste `actif`, l'autre
   passe `archive` + `motif_archivage = 'doublon'`. L'index étant **partiel** (`where … statut =
   'actif'`), l'archivé libère le VIN — c'est exactement pour ce cas que RM-32 l'a rendu partiel.

### 11.2 La plaque réattribuée

**Ce qu'on observe.** En Suisse, la plaque suit le **détenteur**, pas le véhicule. Un client
change de voiture et garde `VS 12345`. Dans un DMS ancien, il n'y a qu'un champ plaque par
véhicule, écrasé ou laissé tel quel : on retrouve donc la même plaque sur deux, parfois trois
véhicules du fichier, sans aucune date pour les départager.

**Ce que fait la base.** `vehicule_plaque_collision_excl` — EXCLUDE GiST sur
`(tenant_id, normaliser_recherche(valeur), daterange(du, au, '[)'))`, avec la levée
`where (not interchangeable and not professionnelle and pays = 'CH')`. Et `du date NOT NULL`.

Donc si le chargeur écrit naïvement `du = date_import, au = NULL` pour les deux véhicules :
le premier passe, **le second est rejeté**. Le chargeur s'arrête sur le véhicule qui se trouve en
second dans le fichier — c'est-à-dire un véhicule choisi par le hasard de l'ordre de tri, ce qui
rend le message d'erreur trompeur.

**Règle retenue** (elle raffine la §4.4, dont le point « `du = null` » est impossible) :

```
Entrée : plaques[] = { véhicule, valeur, premier_doc, dernier_doc }  -- issus de la phase 2
Grouper par normaliser_recherche(valeur) :

  Cas 1 — un seul véhicule porte la plaque
      du = premier_doc(véhicule)  ou, à défaut, date_1re_circulation, ou date de bascule
      au = NULL   (plaque active)

  Cas 2 — plusieurs véhicules, dates de documents disjointes  ← le cas normal
      trier par premier_doc
      pour chaque véhicule sauf le dernier :
          du = premier_doc, au = premier_doc(véhicule suivant)   -- intervalles jointifs
          → la plaque reste cherchable, en « correspondance historique » (RM-17)
      dernier véhicule : du = premier_doc, au = NULL              -- plaque active

  Cas 3 — plusieurs véhicules, dates chevauchantes ou absentes
      AUCUNE plaque n'est écrite. Anomalie BLOQUANTE, une par groupe.
      Le garagiste tranche avant le jour J : « laquelle de ces deux voitures roule aujourd'hui ? »
      C'est une question à laquelle il répond en deux secondes et à laquelle aucun algorithme
      ne peut répondre.

  Cas 4 — plaques interchangeables ou professionnelles (plaques U du garage)
      interchangeable = true / professionnelle = true → l'EXCLUDE ne s'applique pas.
      ⚠️ Ces cas doivent être IDENTIFIÉS AVEC LE GARAGISTE AVANT l'import : sans le drapeau,
      l'algorithme les traite comme des collisions (cas 2 ou 3) et clôture une plaque légitime.
```

**Ce que le garagiste doit savoir**, et qui se dit en une phrase : « la recherche par plaque
retrouvera aussi les véhicules qui l'ont portée avant — c'est voulu, et c'est marqué comme
historique. » Sans cette phrase, la première recherche qui remonte deux voitures passe pour un bug.

### 11.3 Le client en double dans le système d'origine

**Ce qu'on observe, dans l'ordre de fréquence.**

| Motif du doublon | Signature | Fusionnable automatiquement ? |
|---|---|---|
| Le client a déménagé et un employé a recréé une fiche | même nom, même téléphone, NPA différent | Oui si téléphone E.164 identique (score 0.8) |
| Saisi une fois par le comptoir, une fois par l'atelier | même nom, une fiche avec véhicules, l'autre vide | Oui — la fiche vide est absorbée |
| Madame et Monsieur, même ménage, même voiture | noms différents, même adresse, même véhicule | ❌ **Non. Ce ne sont pas des doublons.** L'écraser serait une faute |
| Le nom mal orthographié une fois (`Müller` / `Mueller` / `Muller`) | e-mail identique | Oui si l'e-mail n'est pas générique |
| Reprise ratée d'un système antérieur (`QG-01`) | doublons **systématiques**, souvent une fiche sur deux | ⚠️ Signal d'alerte : si le taux de doublons dépasse 15 %, la cause n'est pas la saisie, c'est une migration précédente. Le traitement change : on repart du fichier le plus ancien |
| Entreprise saisie une fois au nom du patron, une fois à la raison sociale | `Rossier Jean` et `Rossier SA`, même adresse, même IDE parfois | ❌ **Jamais automatiquement** — voir §11.4 |

**Ce que fait la base.** Rien ne l'empêche : `client` n'a **aucune** contrainte d'unicité métier
(seulement `(tenant_id, numero)`). Les doublons entrent tous. La sanction est ailleurs : ils sont
irréversibles, puisque `dfa_app` n'a pas `DELETE` sur `client` et que
`client_fusionne_inactif_chk` impose le statut `inactif` sur la fiche absorbée. **Un doublon
importé est un doublon à vie**, au mieux désactivé.

**Règle retenue.** Le dédoublonnage se fait **sur le staging, avant insertion** (§10.7), avec :

- **fusion automatique** pour les identités fortes (IDE, e-mail non générique, mobile E.164) — mais
  **validée en lot par le garagiste avant le jour J**, pas au moment de l'import ;
- **rien** pour tout le reste : les candidats entrent tels quels et sortent en liste triée par
  valeur (nombre de véhicules, puis nombre de documents, puis montant cumulé), traitée dans DFA
  après la bascule à raison de 10 par jour (`D-21`).

Le calcul économique est simple et se dit au garagiste : fusionner à tort deux clients coûte une
fiche irrécupérable et un client mécontent ; ne pas fusionner deux doublons coûte 30 secondes au
comptoir, une fois.

### 11.4 L'entreprise saisie comme un particulier

**Ce qu'on observe.** C'est le piège le plus coûteux, parce qu'il est **irréversible par
construction**. Les formes rencontrées :

- `Garage Rossier` saisi avec `nom = Rossier`, `prenom = Garage` ;
- une raison sociale complète dans le champ `nom` d'une fiche typée particulier ;
- un garant/leaser (`Multilease AG`) enregistré comme particulier parce que le champ type
  n'existait pas dans le source ;
- une **commune** ou un **service de l'État** (`Commune de Bagnes`, `Service des automobiles`) —
  toujours une entreprise pour la facturation, jamais un particulier ;
- une raison sociale **tronquée** à 25 ou 30 caractères par l'ancien logiciel
  (`Transports International de la Bro`), ce qui casse les heuristiques de suffixe.

**Ce que fait la base.** `client.type` est protégé par le trigger `client_verrouiller_type`
(`ZDFA3`) : **il ne se corrige pas**. Se tromper coûte une nouvelle fiche + une fusion — c'est-à-dire
un doublon volontaire, avec le numéro consommé, la fiche absorbée désactivée à vie, et tous les
documents émis entre-temps qui portent la mauvaise désignation figée
(`document_vente.client_designation_figee`, non modifiable après émission).

**Règle retenue** (elle précise la §4.2 avec les contraintes réelles) :

1. **IDE valide** ⇒ `entreprise`, certain. Attention : l'IDE doit d'abord passer la normalisation
   du format (§10.2), sinon la base le rejette et on perd le meilleur signal disponible.
2. **Suffixe ou préfixe juridique** : `SA`, `S.A.`, `Sàrl`, `SARL`, `AG`, `GmbH`, `SNC`, `Sagl`,
   `SAGL`, `Ltd`, `Ets`, `Sté`, `Cie` — **en fin de chaîne**, pour éviter de typer `Sarah Dupont`
   en entreprise. Et par mot entier : `AGATHE` n'est pas une `AG`.
3. **Vocabulaire d'activité en tête** : `Garage`, `Carrosserie`, `Transports`, `Boulangerie`,
   `Commune de`, `Ville de`, `Bourgeoisie de`, `Hôpital`, `Fondation`, `Association`, `Paroisse`,
   `EMS`, `Auto-école`, `Taxi`.
4. **Signal négatif** : civilité `M.`/`Mme`/`Herr`/`Frau`/`Sig.` **et** prénom non vide ⇒
   `particulier`.
5. **Signal de volume** : un « particulier » qui porte **plus de 3 véhicules** ou plus de 40
   factures est presque toujours une entreprise. C'est le meilleur détecteur du lot, et il n'est
   disponible qu'après la phase 2 — donc l'arbitrage du type se fait **après le profilage des
   documents**, pas à la lecture du fichier client.
6. Défaut : `particulier` + anomalie `avertissement`.

**Et surtout — la seule mesure qui protège vraiment** : la liste des cas douteux (typiquement 2 à
5 % du fichier, plus le lot du signal 5) sort **en S-4**, sur papier, triée par nombre de
véhicules décroissant, et le garagiste la relit. Vingt minutes de son temps contre des fiches
irrécupérables : c'est le meilleur rapport du projet, et c'est le genre de tâche qu'il accepte
volontiers parce qu'il reconnaît ses clients.

### 11.5 Les cas plus discrets, qui mordent quand même

| Cas | Ce qui se passe | Règle |
|---|---|---|
| **Plaque française ou allemande** (garage frontalier) | `vehicule_plaque.pays` par défaut `'CH'`, et l'EXCLUDE ne s'applique que si `pays = 'CH'` | Détecter le format (`AB-123-CD` = FR, `M-AB 1234` = DE) et poser `pays` correctement. Une plaque étrangère typée `CH` peut entrer en collision avec une plaque suisse réelle |
| **Le même véhicule sous deux plaques cantonales** (déménagement VD → VS) | Deux fiches véhicule dans le source | Fusion candidate sur le VIN. Si pas de VIN : deux fiches, à fusionner par le garagiste |
| **Un client qui est aussi fournisseur** (garage voisin, dépanneur) | Deux fiches dans le source, l'une côté client l'autre côté fournisseur | DFA n'a pas de table fournisseur au lot pilote : ne reprendre que la face client |
| **Le compte « divers » / « client comptoir »** | Une fiche unique portant des centaines de documents | ✅ **La reprendre telle quelle**, et l'exclure de toutes les clés de dédoublonnage. Elle est légitime et le garage s'en sert tous les jours |
| **Véhicule interne du garage** (voiture de courtoisie, véhicule de démonstration) | Détenteur = le garage lui-même | Créer la fiche client du garage et rattacher. Sinon les OR internes n'ont pas de client, et `ordre_reparation.client_id` est `NOT NULL` |
| **Deux tenants dans un même fichier** (installation mutualisée, groupe de garages) | — | **Arrêt immédiat** (`R-08`). Le filtrage se fait côté source. Le `tenant_id` ne vient jamais du fichier (§5.4) |

---

## 12. La ligne de coupe et sa preuve

### 12.1 La ligne de coupe, en une page pour le garagiste

La §3 dit ce qu'on ne reprend pas et pourquoi. Voici la **version qui se présente**, celle qui
tient sur une feuille et qu'on lit à voix haute avant de signer.

> **On reprend, sans discussion :**
> vos clients actifs, tous leurs véhicules, qui possède quoi aujourd'hui, **toutes vos factures et
> tous vos avoirs**, vos impayés, les travaux que vos clients ont refusés et qui restent à faire,
> et vos rendez-vous à venir.
>
> **On ne reprend pas, et voici pourquoi :**
>
> | Ce qu'on laisse | Pourquoi | Où c'est, si vous en avez besoin |
> |---|---|---|
> | Les fiches de clients que vous n'avez pas vus depuis 5 ans | Elles encombrent la recherche au comptoir. Vous en avez ~5 000 sur 8 000 | Archive, retrouvable en 20 minutes. Et si le client revient, on refait sa fiche en 30 secondes — avec sa vraie adresse |
> | L'historique atelier de plus de 2 ans | Vous ne l'ouvrez presque jamais, et les factures, elles, sont toutes là | Archive + les factures, qui contiennent le détail des travaux |
> | Les devis abandonnés | Aucune valeur : ni légale, ni commerciale. La voiture a souvent changé de mains | Rien |
> | Les rendez-vous passés | Ils sont déjà devenus des réparations ou des absences | Rien |
> | Le stock de pièces (les quantités) | Un stock repris est faux dès le lendemain. **Toutes** les migrations qui le reprennent finissent par un inventaire | Inventaire le samedi de la bascule. Vos références et vos prix, eux, sont repris |
> | Les pointages de vos mécaniciens | Vos indicateurs ne seraient pas comparables, et vous les croiriez vrais | Vos indicateurs repartent au jour J. On garde une copie des anciens |
> | Les consentements publicitaires | Un consentement doit se prouver. Repris sans preuve, il est inventé, et c'est vous qui êtes exposé | On les redemande — c'est aussi l'occasion de nettoyer votre liste |
>
> **Ce que ça vous coûte concrètement** : le mardi qui suit la bascule, si un client de 2016 se
> présente, vous refaites sa fiche pendant qu'il vous parle. Ça arrive une à deux fois par mois.
>
> **Ce que ça vous rapporte** : une recherche qui trouve du premier coup, des compteurs justes,
> une migration qui coûte moitié moins et qui se vérifie vraiment.

### 12.2 L'argument qui emporte la décision

Ce n'est pas le coût, c'est **la recette**. On ne vérifie pas 400 000 lignes ; on vérifie 20 000.
Un garagiste qui a vérifié son fichier fait confiance à son outil. Un garagiste à qui on a promis
« tout est là » et qui trouve une anomalie le troisième jour ne fait plus confiance à rien —
et il a raison, parce que **personne** ne peut lui dire ce qui est juste et ce qui ne l'est pas.

La phrase à dire, mot pour mot : *« Je préfère vous livrer 3 000 fiches dont je réponds que 8 000
dont je ne réponds pas. »*

### 12.3 Comment on prouve que rien n'est perdu

**L'équation de conservation.** C'est le seul dispositif de preuve qui tienne. Pour chaque entité,
toute ligne source atterrit dans **exactement un** de trois bacs, et les trois se somment au total
source :

```
lignes_source  =  importées  +  écartées_par_règle  +  rejetées_en_anomalie
                                     (D-07, D-08…)        (bloquantes)
```

Trois exigences, et elles ne se négocient pas :

1. **Aucun bac « autre », aucun « non expliqué ».** Un écart de 3 lignes non attribué invalide le
   rapport entier, quelle que soit sa taille. Ce n'est pas une question de proportion : c'est la
   preuve qu'on ne sait pas ce qui se passe.
2. **Chaque bac est un fichier ouvrable**, pas un nombre. `ecartes-clients-<lot>.csv` contient les
   5 096 fiches écartées, avec nom, dernière date et motif. Le garagiste peut l'ouvrir dans Excel,
   chercher un nom, et constater lui-même que c'est bien un client qu'il ne voit plus.
3. **Le comptage source se fait sur `reprise_ligne_source`**, le staging verbatim, **jamais** en
   réinterrogeant le système d'origine. Deux raisons : le système source continue de vivre entre
   l'extraction et la réconciliation (une facture de plus, un client corrigé) et les écarts qui en
   résultent sont indémêlables ; et le staging porte l'empreinte SHA-256 du fichier, donc la
   preuve que c'est bien ce fichier-là qui a été compté.

**Les trois niveaux de preuve, dans l'ordre où ils convainquent.**

| Niveau | Ce qu'il prouve | Ce qu'il ne prouve pas | Qui le fait |
|---|---|---|---|
| **1. Comptage** | Qu'aucune ligne n'a disparu en route | Que le contenu est juste | Automatique (§6.6) |
| **2. Somme** | Que les montants n'ont pas été déformés | Que les montants sont sur les bons clients | Automatique |
| **3. Nominatif** | Que le système dit la vérité sur *ses* clients à *lui* | Rien d'autre — mais c'est le seul qui emporte l'adhésion | **Le garagiste**, `CR-01` → `CR-12` |

**Les sommes à faire tomber au centime**, et par quel chemin :

| Somme | Source | Destination | Tolérance |
|---|---|---|---|
| Total TTC des factures, **par année civile** | `Σ` du staging, groupé sur l'année de la date d'émission | `Σ document_vente.total_ttc_centimes where origine='reprise' and type_document='facture'`, groupé par `exercice` | **0 centime** |
| Total des avoirs, par année | idem | idem, `type_document='avoir'`, valeurs **négatives** | 0 centime |
| Créances ouvertes (solde) | `Σ` des soldes source | `Σ document_vente.solde_centimes` | 0 centime |
| Écart Σlignes − total, par document | calculé au chargement | `Σ document_vente.ecart_reprise_centimes` | **doit être égal**, et chaque document concerné est listé |
| Nombre de détenteurs courants | 1 par véhicule repris | `count(*) from vehicule_detention where au is null` | **exactement le nombre de véhicules** |

Le dernier contrôle est celui qui attrape les erreurs de reconstruction de détention (§9.3), et il
ne coûte qu'une requête.

**Le contrôle qui vaut tous les autres, et qui ne vient pas des données** : `CR-07`, le chiffre
d'affaires d'un mois passé, comparé à celui de la **fiduciaire** — c'est-à-dire à une source
tierce qui n'a rien à voir avec la migration. Écart 0, ou on ne bascule pas.

**Trois chiffres à faire dire au garagiste avant de lui montrer quoi que ce soit** — et à noter
sur un papier, devant lui, avant l'import : combien de clients il pense avoir vus l'an dernier,
son chiffre d'affaires de l'an dernier, et combien de voitures il pense suivre. Quand les trois
chiffres du rapport tombent dans son ordre de grandeur, la conversation est terminée en deux
minutes. Quand ils n'y tombent pas, **c'est souvent lui qui a raison sur le sens de l'écart** et
c'est une information de première valeur sur le fichier source.

---

## 13. Runbook du jour J et marche arrière

> Le calendrier de 8 semaines est en §6.2 ; les critères GO/NO-GO en §6.3. Cette section est le
> **déroulé horaire** du week-end de bascule et la procédure de retour arrière.

### 13.1 La réponse à « quelle fenêtre d'indisponibilité ? »

**Zéro minute le lundi matin.** Un garage qui ouvre à 7h30 a son premier client à 7h25, avec sa
voiture, sa clé et son problème. Il n'existe aucune fenêtre acceptable à ce moment-là, pas même
dix minutes.

L'indisponibilité est donc **entièrement contenue dans le week-end**, et elle porte sur l'**ancien**
système, pas sur le nouveau :

| Moment | Ancien système | DFA |
|---|---|---|
| Vendredi jusqu'à 17h30 | écriture normale | fermé |
| Vendredi 18h00 → dimanche | **lecture seule** | import en cours |
| Dimanche 18h00 | lecture seule | **opérationnel et vérifié** |
| Lundi 7h30 | lecture seule (consultation, 30 jours) | seul système en écriture |

**La conséquence à assumer** : le garage ne peut rien facturer entre vendredi 18h et lundi 7h30.
C'est acceptable — la plupart des garages sont fermés — **à condition** que la permanence du
samedi matin, si elle existe, soit prévue : soit elle n'écrit rien (bons de commande manuscrits
saisis le lundi), soit on décale la bascule. `QG-14` et `QG-16` doivent répondre à ça.

**La règle qui rend tout ça tenable, et c'est la plus importante de la section** :

> **Le lundi matin n'est pas une fenêtre technique. C'est une décision GO/NO-GO sur un import
> déjà terminé, déjà vérifié et déjà sauvegardé le dimanche soir.**

Si quoi que ce soit reste à faire le lundi matin, la bascule est déjà ratée.

### 13.2 Le déroulé, heure par heure

**Vendredi (J-3) — arrêt de l'écriture**

| Heure | Qui | Quoi | Vérification |
|---|---|---|---|
| 17h30 | Réceptionnaire | Dernière facture émise dans l'ancien système | Numéro noté **sur papier** — c'est la référence du calage des compteurs |
| 17h45 | Réceptionnaire | Encaissements du jour clôturés | Ruban de caisse imprimé et conservé |
| 18h00 | @laupernoe | Ancien système **en lecture seule** | Un utilisateur tente une écriture et échoue. Testé, pas supposé |
| 18h15 | @laupernoe | Sauvegarde complète de l'ancien système + empreinte SHA-256 | **Restauration testée** sur le poste isolé |

**Samedi (J-2) — inventaire et extraction**

| Heure | Qui | Quoi |
|---|---|---|
| 08h00–12h00 | Garage + @laupernoe | **Inventaire physique des pièces** (`D-14`), saisi directement dans DFA |
| 13h00 | @laupernoe | Extraction finale depuis la **copie restaurée**, jamais depuis la production |
| 14h00 | @laupernoe | Contrôle d'intégrité des fichiers : empreintes, nombres de lignes, encodage (§4.1) |
| 15h00 | @laupernoe | Chargement en staging (`reprise_ligne_source`) + **phase 2 : profilage des dates** (§9.4) |
| 16h00 | @laupernoe | **Point de contrôle n°1** : les compteurs du staging correspondent-ils à ceux de la répétition générale de S-1 ? Un écart de plus de 2 % = quelque chose a changé, on s'arrête et on comprend |

**Dimanche (J-1) — import et recette**

| Heure | Qui | Quoi | Si ça échoue |
|---|---|---|---|
| 08h00 | @laupernoe | Sauvegarde de la base DFA **avant** import (tenant vide, paramétrage saisi) | — |
| 08h30 | @laupernoe | Import phases 3 → 12 (§9.2), transactions par blocs de 500 | Reprise au dernier bloc via `derniere_ligne_traitee` |
| 12h00 | @laupernoe | **Point de contrôle n°2** : anomalies bloquantes = 0 ? | **Si non : NO-GO. On arrête.** L'ancien système repasse en écriture lundi matin, sans autre conséquence que le report |
| 13h00 | @laupernoe | Phase 13 : calage des compteurs sur le numéro noté vendredi | Vérifier : `compteur_document` ≥ max des numéros repris, pour **chaque** type et **chaque** année |
| 13h30 | @laupernoe | Rapport de réconciliation (§6.6, §12.3) | Écart ≠ 0 sur un montant ⇒ **NO-GO** |
| 14h00–16h00 | **Le garagiste** | `CR-01` → `CR-12` (§6.4), sur son écran, avec ses exemples | Un contrôle échoué ⇒ analyse. Deux ⇒ NO-GO |
| 16h30 | @laupernoe | Sauvegarde de la base DFA **après** import + **restauration testée** | Critère 6 du GO |
| 17h00 | @laupernoe | Constitution de l'archive froide (`D-20`), chiffrée, empreinte, procédure de consultation écrite | — |
| **18h00** | **@laupernoe + garagiste** | **Décision GO/NO-GO écrite et signée** | **Heure limite absolue.** Après 18h00 le dimanche, c'est NO-GO par défaut, quelle que soit la proximité du but. Un GO décidé à 22h par deux personnes fatiguées est le pire moment de tout le projet |

**Lundi (J) — ouverture**

| Heure | Qui | Quoi |
|---|---|---|
| 06h30 | @laupernoe | Sur place. Vérification de démarrage : API, base, sauvegarde de la nuit |
| 06h45 | @laupernoe | **Test de fumée** : chercher un client, ouvrir un véhicule, ouvrir un OR, imprimer une facture reprise en PDF. 4 gestes, 5 minutes |
| 07h00 | @laupernoe + garagiste | Confirmation de l'ouverture. Postes connectés, sessions ouvertes, imprimante testée |
| 07h15 | Réceptionnaire | **Une réception à blanc** sur son propre véhicule, avant l'arrivée du premier client |
| **07h30** | Tous | **Ouverture.** @laupernoe reste au comptoir, debout, toute la journée |
| 12h00 | @laupernoe | Point mi-journée : journal des incidents relu |
| 17h00 | @laupernoe + réceptionnaire | Point du soir. **Contrôle croisé** : total facturé du jour dans DFA vs ruban de caisse (§6.5) |

**J+1 à J+5** : @laupernoe présent le mardi matin, joignable ensuite ; point quotidien à 17h ; contrôle
croisé quotidien. Vigilance renforcée décrite en §6.5.

### 13.3 Qui fait quoi — les quatre rôles

| Rôle | Qui | Ce dont il répond | Ce qu'il ne fait **pas** |
|---|---|---|---|
| **Opérateur de bascule** | @laupernoe | Extraction, import, réconciliation, GO/NO-GO technique | Il ne coche **aucun** contrôle `CR-xx` à la place du garagiste |
| **Référent garage** | le garagiste, ou le réceptionnaire désigné (`QG-15`) | La recette métier, la décision GO/NO-GO, la marche arrière | Il ne touche pas aux fichiers |
| **Réceptionnaire** | celui qui ouvre le lundi | Les premiers gestes réels, le journal des incidents | — |
| **Fiduciaire** | externe | Le chiffre de référence de `CR-07` | Elle n'a rien à valider, mais elle doit être **prévenue** de la date |

**S'il n'y a pas de référent garage nommé, il n'y a pas de bascule.** C'est un critère de NO-GO à
part entière, et il se vérifie en S-8, pas le vendredi soir.

### 13.4 La marche arrière

**Ce qu'elle n'est pas.** Ce n'est **pas** une suppression de données dans DFA. Elle est
techniquement impossible (§10.6 : aucun `DELETE`, documents verrouillés après émission) et elle
serait une mauvaise idée de toute façon : la base DFA du tenant est la **pièce à conviction** de ce
qui s'est passé. Elle est conservée intacte, jamais effacée, jamais « nettoyée ».

**Ce qu'elle est.** Le retour de l'écriture dans l'ancien système, plus la ressaisie de ce que DFA
a produit entre-temps.

**Les trois fenêtres, par coût croissant :**

| Fenêtre | Coût réel | Décision |
|---|---|---|
| **Dimanche 18h (NO-GO avant ouverture)** | ~0. Rien n'a été émis dans DFA. L'ancien système repasse en écriture lundi matin, le garage ne s'aperçoit de rien | La seule marche arrière **gratuite**. C'est pour ça que l'heure limite de 18h existe |
| **J → J+5** | Ressaisie des documents émis dans DFA. Un garage émet 15 à 40 factures par jour : 1 à 3 jours-homme au pire | Recevable. Les critères sont en §6.3 |
| **Après J+5** | La ressaisie coûte plus cher que la correction, et l'ancien système a 5 jours de retard sur la réalité de l'atelier | **Non recevable.** On corrige dans DFA. Il faut le dire au garagiste **avant** le jour J, pas au moment où il le demande |

**La procédure, dans l'ordre :**

1. **Décision** par le référent garage, tracée (date, heure, motif, critère §6.3 déclenché).
2. **Ancien système remis en écriture.** ⚠️ **Le mécanisme exact doit avoir été testé en S-1**, à
   la répétition générale. « On remettra les droits » n'est pas une procédure : selon les
   logiciels, la mise en lecture seule se fait par droits utilisateur, par attribut de fichier, ou
   par arrêt d'un service — et toutes ne se défont pas aussi facilement.
3. **DFA passe en lecture seule** pour le tenant (suspension des comptes utilisateurs, ou
   `tenant.statut = 'suspendu'`). Aucune donnée n'est touchée.
4. **Ressaisie dans l'ancien système** des documents émis par DFA pendant la fenêtre.
5. **Réconciliation inverse** : les totaux ressaisis dans l'ancien système doivent égaler les
   totaux de `document_vente where origine='dfa'` du tenant. Même exigence, écart 0.
6. **Archive froide conservée**, ancien contrat toujours en cours (`R-01` — d'où la règle de ne
   jamais résilier avant J+30).

**Le point qui coince, et qu'il faut avoir tranché avant le jour J :**

> Une facture émise dans DFA porte un numéro de la série du garage. Si on la ressaisit dans
> l'ancien système, ce système doit accepter **le même numéro** — sinon la série a un trou ou un
> doublon, et c'est un problème comptable, pas un problème informatique.

Deux réponses possibles, à choisir **en S-3** et à écrire dans le plan :

- **A** — L'ancien système permet de forcer un numéro : on ressaisit à l'identique. Propre.
- **B** — Il ne le permet pas : chaque facture émise dans DFA est **annulée par un avoir dans
  DFA** (elle garde son numéro et sa place dans la série, `annule_par_avoir`), et l'ancien système
  émet une facture neuve avec son propre numéro. Le client reçoit deux documents et une
  explication. Moins propre, mais comptablement défendable — et c'est la seule voie si l'ancien
  système ne cède pas.

⚠️ **À VALIDER AVEC @laupernoe** : le choix dépend du logiciel source et doit être vérifié, pas supposé.
C'est typiquement une question à poser à l'éditeur (`QE-08`, à ajouter à la §7.2) ou à tester sur
la copie restaurée pendant la répétition générale.

---

## 14. Zones aveugles — ce que seul le terrain peut donner

> Tout ce qui suit est **inconnu**, et aucune analyse supplémentaire du dépôt ne le résoudra. Ce
> sont les entrées manquantes du projet. Elles sont classées par ce qu'elles bloquent.

### 14.1 Bloque l'écriture du premier chargeur

| # | Ce qui manque | Comment l'obtenir | Sans ça |
|---|---|---|---|
| **Z-01** | **Un export réel**, de n'importe quel garage, de n'importe quelle entité | Une visite, méthode §1.2 | Les colonnes « rôle du champ source » de la §2 restent vides. Aucun code ne peut être écrit |
| **Z-02** | Le **moteur de stockage** réel d'Auto-i et de Nextlane **chez ce garage-là** | §1.2 étapes A→C, deux indices croisés | On ne sait pas si l'extraction prend 2 heures ou 6 semaines (`R-02`) |
| **Z-03** | L'**existence et le contenu d'une fonction d'export** dans le logiciel | Photographier les dialogues (§1.2 étape A) | On prépare une lecture directe de base là où trois clics suffisaient |
| **Z-04** | Les **lignes de documents sont-elles exportables**, ou seulement les entêtes ? | `QE-04`, ou test sur un export réel | Le choix « entête + PDF » vs « document complet » (§2.4) reste ouvert, et il change la valeur perçue de toute la reprise |
| **Z-05** | Le **format des numéros de facture** du garage | Une facture papier | Impossible de décider entre bascule au 1er janvier et calage de compteur (`D-23`) |

### 14.2 Bloque le chiffrage et le périmètre

| # | Ce qui manque | Comment l'obtenir | Sans ça |
|---|---|---|---|
| **Z-06** | Les **9 chiffres de profilage** par entité (§1.3) | Requêtes de profilage sur place | `D-07` (5 ans) et `D-08` (24 mois) sont des défauts proposés, pas des décisions. Le chiffrage est une devinette |
| **Z-07** | Le **taux de doublons réel** | `group by` sur clés normalisées | On ne sait pas si le dédoublonnage est une demi-journée ou une semaine, ni si une reprise antérieure a raté (§11.3) |
| **Z-08** | La **proportion de véhicules sans VIN** | `count(*) where vin is null or length(vin) <> 17` | La clé de correspondance véhicule n'est pas décidable |
| **Z-09** | Le **nombre de plaques portées par plusieurs véhicules** | `group by plaque having count(distinct véhicule) > 1` | Le cas 3 de la §11.2 (anomalie bloquante) peut concerner 3 véhicules ou 300 |
| **Z-10** | Combien d'années d'historique le garage **consulte vraiment** (`QG-04`) | Question ouverte, en face | La ligne de coupe (§12.1) n'a pas d'argument chiffré |
| **Z-11** | Le **volume des pièces jointes** (Go) et leur valeur | Inventaire du répertoire (§1.2 étape B) | `D-17` n'est pas arbitrable |

### 14.3 Bloque le calendrier

| # | Ce qui manque | Comment l'obtenir | Sans ça |
|---|---|---|---|
| **Z-12** | Le **contrat de licence** : échéance, préavis, reconduction, réversibilité | Demander le PDF (§1.1) | La date de bascule peut être annoncée puis annulée (`R-01`) |
| **Z-13** | Le **coût d'extraction** facturé par l'éditeur | `QE-02` | Un devis peut être invalidé par 3 000 CHF de frais surprise (`R-03`) |
| **Z-14** | Le **délai de réponse réel** d'un éditeur à une demande d'export | Envoyer `QE-01` à un éditeur, maintenant | On planifie 8 semaines là où il en faut 16 |
| **Z-15** | L'ancien système accepte-t-il de **forcer un numéro de facture** ? | Test sur la copie restaurée | La marche arrière (§13.4) n'a pas de procédure choisie |
| **Z-16** | Le garage a-t-il une **permanence le samedi matin** ? | `QG-14`, `QG-16` | La fenêtre d'indisponibilité (§13.1) n'est pas validée |

### 14.4 Bloque des décisions produit, hors périmètre de ce document

| # | Question | Destinataire |
|---|---|---|
| **Z-17** | `ordre_reparation` doit-il recevoir `origine` + `numero_origine` comme `document_vente` ? (§10.5) | `expert-database` — **coût nul aujourd'hui, élevé après la première bascule** |
| **Z-18** | Le numéro de client d'origine va-t-il dans `client.numero` ou dans `reference_externe` ? (`D-26`) | `expert-api` (la recherche doit couvrir le choix retenu) + @laupernoe |
| **Z-19** | Une date d'expertise sans résultat : note, ou expertise inventée ? (`D-28`) | @laupernoe |
| **Z-20** | Les tables de reprise (`lot_reprise`, `reprise_ligne_source`, `correspondance_reprise`, `reprise_anomalie`) et la colonne `origine_lot_id` ne sont **pas** en base. §5.2 et §5.3 restent des plans | `expert-database`, quand la première migration réelle sera engagée |
| **Z-21** | Le module `apps/api/src/reprise/` n'existe pas (§5.1 est une conception) | À décomposer en tâches backend, après Z-01 |

### 14.5 La séquence qui débloque le plus, dans l'ordre

1. **Z-14** — envoyer une demande d'export à un éditeur **aujourd'hui**. C'est le seul élément dont
   le délai se compte en semaines et qui ne dépend d'aucun travail préalable.
2. **Z-01 + Z-06** — une visite, une fiche d'inventaire remplie, un échantillon de 20 lignes par
   entité. Une demi-journée qui transforme la moitié de ce document en travail exécutable.
3. **Z-12** — lire un contrat. Une heure, et ça peut décaler une bascule de six mois.
4. **Z-17** — trancher la question de `ordre_reparation.numero_origine` tant qu'aucune donnée n'est
   en production.

Le reste attend, et c'est normal : **le code est la partie facile et la dernière**.
