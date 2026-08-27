# Banc de charge DFA

Mesure la latence perçue par l'utilisateur (via l'API en marche, jamais Postgres en direct) sur
la base de développement **réelle** (`dfa_dev`, ~9 900 clients / ~6 800 véhicules importés
d'Auto-i). Sert à choisir un hébergeur et à prouver qu'un correctif de performance en est un —
voir les notes de travail §Atelier, « Les recherches par fragment ne tiendront pas la charge ».

## Lancer le banc

```bash
node scripts/banc/executer-banc.mjs
```

Une seule commande, rejouable à l'identique. Préalables :

- Docker (Postgres) et l'API (`pnpm dev` ou `pnpm dev:api`) déjà en marche sur `localhost:3000` —
  le banc ne les démarre ni ne les redémarre jamais (voir « Aléas » ci-dessous).
- Charge machine raisonnable : le script lit `/proc/loadavg` au démarrage et refuse de lancer la
  campagne si la charge à 1 minute dépasse 4 (vérifie aussi `uptime` toi-même avant de lancer).

Résultat : deux fichiers horodatés dans `scripts/banc/resultats/`, un `.json` (données brutes,
pour diffs automatisés entre deux campagnes) et un `.md` (tableau lisible, pour diffusion). Ce
répertoire n'est pas nettoyé automatiquement — les anciennes campagnes restent disponibles pour
comparaison avant/après un correctif.

## Pourquoi zéro dépendance (pas k6/autocannon/artillery)

Le dépôt n'a aujourd'hui aucun outil de charge, et le brief demande de ne pas en ajouter un lourd.
Node 22 (déjà la version minimale du dépôt, `package.json` `engines.node >=22`) fournit nativement
tout ce qu'il faut :

- `fetch` pour le HTTP,
- `perf_hooks.performance.now()` pour la latence,
- un pool de promesses borné en une vingtaine de lignes (`lib/executer-scenario.mjs`) pour la
  concurrence.

Résultat : `scripts/banc/` n'ajoute **aucune ligne** à `package.json` (racine ou `apps/api`), ne
passe par aucune installation, et tourne identiquement avec `node <fichier>.mjs` — plus simple à
rejouer qu'un binaire externe (k6) ou un paquet npm à verrouiller (autocannon, artillery) pour un
besoin qui tient dans un script.

## Ce que chaque scénario mesure

| Famille                                      | Scénarios                                                          | Concurrence                    | n          |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ | ---------- |
| Liste clients                                | page1, page10, page50, limite=200 (page1 et profond)               | 6                              | 42         |
| Liste véhicules                              | idem                                                               | 6                              | 42         |
| Recherche par fragment (clients + véhicules) | court (2 car., pire cas), long (spécifique), aucune correspondance | 1 (isolé) puis 6 (sous charge) | 20 puis 42 |
| Fiche client                                 | `GET /clients/{id}` puis `GET /clients/{id}/vehicules`             | 6                              | 42         |
| Tableau de bord                              | `/tableau-bord/activite`, `/tableau-bord/financier`                | 6                              | 42         |
| Recherche comptoir unifiée                   | `/recherche`                                                       | 1                              | 15         |

**Fragments** (`config.mjs`) : le fragment court est un bigramme fréquent choisi à dessein
(« an » pour les clients — Jean, Anne, Martin… ; « vo » pour les véhicules — Volkswagen, Volvo),
pas dérivé d'une ligne réelle — un fragment « pire cas » doit matcher beaucoup de lignes, ce
qu'un échantillon aléatoire ne garantit pas. Le fragment long/spécifique et le fragment « aucune
correspondance » sont découverts à l'exécution (numéro de client réel, VIN réel) mais **jamais
journalisés en clair** dans les résultats — ce sont des données de production d'un vrai garage,
pas une fixture de démo.

**Profondeur de pagination** : les curseurs « page 10 », « page 50 » et « limite=200 profond »
sont obtenus par UNE marche séquentielle (page par page) au début de la campagne, puis **rejoués**
`n` fois pour la mesure — on chronomètre le coût d'une lecture à cette profondeur, pas le coût de
la marche pour y parvenir.

**Requêtes SQL par endpoint** (`config.mjs`, `REQUETES_SQL`) : comptées **statiquement dans le
code**, pas instrumentées en exécution. Aucune extension d'instrumentation (`pg_stat_statements`)
n'est chargée sur le Postgres de dev (`shared_preload_libraries` ne la précharge pas), et en
ajouter une aurait exigé de toucher `docker-compose*.yml`/la config Postgres ou
`apps/api/src/db/acces-base.service.ts` — les deux hors du périmètre d'écriture de cette tâche.
Chaque service interrogé n'exécute de SQL que via `tx.execute(sql\`…\`)`/le query builder Drizzle,
jamais dans une boucle sur les résultats d'une requête précédente (vérifié à la lecture pour
chaque endpoint listé) : le nombre d'allers-retours SQL par requête HTTP est donc une propriété
STATIQUE du code, pas un fait d'exécution — compter les appels réellement atteints donne un
nombre exact, pas une estimation.

