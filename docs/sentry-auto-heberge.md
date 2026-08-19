$=^
Décision de @laupernoe : la supervision des erreurs (Sentry, SDK déjà intégré dans
`apps/api/src/observabilite/` et `apps/web/src/observabilite/`) doit être **auto-hébergée en
Suisse**, pas le produit `sentry.io` — cohérence avec le reste de l'infrastructure (nLPD, données de
garages et de leurs clients). Ce document couvre ce que ça coûte réellement à exploiter seul, et
propose une alternative plus légère qui satisfait la même contrainte.

**Ce document ne touche à aucun code applicatif** — l'intégration SDK (`initialiser-sentry.ts`,
`nettoyer-evenement.ts`, `apps/web/src/observabilite/sentry.ts`) est faite par d'autres agents en
parallèle. Ici : comment et où fait tourner l'instance qui reçoit ces événements.

0. Ce qui ne change pas, quel que soit le choix ci-dessous

---

**L'application ne dépend jamais de la disponibilité de sa supervision.** C'est déjà garanti côté
code, pas seulement une intention :

- `SENTRY_DSN` (API) et `VITE_SENTRY_DSN` (front) sont **optionnels** dans les deux schémas de
  configuration zod — leur absence n'empêche pas l'API de démarrer ni le front de fonctionner.
- `initialiserSentry()` (`apps/api/src/observabilite/initialiser-sentry.ts`) retourne
  immédiatement si `SENTRY_DSN` est vide, avant tout appel réseau, et enveloppe `Sentry.init`
  dans un `try/catch` — une option de config invalide ne peut pas empêcher l'API de démarrer.
- Le SDK Sentry (côté serveur comme navigateur) est lui-même conçu pour être « fail-open » :
  l'envoi d'événements se fait en tâche de fond, best-effort ; si l'instance Sentry est
  injoignable, les appels applicatifs ne bloquent pas et n'échouent pas à cause de ça.

**Conséquence pratique pour ce document** : si l'instance Sentry (quelle que soit l'option
choisie ci-dessous) tombe, plante, ou est en maintenance, **DFA continue de fonctionner
normalement pour les garages** — @laupernoe perd simplement de la visibilité sur les erreurs pendant
cette fenêtre, il ne perd pas le service. C'est ce qui rend défendable de commencer avec une
option modeste : le pire cas n'est jamais une panne de production, seulement un angle mort
temporaire de supervision.

1. Deux options, une recommandation

---

**Composants**

- Sentry auto-hébergé (pile complète) : Kafka, ClickHouse, Postgres dédié, Redis, Zookeeper, Symbolicator, Relay, Snuba, plusieurs workers (~15-20 conteneurs)
- GlitchTip (recommandé) : Django + Celery + Postgres + Redis (4-5 conteneurs)
  **RAM réaliste**
- Sentry auto-hébergé (pile complète) : de l'ordre de 16 Go et plus (voir §2.1)
- GlitchTip (recommandé) : de l'ordre de 2-4 Go
  **Compatible SDK `@sentry/*` déjà intégré**
- Sentry auto-hébergé (pile complète) : Oui (c'est le produit d'origine)
- GlitchTip (recommandé) : Oui — GlitchTip implémente le même protocole d'ingestion Sentry, DSN de même forme, aucun changement de code
  **Fonctionnalités**
- Sentry auto-hébergé (pile complète) : Capture d'erreurs, tracing de performance, session replay, alerting avancé, etc.
- GlitchTip (recommandé) : Capture d'erreurs, tracing basique, alerting — pas de session replay, UI plus simple
  **Cycle de mises à jour**
- Sentry auto-hébergé (pile complète) : Rapide, parfois cassant (§2.3)
- GlitchTip (recommandé) : Plus lent, projet plus petit, moins de composants qui peuvent diverger
  **Adapté à**
- Sentry auto-hébergé (pile complète) : Une équipe qui utilise réellement le tracing/replay avancés
- GlitchTip (recommandé) : Un développeur seul qui veut voir ses erreurs, pas opérer une plateforme d'observabilité

