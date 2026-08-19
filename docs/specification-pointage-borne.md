Pointage — identification en borne partagée (mode PIN)
======================================================

Complète `docs/specification-pointage.md` (RM-87 → RM-123) et le contrat déjà posé
`packages/shared/src/contrats/pointage/identification.ts` (RM-113 → RM-115, `schemaIdentificationPin`,
`POST /pointages/identification`, non implémenté). Ne rouvre AUCUNE de ces décisions — le PIN reste
une identification, jamais une authentification, jamais un droit, jamais une session serveur.

Décision de @laupernoe (03.08.2026) : les deux modes coexistent, **paramétrables par SITE** :

- **session personnelle** (comportement actuel, inchangé) — chaque technicien connecté sous son
  propre compte, aucun PIN.
- **borne partagée** — un poste tactile mural, plusieurs techniciens, mains sales/gantées, sans
  clavier → identification par PIN 4 chiffres avant chaque geste.

Numérotation : reprend à **RM-124** (RM-123 est le dernier repère pris dans
`docs/specification-pointage.md`) et **CT-58** (CT-57 est le dernier cas de test posé).

---

0. Ce que ce document ajoute au modèle existant — et ce qu'il découvre

---

En creusant le point 2 (où vit le PIN), deux trous sont apparus dans ce qui existe déjà et qui
n'étaient pas visibles tant que le mode borne n'était pas spécifié :

