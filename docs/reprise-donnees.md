# Reprise des données — méthode, mapping et bascule

> Périmètre : extraction, mapping, qualité, chargement et bascule des données d'un garage depuis
> son DMS actuel (Auto-i, Nextlane, logiciel local, tableurs) vers dmsforall.
> Public : @laupernoe (terrain), lead-backend, expert-database, expert-facturation, expert-devops.
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

**État du dépôt au moment de la rédaction** : seul le socle est en base
(`apps/api/src/db/schema/` = `tenant`, `site`, `utilisateur`, `session`, `journal_securite`).
Les tables `client`, `vehicule`, `ordre_reparation`, `facture` n'existent pas encore : le mapping
de la §2 vise le **modèle métier spécifié** (spec étape 1 §7) et le **schéma planifié**
(`docs/plan-etape-1-backend.md`). Il devra être revérifié champ à champ quand l'étape 1 sera en
base — c'est une revue d'une demi-journée, pas une réécriture.

---

## 1. Plan d'investigation

> Objectif d'un passage chez un garage : repartir avec une **fiche d'inventaire remplie** (§1.4)
> et, si possible, un **échantillon de 20 lignes par entité**. Pas avec une impression.

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

### 5.6 L'archive documentaire

```
document_repris
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

### 8.2 À transmettre aux autres experts

| Destinataire | Contrainte issue de ce document |
|---|---|
| **expert-facturation** (étape 2) | Le modèle de document doit porter **dès sa conception** `numero_origine text null`, `origine enum('dfa','reprise')`, `tva_non_ventilee boolean`, et une **unicité de numéro couvrant les deux origines**. Le taux TVA doit accepter les valeurs historiques (76, 80, 77, 81 ‰). Ajouter ça après coup impose une migration sur des documents verrouillés (§5.5, `D-23`) |
| **expert-database** (étape 1) | Colonne `origine_lot_id uuid null` + index partiel sur les tables recevant un import ; tables de reprise sous RLS `FORCE` avec `USING` **et** `WITH CHECK` ; FK composites `(tenant_id, lot_id)` sur le modèle de `site_tenant_id_uk` (§5.2, §5.4) |
| **expert-metier** | Les champs sans équivalent source (origine de ligne, payeur, consentements, conditions datées) doivent tolérer un état « inconnu / repris » sans casser une règle métier. Une règle qui exige une valeur qu'aucun système source ne fournit rend la reprise impossible (§2.5) |
| **lead-qa** | Le test d'isolation d'import (§5.4) et le test d'idempotence (« deux passes du même fichier ⇒ mêmes UUID, aucun doublon ») sont des tests de la règle n°1 du projet, pas des tests de confort |
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