**Recommandation : GlitchTip**, tant que le besoin réel est « voir les erreurs avant que le
client les signale » (la formulation même de la philosophie de support de ce projet) et pas
« exploiter du tracing de performance distribué ». La pile Sentry complète est un outil pensé
pour des équipes qui l'opèrent à plein temps ou via l'offre cloud — l'auto-héberger en solo pour
un DMS avec quelques premiers garages est disproportionné par rapport au besoin, et ajoute un
risque opérationnel (§2.3, §2.4) sans bénéfice correspondant à ce stade.

**Cette recommandation n'annule pas la décision de @laupernoe d'auto-héberger** — les deux options sont
auto-hébergées, en Suisse, aucune donnée qui transite par un tiers non chiffré. Le choix entre les
deux est un choix d'outillage, pas un choix de conformité. Si @laupernoe préfère malgré tout la pile
complète (ex. anticipation d'un besoin de tracing avancé), §2 documente honnêtement ce que ça
implique à opérer seul ; §3 documente GlitchTip dans le même niveau de détail.

2. Option A — Sentry auto-hébergé (pile complète)

---

**2.1 Prérequis matériels réalistes**

La documentation officielle du projet `getsentry/self-hosted` évolue avec chaque version — les
chiffres ci-dessous sont des ordres de grandeur à vérifier contre la version installée au moment
du déploiement, pas des valeurs à copier aveuglément :

- **RAM** : de l'ordre de 16 Go au minimum pour un fonctionnement stable, principalement à cause
  de Kafka et ClickHouse qui tournent en permanence même à très faible volume d'événements.
  Nettement plus confortable au-delà (24-32 Go) dès que la rétention ou le volume d'événements
  grandit.
- **CPU** : de l'ordre de 4 vCPU minimum — les multiples workers (ingestion, traitement des
  symbols, tâches périodiques) se disputent le CPU même à faible charge.
- **Disque** : ClickHouse et Kafka écrivent en continu (logs, segments, index) — prévoir un SSD,
  pas un disque mécanique, et surveiller l'espace disque activement (§2.5, ça grossit plus vite
  qu'il n'y paraît pour un volume d'événements pourtant modeste).

**Mis en regard du serveur applicatif de DFA lui-même** (hypothèse de départ 8 Go RAM / 4 vCPU,
voir `docs/deploiement-production.md` §3.4) : la pile Sentry complète, à elle seule, demande
**au moins autant de ressources que tout le reste de l'infrastructure DFA réunis**. Cohabiter sur
le même serveur n'est pas raisonnable sans un dimensionnement bien plus généreux — voir §2.6 pour
la recommandation d'isolement.

**2.2 Installation**

Le projet officiel (`github.com/getsentry/self-hosted`) fournit un installeur scripté, pas un
simple `docker compose up` : `git clone` du dépôt officiel, puis `./install.sh`, qui génère sa
propre configuration Docker Compose (nombreux fichiers, réseau dédié) et provisionne son propre
Postgres, sa propre instance Kafka/ClickHouse — **complètement indépendants** du Postgres/Redis
de `docker-compose.yml` (§2.6 explique pourquoi les garder séparés). Prévoir une bonne heure
pour la première installation, plus le temps de créer le premier compte admin et le premier
projet (qui donne le DSN à reporter dans `SENTRY_DSN`/`VITE_SENTRY_DSN`).

**2.3 Mises à jour — le point le plus honnête de ce document**

