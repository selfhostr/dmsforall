# Décision : référentiel de données véhicules pour la saisie

**Statut** : proposition — décision finale à @laupernoe sur les points marqués « à trancher ».
**Auteur** : expert-métier (agent), 10.08.2026.
**Portée** : d'où vient la liste marque/modèle/finition/motorisation utilisée à la création d'un
véhicule (`EcranNouveauVehicule`, `schemaCreationVehicule`). Aucun code dans ce document.

## 1. Le besoin exact

@laupernoe : « quand on crée le véhicule, ce serait beaucoup plus simple si tu allais chercher sur
internet une liste à jour d'à peu près toutes les marques et tous les modèles [...] tu rentres
quelques lettres et tu as l'autocomplétion de la marque, exactement pareil pour le modèle, puis
la bonne date ou la finition, puis ça trouve la motorisation. »

L'écran existant (`apps/web/src/ecrans/vehicules/EcranNouveauVehicule.tsx`) a déjà les champs
`marque`, `modele`, `version`, `finition`, `vin`, `codeTypeCh`, `plaque`, `canton`,
`premiereMiseEnCirculationLe`, `importe` — tous en saisie libre aujourd'hui. Le champ `codeTypeCh`
existe déjà dans le schéma (`packages/shared/src/contrats/atelier/vehicule.ts`) sans qu'aucun
mécanisme ne l'exploite encore : c'est le bon point d'ancrage, voir §5.

## 2. Contraintes qui écartent des solutions d'emblée

