# Harnais e2e DFA

Playwright, exécuté **dans l'image Docker officielle** `mcr.microsoft.com/playwright:v1.62.1-jammy`,
jamais directement sur ce poste : les bibliothèques système manquent ici pour lancer Chromium
(mesuré — `apps/web`/`e2e` ne sont pas concernés, c'est un manque au niveau du système
d'exploitation). La version de `@playwright/test` dans `package.json` racine **doit** rester
alignée sur le tag d'image (`v1.62.1-jammy` ⇔ `"@playwright/test": "1.62.1"`) — un décalage
driver/navigateur casse silencieusement des API récentes.

## Lancer la suite

```bash
pnpm e2e          # cible « build » : build le front, sert le bundle réel (voir plus bas)
pnpm e2e:dev      # cible « dev » : contre pnpm dev déjà en cours (front :5173, API :3000)
pnpm e2e:report   # ouvre le dernier rapport HTML (e2e/playwright-report/)
```

Les deux cibles délèguent tout à `e2e/scripts/executer.sh` (point d'entrée unique — build/attente
de disponibilité/vérification du bundle servi/lancement du conteneur/nettoyage). N'appelle jamais
`playwright test` directement : `e2e/playwright.config.ts` refuse de démarrer sans `BASE_URL`,
calculé par ce script.

Un fichier de test seul, un nom de test : passe des arguments à `executer.sh`, transmis tels quels
à `playwright test` :

```bash
e2e/scripts/executer.sh dev e2e/specs/navigation.spec.ts -g "Facturation"
```

`PW_WORKERS`/`PW_RETRIES` (variables d'environnement) surchargent les valeurs par défaut de
`playwright.config.ts` (2 workers, 0 retentative) si besoin ponctuel.

## Lire un échec

Trois sources, dans cet ordre :

1. **La sortie `list` du terminal** — nom du test, message d'assertion (`Expected`/`Received`),
   emplacement dans la source. Suffit dans la majorité des cas.
2. **Le rapport HTML** (`pnpm e2e:report`, ou directement `e2e/playwright-report/index.html`) —
   pour chaque échec : capture d'écran (`test-failed-1.png`), vidéo, et surtout la **trace**
   (bouton « View trace » ou `npx playwright show-trace e2e/test-results/<dossier>/trace.zip`) —
   rejoue l'exécution action par action, DOM inclus, l'outil le plus fiable pour un échec qui ne
   se voit pas sur une simple capture (état juste avant/après un clic, requêtes réseau).
3. **Les pièces jointes d'accessibilité** (`accessibilite.spec.ts`, `connexion.spec.ts`) — le JSON
   `axe-<écran>-<mode>.json` complet est toujours attaché au test, même quand il passe (onglet
   « Attachments » du rapport HTML) : détail par règle, par nœud DOM, sélecteur CSS exact.

`e2e/test-results/<nom-du-test>/error-context.md` (généré à chaque échec) contient déjà l'essentiel
en texte brut — message d'erreur, **snapshot ARIA complet de la page au moment de l'échec** (rôles,
noms accessibles, attributs `aria-*`), et la source du test — souvent suffisant sans ouvrir le
rapport HTML. C'est ce fichier qui a permis de diagnostiquer plusieurs défauts de harnais de ce
chantier (ex. `un seul lien porte aria-current` — le snapshot ARIA montrait qu'un seul lien portait
réellement l'attribut, prouvant que le SÉLECTEUR du test était en cause, pas l'application).

`e2e/test-results/` et `e2e/playwright-report/` sont ignorés par git et écrasés à chaque run — ne
rien y garder d'important au-delà de la lecture immédiate.

## Pourquoi une IP LAN, pas `localhost`/`host.docker.internal`

Docker tourne ici en **rootless**, réseau utilisateur (`pasta`/`slirp4netns`), avec
`--disable-host-loopback` : mesuré que ni `localhost`/`127.0.0.1` ni `host.docker.internal` ne
permettent à un conteneur de joindre un service écouté sur l'hôte — le loopback hôte est
explicitement bloqué. La vraie IP de l'interface LAN de l'hôte, elle, reste joignable : ce n'est
pas un chemin loopback, juste une route normale vers l'hôte, donc jamais concernée par ce blocage.

`e2e/scripts/detecter-ip-hote.sh` la découvre sans jamais coder en dur un nom d'interface :
`ip route get 1.1.1.1` demande au noyau quelle IP source il choisirait pour sortir vers
l'extérieur, sans envoyer aucun paquet. `executer.sh` construit `BASE_URL` avec cette IP
(`http://<ip-lan>:<port>`), jamais avec `localhost`.

Alternatives évaluées et écartées, par la mesure :

- `--network host` sur `docker run` : fonctionnerait mais élargirait l'exposition réseau du
  conteneur Playwright bien au-delà du strict besoin (une seule requête HTTP sortante vers l'hôte)
  — l'IP LAN atteint le même résultat sans ce compromis.
- `host.docker.internal` : résolu, mais la connexion elle-même échoue (bloqué par
  `--disable-host-loopback`, qui traite ce nom comme une variante du loopback hôte).

## Pourquoi le symlink `e2e/node_modules/vite`

Bug mesuré, pas une hypothèse : `vite preview --config e2e/support/vite.preview.config.ts` échouait
systématiquement avec `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite'` au chargement de
la config.

Cause : Vite bundle une config `.ts` externe vers un fichier temporaire `.mjs`, écrit dans le
`node_modules` le **plus proche du fichier de config** (`findNearestNodeModules`,
`vite/dist/node/chunks/config.js`) — jamais celui du `cwd` du process qui lance la commande. Comme
`e2e/` est volontairement **hors du workspace pnpm** (`e2e/package.json`, pour rester en ESM sans
changer le reste du monorepo) et n'a pas de `node_modules` propre, cette remontée continue jusqu'à
la racine du dépôt — qui n'a **aucun** paquet `vite` hissé (pnpm l'isole sous
`apps/web/node_modules/`, seul endroit où `apps/web` le déclare). Le fichier temporaire ne peut
alors jamais résoudre son propre `import 'vite'`.

`e2e/scripts/executer.sh` (cible `build`) recrée donc `e2e/node_modules/vite` à chaque run — un
symlink pointant vers la même résolution pnpm qu'`apps/web/node_modules/vite`
(`readlink -f apps/web/node_modules/vite`), pour rester aligné sur la version réellement installée
sans jamais la dupliquer. Jamais commité (`node_modules/` générique du `.gitignore` racine couvre
`e2e/node_modules/` aussi) — recréé à froid par n'importe qui relance le harnais.

## Cible « build » bloquée par CORS aujourd'hui — lire avant de perdre du temps dessus

`pnpm e2e` construit réellement le front (`vite build`), le sert avec `vite preview` (proxy `/api`
vers l'API déjà en cours, voir `e2e/support/vite.preview.config.ts`), **vérifie que le bundle
réellement servi correspond au build qui vient d'être produit** (hash du chunk `index-*.js` comparé
entre `dist/index.html` et la réponse HTTP — piège CONTRIBUTING.md « HTTP 200 ne prouve rien »), puis
lance la suite dessus. Le build et la vérification de bundle fonctionnent : mesuré, aucun problème
là-dessus.

**Ce qui casse ensuite : toute connexion échoue avec « Identifiants refusés — requête refusée pour
des raisons de sécurité ».** Ce n'est pas un mauvais mot de passe — c'est un rejet CORS.
`apps/api/src/main.ts` pose `app.enableCors({ origin: [config.WEB_URL_PUBLIQUE], credentials: true
})` : une allowlist stricte, une seule origine. Le `.env` actif du poste porte
`WEB_URL_PUBLIQUE=http://<ip-lan>:5173` (le port du serveur **dev**) ; la prévisualisation du build
sert sur le port **4173** — une origine différente, donc jamais dans l'allowlist. Le formulaire de
connexion envoie bien la requête, mais le navigateur bloque la réponse côté client (SOP), et
`EcranConnexion.tsx` l'affiche comme un refus « identifiants » générique — trompeur si on ne connaît
pas la cause réelle.

Pistes écartées, par la mesure, pas par supposition :

- **Réécrire l'en-tête `Origin` de la requête** (`page.route`/`extraHTTPHeaders`, y compris via le
  protocole CDP qui contourne d'ordinaire les restrictions JS sur les en-têtes interdits) : ne
  fonctionne PAS ici — Chromium refuse de laisser réécrire `Origin` par ce chemin. Testé en
  isolation (un spec de diagnostic jetable, supprimé après mesure), même résultat systématique.
- **Modifier `.env`** (`WEB_URL_PUBLIQUE=http://<ip-lan>:4173`) : hors périmètre de cet outillage
  ET dangereux — `.env` est celui de `pnpm dev`, actif en continu sur ce poste ; le changer casserait
  le CORS du serveur dev réel, en cours d'utilisation.
- **Réutiliser le port 5173 pour la prévisualisation** : impossible, occupé par le serveur dev
  (`ss -ltn` : `*:5173` déjà en écoute).

**Ce qu'il faudrait pour débloquer la cible build**, arbitrage produit à trancher (pas un choix
d'outillage e2e) :

1. Soit l'allowlist CORS de l'API accepte plusieurs origines (`WEB_URL_PUBLIQUE` en liste plutôt
   qu'une chaîne unique — ou une variable dédiée, ex. `WEB_URL_PUBLIQUE_E2E`), avec le port de
   prévisualisation (`4173` par défaut, voir `PORT_PREVIEW` dans `executer.sh`) explicitement admis.
2. Soit l'e2e reste sur la cible `dev` en connaissance de cause — ce que ce harnais fait déjà
   (`pnpm e2e:dev`), avec la réserve ci-dessous.

**Réserve mesurée sur la cible `dev` en session multi-développeurs** : `pnpm dev` est un serveur
**partagé** — toute sauvegarde intermédiaire d'un autre lot en train d'éditer
`apps/web/src/**` peut casser la compilation Vite le temps d'un aller-retour (overlay HMR
« Application mal configurée », capturé plusieurs fois pendant ce chantier). Le serveur se rétablit
dès que l'autre lot corrige — c'est réel mais transitoire, pas un défaut du harnais ni de
l'application. Une preuve de stabilité (3 exécutions consécutives) contre `dev` n'a de sens que
lorsqu'aucune édition concurrente de `apps/web/src` n'est en cours.

## Preuve de stabilité

La mission de ce harnais est de PROUVER une stabilité mesurée, pas de la supposer : trois
exécutions consécutives de la suite complète, aucune retentative (`retries: 0` par défaut dans
`playwright.config.ts` — `PW_RETRIES` reste un échappatoire assumé, jamais utilisé pour cette
preuve elle-même, une retentative masquerait exactement ce qu'on cherche à mesurer). Trois verdicts
identiques (même ensemble de tests verts/rouges, pas seulement le même total) valent preuve ; un
résultat qui varie d'une exécution à l'autre est un défaut à corriger ici, jamais à masquer par une
retentative.

## Captures « après refonte »

`e2e/specs/captures-apres-refonte.spec.ts` — tableau de bord et écran atelier, clair et sombre.
Écrit dans `e2e/captures-apres-refonte/` (chemin absolu, résolu depuis le fichier de spec — stable
quel que soit le `cwd` d'appel). Ce dossier est ignoré par git (`/e2e/captures-apres-refonte/` dans
le `.gitignore` racine) : les captures sont une livraison ponctuelle transmise au mainteneur, jamais un
artefact versionné qui périmerait à la prochaine refonte visuelle. Une exécution locale du harnais
les régénère à l'identique ; à partager, copie le dossier hors du dépôt (scratchpad de session ou
autre) avant de le transmettre — rien ici ne le fait automatiquement.

## Ajouter un parcours

1. Nouveau fichier dans `e2e/specs/*.spec.ts`. Un test qui a besoin d'une session (tout écran
   derrière `/login`) tourne dans le projet `chromium` par défaut — rien à faire, `testIgnore` de
   ce projet n'exclut que `connexion.spec.ts`. Un test qui doit rester anonyme (formulaire de
   connexion lui-même) doit être ajouté explicitement au `testMatch` du projet `anonyme` dans
   `playwright.config.ts`.
