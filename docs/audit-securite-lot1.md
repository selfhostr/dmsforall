# Audit de sécurité — lot 1 (Atelier, Clients, Véhicules, Paramétrage, Recherche)

- **Date** : 28 juillet 2026
- **Auditeur** : reviewer-securite (lecture seule — aucun fichier de code modifié)
- **Périmètre** : `apps/api/src/**` (`atelier/`, `clients/`, `vehicules/`, `parametrage/`, `recherche/`,
  `common/`, `auth/`, `db/`, `observabilite/`, `config/`) et `apps/api/src/db/migrations/0000` → `0008`
- **Hors périmètre** : `apps/web/**`, infrastructure de déploiement
- **Base de vérification** : conteneur `dfa-postgres` (base `dfa_dev`), migrations `0000` → `0008` appliquées
- **Convention** : chaque finding distingue explicitement ce qui est **prouvé en exécution** de ce qui est
  **lu dans le code**. Aucun finding sans scénario d'exploitation écrit.

> **Note sur les modules en cours d'écriture.** `apps/api/src/atelier/` et `apps/api/src/clients/` étaient
> en cours de modification par d'autres agents pendant cet audit. Ce qui ressemble à du code à moitié
> écrit est regroupé en §5 « À revérifier après stabilisation » et n'est pas compté comme finding.

---

## 1. Synthèse

| Gravité   | Nombre |
| --------- | ------ |
| Critique  | **0**  |
| Élevée    | **1**  |
| Moyenne   | **3**  |
| Faible    | **4**  |
| **Total** | **8**  |

### Verdict sur la seule question qui compte : un tenant peut-il lire ou écrire les données d'un autre ?

**Non — et c'est prouvé en exécution, pas déduit du code.**

Le dispositif d'étanchéité repose sur quatre couches indépendantes, toutes vérifiées :

1. **Le rôle de connexion.** `dfa_app` est `NOSUPERUSER`, `NOBYPASSRLS`, non propriétaire des tables. La
   migration `0001_socle_rls.sql:29-48` refuse de s'appliquer sinon, et `ServiceAccesBase.verifierPostureRls()`
   (`apps/api/src/db/acces-base.service.ts:277-474`) refuse le démarrage de l'API sinon.
2. **Le contexte tenant en portée transaction.** `AccesBase.enTenant()`
   (`apps/api/src/db/acces-base.service.ts:229-267`) pose `app.tenant_id` avec `set_config(..., true)` —
   portée transaction, donc réinitialisée au COMMIT comme au ROLLBACK. Le piège du pooling est fermé.
   Le `tenantId` est validé comme UUID **avant** tout SQL et provient exclusivement de
   `ServiceContexteRequete.contexteTenant()`, alimenté par `GardeSession`.
3. **Les politiques RLS.** Les 38 tables du schéma `public` portent RLS ; les 35 tables métier portent en
   plus `FORCE` et une politique `USING` **et** `WITH CHECK` via `tenant_courant()`. Les 3 exceptions
   (`utilisateur`, `session`, `journal_securite`) sont documentées et nécessaires à l'amorçage.
4. **Le scope applicatif explicite.** Toutes les requêtes lues dans `clients/`, `vehicules/`, `atelier/`,
   `parametrage/`, `recherche/`, `socle/` rescopent sur `tenant_id` en plus du RLS (une seule exception
   bénigne, finding **N-01**).

**Aucun endpoint n'accepte de `tenant_id` en paramètre de requête, en corps JSON ni en en-tête.** Vérifié
par inventaire exhaustif : `grep -rn "tenantId" apps/api/src` ne rend que `ctx.tenantId`,
`principal.tenantId` et des définitions de types. Aucun schéma zod du contrat gelé ne porte de champ
`tenantId`.

**Aucune injection SQL exploitable.** Aucun `sql.raw`, aucun `sql.identifier`, aucune concaténation de
chaîne dans une requête. Les tris dynamiques (`clients/pagination-triee.ts`,
`vehicules/service-vehicule.ts:446-482`) sélectionnent des fragments `SQL` **constants du code** via une
clé d'énumération validée par zod — le paramètre utilisateur ne traverse jamais la structure de la
requête, seulement ses valeurs liées.

Ce qui **n'est pas** couvert par ce verdict et reste à traiter avant la mise en production :

- une **élévation de privilège intra-tenant** (finding **É-01**) : un technicien peut falsifier un
  kilométrage à la baisse, geste que la matrice réserve au chef d'atelier ;
- une **disponibilité inter-tenant** (finding **D-01**) : un tenant peut dégrader le service des autres,
  faute de limitation de débit hors authentification.

---

## 2. Findings

### É-01 — Correction de kilométrage à la baisse accessible à tout rôle pouvant saisir un kilométrage

- **Gravité : élevée**
- **Statut : lu dans le code, chaîne complète vérifiée (contrôleur -> service -> matrice)**
- **Fichiers** :
  - `apps/api/src/vehicules/vehicule-kilometrage.controller.ts:43` — `@ExigerDroit('vehicule.kilometrage.saisir')`
  - `apps/api/src/vehicules/service-vehicule-kilometrage.ts:78-92` et `:110`
  - `apps/api/src/auth/matrice-droits.ts:244-248` (`L962_KM_CORRECTION`), `:482-491` (`DROITS_TECHNICIEN`), `:462-473` (`DROITS_CHEF_ATELIER`)

**Le problème.** La matrice §10 (ligne L962) réserve explicitement la correction d'un kilométrage à la
baisse au chef d'atelier et à la direction — « réceptionnaire et technicien explicitement _non_ ». Cette
règle est bien codée sous forme d'action dédiée :

```ts
const L962_KM_CORRECTION: readonly Action[] = ['vehicule.kilometrage.corriger_regression'];
```

… mais **cette action n'est référencée par aucun `@ExigerDroit` du dépôt.** Inventaire exhaustif des
occurrences de `@ExigerDroit(` : `vehicule.kilometrage.saisir` apparaît 1 fois,
`vehicule.kilometrage.corriger_regression` 0 fois.

