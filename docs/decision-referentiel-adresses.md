Décision : référentiel de données d'adresses pour la saisie
===========================================================

**Statut** : proposition — décision finale à @laupernoe sur les points marqués « à trancher ».
**Auteur** : expert-métier (agent), 10.08.2026.
**Portée** : d'où vient la liste NPA/localité/rue utilisée à la saisie d'une adresse (fiche client,
`FormulaireNouveauClient`, `schemaAdresseClientBase`). Aucun code dans ce document — le périmètre
d'écriture de cet agent est ce seul fichier ; `apps/api/src/db/` est verrouillé par l'agent qui pose
le référentiel véhicules en parallèle.

Le besoin exact
----------------

@laupernoe : « on n'aurait pas une base publique de toutes les adresses et les rues de Suisse ? Tu mets le
début du NPA, ça te trouve direct ; le début de l'adresse, ça trouve direct. Et bien sûr, si ça ne
correspond pas, avoir une solution pour mettre manuellement. »

L'écran existant (`apps/web/src/ecrans/clients/FormulaireNouveauClient.tsx`) a déjà les champs
`adressePrincipale.rue`, `.npa`, `.localite`, `.complement`, `.pays` — tous en saisie libre
aujourd'hui, validés uniquement par longueur et par une règle croisée NPA×pays
(`validerNpaSelonPays`, `packages/shared/src/contrats/atelier/client.ts:332-341`). Aucune table de
référence n'existe, aucune clé étrangère vers un registre. C'est le bon point de départ : la saisie
libre qui doit rester ne demande aucune migration de rattrapage, seulement un confort ajouté
par-dessus.

Contraintes qui écartent des solutions d'emblée
-------------------------------------------------

- **100 % gratuit, pas seulement « la plupart des cas »** : La Poste suisse vend des répertoires de
  rues enrichis de données de tri (« Répertoires des rues – avec données de tri »,
  post.ch/kundenadressen-pflegen) — produit commercial, disqualifié d'emblée par la contrainte de
  @laupernoe. Ce n'est même pas nécessaire : la source fédérale gratuite couvre exactement le même besoin
  (voir §3).
- **nLPD / hébergement CH** : résolu par construction si la donnée importée est un référentiel de
  bâtiments/adresses sans rattachement à une personne — **vérifié à la donnée réelle, pas supposé**,
  voir §6. Une base embarquée en Postgres, alimentée par import périodique, élimine tout appel
  réseau à la frappe pour la partie NPA/localité (petit volume, voir §4) ; la partie rues, plus
  volumineuse, passe par un endpoint API interne, jamais par un tiers.