2. Cibler par **rôle ARIA ou texte visible**, jamais par classe CSS ni structure DOM — aucun
   `data-testid` dans l'application (cartographie CONTRIBUTING.md), et une classe Tailwind est un détail
   d'implémentation qui change sans rien casser côté utilisateur. `page.getByRole(...)` avec `name`
   reste le premier réflexe ; `locator('[aria-current="page"]')` seulement quand l'API `getByRole`
   n'a pas d'option pour le filtre voulu (vérifier dans
   `node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/types/types.d.ts` avant de
   supposer qu'une option existe — voir `navigation.spec.ts` pour un bug de harnais qui vient de là).
3. **Zéro `waitForTimeout` arbitraire.** Attendre un état observable :
   - une réponse réseau précise (`page.waitForResponse`), idéalement posée AVANT l'action qui la
     déclenche (`Promise.all([page.waitForResponse(...), page.goto(...)])`) pour ne jamais rater
     une réponse trop rapide ;
   - un rôle qui apparaît/disparaît (`role=status` pour un chargement, `role=alert` pour une
     erreur) ;
   - à défaut, une peinture réelle après une réponse réseau déjà reçue — `page.waitForResponse` ne
     prouve que la réception des octets, jamais que React a committé le rendu ; voir
     `attendreProchainePeinture` dans `statuts-or.spec.ts` (double `requestAnimationFrame`) pour le
     motif exact et pourquoi une comparaison « deux lectures identiques de suite » s'est révélée
     elle-même piégée.
4. Nouveau contrôle d'accessibilité : réutiliser `analyserAccessibilite` (`support/accessibilite.ts`)
   plutôt que d'appeler `AxeBuilder` à la main — tags `wcag2a`/`wcag2aa`/`wcag21aa` déjà réglés,
   pièce jointe JSON déjà câblée.
5. Avant de committer : `pnpm lint`/`pnpm format:check` couvrent `e2e/**` (pas de `tsconfig.json`
   dédié, donc pas de `pnpm typecheck` sur ce dossier — relire les diagnostics de l'éditeur ou lancer
   `npx tsc --noEmit` ponctuellement sur un fichier douteux).

## Structure

```
e2e/
  playwright.config.ts       # exige BASE_URL — jamais de webServer (voir scripts/executer.sh)
  package.json                # {"type":"module"} — hors du workspace pnpm, résolution ESM locale
  scripts/
    executer.sh                # point d'entrée unique (build|dev)
    detecter-ip-hote.sh        # IP LAN vue depuis le conteneur (voir plus haut)
  support/
    connexion.ts                # formulaire de connexion réel (pas d'injection de session)
    identifiants.ts             # compte de démo (direction@garage-martin.ch)
    theme.ts                    # bascule clair/sombre, anti-flash
    accessibilite.ts            # wrapper axe-core (wcag2a/wcag2aa/wcag21aa)
    vite.preview.config.ts     # config vite DÉDIÉE à la prévisualisation e2e (proxy /api)
  specs/
    authentification.setup.ts   # login une fois, réutilisé par le projet `chromium`
    connexion.spec.ts           # formulaire de connexion (projet `anonyme`, hors storageState)
    navigation.spec.ts
    theme.spec.ts
    focus-clavier.spec.ts
    etats-ecran.spec.ts
    statuts-or.spec.ts
    accessibilite.spec.ts
    captures-apres-refonte.spec.ts
```
