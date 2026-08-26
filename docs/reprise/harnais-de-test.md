Harnais de test — reprise de données
=====================================

Ce que ce document couvre : comment rejouer le parcours complet de reprise (dépôt d'archive →
analyse → plan → validation → import → rapport) sur un tenant jetable, pour un garage ou pour
plusieurs à la fois, avec un verdict vérifié en base — pas seulement lu dans la réponse de l'API.
Public : quiconque doit prouver que la reprise fonctionne avant de la proposer à un vrai garage.
Les scripts vivent dans `scripts/reprise/`.

Ce que ce document ne couvre pas : ce qui se reprend et ce qui ne se reprend pas, le déroulement
d'une bascule réelle chez un garage, les contrôles que fait le garagiste lui-même — tout ça est
dans [`guide-reprise.md`](guide-reprise.md).

Prérequis
---------

- `pnpm dev` tourne (API sur `http://localhost:3000`, front sur `http://localhost:5173` — le
  front n'est pas utilisé par ce harnais, mais l'API refuse toute requête sans `Origin` connu, et
  `http://localhost:5173` est l'origine acceptée par défaut).
- Docker debout (`dfa-postgres`), `DATABASE_URL_MIGRATION` valide dans le `.env` racine.
- `zip`/`unzip` sur le `PATH` (déjà présents sur cette machine).
- Tous les scripts s'exécutent avec `pnpm --filter @dfa/api exec tsx <chemin ABSOLU du script>` —
  chemin absolu obligatoire, `tsx` résout les imports relatifs au fichier, pas au répertoire
  courant (piège vécu en écrivant ce harnais, voir le commentaire de `lib/pg-client.ts`).

Construire un jeu de test
--------------------------

Deux paliers, pas un seul — un import réel une fois ne prouve rien, il faut pouvoir le rejouer
souvent.

**Palier rapide, synthétique** (`construire-jeu-synthetique.ts`) : un ZIP de quelques kilo-octets,
trois tables DBF fabriquées (clients, véhicules, factures), aucune donnée réelle. Choisi
délibérément synthétique plutôt qu'un extrait des vrais CSV Auto-i de @laupernoe — ces CSV portent des
noms, adresses et e-mails réels d'un client réel, et les recopier dans un fichier de test destiné
à être rejoué des dizaines de fois violerait le principe nLPD que ce même chantier applique
ailleurs (§ `guide-reprise.md`, « Ce que le nLPD change en pratique »). Le jeu fabriqué respecte
les mêmes pièges que la source réelle (dates au format `aaaammjj`, accents français/allemands,
NPA/VIN/plaques suisses) et déclenche le même classement de rôle automatique.

```bash
pnpm --filter @dfa/api exec tsx /chemin/vers/dmsforall/scripts/reprise/construire-jeu-synthetique.ts
# -> /tmp/dfa-reprise-jeux-test/jeu-synthetique-g42.zip (~3 Ko, 40 clients / 35 véhicules / 25 factures)
```

Options : `--clients N --vehicules N --factures N --graine N` (graine fixe = archive reproductible
octet pour octet), `--sortie <dossier>`.

**Palier réel réduit** (`construire-jeu-reduit-source.ts`) : un sous-ensemble de la vraie archive
Auto-i de @laupernoe — par défaut, seulement `AutoI/RepAw.backup` (242 Mo), le seul des dix fichiers de
l'archive à porter les tables métier (mesuré : `Kunden`, `Verkauf`, `Bewertungen`…). Dix fois plus
petit que l'archive complète (2,4 Go), sans rien perdre de significatif — le reste de l'archive est
un catalogue tiers sans donnée garage. Source en lecture seule, jamais modifiée ; sortie jamais
sous `/chemin/vers/echantillons/` (nLPD — ce ZIP contient de vraies données personnelles, il ne doit
jamais entrer dans un dépôt versionné).

```bash
pnpm --filter @dfa/api exec tsx /chemin/vers/dmsforall/scripts/reprise/construire-jeu-reduit-source.ts
# -> /tmp/dfa-reprise-jeux-test/jeu-reduit-archive-test-b.zip (~46 Mo compressé, 242 Mo une fois déposé)
```

**Ce palier ne passe pas encore l'analyse** — voir « État validé le 26.08.2026 » plus bas pour le
détail exact de ce qui a été mesuré et écarté comme cause.

Sur une autre machine, l'archive de @laupernoe n'est pas au même endroit : `--fichier <chemin>` (répétable)
pointe vers l'extraction locale équivalente. La commande `unzip` d'extraction sélective et les
commandes `mdb-*` de contrôle (comptage, schéma, version) sont documentées dans les notes de
travail de @laupernoe, `/chemin/vers/echantillons/analyse/auto-i/commandes.md` — hors de ce dépôt, propres à
cette machine, pas reproductibles telles quelles ailleurs sans un export équivalent.

**Archive complète** : rien à construire, déposer directement `archive-test-b.zip` ou `archive-test-a.zip` — à
réserver aux passages occasionnels (§ mission), pas aux campagnes répétées. Sur l'archive complète
mesurée le 25.08.2026, l'analyse seule prend environ 7,5 minutes.

**Attention à `/tmp` pour un jeu volumineux** : sur cette machine, `/tmp` est du `tmpfs` — de la
RAM, plafonnée à 7,6 Go (vérifié : `mount | grep tmpfs`). Sans conséquence pour les deux jeux
ci-dessus (3 Ko et 45 Mo une fois compressé), mais un `--sortie` personnalisé pour un extrait
volumineux (un sous-ensemble de Stieger, par exemple) doit pointer ailleurs — `/mnt/stockage`
(1,5 To libres) plutôt que le défaut.

Lancer une campagne sur un garage
-----------------------------------

`campagne-reprise.ts` fait tout, en une commande : crée un tenant de test, se connecte, mène le
dossier de reprise de bout en bout, vérifie le résultat par SQL direct, rend un verdict.

```bash
pnpm --filter @dfa/api exec tsx /chemin/vers/dmsforall/scripts/reprise/campagne-reprise.ts \
  --tenant demo-01 \
  --archive /tmp/dfa-reprise-jeux-test/jeu-synthetique-g42.zip \
  --rejouer --nettoyer
```

- `--tenant <suffixe>` : le tenant s'appelle `reprise-test-<suffixe>` — toujours sous ce préfixe,
  jamais un nom qui pourrait ressembler à un tenant réel (garde-fou de `lib/purge-tenant.ts`, non
  contournable). Rejouer la même commande réutilise le même tenant (création idempotente : upsert
  sur le `slug`).
- `--archive <chemin>` : le ZIP à déposer.
- `--rejouer` (optionnel) : une fois le premier dossier importé avec succès, en mène un DEUXIÈME
  complet sur le MÊME tenant avec la même archive, puis compare les comptages avant/après —
  identiques, c'est la preuve d'idempotence. Nécessaire parce que `POST .../import/rejouer` seul
  ne suffit pas à cette preuve : il n'est autorisé que depuis l'état `import_echoue`, jamais depuis
  `import_termine` (mesuré le 26.08.2026) — la seule façon de prouver qu'un import COMPLET rejoué
  ne duplique rien est d'en mener un second en entier.
- `--nettoyer` (optionnel) : purge intégralement le tenant en fin de script. À omettre pour
  inspecter le résultat à la main avant de nettoyer soi-même.

Le script affiche sa progression (`[timestamp] étape {détail}`) et termine par un bloc `VERDICT` :
tenant créé, identifiants de connexion, statut final du dossier, nombre d'éléments inclus/exclus
du plan, comptages réels en base, résultat d'idempotence le cas échéant, échantillon de fiches
clients lisible, et un verdict `SUCCES` / `ECHEC` / `PLAN_VIDE`. Code de sortie non nul sur échec —
utilisable dans un script CI.

**`PLAN_VIDE` n'est pas un échec du harnais.** Depuis le correctif du 26.08.2026, un plan sans
aucun élément inclus est un résultat RÉEL possible (l'archive ne contient rien de reconnaissable),
et valider un plan vide est refusé par l'API (`409 REPRISE_PLAN_NON_VALIDABLE`) — le harnais le
détecte et s'arrête proprement à cette étape plutôt que d'essayer de forcer une validation vouée à
l'échec.

Ce que la vérification SQL contrôle
--------------------------------------

Jamais seulement ce que l'API affirme (`lib/verification-sql.ts`) :

- `client`/`vehicule`/`document_vente` : nombre de lignes du tenant, ET nombre de
  `numero_origine` DISTINCTS — les deux doivent être égaux. Un écart signifierait qu'une fiche
  source a produit deux fiches DFA (rejeu non idempotent), invisible si on ne comptait que le total.
- `vehicule_plaque`/`vehicule_detention` : compte brut (ces deux tables n'ont pas encore d'ancrage
  `numero_origine` — `docs/reprise/decisions.md`, « Ce qui reste ouvert » — sur un tenant de test
  fraîchement créé, toute ligne trouvée ne peut venir que de CET import).
- `document_vente` non émis : doit être 0 — un document repris resté en `brouillon` est un import
  interrompu au milieu du protocole en deux temps, jamais un état correct.
- Un échantillon de 5 fiches clients (numéro, nom/raison sociale, numéro d'origine, nombre de
  véhicules détenus) — la version « retrouve-moi la dernière facture de M. Rossier » du harnais :
  un nombre ne convainc personne, une fiche qu'on peut lire, si.

Lancer une campagne sur plusieurs garages
--------------------------------------------

`campagne-multi-garages.ts` répond au deuxième point de la mission : « prouvée sur plusieurs
garages, plusieurs fois ». Il appelle la même fonction que `campagne-reprise.ts` (aucune logique
dupliquée), une fois par tenant, puis fait la preuve qui n'a de sens qu'à plusieurs : l'étanchéité.

```bash
# Même archive, N tenants distincts (répétition, § mission)
pnpm --filter @dfa/api exec tsx /chemin/vers/dmsforall/scripts/reprise/campagne-multi-garages.ts \
  --archive /tmp/dfa-reprise-jeux-test/jeu-synthetique-g42.zip --nb-garages 3 --prefixe demo --nettoyer

# Garages hétérogènes, une archive par tenant
pnpm --filter @dfa/api exec tsx /chemin/vers/dmsforall/scripts/reprise/campagne-multi-garages.ts \
  --tenant autoi --archive /tmp/dfa-reprise-jeux-test/jeu-reduit-archive-test-b.zip \
  --tenant synth --archive /tmp/dfa-reprise-jeux-test/jeu-synthetique-g42.zip \
  --nettoyer
```

**Méthode d'étanchéité, mesurée pas supposée.** Après l'import de CHAQUE tenant, le script prend
un instantané (`table -> nombre de lignes du tenant`) sur TOUTES les tables `tenant_id` de la base
(une centaine, découvertes par introspection `information_schema`, pas une liste maintenue à la
main) — pour LUI-MÊME et pour CHAQUE tenant déjà traité auparavant. Si l'import du tenant B avait
fait fuiter ne serait-ce qu'une ligne chez le tenant A, le nouvel instantané de A diffèrerait de
celui pris juste après l'import de A lui-même, sur n'importe laquelle de ces tables — pas
seulement celles auxquelles on penserait à vérifier à la main. Toute différence est signalée en
clair (`!!! FUITE ÉTANCHÉITÉ : ...`) et fait basculer le verdict de ce tenant à `echec_etancheite`.

Nettoyer
--------

`--nettoyer` sur l'un ou l'autre script purge le ou les tenants de test en fin de campagne. Pour
un nettoyage a posteriori (campagne interrompue, `--nettoyer` omis) :

```ts
// pnpm --filter @dfa/api exec tsx  — à coller dans un petit script jetable, ou lire
// lib/purge-tenant.ts::listerTenantsDeTest / purgerTenantDeTest.
```

La purge est FK-safe par introspection (`pg_constraint`), pas une liste de tables recopiée : elle
suit les migrations sans entretien. Elle casse aussi les cycles réels du schéma (ex. `dossier_vente
<-> vehicule_stock`, `article <-> article_reference`) en neutralisant la colonne nullable avant de
supprimer, et répète le passage de suppression jusqu'à un point fixe (un `DELETE` sur `client`/
`vehicule`/`document_vente` déclenche un trigger d'audit qui RÉINSÈRE une ligne dans
`audit_atelier` pour ce même tenant — un simple passage unique laissait ces lignes fraîches
bloquer le `DELETE` final sur `tenant`). Les deux mesurés et corrigés en écrivant ce harnais, voir
l'en-tête de `lib/purge-tenant.ts` pour le détail. Garde-fou non contournable : elle refuse tout
slug qui ne commence pas par `reprise-test-`.

État validé le 26.08.2026 — le parcours complet fonctionne
----------------------------------------------------------------

**Un défaut bloquait 100 % des imports jusqu'au 26.08.2026 en fin de matinée** (chemin d'extraction
périmé, `apps/api/src/reprise/import/`, hors périmètre de ce chantier, corrigé par un autre agent
pendant que ce harnais tournait). Depuis ce correctif, mesuré avec ce harnais sur le jeu
synthétique :

