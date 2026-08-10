# Audit simplicité et performance — `apps/web/src`

Date : 09.08.2026. Périmètre : `apps/web/src/` (lecture seule). Méthode : lecture directe des
hooks TanStack Query, des écrans les plus volumineux, et recherche systématique (grep/script) des
patrons ciblés par la consigne — `enabled` manquant, composants dupliqués, props booléennes,
composants définis en ligne, `?? valeur` sur des champs financiers/temporels.

Verdict global : le dépôt est **discipliné**. La doctrine « une absence n'est pas une valeur » est
appliquée avec un soin inhabituel (voir `IndicateurRetard`, `CelluleGarantieSuivi`,
`CelluleFinancementSuivi`, `BadgeEcheanceSuivi` — tous distinguent explicitement `undefined`
« masqué par rôle », `null` « non renseigné » et une vraie valeur). Aucun composant défini en
ligne dans un autre, aucune prop booléenne qui prolifère, pas de dépendance lourde importée pour un
usage trivial. Les trouvailles ci-dessous sont réelles mais ponctuelles, pas un problème
systémique.

---

## 1. Requêtes réseau inutiles

### 1.1 `useJeuxARelancer` part au montage même onglet inactif — confirmé, et un second cas au même endroit

**Fichier** : `apps/web/src/ecrans/pneus/EcranHangarPneus.tsx:170-176`, hook
`apps/web/src/hooks/pneus/useJeuxARelancer.ts:19-32`.

`EcranHangarPneus` a deux onglets (« Actifs », « À relancer »). Les deux hooks —
`useHangarPneus(site, …)` et `useJeuxARelancer({ siteId: site, … })` — sont appelés
inconditionnellement en haut du composant, donc les **deux** requêtes partent au montage de
l'écran quel que soit l'onglet affiché. `useJeuxARelancer` (`hooks/pneus/useJeuxARelancer.ts`) ne
porte aucune option `enabled` — impossible de la gater depuis l'écran même si on le voulait.

Ce défaut est déjà signalé dans un commentaire du fichier lui-même (lignes 125-130 de
`EcranHangarPneus.tsx`) comme « hors périmètre » d'un agent précédent — confirmé toujours présent.

**Pourquoi c'est un problème** : un aller-retour réseau systématique et non nécessaire à chaque
ouverture du hangar (le cas courant : rester sur l'onglet « Actifs »). Pas un N+1, pas une boucle —
un coût fixe, mais évitable et déjà résolu ailleurs dans ce même dépôt (voir précédent ci-dessous).

**Précédent existant dans le code** — la solution est déjà pratiquée trois fois dans ce dépôt :
`useListeClients` (`hooks/clients/useListeClients.ts:56-79`) et `useHangarPneus` lui-même
(`hooks/pneus/useHangarPneus.ts:21-32`, `enabled: siteId !== undefined`) acceptent une option
`enabled`, tout comme `useListePointages` (`hooks/pointage/useListePointages.ts:24-41`). Il suffit
d'ajouter `options?: { readonly enabled?: boolean }` à `useJeuxARelancer` (même signature que
`useListePointages`) puis, dans `EcranHangarPneus.tsx`, passer `enabled: onglet === 'a_relancer'`
côté `useJeuxARelancer` et `enabled: Boolean(site) && onglet === 'actifs'` côté `useHangarPneus`.

**Gain attendu** : une requête réseau de moins à chaque ouverture de l'écran (cas majoritaire :
l'utilisateur reste sur « Actifs »). Effort : faible — deux fichiers, un patron déjà utilisé trois
fois ailleurs dans le dépôt.

### 1.2 `useListeDossiersVente` appelé sans `enabled` alors que le fichier applique déjà la garde partout ailleurs