1. **Aucune affectation utilisateur↔site n'existe aujourd'hui.** `session.sites` (consommé par
   `SelecteurSitePointage.tsx`) renvoie TOUS les sites actifs du tenant, identiques pour tout
   utilisateur (`authentification.service.ts`, requête sur `site` filtrée par `tenantId` seul,
   aucun filtre sur l'utilisateur). N'importe quel compte peut aujourd'hui choisir n'importe quel
   site du tenant pour pointer. Le mode borne a besoin d'une notion de « quels techniciens sont
   éligibles à CETTE borne » — §2 en fait la brique porteuse (l'existence d'un PIN pour un
   technicien à un site EST son affectation), pour éviter d'ouvrir un chantier plus large
   (affectation générale utilisateur↔site) qui n'est pas le sujet de cette tâche.
2. **« La session de la borne (compte de service scopé au site, rôle "poste atelier") »** décrite
   dans le contrat `identification.ts` est une PHRASE, pas un mécanisme : aucun rôle `poste_atelier`
   n'existe dans `ROLES_UTILISATEUR` (`admin, direction, vendeur, receptionnaire, chef_atelier,
technicien, magasinier, comptable`). Une tablette murale a besoin d'une identité durable,
   non personnelle, qui ne dépend pas du mot de passe d'un technicien précis et qui ne se déconnecte
   pas au milieu d'un service. §3 et §4 s'appuient sur cette identité ; **sa modélisation exacte
   (nouveau rôle ? compte technique dédié ?) est une décision à trancher avec `expert-auth`**, posée
   ici comme exigence métier, pas comme solution technique.

---

1. Paramètre de site

---

**RM-124** — Le mode d'identification du pointage est un paramètre de **site**, pas de tenant :
même rattachement que `heureOuverture`/`capaciteHeuresJourCentiemes` déjà portés par
`parametre_site` (une ligne par site, PK = `site_id`, `apps/api/src/db/schema/atelier/parametrage.ts`).
Un prestataire multi-garages a un site en borne et un autre en session personnelle — c'est
exactement le motif donné par @laupernoe et la table existante le permet sans changement de forme.

- **Nom** : `modeIdentificationPointage` (colonne `mode_identification_pointage`), **enum**, pas
  booléen. Justification : un booléen `pointage_borne_partagee` fige la question à deux valeurs
  pour toujours ; un enum coûte la même chose aujourd'hui (2 valeurs) et n'interdit pas une 3ᵉ
  identité de demain (badge RFID, QR personnel) sans migration destructive. Cohérent avec le style
  déjà en place dans ce même fichier (`politiqueControleQualiteEnum`, `politiqueLangueDocumentEnum`,
  etc. — tous des enums même à 2-4 valeurs).
- **Valeurs** : `'session_personnelle' | 'borne_partagee'`.
- **Défaut** : `'session_personnelle'`. Impératif : tous les sites existants (le jeu de démo et
  tout premier garage déjà en production, cf. Étape 2 livrée) continuent à fonctionner à l'identique
  sans y toucher — c'est le comportement actuel, verbatim.
- **Qui peut le changer** : même droit que les autres paramètres de ce même enregistrement,
  `parametrage.atelier.modifier` (déjà porté par `direction`/`admin` selon la matrice existante),
  via le même endpoint `PATCH /sites/{siteId}/parametres-atelier` déjà en place — pas un nouvel
  endpoint. C'est un choix d'ORGANISATION du site (comme ses horaires), à ce titre une décision de
  direction, pas une action quotidienne du chef d'atelier — à la différence de l'attribution des
  PIN eux-mêmes (§2, droit distinct, plus permissif).

**QUESTION POUR @laupernoe** : aucune — ce point découle directement de la consigne et du gabarit déjà en
place. Signalé uniquement pour confirmation avant implémentation.

---

2. Où vit le PIN

---

**2.1 Entité porteuse**

**RM-125** — Le PIN n'est PAS un attribut de `utilisateur` (pas de colonne `pin_hash` sur la table
de compte). Il vit sur une **nouvelle table de rattachement** `pin_pointage` :
`(tenant_id, site_id, utilisateur_id, pin_hash, actif, cree_le, modifie_le, cree_par_utilisateur_id,
modifie_par_utilisateur_id)`, une ligne par (site, technicien) — pas par technicien seul.

Deux raisons, pas une seule :

1. Le contrat `identification.ts` dit déjà littéralement « aucun technicien **actif du site** ne
   porte ce PIN » (ligne 65) — la recherche est scopée par site depuis le premier jour du contrat,
   ce document n'invente rien, il donne juste la table qui rend cette phrase vraie.
2. **Cette table comble le trou du §0.1** : l'existence d'une ligne `pin_pointage` pour
   `(site X, technicien Y)` EST la déclaration « Y peut pointer à X en mode borne » — sans construire
   une table d'affectation générale utilisateur↔site qui n'est pas demandée ici. Un technicien qui
   dépanne occasionnellement un autre garage du même prestataire (cas multi-garages de @laupernoe) reçoit
   une seconde ligne pour ce second site, avec un PIN qui peut être identique ou différent du
   premier — aucune contrainte entre les deux (voir unicité, 2.3).

**2.2 Stockage — pas en clair, mais pas Argon2id-avec-sel-aléatoire non plus**

Le PIN n'est pas un mot de passe (RM-113) mais ne doit pas dormir en clair en base pour autant —
une fuite de base ne doit pas donner en un `SELECT` la liste des codes à taper devant chaque
tablette de l'atelier.

**RM-126** — Stockage par **Argon2id, exactement le même primitif et les mêmes paramètres que
`utilisateur.motDePasseHash`** (`$argon2id$v=19$m=19456,t=2,p=1$...`), PAS un HMAC keyé par un
secret serveur séparé. Arbitrage assumé, avec son coût :

- **Pourquoi pas un HMAC/pepper** (l'alternative naturelle pour un besoin de correspondance exacte
  par valeur) : un HMAC déterministe permettrait un index unique en base et une recherche directe
  (`WHERE pin_hmac = ?`), mais introduit un NOUVEAU secret d'exploitation (pepper à générer, stocker
  hors base, faire tourner sur chaque environnement, documenter dans `expert-devops`) pour un
  bénéfice de performance qui n'existe pas ici : un site compte quelques techniciens (une poignée à
  une vingtaine), jamais des milliers.
- **Coût réel du choix Argon2id** : la recherche « quel technicien porte le PIN 4821 tapé sur la
  borne du site X » ne peut PAS être un `WHERE`, elle doit **itérer** les lignes `pin_pointage`
  actives de ce site et appeler `argon2.verify()` jusqu'à trouver une correspondance (au pire,
  `N` vérifications, `N` = nombre de techniciens actifs du site). À 20-50 ms par vérification et
  une vingtaine de techniciens au grand maximum, le pire cas reste sous la seconde — largement
  acceptable pour un geste qui se fait une poignée de fois par jour et par personne, pas un chemin
  chaud d'API publique.
- **Bénéfice retenu** : aucun nouveau secret à opérer, un seul primitif de hachage dans tout le
  produit, une seule doctrine à auditer par `reviewer-securite`.

**2.3 Unicité**

**RM-127** :

- **Même site, deux techniciens, même PIN → REFUSÉ.** Vérifié à l'écriture (attribution ou
  réinitialisation), pas par contrainte `UNIQUE` en base (impossible avec un hash Argon2id salé —
  deux hachages du même PIN ne sont jamais égaux) : le service qui attribue un PIN itère les lignes
  `pin_pointage` actives du site cible et rejette si l'une d'elles vérifie positivement le nouveau
  PIN candidat (même mécanique d'itération que l'identification elle-même, §2.2). Erreur métier
  proposée : `409 POINTAGE_PIN_DEJA_UTILISE_SUR_CE_SITE`.
- **Sites différents, même PIN → AUTORISÉ, aucun conflit.** La recherche à l'identification est
  déjà scopée par site (§2.1) : deux garages du même tenant peuvent avoir chacun un technicien qui
  tape « 1234 » sans ambiguïté, la borne du site A ne consulte jamais les PIN du site B.
- **Un même technicien, deux sites, même PIN ou PIN différent → au choix de qui attribue.** Rien
  n'impose l'un ou l'autre ; à l'écran d'attribution (§2.4), suggérer par défaut le PIN déjà connu
  de ce technicien sur son site principal (ergonomie : il n'a qu'un chiffre à retenir), sans
  l'imposer si le site B a déjà donné ce PIN à quelqu'un d'autre (RM-127 s'applique alors et bloque
  la suggestion, pas un cas d'erreur, juste un repli sur un PIN encore libre).

**2.4 Attribution et réinitialisation**

**RM-128** — Nouveau droit dédié, **`atelier.pointage.gerer_pin`**, PAS le même que
`parametrage.atelier.modifier` (§1). Deux gouvernances différentes pour deux fréquences
différentes :

- Le mode du site (§1) change rarement, c'est une décision d'organisation → `direction`/`admin`.
- Attribuer ou réinitialiser un PIN est une action QUOTIDIENNE d'atelier (nouvel embauché,
  technicien qui soupçonne un collègue de connaître son code, oubli) → doit rester disponible au
  chef d'atelier sans attendre la direction. Périmètre proposé : `chef_atelier`, `direction`, `admin`
  — exactement `ROLES_POINTAGE_ENCADREMENT` déjà défini dans
  `apps/web/src/ecrans/pointage/droits.ts` (le même trio qui corrige déjà les pointages d'autrui et
  verrouille/déverrouille les périodes) : cohérent avec l'encadrement existant, aucun rôle nouveau
  à faire accepter.
- **Le technicien ne peut JAMAIS s'auto-attribuer ni s'auto-réinitialiser un PIN** au lot 1
  (auto-service reporté, §6). Il le demande en personne à son chef d'atelier — comportement déjà
  connu des garages qui utilisent des badgeuses à code aujourd'hui, aucune rupture d'usage.
- **Où** : `EcranEquipePointage.tsx` (déjà le tableau de bord de l'encadrement sur le pointage) est
  l'écran naturel pour porter une action « Attribuer/réinitialiser un PIN » par technicien du site
  affiché — pas un nouvel écran.
- **Audit** : toute attribution/réinitialisation trace qui, quand, pour quel technicien/site
  (jamais l'ancien ni le nouveau PIN en clair dans le trail — seul l'événement « PIN modifié » a de
  la valeur pour un litige de paie, jamais sa valeur).

---

3. Verrouillage anti-balayage

---

**RM-129** — Le verrouillage est scopé sur **l'identité authentifiée de la borne elle-même**
(§0.2 — la session/compte qui porte le droit d'écrire un pointage), **jamais** sur `idAppareil`
(`schemaIdAppareil`, `primitives.ts`) : ce champ est **déclaré par le client**, donc falsifiable —
un attaquant qui verrait son compteur d'échecs approcher la limite n'aurait qu'à changer la valeur
déclarée pour repartir à zéro. Verrouiller la session authentifiée réelle empêche ça : rejouer les
10'000 combinaisons exige de rester sur la même session, et cette session ne peut pas se
« rafraîchir » sans le mot de passe du compte de la borne (que les techniciens de l'atelier ne
connaissent justement pas — c'est tout le sens du PIN).

Paramètres proposés (à confirmer avec `expert-auth`, exactement comme le texte du contrat le
signale déjà pour ce point précis) — **délibérément plus courts que le verrouillage de compte**
(`PALIERS_VERROUILLAGE_MINUTES = [1, 5, 15, 60, 240]`, seuil 5 échecs, `authentification.service.ts`) :
un verrou de plusieurs heures sur une borne partagée bloque TOUTE l'équipe de pointer, pas une seule
personne — un mauvais compromis business bien pire que le risque résiduel de devinette qu'il évite.

- Seuil avant premier verrou / 5 échecs consécutifs (identique au seuil compte, cohérence de doctrine) / 5 fautes de frappe d'affilée, mains gantées, plusieurs personnes qui se trompent à la suite, restent plausibles sans être une attaque
- Paliers d'escalade / 30 s → 2 min → 10 min → 30 min (plafond) / Assez dissuasif contre un balayage systématique (10'000 combinaisons à 30s de blocage tous les 5 essais = des heures), assez court pour qu'une équipe ne reste jamais bloquée toute une pause
- Remise à zéro / tout succès d'identification remet le compteur à 0 / même logique que le compte utilisateur
- Fenêtre glissante / échecs comptés sur une fenêtre de 15 minutes, au-delà le compteur retombe naturellement / évite qu'un échec isolé le matin s'additionne à un échec isolé le soir

**Ce que voit l'utilisateur** : le pavé PIN affiche un message pleine largeur, vocabulaire garage
(jamais « verrouillé », qui évoque un compte) — proposer _« Trop d'essais, réessayez dans
{{compteAReboursSecondes}} »_ avec compte à rebours visuel, **aucun champ de saisie actif** pendant
le blocage (pas juste désactivé visuellement — le formulaire ne doit pas pouvoir soumettre). Le
code d'erreur reste `423 POINTAGE_PIN_VERROUILLE` avec `Retry-After` (déjà posé dans le contrat).

**QUESTION POUR @laupernoe / expert-auth** : les valeurs du tableau sont une proposition métier
(cohérence terrain), pas un arbitrage sécurité définitif — à faire valider par `expert-auth` avant
implémentation, exactement comme le fichier de contrat le prévoit déjà lui-même.

---

4. Parcours écran en mode borne

---

**RM-130** — Séquence du geste, du premier au dernier tap :

1. **Écran de repli** : pavé numérique plein écran, **« Qui pointez-vous ? »** (jamais « Qui
   êtes-vous ? » — vocabulaire garage, pas vocabulaire login), 4 cases à remplir, gros caractères,
   aucun champ texte, aucun clavier. Rien d'autre à l'écran (pas de liste de noms, RM-113 : le PIN
   ne doit pas ressembler à un login).
2. Le technicien tape 4 chiffres → soumission automatique au 4ᵉ chiffre (pas de bouton
   « Valider » — un geste de moins, cohérent avec « rapide, mains sales »).
3. **Succès** : `POST /pointages/identification` répond `{ technicienId, prenom, nom }` → l'écran
   bascule directement sur l'écran de pointage technicien existant
   (`EcranPointageTechnicien.tsx`), avec un bandeau d'accueil nominatif (« Bonjour Marco ») et
   `technicienId` attaché à tous les appels suivants **tant que cet écran reste affiché** — state
   local du composant, jamais un state serveur (RM-115, déjà écrit dans le contrat).
4. Le technicien fait SON geste (démarrer/arrêter une ligne, un OR entier, une activité indirecte)
   — exactement l'écran déjà livré, sans modification de ses actions internes.
5. **Retour au pavé PIN** : deux déclencheurs, pas un seul —
   - **explicite** : un bouton toujours visible en mode borne, _« Terminé, suivant »_ — le
     technicien signale lui-même qu'il rend la main ;
   - **implicite** : délai d'inactivité, proposé à **20 secondes** sans interaction après une
     action terminée (assez court pour qu'un technicien qui s'éloigne sans taper « suivant » ne
     laisse pas la session du précédent ouverte à l'écran, assez long pour qu'il ne se fasse pas
     couper en enchaînant deux gestes, ex. démarrer une ligne puis consulter son solde du jour).
     Dans les deux cas, retour à l'étape 1 — jamais un écran intermédiaire, jamais de confirmation.
6. Entre deux techniciens, **aucune trace de qui vient de partir** ne reste affichée : le pavé
   PIN revient vierge, pas de « Bonjour Marco, à bientôt » persistant qui renseignerait le suivant
   sur l'identité précédente (hygiène d'un poste partagé, terrain garage habituel).

**RM-131 (rappel, ne réinvente rien)** — Gestes qui restent **interdits** en mode borne, repris
tels quels de RM-115 et de la liste déjà posée hors ligne
(`plan-etape-1-frontend.md:511-514`, citée par le contrat) : signature de réception/restitution,
transition d'état d'OR autre que celles déjà couvertes par le pointage lui-même (RM-117),
réponse à un devis complémentaire, toute action qui engage le client ou modifie un document
verrouillable. Le PIN ouvre uniquement l'écran de pointage — jamais un autre écran atelier. Ce
périmètre est déjà imposé côté serveur (les autres endpoints exigent la session personnelle réelle,
pas une identification PIN) : ce paragraphe est un rappel pour l'écran, pas une nouvelle règle
serveur à écrire.

---

5. Ce qui change côté écrans existants

---

**RM-132** — **Un seul écran s'adapte, les trois autres ne changent pas.**

- **`EcranPointageTechnicien.tsx`** — SEUL écran concerné. Aujourd'hui `technicienId` vient
  systématiquement de `useSession()` (« l'utilisateur SESSION courant, jamais un paramètre »,
  commentaire du fichier lui-même). En mode borne, cette source doit devenir **conditionnelle** :
  un composant de garde (`GardeIdentificationPointage` ou équivalent) lit le mode du site
  (`parametre_site.mode_identification_pointage`, déjà chargé par ailleurs pour ce site) et :
  - `session_personnelle` → rend l'écran tel quel aujourd'hui, `technicienId` = session ;
  - `borne_partagee` → affiche le pavé PIN (§4) tant qu'aucune identification n'a réussi dans le
    cycle courant, puis rend LE MÊME composant `EcranPointageTechnicien`, `technicienId` fourni par
    la réponse d'identification au lieu de la session.
- **`EcranJournalPointage.tsx`, `EcranEquipePointage.tsx`, `EcranCloturePeriodePointage.tsx`** —
  **inchangés.** Ce sont des écrans de bureau/encadrement (consultation, correction, clôture de
  période), jamais utilisés depuis la tablette murale — personne ne corrige un pointage ou ne
  clôture une période gantée devant l'atelier. Ils continuent de fonctionner sous session
  personnelle, quel que soit le mode du site consulté.

**Pourquoi un seul écran adaptatif plutôt que 4 écrans dupliqués, ou plutôt qu'un écran « borne »
entièrement séparé** : dupliquer `EcranPointageTechnicien` créerait deux implémentations du même
geste métier (démarrer/arrêter une ligne, choisir une cible) à maintenir en parallèle — le premier
bug corrigé dans l'un et oublié dans l'autre est le défaut classique de duplication d'écran. La
SEULE différence entre les deux modes est **la provenance de `technicienId`** (session vs réponse
PIN) et un écran de garde en amont — tout le reste (cibles pointables, transitions, libellés) est
un problème déjà résolu identiquement dans les deux modes.

---

6. Cas tordus — triage

---

- **Oubli de pointer la sortie** / **Déjà couvert, rien à faire.** / `DialogueCorrectionPointage.tsx` + droit `atelier.pointage.corriger_autrui` existent déjà et sont indépendants du mode d'identification — la correction se fait depuis `EcranEquipePointage` (bureau), jamais depuis la borne. À confirmer seulement que la borne n'a PAS besoin d'un accès à ce dialogue (elle n'en a pas, §5).
- **Deux techniciens sur la même ligne d'OR** / **Déjà autorisé structurellement, rien à faire.** / RM-121 (existant) : plusieurs lignes `en_cours` simultanées, plusieurs techniciens sur la même ligne — le mode borne ne fait qu'ajouter un aller-retour au pavé PIN entre les deux démarrages, la règle métier ne change pas.
- **Technicien pointe depuis la borne ET depuis son téléphone** / **Déjà gouverné, rien à faire de nouveau — mais périmètre à clarifier.** / `parametre_atelier.chevaucherPointageAutorise` (paramètre de TENANT, existant) tranche déjà si un technicien peut avoir deux pointages ouverts en même temps, quel que soit le moyen d'identification. Le mode borne (paramètre de SITE) ne bloque PAS un technicien d'utiliser en parallèle sa session personnelle sur son propre téléphone pour le même site — les deux mécanismes sont orthogonaux et c'est voulu (§0.2 : le mode borne gouverne la tablette murale, pas les comptes personnels). Si `chevauchementPointageAutorise = false` (défaut), la seconde tentative échoue avec l'erreur déjà existante, pas une nouvelle.
- **Borne éteinte / hors ligne** / **Reporté — pas spécifique au PIN.** / Aucun écran atelier n'a aujourd'hui de stratégie hors-ligne construite (la liste des gestes interdits hors ligne existe déjà comme RÉFÉRENCE, `plan-etape-1-frontend.md:511-514`, mais pas de mode dégradé implémenté). Une borne éteinte est indisponible exactement comme un poste de travail éteint aujourd'hui — ce n'est pas un problème que le mode PIN crée, et le résoudre ici reviendrait à ouvrir un chantier de résilience réseau qui dépasse cette tâche. Recommandation : ne pas traiter maintenant, à reprendre le jour où un vrai mode hors-ligne est spécifié pour l'atelier en général.
- **Auto-service (technicien change lui-même son PIN)** / **Reporté.** / Au lot 1, seule l'encadrement (RM-128) attribue/réinitialise. Un self-service ajouterait une question d'authentification (comment un technicien prouve « c'est bien moi » pour changer SON PROPRE PIN sans mot de passe ?) qui n'a pas de réponse évidente et n'est pas demandée par @laupernoe.
- **Compte de la borne lui-même (§0.2)** / **Prérequis, PAS reporté — à trancher avant tout, avec `expert-auth`.** / Sans une identité durable pour la tablette (nouveau rôle ? compte technique dédié provisionné par site ?), rien de ce document n'est implémentable : le PIN identifie un technicien PARMI ceux déjà authentifiés par la session de la borne — si cette session n'existe pas encore comme mécanisme concret, c'est le premier bloquant, avant même la table `pin_pointage`.

---

Récapitulatif RM
----------------

- RM-124 — Paramètre de site `modeIdentificationPointage`, enum, défaut `session_personnelle`, droit `parametrage.atelier.modifier`
- RM-125 — PIN rattaché à une table `pin_pointage` (tenant, site, utilisateur) — pas une colonne sur `utilisateur`
- RM-126 — Stockage Argon2id (même primitif que le mot de passe), pas de HMAC/pepper séparé — vérification par itération bornée au nombre de techniciens du site
- RM-127 — Unicité du PIN par site (vérifiée à l'écriture, pas par contrainte DB) ; libre entre sites différents
- RM-128 — Droit dédié `atelier.pointage.gerer_pin`, périmètre `chef_atelier`/`direction`/`admin`, jamais d'auto-service au lot 1
- RM-129 — Verrouillage anti-balayage scopé sur la session authentifiée de la borne (jamais `idAppareil`), paliers courts proposés
- RM-130 — Parcours pavé PIN → écran de pointage → retour automatique (bouton explicite ou 20s d'inactivité)
- RM-131 — Rappel : gestes sensibles interdits en mode borne, déjà imposés par RM-115 et côté serveur
- RM-132 — Un seul écran adaptatif (`EcranPointageTechnicien`), les 3 autres écrans inchangés

Questions ouvertes, par destinataire
------------------------------------

- **`expert-auth`** : modélisation de l'identité durable de la borne (§0.2) — nouveau rôle, compte
  technique dédié, ou autre mécanisme ; validation des paramètres de verrouillage §3 (seuils,
  paliers) proposés ici à titre métier, pas sécurité.
- **`expert-database`** : forme exacte de la migration portant `pin_pointage` et la colonne
  `mode_identification_pointage` sur `parametre_site` — hors périmètre de ce document (spécification
  métier, pas schéma).
- **@laupernoe** : aucune décision manquante identifiée qui lui revienne spécifiquement au-delà de ce
  qui a déjà été tranché le 03.08.2026 — seuls les deux points ci-dessus (auth, database) restent
  à instruire, en aval de cette spécification.
