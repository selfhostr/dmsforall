# Audit du code mort — apps/web/src

Date : 2026-08-09. Périmètre : `apps/web/src/`. Méthode : recherche exhaustive des usages
(imports, `t(...)`, gabarits dynamiques `t(\`ns:cle.${valeur}\`)`, chemins construits en dur),
lecture-seule. Chaque trouvaille ci-dessous est accompagnée de la commande lancée et de son
résultat réel. Rien n'est classé « à supprimer » sans avoir vérifié l'absence d'usage dynamique et
l'absence de commentaire de réservation explicite (le dépôt en pose plusieurs, volontairement).

Convention : trois catégories strictes — **À SUPPRIMER** (vestige sans valeur), **À CÂBLER**
(fonctionnalité réelle jamais raccordée), **INTENTIONNEL** (ancrage délibéré, raison citée).

---

## Les cinq actions les plus rentables

1. **Câbler les onglets « En retard » / « À relancer » de `EcranListeFactures.tsx`** — le contrat
   backend (`schemaFiltresDocumentsVente`) porte désormais `enRetard`/`relanceNiveau` (ajoutés par
   le commit `31b2098`, postérieur au commentaire « ÉCART SIGNALÉ » qui bloque encore l'écran) : la
   fonctionnalité est prête côté API, l'écran affiche toujours « donnée indisponible ». C'est la
   seule trouvaille de cet audit à impact direct sur le recouvrement (rappels de facture impayée).
2. **Supprimer les 34 clés orphelines de `navigation.json`** (`liens.*` × 27, `groupes.*` × 5,
   `onglets.pneusAuDepot`/`onglets.pneusARelancer`) — × 3 langues = 102 lignes mortes, vestiges de
   la barre latérale pré-refonte, aucun risque de casse (zéro usage prouvé, dynamique compris).
3. **Corriger `EcranListeFactures.tsx` pour utiliser `chemins.facturation.detail`** au lieu du
   gabarit `` `/factures/${id}` `` en dur — bug réel et mineur (perte du `?site=` au clic sur une
   ligne), corrigible en même temps que le point 1 puisque c'est le même écran.
4. **Retirer `chemins.clients.nouveau`** (`routes/chemins.ts`) — construit une URL
   (`/clients/nouveau`) pour laquelle aucune route n'existe ; la création de client se fait par
   `<Sheet>` inline. Non dangereux aujourd'hui (jamais appelé hors de son propre test), mais un
   futur appelant obtiendrait un mauvais rendu (`clients/:id` avec `id="nouveau"`), pas un 404.
5. **Décider du sort des 7 primitives Lot 1 jamais montées** (`BadgeImporte`,
   `BadgeEcheanceExpertise`, `BadgeLangueCorrespondance`, `BandeauLectureSeule`, `ChampPlaque`,
   `CarteVehicule` — plus `BandeauBrouillon`, à traiter à part, voir INTENTIONNEL) : trois d'entre
   elles ont un doublon inline prouvé dans un écran réel (véhicule importé/échéance expertise dans
   `EncartAlertesVehicule`/`BlocEcheances`, langue en texte brut dans `EcranFicheClient`, plaque
   ressaisie dans `EcranNouveauVehicule`) — soit les remplacer par le composant partagé (petit gain
   de cohérence visuelle), soit les supprimer si le rendu inline est la décision retenue.

---

## À SUPPRIMER

### 1. `navigation.json` — groupe `liens.*`, 27 clés orphelines sur 30 (× FR/DE/IT)

Fichier : `apps/web/src/i18n/locales/{fr,de,it}/navigation.json`, bloc `liens` (lignes 60-89 en FR).

Preuve — aucune des 27 clés n'a de lecteur dans le code applicatif (seuls 3 lecteurs trouvés sur
30 clés, listés en INTENTIONNEL ci-dessous) :

```
$ grep -rn "liens\." apps/web/src --include=*.ts --include=*.tsx | grep -v "/i18n/locales/"
apps/web/src/ecrans/EcranAccueil.tsx:49:   {t('navigation:liens.clients')}
apps/web/src/ecrans/EcranAccueil.tsx:57:   {t('navigation:liens.vehicules')}
apps/web/src/ecrans/pieces/EnTeteFicheArticle.tsx:53: t('navigation:liens.piecesArticles')
```

