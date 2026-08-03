# Design — Écrans du module Ventes (VN/VO)

Conception d'écran pour l'étape 4 (véhicule en stock, dossier de vente, reprise, financement,
livraison). Source normative des données : `packages/shared/src/contrats/ventes/` (`vehicule-stock.ts`,
`dossier-vente.ts`, `reprise.ts`, `financement.ts`, `enums.ts`) — **gelés**, lus en entier avant
d'écrire ce document. Toute référence à un champ ci-dessous est un champ réel de ces fichiers, jamais
une supposition.

Patrons repris tels quels de l'existant (lus avant conception) :
- `apps/web/src/ecrans/vehicules/EcranFicheVehicule.tsx`, `EnTeteFicheVehicule.tsx`, `EcranListeVehicules.tsx`
- `apps/web/src/ecrans/atelier/EcranFicheOrdreReparation.tsx`, `EnTeteOrdreReparation.tsx`, `PanneauActionsOr.tsx`
- `apps/web/src/ecrans/parametrage/EcranReferentiels.tsx` (onglets)
- `apps/web/src/composants/motifs/RefusBloquant.tsx`, `AvertissementConfirmable.tsx`
- `apps/web/src/composants/comptoir/TableComptoir.tsx`, `BarreFiltres.tsx`, `SelecteurTri.tsx`, `BoutonChargerPlus.tsx`
- `apps/web/src/composants/identite/IdentiteVehicule.tsx`, `IdentiteClient.tsx`, `BadgeStatutOr.tsx`
- `apps/web/src/composants/vehicule/EncartAlertesVehicule.tsx`, `BlocEcheances.tsx`
- `apps/web/src/lib/formats.ts` (`formaterMontant`, `formaterDate`, `formaterKilometrage`)

Aucun composant shadcn nouveau n'est requis en dehors de ceux déjà en usage (`Card`, `Dialog`, `Tabs`,
`Select`, `Textarea`, `Checkbox`, `Badge`, `Button`). Les seuls éléments nouveaux sont des **compositions**
de ces primitives, au même niveau que `BadgeStatutOr` ou `EncartAlertesVehicule` — voir §3.

---

## 0. Cadrage

Trois affirmations du brief que ce document traite comme des contraintes dures, pas des suggestions :

1. **Un véhicule en stock n'est pas un second objet.** `ReponseVehiculeStock.id` EST `vehicule.id`
   (`vehicule-stock.ts`, littéral). Aucune route, aucun composant de ce document ne doit introduire un
   identifiant ou une fiche distincte pour « le véhicule en tant qu'objet de vente ». Détail en §1.
2. **La reprise gonflée est une pratique commerciale normale**, pas une anomalie à cacher ni à
   colorer en rouge. Les deux valeurs (estimée/négociée) sont toujours visibles ensemble, jamais
   fusionnées. Traitement complet en §11.
3. **Un dossier peut être bloqué par autre chose que lui-même.** Chaque écran qui approche une
   transition impossible doit dire *quoi* et *à qui* — pas seulement refuser au clic. Traitement
   transverse en §4 et §7.4.

---

## 1. Un véhicule, une fiche — l'architecture de navigation qui en découle

Décision structurante : **`EcranFicheVehicule.tsx` (existant) reste l'écran unique de tout véhicule**,
qu'il ait ou non une extension stock. Ce document ne crée **aucune** route `/vehicules-stock/{id}`
séparée. Conséquences concrètes :

- La liste « Parc en stock » (§5) navigue vers `/vehicules/{id}` au clic sur une ligne — exactement
  la même route que la liste véhicules existante (`chemins.vehicules.detail`).
- `EcranFicheVehicule` gagne une nouvelle section — `BlocVente` (§1.1) — qui ne s'affiche QUE si le
  véhicule a une extension stock. Le reste de la fiche (alertes atelier, échéances, kilométrage,
  détentions, travaux reportés) est **inchangé** : un VO vendu puis entretenu garde son historique
  atelier intact au même endroit.
- La reprise pointe le même mécanisme : `ReponseReprise.vehiculeRepris` est un `VehiculeResume`
  ordinaire. Cliquer dessus dans la carte Reprise (§8) ouvre `/vehicules/{id}` — la fiche du véhicule
  *avant* qu'il ne devienne, à la livraison, un véhicule en stock à part entière (effet de bord de
  `livrer`, `RV-24`). Après livraison, cette même fiche affiche en plus `BlocVente`. Aucun nouvel
  écran n'est créé à cet instant — c'est la preuve à l'écran du principe n°1.

### 1.1 `BlocVente` — nouvelle section de `EcranFicheVehicule`

Positionnée **juste après `EncartAlertesVehicule`**, avant la grille `BlocEcheances`/`BlocDonneesAtelier` :
au même niveau de priorité que les alertes atelier, parce qu'un véhicule en stock qui dort est une
alerte au même titre qu'une expertise échue.

Contenu (`Card`, doctrine `BlocEcheances`) :
- `BadgeStatutVehiculeStock` (§3.1) + provenance traduite (`PROVENANCES_VEHICULE_STOCK`)
- `IndicateurJoursStock` (§3.4) — bien en évidence, pas en petit caractère
- Prix d'achat, frais de remise en état cumulés, prix de vente affiché — trois montants alignés en
  `dl`, doctrine `EnTeteOrdreReparation` (grille `dt`/`dd`). Voir §13 (question 8) sur le rôle qui doit
  voir ces montants.
