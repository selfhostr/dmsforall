# Design — Tableau de bord par rôle (fusion Accueil/Tableau de bord)

Statut : proposition de conception, à implémenter par `expert-react`. Aucun code dans ce document.

Décision de @laupernoe (10.08.2026), verbatim : « Accueil et tableau de bord doivent fusionner. "Aujourd'hui"
doit juste être le tableau de bord. Et le tableau de bord doit être adapté en fonction de chaque type
d'utilisateur. [...] Ça doit vraiment être le truc où ils arrivent, ils regardent, ils ont toutes
leurs infos. [...] le but c'est d'être minimaliste et très simple. »

## 0. Ce qui existe aujourd'hui (lu dans le code, pas supposé)

Deux écrans distincts, deux routes :

- **`EcranAccueil.tsx`** (`/`) — deux widgets : `CalendrierEcheances` (OR de la semaine par date de
  restitution promise, `GET /ordres-reparation?restitutionPromiseDu/Au`) et `EcheancesAVenir` (jeux de
  pneus à relancer, `GET /depots-pneus/a-relancer`). Le commentaire en tête du fichier documente
  lui-même que la fusion est prévue « dans un chantier séparé » — c'est ce chantier.
- **`EcranTableauBord.tsx`** (`/tableau-bord`) — deux blocs génériques identiques pour tout rôle
  autorisé : `BlocActiviteTableauBord` (`GET /tableau-bord/activite`, ouvert à tous sauf
  `poste_atelier`) et `BlocFinancierTableauBord` (`GET /tableau-bord/financier`, réservé
  `direction`/`comptable`, RF-115). Sélecteurs de site et de période partagés en haut d'écran.

Table d'atterrissage actuelle (`routes/atterrissage.ts`, négociée avec @laupernoe le 08.08.2026) :

| Rôle                                                   | Atterrissage actuel    |
| ------------------------------------------------------ | ---------------------- |
| `poste_atelier`                                        | `/pointage/borne`      |
| `technicien`                                           | Pointage › Mon travail |
| `magasinier`                                           | Pièces › Comptoir      |
| `vendeur`                                              | Ventes › Dossiers      |
| `comptable`                                            | Facturation › Factures |
| `receptionnaire`, `chef_atelier`, `direction`, `admin` | `/` (Accueil)          |

## 1. Tension à trancher avant implémentation

L'instruction du jour dit que le tableau de bord doit être « le truc où ils arrivent » pour **chacun**
des neuf rôles. La table d'atterrissage ci-dessus n'envoie que quatre rôles sur cet écran ; les cinq
autres atterrissent sur un écran de travail dédié (`technicien`, `magasinier`, `vendeur`, `comptable`,
`poste_atelier`).

Cette table n'est pas un oubli : elle a été négociée avec @laupernoe deux jours avant cette demande, avec des
critères d'acceptation explicites par rôle (« jamais l'inventaire en premier » pour le magasinier,
« son plan de travail du jour » pour le vendeur et le comptable). Ces écrans de travail **sont**
déjà, dans les faits, le dashboard personnalisé de ces rôles — la liste de dossiers de vente d'un
vendeur affiche déjà « ses dossiers », Pièces › Comptoir est déjà l'écran où le magasinier passe sa
journée.

**Proposition retenue dans ce document** : ne pas changer la table d'atterrissage. Construire le
contenu adapté des neuf rôles pour l'écran fusionné (accessible en un clic depuis le menu pour tous,
sauf `poste_atelier` — §5), mais laisser les cinq rôles « doers » atterrir sur leur écran de travail,
qui reste leur meilleur point d'entrée. Si @laupernoe veut au contraire que ces cinq rôles atterrissent
désormais sur le tableau de bord fusionné, c'est un changement d'une ligne dans
`ATTERRISSAGE_PAR_ROLE` une fois ce document validé — je le signale plutôt que de trancher en
silence, seule question ouverte de ce document.

## 2. Ce qui fusionne : une seule route, un seul écran