## Contrôles de correction (pas des mesures de charge)

- `GET /clients?limite=201` doit rendre `400 VALIDATION_ECHOUEE` — vérifie que le plafond de
  pagination (`packages/shared/src/contrats/pagination.ts:83`) est bien appliqué, pas seulement
  documenté.
- Deux marches complètes indépendantes de `/clients` et `/vehicules` à `limite=200` : comparent le
  nombre total de lignes obtenu, détectent les doublons et les tailles de page anormales. Cible le
  piège documenté dans `CONTRIBUTING.md` (« `pg` rend `timestamptz` en `Date`, perd la microseconde, le
  curseur saute des lignes en silence ») — un piège qui ne se voit qu'à ce volume, jamais sur une
  fixture de test de quelques dizaines de lignes.

## Garanties

- **Lecture seule stricte.** Chaque scénario est un `GET`. Rien n'est créé, modifié ou supprimé
  dans `dfa_dev`.
- **Authentification réelle**, jamais de bypass : connexion `POST /auth/connexion` avec les
  identifiants de démo (`direction@garage-martin.ch`), cookie de session HttpOnly rejoué sur
  chaque requête, en-tête `Origin` lu depuis le vrai `.env` du dépôt (`WEB_URL_PUBLIQUE` — sur ce
  poste `http://192.168.1.10:5173`, pas `localhost:5173` : un `Origin` figé en dur aurait
  échoué en 403 anti-CSRF).
- **Rate limit `/recherche` respecté.** `GardeLimitationRecherche` limite à 40 requêtes/30s PAR
  UTILISATEUR (`apps/api/src/common/securite/garde-limitation-recherche.ts`). Le scénario
  correspondant reste à concurrence 1 et 15 requêtes par variante, largement sous la limite.

## Aléas rencontrés (et comment le banc s'en protège)

Le serveur de dev (`nest start --watch`) est **partagé** avec d'autres agents qui écrivent dans
`apps/api/src/` en parallèle — chaque écriture le redémarre, coupant les connexions en vol
(`fetch failed` / `UND_ERR_SOCKET`, observé en pratique le 27.08.2026, ~36 requêtes perdues d'un
coup sur `vehicules-page50`). `SessionBanc.requete()` (`lib/http.mjs`) retente automatiquement
jusqu'à 8 fois, avec 1,5s d'attente entre chaque tentative — assez large pour couvrir un
redémarrage complet — avant de rendre `statut: -1` (compté comme anomalie dans le rapport plutôt
que de faire planter toute la campagne). Si le rapport final liste des anomalies à `-1`, c'est ce
phénomène, pas un défaut de l'API — relancer le banc.

## Structure

```
scripts/banc/
  README.md                 ce fichier
  config.mjs                identifiants démo, fragments, tailles d'échantillon, comptage SQL statique
  executer-banc.mjs          point d'entrée — orchestre tous les scénarios, écrit les résultats
  lib/
    http.mjs                 SessionBanc : connexion + requêtes avec cookie/Origin réels, retries
    executer-scenario.mjs    pool de promesses borné, calcule statuts + latences par scénario
    pagination.mjs            marche de curseur (profondeur + intégrité complète)
    stats.mjs                 percentiles (rang le plus proche), résumé de latences
  resultats/                 sorties horodatées .json + .md (une paire par campagne)
```