**Fichier** : `apps/web/src/ecrans/vehicules/EcranFicheVehicule.tsx:113-118`, hook
`apps/web/src/hooks/ventes/dossiers/useListeDossiersVente.ts` (n'accepte aucune option `enabled`).

Dans ce même fichier, `requeteOr` (ligne 65-80) et `requeteFactures` (ligne 86-93) sont
délibérément construites en `useQuery` local plutôt que via leurs hooks paginés respectifs, avec
un commentaire explicite : « `useQuery` local plutôt que le hook … (pagination infinie, sans
option `enabled`) ». La même règle n'est **pas** appliquée à `requeteDossiersVente`, qui appelle
directement `useListeDossiersVente({ vehiculeId, tri: … })` — hook qui n'a pas d'option `enabled`
et ne peut donc pas être gaté sur `vehiculeId !== undefined`.

**Pourquoi c'est un problème** : `vehiculeId` vient de `useParams<{ vehiculeId: string }>()`, donc
`string | undefined` au niveau des types. Si jamais ce composant rend avec `vehiculeId` non défini
(navigation transitoire, route mal formée), `filtres.vehiculeId` vaut `undefined` et
`GET /dossiers-vente` part **sans filtre** — la liste complète des dossiers de vente du tenant, pas
uniquement ceux du véhicule. C'est le même défaut que 1.1, mais avec un risque de sur-portée (toute
la liste au lieu d'aucune requête) plutôt qu'un simple double aller-retour. Le fait que ce même
fichier applique déjà la garde correcte deux lignes plus haut, avec la justification écrite pour
le faire, rend l'omission repérable.

**Gain attendu** : évite une requête non filtrée (potentiellement grande) dans un cas limite ;
cohérence interne du fichier. Effort : faible à moyen — ajouter `enabled` à
`useListeDossiersVente` (même changement que 1.1) puis gater l'appel avec
`enabled: vehiculeId !== undefined`.

---

## 2. Duplication réelle

### 2.1 `BadgeStatutFinancement` et `BadgeStatutReprise` existent chacun en DEUX exemplaires, avec des rendus visuellement différents

**Fichiers** :

- `apps/web/src/ecrans/ventes/dossiers/BadgeStatutFinancement.tsx` (utilisé par
  `ecrans/ventes/suivi/CelluleFinancementSuivi.tsx:7`)
- `apps/web/src/ecrans/ventes/financements/BadgeStatutFinancement.tsx` (utilisé par
  `ecrans/ventes/financements/CarteFinancement.tsx:11`)
- `apps/web/src/ecrans/ventes/dossiers/BadgeStatutReprise.tsx` (**mort — voir 2.2**)
- `apps/web/src/ecrans/ventes/reprises/BadgeStatutReprise.tsx` (utilisé par
  `ecrans/ventes/reprises/CarteReprise.tsx:18`)

Les deux implémentations de `BadgeStatutFinancement` prennent exactement les mêmes props
(`{ statut: StatutConfirmationFinancement; className? }`) et couvrent le même enum à trois valeurs,
mais rendent différemment : la version `dossiers/` utilise un style « contour » uniforme
(`border-statut-X bg-background text-statut-X`) pour les trois statuts, alors que la version
`financements/` distingue « plein » (fond coloré, texte blanc) pour `en_attente`/`confirme` et
« contour » pour `refuse` — et utilise le token `danger` (rouge) pour `refuse` là où l'autre utilise
`attention` (orange). **Un même dossier de vente peut afficher son statut de financement dans une
couleur sur l'écran de suivi (`/ventes/suivi`) et dans une autre couleur sur la fiche financement
elle-même** — deux composants séparés qui divergent silencieusement au lieu d'un seul qui
garantirait la cohérence.

**Pourquoi c'est un problème** : ce n'est pas une préférence de style — le token de couleur porte
un sens (`attention` vs `danger`), documenté par les commentaires des deux fichiers eux-mêmes comme
une décision produit délibérée (« refus = fait courant du parcours, pas une anomalie »). Deux
fichiers avec la même décision documentée deux fois, dont une l'applique et l'autre la contredit
(danger au lieu d'attention), est exactement le risque que factoriser élimine : une correction
future d'un des deux fichiers oubliera l'autre.

**Gain attendu** : cohérence visuelle garantie entre l'écran de suivi et la fiche financement/
reprise ; suppression d'environ 100 lignes dupliquées (deux fichiers × ~55 lignes, à trancher lequel
des deux styles est le bon — décision produit, pas technique). Effort : moyen (nécessite un
arbitrage sur lequel des deux rendus garder, puis une passe de migration des deux points d'appel).

### 2.2 `ecrans/ventes/dossiers/BadgeStatutReprise.tsx` est du code mort

**Fichier** : `apps/web/src/ecrans/ventes/dossiers/BadgeStatutReprise.tsx` (55 lignes).

Aucun fichier du dépôt n'importe ce composant (`grep -rn "dossiers/BadgeStatutReprise"` : zéro
résultat en dehors de sa propre définition). `CarteReprise.tsx` (le seul consommateur d'un badge de
statut de reprise) importe `./BadgeStatutReprise` depuis `ecrans/ventes/reprises/`, pas depuis
`dossiers/`. Le fichier n'a pas de test dédié et n'a pas bougé depuis le commit initial du module
Ventes (`fb8f9c7`).

**Pourquoi c'est un problème** : défaut de correction mineur (rien n'affiche faux), mais pur
entretien inutile — un futur agent qui cherche « le » badge de statut de reprise tombera sur deux
fichiers plausibles, dont un mort, et perdra du temps à déterminer lequel modifier.