`/tableau-bord` devient la route unique (le nom de route interne est indifférent ; le libellé de menu
reste « Aujourd'hui », cohérent avec `atterrissage.ts` et le vocabulaire déjà choisi). `EcranAccueil.tsx`
et son entrée de route disparaissent. `EcranTableauBord.tsx` devient le composant hôte, mais son
contenu n'est plus deux blocs figés identiques pour tous : il rend une **liste de blocs dépendant du
rôle courant** (`session.utilisateur.role`), plafonnée à cinq.

Layout commun (desktop d'abord — ces neuf rôles utilisent l'écran depuis un poste de bureau ou
d'atelier partagé, jamais en mobilité comme le vendeur sur son dossier de vente) :

- En-tête : titre `t('tableauBord:titre')` (déjà existant) + sélecteur de site (`SelecteurSiteTableauBord`,
  repris tel quel — un tenant multi-site en a besoin pour tous les rôles).
- **Le sélecteur de période disparaît de l'en-tête générique.** Il ne reste que pour les deux rôles
  pour qui « la période » est un concept de travail réel (`direction`, `comptable`) — voir leurs
  sections. Pour les six autres, chaque bloc a une fenêtre temporelle fixe et implicite dans son
  libellé (« aujourd'hui », « cette semaine ») : un sélecteur générique au-dessus de blocs à
  sémantique de date différente (« sorties du jour » vs « CA du mois ») serait trompeur, pas
  minimaliste.
- Pile verticale de 3 à 5 blocs, chacun une `Card` avec titre et éventuellement une action de survol
  (clic sur la carte entière quand elle mène quelque part — cohérent avec le patron déjà utilisé par
  `CalendrierEcheances`, qui rend chaque ligne cliquable en `<Link>`).
- Aucune grille figée : `flex flex-col gap-6`, comme le fait déjà `EcranAccueil.tsx` — un bloc peut
  être plus haut qu'un autre sans casser la mise en page.

## 3. Les neuf dashboards

Pour chaque rôle : ce qu'il regarde en arrivant, ce qui le ferait agir dans la minute, les blocs
retenus (composant proposé, source de donnée, statut de câblage), ce qui est délibérément écarté.

### 3.1 Direction

**Regard du matin** : la santé du garage en un coup d'œil — l'argent qui rentre, ce qui sort ce soir,
si l'atelier tourne. **Agit dans la minute si** : un encours clients dépasse un seuil, ou l'atelier
est anormalement vide/plein.

| Bloc                                                                        | Source                                                                                                                                             | Statut                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Encours clients**, cliquable vers Factures filtrées impayées              | `GET /tableau-bord/financier` → `encoursClientsCentimes`                                                                                           | Câblable pour le chiffre brut. **Gap** : agrégat unique, pas de ventilation « à échéance » / « en retard » (voir §4) — le clic vers une liste PRÉ-FILTRÉE `enRetard=true` est lui câblable (le filtre existe côté contrat, §4), mais le chiffre affiché sur la carte elle-même reste l'encours total, pas « l'encours en retard » tant que l'agrégat n'existe pas. |
| **Chiffre d'affaires de la période** (mois civil par défaut), détail HT/TVA | `GET /tableau-bord/financier` → `chiffreAffaires.*`                                                                                                | Câblable, existe déjà tel quel dans `BlocFinancierTableauBord`.                                                                                                                                                                                                                                                                                                    |
| **OR ouverts aujourd'hui**, cliquable vers Atelier filtré                   | `GET /tableau-bord/activite` → `ordresReparationOuvertsPeriode` (période resserrée à aujourd'hui pour ce bloc, indépendamment du sélecteur de CA)  | Câblable.                                                                                                                                                                                                                                                                                                                                                          |
| **Sorties du soir** (restitutions promises aujourd'hui)                     | `GET /ordres-reparation?restitutionPromiseDu=Au=aujourd'hui` — reprise de `CalendrierEcheances`, fenêtre resserrée à un jour au lieu d'une semaine | Câblable, patron déjà écrit.                                                                                                                                                                                                                                                                                                                                       |

4 blocs. Un sélecteur de période reste pertinent ICI (elle seule, avec le comptable, raisonne « ce
mois » vs « le mois dernier ») : le garder, mais scoper uniquement au bloc CA — pas aux trois autres,
qui restent « aujourd'hui » par nature.

**Écarté** : `ordresReparationParStatut` (répartition détaillée par statut) — utile au chef d'atelier
qui gère la charge, pas à la direction qui veut un chiffre, pas un histogramme. `articlesSousSeuilReapprovisionnement`
— job du magasinier, pas le sien.

### 3.2 Comptable

**Regard du matin** : l'argent qui n'est pas rentré. **Agit dans la minute si** : une facture bascule
en retard ou un encaissement attendu n'est pas arrivé.

| Bloc                                                                                              | Source                                                                                                                                                                                    | Statut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encours clients**, cliquable vers Factures › En retard                                          | `GET /tableau-bord/financier` → `encoursClientsCentimes`                                                                                                                                  | Même statut que pour la direction — chiffre total câblable, ventilation manquante.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Encaissements de la période**                                                                   | `GET /tableau-bord/financier` → `encaissementsCentimes`                                                                                                                                   | Câblable, existe déjà.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Accès direct « À relancer »** (CTA plutôt qu'un chiffre) vers Factures filtrées `enRetard=true` | `GET /documents-vente?enRetard=true&relanceNiveau=...` — le filtre existe dans le contrat (`schemaFiltresDocumentsVente`, `packages/shared/src/contrats/facturation/document.ts:358-376`) | **Gap partiel** : le filtre est accepté par le contrat, mais ce dépôt a un piège documenté et vérifié plusieurs fois (`CONTRIBUTING.md` : « un filtre accepté par le contrat n'est pas forcément appliqué au SQL »). Avant de construire ce bloc, `verificateur-independant` doit prouver que `GET /documents-vente?enRetard=true` avec un filtre significatif retourne effectivement une liste réduite, pas la liste complète. Sans compteur agrégé fiable (voir §4), ce bloc est un LIEN d'accès rapide, pas un chiffre affiché sur la carte — afficher un compte inventé serait pire que ne rien afficher. |

3 blocs. Période conservée pour elle aussi (CA du mois n'a pas de sens pour elle — retiré — mais
« encaissements de la période » si.

**Écarté** : `chiffreAffaires` (le CA facturé est un chiffre de pilotage, la comptable travaille sur
l'encaissé et l'impayé, pas la facturation brute — nuance métier délibérée, à confirmer si erronée).

### 3.3 Chef d'atelier

**Regard du matin** : ce qui sort aujourd'hui et ce qui bloque. **Agit dans la minute si** : une ligne
d'OR est bloquée (devis refusé, en attente client) ou une restitution promise pour aujourd'hui n'a pas
de technicien dessus.

| Bloc                                                                         | Source                                                       | Statut                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sorties du jour** (restitutions promises aujourd'hui), cliquable vers l'OR | `GET /ordres-reparation?restitutionPromiseDu=Au=aujourd'hui` | Câblable, reprise de `CalendrierEcheances` resserrée à un jour.                                                                                                                                                                                                        |
| **Lignes en attente de validation** — LE signal « ce qui bloque »            | `GET /tableau-bord/activite` → `lignesEnAttenteValidation`   | Câblable, déjà exposé, jamais mis en avant comme signal d'action jusqu'ici.                                                                                                                                                                                            |
| **Répartition des OR par statut** (charge de l'atelier)                      | `GET /tableau-bord/activite` → `ordresReparationParStatut`   | Câblable, reprise du graphique à barres existant.                                                                                                                                                                                                                      |
| **Qui travaille sur quoi maintenant**                                        | `GET /pointages?statut=en_cours&siteId=`                     | Câblable — `STATUTS_POINTAGE` inclut `'en_cours'` (`packages/shared/src/contrats/atelier/enums.ts:421`). Rend une liste technicien → OR/ligne en cours, pas un agrégat serveur : à grouper côté client, le volume (une équipe d'atelier) le permet sans souci de perf. |

4 blocs. Pas de sélecteur de période — tout est « aujourd'hui » ou « maintenant » pour lui, cohérent
avec son test d'acceptation dans le plan (§3.3 : « l'activité du jour visible sans clic »).

**Écarté** : le bloc financier (RF-115, il n'a jamais eu ce droit). `delaiMoyenRestitutionMinutes` —
indicateur de pilotage plus utile à la direction qu'à une lecture quotidienne.

**Note** : le plan (`docs/plan-refonte-navigation.md` §3.4) signale un trou métier (F1) : à la borne,
un mécanicien ne voit pas le STATUT bloqué d'une ligne, seulement un compte. Le bloc « lignes en
attente de validation » ci-dessus donne au chef d'atelier le signal agrégé ; il ne remplace pas F1,
qui reste un chantier Pointage/Lot H distinct.

### 3.4 Réceptionnaire

**Regard du matin** : ce qui se passe cette semaine, ce qu'il faut relancer. Son outil réel est la
recherche en en-tête (déjà livrée, hors périmètre de ce document) — le dashboard est un complément
léger, pas son geste principal.

| Bloc                                                                                                             | Source                                                     | Statut                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calendrier de la semaine** (restitutions promises)                                                             | `GET /ordres-reparation?restitutionPromiseDu/Au`           | Câblable — reprise identique de `CalendrierEcheances`, aucun changement.                                                                                                     |
| **Jeux de pneus à relancer**                                                                                     | `GET /depots-pneus/a-relancer`                             | Câblable — reprise identique de `EcheancesAVenir`.                                                                                                                           |
| **Lignes en attente de validation** (elle est souvent celle qui rappelle le client pour un devis complémentaire) | `GET /tableau-bord/activite` → `lignesEnAttenteValidation` | Câblable, même champ que le chef d'atelier — à confirmer avec elle si c'est réellement son geste (persona §3.2 ne le nomme pas explicitement, hypothèse à vérifier terrain). |

3 blocs — les deux premiers sont une reprise à l'identique de l'écran actuel, seul le troisième est
nouveau et marqué incertain.

### 3.5 Magasinier

**Regard du matin** : ce qui manque pour les travaux du jour. Atterrit sur Pièces › Comptoir (son
outil réel) ; ce qui suit est le contenu s'il visite Aujourd'hui.

| Bloc                                                                      | Source                                    | Statut                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Réservations actives** (pièces réservées sur un OR, pas encore remises) | `GET /reservations?statut=active&siteId=` | Câblable, mais **imparfait** : ce n'est pas filtré sur « les travaux du jour » — `FiltresReservations` (`packages/shared/src/contrats/pieces/reservation.ts:62-68`) n'a ni date ni jointure sur la restitution promise de l'OR. C'est la meilleure approximation réelle de « ce qu'il faut préparer », pas une liste scopée à aujourd'hui. |
| **Articles sous seuil de réapprovisionnement**                            | `GET /stock/reapprovisionnement`          | Câblable, déjà compté dans le bloc activité (`articlesSousSeuilReapprovisionnement`) — ici on lui donne la LISTE, pas juste le nombre.                                                                                                                                                                                                     |
| **Jeux de pneus à relancer** (gardiennage facturable)                     | `GET /depots-pneus/a-relancer`            | Câblable, reprise identique.                                                                                                                                                                                                                                                                                                               |

3 blocs.

**Gap signalé** : pour que le premier bloc soit réellement « ce qui manque pour les travaux
d'aujourd'hui » et pas « tout ce qui est réservé et actif, sans date », `GET /reservations` aurait
besoin d'un filtre `restitutionPromiseDu/Au` (jointure sur l'OR porteur) — absent aujourd'hui. À
signaler à `expert-api` si ce bloc doit devenir plus précis qu'une approximation.

### 3.6 Vendeur

**Regard du matin** : ses dossiers qui avancent ou qui dorment. Atterrit sur Ventes › Dossiers (déjà
son plan de travail) ; contenu du dashboard s'il visite Aujourd'hui.

| Bloc                                                                                 | Source                             | Statut                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mes dossiers actifs par étape** (compte `engage`/`en_preparation`/`pret_a_livrer`) | `GET /dossiers-vente?statut[]=...` | **Gap** : `FiltresDossiersVente` n'a pas de champ `vendeurId`/`responsableId` (vérifié dans `dossiers-vente.api.ts` — seuls `siteId`, `statut`, `clientAcheteurId`, `vehiculeId`, `q` existent). Impossible aujourd'hui de scoper « MES dossiers » côté serveur ; un vendeur verrait tous les dossiers du site, pas les siens. À confirmer avec `expert-api`/`expert-metier` si un dossier porte un vendeur responsable dans le modèle — pas trouvé dans `ReponseDossierVente`. |

C'est le seul bloc solide que l'API rend possible aujourd'hui pour lui, et il est lui-même bloqué par
un gap. **Recommandation** : ne pas construire de dashboard vendeur avant que ce gap soit tranché — un
écran avec un seul bloc « tous les dossiers du site, pas les siens » ne serait pas utile et
contredirait son test d'acceptation. Son vrai outil reste `EcranListeDossiersVente`, déjà filtrable par
statut manuellement.

**Gaps supplémentaires, déjà nommés par le plan (§3.6)** et non résolus ici :

- « Dossiers qui dorment » : calculable en théorie depuis les timestamps d'étape déjà présents
  (`prospectionLe`, `engageLe`, `enPreparationLe`, `pretALivrerLe` sur `ReponseDossierVente`) — le
  timestamp de l'étape courante donne une ancienneté — mais aucun tri ni filtre serveur dessus, donc
  faisable seulement en calcul client sur une page déjà chargée, pas comme un signal fiable sur
  l'ensemble du portefeuille.
- Garanties arrivant à échéance : confirmé absent (aucun agrégat tenant, seulement par véhicule).

### 3.7 Technicien

**Regard du matin** : ses lignes assignées, son chronomètre. Atterrit déjà sur Pointage › Mon travail
(`useMesOrdresAssignes`), qui EST son dashboard personnalisé — chronomètre, ses OR, pensé pour lui
dès le premier écran.

**Recommandation** : ne pas construire un second écran dupliquant celui-là. S'il navigue vers
Aujourd'hui (accessible via le menu comme tout rôle non `poste_atelier`), rendre un contenu minimal :

| Bloc                                                                              | Source                                                             | Statut                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mes OR assignés aujourd'hui**, avec statut de ligne visible (bloqué/en attente) | `useMesOrdresAssignes` (déjà construit pour la borne, même source) | Câblable pour le compte. **Même gap F1 que la borne** (plan §3.4) pour le statut de ligne — actuellement affiché en compte seulement, pas en statut détaillé. |

1 bloc — en dessous du plancher de 3 fixé par la consigne, assumé : dupliquer un écran qui existe
déjà et fonctionne bien serait le contraire de « minimaliste ». Question ouverte à trancher avec @laupernoe :
faut-il seulement rediriger `technicien` vers `/pointage/saisie` s'il atterrit sur `/tableau-bord`,
plutôt que de construire un écran quasi-vide ?

### 3.8 Poste_atelier — pas de dashboard

Réponse directe à la question posée : **non**, `poste_atelier` ne doit pas avoir de tableau de bord.
Trois raisons, toutes déjà actées dans le code et la doc existants, pas une nouvelle décision :

1. C'est une borne murale partagée, pas une personne (`atterrissage.ts` : « un appareil, pas un
   employé »).
2. `GET /tableau-bord/activite` l'exclut déjà explicitement côté serveur —
   `ROLES_TABLEAU_BORD_ACTIVITE` ne contient pas `poste_atelier`, avec le commentaire : « la borne
   murale partagée n'a pas d'usage tableau de bord » (`apps/web/src/ecrans/tableau-bord/droits.ts`).
3. Elle atterrit déjà sur `/pointage/borne` et n'a aucune raison de quitter cet écran — un dashboard
   quelconque serait un écran de plus entre le mécanicien aux mains sales et son pointage.

Rien à construire ici. Confirmation, pas de gap.

### 3.9 Admin

**Regard du matin** : peu de chose, structurellement — RF-115 lui interdit tout montant, et son rôle
n'a « aucun plan métier propre » (`atterrissage.ts`). Construire un dashboard « adapté » pour lui ne
veut pas dire lui donner un pilotage financier caché (interdit), mais un pouls système léger et des
raccourcis vers ses tâches réelles.

| Bloc                                                                        | Source                                                                | Statut                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| **OR ouverts aujourd'hui** (quantité seule, aucun montant)                  | `GET /tableau-bord/activite` → `ordresReparationOuvertsPeriode`       | Câblable.                                                   |
| **Articles sous seuil de réapprovisionnement** (quantité)                   | `GET /tableau-bord/activite` → `articlesSousSeuilReapprovisionnement` | Câblable.                                                   |
| **Raccourcis** : créer un utilisateur, gérer les sites, paramétrage atelier | Liens statiques, pas de donnée                                        | Câblable trivialement — ce sont des routes déjà existantes. |

3 blocs, aucun financier.

**Test de non-fuite (F8, `plan-refonte-navigation.md` §3.9) applicable ici** : pour cet écran
précisément, vérifier qu'aucune carte, colonne ou en-tête ne laisse deviner qu'un bloc financier
existe ailleurs pour d'autres rôles — pas de carte grisée « Financier », pas de titre de section vide.
`admin` ne doit voir QUE les trois blocs ci-dessus, jamais une quatrième carte vide à la place du bloc
financier des autres rôles.

## 4. Endpoints manquants — récapitulatif consolidé

| Besoin métier                                                                                                                                         | Rôle(s) concerné(s)                | État                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ventilation de l'encours clients « à échéance » vs « en retard » (au lieu d'un agrégat unique)                                                        | direction, comptable               | **Manquant.** `ReponseFinancierTableauBord.encoursClientsCentimes` est un total unique (déjà signalé dans le plan §3.7). Nécessite soit un champ supplémentaire sur `GET /tableau-bord/financier`, soit une agrégation dédiée sur `GET /documents-vente?enRetard=true`.                                                                                |
| Nombre de factures en retard (pas seulement la liste paginée)                                                                                         | comptable                          | **Manquant.** `PageCurseur` n'expose pas de total ; aucun endpoint de comptage.                                                                                                                                                                                                                                                                        |
| Filtre `restitutionPromiseDu/Au` sur `GET /reservations` (jointure OR)                                                                                | magasinier                         | **Manquant.** `FiltresReservations` n'a ni date ni lien vers la date de restitution de l'OR porteur — le bloc « ce qui manque aujourd'hui » reste une approximation (réservations actives, non datées) sans lui.                                                                                                                                       |
| Filtre `vendeurId`/`responsableId` sur `GET /dossiers-vente`, ou champ équivalent sur `ReponseDossierVente`                                           | vendeur                            | **Manquant, à vérifier au niveau du modèle** — pas trouvé dans le contrat actuel. Bloque tout dashboard vendeur scoping « mes dossiers ».                                                                                                                                                                                                              |
| Agrégat « dossiers de vente inactifs depuis N jours »                                                                                                 | vendeur                            | **Manquant** comme endpoint ; calculable en théorie depuis les timestamps d'étape déjà exposés, mais seulement page par page, pas comme filtre/tri serveur.                                                                                                                                                                                            |
| Échéance MFK agrégée sur le tenant (`prochaineExpertiseLe` sur `VehiculeResume`)                                                                      | direction, chef d'atelier, vendeur | **Confirmé manquant** — déjà signalé dans `EcheancesAVenir.tsx` : le tri existe (`TRIS_VEHICULES`), la valeur à afficher n'existe pas sur la ressource liste.                                                                                                                                                                                          |
| Agrégat « garanties arrivant à échéance » sur le tenant                                                                                               | direction, vendeur                 | **Confirmé manquant** — `garantieConstructeur.finLe` n'existe que sur la fiche d'UN véhicule, aucun endpoint tenant-large.                                                                                                                                                                                                                             |
| Constructeur de chemin `chemins.facturation.liste` avec un filtre/onglet (sur le modèle de `chemins.pneus.aRelancer(site)` qui accepte déjà `onglet`) | direction, comptable               | **Gap de routage front**, pas API : `chemins.facturation.liste` n'accepte aujourd'hui que `site` (`apps/web/src/routes/chemins.ts`). Sans lui, « encours clients cliquable vers Factures en retard » ne peut pas construire son URL cible proprement.                                                                                                  |
| Preuve d'exécution que `enRetard`/`relanceNiveau` sont bien appliqués au SQL, pas seulement acceptés par le contrat                                   | comptable                          | **À vérifier, pas à supposer.** Le contrat les expose (`schemaFiltresDocumentsVente`), mais ce dépôt a un piège documenté et déjà mesuré une fois sur exactement ce type de filtre (`ordreReparationId` accepté et ignoré par le service). Avant de construire le bloc « À relancer », `verificateur-independant` doit le prouver en exécution réelle. |

Aucun widget de ce document ne repose sur les trois premiers gaps sans le signaler dans son propre
tableau — le principe « ne pas concevoir un widget qui exigerait un endpoint inexistant sans le dire »
est respecté ligne par ligne ci-dessus.

## 5. Ce qui disparaît, ce qui est repris, ce qui bouge

| Élément actuel                                                                                       | Devenir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EcranAccueil.tsx` et la route `/` qui le monte                                                      | **Supprimé.** Remplacé par le tableau de bord fusionné et adapté par rôle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CalendrierEcheances` (semaine, restitutions promises)                                               | **Repris**, décliné en deux fenêtres temporelles selon le rôle : vue semaine pour `receptionnaire`, vue jour (« sorties du jour »/« sorties du soir ») pour `chef_atelier`/`direction`. Même endpoint, même composant, prop de fenêtre différente.                                                                                                                                                                                                                                                                                              |
| `EcheancesAVenir` (pneus à relancer)                                                                 | **Repris à l'identique** pour `receptionnaire` et `magasinier`. Écarté pour les rôles où il n'est pas pertinent (direction, comptable, chef d'atelier, admin, vendeur, technicien).                                                                                                                                                                                                                                                                                                                                                             |
| `BlocActiviteTableauBord` (4 indicateurs + répartition statuts + seuil réappro, identique pour tous) | **Démantelé.** Ses champs (`ordresReparationOuvertsPeriode`, `lignesEnAttenteValidation`, `ordresReparationParStatut`, `articlesSousSeuilReapprovisionnement`, `delaiMoyenRestitutionMinutes`) sont redistribués un par un aux rôles pour qui chacun est un signal d'action réel, plutôt que montrés en bloc à tout le monde. `delaiMoyenRestitutionMinutes` n'apparaît plus nulle part dans ce document — aucun rôle ne l'a comme signal quotidien ; à vérifier si direction le veut comme KPI de pilotage mensuel (hors dashboard quotidien). |
| `BlocFinancierTableauBord` (3 montants agrégés, identique direction/comptable)                       | **Repris mais différencié** : direction obtient CA + encours + OR/sorties, comptable obtient encaissements + encours + accès relance — même endpoint, cartes différentes.                                                                                                                                                                                                                                                                                                                                                                       |
| Sélecteur de période (`SelecteurPeriodeTableauBord`)                                                 | **Restreint** à direction et comptable, scopé au seul bloc CA/encaissements — retiré de l'en-tête générique (§2).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Sélecteur de site (`SelecteurSiteTableauBord`)                                                       | **Repris à l'identique**, en-tête commune à tous les rôles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Route `/tableau-bord`                                                                                | Devient la route unique (fusionnée avec `/`) — voir §1 pour la question ouverte sur l'atterrissage.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 6. Notes pour l'implémentation (`expert-react`)

- Le composant hôte lit `session.utilisateur.role` une fois et choisit un tableau de blocs à
  rendre — pas neuf composants d'écran séparés, un seul `EcranTableauBord.tsx` avec une fonction de
  sélection de blocs par rôle (cohérent avec la garde déjà en place sur le bloc financier,
  `peutVoirFinancierTableauBord`).
- Chaque bloc existant (`BlocActiviteTableauBord`, `BlocFinancierTableauBord`, `CalendrierEcheances`,
  `EcheancesAVenir`) doit être décomposé en sous-blocs plus petits et réutilisables plutôt que
  réécrit : ce document redistribue des CHAMPS existants, pas de nouvelles requêtes pour la majorité
  des blocs.
- Respecter la même doctrine « zéro n'est pas une absence de donnée » déjà appliquée dans
  `BlocActiviteTableauBord` (période sans activité = zéro affiché dignement, jamais un état vide) pour
  tout nouveau sous-bloc qui en dérive.
- Le test de géométrie F8 (§3.9) doit devenir un cas de test explicite pour `admin` : rendu de l'écran
  fusionné avec ce rôle, assertion qu'aucun nœud du DOM ne porte de montant ni de carte vide à la
  place d'un bloc financier.
- Pour le bloc « À relancer » du comptable (§3.2) : ne pas l'implémenter avant la vérification
  d'exécution mentionnée en §4 (dernière ligne du tableau).
- Pour le vendeur (§3.6) : ne rien construire avant d'avoir tranché le gap `vendeurId` avec
  `expert-api`/`expert-metier` — un dashboard vendeur mal scopé (tous les dossiers du site plutôt que
  les siens) contredirait le principe même de la demande de @laupernoe.
