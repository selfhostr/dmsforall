Déclenchement périodique des relances de facturation — cron, pas file d'attente
====================================================================================

Décision de @laupernoe : l'hébergement sera toujours du Linux dans Docker, jamais un cluster nécessitant
une file d'attente distribuée pour coordonner des workers. `POST /relances/facturation/planifier`
et `POST /relances/facturation/envoyer` (`apps/api/src/relances/relances.controller.ts`) existent
déjà, sont **idempotentes** par contrainte unique en base
(`relance_planifiee_tenant_type_objet_palier_uk`, `apps/api/src/db/migrations/0045_*.sql`) et
**bornées par lot** (`LOT_PLANIFICATION = 200`, `LOT_ENVOI = 100`, indicateur `encoreATraiter`
consommé en boucle). C'est précisément ce qui rend un simple cron acceptable ici, sans verrou
distribué : un double déclenchement ne peut pas produire de doublon métier.

L'implémentation exécutable de tout ce document est `docker/relances/` (scripts + gabarits
systemd) — ce fichier explique le **pourquoi**, les scripts exécutent, ils ne réexpliquent pas.

Où vit le cron : l'hôte, via systemd timer
-------------------------------------------

**Décision : `systemd timer` sur le serveur hôte, pas un conteneur dédié, pas de cron applicatif
dans le process API.**

DFA est une **instance unique multi-tenant** (RLS, pas un déploiement par garage) : le coût d'une
configuration manuelle sur UN serveur ne se multiplie pas par dix. Trois options, un seul critère
retenu — _qui s'aperçoit que ça a cassé à 3h du matin_ :