Vérification individuelle des 27 autres clés (`accueil`, `tableauBord`, `ordresReparation`,
`recherche`, `factures`, `doublonsClients`, `parametrageReferentiels`, `parametrageAtelier`,
`parametrageSites`, `parametrageFacturation`, `piecesRechercheComptoir`, `piecesReservations`,
`piecesReapprovisionnement`, `piecesCommandesFournisseur`, `piecesFournisseurs`, `piecesConsignes`,
`piecesParametrage`, `pointageSaisie`, `pointageJournal`, `pointageEquipe`, `pointageCloture`,
`ventesStock`, `ventesDossiers`, `ventesSuivi`, `pneusHangar`, `pneusARelancer`, `relances`) : `grep`
individuel par clé, 0 occurrence hors `i18n/locales/` pour chacune.

Cause : c'est le vocabulaire de l'ancienne barre latérale à plat, remplacée par le mécanisme
`cleLibelle` de `composants/layout/navigation-modele.ts` (`onglets.*`), confirmé dans
`BarreLaterale.tsx` :

```
$ grep -n "cleLibelle\|t(" apps/web/src/composants/layout/BarreLaterale.tsx
114:  {t(entree.cleLibelle)}
```

`BarreLaterale` ne lit jamais `navigation:liens.*` — le groupe entier date d'avant la refonte à six
entrées. Gain : 27 clés × 3 langues = 81 lignes mortes.

### 2. `navigation.json` — groupe `groupes.*`, 5 clés, 0 lecteur (× FR/DE/IT)

Preuve :

```
$ grep -rn "groupes\." apps/web/src --include=*.tsx --include=*.ts | grep -v "/i18n/locales/"
apps/web/src/ecrans/facturation/EcranFacturerOrdreReparation.tsx:190: groupes.filter(...)
apps/web/src/ecrans/facturation/EcranFacturerOrdreReparation.tsx:247: groupes.length === 0
apps/web/src/ecrans/facturation/EcranFacturerOrdreReparation.tsx:311: groupes.map(...)
```