Le seul endpoint d'écriture de kilométrage, `POST /api/v1/vehicules/{id}/kilometrages`, exige
`vehicule.kilometrage.saisir` — accordé à `technicien`, `magasinier`, `receptionnaire`, `chef_atelier`,
`direction`, `admin`. Le service accepte ensuite une régression dès que `motifRegression` est fourni
(`service-vehicule-kilometrage.ts:78`), **sans jamais consulter le rôle** :

```ts
if (decision.regressif && !entree.motifRegression) {
  throw new ErreurMetier('VEHICULE_KILOMETRAGE_REGRESSIF', ...);
}
```

Le refus 409 n'est donc pas un contrôle d'autorisation : c'est une demande de motif, que le contrat
`schemaKilometrageVehicule` (`packages/shared/src/contrats/atelier/vehicule.ts:482`) rend triviale à
satisfaire (`z.enum(MOTIFS_KILOMETRAGE_REGRESSIF)` : `compteur_remplace`, `erreur_saisie`,
`changement_unite`, `correction`).

**Scénario d'exploitation.**

1. Un employé du garage avec le rôle `technicien` (le rôle le moins privilégié de l'atelier, celui qu'on
   distribue le plus largement sur les tablettes d'atelier) est authentifié normalement.
2. Il lit le dernier relevé d'un véhicule : `GET /api/v1/vehicules/{id}/kilometrages` -> dernier relevé
   185 000 km. Le droit `vehicule.lire` lui est accordé.
3. Il envoie :

   ```bash
   curl -X POST https://api.dmsforall.example/api/v1/vehicules/{id}/kilometrages \
     -H 'Origin: https://app.dmsforall.example' \
     -H 'Content-Type: application/json' \
     -b 'dfa_session=<son cookie>' \
     -d '{"valeur":112000,"unite":"km","releveLe":"2026-07-28T09:00:00Z",
          "source":"comptoir","motifRegression":"erreur_saisie"}'
   ```

4. Réponse `201`. Le relevé de 112 000 km devient le dernier connu du véhicule.

**Ce qu'il obtient.** La table `vehicule_kilometrage` est append-only : la fraude est tracée, mais elle
est **effective**. Or `lireDernierKilometrage()` (`vehicules/vehicule-requetes.ts:126-138`) trie sur
`releveLe desc` et alimente : le calcul de garantie constructeur (`construireReponseVehicule` ->
`calculerGarantie`, borne kilométrique), l'échéance d'entretien (`intervalleEntretienKm`), et le
kilométrage d'entrée figé sur l'OR. Un kilométrage rabaissé rouvre une garantie expirée et fausse la
valeur du véhicule — en Suisse, la manipulation d'un compteur est un délit (art. 146 CP, escroquerie) et
le DMS en devient l'instrument.

**Correction recommandée.** Dans `ServiceVehiculeKilometrage.creer`, faire remonter le
`PrincipalAuthentifie` (comme le font déjà `ServiceVehicule.fusionner` et les services `atelier/`) et
exiger explicitement `vehicule.kilometrage.corriger_regression` dès que `decision.regressif` est vrai,
quel que soit le motif — un `403 DROIT_INSUFFISANT` avec
`actionsProposees: [{ code: 'DEMANDER_HABILITATION' }]`. Le geste normal (kilométrage croissant) reste sur
`vehicule.kilometrage.saisir`. C'est exactement le motif déjà employé pour les confirmations
(`atelier/confirmations.ts:25-47`) : le droit est vérifié dans le service quand l'action dépend d'une
condition de donnée que le guard ne peut pas connaître.

---

### F-01 — Fuite d'internes de la base dans le corps `problem+json`, et 500 sur un `PATCH` au corps vide

- **Gravité : moyenne**
- **Statut : lu dans le code (chaîne complète vérifiée : schéma zod -> service -> filtre d'erreurs)**
- **Fichiers** :
  - `apps/api/src/clients/service-client-sous-collections.ts:148` — `new ErreurMetier('ERREUR_INTERNE', "Échec sur l'adresse.", { detail: String(erreur) })`
  - `apps/api/src/clients/service-client-sous-collections.ts:301` — idem pour les conditions commerciales
  - `apps/api/src/common/erreurs/filtre-probleme.ts:101-107` — `detail` est recopié tel quel dans la réponse
  - `packages/shared/src/contrats/atelier/client.ts:285-287` — `schemaModificationAdresseClient` est un `.partial()`, donc un corps vide est valide

**Le problème.** `FiltreProbleme` est conçu pour qu'« aucune stack, aucun message d'exception non typée
n'atteigne jamais le corps de la réponse » (commentaire de tête du fichier). Ces deux lignes contournent
cette garantie : elles emballent l'erreur brute dans le champ `detail` d'une `ErreurMetier`, que le filtre
recopie sans nettoyage vers le client.

**Scénario d'exploitation** — deux variantes, toutes deux atteignables par tout compte disposant de
`client.modifier` (réceptionnaire, chef d'atelier, magasinier, direction, admin).

_Variante A — provoquer une erreur du query-builder._

1. Un utilisateur au rôle `magasinier` envoie un `PATCH` au corps vide :

   ```bash
   curl -X PATCH https://api.dmsforall.example/api/v1/clients/{clientId}/adresses/{adresseId} \
     -H 'Origin: https://app.dmsforall.example' -H 'Content-Type: application/json' \
     -b 'dfa_session=<cookie>' -d '{}'
   ```

2. `schemaModificationAdresseClient` est un `.partial()` : le corps vide passe la validation.
3. `service-client-sous-collections.ts:121-124` exécute `tx.update(clientAdresse).set({})`. Drizzle lève
   « No values to set ».
4. `traduireViolationAdresse` ne reconnaît pas cette erreur et retombe sur la ligne 148 : réponse `500`
   dont le champ `detail` vaut `Error: No values to set`.

_Variante B — extraire le nom d'une contrainte._ Même endpoint, avec un corps qui viole une contrainte
`CHECK` ou une clé étrangère non traduite (par exemple un `pays` hors format ISO-2, ou un `type` d'adresse
dont l'unicité partielle ne figure pas dans la liste des deux contraintes reconnues aux lignes 141-142).
Le champ `detail` porte alors le texte PostgreSQL brut, du type : _new row for relation client_adresse
violates check constraint client_adresse_npa_format_chk_.

**Ce qu'il obtient.** Le nom réel des tables et des contraintes, énumérables une par une, et une
cartographie du schéma que le contrat d'API ne devait pas exposer. Ce n'est pas une donnée personnelle
(le `message` PostgreSQL ne porte pas les valeurs de ligne, contrairement à son propre champ `detail`, qui
n'est pas lu ici), mais c'est de la reconnaissance offerte gratuitement — et un `500` déclenché par un
corps JSON vide, donc un bruit d'alerte Sentry sur un cas de trafic normal.

Le même défaut de robustesse, sans la fuite, existe sur `modifierContact`
(`service-client-sous-collections.ts:214-217`) : un corps vide y produit un `500 ERREUR_INTERNE` générique.

**Correction recommandée.**

1. Retirer `{ detail: String(erreur) }` des deux emplacements : relancer l'erreur brute et laisser
   `FiltreProbleme` la journaliser côté serveur (`ServiceJournal.error`) et rendre un `ERREUR_INTERNE`
   sans détail — c'est déjà son comportement par défaut.
2. Refuser le corps vide en amont, par un `refine` sur les schémas de modification, ou par un
   court-circuit dans les services : le motif de `ServiceParametresSite.modifier:24-27` est déjà correct
   et peut servir de référence.

---

### D-01 — Aucune limitation de débit hors `/auth/connexion` : un tenant peut dégrader le service de tous les autres

- **Gravité : moyenne** (disponibilité, avec effet inter-tenant)
- **Statut : lu dans le code ; l'absence d'index est confirmée par l'auteur du module lui-même**
- **Fichiers** :
  - `apps/api/src/main.ts:56-137` — aucun `ThrottlerModule` ni middleware de débit global
  - `apps/api/src/common/limitation/service-limitation-debit.ts` — le limiteur existe et est correct, mais n'est consommé que par `apps/api/src/auth/services/authentification.service.ts:73` et `:79/119`
  - `apps/api/src/recherche/service-recherche.ts:467-497` (`chercherOrdres`) et le commentaire de tête `:45-52`
  - `apps/api/src/db/acces-base.service.ts:183-202` — pool partagé, `DATABASE_POOL_MAX` par défaut 10

**Le problème.** La limitation de débit Redis n'est appliquée qu'à la connexion. Tous les autres endpoints,
y compris ceux dont le coût SQL est le plus élevé, sont sans budget. Le module `recherche/` documente
lui-même le point faible : « `ordre_reparation.numero` n'a AUCUN index d'expression trigram. La recherche
par fragment de numéro d'OR force donc un scan complet des OR du tenant. » Les trois recherches
s'exécutent dans **une seule transaction**, donc sur **une seule connexion** du pool applicatif, partagé
par tous les tenants.

**Scénario d'exploitation.**

1. Un compte quelconque d'un tenant A — n'importe quel rôle, `recherche.executer` étant dans
   `LECTURE_ETENDUE`, accordée à tous — ou une session volée sur une tablette d'atelier.
2. Il lance en boucle, avec une vingtaine de requêtes parallèles :

   ```bash
   for i in $(seq 1 200); do
     curl -s -o /dev/null -b 'dfa_session=<cookie>' \
       'https://api.dmsforall.example/api/v1/recherche?q=a&limite=200' &
   done
   ```

   `q=a` passe le garde-fou de `service-recherche.ts:535` (il contient bien une lettre) et produit le
   motif `%a%` : correspondance quasi universelle, plus un scan séquentiel complet de `ordre_reparation`.

3. Chaque requête occupe une connexion du pool jusqu'à `DATABASE_TIMEOUT_REQUETE_MS` (10 s par défaut).
   Avec `DATABASE_POOL_MAX = 10`, dix requêtes concurrentes suffisent à saturer le pool.

**Ce qu'il obtient.** Toutes les requêtes des **autres tenants** échouent en `connectionTimeoutMillis`
(5 s), donc en `500 ERREUR_INTERNE`. Le pool d'amorçage étant séparé
(`acces-amorcage.service.ts:105-112`), les gens peuvent encore se connecter — mais plus rien ne
fonctionne ensuite. Le rayon d'action est l'instance entière, donc les dizaines de garages hébergés.

**Correction recommandée.**

1. Limitation de débit globale par principal (`sessionId`) **et** par tenant, sur le limiteur Redis déjà
   présent : la clé `limitation:` est en place, il ne manque qu'un guard global qui l'appelle. Une limite
   par tenant est ce qui borne réellement le rayon d'action ; une limite par IP seule ne le fait pas, un
   garage sortant derrière une seule adresse.
2. Créer l'index manquant, que le module `recherche/` propose déjà textuellement :
   `create index ordre_reparation_numero_recherche_idx on ordre_reparation using gin (tenant_id, public.normaliser_recherche(numero) gin_trgm_ops);`
3. Envisager un pool dédié aux lectures longues, ou un `statement_timeout` plus court sur `/recherche`.

---

### DEP-01 — `drizzle-orm@0.44.7` porte un avis « injection SQL » (GHSA-gpj5-g38j-94v9), plus 7 autres avis « high »

- **Gravité : moyenne** (dépendance de production ; **exploitabilité non démontrée sur ce code**)
- **Statut : prouvé en exécution** — `pnpm audit`
- **Fichiers** : `apps/api/package.json` (`"drizzle-orm": "^0.44.0"`), `pnpm-lock.yaml:3217` (résolu en `0.44.7`)

Commande de vérification :

```bash
pnpm audit --audit-level=high
# 16 vulnérabilités : 2 low | 6 moderate | 8 high
```

| Paquet                               | Gravité         | Avis                                                                                                       | Chemin                               | Portée                     |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------- |
| `drizzle-orm`                        | high            | GHSA-gpj5-g38j-94v9 — SQL injection via improperly escaped SQL identifiers (CWE-89), corrigé en `>=0.45.2` | `apps__api>drizzle-orm`              | **production, API**        |
| `js-yaml`                            | high            | GHSA-52cp-r559-cp3m, GHSA-pm4m-ph32-ghv5 — DoS de parsing                                                  | `apps__api>@nestjs/swagger>js-yaml`  | production (Swagger)       |
| `undici` (x5)                        | high / moderate | plusieurs                                                                                                  | `@testcontainers/postgresql>…`       | **dev et test uniquement** |
| `esbuild`, `uuid`, `brace-expansion` | moderate / high | plusieurs                                                                                                  | `drizzle-kit`, `dockerode`, `eslint` | **dev uniquement**         |
| `react-router`                       | high            | GHSA-qwww-vcr4-c8h2 — contournement CSRF en mode RSC                                                       | `apps__web>react-router`             | hors périmètre (front)     |

**Honnêteté sur l'exploitabilité.** L'avis `drizzle-orm` porte sur l'échappement des **identifiants** SQL
(noms de table et de colonne). J'ai cherché activement un chemin où un identifiant proviendrait de
l'entrée utilisateur : `grep -rn "sql\.identifier|sql\.raw" apps/api/src` ne rend **aucune occurrence**, et
les tris dynamiques passent tous par des fragments `SQL` constants sélectionnés par une clé d'énumération
validée. **Je n'ai donc pas de scénario d'exploitation à écrire pour ce dépôt aujourd'hui.** Ce finding est
rapporté parce que la version installée est vulnérable et que la surface concernée est la couche d'accès
aux données de toutes les tables : le jour où un tri ou un filtre dynamique sera écrit autrement, la faille
sera là, sans que personne ne pense à relire l'avis.

Même honnêteté pour `js-yaml` : `@nestjs/swagger` **produit** du YAML, il n'en parse pas d'origine externe.
Pas de scénario.

**Correction recommandée.** Monter `drizzle-orm` en `>=0.45.2` (montée mineure, à valider par
`pnpm typecheck && pnpm test && pnpm test:integration`), puis rejouer `pnpm audit`. Les avis `undici`,
`esbuild`, `uuid`, `brace-expansion` sont en dépendances de développement : à traiter dans le train de mise
à jour habituel, sans urgence. `react-router` est à relayer à l'agent frontend.

---

### N-01 — `compteur_document` : la mise à jour du compteur ne rescope pas explicitement sur `tenant_id`

- **Gravité : faible** (écart de doctrine ; **non exploitable en l'état**)
- **Statut : lu dans le code**
- **Fichier** : `apps/api/src/parametrage/compteurs/service-compteurs.ts:36-40`

```sql
update public.compteur_document
   set valeur = $1
 where id = $2
```

**Le problème.** C'est la seule requête d'écriture du lot 1 qui ne porte pas `tenant_id = ...` dans son
`WHERE`. La doctrine du projet est explicite : « les requêtes applicatives scopent aussi explicitement (le
RLS est le filet, pas le mécanisme) ». Ici le mécanisme _est_ le RLS.

**Pourquoi ce n'est pas exploitable aujourd'hui** — et je le dis plutôt que de gonfler le finding : le
`ligne.id` utilisé provient du `select … for update` immédiatement au-dessus (lignes 22-30), qui est, lui,
correctement scopé sur `clef.tenantId` ; et `compteur_document` porte `FORCE ROW LEVEL SECURITY` avec une
politique isolante (vérifié en exécution, §3.1). Un `id` d'un autre tenant serait invisible en lecture et
l'`UPDATE` toucherait zéro ligne. Il n'existe aucun chemin par lequel un attaquant fournirait cet `id`.

**Pourquoi le corriger quand même.** Ce compteur produit la numérotation continue des documents — la seule
donnée du lot 1 dont une collision inter-tenant serait à la fois silencieuse et non réparable a posteriori
(un numéro de facture émis ne se corrige que par avoir). C'est le dernier endroit où l'on veut dépendre
d'une seule couche.

**Correction recommandée.** Ajouter `and tenant_id = ${clef.tenantId}` au `WHERE` de l'`UPDATE`.

---

### F-02 — Swagger est monté hors du graphe de guards Nest

- **Gravité : faible** (résiduel — le défaut de configuration est déjà _fail-closed_)
- **Statut : lu dans le code, comportement déjà documenté et traité**
- **Fichiers** : `apps/api/src/main.ts:128-134`, `apps/api/src/config/charger-config.ts:70-79`

`SwaggerModule.setup('api/docs', app, document, …)` s'enregistre directement sur Express, donc en dehors
du graphe où s'appliquent `GardeSession` et `GardeDroit` (tous deux `APP_GUARD`). Si
`OPENAPI_EXPOSER_DOCS=true` en production, `GET /api/docs.json` rend **sans authentification** la
cartographie complète des endpoints, des schémas et le nom exact du cookie de session.

**Scénario.** Un opérateur active la documentation pour dépanner un connecteur et oublie de la refermer.
Un `curl https://api.dmsforall.example/api/docs.json` anonyme rend le contrat complet. Ce n'est pas une fuite de
données métier, c'est de la reconnaissance.

Le défaut de configuration est déjà `false` et la raison est écrite dans `charger-config.ts` — je le
consigne uniquement pour qu'il reste dans l'inventaire des risques résiduels, pas comme un défaut à
corriger dans le code.

**Correction recommandée (optionnelle).** Poser un middleware Express d'authentification basique devant
`/api/docs*` (mot de passe distinct), ou n'exposer la documentation que via un artefact statique publié par
la CI plutôt qu'un endpoint de l'API de production.

---

### H-01 — En-têtes de sécurité HTTP incomplets (ni HSTS, ni CSP, ni `X-Frame-Options`)

- **Gravité : faible**
- **Statut : prouvé par inventaire du code** — la recherche de `helmet`, `Strict-Transport`,
  `X-Frame-Options` et `Content-Security-Policy` dans `apps/api` ne rend **aucune occurrence**
- **Fichier** : `apps/api/src/main.ts:114-121`

Seuls `Cache-Control: no-store, private` et `X-Content-Type-Options: nosniff` sont posés. Pour une API qui
ne rend que du JSON, l'absence de CSP et de `X-Frame-Options` est sans conséquence directe.

**Le seul scénario réel** concerne `/api/docs` quand F-02 est actif : Swagger UI est une page HTML complète
servie sans CSP ni `X-Frame-Options`, donc encadrable dans une iframe tierce — clickjacking sur le bouton
« Try it out », qui envoie les cookies de session en `credentials: include`.

L'absence de `Strict-Transport-Security` est en principe compensée par le reverse proxy en production, mais
rien dans le dépôt ne le garantit, et `COOKIE_SECURE` seul n'empêche pas un premier aller en clair.

**Correction recommandée.** Ajouter `helmet()` dans `main.ts` entre les étapes 8 et 9, en désactivant
explicitement ce qui n'a pas de sens pour une API JSON, et poser `Strict-Transport-Security` en dur plutôt
que de dépendre d'une configuration de proxy non versionnée.

---

### R-01 — Les violations de clé étrangère inter-tenant ressortent en `500` au lieu d'un `400`/`404`

- **Gravité : faible** (robustesse et lisibilité ; **aucune fuite, aucune écriture croisée**)
- **Statut : lu dans le code**
- **Fichiers** :
  - `apps/api/src/vehicules/service-vehicule-detention.ts:214-222` (`relancerConflitDetention`)
  - `apps/api/src/vehicules/service-vehicule.ts:310-316` (`relancerErreurContrainte`)
  - `apps/api/src/atelier/service-or.ts:146-160` (`siteId`, `ordreReparationParentId`)

**Le problème.** Plusieurs identifiants de corps (`clientId` d'une détention, `siteId` d'un OR,
`proprietaireEconomiqueClientId` d'un véhicule) ne sont pas vérifiés en amont : c'est la clé étrangère
**composite** `(tenant_id, x)` en base qui les valide. C'est **le bon dispositif** — il rend
structurellement impossible de rattacher une ligne à l'objet d'un autre tenant, et c'est une des raisons
pour lesquelles le verdict de la §1 tient. Mais quand elle se déclenche, l'erreur PostgreSQL n'est pas
interprétée : elle est relancée telle quelle et devient un `500 ERREUR_INTERNE`.

**Scénario.** Un intégrateur, ou le front sur une donnée périmée, envoie
`POST /api/v1/vehicules/{id}/detentions` avec un `clientId` inexistant ou appartenant à un autre tenant. Il
reçoit `500 ERREUR_INTERNE` et une alerte Sentry est levée, au lieu du `404 RESSOURCE_INTROUVABLE` attendu
par le contrat. La distinction « client d'un autre tenant » / « client inexistant » n'est jamais observable
par le client : c'est correct et voulu.

**Ce que l'attaquant n'obtient pas** : rien. La ligne n'est pas écrite, le message d'erreur est masqué par
`FiltreProbleme`. C'est un défaut de qualité de service, pas une faille — je le consigne parce qu'il rend
un `500` atteignable par une entrée client, ce qui pollue le signal d'incident.

**Correction recommandée.** Étendre `interpreterContrainteVehicule` (et son équivalent atelier) au SQLSTATE
`23503` (`foreign_key_violation`) et traduire en `404 RESSOURCE_INTROUVABLE`, avec le champ concerné dans
`erreurs[]`.

---

## 3. Ce qui a été vérifié et jugé conforme

Cette section existe pour que la prochaine revue sache ce qui a déjà été passé au crible et n'ait pas à
refaire le travail.

### 3.1 Étanchéité inter-tenant — vérifications exécutées

Toutes les commandes ci-dessous ont été **réellement exécutées** contre `dfa-postgres` / `dfa_dev`.

**Inventaire de posture (38 tables, aucune anomalie) :**

```bash
docker exec dfa-postgres psql -U dfa -d dfa_dev -c "
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id'
              and a.attnum>0 and not a.attisdropped) as a_tenant,
       (select count(*) from pg_policy p where p.polrelid=c.oid) as nb_pol,
       has_table_privilege('dfa_app', c.oid,'DELETE')   as del,
       has_table_privilege('dfa_app', c.oid,'TRUNCATE') as trunc
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition
 order by 1;"
```

Résultat : 35 tables métier en `RLS + FORCE + tenant_id + 2 politiques` ; `DELETE` et `TRUNCATE` refusés
partout à `dfa_app`, sauf `DELETE` sur `session` (documenté) ; les 3 exceptions sans `FORCE`
(`utilisateur`, `session`, `journal_securite`) sont exactement celles de `0001_socle_rls.sql §4`.

**Aucune politique non isolante applicable à `dfa_app`.** La requête d'inventaire des politiques dont
`USING` ou `WITH CHECK` n'appelle pas `tenant_courant()` ne rend qu'une seule ligne :
`transition_autorisee_lecture (using true)` — référentiel partagé légitime, déclaré
`[dfa:referentiel-partage]` dans son `comment on table`, et vérifié en `SELECT` seul
(`has_table_privilege('dfa_app','public.transition_autorisee','INSERT')` vaut `false`).

**Isolation en lecture — prouvée :**

```bash
docker exec dfa-postgres env PGPASSWORD=dfa_app_dev psql -U dfa_app -d dfa_dev -c "
begin;
select 'sans_guc', count(*) from public.client;
select set_config('app.tenant_id','2ba6c419-...-9089991b17fb',true);
select 'bon_tenant', count(*) from public.client;
select set_config('app.tenant_id','00000000-0000-4000-8000-000000000000',true);
select 'autre_tenant', count(*) from public.client;
rollback;"
```

| Cas                        | `client` | `vehicule` | `ordre_reparation` |
| -------------------------- | -------- | ---------- | ------------------ |
| aucun contexte tenant posé | **0**    | —          | —                  |
| tenant réel du seed        | **3**    | —          | —                  |
| autre tenant               | **0**    | **0**      | **0**              |

Le comportement _fail-closed_ sans GUC est confirmé : une requête qui perdrait son contexte ne rend rien,
jamais tout.

**Isolation en écriture (`WITH CHECK`) — prouvée :**

```bash
docker exec dfa-postgres env PGPASSWORD=dfa_app_dev psql -U dfa_app -d dfa_dev -c \
 "begin; select set_config('app.tenant_id','00000000-0000-4000-8000-000000000000',true);
  insert into public.client (tenant_id, numero, type, nom, langue, statut)
  values ('2ba6c419-...-9089991b17fb','CL-999999','particulier','TestRLS','fr','actif'); rollback;"
```

Résultat : `ERROR: new row violates row-level security policy for table "client"`. Écrire dans le tenant
d'autrui est refusé par la base, pas seulement par le code. Test encadré par `BEGIN`/`ROLLBACK` : aucune
donnée écrite.

**Le contournement par partition est fermé — prouvé :**

```bash
docker exec dfa-postgres env PGPASSWORD=dfa_app_dev psql -U dfa_app -d dfa_dev \
  -c "select count(*) from public.audit_atelier_2026_07;"
```

Résultat : `ERROR: permission denied for table audit_atelier_2026_07`. Les 25 partitions d'`audit_atelier`
portent `RLS + FORCE + 2 politiques` **et** zéro privilège pour `dfa_app` (vérifié sur les 25). C'est le
piège documenté en `0004_transverse.sql:110-131` — une partition n'hérite ni de RLS, ni de `FORCE`, ni des
politiques de sa mère, mais hérite des privilèges. Ici les deux verrous sont posés, et le contrôle de
démarrage (`analyserPartition`, `acces-base.service.ts:555-580`) refait la vérification à chaque boot.

**Clés étrangères composites.** Les clés étrangères des migrations `0004` -> `0008` référencent toutes
`(tenant_id, id)`, jamais `id` seul (vérifié par inventaire des `foreign key` dans les cinq migrations). Un
enfant ne peut donc structurellement pas pointer vers un parent d'un autre tenant, même si le code
applicatif l'oubliait.

### 3.2 Autorisation

- `GardeSession` **et** `GardeDroit` sont tous deux enregistrés en `APP_GUARD` global
  (`apps/api/src/auth/auth.module.ts:46` et `:61`). Aucun contrôleur ne peut y échapper par omission de
  `@UseGuards`.
- `GardeDroit` est en **refus par défaut** (`common/droits/garde-droit.ts:100-106`) : une route sans
  `@Public`, `@ExigerDroit` ni `@AucunDroitRequis` renvoie `403`.
- Le test `common/droits/toutes-les-routes-decorees.spec.ts` parcourt le **graphe réel** de modules depuis
  `AppModule` et échoue si un seul handler échappe aux trois marqueurs. Il refuse aussi les combinaisons
  contradictoires `@Public` + `@ExigerDroit`, et porte un garde-fou « ce test ne doit jamais tourner à
  vide ».
- Les seules routes `@Public()` sont `POST /auth/connexion`, `POST /auth/deconnexion`, `GET /sante`,
  `GET /sante/pret`. **Aucune route publique ne touche de donnée métier.**
- La vérification `Origin` (`garde-session.ts:75-77`) s'applique à **toute** méthode différente de
  GET/HEAD, y compris aux routes publiques. Combinée à `SameSite=Lax` et `HttpOnly`
  (`auth/cookie.ts:28-40`), la protection CSRF est cohérente sans jeton dédié.
- Les confirmations en deux temps (`atelier/confirmations.ts:25-47`) vérifient bien le droit associé via
  `DROIT_PAR_CONFIRMATION` avant d'annoncer qu'une confirmation est possible : un rôle non habilité reçoit
  `DEMANDER_HABILITATION` et **ne peut pas** lever la garde en rejouant avec une liste `confirmations`.
- La fusion de véhicules resserre correctement au rôle `direction`/`admin` dans le service
  (`vehicules/service-vehicule.ts:272-274`), faute d'action dédiée dans la matrice — l'écart est signalé
  en commentaire, pas silencieux.

### 3.3 Fuite de données personnelles (nLPD)

- **Sentry.** `observabilite/nettoyer-evenement.ts` est le point de nettoyage le plus solide du dépôt :
  allow-list stricte sur `extra` (5 clés techniques) et `contexts`, suppression totale des cookies, de la
  query string et du corps des endpoints `/auth`, plus un nettoyage par motif (e-mail, VIN 17 caractères,
  plaque des 26 cantons, téléphone suisse, IBAN, AVS `756.xxxx.xxxx.xx`) appliqué en profondeur sur les
  messages, breadcrumbs, tags et attributs de span. Les trois points d'entrée du SDK (`beforeSend`,
  `beforeSendTransaction`, `beforeSendSpan`) sont branchés.
- **Le contexte Sentry ne porte que des identifiants techniques** (`filtre-probleme.ts:86-92`) :
  `requeteId`, `tenantId` (UUID), `role`, et le **patron** de route (`req.route.path`, par exemple
  `/clients/:id`) — jamais l'URL résolue, donc jamais une valeur de paramètre. Aucun VIN, aucune plaque,
  aucun e-mail, aucun nom de client ne peut atterrir dans un tag.
- **Logs.** `ServiceJournal` redacte `motDePasse`, `cookie`, `authorization`, `tokenClair` à plusieurs
  niveaux d'imbrication. Aucun appel de journalisation trouvé qui passe un nom de client, un VIN, une
  plaque ou un e-mail.
- **Corps d'erreur.** L'inventaire complet des 8 occurrences de `detail:` montre que les champs exposés ne
  portent que des identifiants techniques ou des numéros de version — **sauf** F-01, qui ne fuite pas de
  donnée personnelle non plus, mais des internes de schéma.
- **Consentements append-only** (`client_consentement` : `grant select, insert` seulement, migration
  `0006:364`) : une révocation est une nouvelle ligne, jamais une mise à jour. C'est ce qui donne sa valeur
  probante au registre nLPD, et c'est garanti par les privilèges, pas par la bonne volonté du code.

### 3.4 Injection et IDOR

- **Aucun `sql.raw`, aucun `sql.identifier`, aucune concaténation** dans une requête. Tous les fragments
  SQL bruts (`recherche/`, `clients/service-client.ts`, `vehicules/service-vehicule.ts`,
  `common/idempotence/`, `common/audit/`, `parametrage/compteurs/`) utilisent exclusivement des paramètres
  liés via les gabarits `sql` de Drizzle.
- **Tris dynamiques.** `DEFINITIONS_TRI_CLIENTS` et `construireTriEtSeuil` sélectionnent des fragments
  `SQL` **écrits en dur** via une clé validée par zod. Le commentaire de `pagination-triee.ts:13` documente
  l'invariant : « TOUJOURS une constante du code, jamais un fragment construit depuis l'entrée
  utilisateur ». Vérifié conforme.
- **IDOR.** Tous les accès par identifiant passent par un chargeur rescopé sur `tenant_id`
  (`chargerLigneVehicule`, `chargerOu404`, `chargerOrPourEcriture`, `chargerLigneOrPourEcriture`,
  `chargerDevisPourEcriture`, `ServiceSite.parId`, `ServiceParametresSite.chargerLigne`) et rendent tous
  `404 RESSOURCE_INTROUVABLE`, **jamais `403`** — un objet d'un autre tenant ne laisse même pas deviner
  qu'il existe. Les sous-collections client scopent sur le triplet `(tenant_id, client_id, id)`, ce qui
  ferme aussi l'IDOR intra-tenant, c'est-à-dire rattacher l'adresse du client X à la fiche du client Y.
- **Curseurs de pagination.** Le curseur est opaque mais non signé ; il ne porte que le tri, la valeur et
  l'id, et ne peut donc pas transporter de tenant. Le décodage refuse un curseur dont le tri diffère de
  celui demandé (`common/pagination/curseur.ts:79-81`) : pas de page silencieusement fausse. Toute anomalie
  produit `400 VALIDATION_ECHOUEE`, jamais un `500`.
- **Validation.** Aucun `.passthrough()` ni `.catchall()` dans `packages/shared/src` ni `apps/api/src` :
  les objets zod **suppriment** les clés inconnues par défaut. C'est ce qui rend sûr le `PATCH /clients/{id}`
  à corps brut (`clients/client.controller.ts:117` puis `service-client.ts:299-302`) : `statut`, `numero`
  ou un `tenantId` injectés dans le corps sont retirés par le `parse` avant tout mappage.
- **Idempotence.** La clé est scopée `(tenant_id, methode, chemin, cle)` avec contrainte d'unicité
  (`common/idempotence/service-idempotence.ts:68-74`) : un tenant ne peut pas rejouer la réponse mémorisée
  d'un autre. L'empreinte SHA-256 du corps canonicalisé distingue le rejeu légitime du conflit de clé.

### 3.5 Authentification et session

- Jeton de session : 32 octets CSPRNG, stocké en base sous **empreinte SHA-256** uniquement
  (`auth/services/session.service.ts:53-54`, `:166-168`).
- Triple expiration : absolue (`expire_le`), glissante (`SESSION_INACTIVITE_MINUTES`), plus invalidation si
  le compte ou le tenant cesse d'être actif (`session.service.ts:104-112`).
- Pas de fixation de session possible : `ouvrir()` crée toujours une nouvelle ligne avec un nouveau jeton,
  et aucun chemin n'accepte un identifiant de session fourni par le client.
- `attacherPrincipal()` lève au deuxième appel (`contexte-requete.service.ts:50-54`) : un changement de
  tenant en cours de requête est impossible par construction.
- Anti-énumération de comptes : e-mail inconnu et mot de passe faux rendent le même `401`, avec temps de
  réponse égalisé. Verrouillage progressif persisté en base **plus** budget Redis par IP et par e-mail, les
  deux découplés et leur cohérence imposée au démarrage (`charger-config.ts:154-161`).
- Le schéma `amorcage` (6 fonctions `SECURITY DEFINER`) est correctement durci : `search_path` figé sur
  chacune, colonnes explicites (jamais de `select` étoile), corps SQL statiques à paramètres liés, et
  `revoke all` depuis `public` avant les `grant` nominatifs.

### 3.6 Données financières

Pas de finding — mais la couverture est partielle, la facturation arrivant au lot 2. Ce qui est en place et
vérifié :

- Tous les montants sont en **centimes (integer)** ; aucun `float` dans les schémas ni les calculs.
- Le plafond de l'OR est vérifié **sous verrou** (`select … for update` sur l'OR) avant toute écriture de
  ligne, et **une seule fois sur la somme du lot** pour les actions groupées
  (`atelier/service-ligne-or.ts:328-343`) : pas de contournement par requêtes concurrentes.
- Les OR verrouillés (`facture`, `restitue`, `cloture`, `annule`) refusent toute modification
  (`estOrVerrouille`, appliqué dans `modifier`, `ajouterDemande` et les services de lignes).
- La concurrence optimiste par `If-Match`/ETag est comparée **dans la transaction**
  (`service-or.ts:220-229`), pas avant : deux modifications concurrentes ne peuvent pas s'écraser.
- Les montants sont retirés côté **serveur** pour les rôles de `ROLES_SANS_MONTANT`
  (`matrice-droits.ts:556`), y compris dans les `blocages[]` des erreurs : c'est une décision
  d'autorisation, pas un filtre d'affichage.
- Les prix de prestation sont **datés**, avec contrainte `EXCLUDE … gist` anti-chevauchement en base : une
  correction ouvre une période, elle n'écrase pas l'historique.

---

## 4. Points de vigilance (pas des findings — aucun scénario d'exploitation aujourd'hui)

Consignés pour que la prochaine revue les retrouve, pas pour être corrigés en urgence.

1. **`atelier.or.plafond_modifier` n'est utilisé par aucune route.** Le plafond est modifiable via
   `PATCH /ordres-reparation/{orId}` sous le seul droit `atelier.or.modifier`
   (`atelier/service-or.ts:255-256`). **Ce n'est pas exploitable aujourd'hui** : les deux actions sont
   accordées exactement au même ensemble de rôles (réceptionnaire, chef d'atelier, direction, admin —
   `matrice-droits.ts:427-453`). Le jour où l'une des deux sera resserrée, le contrôle sera silencieusement
   inopérant. C'est exactement le même schéma que É-01, qui, lui, est déjà exploitable.
2. **Actions déclarées mais jamais câblées** : `vehicule.campagne.gerer`, `vehicule.travail_reporte.gerer`,
   `atelier.ligne.*`, `atelier.devis.*`. Les services existent, les contrôleurs correspondants ne sont pas
   encore publiés — donc aucune surface exposée. À revérifier quand ils le seront.
3. **Commentaire périmé et trompeur** : `auth/matrice-droits.ts:24-28` affirme que « `GardeDroit` est
   fail-open en l'absence de `@ExigerDroit` ». C'est **faux depuis le durcissement du lot 1** : le guard
   refuse par défaut. Un commentaire de sécurité qui décrit l'inverse du comportement réel est le genre de
   chose sur laquelle une future revue construit un mauvais raisonnement.
4. **Jokers `LIKE` non échappés.** Un `%` ou `_` tapé littéralement dans `q` est interprété comme un joker
   (`recherche/utilitaires-recherche.ts:26-32`, limite déjà documentée par l'auteur). Conséquence : `q=%a`
   renvoie l'essentiel du tenant de l'appelant. **Aucun franchissement de frontière tenant** — seulement un
   contournement de la sélectivité, qui aggrave D-01.
5. **`GET /api/v1/sante` expose `VERSION_APP` sans authentification.** Empreinte de version utile à qui
   cherche une CVE ciblée. Compromis classique entre sonde de supervision et discrétion ; à trancher au
   déploiement, pas dans le code.

---

## 5. À revérifier après stabilisation

Ces points concernent du code en cours d'écriture pendant l'audit. Ils ne sont pas comptés comme findings.

1. **`apps/api/src/atelier/ordre-reparation.controller.ts` existe mais n'est pas déclaré dans
   `AtelierModule`** — `atelier/atelier.module.ts:27-35` ne porte aucun tableau `controllers`, et son
   commentaire annonce encore « AUCUN contrôleur ». Les routes `/ordres-reparation` **ne sont donc pas
   montées** au moment de cet audit. Le contrôleur lui-même est correctement décoré
   (`@UseGuards(GardeDroit)` plus un `@ExigerDroit` sur chacun de ses 7 handlers). À confirmer par
   `pnpm --filter @dfa/api exec vitest run --project unitaire src/common/droits/toutes-les-routes-decorees.spec.ts`
   une fois le module câblé.
2. Le commentaire de tête de `atelier.module.ts` référence trois contrôleurs annoncés mais absents
   (`ordre-reparation-transitions.controller.ts`, `ligne-or.controller.ts`,
   `devis-complementaire.controller.ts`). Les droits `atelier.ligne.*`, `atelier.devis.*` et
   `atelier.or.plafond_modifier` devront être vérifiés à leur arrivée — c'est là que se jouera le point de
   vigilance n°1.
3. `apps/api/src/clients/` était en modification active pendant l'audit. Les services et contrôleurs lus
   étaient cohérents et complets ; la revue des sous-collections (§3.4) et le finding F-01 restent à
   confirmer sur la version finale.

---

## 6. Récapitulatif des findings

| Réf        | Gravité    | Titre                                                                                    | Fichier principal                                                           |
| ---------- | ---------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **É-01**   | **élevée** | Correction de kilométrage à la baisse ouverte à tout rôle pouvant saisir                 | `apps/api/src/vehicules/vehicule-kilometrage.controller.ts:43`              |
| **F-01**   | moyenne    | Internes de la base exposés dans `detail`, et `500` sur un `PATCH` au corps vide         | `apps/api/src/clients/service-client-sous-collections.ts:148` et `:301`     |
| **D-01**   | moyenne    | Aucune limitation de débit hors authentification ; `/recherche` provoque un scan complet | `apps/api/src/main.ts` et `apps/api/src/recherche/service-recherche.ts:467` |
| **DEP-01** | moyenne    | `drizzle-orm@0.44.7` — GHSA-gpj5-g38j-94v9 (exploitabilité non démontrée ici)            | `apps/api/package.json`                                                     |
| **N-01**   | faible     | `compteur_document` : `UPDATE` sans rescope tenant explicite                             | `apps/api/src/parametrage/compteurs/service-compteurs.ts:36`                |
| **F-02**   | faible     | Swagger hors du graphe de guards (défaut déjà fail-closed)                               | `apps/api/src/main.ts:128`                                                  |
| **H-01**   | faible     | Ni HSTS, ni CSP, ni `X-Frame-Options`                                                    | `apps/api/src/main.ts:114`                                                  |
| **R-01**   | faible     | Violations de clé étrangère inter-tenant rendues en `500`                                | `apps/api/src/vehicules/service-vehicule-detention.ts:214`                  |

### Verdict de mise en production

L'étanchéité inter-tenant du lot 1 est **conforme et prouvée en exécution** : aucun chemin trouvé par
lequel un tenant lise ou écrive les données d'un autre. Le socle RLS est le point fort de ce dépôt — il est
vérifié à trois moments (migration, démarrage de l'API, tests d'intégration) et les deux pièges classiques
(pooling de connexions, partitions sans politique héritée) sont fermés, et vérifiés fermés.

**Un seul finding doit bloquer la mise en production : É-01.** Ce n'est pas une faille d'isolation, c'est
une élévation de privilège intra-tenant sur une donnée à valeur légale, le compteur kilométrique d'un
véhicule. La correction est locale et sans effet de bord sur le reste du module.

Les trois findings de gravité moyenne sont à traiter avant l'ouverture du premier garage, sans être
bloquants pour un déploiement de préproduction.