- **Volume gouverne l'architecture, pas la préférence** : mesuré en §4 par téléchargement réel des
  trois jeux de données (pas d'estimation) — les trois n'ont pas la même réponse (navigateur /
  Postgres avec recherche par préfixe / Postgres seul).
- **Saisie libre non négociable** : conséquence de modélisation identique au référentiel véhicules
  (`docs/decision-referentiel-vehicules.md`) — les champs restent du texte libre, un lien optionnel
  vers la fiche du registre au maximum, jamais de FK obligatoire. Voir §8.

Sources recensées
------------------

**Répertoire officiel des localités** (swisstopo, `ch.swisstopo-vd.ortschaftenverzeichnis_plz`)

- Nature : NPA + nom de localité + périmètre + canton, toute la Suisse et le Liechtenstein. Alimenté par les communes et La Poste, publié par swisstopo.
- Licence : **Confirmée** — conditions d'utilisation OGD swisstopo (§5).
- Fraîcheur : Mensuelle selon la fiche produit (non revérifiée sur le PDF technique).
- Format/accès : CSV/GDB/SHP/INTERLIS2, téléchargement direct + API STAC (`data.geo.admin.ch`).
- Coût : Gratuit.

**Répertoire officiel des rues** (swisstopo, `ch.swisstopo.amtliches-strassenverzeichnis`)

- Nature : Tous les noms de rue officiellement déclarés dans le RegBL, avec la commune et le canton.
- Licence : **Confirmée**, même licence.
- Fraîcheur : **Quotidienne** — texte exact swisstopo : « Le répertoire officiel des rues est mis à jour quotidiennement », alimenté chaque jour par l'OFS depuis le RegBL.
- Format/accès : CSV/GDB/INTERLIS2, téléchargement direct + STAC.
- Coût : Gratuit.

**Répertoire officiel des adresses de bâtiments** (swisstopo, `ch.swisstopo.amtliches-gebaeudeadressverzeichnis`)

- Nature : Chaque adresse officielle de bâtiment : rue, numéro, NPA, localité, commune, canton, coordonnées, identifiants EGID/EDID.
- Licence : **Confirmée**, même licence.
- Fraîcheur : **Quotidienne** — même mécanisme que les rues.
- Format/accès : CSV/GDB/INTERLIS2, téléchargement direct + STAC.
- Coût : Gratuit.

**RegBL brut via demande motivée** (`housing-stat.ch`, conditions 2017)

- Nature : Accès aux données complètes du registre (au-delà du niveau A), sur demande écrite motivée, réservé aux administrations/instituts de recherche/tiers mandatés par une administration (art. 15 ORegBL).
- Licence : Gratuit pour les ayants droit de l'art. 15, mais **processus d'autorisation, pas un téléchargement libre**.
- Fraîcheur : Continue côté source, mais accès par lien fourni sous 15 jours ouvrables après validation de la demande.
- Format/accès : Formulaire en ligne, périmètre limité au territoire de l'utilisateur.
- Coût : Gratuit, mais **écarté** : DFA n'entre pas dans les ayants droit de l'art. 15, et le produit swisstopo republié couvre exactement le besoin sans ce processus.

**La Poste CH — répertoires des rues avec données de tri**

- Nature : Rues enrichies de codes de tri postal pour le courrier en nombre.
- Licence : Commercial.
- Fraîcheur : Non vérifiée.
- Format/accès : Fichiers vendus par abonnement.
- Coût : **Payant — écarté**, contrainte §2.

**OpenStreetMap Suisse** (mention, non retenue)

- Nature : Communautaire, couverture bonne en pratique mais non garantie légalement, pas la source faisant foi pour une adresse suisse officielle.
- Licence : ODbL — réutilisation libre mais **share-alike** : toute base dérivée publiée devrait rester sous licence compatible, contrainte que la source officielle n'impose pas.
- Fraîcheur : Continue, communautaire.
- Format/accès : API Nominatim/Overpass, extraits réguliers.
- Coût : Gratuit, mais moins bien disant que swisstopo sur licence (share-alike) et sur légitimité (donnée officielle vs contribution bénévole) — pas retenue comme source primaire.

Volumes mesurés (téléchargement réel des trois jeux, pas une estimation)
------------------------------------------------------------------------

Les trois fichiers CSV (variante Suisse, projection LV95) ont été téléchargés et comptés ligne par
ligne le 10.08.2026 :

**Localités (NPA + nom + périmètre)**

- Lignes : **5 716** lignes, **3 974** codes NPA distincts
- Taille CSV : 492 Ko
- Conclusion : **Vit dans le navigateur** sans problème — plus petit que la plupart des bundles JS déjà servis. Aucune raison de passer par une API pour ce niveau.

**Rues officielles**

- Lignes : **224 838** lignes
- Taille CSV : 24 Mo
- Conclusion : **Trop gros pour le bundle du navigateur tel quel**, largement possible en table Postgres indexée avec recherche par préfixe côté API (même patron que le référentiel véhicules, table de référence sans `tenant_id`). Une variante compressée/allégée pourrait être mise en cache client si le besoin de fonctionner hors-ligne apparaît un jour — pas nécessaire au lancement.

**Adresses de bâtiments** (rue + numéro + NPA + localité + coordonnées + EGID/EDID)

- Lignes : **3 298 882** lignes
- Taille CSV : 447 Mo
- Conclusion : **Postgres exclusivement**, aucun scénario de bundle navigateur. Confirme l'hypothèse de départ de @laupernoe (« deux millions d'adresses non ») — en réalité 3,3 millions, l'ordre de grandeur est le même.