- Bouton « Voir le dossier de vente » — **uniquement** si `statutCommercial` ∈ {`reserve`, `vendu`,
  `livre`} (un véhicule `disponible` n'a par définition pas de dossier actif). Comportement : la
  ressource `ReponseVehiculeStock` ne porte **aucun** lien direct vers un dossier de vente en cours
  (seulement `origineRepriseDossierVenteId`, qui documente une provenance passée, pas une vente
  active — voir §13 question 6). Le bouton résout donc le dossier via
  `GET /dossiers-vente?vehiculeId={id}&tri=prospectionLe:desc&limite=1` et navigue vers le premier
  résultat.
- Si `statutCommercial = 'disponible'` (ou `en_commande`) : bouton primaire **« Vendre »** — ouvre la
  création de dossier de vente (§6.1) avec `vehiculeId` pré-rempli, l'étape suivante étant le choix du
  client.

**Pré-requis signalé, pas un acquis** : `ReponseVehicule` ne porte aujourd'hui aucun champ indiquant
qu'une extension stock existe (`enStock`/`stockId`) — le contrat lui-même le signale
(`vehicule-stock.ts`, commentaire d'en-tête). Sans lui, `EcranFicheVehicule` doit sonder
`GET /vehicules/{id}/stock` à vide pour la quasi-totalité des véhicules-clients ordinaires, uniquement
pour savoir si `BlocVente` doit se monter. Je reformule cette demande en §14 — ce n'est pas neutre pour
la performance perçue d'un écran qui est aujourd'hui rapide.

---

## 2. Vocabulaire et pièges de traduction FR/DE/IT

Vocabulaire imposé par le brief, rappelé pour mémoire : VN = *Neuwagen*, VO = *Occasion* (DE
*Gebrauchtwagen*), expertise = **MFK**, jamais de jargon informatique.

Pièges identifiés en concevant ces écrans — à vérifier par `expert-i18n`, pas tranchés ici :

- **« Reprise »** désigne dans ce module le véhicule repris au client, et ailleurs dans ce dépôt la
  reprise de données d'un ancien DMS (`docs/specification-reprise-donnees.md`). En DE/IT les deux sens
  divergent naturellement (*Eintausch*/*Inzahlungnahme* vs *Datenübernahme* ; *permuta* vs *migrazione
  dati*) — pas de collision de traduction. Le risque est uniquement côté clé i18n FR : namespacer
  strictement (`ventes.reprise.*` vs `migration.reprise.*`) pour qu'aucun traducteur ne mélange les
  deux fichiers sources.
- **IT — « ripresa »** est un faux ami dangereux pour « reprise véhicule » : en italien courant,
  *ripresa* signifie surtout *reprise/rétablissement* (économique, d'une activité), pas *véhicule repris
  en échange*. Le terme correct côté concessionnaires CH-IT est **permuta**. Ne pas laisser un
  traducteur généraliste choisir *ripresa* par réflexe cognat.
- **IT — « perizia »** (traduction littérale d'« expertise ») entrerait en collision avec MFK dans ce
  module précis, où l'écran de reprise parle aussi d'« évaluation technique » du véhicule repris. Le
  brief impose MFK invariable pour l'expertise réglementaire — s'assurer qu'aucune clé IT de ce module
  n'utilise *perizia* pour MFK, et que l'évaluation de la reprise porte un terme distinct (ex.
  *valutazione*) pour ne jamais laisser croire qu'il s'agit d'un contrôle MFK.
- **« Engager »** (statut `engage`, action `engager` du dossier) est un faux ami en DE — traduit
  littéralement (*engagieren*) le mot ne porte pas le sens d'engagement contractuel attendu ici
  (signature du bon de commande). Le terme naturel côté concession DE-CH est plutôt *verbindlich
  bestellt* / *Bestellung bestätigt*. À faire trancher par `expert-i18n`, pas par calque.
- **« Livrer » / « livraison »** — en DE, *Lieferung* évoque une expédition/livraison de colis, alors
  que l'événement métier ici est la **remise des clés au comptoir**. Le terme concession usuel est
  *Fahrzeugübergabe* (remise du véhicule), pas *Lieferung*. Même risque, moindre, en IT
  (*consegna* convient mieux que *spedizione* mais reste à vérifier dans l'usage concession CH-IT réel).
- **VN/VO en badge court** — l'abréviation à deux lettres n'existe idiomatiquement qu'en usage
  FR/DE-CH oral. Il n'y a pas d'équivalent court établi en italien. Recommandation : garder le badge
  FR/DE court (VN/VO, N/GW) mais utiliser un mot complet abrégé en IT (*Nuovo*/*Usato*) plutôt que de
  forcer une abréviation qui n'existe pas dans la langue.
- **« Gonflée » (reprise gonflée)** est un terme interne, jamais affiché à l'écran (voir §11) — sa
  traduction ne concerne que les commentaires de code et ce document, pas une clé i18n.

---

## 3. Composants transverses à créer

Cinq compositions nouvelles, aucune ne réinvente une primitive shadcn. Toutes suivent la doctrine
`BadgeStatutOr` : **couleur + forme + icône + mot**, jamais la couleur seule (accessibilité daltonisme,
docs/design-comptoir.md §5.5).

### 3.1 `BadgeStatutVehiculeStock`

Mapping exhaustif des 5 valeurs de `STATUTS_COMMERCIAUX_VEHICULE`, sur le modèle exact de
`CONFIG_STATUT_OR` (`Record` complet, `tsc` casse si une valeur est ajoutée sans mapping) :

| statut | token | forme | icône proposée |
|---|---|---|---|
| `en_commande` | neutre | contour | `Clock` |
| `disponible` | succes | plein | `CircleCheck` |
| `reserve` | attention | plein | `Bookmark` |
| `vendu` | info | plein | `Handshake` |
| `livre` | terminal | contour | `KeyRound` |

### 3.2 `BadgeStatutDossierVente`

8 valeurs de `STATUTS_DOSSIER_VENTE`. `annule`/`abandonne` en token `danger`/contour (jamais
d'icône « poubelle », doctrine déjà posée pour l'OR : le mot « supprimer » n'existe pas dans ce
produit). Ce badge sert uniquement dans les **listes** (§6) — sur la fiche dossier elle-même (§7), la
`FriseStatutDossierVente` (§3.3) porte l'information de façon plus riche ; le badge y reste néanmoins
affiché en en-tête pour la cohérence visuelle avec le reste du produit (même doctrine que l'OR, qui
porte à la fois `BadgeStatutOr` et un bandeau détaillé).

### 3.3 `FriseStatutDossierVente`

Nouveau, sans précédent direct dans l'existant — justifié parce que la machine à états du dossier est
**linéaire** (contrairement à celle de l'OR, qui a des branches d'attente non ordonnées justifiant un
badge seul). Un stepper horizontal à 6 positions (`prospection → engage → en_preparation →
pret_a_livrer → livre → clos`), chaque étape franchie affichant sa date (`prospectionLe`, `engageLe`,
…, `closLe`) sous le libellé, l'étape courante mise en évidence (token `info`), les étapes futures en
`muted`.

État `annule`/`abandonne` : **remplace** la ligne du stepper (ne s'ajoute pas en 7e position — les
deux embranchements ne se produisent qu'*à la place* d'une suite normale). Rendu : la frise s'arrête
à l'étape où la rupture a eu lieu, suivie d'un badge terminal rouge portant `motifCloture` en toujours
visible (jamais au clic — même doctrine que `BlocEcheances` pour la source d'échéance : l'information
qui explique un état anormal ne se cache pas derrière une interaction).

### 3.4 `IndicateurJoursStock`

Pas un badge de statut (`joursStock` est une métrique calculée, pas un état de la machine) — rendu en
texte proéminent (`texte-donnee-proeminente`, classe déjà en usage) avec une icône `Clock`/`AlertTriangle`
et une emphase à seuils, sur le modèle de `EncartAlertesVehicule` pour l'urgence des travaux reportés
(`urgent`/`a_faire`/`normal` → `danger`/`attention`/`neutre`) :

- `< 45 jours` : neutre, poids normal.
- `45–90 jours` : token `attention`.
- `> 90 jours` : token `danger`, poids `font-semibold`.

Seuils **provisoires** — voir §13 question 2 : aucun paramétrage tenant (`PV-01`) n'existe encore pour
ce seuil, contrairement au reste du produit où ce genre de valeur est toujours configurable.

### 3.5 `BadgeStatutReprise` / `BadgeStatutFinancement`

Même doctrine, 4 et 3 valeurs respectivement (`STATUTS_REPRISE`, `STATUTS_CONFIRMATION_FINANCEMENT`).
`refusee`/`refuse` en token `danger`/contour — mais voir §8 : un badge rouge sur une reprise refusée
ne doit **pas** lire comme une erreur du produit, juste comme un fait (le mot porté par le badge
(« Refusée ») suffit à le désambiguïser, la couleur seule ne porte jamais le sens).

---

## 4. Où va le message d'erreur (règle valable sur tout ce document)

Défaut trouvé sur ce dépôt (rappelé dans le brief) : une confirmation modale masque le reste de
l'écran, donc un refus serveur qui ne s'affiche pas *dans* la modale est invisible. Règle **non
négociable, appliquée à chacune des transitions listées ci-dessous** — aucune exception :

> Toute mutation déclenchée depuis un `Dialog` de confirmation reste **dans ce même dialog** en cas
> d'échec. L'erreur s'affiche **à l'intérieur du `DialogContent` encore ouvert**, jamais en toast
> seul, jamais après fermeture. Deux rendus possibles, strictement ceux déjà en usage sur
> `PanneauActionsOr.tsx` :
> - **Refus bloquant** (409/422 sans confirmation possible) → `RefusBloquant` inline, dans le dialog,
>   avec le code d'erreur, les `blocages` cliquables et les `actionsProposees`.
> - **`CONFIRMATION_REQUISE`** (l'action reste possible après accord explicite) → bandeau ambre inline
>   + bouton « Continuer quand même », qui ouvre `AvertissementConfirmable` en second temps.

Chaque section ci-dessous précise seulement les champs et le contenu propre à sa transition — le
mécanisme d'erreur ne se redécrit pas à chaque fois, il est celui-ci, partout :

- Dossier de vente : `engager`, `preparer`, `marquer_pret_a_livrer`, `livrer`, `cloturer`, `annuler`,
  `abandonner`, `PATCH` (modifier).
- Véhicule en stock : mise en stock, modification, `receptionner`, `remettre-disponible`.
- Reprise : création, modification, `negocier`, `confirmer`, `refuser`.
- Financement : création, `confirmer`, `refuser`.
- Documents requis : `marquer` (coche/décoche) — voir note en §7.6 sur son cas particulier (pas de
  dialog, donc pas de masquage possible, mais l'erreur doit quand même s'afficher *localement à la
  ligne cochée*, pas seulement en toast global, pour la même raison qu'une modale : l'utilisateur a
  déjà quitté visuellement la zone si le retour n'est pas local).

---

## 5. Écran — Le parc en stock

Route proposée : `chemins.ventes.stock(site?)` → `/ventes/stock`. Reprend au trait près
`EcranListeVehicules.tsx` : `BarreFiltres` + `SelecteurTri` + `TableComptoir` + `BoutonChargerPlus`,
triade chargement/erreur/vide obligatoire, site en paramètre de requête jamais en état global.

### 5.1 Filtre par défaut — le parti pris de cet écran

La collection complète (`GET /vehicules-stock`) inclut les véhicules `vendu`/`livre` — un historique
utile, mais **ce n'est pas la tâche de cet écran**. Le parc en stock répond à une seule question :
« qu'est-ce qu'il reste à vendre, et depuis quand ». Par défaut, la vue masque `vendu`/`livre` (filtre
client `statutCommercial` restreint à `en_commande`/`disponible`/`reserve`), avec une bascule visible
« Afficher aussi les véhicules vendus/livrés » — même registre que la case `importe` sur
`EcranListeVehicules`. Contrairement à `EcranListeVehicules`, le tri par défaut affiché n'est **pas**
le défaut technique du contrat (`dateEntreeStock:desc`) mais **`joursStock:desc`** — un choix
délibéré : l'écran existe pour rendre visible ce qui dort, le véhicule qui dort depuis le plus
longtemps doit être la première ligne vue, pas la dernière arrivée.

### 5.2 Filtres (`BarreFiltres`)

- `q` (texte libre, plaque/VIN/désignation — même champ que `EcranListeVehicules`).
- Statut commercial — `Select` simple (une valeur, comme le filtre `statut` existant), le filtre
  serveur acceptant un tableau reste ouvert à une évolution multi-select ultérieure sans rupture.
- Type véhicule — bascule à 3 positions Tous/VN/VO (`ToggleGroup` ou 3 `Button` en groupe).
- Provenance — `Select` optionnel, options tirées de `PROVENANCES_VEHICULE_STOCK` traduites ; pas de
  référentiel serveur pour cette liste à ce jour (voir note de périmètre `contrats/ventes/index.ts`) —
  si un tenant personnalise sa liste de provenances plus tard, ce `Select` devra migrer vers un appel
  au paramétrage, pas maintenant.
- Site — paramètre d'URL `?site=`, identique au reste du produit.

### 5.3 Colonnes (`TableComptoir`, densité `dense`)

Exactement les trois informations que le brief demande « en un coup d'œil », rien de plus — la
densité maîtrisée veut que le reste (VIN, provenance détaillée, dates exactes) attende le clic sur la
fiche véhicule :

1. **Véhicule** — `IdentiteVehicule` taille `sm`.
2. **Type** — badge sobre VN/VO (`Badge variant="secondary"`, pas un token statut : ce n'est pas un
   état, c'est une classification).
3. **Statut** — `BadgeStatutVehiculeStock`.
4. **Jours en stock** — `IndicateurJoursStock`, colonne triable (`onTrier`, alignement droite).
5. **Coût remise en état** — `formaterMontant(fraisRemiseEtatCumulesCentimes)`, alignement droite,
   atténué (`text-muted-foreground`) si `0`.
6. **Prix de vente** — `formaterMontant(prixVenteAfficheCentimes)` ou `—` accompagné du libellé
   « à fixer » si `null` (un VN pas encore chiffré, `RV-05`) ; alignement droite, `texte-donnee-proeminente`
   — c'est la colonne que l'œil doit trouver en premier après le nom du véhicule.

Ligne cliquable → `/vehicules/{id}` (§1). Pas de colonne d'actions dans la table elle-même : l'action
« Vendre » vit sur la fiche véhicule (`BlocVente`, §1.1), pas ici — cohérent avec la doctrine « une
ligne dense ne porte que ce qui aide à décider si on l'ouvre ».

### 5.4 Actions de page

Bouton primaire unique en tête d'écran : **« Nouveau dossier de vente »** — ouvre la création (§6.1)
sans véhicule pré-rempli (le vendeur part du client). C'est le **deuxième** point d'entrée vers la
création, l'autre étant le bouton « Vendre » par véhicule (§1.1, part du véhicule). Les deux
aboutissent au même formulaire, seul le champ pré-rempli diffère — pas deux parcours à maintenir.

### 5.5 Ce que je n'ai pas ajouté

Pas de bandeau d'agrégats (nombre total en stock, jours moyen, valeur immobilisée) en tête de liste :
calculer une moyenne sur la seule page chargée (pagination par curseur) donnerait un chiffre trompeur
qui varie selon combien de pages l'utilisateur a cliqué « Charger plus ». Un vrai indicateur de
pilotage a besoin d'un agrégat calculé côté serveur sur la collection entière — demande formulée en
§14, pas construite en façade ici.

---

## 6. Écran — Liste des dossiers de vente (accès)

Route : `chemins.ventes.dossiers(site?)` → `/ventes/dossiers`. Prérequis de navigation vers la fiche
dossier (§7), même patron que `EcranListeOrdresReparation` : `q` (nom client / plaque véhicule),
filtre statut (`STATUTS_DOSSIER_VENTE`), tri (`prospectionLe`/`dateLivraisonEstimee`, contrat).
Colonnes : client (`IdentiteClient`), véhicule (`IdentiteVehicule` ou « — non assigné » en italique
atténué), `BadgeStatutDossierVente`, date de livraison estimée. Filtre par défaut : masquer
`clos`/`annule`/`abandonne` — même logique qu'en §5.1, un dossier terminé n'est plus une tâche
active.

### 6.1 Création d'un dossier de vente

Dialog (pas un écran séparé — la création ne porte que 5 champs) :
- Client acheteur (recherche/autocomplete client existant, composant déjà utilisé côté atelier pour
  la sélection client — pas reconstruit ici).
- Véhicule (optionnel dès la création, `RV-30`) — recherche parmi les véhicules en stock
  `disponible`/`en_commande` (même endpoint que §5, filtré). Pré-rempli si on vient du bouton
  « Vendre » de `BlocVente`.
- Client facturé (optionnel, défaut = acheteur, `RV-40`).
- Conducteur (optionnel, défaut = acheteur).
- Date de livraison estimée (optionnelle).

Idempotence : `Idempotency-Key` généré côté client à l'ouverture du dialog (même doctrine que la
création d'OR) — un double-clic ne doit jamais ouvrir deux dossiers pour la même intention.

---

## 7. Écran — Le dossier de vente (fiche)

Route : `chemins.ventes.dossierDetail(id, site?)`. `GET /dossiers-vente/{id}` renvoie le document
complet (reprise, financement courant + historique, documents, documents requis) — une seule requête
bloque l'écran entier, doctrine identique à `GET /ordres-reparation/{id}` (D-10).

### 7.1 En-tête (`EnTeteDossierVente`)

Sur le modèle de `EnTeteOrdreReparation` (`Card` pleine largeur) :
- `BadgeStatutDossierVente` + `FriseStatutDossierVente` (§3.3) juste en dessous.
- `IdentiteClient(clientAcheteur)`. Si `clientFacture.id !== clientAcheteur.id` : ligne secondaire
  « Facturé à : {clientFacture.nomAffiche} » — visible sans clic, c'est une information qui change le
  sens de tout le dossier (typiquement un leasing, `RV-40`/`RV-41`). Si `clientConducteur` renseigné et
  différent de l'acheteur : ligne « Conducteur : {nomAffiche} ».
- `IdentiteVehicule(vehicule)` taille `xl`, ou — si `vehicule === null` — un encart atténué
  « Aucun véhicule assigné » avec bouton « Assigner un véhicule » (PATCH, actif uniquement en
  `prospection`, `RV-30`/`RV-32`).
- **Le prix.** Le dossier ne porte structurellement aucun montant (`§8.2` du contrat, littéral :
  « aucune duplication du montant, de la TVA ou du statut de paiement ici ») — le prix affiché vient
  de `documents` (`DocumentVenteResume[]`), jamais recalculé. Règle de sélection : le document le
  plus récent de type `bon_commande` ou `facture` dans un statut non `annule`/`remplace` porte le
  prix « engagé », rendu en `texte-donnee-proeminente`. À défaut, le `devis` le plus récent porte un
  prix rendu **atténué** avec le préfixe « Indicatif (devis) » — jamais la même emphase visuelle
  qu'un prix contractuel. Si `documents` est vide : « Prix non défini » + lien vers la création d'un
  devis (écran facturation, hors périmètre de ce document, lien inter-module).
- `dateLivraisonEstimee` si renseignée.

### 7.2 `PanneauProchaineEtape` — le cœur de la réponse au point dur du brief

Nouveau composant, sans précédent direct : l'OR se contente de boutons visibles seulement quand
`actionsDisponibles` les liste (« une action affichée mais refusée est pire que pas d'action »). Le
brief demande explicitement plus pour ce module : dire *ce qui bloque et à qui c'est*, pas seulement
après un clic refusé. Les deux mécanismes coexistent, ils ne se contredisent pas : `PanneauActionsDossierVente`
(§7.3) continue à ne montrer que les actions réellement disponibles ; `PanneauProchaineEtape`, affiché
juste au-dessus, explique **proactivement** pourquoi la suite logique n'y figure pas encore.

Toujours visible tant que `statut` n'est pas terminal (`clos`/`annule`/`abandonne`). Contenu : une
checklist des conditions connues pour atteindre la prochaine étape linéaire, calculée **côté client à
partir des champs déjà présents sur `ReponseDossierVente`** (pas une nouvelle requête, pas une règle
métier redevinée — uniquement la mise en forme lisible de faits déjà renvoyés par le serveur) :

| Étape suivante | Condition affichée | Source | Rendu si non satisfait |
|---|---|---|---|
| `engager` | Véhicule assigné | `vehicule !== null` | « À : vous — assigner un véhicule » |
| `engager` | Identité vérifiée | `identiteVerifieeLe !== null` | « À : vous — vérifier une pièce d'identité » |
| `engager` | Reprise négociée (si reprise présente) | `reprise?.statut !== 'estimee'` | « À : vous — négocier la reprise avant de signer » |
| `marquer_pret_a_livrer` | Financement confirmé | `financement?.statutConfirmation === 'confirme'` | « À : {organisme.nomAffiche ou "l'organisme"} — financement en attente » |
| `marquer_pret_a_livrer` | Expertise MFK à jour (si applicable) | information vivant côté atelier, pas dupliquée ici | « À : l'atelier — expertise MFK à vérifier » (lien vers la fiche véhicule) |
| `livrer` | Documents de livraison réunis | `documentsRequis.every(d => d.fourni)` | « À : {N} document(s) manquant(s) » + lien vers §7.6 |

Chaque ligne satisfaite affiche une coche discrète (`CheckCircle2`, token `succes`), chaque ligne non
satisfaite affiche le token `attention` et le texte « à : … » explicite — jamais un bouton grisé sans
légende. Ce panneau ne remplace **aucune** garde serveur (les 409 `VENTE_FINANCEMENT_NON_CONFIRME`,
`VENTE_LIVRAISON_EXPERTISE_REQUISE`, `VENTE_LIVRAISON_INCOMPLETE` restent la seule source de vérité,
gérés par `RefusBloquant` comme partout, §4) — c'est une explication anticipée, pas une seconde
implémentation de la règle métier.

Note d'implémentation : la ligne « expertise MFK » ne peut être calculée avec certitude que côté
serveur (`vehicule_expertise`, hors périmètre de ce contrat) — tant qu'aucun champ ne l'expose sur
`ReponseDossierVente`, cette ligne reste **informative et non bloquante côté client** (elle rappelle
d'aller vérifier, elle ne coche/décoche rien). Voir §13 question 4.

### 7.3 `PanneauActionsDossierVente`

Copie conforme de `PanneauActionsOr.tsx` : un bouton par valeur de `dossier.actionsDisponibles`
(jamais une liste devinée depuis `statut`), un hook de mutation par action, ouverture d'un `Dialog`
par clic, jamais d'exécution directe. Contenu par action :

- **`engager`** — `bonCommandeDocumentId` (obligatoire) : sélecteur parmi `documents.filter(d =>
  d.typeDocument === 'bon_commande')`. Si aucun bon de commande n'existe encore sur le dossier :
  message explicite « Aucun bon de commande sur ce dossier » + bouton « Créer le bon de commande »
  (lien vers l'écran facturation, hors périmètre, mais le chemin de sortie doit exister — même
  doctrine que `RefusBloquant.actionsProposees`, jamais un cul-de-sac). `identitePieceType`
  (obligatoire) : `Select` avec options usuelles suisses (Carte d'identité, Passeport, Permis de
  conduire, Titre de séjour) + option « Autre » qui révèle un champ texte libre — le champ reste
  `string` libre côté contrat, ce `Select` n'est qu'une aide de saisie, pas une contrainte serveur.
  Description de confirmation : « Le véhicule sera réservé. » + si reprise `negociee` présente :
  « La reprise sera confirmée. » — la conséquence concrète en une phrase, doctrine `AvertissementConfirmable`.
- **`preparer`** — corps vide, confirmation simple.
- **`marquer_pret_a_livrer`** — corps vide. C'est l'action la plus susceptible de revenir en
  `RefusBloquant` (financement/expertise/documents) — `PanneauProchaineEtape` (§7.2) l'aura déjà
  annoncé, ce dialog est la confirmation formelle, pas la première annonce.
- **`livrer`** — voir §10 (parcours dédié, plus riche que les autres).
- **`cloturer`** — corps vide. Description : « Purement administratif — aucune vérification
  supplémentaire n'est effectuée. » (reprend le texte du contrat au plus près, pour ne pas laisser
  croire à un contrôle métier qui n'existe pas).
- **`annuler`** / **`abandonner`** — motif obligatoire (`Textarea`), variant destructif pour `annuler`
  uniquement. Description de confirmation obligatoire sur l'effet de bord : « Si un véhicule est
  réservé sur ce dossier, il redevient disponible à la vente. »

### 7.4 Section Reprise, Financement, Documents, Documents requis

Voir §8, §9, §7.6 respectivement — sections composées dans la fiche, pas des écrans séparés.

### 7.5 Documents de la chaîne facturation

`Card` listant `documents` (`DocumentVenteResume[]`) : type traduit, numéro, statut, montant TTC,
solde, date — table simple (pas `TableComptoir`, pas de tri/filtre nécessaire pour une poignée de
lignes), chaque ligne un lien vers l'écran facturation existant (hors périmètre). Si
`documentsTronques` : mention « Liste limitée aux 50 premiers documents » (`SEUIL_DOCUMENTS_EMBARQUES_DOSSIER_VENTE`)
+ lien vers une recherche facturation filtrée par `dossierVenteId` — **actuellement impossible**, ce
filtre n'existe pas sur `GET /documents-vente` (gap déjà signalé dans le contrat lui-même). Tant qu'il
n'existe pas, ce lien ne peut pas être posé — je le note comme demande en §14, pas comme un lien
cassé livré silencieusement.

### 7.6 Documents requis (checklist de livraison)

`Card` avec une liste de `Checkbox` (une par élément de `documentsRequis`), libellé + date de fourniture
si cochée. Coche/décoche appelle `POST /dossiers-vente/{id}/documents-requis/marquer` directement (pas
de dialog — c'est une bascule légère, cohérent avec le contrat qui la traite comme un no-op idempotent).
**Particularité pour la règle d'erreur (§4)** : sans dialog, l'échec doit s'afficher **localement à la
ligne** (icône d'erreur + message court à côté de la case, la case revenant à son état précédent) —
jamais seulement un toast qui peut passer inaperçu pendant que l'utilisateur a déjà les yeux ailleurs
sur l'écran.

---

## 8. Composant — La reprise (`CarteReprise`)

Carte dans la fiche dossier (§7), pas un écran séparé — cohérent avec la doctrine du contrat
(« sous-ressource singulière », 0 ou 1 par dossier). Requête secondaire non bloquante
(`GET /dossiers-vente/{id}/reprise`) déclenchée seulement si `dossier.reprise !== null` — même patron
que `useContexteAtelier` vs `useKilometragesVehicule` sur `EcranFicheVehicule` (primaire bloquant vs
secondaire par section).

### 8.1 Absence de reprise

`dossier.reprise === null` et `statut` non terminal → carte compacte : « Pas de reprise sur ce dossier »
+ bouton « Ajouter une reprise » (masqué si le rôle courant n'a pas le droit d'écriture — grisage
géré comme `peutModifierParametrage`, doctrine `droits.ts`). Dialog de création : véhicule repris
(recherche véhicule existant, ou création à la volée si le véhicule n'est pas encore connu de DFA —
`§8.3` du contrat : « référence à un véhicule existant ou nouvellement créé », réutilise le formulaire
de création véhicule existant plutôt que d'en écrire un second), valeur estimée (montant), dette de
financement résiduelle (montant optionnel) + organisme (recherche client/tiers OU texte libre — les
deux champs du contrat, l'un ou l'autre).

### 8.2 Présence d'une reprise — l'affichage des deux valeurs

C'est le point le plus délicat du module. Rendu :

- `BadgeStatutReprise` en en-tête de carte.
- `IdentiteVehicule(vehiculeRepris)` — clic navigue vers `/vehicules/{id}` (§1).
- **Deux montants côte à côte, jamais un seul chiffre fusionné** :
  - « Valeur estimée » (`valeurEstimeeCentimes`) — poids normal, `text-muted-foreground` sur le
    libellé, positionnée en second (secondaire visuellement) : c'est l'évaluation technique interne,
    jamais montrée au client.
  - « Valeur négociée » (`valeurNegocieeCentimes`, ou « En cours de négociation » si `null`) —
    `texte-donnee-proeminente`, positionnée en premier (c'est LE chiffre contractuel, celui du bon de
    commande).
  - **Écart** (`ecartRepriseVehiculeCentimes`) — chip à côté de la valeur négociée, signé
    (`+CHF 800.00` / `−CHF 200.00`), libellé explicite « Écart / geste commercial ». **Jamais** en
    token `--statut-danger`, jamais le mot « anomalie » ou « erreur » — un écart positif est le cas
    normal et attendu (`RV-20`), un token neutre/informatif (`Badge variant="outline"`, pas un badge
    de statut) suffit. Aucune coloration ne doit laisser penser à une saisie fautive.
- Dette de financement résiduelle, si renseignée, en ligne séparée avec une légende atténuée
  rappelant qu'il s'agit d'une condition suspensive (`RV-26`) — pas un montant qui s'additionne
  silencieusement aux deux précédents.

### 8.3 Ce que cette carte n'affiche jamais

**Aucune base TVA, aucun montant de TVA calculé sur l'écart.** Le traitement fiscal de l'écart
(`QV-05`) n'est pas tranché — le contrat l'interdit explicitement (« Ce fichier ne calcule NI n'expose
aucune base TVA »), et cette conception s'y conforme à la lettre : ni champ, ni note, ni infobulle sur
ce sujet nulle part sur cette carte. Voir §13 question 9.

**Frontière client/interne, explicite** : cette carte vit sur le dossier de vente, un écran
**interne** (vendeur/direction). Les deux valeurs et l'écart y sont légitimement visibles pour
l'équipe. La contrainte du brief (« sans exposer au client une information qui ne le regarde pas »)
porte sur les documents **remis au client** (bon de commande, facture) — hors périmètre de ce
document, propriété de l'écran facturation. Je formule ici une exigence de conception à relayer à qui
dessinera ce gabarit : le document client ne doit jamais afficher `valeurEstimeeCentimes` ni l'écart,
uniquement `valeurNegocieeCentimes` comme ligne de déduction. Signalé aussi en §14 comme dépendance
côté facturation (le type de ligne `ecart_reprise_vehicule` qui matérialiserait cet écart sur le
document n'existe pas encore côté contrat facturation).

### 8.4 Actions

- **`modifier`** (tant que `statut = 'estimee'`) — dialog simple, révision de la valeur estimée.
- **`negocier`** — dialog avec un seul champ, la nouvelle valeur négociée. Texte d'accompagnement,
  explicite pour fixer une bonne fois pour toutes laquelle des deux valeurs compte pour la suite :
  « Cette valeur sera annoncée au client et déduite du prix d'achat. » Appelable plusieurs fois
  (chaque appel un événement audité, pas un `PATCH` silencieux, `RV-06`).
- **`confirmer`** — normalement un effet de bord de `engager` (§7.3). Le contrat le qualifie
  lui-même de « correction exceptionnelle » — bouton **secondaire**, dans un menu « Actions de
  correction » (pas dans la rangée d'actions principale), motif obligatoire.
- **`refuser`** — motif obligatoire (`Textarea`). Ne bloque **pas** le reste du dossier (`RV-25`) :
  après refus, la carte affiche l'état « Refusée » + `motifRefus`, et le reste de la fiche continue
  normalement — aucun bandeau d'alerte alarmant ailleurs sur l'écran, le refus d'une reprise est une
  issue normale du processus.

---

## 9. Composant — Le financement (`CarteFinancement`)

Carte dans la fiche dossier, collection embarquée (`financement` courant + `financements` historique
complet, jusqu'à `SEUIL_FINANCEMENTS_EMBARQUES = 20`) — pas de pagination séparée, le contrat le
justifie explicitement (peu de tentatives en pratique).

### 9.1 En-tête — le financement courant

Type traduit (comptant/crédit/leasing), organisme le cas échéant, `BadgeStatutFinancement`. Étiquette
« Actuel » toujours visible sur cette entrée pour ne pas dépendre uniquement de sa position dans la
liste.

### 9.2 Historique — pourquoi il doit rester visible

`CV-03` : un refus n'écrase jamais l'ancien enregistrement, un nouveau financement s'ouvre à côté.
Rendu en liste verticale chronologique (plus récent en premier, doctrine de tri constante du produit),
chaque entrée : type, organisme, `BadgeStatutFinancement`, date de proposition, date de
confirmation/refus, et — si refusé — `motifRefus` affiché en clair sous l'entrée (jamais réduit à un
clic supplémentaire : c'est exactement l'information qui explique au vendeur pourquoi il doit proposer
un autre mode de financement, `§7.3` du contrat).

### 9.3 Actions

- **« Proposer un financement »** — bouton toujours visible tant que `statut` du dossier n'est pas
  terminal. Dialog : type (`Select`), organisme (recherche client/tiers, affiché **et obligatoire**
  uniquement si type ∈ {crédit, leasing} — masqué pour comptant), référence de contrat (optionnel).
  `comptant` se confirme immédiatement côté serveur (`statutConfirmation` dérivé) — le dialog l'indique
  avant soumission : « Aucune confirmation supplémentaire n'est nécessaire pour un paiement comptant. »
- **`confirmer`/`refuser`** — visibles uniquement sur l'entrée `en_attente` (au plus une à la fois, la
  machine à états du financement n'a qu'un seul état non terminal). C'est une exception délibérée à la
  doctrine « jamais déduire une action du statut seul » (appliquée partout ailleurs dans ce document,
  §4, §7.3) : ici la machine est triviale au point que `ACTIONS_FINANCEMENT` ne contient que ces deux
  actions, toujours valides en `en_attente`, jamais valides ailleurs — la garde serveur (`RefusBloquant`,
  §4) reste néanmoins active en filet, exactement comme partout ailleurs, en cas de désynchronisation.
  `refuser` : motif obligatoire. Après un refus réussi, la carte doit remettre en évidence le bouton
  « Proposer un financement » (focus ou léger encart) — le contrat est explicite que le dossier attend
  alors une nouvelle proposition, l'écran doit accompagner ce prochain geste plutôt que de laisser
  l'utilisateur le retrouver seul.

### 9.4 Limite connue, signalée

Si `financementsTronques === true` (plus de 20 tentatives), l'écran l'annonce (« Historique limité aux
20 dernières tentatives ») mais **ne peut proposer aucun lien « voir plus »** : aucun endpoint paginé
n'existe pour cette collection (doctrine assumée du contrat — cas jugé rarissime). Mieux vaut l'annoncer
honnêtement que de mentir par omission. Voir §14.

---

## 10. Parcours — La livraison

Pas un écran séparé : c'est la combinaison de la carte « Documents requis » (§7.6, visible dès
`en_preparation`) et du dialog déclenché par l'action `livrer` (§7.3), la plus riche de toutes les
transitions du dossier.

### 10.1 Dialog `livrer`

Champs : date de livraison effective (`DatePicker`, défaut = aujourd'hui), kilométrage de départ
(réutilise `ChampKilometrage`, composant déjà en usage sur l'OR), unité (km par défaut, masquée sauf
véhicule importé). Pour un VN (`typeVehicule = 'vn'`), le kilométrage est **pré-rempli à 0** (`RV-55`)
mais reste modifiable — un essai avant remise des clés n'est pas à exclure.

**Description de confirmation composée dynamiquement**, doctrine `AvertissementConfirmable` (« la
conséquence concrète, en une phrase ») appliquée ici à une confirmation normale (pas un avertissement) —
les effets de bord de cette transition sont invisibles autrement, l'écran doit les dire avant que
l'utilisateur clique :
- Toujours : « La détention du véhicule sera transférée à {clientConducteur ?? clientAcheteur}. »
- Si `typeVehicule === 'vn'` : « La garantie constructeur démarre à cette date. »
- Si `reprise?.statut === 'confirmee'` : « Le véhicule repris entrera au parc en stock à sa valeur
  négociée ({formaterMontant(valeurNegocieeCentimes)}). »

### 10.2 Après livraison

`statut = 'livre'` : la frise (§3.3) avance, `PanneauProchaineEtape` (§7.2) n'affiche plus qu'une
ligne « Reste à faire : clôturer le dossier » sans blocage (action purement administrative,
`cloturer` déjà listée dans `actionsDisponibles`). Pas de clôture automatique — un choix de clic
délibéré, cohérent avec le contrat qui traite `cloturer` comme un second contrôle humain de la
paperasse, pas un effet de bord.

### 10.3 Ce qui manque pour un parcours complet de remise de clés

Le contrat ne porte **aucun champ de signature électronique**, ni sur `schemaActionLivrer` ni sur
`schemaActionEngager`. Si une capture de signature (tablette, show-room) est prévue pour ce moment,
elle n'existe pas dans ce contrat — je le formule en question, pas en fonctionnalité conçue par
défaut (§13 question 5).

---

## 11. Le point dur : la reprise gonflée — récapitulatif des règles de conception

Ce paragraphe rassemble, en un seul endroit, les règles déjà posées en §8 pour qu'elles soient
vérifiables d'un coup d'œil par quiconque implémente ou relit cet écran :

1. `valeurEstimeeCentimes` et `valeurNegocieeCentimes` sont **toujours rendues ensemble**, jamais l'une
   sans l'autre quand une reprise existe — aucun mode d'affichage compact de cette carte ne doit les
   séparer.
2. La valeur négociée porte l'emphase visuelle (c'est le chiffre contractuel) ; la valeur estimée reste
   visible mais secondaire.
3. L'écart se rend avec un vocabulaire neutre (« écart / geste commercial »), jamais un vocabulaire
   d'anomalie, jamais un token de couleur `danger`.
4. Aucune base TVA, aucun montant de TVA lié à cet écart n'apparaît nulle part dans ce document ni
   dans les écrans qu'il décrit — la question n'est pas tranchée et ce n'est pas à l'écran de trancher
   à sa place en silence.
5. La carte reprise est un écran **interne** ; la traduction de ces deux valeurs vers un document
   remis au client (une seule valeur, la négociée) est une exigence transmise, pas construite ici.

---

## 12. Tablette vs desktop

Le module Ventes est, dans son ensemble, **desktop d'abord** (brief : « bureau » pour stock et
facturation) — le parc en stock, la fiche dossier, la reprise et le financement sont des tâches de
bureau : chiffrage, négociation, lecture de plusieurs colonnes de montants. Une exception, cohérente
avec la doctrine déjà posée pour la restitution d'un OR (comptoir/tablette) : le moment de la
**livraison** (§10) peut se produire au comptoir ou dans le show-room, potentiellement sur tablette,
face au client. Le dialog `livrer` et la carte « Documents requis » (§7.6) doivent donc respecter les
cibles tactiles ≥ 44 px même si le reste de l'écran est pensé dense/desktop — pas besoin d'une mise en
page entièrement différente, juste des zones cliquables suffisamment grandes sur cette carte et ce
dialog précis.

---

## 13. Décisions que j'ai dû prendre faute d'information — questions pour @laupernoe

1. **Numéro de dossier.** `ReponseDossierVente` ne porte aucun champ `numero` (contrairement à l'OR
   qui a `or.numero`). L'écran s'identifie donc par client + véhicule, jamais par un numéro court.
   Est-ce voulu, ou un numéro de dossier commercial (utile à l'oral, au téléphone) manque-t-il au
   contrat ?
2. **Seuil « jours de stock ».** Aucun paramétrage tenant n'existe pour ce seuil (`PV-01` non écrit).
   J'ai retenu des seuils fixes provisoires (attention 45j, danger 90j, §3.4) faute de mieux. Faut-il
   les rendre configurables par tenant dès ce lot, ou un défaut fixe suffit pour une V1 ?
3. **`enStock`/`stockId` sur `ReponseVehicule`.** Déjà demandé par le contrat lui-même — je le
   reformule comme un vrai blocage de conception (§1.1) : sans lui, la fiche véhicule doit sonder
   `GET /vehicules/{id}/stock` à vide pour presque tous les véhicules-clients, dégradant un écran
   aujourd'hui rapide.
4. **La checklist `documentsRequis` bloque-t-elle réellement `marquer-pret-a-livrer` ?** Le contrat
   évoque `VENTE_LIVRAISON_INCOMPLETE` pour « tout autre élément… non réuni côté paramétrage tenant
   (`PV-03`) » sans préciser si cette checklist en fait explicitement partie. `PanneauProchaineEtape`
   (§7.2) la traite comme informative en attendant confirmation.
5. **Signature électronique à la livraison.** Absente du contrat (`schemaActionLivrer` comme
   `schemaActionEngager`). Reste-t-elle papier hors DFA pour ce lot, ou une capture est-elle prévue
   ailleurs (facturation) et simplement pas encore contractualisée ici ?
6. **Retrouver le dossier actif d'un véhicule en stock.** `ReponseVehiculeStock` ne porte aucun lien
   direct vers un dossier de vente en cours. J'ai conçu `BlocVente` (§1.1) pour interroger
   `GET /dossiers-vente?vehiculeId=...` à la demande. Est-ce le chemin voulu, ou un champ direct
   (`dossierVenteActifId`) serait-il préférable ?
7. **Plafond de l'historique financement.** `financementsTronques` peut valoir `true` sans aucun
   endpoint de secours pour voir le reste (§9.4). Cas jugé rarissime par le contrat — suffisant en
   pratique, ou faut-il un filet ?
8. **Qui voit la marge ?** `fraisRemiseEtatCumulesCentimes`, le coût de remise en état, et à terme une
   marge calculée (vente − achat − remise en état) sont-ils ouverts à tout vendeur (comme conçu par
   défaut dans ce document) ou réservés à direction/chef d'atelier, sur le modèle de `plafondCentimes`
   qui disparaît déjà pour un rôle sans droit aux montants sur l'OR ? Aucune matrice de droits n'existe
   encore pour ce module.
9. **Traitement TVA de l'écart de reprise (`QV-05`).** Non tranché, rappelé par le contrat lui-même.
   Cette conception n'expose aucune base TVA nulle part (§8.3, §11) en attendant l'arbitrage.

---

## 14. Demandes d'API — formulées comme des demandes, pas des acquis

- **`ReponseVehicule.enStock` (ou `stockId`)** — déjà signalé par le contrat lui-même
  (`vehicule-stock.ts`) ; je le reformule comme dépendance concrète de `BlocVente` (§1.1).
- **Un endpoint d'agrégats du parc en stock** (nombre par statut, jours de stock moyen/médian, valeur
  immobilisée totale) — absent aujourd'hui. Sans lui, je préfère ne montrer aucun bandeau de pilotage
  plutôt qu'un chiffre calculé sur une seule page paginée (§5.5).
- **Filtre `dossierVenteId` sur `GET /documents-vente`** — déjà signalé comme gap croisé par le
  contrat lui-même (`dossier-vente.ts`, en-tête) ; nécessaire pour le lien « voir tous les documents »
  quand `documentsTronques = true` (§7.5).
- **Paramétrage tenant du seuil de jours de stock (`PV-01`) et de la checklist de livraison (`PV-03`)**
  — déjà notés absents par le contrat (`contrats/ventes/index.ts`, note de périmètre) ; je confirme
  qu'ils sont une dépendance réelle des écrans 5 (§3.4/§5.1) et 10 (§7.6/§10) de ce document, pas
  seulement une case cochée en attente ailleurs.
- **Un lien direct dossier-de-vente-actif sur `ReponseVehiculeStock`** — alternative à la question 6
  ci-dessus si @laupernoe préfère un champ dénormalisé à une requête filtrée côté client.

---

## Rappel de périmètre

Ce document ne conçoit **aucun écran de facturation** (devis, bon de commande, facture, avoir — la
fiche dossier ne fait que les lister et y renvoyer par lien, §7.5) ni **aucun écran de paramétrage
tenant** pour ce module (`PV-01` → `PV-08`, absent du contrat actuel). Les deux sont des périmètres
distincts, appartenant à leurs propriétaires respectifs.