**Gain attendu** : suppression immédiate, zéro risque (aucun import à mettre à jour). Effort :
trivial.

### 2.3 Le patron `useInfiniteQuery` + aplatissement de pages est copié-collé dans 16 hooks

**Fichiers** : `hooks/pieces/useListeArticles.ts`, `useListeFournisseurs.ts`,
`useListeCommandesFournisseur.ts`, `useReapprovisionnement.ts`, `useMouvementsArticle.ts`,
`useConsignes.ts`, `useReservations.ts`, `hooks/pneus/useHangarPneus.ts`,
`useJeuxARelancer.ts`, `hooks/atelier/useListeOrdresReparation.ts`,
`hooks/vehicules/useListeVehicules.ts`, `hooks/pointage/useListePointages.ts`,
`hooks/facturation/useListeDocumentsVente.ts`, `hooks/ventes/dossiers/useListeDossiersVente.ts`,
`hooks/ventes/stock/useListeVehiculesStock.ts`, `hooks/ventes/suivi/useListeSuiviVente.ts`.

Chacun de ces 16 fichiers répète la même structure à l'identique (constante `LIMITE_PAGE = 50`,
`useInfiniteQuery` avec `initialPageParam: undefined as string | undefined`,
`getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined`, puis
`{ ...resultat, xxx: resultat.data?.pages.flatMap((page) => page.donnees) ?? [] }`). Seuls
changent : la clé de query, la fonction de fetch, et le nom de la propriété aplatie.

**Pourquoi c'est un problème** : ~15-20 lignes quasi identiques × 16 fichiers ≈ 250-300 lignes qui
ne portent aucune logique propre au domaine. C'est de la duplication réelle (même comportement,
même risque d'erreur — ex. l'incohérence `enabled` de la section 1 vient précisément du fait que
chaque hook réimplémente sa propre liste de paramètres au lieu de partager un seul point où
`enabled` serait toujours disponible). Une fonction générique
`useListePaginee(queryKey, queryFn, { enabled }) ` porterait la logique une seule fois, et
corrigerait mécaniquement les deux trous de la section 1 en même temps (`enabled` disponible
partout par construction, plus besoin de l'ajouter au cas par cas).

**Gain attendu** : ~250 lignes en moins, un seul endroit où corriger un bug de pagination pour
l'ensemble des 16 listes, `enabled` disponible uniformément (résout 1.1 et 1.2 comme effet de
bord). Effort : moyen — écrire la factory générique et migrer 16 fichiers d'un seul type de
signature, aucun changement de comportement observable si fait correctement (bon candidat pour
`expert-react` avec `pnpm typecheck`/`pnpm test` comme filet).

---

## 3. Re-rendus évitables

Rien trouvé qui mérite d'être signalé. Recherche ciblée (script) de composants définis à l'intérieur
d'un autre composant : zéro occurrence. Recherche de props booléennes qui s'accumulent (3+ dans une
même interface `Props`) : une seule occurrence
(`composants/motifs/AvertissementConfirmable.tsx` : `ouvert`/`destructif`/`enCours`), et ce sont
trois axes orthogonaux légitimes pour une boîte de dialogue de confirmation (état d'ouverture,
variante visuelle, état de chargement), pas le patron `isX`/`hasY`/`showZ` que la composition
remplacerait avantageusement. `TableComptoir` (`composants/comptoir/TableComptoir.tsx`) pagine par
pages de 50 lignes (`BoutonChargerPlus`) plutôt que de charger une liste illimitée — la
virtualisation n'apporterait rien à cette échelle.

## 4. Complexité inutile

Les écrans les plus longs (`EcranParametrageAtelier.tsx` 645 lignes, `EcranBornePointage.tsx` 634,
`EcranFicheFacture.tsx` 597, `PanneauActionsOr.tsx` 557) restent lisibles à l'échantillonnage :
chaque section correspond à un état métier réel (statuts multiples, rôles multiples), pas à un
mélange chargement/transformation/affichage non séparé. Pas de trouvaille qui vaille une
réécriture ici — la longueur reflète la richesse du domaine (garage suisse, machine à états
métier), pas un manque de découpage.