Confirmation de l'intuition de @laupernoe (point 6 de sa demande) : **oui, le NPA et la localité seuls sont
un gain disproportionné pour un coût quasi nul** — 492 Ko à importer une fois, zéro infrastructure de
recherche à construire (un simple index en mémoire ou une petite table suffit), alors que la
correction du couple NPA/localité est l'erreur de saisie la plus fréquente et la plus perturbante
(un NPA existe pour plusieurs localités homonymes dans des cantons différents — ex. plusieurs
communes suisses portent le même nom, seul le NPA ou le canton les distingue sans ambiguïté).

Licence — texte exact vérifié
------------------------------

Source : [swisstopo — Conditions d'utilisation des géodonnées et géoservices gratuits (OGD)](https://www.swisstopo.admin.ch/ogd-conditions),
version 1.3.2021, base légale citée explicitement : Loi fédérale sur la géoinformation (LGéo,
RS 510.62) art. 10ss et Ordonnance sur la géoinformation (OGéo, RS 510.620) art. 20ss. Texte exact
(traduit de la version consultée) :

> « Les géodonnées et géoservices gratuits de swisstopo peuvent être utilisés, distribués et rendus
> accessibles. Ils peuvent en outre être enrichis, retravaillés et également utilisés à des fins
> commerciales. Une mention de la source est obligatoire » — sous la forme « Office fédéral de
> topographie swisstopo » ou « © swisstopo ».

Confirmé pour les trois jeux de données retenus (localités, rues, adresses de bâtiments) : chaque
collection STAC (`data.geo.admin.ch/api/stac/v0.9/collections/...`) pointe vers exactement cette
page de licence via son lien `rel: license`. Réutilisation commerciale explicitement permise,
attribution obligatoire — équivalent en pratique à une licence CC-BY. Aucune ambiguïté restante :
c'est la licence, pas une supposition.

Conformité nLPD — vérifié sur la donnée réelle, pas supposé
-----------------------------------------------------------

L'hypothèse de départ (« ce registre contient des données de bâtiments, pas de personnes ») est
**globalement vraie mais avec une réserve trouvée en creusant les données réelles**, à traiter
explicitement plutôt qu'à balayer :

- Les champs structurants que DFA a besoin d'importer — rue (`STN_LABEL`), numéro (`ADR_NUMBER`),
  NPA (`ZIP_LABEL`), localité/commune (`COM_NAME`), canton (`COM_CANTON`), coordonnées, identifiants
  `EGID`/`EDID` — ne contiennent **aucune donnée personnelle**. Champ vérifié sur les en-têtes réels
  des trois CSV téléchargés, pas sur la documentation marketing.
- **Réserve trouvée en échantillonnant le fichier adresses de bâtiments** : un champ `BDG_NAME`
  (désignation du bâtiment) existe, rempli sur seulement **0,65 % des 3,3 millions de lignes**
  (21 312 lignes). L'écrasante majorité de ces désignations sont des types de bâtiment en langue
  locale (« hangar », « Autorimessa », « Fabbricato rurale », « Alphütte », « Schäferhütte Pedra
  Purtgera », noms de restaurants ou de résidences). **Une valeur de l'échantillon lisait comme un
  nom de personne** (« Chaignat Aimée », probablement une désignation traditionnelle de ferme
  isolée nommée d'après son exploitant — convention connue dans le RegBL rural, pas un fichier de
  personnes physiques). Ce champ n'est de toute façon **d'aucune utilité fonctionnelle pour
  l'autocomplétion d'adresse** (DFA n'affiche jamais le nom du bâtiment dans une fiche client).
  **Recommandation ferme : exclure `BDG_NAME` des colonnes importées.** Ça retire toute ambiguïté
  au lieu de la trancher au cas par cas, pour un champ qui n'apporte rien au besoin.
- Le RegBL n'est de toute façon **pas** le registre de la propriété foncière : le nom du
  propriétaire relève du registre foncier cantonal (accès restreint, tiers différent), pas du RegBL.
  Confusion à éviter mais pas rencontrée dans les données consultées ici — précision utile pour ne
  pas la réintroduire plus tard par erreur de conception.
- Le canal d'accès « RegBL brut sur demande » (§3, ligne écartée) est un système différent, avec ses
  propres niveaux A/B/C et un régime d'autorisation — DFA ne l'emprunte pas, donc ses éventuelles
  données plus sensibles (niveaux B/C) ne sont jamais concernées par cette décision.

**Conclusion** : import limité aux colonnes adresse/localisation strictement définies ci-dessus,
`BDG_NAME` explicitement exclu → aucune donnée personnelle importée, aucun sujet nLPD. Table de
référence partagée entre tenants (comme le référentiel véhicules), pas de `tenant_id`, pas de RLS —
point à signaler explicitement à `expert-database` pour ne pas lui appliquer la politique par défaut
par erreur.

Le geste de saisie — NPA d'abord, dans cet ordre précis
-------------------------------------------------------

Sur une carte grise ou une carte d'identité suisse, l'adresse s'écrit toujours
`NPA Localité` avant `Rue Numéro` dans le bloc adresse (ex. « 1000 Lausanne », puis
« Route de la Blécherette 12 » sur la ligne suivante ou avant selon le document — mais le NPA est
systématiquement la donnée la plus courte et la plus vue en premier par le garagiste qui recopie).
Deux arguments indépendants pointent vers le même ordre, pas seulement l'habitude :

1. **Économie de frappes** : un NPA suisse fait 4 chiffres. Sur 3 974 valeurs distinctes, 4 chiffres
   identifient la localité de façon quasi certaine dès la saisie complète, et resserrent déjà
   fortement la liste dès le 2ᵉ chiffre. Taper le début d'un nom de localité (souvent 8-15
   caractères, ex. « Bettlach », « Château-d'Œx ») demande objectivement plus de frappes pour un
   résultat plus ambigu.
2. **Lever l'ambiguïté que la localité seule ne lève pas** : plusieurs localités suisses partagent
   un nom sans être dans la même commune. Le NPA ou le canton est nécessaire pour distinguer ces
   homonymes ; l'ordre NPA-d'abord évite d'afficher une liste de candidats homonymes au garagiste.

**Séquence proposée** :

1. Le garagiste tape le début du NPA (2-4 chiffres) → liste filtrée en direct sur les 3 974 NPA
   (recherche par préfixe, vit en mémoire côté client, aucun aller-retour réseau nécessaire vu le
   volume).
2. Sélection du NPA (ou de la ligne NPA+localité si un NPA a plusieurs localités rattachées, cas
   réel : « Lausanne 25 », « Lausanne 26 » dans les données) → **préremplissage automatique** du
   champ localité, jamais un remplissage silencieux non confirmé s'il écrasait une valeur déjà
   saisie manuellement (même doctrine que le préremplissage véhicule, §9 de
   `decision-referentiel-vehicules.md`).
3. Le garagiste tape le début de la rue → liste filtrée **sur les rues de la commune déjà
   sélectionnée**, pas sur les 224 838 rues du pays. Exemple mesuré : Lausanne compte 14 555
   adresses de bâtiments dans le registre — filtrer par commune avant de chercher la rue rend la
   recherche par préfixe rapide et quasi jamais ambiguë dès 2-3 caractères.
4. Le numéro reste un champ libre classique (pas d'autocomplétion dédiée — le gain en frappes serait
   marginal pour 1 à 3 caractères, voir §9 phase 3).

Ordre inverse (rue d'abord) rejeté : sans commune connue, une recherche « Bahnhofstrasse » ou
« Rue de la Gare » renvoie des centaines d'homonymes dans tout le pays — pire ergonomie, plus de
frappes nécessaires pour désambiguïser après coup.

Saisie libre — non négociable, même doctrine que le référentiel véhicules
--------------------------------------------------------------------------

- Les champs `rue`, `npa`, `localite`, `complement`, `pays` de `schemaAdresseClientBase`
  **restent du texte libre**, aujourd'hui comme demain. Aucune migration de contrainte NOT NULL
  vers une FK obligatoire.
- Un éventuel lien vers la fiche du registre (NPA/localité sélectionnés depuis la liste, rue
  reconnue dans le répertoire de la commune) est **au plus une référence optionnelle** stockée à
  côté du texte saisi — jamais une clé requise. Elle sert à afficher un badge « adresse reconnue »
  ou à activer un futur usage (géocodage pour la répartition de véhicules de remplacement, par
  exemple) — un confort, jamais une contrainte de saisie.
- Cas qui doivent **toujours** rester possibles sans blocage, comme pour les véhicules importés
  hors référentiel : adresse étrangère (le référentiel ne couvre que CH+LI), case postale, nouveau
  lotissement pas encore déclaré dans le RegBL (le registre est mis à jour quotidiennement mais pas
  instantanément), client de passage dont l'adresse est prise approximativement au téléphone. Dans
  tous ces cas : aucune correspondance trouvée → champs vides, saisie manuelle immédiate, **aucun
  message bloquant**.
- La règle NPA×pays déjà en place (`validerNpaSelonPays`) continue de s'appliquer indépendamment de
  ce référentiel : un NPA suisse mal formé reste refusé par la validation existante, qu'il vienne de
  l'autocomplétion ou de la saisie manuelle.

Trajectoire proposée
---------------------

**Phase 1 — le plus court chemin, le plus gros gain (§4 le confirme : 492 Ko, aucune infrastructure
de recherche à construire)** : importer le répertoire des localités (5 716 lignes, mensuel) dans une
table Postgres de référence partagée (sans `tenant_id`), l'exposer via un petit endpoint de
recherche par préfixe NPA (ou embarquer la liste côté client — le volume le permet aussi, à trancher
avec `expert-api`/`expert-react` selon la latence visée). Câbler le champ NPA de
`FormulaireNouveauClient` pour préremplir `localite` avec confirmation implicite (le garagiste choisit
dans la liste, il n'y a rien à confirmer séparément — contrairement au véhicule où un champ déjà
rempli pourrait être écrasé).

**Phase 2 — l'autocomplétion rue filtrée par commune** : importer le répertoire des rues
(224 838 lignes, mise à jour quotidienne) dans une table Postgres indexée sur `(COM_FOSNR, préfixe
du nom de rue)`. Câbler le champ `rue` pour ne chercher que dans la commune du NPA déjà choisi à
l'étape 1. Coût incrémental : un ETL et un index, la donnée est déjà d'origine fédérale gratuite.

**Phase 3 — au-delà, si un besoin le justifie indépendamment de la saisie client** : le répertoire
complet des adresses de bâtiments (3,3 millions de lignes, mise à jour quotidienne) apporte le
numéro exact, les coordonnées géographiques et les identifiants EGID/EDID. Le gain en frappes sur le
seul champ numéro est marginal (1-3 caractères) — ce n'est **pas** prioritaire pour l'ergonomie de
saisie visée ici. En revanche cette table devient utile le jour où un besoin de géocodage apparaît
(répartition de véhicules de remplacement, calcul de distance client-garage, carte). Proposition :
ne pas l'importer au lancement de ce module, la reconsidérer avec son propre calcul coût/bénéfice
quand un besoin de géocodage se présente.

Ce qu'il reste à trancher par @laupernoe
-----------------------------------

1. **Emplacement de la recherche NPA/localité (phase 1)** : liste embarquée côté client (0 latence,
   0 endpoint, mais 492 Ko à charger et à rafraîchir avec l'app) vs endpoint API de recherche par
   préfixe (cohérent avec le patron déjà utilisé ailleurs, mais un aller-retour réseau par frappe).
   Vu le volume mesuré, les deux sont viables techniquement — c'est un choix d'architecture, pas une
   contrainte de données.
2. **Fréquence réelle de mise à jour du répertoire des localités** : le texte « mensuel » vient
   d'une page indexée (opendata.swiss), pas d'une lecture directe du PDF technique de janvier 2026
   (illisible dans cet environnement — ni `pdftotext`/poppler ni accès `sudo` pour l'installer). À
   reconfirmer avant de figer la cadence du job d'import — dix minutes de vérification humaine sur
   [la fiche produit swisstopo](https://www.swisstopo.admin.ch/fr/repertoire-officiel-des-localites),
   pas un chantier.
3. **Phase 3 (adresses de bâtiments complètes)** : reporter indéfiniment, comme proposé en §9, ou
   la chiffrer dès maintenant si un besoin de géocodage (véhicules de remplacement, carte client)
   est déjà prévu à court terme sur la feuille de route — impacterait l'ordre des lots.
4. **Inclusion du Liechtenstein** : les trois jeux de données couvrent CH+LI nativement (fichiers
   `_li` séparés, quelques dizaines de Ko). Coût d'inclusion nul — à confirmer que c'est voulu (des
   garages proches de la frontière peuvent avoir des clients liechtensteinois).
5. **Table de référence partagée sans `tenant_id`** (§6, dernier paragraphe) : à valider avec
   `expert-database` au moment de l'implémentation, même remarque que pour le référentiel véhicules.

Sources consultées
-------------------

- [swisstopo — Répertoires officiels géographiques](https://www.swisstopo.admin.ch/fr/repertoires-officiels-geographiques)
- [swisstopo — Répertoire officiel des localités](https://www.swisstopo.admin.ch/fr/repertoire-officiel-des-localites)
- [swisstopo — Répertoire officiel des rues](https://www.swisstopo.admin.ch/fr/repertoire-officiel-des-rues)
- [swisstopo — Répertoire officiel des adresses de bâtiments](https://www.swisstopo.admin.ch/fr/repertoire-officiel-des-adresses-de-batiments)
- [swisstopo — Conditions d'utilisation des géodonnées et géoservices gratuits (OGD)](https://www.swisstopo.admin.ch/ogd-conditions) — texte de licence vérifié directement (§5)
- [opendata.swiss — Répertoire officiel des localités avec NPA et périmètre](https://opendata.swiss/fr/dataset/amtliches-ortschaftenverzeichnis-mit-postleitzahl-und-perimeter)
- [opendata.swiss — RegBL, statut du bâtiment](https://opendata.swiss/fr/dataset/eidg-gebaude-und-wohnungsregister-gebaudestatus)
- [data.geo.admin.ch — API STAC](https://data.geo.admin.ch/api/stac/v0.9/) — collections
  `ch.swisstopo-vd.ortschaftenverzeichnis_plz`, `ch.swisstopo.amtliches-strassenverzeichnis`,
  `ch.swisstopo.amtliches-gebaeudeadressverzeichnis` interrogées directement, CSV téléchargés et
  comptés (§4)
- [OFS — RegBL, adresses et coordonnées des bâtiments](https://www.bfs.admin.ch/bfs/fr/home/registres/registre-batiments-logements/adresses-batiments.html)
- [housing-stat.ch — conditions d'utilisation du RegBL (accès brut sur demande)](https://www.housing-stat.ch/files/170701_Conditions_utilisation_RegBL_FR.pdf)
- [La Poste CH — répertoires des rues avec données de tri (produit commercial, écarté)](https://www.post.ch/-/media/post/kundenadressen-pflegen/dokumente/anleitung-strassenverzeichnisse.pdf)
- [Wikidata / OpenStreetMap — mentionnés pour comparaison de licence, non retenus](https://www.openstreetmap.org/copyright)
- `packages/shared/src/contrats/atelier/client.ts` et
  `apps/web/src/ecrans/clients/FormulaireNouveauClient.tsx` — schéma et écran existants, consultés
  via CodeGraph