Ces trois occurrences sont une variable locale `groupes` (regroupement de lignes d'OR par payeur),
sans rapport avec `navigation:groupes.*`. Aucun appelant réel du namespace i18n. Gain : 5 clés × 3
langues = 15 lignes mortes.

### 3. `navigation.json` — `onglets.pneusAuDepot` et `onglets.pneusARelancer` (× FR/DE/IT)

Confirmation des deux clés déjà signalées comme suspectes dans le mandat :

```
$ grep -rn "pneusAuDepot\|pneusARelancer" apps/web/src --include=*.ts --include=*.tsx --include=*.json
apps/web/src/i18n/locales/{de,fr,it}/navigation.json:28-29  (déclaration onglets.*)
apps/web/src/i18n/locales/{de,fr,it}/navigation.json:86     (déclaration liens.pneusARelancer, déjà
                                                              compté au point 1)
```

Aucune occurrence en dehors des fichiers de traduction eux-mêmes. Cause : la fusion de
`EcranJeuxARelancer` dans `EcranHangarPneus` (onglet interne `?onglet=a_relancer`) a rendu inutile
la vue « Au dépôt / À relancer » de `navigation-modele.ts` — le commentaire de tête d'`ONGLETS_ATELIER`
(`composants/layout/navigation-modele.ts`, lignes 227-251) documente explicitement ce retrait mais
n'a pas nettoyé les clés i18n correspondantes. Gain : 2 clés × 3 langues = 6 lignes mortes.

### 4. `pointage.json` — 5 clés orphelines sous `periode.*` (× FR/DE/IT)

Fichier : `apps/web/src/i18n/locales/{fr,de,it}/pointage.json`.

Preuve — comptage d'usage par clé (0 = orpheline) :

```
$ for k in site vide.titre vide.description verrouiller.arretEchec erreur.titre; do
    grep -rn "periode\.$k\b" apps/web/src --include=*.ts --include=*.tsx | grep -v i18n/locales | wc -l
  done
0
0
0
0
0
```

Toutes les autres clés de `periode.*` (titre, verrouiller._, deverrouiller._) sont utilisées par
`ecrans/pointage/DialogueCloturePeriode.tsx` — vérifié une à une. Cause : vestiges de l'ancien écran
autonome `EcranCloturePeriodePointage`, supprimé lors de la fusion Lot E (le geste de clôture vit
désormais dans `DialogueCloturePeriode`, monté par l'onglet Équipe) : ce dialogue n'a jamais eu
besoin d'un sélecteur de site (`periode.site`), d'un état vide (`periode.vide.*`) ni d'un titre
d'erreur générique (`periode.erreur.titre`), et `arretEchec` n'a jamais été branché sur un état
d'échec de l'arrêt des pointages en cours (`arretEnCours`/`arretReussi` couvrent les deux seuls
états rendus). Gain : 5 clés × 3 langues = 15 lignes mortes.

### 5. `routes/chemins.ts:36` — `chemins.clients.nouveau`

```ts
nouveau: (site?: string) => construireChemin('/clients/nouveau', { site }),
```

Preuve — seul lecteur trouvé : son propre test.

```
$ grep -rn "clients.nouveau\|/clients/nouveau" apps/web/src
routes/chemins.spec.ts:15:  expect(chemins.clients.nouveau('site-1')).toBe(...)
routes/chemins.ts:36:      nouveau: (site?: string) => construireChemin(...)
```

`routes/routeur.tsx` ne déclare **aucune** route `clients/nouveau` (seulement `clients` et
`clients/:id`) — contrairement à `vehicules/nouveau`, qui existe bien comme route déclarée avant
`vehicules/:vehiculeId`. `EcranListeClients.tsx` crée un client via un `<Sheet>` inline
(`setSheetOuvert(true)`, ligne ~170-260), jamais par navigation. Ce constructeur ne pointe vers
aucun écran réel : s'il était un jour appelé (lien partagé, bouton « nouveau » recopié d'un autre
écran), l'URL `/clients/nouveau` ne ferait pas 404 — elle matcherait silencieusement la route
dynamique `clients/:id` avec `id="nouveau"`, un comportement confus plutôt qu'une erreur claire.
À la différence de `chemins.clients.fusion` (même fichier, ligne 38), ce constructeur n'a **aucun**
commentaire de réservation ni référence à un futur écran : rien ne le distingue d'un reste mort.

### 6-8. Trois composants Lot 1 jamais montés, avec doublon inline prouvé

Ces trois composants (créés le même commit, `5fef59b`-lignée « Lot 1 : API complète du comptoir »)
ont zéro consommateur réel (uniquement leur propre `.spec.tsx`) **et** un équivalent visuel
réimplémenté à la main dans l'écran qui aurait dû les utiliser — c'est ce second point qui les
distingue d'un simple oubli et les classe en duplication réelle plutôt qu'en ancrage futur :

- **`composants/identite/BadgeImporte.tsx`** — badge « véhicule importé ». `EncartAlertesVehicule.tsx`
  (lignes 191-207) réimplémente la même information (icône `Globe`, texte, pays + date) directement
  en JSX plutôt que d'appeler ce composant.
- **`composants/identite/BadgeEcheanceExpertise.tsx`** — badge d'échéance MFK (forme + mot + date
  absolue, invariant n°5 du plan étape 1). `composants/vehicule/BlocEcheances.tsx` (fonction
  `LigneEcheanceExpertise`, lignes 57-89) réimplémente la même règle (source toujours visible, mot
  « échue ») en JSX local.