## 5. États chargement / vide / erreur

Conformes partout où l'échantillonnage a porté (`EcranHangarPneus`, `EcranFicheOrdreReparation`,
`EcranFicheVehicule`, écrans de suivi ventes). Rien à signaler.

## 6. « Une absence n'est pas une valeur »

C'est la catégorie la mieux tenue du dépôt : `IndicateurRetard.tsx`, `CelluleGarantieSuivi.tsx`,
`CelluleFinancementSuivi.tsx` et `BadgeEcheanceSuivi.tsx` distinguent tous explicitement
`undefined` (masqué par rôle), `null` (non renseigné) et une vraie valeur, avec des commentaires qui
citent la doctrine et expliquent pourquoi. Une seule anomalie mineure repérée :

**Fichier** : `apps/web/src/ecrans/facturation/IndicateurRetard.tsx:66`.

```
{t('facturation:retard.enRetard', { jours: joursRetard ?? 0 })}
```

Ce repli `?? 0` n'est atteint que dans la branche `enRetard === true`. Or le contrat partagé
(`packages/shared/src/contrats/facturation/document.ts:230`) garantit explicitement :
« `joursRetard` est un entier strictement positif quand `enRetard`, sinon toujours `null` (jamais
`0`) ». Le repli est donc mort en usage normal — mais **s'il était jamais atteint** (contrat violé
côté serveur, régression), il afficherait « en retard de 0 jours », un message contradictoire
(« en retard » + « 0 jour ») qui masquerait l'anomalie au lieu de la révéler. C'est un défaut de
correction en germe, pas un défaut actif : la classe de bug que la doctrine du dépôt cible
explicitement, mais protégée aujourd'hui par le contrat serveur.

**Gain attendu** : marginal (ne change rien tant que le contrat serveur tient), mais cohérent avec
la doctrine du dépôt — remplacer par un état visuellement distinct (ou une valeur explicitement
« inattendue ») si `joursRetard` est `null` alors que `enRetard` est `true`, plutôt qu'un repli
numérique silencieux. Effort : trivial, priorité basse.

Les usages de `?? 0` trouvés ailleurs (`SheetEncaissement.tsx`, `EcranFacturerOrdreReparation.tsx`,
`EcranAvoir.tsx`, `VueEquipePointage.tsx`, `EcranFicheCommandeFournisseur.tsx`) sont tous dans des
`reduce()` d'agrégation (somme d'une liste) — une valeur absente contribuant zéro à une somme est
correct par construction, pas un cas d'« absence affichée comme valeur ». Non retenus.

## 7. Taille du bundle

Dépendances de `apps/web/package.json` : minimales et bien choisies — pas de `lodash`/`moment`,
`lucide-react` importé en named imports (tree-shakeable), `@dfa/shared` résolu en sources par Vite
(pas de double bundle). Rien à signaler.

---

## Cinq actions au meilleur rapport gain/effort

1. **Ajouter `enabled` à `useJeuxARelancer` et gater les deux requêtes de `EcranHangarPneus` sur
   l'onglet actif** (§1.1) — patron déjà utilisé trois fois ailleurs dans le dépôt, deux fichiers à
   toucher, gain immédiat et mesurable.
2. **Supprimer `apps/web/src/ecrans/ventes/dossiers/BadgeStatutReprise.tsx`** (§2.2) — code mort
   confirmé, zéro risque, trivial.
3. **Gater `useListeDossiersVente` avec `enabled` et corriger `EcranFicheVehicule.tsx`** (§1.2) —
   même geste que #1, corrige une incohérence interne déjà à moitié traitée dans ce fichier.
4. **Trancher et fusionner les deux `BadgeStatutFinancement`** (§2.1) — nécessite un arbitrage
   produit (quelle couleur pour `refuse` : attention ou danger ?) avant la fusion technique ; à
   faire suivre de la même vérification pour `BadgeStatutReprise` une fois la version `dossiers/`
   supprimée (déjà fait au point 2).
5. **Factoriser le patron `useInfiniteQuery` en une fonction générique `useListePaginee`** (§2.3) —
   le chantier le plus gros des cinq, mais celui qui rapporte le plus : ~250 lignes en moins et
   résout structurellement la classe de bug des points 1.1/1.2 pour les 16 hooks concernés, pas
   seulement les deux repérés ici.

Rien de grave n'a été trouvé côté re-rendus, bundle, ou complexité de composants — ces trois
catégories ressortent propres de cet audit.