- **Systemd timer sur l'hôte (retenu)** : `OnFailure=` déclenche une unité de notification sans
  code à écrire (§5) ; `Persistent=true` rattrape une exécution manquée au redémarrage (cohérent
  avec l'idempotence, un rattrapage tardif ne produit jamais de doublon) ; `journalctl -u
dfa-relances.service` est le premier réflexe de débogage, déjà la doctrine du script de
  sauvegarde (`docs/deploiement-production.md` §7.1) — un seul patron à retenir pour les deux
  tâches planifiées du produit. Le déclencheur ne fait qu'émettre des appels HTTP vers l'app déjà
  conteneurisée ; il ne porte ni état ni logique métier, donc l'exception à « tout en conteneurs »
  reste étroite et déjà précédée.
- **Conteneur dédié dans `docker-compose.yml`** (ex. sidecar Ofelia/busybox-cron) : rejeté à
  ce stade. Ajoute une image, un healthcheck, un cycle de vie à maintenir pour un besoin que
  systemd couvre nativement et gratuitement sur n'importe quel hôte Linux — exactement le genre de
  complexité que « Docker Compose bien fait avant Kubernetes » invite à ne pas ajouter sans
  contrainte réelle. À reconsidérer seulement si l'hébergement cesse d'avoir un accès systemd
  direct (ex. PaaS sans accès hôte).
- **Cron applicatif** (`@nestjs/schedule` dans le process API) : rejeté. Couple la planification au
  cycle de vie du déploiement (un redéploiement d'image, courant selon la doctrine CI de ce dépôt,
  redémarre le process — risque de double ou zéro déclenchement le jour du déploiement) et mélange
  une responsabilité d'infrastructure dans le code métier.

Authentification — le point dur, non résolu aujourd'hui
------------------------------------------------------

**Aucun mécanisme existant ne permet à ce cron d'appeler l'API légitimement aujourd'hui.** Deux
pistes examinées et écartées, une troisième à construire.

**Écarté — forger un `Origin`.** `GardeSession.verifierOrigine`
(`apps/api/src/auth/garde-session.ts`) exige `Origin` sur TOUTE méthode mutante, y compris les
routes `@Public()`, sans exception. Un script contrôle entièrement les en-têtes qu'il envoie, donc
_techniquement_ rien n'empêche de fabriquer un `Origin` accepté — mais c'est exactement le
contournement que la consigne de cette tâche interdit : ça maquille un appel serveur-à-serveur en
requête de navigateur pour passer un contrôle anti-CSRF qui n'a pas de sens pour ce cas. Le
commentaire du guard lui-même anticipe le bon chemin : _« les intégrations futures passeront par
des tokens API dédiés, pas par ce cookie-session »_ (garde-session.ts, ligne ~29).

**Écarté — copier `poste_atelier`.** C'est le seul « compte de service » existant
(`apps/api/src/auth/comptes-de-service.ts`), mais il résout un problème différent : une borne
physique dans l'atelier, dont chaque geste doit rester attribuable via `cree_par_utilisateur_id`
(FK vers `utilisateur`, contrainte d'audit trail). Sa solution reste un compte-cookie classique
(Argon2id + session navigateur + `GardeSession` intégral, Origin compris) — il ne dispense d'aucune
des vérifications qui bloquent un script headless. Ce que ce précédent apporte réellement : la
preuve que « compte de service = ligne `utilisateur` ordinaire à droits restreints » est déjà la
doctrine du produit pour préserver l'audit trail, pas une exception à inventer.

**À construire (hors périmètre de cette tâche — décrit, pas codé) :**

1. Une nouvelle branche dans `GardeSession` : reconnaître `Authorization: Bearer <jeton>`, résoudre
   le principal depuis une nouvelle table de jetons plutôt que le cookie, et **dispenser
   uniquement ce chemin** de la vérification `Origin` — justifié parce que `Origin`/CSRF protège
   un identifiant _ambiant_ qu'un navigateur attache automatiquement (le cookie) ; un jeton porté
   explicitement dans un en-tête n'est jamais attaché à l'insu du client, donc rien à défendre. Si
   un cookie de session est présent, la vérification `Origin` doit continuer à s'appliquer sans
   exception, même avec un `Authorization` en plus — l'exemption ne vaut que pour un appel
   _purement_ porteur de jeton. Point à faire trancher explicitement par `reviewer-securite` avant
   toute implémentation : c'est un assouplissement d'un contrôle de sécurité gelé depuis l'étape 0.
2. Une table de jetons (ex. `utilisateur_jeton_api` : `tenant_id`, `utilisateur_id`, hash du jeton,
   `cree_le`, `dernier_utilise_le`, `revoque_le`) — hachage rapide (SHA-256), pas Argon2id : c'est
   un secret machine à haute entropie généré aléatoirement, pas un mot de passe humain à protéger
   contre le brute-force par ralentissement délibéré.
3. Un nouveau rôle dédié — nom de travail `automate_relances`, à trancher par `expert-auth`/@laupernoe —
   ajouté à `MATRICE_DROITS` avec **exactement** `relances.facturation.planifier` et
   `relances.facturation.envoyer`, rien de plus (moindre privilège : ni `direction` ni `comptable`
   au complet). `@ExigerDroit(...)` sur le contrôleur reste inchangé — la matrice est déjà pilotée
   par les données, ajouter un rôle qui ne détient que ces deux actions ne touche à aucun contrôleur.
4. Ce rôle reste porté par une vraie ligne `utilisateur` (un « compte technique » par tenant,
   `role = 'automate_relances'`), pour la même raison que `poste_atelier` : `cree_par_utilisateur_id`
   exige une FK. Le jeton est une deuxième forme de créance sur CETTE ligne, pas un acteur hors du
   modèle. Émission : une fois par tenant, affichée une seule fois puis stockée hachée — même
   discipline qu'un mot de passe aujourd'hui, juste un mécanisme de vérification plus rapide.
5. Révocation : `revoque_le` sur le jeton **et** `utilisateur.statut = 'suspendu'` sur la ligne
   invalident l'un comme l'autre — cohérent avec la révocation déjà en place pour toute session.

Tant que ceci n'existe pas, `docker/relances/declencher-relances.sh` reçoit aujourd'hui
`403 AUTH_ORIGINE_REFUSEE` sur chaque appel — documenté en tête du script, assumé, pas contourné.

Multi-tenant : boucle côté script, jamais côté API
---------------------------------------------------

Aucune route n'accepte de `tenantId` en paramètre (règle absolue du dépôt) : le tenant est toujours
résolu depuis le principal authentifié de la requête. Une route « pour tous les tenants » n'existe
donc pas et ne doit pas exister — le produit n'a d'ailleurs aucun acteur « super-admin
inter-tenant » dans son modèle actuel (`admin` reste borné à un seul tenant, comme `direction`).

`declencher-relances.sh` fait la boucle que l'API ne fait pas : un fichier d'identifiants
(`docker/relances/identifiants-relances.env.example`, hors dépôt en production) associe un slug de
garage à un jeton, une ligne par tenant actif. **Isolation des échecs impérative** : chaque tenant
tourne dans son propre appel, sans `set -e` global — un jeton révoqué ou un connecteur en panne
pour le garage A ne doit jamais empêcher le garage B d'être relancé. Le script compte les succès et
échecs séparément et ne sort en erreur qu'à la fin, si au moins un tenant a échoué (§5).

Coût assumé à 10 garages : @laupernoe ajoute une ligne au fichier à chaque onboarding, manuellement. À
réévaluer (script de génération depuis la table `tenant`) si ce nombre approche la cinquantaine —
sur-ingénierie aujourd'hui, dette réelle plus tard.

Fenêtre d'envoi : jours ouvrés, 07:30 Europe/Zurich
----------------------------------------------------

Jamais 3h du matin (aucune raison métier de relancer la nuit, et un rappel de facture impayée qui
arrive à 3h du matin dégrade la relation client pour rien), jamais le week-end (personne ne répond
côté garage, l'échéance perçue par le client n'a aucune urgence horaire). `Mon..Fri 07:30
Europe/Zurich`, `RandomizedDelaySec=60`. Une seule exécution par jour suffit : les routes bouclent
déjà en interne sur `encoreATraiter` jusqu'à épuisement du lot du jour, et la cadence des relances
se raisonne en jours (paliers), jamais en heures.

**Jours fériés cantonaux : volontairement ignorés.** 26 calendriers cantonaux distincts pour un
canal SMS/e-mail automatisé n'a pas le même impact qu'un appel téléphonique nécessitant un humain
joignable — le pire résultat d'un rappel un jour férié est une relance perçue comme
malvenue, pas un incident. Sur-ingénierie réelle à ce stade ; à rouvrir seulement si le canal
s'étend un jour à l'appel téléphonique (hors périmètre actuel, §5 de
`docs/specification-relances-automatiques.md`).

Observabilité : GlitchTip, déjà en place, exploité directement
--------------------------------------------------------------

**Un cron mort en silence est le pire cas** : des clients qui ne sont plus relancés, sans qu'aucune
route ne le révèle jamais (ni erreur 500, ni ticket client). Deux mécanismes distincts, parce que
« un échec constaté » et « un silence total » ne peuvent pas être détectés par le même code :

- **Échec constaté** (`declencher-relances.sh`, `dfa-relances-echec.service`) — signalé
  **directement dans GlitchTip**, via l'API `store` historique de Sentry que GlitchTip
  réimplémente (`docs/sentry-auto-heberge.md` §3), en HTTP brut (`docker/relances/lib-glitchtip.sh`).
  Réutilise `SENTRY_DSN`, déjà présent dans `.env.production` pour l'application — aucun nouveau
  secret, aucun nouveau tiers, tout reste auto-hébergé en Suisse (nLPD). GlitchTip regroupe les
  événements de message identique en un seul « issue » avec compteur d'occurrences : dix échecs du
  même tenant le même jour ne noient pas la boîte de réception, un échec systémique (tous les
  tenants) reste visuellement distinct d'un échec isolé.
- **Silence total** (`chien-de-garde-relances.sh`, planifié indépendamment par
  `dfa-relances-chien-de-garde.timer`, 09:00 les jours ouvrés) — le seul cas qu'un script qui ne
  s'exécute jamais ne peut pas signaler lui-même. Vérifie la fraîcheur d'un fichier de statut
  écrit par `declencher-relances.sh` (`.dernier-statut-relances`, jamais son contenu métier ni la
  base — dépendance minimale) ; au-delà de 6h de retard sur l'heure attendue, envoie un événement
  GlitchTip. Volontairement **indépendant** de `dfa-relances.service` (pas de `Requires=`/`After=`
  croisé) : le but précis est de détecter le cas où ce service ne tourne pas du tout.

Écarté : un service de heartbeat tiers (UptimeRobot, Healthchecks.io…). GlitchTip existe déjà,
auto-hébergé, et couvre le même besoin sans ajouter de dépendance ni rouvrir une question nLPD pour
une méta-donnée aussi mineure que « le job a tourné ».

Reprise des relances bloquées (point remonté par l'audit)
----------------------------------------------------------

`traiterUneRelance` (`apps/api/src/relances/service-relances-facture.ts`) réclame une ligne par une
mise à jour conditionnelle (`statut: 'prete' → 'en_cours_envoi'`), puis fait l'appel réseau vers le
connecteur, puis enregistre l'issue dans une **transaction séparée**. Si le processus meurt entre
les deux (redémarrage, panne, OOM), la ligne reste `en_cours_envoi` indéfiniment : aucun code
actuel ne relit ce statut, seul `'prete'` est réclamé.

**Sans conséquence aujourd'hui** — rien ne tourne encore en production — mais l'ordonnanceur doit
prévoir la reprise avant le premier vrai déploiement. Conception (à construire côté applicatif,
hors périmètre de cette tâche) :

- `relance_planifiee.modifie_le` existe déjà et est touché automatiquement par trigger
  (`relance_planifiee_touche_modifie_le`) à chaque `UPDATE`, y compris la réclamation elle-même —
  **aucune nouvelle colonne n'est nécessaire**, la date de réclamation est déjà en base.
- Ajouter, en tête de `envoyerPretes()` (ou en étape préliminaire dédiée), une requête de
  « déblocage » : `UPDATE relance_planifiee SET statut = 'prete' WHERE tenant_id = $1 AND statut =
'en_cours_envoi' AND modifie_le < now() - interval '15 minutes'`. Quinze minutes est une marge
  large au-dessus du temps normal d'un appel réseau + aller-retour base ; à ajuster si le
  connecteur réel (aujourd'hui factice) s'avère plus lent.
- Le déblocage est lui-même idempotent et sans risque de double traitement : il ne fait que
  remettre la ligne dans l'état `'prete'` que la réclamation conditionnelle protège déjà.
  L'exécution suivante du cron (ou la même, si le déblocage précède la boucle de réclamation)
  reprend la ligne normalement.

Ce qui reste à construire côté applicatif
-------------------------------------------

1. Authentification par jeton API (§2, points 1 à 5) — le blocage réel avant toute exécution.
2. Déblocage des relances orphelines `en_cours_envoi` (§6) — pas bloquant pour livrer le cron, mais
   à poser avant la première charge réelle.
3. Provisionnement : un moyen (script d'admin ou écran) de créer le compte technique
   `automate_relances` par tenant et d'émettre son jeton, affiché une seule fois.

Une fois ces trois points livrés, `docker/relances/declencher-relances.sh` devient exécutable tel
quel — aucune modification attendue côté infra.
