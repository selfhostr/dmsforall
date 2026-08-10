# Audit des commentaires de code

Date : 2026-08-09. Périmètre : `apps/api/src/`, `apps/web/src/`, `packages/shared/src/`.

Contexte de la demande (@laupernoe, mot pour mot) : « des commentaires **pour, mais pas partout,
uniquement où c'est utile** ». Ce dépôt est très commenté, et le constat général de cet audit est
que la discipline est **globalement excellente** : la grande majorité des commentaires trouvés
documentent un « pourquoi » réel (règle métier référencée RM-xx/RF-xx/MD-xx, piège de plateforme
mesuré en exécution, décision explicitement signalée plutôt qu'inventée). Le bruit et les manques
sont l'exception, pas la norme. Les commentaires périmés, en revanche, sont réels et coûtent cher
— ce sont eux qu'il faut traiter en priorité.

---

## 1. PÉRIMÉS (priorité absolue)

### 1.1 `apps/web/src/routes/routeur.tsx:110`

> « La barrière réelle reste donc côté serveur : `recupererVuePlateformeConsole`
> (`ecrans/console/console.api.ts`) appelle `GET /exploitation/v1/garages`... »

La fonction n'a jamais porté ce nom. `apps/web/src/ecrans/console/console.api.ts:22` exporte
`recupererSantePlateformeConsole` — c'est le seul export du fichier, et son seul appelant
(`apps/web/src/ecrans/console/useVuePlateformeConsole.ts`) l'utilise sous ce nom. `grep -rn
recupererVuePlateformeConsole` sur tout `apps/web/src/` et `apps/api/src/` ne remonte que cette
ligne de commentaire. Vérifié par `git blame` : les deux fichiers viennent de commits différents,
donc ce n'est pas une dérive après renommage — le commentaire était faux dès son écriture.
**Correction** : remplacer par `recupererSantePlateformeConsole`.

### 1.2 `apps/web/src/routes/routeur.tsx:409-419`

Bloc « SIGNALÉ au coordinateur » qui affirme que la vue « Clôture » de `navigation-modele.ts`
« et son JSDoc, qui suppose encore `EcranCloturePeriodePointage` en écran autonome, est désormais
périmée ». Lecture complète de `apps/web/src/composants/layout/navigation-modele.ts:158-182` :
le JSDoc de cette vue **décrit déjà correctement** la fusion Lot E — il dit explicitement que
« Clôture de période N'EST PLUS un écran autonome », que `EcranCloturePeriodePointage` a été
supprimé, et que le geste est devenu une action de la vue Équipe (`DialogueCloturePeriode`).
Le signalement de `routeur.tsx` décrit donc un défaut que `navigation-modele.ts` n'a pas.
`git blame` montre que les deux blocs viennent du **même commit** (`e673831d`) : le signalement
était déjà obsolète au moment où il a été écrit — la coordination entre agents n'a pas relu l'état
réel du fichier visé avant de le signaler comme périmé.
**Correction** : retirer ou reformuler ce bloc de signalement dans `routeur.tsx` ; il n'y a plus
rien à corriger côté `navigation-modele.ts` sur ce point précis.

### 1.3 `packages/shared/src/contrats/exploitation/index.ts:9-11`

> « ⚠ Ce barillet n'est PAS ré-exporté par `packages/shared/src/index.ts` à ce stade... »

Faux : `packages/shared/src/index.ts:15` contient bien `export * from './contrats/exploitation';`.
Le ré-export a été fait, ce commentaire d'en-tête ne l'a pas suivi.
**Correction** : supprimer ce paragraphe (lignes 9-11) de l'en-tête.

### 1.4 `apps/api/src/exploitation/contrats-console.ts:1-22`

En-tête « ⚠ MIROIR TEMPORAIRE... SUPPRESSION DE CE FICHIER, en deux gestes » : le geste 1 (ajouter
la ligne au barillet partagé) est fait — voir 1.3. Comparaison de contenu confirmée : les
enums/types de ce fichier (`NIVEAUX_SANTE_GARAGE`, `CODES_ALERTE_GARAGE`,
`DOMAINES_MODULE_CONSOLE`, `STATUTS_EXPORT_COMPTABLE_CONSOLE`, `STATUTS_TENANT_CONSOLE`,
`AlerteGarageConsole`, `GarageConsole`, `ResumePlateformeConsole`, `SeuilsSantePlateforme`,
`ReponseSantePlateforme`, etc.) sont identiques en noms et en forme à ceux de
`packages/shared/src/contrats/exploitation/enums.ts` et `sante-plateforme.ts`. Seul le geste 2
(remplacer les imports par `@dfa/shared` et supprimer ce fichier) reste à faire. Ce fichier est
donc devenu exactement le doublon obsolète que son propre en-tête annonçait vouloir éviter.
**Correction** : geste mécanique — remplacer les imports de `./contrats-console` par `@dfa/shared`
dans les fichiers qui l'utilisent, puis supprimer `apps/api/src/exploitation/contrats-console.ts`.

### 1.5 `packages/shared/src/contrats/tableau-bord/financier.ts:6`, `index.ts:5-6`, `activite.ts:6`

Les trois renvoient à `apps/api/src/tableau-bord/droits-provisoires.ts` pour le détail des rôles
et « l'action de droit encore à ajouter à la matrice » / « pas encore posée ». Ce fichier
**n'existe plus** (`find apps/api/src/tableau-bord/` ne le trouve pas). Et l'action existe déjà :
`apps/api/src/auth/matrice-droits.ts:387-388` définit `tableau_bord.activite.lire` et
`tableau_bord.financier.lire` — avec, ironie, des commentaires à cet endroit (lignes 383, 1595, 1643) qui confirment eux-mêmes que `droits-provisoires.ts` a été « retiré par ce bloc ». Les trois
commentaires des contrats partagés pointent donc vers un fichier supprimé et décrivent un état
révolu (action de droit « pas encore posée » alors qu'elle l'est).
**Correction** : remplacer la référence par `apps/api/src/auth/matrice-droits.ts` (lignes citées
ci-dessus), ou supprimer la phrase si le renvoi n'apporte plus rien une fois l'action posée.

### 1.6 `packages/shared/src/contrats/facturation/paiement.ts:124-125`

> « Signé — un remboursement se saisit comme un paiement négatif, jamais comme une correction du
> paiement initial (`MD-52`). »

Ce commentaire décrit un comportement corrigé par le commit `49a89d9` (« Un paiement negatif ne
credite plus une facture », #9, 2026-08-06) : le rapporteur du bug avait prouvé en exécution
qu'un paiement de -500 ct était accepté en 201 par `creer()`. Depuis ce correctif,
`service-paiement.ts:172` fait exactement l'inverse de ce que dit encore ce commentaire du contrat
partagé — `creer()` **rejette** tout `montantCentimes <= 0` avec un message qui renvoie
explicitement vers `POST /paiements/{id}/rembourser`. Le seul chemin légitime produisant un
montant négatif est `rembourser()` (`service-paiement.ts:436+`), qui insère directement en base
sans passer par `creer()`. Le commentaire du contrat partagé (à la frontière du schéma d'entrée
`schemaCreationPaiement`) affirme donc encore que le champ accepte un signe négatif en création,
ce qui est précisément le bug fermé par #9.
**Correction** : reformuler pour dire que `creer()` n'accepte plus qu'un montant strictement
positif, et renvoyer vers `rembourser()` / `schemaRembourserAvance` pour le cas négatif — à
l'image du commentaire déjà correct de `service-paiement.ts:160-166`.

---

## 2. BRUIT

Peu de cas trouvés — la discipline du dépôt sur ce point est réelle. Seulement deux candidats
faibles, remontés pour mémoire, pas comme urgence :

- `apps/api/src/auth/jetons.ts:13-14` — `/** Jeton de \`ServiceSession\` — voir
  \`services/session.service.ts\`. */`au-dessus de`JETON_SERVICE_SESSION`. Le nom de la
constante dit déjà tout ; contraste avec le jeton voisin (`JETON_SERVICE_MOT_DE_PASSE`, ligne
  10-11) dont le commentaire ajoute une vraie information (Argon2id). Faible priorité.
- `apps/api/src/common/limitation/redis.provider.ts:5` — commentaire sur `JETON_REDIS` proche de
  la paraphrase du nom, avec un peu de valeur ajoutée (mentionne les deux consommateurs). Faible
  priorité, à laisser si personne n'y touche.

Aucun TODO orphelin (sans date/auteur/contexte) trouvé sur l'ensemble du périmètre — grep exhaustif
sur `TODO|FIXME|XXX|HACK|@deprecated` : les rares occurrences réelles (les « XXX » restants sont
des faux positifs, formats AVS/QR-facture type `XXXX.XX`) sont toutes contextualisées avec renvoi
à un ticket ou une équipe :

- `apps/api/src/db/migrations/0014_bloc_creancier_tenant.sql:31` — TODO explicite et assumé.
- `apps/web/src/ecrans/ventes/reprises/PanneauActionsReprise.tsx:77` — `TODO(ventes)` avec
  référence croisée précise.

Pas de bloc à signaler comme « bruit vraiment inutile » ailleurs dans le périmètre couvert.

---

## 3. MANQUANTS

Constat notable : les zones à risque classique (arithmétique financière, machines à états, pièges
de plateforme documentés dans `CONTRIBUTING.md`) sont déjà commentées, et souvent à un niveau rare
(cause mesurée, reproduction, correctif) :

- `valeurCurseurTimestamptz` (`apps/api/src/common/pagination/valeur-temporelle.ts:1-52`) : en-tête
  qui explique intégralement le piège pilote `pg`/microseconde. Utilisé et commenté correctement
  dans `pointage/pagination-pointages.ts`, `pneus/pagination-triee.ts`, `pneus/mappers.ts`,
  `facturation/paiements/pagination-paiements.ts`.
- `AccesBase.enTenant` non-atomique en transaction déjà ouverte : documenté à chaque site d'appel
  à risque, pas seulement à la définition — `atelier/service-or.ts:461-469`,
  `pieces/service-reservation.ts:117-124`, `atelier/service-ligne-or.ts:864-870,912-921`,
  `pieces/service-mouvement.ts:665`, et côté facturation `documents/service-emission.ts:461-498`.
- Machine à états `ligne_or` / OR atelier : `etat-affiche.ts`, `service-transitions.ts`,
  `service-ligne-or.ts::determinerStatutInitial` commentent les transitions non triviales avec
  renvoi RM/RF.
- Cycle VN/VO ventes (`ventes/service-dossier-vente.ts:400-620`) : chaque transition
  (`engager`, `preparer`, `marquerPretALivrer`, `livrer`) porte une docstring qui explique les
  gardes, y compris l'historique du code d'erreur `VENTE_LIVRAISON_FACTURE_REQUISE`.
- Couplage atelier↔pièces (réservation à la pose / sortie à la réalisation / libération à
  l'annulation) : documenté en détail à `atelier/service-ligne-or.ts:849-871,912-927` et côté
  pièces à `pieces/service-reservation.ts:116-137`.
- Trigger SQL `imputation_paiement_verifier_invariants` (migration `0010_facturation.sql:1320`,
  comparaison en `abs()`) : le trou résiduel côté SQL (non corrigé par #9, uniquement contourné par
  une barrière applicative) est déjà expliqué côté application dans
  `facturation/paiements/imputations.ts:154-161` (« BARRIÈRE 3/3 »). Rien à ajouter — mais à
  garder en tête que le trou SQL lui-même reste réel, signalé par le commit `49a89d9`, pas par cet
  audit.

**Un seul manque net identifié** : les points de contact 1.5 et 1.6 ci-dessus (contrats partagés
tableau-bord et paiement) montrent un mode de défaillance récurrent — un commentaire correct au
moment de sa rédaction dans `packages/shared/src/contrats/` n'est pas mis à jour quand le code
qu'il décrit change ailleurs dans le dépôt (matrice de droits, service de paiement). Ce n'est pas
un commentaire _manquant_ au sens strict, mais l'absence d'un réflexe (mettre à jour le contrat
partagé au moment du correctif métier) qui a produit deux périmés dans ce même audit. À signaler
comme point de vigilance pour les futurs correctifs touchant `packages/shared/src/contrats/`.

---

## Les dix corrections les plus utiles (toutes catégories confondues)

1. **[PÉRIMÉ]** `packages/shared/src/contrats/facturation/paiement.ts:124-125` — le commentaire
   « paiement négatif = remboursement légitime en création » contredit le correctif du bug #9
   (`creer()` rejette désormais tout montant `<= 0`). C'est le plus dangereux de la liste : un
   commentaire sur un schéma de saisie financière qui décrit exactement le comportement bugué
   corrigé ailleurs.
2. **[PÉRIMÉ]** `apps/web/src/routes/routeur.tsx:110` — `recupererVuePlateformeConsole` n'a jamais
   existé sous ce nom ; la vraie fonction est `recupererSantePlateformeConsole`.
3. **[PÉRIMÉ]** `apps/api/src/exploitation/contrats-console.ts` (fichier entier) — doublon devenu
   obsolète, son propre en-tête décrit les deux gestes de suppression et seul le second reste à
   faire.
4. **[PÉRIMÉ]** `apps/web/src/routes/routeur.tsx:409-419` — signalement d'un défaut inexistant
   dans `navigation-modele.ts`, dont le JSDoc réel décrit déjà correctement la fusion Lot E.
5. **[PÉRIMÉ]** `packages/shared/src/contrats/exploitation/index.ts:9-11` — affirme que le barillet
   n'est pas ré-exporté, alors que `packages/shared/src/index.ts:15` le fait.
6. **[PÉRIMÉ]** `packages/shared/src/contrats/tableau-bord/financier.ts:6`, `index.ts:5-6`,
   `activite.ts:6` — renvoient à `apps/api/src/tableau-bord/droits-provisoires.ts`, fichier
   supprimé ; l'action de droit qu'ils disent « pas encore posée » l'est déjà
   (`auth/matrice-droits.ts:387-388`).
7. **[VIGILANCE]** Réflexe à instaurer : mettre à jour les commentaires de
   `packages/shared/src/contrats/` dans le même commit que le correctif métier qu'ils décrivent
   — origine commune des points 1 et 6.
8. **[BRUIT, mineur]** `apps/api/src/auth/jetons.ts:13-14` — commentaire qui ne fait que répéter le
   nom de la constante, à la différence de son voisin qui ajoute une vraie information.
9. **[MANQUANT, confirmé absent de manque]** Aucune zone financière/état/piège de plateforme
   n'appelle de commentaire supplémentaire dans ce périmètre — à retenir pour ne pas sur-commenter
   sur une fausse alerte lors d'un prochain audit.
10. **[PÉRIMÉ, à surveiller]** Une fois 1.4 traité (suppression de `contrats-console.ts`),
    vérifier qu'aucun autre fichier API n'importe encore ce module — sinon le geste de suppression
    casse la compilation silencieusement pour un lecteur qui n'aurait lu que l'en-tête.