Le cycle de release de Sentry self-hosted est rapide (nouvelles versions fréquentes) et **casse
parfois** : montées de version majeures de ClickHouse ou de Kafka, changements de schéma qui
exigent de suivre l'ordre exact des étapes documentées dans les notes de version officielles,
scripts de migration qui doivent tourner avant de redémarrer. Ce n'est pas un `docker compose
pull && up -d` sûr par défaut, contrairement à `postgres:16-alpine`/`redis:7-alpine` dans
`docker-compose.yml`.

Conséquence pratique pour un opérateur seul : **ne jamais mettre à jour Sentry en urgence ou sans
lire les notes de version de chaque étape intermédiaire** si plusieurs versions ont été sautées.
Prévoir une fenêtre calme, une sauvegarde fraîche (§2.4) juste avant, et accepter qu'une mise à
jour puisse occasionnellement demander plus qu'un après-midi à cause d'une régression amont — ce
risque est structurel au projet, pas une question de compétence.

**2.4 Sauvegarde de Sentry lui-même**

Sentry self-hosted a son propre Postgres (métadonnées : projets, utilisateurs, règles d'alerte),
son propre ClickHouse (événements bruts), son propre volume Kafka (file d'attente, pas destinée à
être durable long terme). Trois implications :

- Le Postgres interne de Sentry se sauvegarde comme n'importe quel Postgres (`pg_dump`, chiffré,
  hors site — même politique que §7 de `docs/deploiement-production.md`), mais c'est une
  **deuxième** procédure de sauvegarde à opérer et à tester, distincte de celle de DFA.
  Perdre ces métadonnées sans sauvegarde signifie reconfigurer projets/utilisateurs/alertes à la
  main.
- ClickHouse (les événements eux-mêmes) est plus lourd à sauvegarder proprement et, en pratique,
  **la donnée qu'il contient est la moins critique à conserver long terme** — un événement
  d'erreur perdu est regrettable mais pas une perte de données métier au sens de `CONTRIBUTING.md`
  (ce ne sont ni des factures, ni des dossiers clients). Beaucoup d'exploitants self-hosted
  choisissent délibérément de ne pas sauvegarder ClickHouse et acceptent la perte d'historique
  d'événements en cas de sinistre, en misant sur la rétention courte (§2.5) qui limite de toute
  façon ce qu'il y aurait à perdre.
- Un sinistre total sur l'instance Sentry n'est donc, dans cette logique, pas nécessairement à
  restaurer — **réinstaller proprement et repartir à vide** est une option légitime, précisément
  parce que §0 garantit que ça n'affecte jamais DFA lui-même.

**2.5 Rétention et volumétrie des événements**

Le défaut officiel (90 jours de rétention côté ClickHouse) est largement au-dessus du besoin réel
de ce projet à ce stade (quelques garages, volume d'erreurs attendu faible). Réduire la rétention
(configuration `SENTRY_EVENT_RETENTION_DAYS` côté installeur officiel) à 30 jours limite la
croissance du volume disque sans perdre de capacité de diagnostic utile — une erreur non
diagnostiquée en un mois ne le sera généralement pas mieux trois mois plus tard.

**2.6 Sécurisation de l'accès et isolement**

- Interface d'administration Sentry derrière un accès authentifié (compte Sentry natif, 2FA
  activé sur le compte admin) — ne jamais l'exposer sans authentification, elle donne accès aux
  détails d'erreurs applicatives (qui peuvent contenir des fragments de contexte technique,
  malgré le nettoyage nLPD fait côté DFA avant envoi, voir `nettoyer-evenement.ts`).
- **Isoler la pile Sentry du serveur applicatif DFA** — recommandation forte, pas une option
  secondaire. Vu le gabarit décrit en §2.1 (aussi lourd que tout DFA réuni) et le risque de
  cycle de mise à jour cassant (§2.3), faire cohabiter les deux stacks sur le même hôte expose
  DFA lui-même à une pression mémoire ou une saturation disque causée par Sentry — exactement le
  genre de couplage que §0 promet d'éviter au niveau applicatif, à ne pas réintroduire au niveau
  infrastructure. Un second serveur, même modeste par ailleurs, dédié à la supervision, garde
  les deux domaines de panne complètement séparés.
- Réseau : accès public uniquement à l'interface web (derrière TLS, un reverse proxy dédié —
  même logique que Caddy pour DFA, mais une instance séparée), jamais les ports internes
  (Kafka, ClickHouse, Postgres interne) exposés au-delà du réseau Docker de cette stack.

3. Option B — GlitchTip (recommandé)

---

GlitchTip est un projet open source qui réimplémente l'API d'ingestion d'événements de Sentry
(protocole/format DSN identiques) avec une architecture nettement plus légère : Django + Celery
(traitement asynchrone) + Postgres + Redis. Les SDK déjà intégrés dans DFA
(`@sentry/nestjs` côté API, l'équivalent côté web) fonctionnent **sans aucune modification de
code** — seul le DSN change d'hôte, exactement comme le passage de `sentry.io` à une instance
interne l'est déjà pour l'option A (voir le commentaire de tête de
`apps/api/src/observabilite/initialiser-sentry.ts`, écrit pour être vrai des deux options).

**3.1 Prérequis matériels réalistes**

De l'ordre de 2 à 4 Go de RAM et 1-2 vCPU suffisent pour un usage à l'échelle de ce projet
(quelques garages, volume d'erreurs modeste) — un gabarit qui peut raisonnablement cohabiter avec
le serveur applicatif DFA lui-même si le serveur est dimensionné avec un peu de marge, sans
nécessiter une seconde machine dédiée comme le recommande §2.6 pour la pile complète. Le choisir
malgré tout sur un hôte séparé reste une bonne pratique de défense en profondeur (isolement des
domaines de panne, §0), mais c'est ici un confort, pas une nécessité dictée par le gabarit.

**3.2 Installation**

GlitchTip se déploie via son propre `docker-compose.yml` (fourni par le projet,
`docs.glitchtip.com`) : un service `web` (Django), un `worker` (Celery), `postgres`, `redis`, et
un service `migrate` qui applique les migrations Django au démarrage — schéma d'ensemble très
proche de `docker-compose.yml` lui-même. Comme pour Sentry (§2.6), garder ce Postgres/Redis
**strictement séparés** de ceux de DFA (`docker-compose.yml`) : deux bases pour deux
domaines de responsabilité, un secret compromis ou une corruption sur l'une n'affecte jamais
l'autre. Premier démarrage : créer le compte admin (`docker compose exec web python manage.py
createsuperuser` ou équivalent selon la version), créer une organisation et un projet, récupérer
le DSN généré.

**3.3 Mises à jour**

Cycle de release plus lent et plus prévisible qu'une pile Sentry complète (moins de composants
tiers à synchroniser entre eux) : `docker compose pull && up -d` suffit dans l'immense majorité
des cas, avec les migrations Django appliquées automatiquement au démarrage du service `migrate`.
Toujours lire les notes de version avant une montée de version majeure, et sauvegarder
juste avant (§3.4) — même discipline que pour n'importe quel service stateful de ce projet, mais
sans le risque structurel documenté en §2.3.

**3.4 Sauvegarde**

Un seul Postgres à sauvegarder (contrairement à Postgres + ClickHouse pour l'option A) : même
politique que §7 de `docs/deploiement-production.md` (dump chiffré, hors site, testé en
restauration) — c'est un Postgres ordinaire, la procédure ne demande aucune adaptation
particulière au-delà de pointer vers cette instance plutôt que celle de DFA.

**3.5 Rétention et volumétrie**

Rétention configurable au niveau de l'organisation/projet dans l'interface GlitchTip ; à défaut
de besoin identifié, 30 jours est un point de départ raisonnable pour ce projet, ajustable sans
redéploiement.

**3.6 Sécurisation de l'accès**

Mêmes principes que §2.6 : TLS, authentification native + 2FA sur le compte admin, aucun port
interne (Postgres/Redis de GlitchTip) exposé au-delà du réseau Docker de cette stack.

**3.7 Limites connues à accepter**

Pas de session replay (rejouer visuellement une session utilisateur ayant produit une erreur), et
un tracing de performance plus basique que l'offre Sentry complète. Pour ce projet, à ce stade
(philosophie « on ne complexifie que sous contrainte réelle », `CONTRIBUTING.md`), ce n'est pas une
perte fonctionnelle qui justifie le coût d'exploitation supplémentaire de l'option A — à
réévaluer seulement si un besoin concret et récurrent de ces fonctionnalités apparaît.

4. Ce qui reste vrai quelle que soit l'option retenue

---

- `SENTRY_DSN`/`SENTRY_ENVIRONMENT`/`SENTRY_TAUX_ECHANTILLONNAGE_TRACES` côté `.env.production`
  de l'API, et `VITE_SENTRY_DSN` inliné au build de l'image `web` (voir
  `docs/deploiement-production.md` §3.6 et §9) — aucune de ces variables n'est spécifique à
  l'option choisie, seul l'hôte dans le DSN change.
- Le nettoyage des événements avant envoi (`apps/api/src/observabilite/nettoyer-evenement.ts`,
  `sendDefaultPii: false` dans `initialiser-sentry.ts`) s'applique identiquement, l'instance
  réceptrice ne change rien à cette garantie côté DFA.
- Aucune des deux options ne doit jamais être un prérequis de démarrage de DFA (§0) — si ce
  document devait un jour être révisé pour ajouter un `depends_on`/health check qui bloque
  l'API tant que Sentry/GlitchTip n'est pas joignable, ce serait une régression à corriger
  immédiatement, pas une amélioration de robustesse.