- **`composants/vehicule/CarteVehicule.tsx`** — carte véhicule compacte, dont le propre commentaire
  dit être faite pour « les véhicules liés à un client ». `ecrans/clients/EcranFicheClient.tsx:199`
  rend la liste des véhicules liés avec `<IdentiteVehicule>` nu, sans passer par `CarteVehicule` (qui
  compose pourtant `IdentiteVehicule` lui-même, sans rien ajouter d'incompatible).

Preuve d'absence de consommateur (identique pour les trois) :

```
$ grep -rl "\bBadgeImporte\b" apps/web/src --include=*.ts --include=*.tsx
composants/identite/BadgeImporte.spec.tsx
composants/identite/BadgeImporte.tsx
$ grep -rl "\bBadgeEcheanceExpertise\b" apps/web/src --include=*.ts --include=*.tsx
composants/identite/BadgeEcheanceExpertise.spec.tsx
composants/identite/BadgeEcheanceExpertise.tsx
$ grep -rl "\bCarteVehicule\b" apps/web/src --include=*.ts --include=*.tsx
composants/vehicule/CarteVehicule.spec.tsx
composants/vehicule/CarteVehicule.tsx
```

Recommandation : choisir un camp explicitement (soit remplacer le JSX inline par le composant
partagé pour retrouver un seul point de vérité sur le rendu « importé »/« expertise échue », soit
supprimer les trois fichiers + leurs tests) plutôt que laisser les deux formes coexister.

---

## À CÂBLER

### 1. Onglets « En retard » / « À relancer » de `EcranListeFactures.tsx` — l'API est prête, l'écran ne le sait pas encore

Fichier : `apps/web/src/ecrans/facturation/EcranListeFactures.tsx:26-51`.

Le commentaire de tête de l'écran (« ÉCART SIGNALÉ ») affirme :

> `schemaFiltresDocumentsVente` (`@dfa/shared`) n'expose toujours aucun paramètre `enRetard`/
> `relanceNiveau`, et `TRIS_DOCUMENTS_VENTE` ne porte aucun tri par retard — sans ces deux ajouts
> côté contrat, reconstruire ce filtre CÔTÉ CLIENT [...] donnerait un résultat silencieusement faux.

Preuve que ce constat n'est plus vrai — le contrat backend a été étendu depuis :

```
$ grep -n "enRetard\|relanceNiveau" packages/shared/src/contrats/facturation/document.ts
233:  readonly enRetard?: boolean;                         # (réponse, déjà exploité par l'écran)
253:  readonly relanceNiveau: number;                       # (réponse, déjà exploité par l'écran)
358:  enRetard: z.coerce.boolean().optional(),              # <-- FILTRE, nouveau
376:  relanceNiveau: z.coerce.number().int().min(0).optional(), # <-- FILTRE, nouveau
$ grep -n "TRIS_DOCUMENTS_VENTE" -A8 packages/shared/src/contrats/facturation/document.ts | head -9
321:export const TRIS_DOCUMENTS_VENTE = [
322:  'dateDocument:desc',
323:  'dateDocument:asc',
324:  'numeroSequence:desc',
325:  'numeroSequence:asc',
326:  'soldeCentimes:desc',
327:  'relanceLe:asc',                                       # <-- TRI, nouveau
328:] as const;
```

```
$ git log -1 --format="%h %ad %s" --date=short -- packages/shared/src/contrats/facturation/document.ts
$ git log --oneline apps/web/src/ecrans/facturation/EcranListeFactures.tsx | head -3
```

Le commit `31b2098` (« Facturation : filtrer les factures en retard, et ne plus compter une facture
éteinte », « Prérequis du Lot E ») a posé exactement les deux champs que l'écran attendait, ainsi
que le tri `relanceLe:asc`. Le contrat gelé (`packages/shared`) que l'écran importe directement
(`import type { FiltresDocumentsVente } from '@dfa/shared'`) porte donc déjà ces champs — la barrière
technique citée dans le commentaire n'existe plus.

Reste ouvert, documenté dans le contrat lui-même (`document.ts:367-374`, « AMBIGUÏTÉ SIGNALÉE ») :
la sémantique exacte de « À relancer » (égalité stricte sur `relanceNiveau` vs. « en retard et sous
le palier configuré par tenant ») n'est pas tranchée — mais « En retard » (`enRetard: true`) n'a,
lui, aucune ambiguïté et peut être câblé immédiatement. `useListeDocumentsVente` (le hook déjà
consommé par l'écran) transmet déjà n'importe quel `FiltresDocumentsVente` tel quel — aucun
changement de hook n'est nécessaire, seulement la construction de l'objet `filtres` dans l'écran
(actuellement, `onglet === 'enRetard' | 'aRelancer'` ne modifient jamais `filtres`, voir lignes
74-86).

Impact : les deux onglets restent en état « donnée indisponible » pour direction/comptable, qui
sont les deux seuls rôles à voir cet écran filtré par défaut sur les impayés — feature de
recouvrement documentée (design §7.1) mais jamais livrée alors que son unique blocage technique est
résolu depuis le 8 août.

### 2. `ecrans/pieces/useModifierStockSite.ts` — mutation posée, aucun écran ne l'appelle (auto-signalé)

Fichier : `apps/web/src/hooks/pieces/useModifierStockSite.ts:14-25`. Le fichier documente
lui-même :

> PAS ENCORE CONSOMMÉ PAR UN ÉCRAN (à ce lot) : `ReponseArticle.stocksResume` (fiche article)
> n'expose pas l'emplacement/les seuils actuels d'un site — [...] La couche transport/mutation est
> posée et testée-typée pour qu'un écran dédié [...] puisse la consommer directement.

Preuve d'absence de consommateur :

```
$ grep -rn "import.*useModifierStockSite" apps/web/src --include=*.ts --include=*.tsx
(aucun résultat)
```

Classé À CÂBLER (pas À SUPPRIMER) parce que l'auteur documente précisément pourquoi ce n'est pas
encore possible (donnée serveur manquante côté lecture) — retirer la mutation ferait perdre le
travail de typage/transport quand la lecture manquante sera ajoutée.

### 3. `hooks/pieces/useTransitionsArticle.ts:54` — `useAjouterReferenceArticle`, mutation posée, aucun écran ne l'appelle (auto-signalé)

Même style d'auto-signalement explicite :

> `POST /articles/{id}/references` — upsert (RP-02/RP-03). PAS ENCORE CONSOMMÉ PAR UN ÉCRAN (à ce
> lot) : la fiche article n'affiche les références qu'en LECTURE [...]. Couche prête pour le
> dialogue d'ajout d'un futur lot.

Preuve : `grep -rn "import.*useAjouterReferenceArticle" apps/web/src` → aucun résultat.

### 4. `hooks/facturation/useLignesDocumentVente.ts` — `useAjouterLigneDocument`/`useSupprimerLigneDocument`, spécifiés en design mais jamais montés

Ces deux hooks (`POST`/`DELETE .../documents-vente/{id}/lignes`) n'ont, eux, **aucun** commentaire
d'auto-signalement les décrivant comme volontairement en attente — contrairement aux deux
précédents. Ils correspondent pourtant à une fonctionnalité précisément spécifiée et non triviale
(RF-81 côté financier) :

```
$ grep -n "4.3 Card" -A15 docs/design-etape-2-facturation.md
287:### 4.3 Card « Lignes » — brouillon
295:- Seules deux actions sont possibles sur cette table en brouillon : **ajouter** la ligne de démontage
296:  proposée si elle ne l'a pas été à l'écran 1 [...], et
297:  **retirer** une ligne ajoutée par erreur à l'écran 1 [...]
299:- Aucune modale pour ces deux actions [...] : la case à cocher agit en direct.
```

`EcranFicheFacture.tsx` (« Écran 2 — Facture », qui documente lui-même ses propres écarts connus en
tête de fichier, lignes 65-90) rend la table des lignes strictement en lecture :

```
$ grep -n "ligne\|Ligne" apps/web/src/ecrans/facturation/EcranFicheFacture.tsx | sed -n '1,15p'
397:  {document_.lignes.map((ligne) => {
399:    <TableRow key={ligne.id} className={cnLigne(ligne.ligneOrId !== null)}>
401:      {ligne.designation}
(aucune case à cocher, aucun bouton ajouter/retirer)
```

Le bloc « ÉCARTS SIGNALÉS » de cet écran (lignes 65-90) couvre le destinataire non éditable, le
libellé de remise, le menu ⋯ réduit et l'éligibilité PDF — mais **ne mentionne pas** l'absence du
geste « ajouter/retirer une ligne » du §4.3. C'est donc un vrai point mort, non déjà pris en compte
par l'auteur de l'écran : la couche transport (`documents-vente.api.ts`) et les deux hooks existent,
testés, mais rien dans l'UI ne les appelle. Un réceptionniste/comptable qui a laissé passer une
ligne en trop sur une facture brouillon n'a aujourd'hui aucun moyen de la retirer avant émission —
seul le recours après coup (avoir) reste disponible, plus lourd que le geste prévu par le design.

Preuve d'absence de consommateur :

```
$ grep -rn "import.*useAjouterLigneDocument\|import.*useSupprimerLigneDocument" apps/web/src
(aucun résultat)
```

### 5. `EcranListeFactures.tsx:259` — navigation en dur, `chemins.facturation.detail` disponible et ignoré

```
$ grep -n "navigate(\|/factures/\${" apps/web/src/ecrans/facturation/EcranListeFactures.tsx
259: onOuvrirLigne={(document_) => navigate(`/factures/${document_.id}`)}
```

`chemins.facturation.detail(id, site)` (`routes/chemins.ts:91`) existe, est testé
(`routes/chemins.spec.ts:74`), et conserve `?site=` — exactement le problème que le commentaire de
`chemins.ts:81-88` dit avoir corrigé pour le lien d'entrée du menu (« cliquer _Facturation_
abandonnait le site courant [...] l'en-tête retombait sur _Tous les sites_ »). Le clic sur une ligne
de la liste reproduit ce même défaut : `EcranListeFactures.tsx` ne connaît même pas la notion de
site (aucune occurrence de `site` en dehors d'un commentaire, aucun import de `chemins`). À corriger
en même temps que le point 1 ci-dessus, sur le même fichier.

---

## INTENTIONNEL

### `composants/motifs/BandeauBrouillon.tsx` + namespace i18n `reception` quasi entier — écran spécifié, jamais construit

Fichier i18n : `apps/web/src/i18n/locales/{fr,de,it}/reception.json` (mandat de réparation, tour du
véhicule, véhicule de remplacement, signature — 9 sections, ~50 clés). Composant :
`composants/motifs/BandeauBrouillon.tsx`.

Preuve qu'il n'existe aucun écran `Réception` dans le dépôt (ni aujourd'hui, ni par le passé) :

```
$ find apps/web/src/ecrans -iname "*reception*"
(aucun résultat)
$ git log --oneline --all --diff-filter=D -- '*EcranReception*'
(aucun résultat — jamais créé, donc jamais supprimé)
```

Preuve que le namespace `reception` n'a qu'un seul lecteur dans tout le code applicatif :

```
$ grep -rln "'reception:\|useTranslation('reception')" apps/web/src --include=*.ts --include=*.tsx | grep -v i18n/locales
composants/motifs/BandeauBrouillon.tsx
```

Raison de ne PAS supprimer : ce n'est pas un vestige, c'est une fonctionnalité documentée et non
encore livrée. Le plan frontend de l'étape 1 la décrit en détail (accueil du matin, tour du
véhicule, mandat, plafond, boîte à clés, véhicule de remplacement, signatures) et liste
explicitement `reception` dans son tableau des namespaces i18n prévus :

```
$ grep -n "réception du matin, tour du véhicule" docs/plan-etape-1-frontend.md
760:| `reception` | réception du matin, tour du véhicule, mandat, plafond, boîte à clés, véhicule de
     remplacement, signatures |
```

`EcranNouvelOrdreReparation` (l'écran de création d'OR réellement livré) est une version bien plus
simple que ce que `reception.json` décrit — le écran « Réception » riche (mandat signé, tour du
véhicule avec schéma carrosserie, véhicule de remplacement) a été scopé hors de l'étape 1 livrée,
sans que le travail de préparation i18n soit retiré. `BandeauBrouillon` est le seul artefact de code
(hors i18n) qui s'y rattache déjà — construit pour un cas d'usage précis (reprise de saisie après
panne réseau/tablette fermée) qui n'a de sens que dans cet écran.

Différence avec les cas « À SUPPRIMER » : contrairement à `navigation:liens.*`/`groupes.*` (qui
décrivent un mécanisme _remplacé_), `reception.json` décrit un écran _jamais construit_ — le
supprimer ferait perdre la seule trace écrite (et déjà traduite en trois langues) d'une
fonctionnalité spécifiée. Recommandation : ne pas toucher, mais signaler à qui reprendra ce chantier
que `navigation-modele.ts` (`EMPLACEMENTS_RESERVES`) ne réserve aujourd'hui **aucune** place pour
« Réception » — contrairement à Export fiduciaire/Encaissements/Relances/Planning — ce qui serait à
faire le jour où ce chantier redémarre.

### `ecrans/console/BandeauContexteConsole.tsx` — auto-documenté « préparé mais non monté »

```
$ grep -rln "\bBandeauContexteConsole\b" apps/web/src --include=*.ts --include=*.tsx
ecrans/console/BandeauContexteConsole.tsx
```

Le composant explique lui-même sa situation (lignes 21-35) : « PRÉPARÉ MAIS NON MONTÉ dans ce lot :
le palier 1 ne fait jamais entrer dans un garage, donc rien n'appelle ce composant pour l'instant » —
construit par anticipation du palier 2 (accès effectif à un garage) parce qu'il est intégralement
autoporté et que sa forme visuelle (couleur ambre, contenu, sticky) est déjà figée par la conception.
Créé le 09.08.2026 (commit `7dc65ab`, « Console d'exploitation : socle de la porte 1 »), dans le lot
en cours — cas d'école du signalement correct plutôt que du vestige.

### `chemins.clients.fusion` (`routes/chemins.ts:38`) — réservé pour un endpoint non exposé côté serveur

```
$ grep -n "chemins.clients.fusion\|clients:fusion" apps/web/src/ecrans/clients/EcranDoublonsClients.tsx
65: * `chemins.clients.fusion` et les clés `clients:fusion.*` existent déjà dans le contrat gelé pour
66: * quand cette route le sera — pas de lien construit vers un écran qui n'existe pas encore.
```

Explicitement documenté : `POST /clients/{id}/fusionner` n'est pas exposé côté serveur
(`client.controller.ts`, « hors du périmètre demandé pour ce lot »). À la différence de
`chemins.clients.nouveau` (classé À SUPPRIMER ci-dessus), ce constructeur a une raison écrite et une
route serveur documentée comme seulement différée, pas absente par oubli.

### `navigation-modele.ts` — `EMPLACEMENTS_RESERVES` (4 clés i18n non rendues : `facturationExportFiduciaire`, `facturationEncaissements`, `reglagesRelances`, `atelierPlanning`)

Ces 4 clés de `onglets.*` (dans `navigation.json`) ne sont volontairement jamais passées à `t()` —
le fichier source (`composants/layout/navigation-modele.ts:556-612`) l'explique explicitement :
« Elles ne sont PAS rendues [...] ce que réserver veut dire ici, c'est que le RANGEMENT est décidé
et écrit [...] de sorte que livrer l'écran se réduise à déplacer une ligne d'ici vers le tableau ». À
ne pas confondre avec les clés réellement mortes du même fichier (point 1 et 3 de la section
À SUPPRIMER) : celles-ci ont un objet exact (`EMPLACEMENTS_RESERVES`) qui les référence, les autres
n'ont plus aucun référent nulle part.

### `composants/identite/BadgeLangueCorrespondance.tsx` — doublon probable, non classé À SUPPRIMER par prudence

`EcranFicheClient.tsx:140` affiche la langue de correspondance en texte brut
(`<dd>{t(\`commun:langues.${client.langueCorrespondance}\`)}</dd>`) plutôt que via ce badge (drapeau

- mot), qui documente pourtant explicitement le même besoin (RM-02 : « le drapeau seul ne suffit
  jamais »). C'est la même famille de duplication que les 3 composants classés À SUPPRIMER plus haut,
  mais je ne l'y range pas : à la différence de `BadgeImporte`/`BadgeEcheanceExpertise`/`CarteVehicule`,
  je n'ai pas trouvé de second site où le composant serait redondant en plus du premier, et rien
  n'indique que le rendu texte brut de la fiche client soit un choix délibéré ou un oubli. À trancher
  par l'agent propriétaire de `ecrans/clients/` plutôt que par cet audit.

---

## Points vérifiés et écartés (pas de trouvaille)

- **`apps/web/src/api/types.gen.ts` vs endpoints `exploitation/*` (console)** : absence confirmée,
  mais **volontaire** — `apps/api/src/openapi/construire-document.ts:47-74` retire explicitement
  tout chemin `exploitation/*` du document OpenAPI métier (« Retire du document MÉTIER tout chemin
  porté par le plan CONSOLE ») ; un second document, disjoint, existe pour la console. Ce n'est donc
  pas une staleness de génération.
- **Routes de `routeur.tsx` vs `chemins.ts`** : tous les chemins déclarés dans `chemins.ts`
  correspondent à une route réellement montée dans `routeur.tsx`, à la seule exception de
  `chemins.clients.nouveau` (ci-dessus) et `chemins.clients.fusion` (réservé, ci-dessus).
- **Clés i18n construites dynamiquement** (`t(\`ns:cle.${valeur}\`)`) : vérifiées avant toute
déclaration d'orphelinat pour chaque namespace touché par cet audit (`expertise.sources._`,
`pointage:statuts._`, `commun:langues.*`, etc.) — aucune clé dynamique n'a été signalée à tort
  comme morte dans ce rapport.