- **Mono-garage, à froid** : dépôt → analyse → plan → validation → import → rapport, succès de
  bout en bout, comptages exacts (40 clients/40 `numero_origine` distincts, 35 véhicules/35
  distincts, 35 plaques, 32 détentions — 3 véhicules sans propriétaire connu dans le jeu
  synthétique, par construction).
- **Répété 3 fois de suite**, tenants distincts, mêmes chiffres à chaque fois.
- **Multi-garages (3 tenants)**, avec preuve d'étanchéité (instantané avant/après sur ~100 tables
  `tenant_id`, aucune différence détectée sur un tenant déjà traité après l'import d'un autre) :
  3/3 `SUCCES`.
- **Idempotence (`--rejouer`)** sur chacun des runs ci-dessus : un deuxième dossier complet, même
  archive, même tenant → comptages identiques au premier passage, `numero_origine` toujours sans
  doublon.

**Un deuxième défaut, distinct, repéré au passage sur l'archive réelle réduite** (`jeu-reduit-
archive-test-b.zip`, 242 Mo, le vrai `RepAw.backup` de @laupernoe) — hors périmètre, signalé, pas corrigé.
L'analyse échoue systématiquement (2/2, reproductible) : la famille est bien détectée (`access_jet`,
confiance 80, `RepAw.backup` identifié), l'extraction est bytes-pour-bytes correcte (empreinte
SHA-256 de l'extrait strictement identique à l'original, vérifié `sha256sum` en direct), mais
`listerTables` (`lecteurs/access/lecteur-access.ts`, `mdb-tables -1`) rend une liste VIDE sur ce
fichier une fois extrait — alors que `mdb-tables -1` sur le MÊME fichier, aux MÊMES octets,
invoqué directement (CLI, ou via `spawn()` Node reproduisant exactement les mêmes variables
d'environnement que le code réel) rend ses 104 tables sans problème. Écarté par la mesure :
`MDBICONV`/`MDB_JET3_CHARSET`, le mécanisme `spawn()` lui-même, le délai de 30 s (25 ms mesurés en
temps normal), les permissions du répertoire d'extraction (reproduit à l'identique, même résultat
correct en dehors du pipeline). Cause non isolée dans le périmètre de ce chantier — l'écart tient
donc à quelque chose de propre à l'exécution DANS le pipeline d'analyse (candidat le plus probable,
non confirmé : un ordre d'opérations entre extraction et lecture qui se comporte différemment
quand ce fichier est le SEUL de l'archive, jamais reproduit quand il fait partie des 781 entrées de
l'archive complète). **Conséquence pratique pour ce harnais** : le palier « réel réduit » ne peut
pas encore servir de preuve positive — seule l'archive complète (2,4 Go, passage occasionnel) a été
vue fonctionner sur ce fichier, par un autre agent, avant l'extraction de ce sous-ensemble.

Limites connues de ce harnais
--------------------------------

- Ne construit pas de jeu de test pour Nextlane/Stieger (FoxPro/DBF) à partir de vraies données —
  seul un jeu synthétique DBF existe aujourd'hui, générique (pas calibré sur les pièges
  spécifiquement mesurés côté Stieger, voir les notes de travail de @laupernoe, `/chemin/vers/echantillons/analyse/stieger/inventaire.md`). L'archive complète
  `archive-test-a.zip` (43,5 Go) reste le seul chemin vers un test représentatif de cette source, à
  réserver aux passages occasionnels.
- Ne simule pas de coupure réseau pendant le dépôt par tranches — cette propriété (reprise après
  interruption) a déjà été vérifiée manuellement (notes de travail de @laupernoe, `/chemin/vers/echantillons/analyse/parcours-complet/parcours.md`, étape 2)
  et n'a pas été rejouée par ce harnais faute de temps ; à ajouter si une régression sur ce point
  est un jour suspectée.
- Ne couvre que les trois domaines qui ont un écrivain réel (`clients`, `vehicules`,
  `documents_vente`) — voir `guide-reprise.md`, « Ce que l'outillage sait faire aujourd'hui ». Les
  huit autres domaines du contrat (`DOMAINES_REPRISE`) peuvent apparaître dans le plan, jamais dans
  l'import : le harnais ne peut pas prouver ce qui n'est pas encore écrit.