- **nLPD / hébergement CH** : un appel à un tiers à chaque frappe envoie la saisie du garagiste
  hors de l'infrastructure DFA. Toléré seulement si (a) la donnée transmise n'est pas une donnée
  personnelle (une plaque, un VIN, une marque ne sont pas des données personnelles au sens nLPD
  tant qu'ils ne sont pas rattachés à un client identifié dans la requête elle-même) et (b) le
  tiers ne journalise pas la requête de façon exploitable. Une base **embarquée dans notre propre
  Postgres**, alimentée par un import périodique, élimine le sujet complètement — recommandé.
- **Marché suisse** : une base centrée USA (NHTSA) est disqualifiée pour la couverture — confirmé
  ci-dessous, pas supposé.
- **Licence** : aucune dépendance copyleft/propriétaire dans le dépôt (835 paquets vérifiés) — une
  source non commercialement réutilisable est disqualifiée même si techniquement excellente.
- **Fraîcheur** : les modèles changent chaque année ; toute base choisie a besoin d'un mécanisme
  de mise à jour explicite, pas d'un dump figé au jour du build.

## 3. Sources recensées

| Source                                                                                   | Couverture CH/marché                                                                                                                                                                                    | Licence                                                                                                                                                                                                                                                                                                                    | Fraîcheur                                                                                                                                                                                                                                  | Volume/profondeur                                                                                                                                                                                                                                                                                                                                                                                       | Format                                                                                                       | Coût                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ASTRA/OFROU — TARGA, données de réception par type (`opendata.astra.admin.ch/ivzod`)** | **Officielle suisse** — c'est la base légale de l'immatriculation, du contrôle MFK et de la taxe CO₂ en Suisse.                                                                                         | Open Government Data, gratuit, sans inscription ; le portail impose un engagement d'usage « soigneux et responsable ». **Le texte exact des conditions de réutilisation (un des libellés standardisés opendata.swiss) n'a pas pu être récupéré en accès direct (403) — à confirmer avant tout usage commercial, voir §7.** | 3ᵉ génération (dès 1995, la quasi-totalité du parc en circulation) : mise à jour par l'OFROU au fil des homologations. 2ᵉ génération (1985–1995) en Excel. 1ʳᵉ génération (avant 1985) en PDF scannés — non exploitable en autocomplétion. | Plus de 200 000 réceptions par type (3ᵉ génération), fichiers JSON **bilingues DE/FR** (bonus direct pour l'i18n DFA) avec noms d'attributs en anglais, plus export TXT. Contient marque, type, variante, version, et les données techniques d'homologation (cylindrée, puissance, carburant, poids, CO₂) — donc **va jusqu'à la motorisation**, à la différence de la plupart des catalogues gratuits. | Fichiers plats (JSON/TXT/Excel selon génération) à télécharger et importer, pas d'API de requête à la volée. | Gratuit.                                                                                                                                                     |
| **typenscheine.ch (No Broken Code GmbH, CH)**                                            | Suisse — même source de fond (TARGA), reconditionnée avec une interface de recherche (par n° de réception, marque/type, VIN, n° d'homologation UE). Plus de 245 000 réceptions indexées.                | Commercial, offres par abonnement (« Our Plans ») — tarif exact non publié, à demander.                                                                                                                                                                                                                                    | Suit les mises à jour ASTRA.                                                                                                                                                                                                               | Recherche facilitée, mais **pas d'API confirmée** dans le contenu public consulté — probablement un service web à usage manuel, pas un backend d'autocomplétion.                                                                                                                                                                                                                                        | Interface web.                                                                                               | Abonnement, montant à demander au fournisseur.                                                                                                               |
| **TecDoc / TecAlliance (DE)**                                                            | Européenne, standard de fait de l'après-vente automobile en Europe — c'est très probablement ce que Auto-i et Nextlane utilisent en toile de fond.                                                      | Commercial, licence par utilisateur/poste, réductions de volume à partir de 5-10 licences. Grille tarifaire non publiée.                                                                                                                                                                                                   | Continue, alimentée par les constructeurs et importateurs.                                                                                                                                                                                 | Très profond : marque → modèle → type → moteur, avec liaison catalogue pièces (K-Type). Dépasse largement le besoin de ce module.                                                                                                                                                                                                                                                                       | API REST documentée + exports.                                                                               | Sur devis, vraisemblablement plusieurs milliers de CHF/an vu le positionnement du produit (catalogue pièces professionnel, pas juste un référentiel modèle). |
| **Eurotax/Schwacke, aujourd'hui JD Power (siège Suisse, Steinhausen ZG)**                | Suisse et DACH — le standard du secteur pour la valorisation VO et la reprise. Identifie 99 % des véhicules par code d'immatriculation, historique de cote sur 20 ans.                                  | Commercial, API REST (« Autovista API »). Grille tarifaire non publiée.                                                                                                                                                                                                                                                    | Continue, mise à jour marché.                                                                                                                                                                                                              | Très profond, avec valeur résiduelle — dépasse le besoin de ce module (mais recoupe un besoin futur : reprise VO, cote).                                                                                                                                                                                                                                                                                | API REST.                                                                                                    | Sur devis — acteur premium, coût probablement significatif (contrat entreprise, pas un plan self-service).                                                   |
| **NHTSA vPIC (USA, gratuit)**                                                            | **Disqualifiée pour la Suisse** — confirmé : la donnée ne couvre que les véhicules destinés au marché américain ; un véhicule européen non importé aux USA renvoie des résultats très pauvres ou vides. | Domaine public (US Open Data).                                                                                                                                                                                                                                                                                             | Continue.                                                                                                                                                                                                                                  | Très profond pour le marché US.                                                                                                                                                                                                                                                                                                                                                                         | API REST JSON, gratuite, sans clé.                                                                           | Gratuit — mais inutile ici.                                                                                                                                  |
| **Wikidata**                                                                             | Généraliste mondiale, couverture par marque très inégale ; les finitions/motorisations spécifiques au marché suisse (souvent identiques au marché DE/AT) sont rarement saisies à ce niveau de détail.   | **CC0 (domaine public)** — confirmé, la plus sûre de toutes les sources listées ici.                                                                                                                                                                                                                                       | Communautaire, pas de garantie de fraîcheur ni de complétude — un modèle 2026 peut ne pas y être encore.                                                                                                                                   | Marque + modèle globalement correct ; finition/motorisation incomplet.                                                                                                                                                                                                                                                                                                                                  | SPARQL / dumps.                                                                                              | Gratuit.                                                                                                                                                     |
| **Jeux GitHub communautaires** (`open-vehicle-db`, `vehicle-make-model-data`, etc.)      | Marché US à large majorité, licences hétérogènes projet par projet (à vérifier une par une, plusieurs sans licence explicite — donc **non réutilisables** en l'état dans un produit commercial).        | Variable, souvent absente → disqualifiant par défaut.                                                                                                                                                                                                                                                                      | Figée à la dernière contribution, plusieurs projets non maintenus depuis des années.                                                                                                                                                       | Marque/modèle/année, rarement la finition.                                                                                                                                                                                                                                                                                                                                                              | JSON/CSV/SQL.                                                                                                | Gratuit mais risque de licence.                                                                                                                              |
| **CarAPI (commercial, USA)**                                                             | Marché US en priorité ; couverture Europe non vérifiée en profondeur (trims annoncés « 1990-2026 » mais l'échantillon consulté ne prouve pas la couverture des finitions suisses/européennes).          | Commercial, CGU à vérifier avant usage — jeu public accessible sans compte, la production nécessite un plan payant.                                                                                                                                                                                                        | Continue, source revendiquée à jour jusqu'à l'année courante.                                                                                                                                                                              | Marque/modèle/trim/moteur — profondeur correcte pour un marché US.                                                                                                                                                                                                                                                                                                                                      | API REST JSON.                                                                                               | 199 à 299 $/an selon palier — nettement moins cher que TecDoc/Eurotax, mais couverture Suisse non garantie.                                                  |

## 4. Décision

**Recommandation : bâtir le référentiel sur les données ouvertes ASTRA/TARGA, importées et
embarquées dans notre propre base Postgres, avec un import périodique.**

Justification, contrainte par contrainte :

- **nLPD** : résolu — aucun appel externe à la frappe, la donnée vit chez nous.
- **Marché suisse** : résolu au maximum possible — ce n'est pas « une base qui couvre bien la
  Suisse », c'est **la base légale suisse elle-même**. Un véhicule immatriculable en Suisse a par
  définition une réception par type dans TARGA (sinon il ne peut pas obtenir de plaque).
- **Licence** : très probablement favorable (OGD gratuit, sans inscription) mais **non confirmée
  au niveau du texte exact** — voir §7, point à trancher avant tout engagement de développement.
- **Fraîcheur** : alimentée en continu par l'OFROU au fil des homologations ; notre mécanisme de
  mise à jour est un job d'import périodique (mensuel suffit — une réception par type n'apparaît
  pas plus vite que le cycle d'homologation d'un constructeur).
- **Coût** : nul. Comparé à TecDoc ou Eurotax (probablement plusieurs milliers de CHF/an, sur
  devis, non confirmé), c'est un écart budgétaire qui justifie à lui seul de commencer ici et de
  ne considérer un fournisseur payant que si un besoin dépasse ce que TARGA couvre (catalogue
  pièces pour TecDoc, cote de reprise VO pour Eurotax — deux besoins réels mais **différents** de
  celui de ce ticket).

**Ce qui reste en dehors de cette recommandation, sciemment** : TecDoc et Eurotax adressent des
besoins voisins mais distincts (liaison pièces, valorisation VO) qui reviendront probablement dans
la feuille de route (lot 3 Pièces, reprise VO). Ne pas les écarter définitivement — les
re-challenger le jour où ce besoin-là apparaît, avec son propre calcul coût/bénéfice.

## 5. Jusqu'à la motorisation ?

Oui, TARGA le permet — et c'est le point le plus contre-intuitif de cette recherche : la plupart
des catalogues _gratuits_ s'arrêtent au modèle, mais **la base d'homologation, elle, ne peut pas
s'arrêter avant le moteur** — la cylindrée, la puissance, le carburant et les émissions sont
justement ce qu'une réception par type sert à certifier. La profondeur qu'on demande n'est pas un
supplément, c'est la nature même de cette source.

La limite réelle n'est pas la profondeur des données mais l'**ergonomie de la recherche** : TARGA
est structuré autour du numéro de réception par type (le fameux « code type »), pas autour d'un
index texte marque→modèle→finition optimisé pour la frappe. Construire l'autocomplétion demande un
travail d'ETL (regrouper les entrées par marque/modèle/désignation lisible) — un projet
d'implémentation à part entière, mais borné et à coût nul en données.

## 6. VIN vs code type CH — laquelle est la voie courte ?

**Le code type, pas le VIN.** C'est le résultat le plus utile de cette recherche pour l'ergonomie
visée.

- Le VIN encode marque/pays/année de façon standardisée (positions 1-3 et 10), mais le détail
  modèle/finition/moteur (positions 4-9, le « VDS ») est **propriétaire à chaque constructeur** —
  confirmé : aucun registre public ne publie ces tables de décodage constructeur par constructeur.
  Un décodeur VIN générique et gratuit (NHTSA vPIC) ne peut donc bien décoder que les véhicules
  homologués aux USA ; pour un véhicule européen, le résultat est pauvre voire vide. Un décodage
  fiable et profond du VIN pour tout véhicule européen suppose un agrégateur commercial (TecDoc,
  Eurotax, ou des fournisseurs de décodage VIN dédiés) — donc un coût récurrent pour un résultat
  qui reste probabiliste.
- Le **code type CH** (visible sur le permis de circulation suisse, champ déjà présent dans le
  schéma DFA sous `codeTypeCh`) est la clé que le garagiste a **déjà sous les yeux**, et c'est
  exactement la clé primaire de TARGA. Saisir ce code (6 chiffres + 2-3 lettres pour la
  3ᵉ génération) donne un résultat **déterministe**, sans ambiguïté, gratuit — marque, modèle,
  variante, version et motorisation d'un coup, aucune saisie supplémentaire.

Conclusion : le VIN est une piste secondaire (utile en second recours, ou pour une validation
croisée), le code type CH est la voie courte à construire en premier. C'est cohérent avec le fait
que ce champ existe déjà dans le formulaire sans être exploité — quelqu'un avait déjà anticipé ce
chemin.

Cas où ni l'un ni l'autre ne s'applique : un **véhicule importé non encore homologué en Suisse**
(le champ `importe` existe déjà dans l'écran) n'a par définition pas de code type CH. Dans ce cas,
la saisie libre marque/modèle reste le seul recours immédiat — c'est un cas à assumer, pas à
masquer : l'autocomplétion s'améliore pour le cas majoritaire (véhicule déjà ou bientôt
immatriculé en Suisse), pas pour 100 % des cas dès le jour 1.

## 7. Ce qu'il reste à trancher par @laupernoe

1. **Confirmer le texte exact des conditions de réutilisation d'ASTRA/TARGA** avant tout
   développement — je n'ai pas pu récupérer la page de métadonnées opendata.swiss du jeu
   spécifique (403 sur le portail au moment de cette recherche). Les jeux OFROU affichent en
   général un des libellés standardisés (usage libre / usage libre avec mention de la source /
   usage commercial soumis à autorisation) — c'est cette mention précise qu'il faut lire avant
   d'embarquer la donnée dans un produit commercial. Dix minutes de vérification humaine, pas un
   chantier.
2. **typenscheine.ch en achat vs ETL maison** : le même contenu de fond existe déjà retravaillé
   chez un tiers suisse. Si l'ETL maison s'avère plus coûteux que prévu (formats TXT/JSON peu
   documentés, 3 générations à réconcilier), un abonnement à leur service peut être le raccourci —
   à chiffrer une fois l'ETL maison estimé, pas avant.
3. **Granularité de l'autocomplétion marque/modèle pour les imports** (§6, dernier paragraphe) :
   faut-il un second référentiel (Wikidata, gratuit mais moins profond) pour ce cas minoritaire, ou
   la saisie libre suffit-elle indéfiniment ? Proposition : saisie libre pour l'instant, ne pas
   complexifier avant d'observer combien de créations passent réellement par le cas importé.

## 8. Trajectoire proposée

**Phase 1 — le raccourci le plus court, livrable vite** : dans `EcranNouveauVehicule`, un champ
« code type CH » qui, une fois rempli (ou tapé après consultation du permis de circulation), va
chercher en base **locale** (table alimentée par l'import TARGA, pas d'appel réseau à la frappe)
et propose de préremplir marque/modèle/version/finition/motorisation en un seul geste — avec
confirmation explicite du garagiste avant écriture (jamais un remplissage silencieux qui écraserait
une correction volontaire). Prérequis : l'import ETL de TARGA 3ᵉ génération (JSON/TXT, ~200 000
réceptions) dans une table Postgres dédiée, tenue à jour par un job périodique.

**Phase 2 — l'autocomplétion telle que décrite par @laupernoe** : une fois la table TARGA embarquée,
construire dessus l'index marque→modèle→version texte pour l'autocomplétion « à la frappe »
demandée initialement. Coût incrémental faible : la donnée est déjà là, il s'agit d'un index de
recherche par-dessus.

**Phase 3 — au-delà, si le besoin se confirme** : décodage VIN comme recours secondaire (source à
choisir séparément, probablement commerciale, avec son propre calcul coût/bénéfice) ; référentiel
pour les véhicules importés non homologués CH ; réexamen de TecDoc/Eurotax si un besoin de
catalogue pièces ou de cote VO l'exige indépendamment de ce ticket.

## 9. Comportement attendu de la fonctionnalité (à formaliser en règles numérotées à

l'implémentation, non figées ici)

- Un code type CH reconnu dans le référentiel local propose un préremplissage ; le garagiste
  valide ou modifie avant écriture — jamais d'écriture automatique sans passage par l'écran.
- Un code type CH saisi mais absent du référentiel (véhicule pré-1995, erreur de saisie, ou
  réception radiée) ne bloque jamais la création : message informatif, retour à la saisie libre
  existante — cohérent avec le principe déjà en place pour le VIN court (`VEHICULE_VIN_COURT`,
  avertissement en `2xx`, jamais un refus).
- L'autocomplétion marque/modèle (phase 2) est un confort de saisie, jamais une contrainte : un
  garagiste doit pouvoir taper une marque/un modèle absents du référentiel (import rare, erreur de
  frappe volontairement conservée) sans être bloqué — même doctrine que l'existant.
- Le job d'import TARGA est un import de données **de référence**, pas de données personnelles :
  aucun `tenant_id`, table partagée entre tenants (comme un référentiel pays/devise), à la
  différence de tout le reste du modèle de données DFA — à signaler explicitement à
  `expert-database` le jour de l'implémentation pour ne pas lui appliquer RLS par erreur.

## Sources consultées

- [Fahrzeugdaten — ASTRA/OFROU, produits d'information](https://www.astra.admin.ch/astra/en/home/documentation/data-and-information-products/vehicle-information-products.html)
- [opendata.astra.admin.ch/ivzod — répertoire TARGA](https://opendata.astra.admin.ch/ivzod/2000-Typengenehmigungen_TG_TARGA/)
- [typenscheine.ch — Schweizer Typenscheine (No Broken Code GmbH)](https://typenscheine.ch/en)
- [TecAlliance — TecDoc Catalogue](https://www.tecalliance.net/tecdoc-catalogue/)
- [JD Power Eurotax Schweiz — solutions de données](https://eurotax.ch/produkt/datenloesungen/)
- [NHTSA vPIC — Vehicle API](https://vpic.nhtsa.dot.gov/api/) et [FAQ](https://vpic.nhtsa.dot.gov/api/home/index/faq)
- [Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)
- [CarAPI — pricing](https://carapi.app/pricing/)
- [opendata.swiss — Terms of use (cadre général)](https://opendata.swiss/en/terms-of-use)
