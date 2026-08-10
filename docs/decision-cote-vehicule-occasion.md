# Cote de véhicule d'occasion — décision et trajectoire

**Statut** : étude métier, contrainte de départ : **zéro franc**. Pas d'abonnement, pas de licence
payante, pas de « à partir de X CHF/mois ». Eurotax/JD Power est donc hors périmètre d'achat — gardé
ici uniquement pour que @laupernoe sache ce qu'il n'achète pas.

**Demandé par** : @laupernoe. **Sources** : recherche web (voir liens en pied de section), `codegraph_explore`
sur `apps/api/src/db/schema/ventes/{reprise,vehicule-stock}.ts`,
`apps/api/src/db/schema/atelier/vehicule.ts`, `apps/api/src/vehicules/service-vehicule-kilometrage.ts`,
`packages/shared/src/contrats/facturation/document.ts`.

---

## Résumé (≤500 mots)

Sous contrainte de gratuité, trois options existent, et une seule est actionnable.

**Eurotax/JD Power** (référence de la branche, cote sur transactions réelles) : jamais gratuit. Aucun
tarif B2B/API public trouvé — à négocier directement avec JD Power Eurotax Suisse (`eurotax.ch`
redirige aujourd'hui vers `jdpower.com/business`). Seul repère chiffré confirmé : une consultation
individuelle grand public coûte CHF 20–29 via TCS/AutoScout24 — pas un tarif d'intégration. Écarté par
construction sous la contrainte actuelle.

**AutoScout24 et Comparis** : pas de piste gratuite exploitable. Comparis n'a pas de moteur
d'estimation propre — son espace automobile reprend les annonces d'AutoScout24 (partenariat confirmé,
Comparis n'appartient pas à Swiss Marketplace Group). L'estimation gratuite d'AutoScout24 compare à ses
propres annonces, donc des **prix demandés**, pas payés — ce que @laupernoe soupçonnait, confirmé. Aucune API
publique d'estimation trouvée ; l'API officielle existante (« Listing Creation API ») ne gère que la
publication d'annonces et est restreinte à des concessionnaires de marque approuvés. Aspirer les pages
reste techniquement _possible_ — sans avis moral là-dessus — mais AutoScout24 protège son site avec
Akamai Bot Manager (empreinte TLS, défis JS, cookies de suivi) : la même classe de protection que les
grands sites marchands. Un aspirateur casse sans préavis à chaque changement de gabarit, et l'échec est
silencieux (mauvais chiffre rendu, pas d'erreur visible) sauf à construire une validation dédiée. Le
maintenir n'est jamais gratuit : le coût quitte la ligne CHF pour devenir une dette d'ingénierie
continue. Le déclencher pendant qu'un vendeur négocie une reprise, et le voir tomber ce jour-là, est
pire que ne rien avoir. Techniquement jouable, non recommandé sous contrainte de gratuité _réelle_.

**La voie propriétaire** est la seule vraiment gratuite et elle est déjà à moitié construite. `reprise`
capture déjà la valeur estimée, la valeur **réellement négociée**, et leurs horodatages ;
`vehicule_stock` capture le prix d'achat d'entrée et le prix de sortie réel vit sur la facture liée au
véhicule. Il manque cependant des champs bon marché à ajouter _maintenant_ : le kilométrage au moment
précis de la reprise et au moment de la sortie (aujourd'hui un historique générique non rattaché à ces
deux événements), un état structuré du véhicule à la reprise, un motif de refus fermé plutôt que du
texte libre, et la certitude qu'une ligne de facture isole le prix net du véhicule des accessoires/
garantie/frais de dossier. Aucun de ces champs ne coûte rien à ajouter aujourd'hui ; tous coûtent cher
à reconstituer rétroactivement dans deux ans.

Côté sources publiques suisses : TARGA (ASTRA/SIAC-Véhicules, déjà tranché, déjà utilisé via
`codeTypeCh`) donne les caractéristiques techniques exactes, gratuitement. L'open data ASTRA/OFS donne
des statistiques de parc et d'immatriculations — utile pour situer la rareté ou la demande d'un modèle,
jamais un prix. Aucune source publique suisse ne donne un prix de transaction.

**Recommandation** : ne rien acheter, ne rien aspirer. Enregistrer dès maintenant les champs manquants
(coût quasi nul), et construire à court terme un módule d'aide à la décision interne qui affiche au
vendeur les reprises et reventes comparables déjà faites par **son** garage — gratuit, disponible dans
les mois qui viennent, et qui s'améliore seul avec le volume. Une cote maison reste utile en interne
pour décider d'acheter ou non ; elle n'a aucune autorité face au client à la table de négociation, où
Eurotax ou même AutoScout24 continueront de peser davantage qu'un chiffre produit par le vendeur
lui-même.

---

## 1. Ce que le zéro franc écarte : Eurotax / JD Power

Le groupe qui opère Eurotax/Schwacke en Suisse s'appelle aujourd'hui **JD Power** (Eurotax, Schwacke,
Glass's, Autovista regroupés sous une seule marque). Les anciennes pages `eurotax.ch` et
`eurotax.at/dms-integration-*` redirigent désormais (301) vers `jdpower.com/business` — signe d'une
consolidation de marque récente, pas d'un abandon du marché suisse : `jdpower.com/business/autovista-api/`
existe et documente une **API REST** pour l'intégration DMS, avec identification véhicule par code
type/châssis (~99% de couverture annoncée) et 20 ans d'historique de prix.

**Tarif** : non public. La page produit ne publie aucun prix, et l'accès à l'API REST se fait via un
portail d'intégration DMS sur devis. Le seul chiffre confirmé est un prix consommateur, hors sujet
d'intégration : **CHF 20 (membre TCS) à 29 (non-membre)** pour une consultation individuelle en ligne
via TCS ou AutoScout24, valeur indicative de ce qu'une évaluation _unitaire_ pèse aux yeux du marché,
pas un tarif de licence tenant. **À qui écrire** : le formulaire de contact commercial sur
`jdpower.com/business` (Suisse) — aucun autre canal trouvé.

**Ce qui est intégré ailleurs** : les résultats de recherche mentionnent que le DMS Nextlane « Drive »
inclut des interfaces vers des « programmes de calcul de réparation » — Audatex, Eurotax, Auto-i cités
ensemble. **Attention à ne pas confondre** : Eurotax vend à la fois un outil de **chiffrage de
réparation après sinistre** (dans la même famille qu'Audatex) et une base de **valorisation de
véhicule d'occasion** (la cote proprement dite). Les preuves trouvées portent sur la première famille,
pas explicitement sur la seconde. **Non prouvé** : que Nextlane ou Auto-i intègrent la cote de
revente/reprise Eurotax spécifiquement — seule l'intégration au chiffrage de réparation est
documentée. Aucune documentation produit, page technique ou communiqué n'a été trouvé confirmant
l'un ou l'autre point avec précision suffisante pour l'affirmer.

Sous la contrainte actuelle, ce chapitre se referme ici : rien à acheter, rien à négocier tant que le
zéro franc tient.

---

## 2. La voie propriétaire — le cœur de l'étude

C'est la seule option réellement gratuite, parce que la donnée existe déjà comme sous-produit du
travail quotidien du garage. Ni AutoScout24 ni Comparis ne l'ont : ils voient des **prix demandés**
(ce qu'un vendeur espère), jamais des **prix payés**. Un garage qui reprend et revend sait les deux.

### 2.1 Ce que le modèle de données capture déjà

**Table `reprise`** (`apps/api/src/db/schema/ventes/reprise.ts`) — une reprise par dossier de vente :

| Champ                                               | Rôle pour une future cote                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `valeurEstimeeCentimes`                             | Estimation initiale (RV-19) — utile pour mesurer l'écart estimation/négociation dans le temps        |
| `valeurNegocieeCentimes`                            | **Le prix réellement accordé** — c'est la donnée que ni AutoScout24 ni Comparis n'ont                |
| `statut` (estimee → negociee → confirmee / refusee) | Machine à états déjà posée, avec horodatages (`estimeeLe`, `negocieeLe`, `confirmeeLe`, `refuseeLe`) |
| `detteFinancementResiduelleCentimes`                | Contexte de la négociation, pas un signal de valeur marché en soi                                    |
| `motifRefus`                                        | Texte libre aujourd'hui — voir §2.2                                                                  |

**Table `vehicule_stock`** (`apps/api/src/db/schema/ventes/vehicule-stock.ts`) — extension 1:1 de
`vehicule`, une ligne par véhicule mis en stock :

| Champ                                   | Rôle                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `prixAchatCentimes`                     | Recopié de `reprise.valeurNegocieeCentimes` à l'entrée en stock (RV-24) — le prix d'achat réel, quelle que soit la provenance |
| `prixVenteAfficheCentimes`              | **Prix demandé**, pas payé — équivalent interne de ce qu'AutoScout24 voit chez les autres                                     |
| `dateEntreeStock`, `venduLe`, `livreLe` | Datation complète du cycle de stock                                                                                           |
| `joursStock`                            | Dérivé — vitesse d'écoulement, un signal de marché à part entière                                                             |
| `provenance`                            | Distingue reprise / achat particulier / neuf constructeur — essentiel pour ne pas mélanger les familles de prix               |

**Documents de vente** (`packages/shared/src/contrats/facturation/document.ts`) — le **prix réellement
encaissé** vit ici, sur la facture liée à `vehiculeId`, pas sur `vehicule_stock` (qui ne porte que le
prix affiché). `totalTtcCentimes` agrège toutes les lignes du document.

**Fiche technique du véhicule** (`apps/api/src/db/schema/atelier/vehicule.ts`) — déjà riche :
`marque`, `modele`, `version`, `finition`, `codeTypeCh` (TARGA), `date1reCirculation`, `carburant`,
`cylindreeCm3`, `puissanceKw`, `boite`, `couleur`, `poidsVideKg`, `importe`. De quoi apparier des
véhicules comparables dès aujourd'hui, sans rien ajouter.

**Kilométrage** — existe, mais ailleurs et pas rattaché aux bons événements : `vehicule_kilometrage`
(`apps/api/src/vehicules/service-vehicule-kilometrage.ts`) est un historique _append-only_ par
véhicule (`valeurKm`, `releveLe`, `source`, `ordreReparationId`), alimenté typiquement à chaque passage
atelier. Un véhicule repris chez un client qui n'a jamais fait entretenir sa voiture au garage peut
n'avoir **aucun** relevé. Le lien entre « kilométrage au moment de la reprise » et cette table n'existe
pas aujourd'hui.

### 2.2 Ce qu'il manque d'enregistrer dès maintenant

Champ par champ, par ordre de valeur pour une cote future. Chacun coûte une migration additive
aujourd'hui ; aucun ne se reconstitue rétroactivement dans deux ans.

- **RM-COTE-01 — Kilométrage déclaré à la reprise.** Ajouter un champ sur `reprise` (ou une écriture
  systématique dans `vehicule_kilometrage` avec `source = 'reprise'`, si cette valeur d'énumération
  existe déjà — à vérifier). Sans lui, la donnée la plus déterminante d'une cote (après âge/modèle)
  est absente pour tout véhicule jamais entretenu au garage.
- **RM-COTE-02 — Kilométrage au moment de la sortie de stock.** Symétrique côté vente : un relevé
  `source = 'vente'` horodaté à `venduLe`/`livreLe`. Permet aussi de calculer le kilométrage parcouru
  pendant le stockage.
- **RM-COTE-03 — État général structuré à la reprise.** Un jeu de valeurs fermées minimal (carrosserie,
  intérieur, pneus : bon/moyen/mauvais) plus un commentaire libre. Sans lui, un véhicule accidenté
  repris à bas prix et un véhicule sain repris au même âge/kilométrage sont indiscernables dans les
  données — ils fausseraient également une cote calculée sur cet historique.
- **RM-COTE-04 — Motif de refus fermé.** `reprise.motifRefus` est du texte libre aujourd'hui. Une
  liste fermée (prix jugé trop bas / véhicule vendu ailleurs entretemps / client garde son véhicule)
  évite de polluer un futur modèle avec des refus qui n'ont rien à voir avec le prix proposé.
- **RM-COTE-05 — Isolement du prix net véhicule sur la ligne de facture.** À vérifier dans
  `TypeLigneDocumentVente` (non consulté en détail ici) : une ligne de type « véhicule » doit isoler
  le prix net du véhicule des accessoires, de la garantie et des frais de dossier. Sans cette
  distinction, `totalTtcCentimes` du document n'est pas un prix de vente net exploitable — il mélange
  le prix de la voiture et des prestations annexes.
- **RM-COTE-06 — Canal de sortie.** Distinguer une vente comptoir classique d'une éventuelle sortie de
  gros (enchère B2B/C2B type AutoScout24 Direct, export) si ce canal est un jour utilisé. Sans lui,
  des prix de gros, structurellement plus bas, pollueraient une cote destinée au client final.

Ce qui est **déjà suffisant**, à ne pas retoucher : l'horodatage complet du cycle de reprise
(`estimeeLe`/`negocieeLe`/`confirmeeLe`) et du cycle de stock (`dateEntreeStock`/`venduLe`/`livreLe`),
la distinction estimé/négocié, et la richesse de la fiche technique.

---

## 3. Sources publiques gratuites — situer sans donner le prix

- **TARGA (ASTRA/SIAC-Véhicules)** — déjà tranché dans DFA, déjà utilisé (`vehicule.codeTypeCh`).
  Donne les caractéristiques techniques exactes par code type, gratuitement, avec l'autorité d'une
  source fédérale. Ne donne jamais un prix.
- **Open data ASTRA** (`opendata.astra.admin.ch/ivzod`) — jeux de données anonymisés sur le parc
  automobile et les nouvelles immatriculations. Utile pour situer la rareté ou la popularité d'un
  modèle (ex. volume de nouvelles immatriculations par mois), pas un signal de prix.
- **OFS/BFS** (`bfs.admin.ch`, portail `opendata.swiss`) — statistiques de parc et de mises en
  circulation au niveau national. Même limite : macro, pas de prix par véhicule.

**Constat net** : aucune source publique suisse ne fournit un prix de transaction, réel ou demandé.
Le seul chemin vers un prix reste soit payant (Eurotax), soit privé au garage (la voie propriétaire),
soit une agrégation d'annonces tierces (fragile, voir §4).

---

## 4. L'aspiration AutoScout24/Comparis — ce qui est techniquement vrai

@laupernoe a tranché que la légalité n'est pas un blocage à ce stade ; ce qui suit ne porte que sur la
faisabilité et le coût techniques.

**Comparis n'apporte rien de plus qu'AutoScout24.** L'espace automobile de Comparis est un partenariat
qui reprend les annonces d'AutoScout24 — Comparis n'a pas de moteur d'estimation propre, et n'est pas
dans le même groupe (Swiss Marketplace Group réunit AutoScout24, Ricardo, Homegate, etc. ; Comparis en
est un partenaire externe). Aspirer les deux revient à aspirer une seule et même source.

**Pas d'API d'estimation officielle.** L'API publique d'AutoScout24 documentée (« Listing Creation
API ») gère la publication et la gestion d'annonces, pas l'estimation, et son accès est **restreint à
un groupe de concessionnaires de marque approuvés** — donc de toute façon hors de portée pour un
éditeur DMS tiers non affilié. Aucune trace d'un produit « valuation API » public.

**La protection technique est réelle et coûteuse à contourner.** AutoScout24 utilise Akamai Bot
Manager : empreinte TLS, défis JavaScript, paire de cookies de suivi anti-bot (`_abck`/`ak_bmsc`).
C'est la même classe de protection que les grands sites marchands emploient contre le scraping à
l'échelle — suffisamment robuste pour avoir fait naître un marché entier de services de scraping
commerciaux payants spécialisés sur ce site précis. Concrètement :

- Un scraper artisanal casse **sans préavis** à chaque changement de gabarit HTML, et l'échec est
  **silencieux** : il ne lève pas d'erreur, il rend un chiffre obsolète ou faux, sauf à construire une
  validation explicite (contrôle de plausibilité, alerte sur échec de parsing) — un coût de conception
  supplémentaire, pas gratuit non plus.
- Le maintenir « gratuitement » ne l'est pas en pratique : le coût quitte la ligne budgétaire pour
  devenir une dette d'ingénierie continue, imprévisible dans son rythme.
- Le scénario que @laupernoe redoute — la cote qui tombe un mardi matin pendant qu'un vendeur négocie une
  reprise — n'est pas un risque marginal : c'est le mode de défaillance normal d'un système qui dépend
  d'un frontend qu'on ne contrôle pas.

**Verdict technique, sans jugement de légalité** : jouable à court terme pour un prototype interne
jetable ; pas raisonnable comme fondation d'une fonctionnalité produit exposée aux vendeurs et aux
clients en négociation, sauf à accepter d'y consacrer une charge de maintenance récurrente équivalente
à ce qu'un abonnement Eurotax coûterait autrement — ce qui annule l'argument du zéro franc.

---

## 5. Ce qu'on offre au vendeur en attendant

**Aujourd'hui : saisie manuelle de `valeurEstimeeCentimes`.** Tenable à très court terme (le vendeur
sait généralement estimer un véhicule courant), intenable comme différenciateur : c'est exactement ce
qu'Auto-i et Nextlane font déjà, sans plus-value.

**Amélioration à coût nul, réalisable maintenant, sans dépendance externe** : à l'écran de saisie de
la reprise, afficher les **reprises et reventes comparables déjà faites par ce garage** — même
marque/modèle/version, tranche d'âge et (dès RM-COTE-01/02 posés) tranche de kilométrage proches.
Concrètement :

- Une requête sur `reprise` (jointe à `vehicule`) filtrée par marque/modèle/version : « 3 reprises
  comparables ces 12 derniers mois, valeur négociée entre X et Y CHF ».
- La même chose côté sortie, sur `vehicule_stock` + facture liée : prix de vente net moyen, délai
  d'écoulement moyen (`joursStock` existe déjà comme champ dérivé).
- Si le véhicule repris a déjà été entretenu dans ce garage, afficher son historique
  `vehicule_kilometrage` directement à l'écran de reprise, pour éviter une ressaisie et fiabiliser la
  valeur déclarée par le client.

Ce n'est pas une cote au sens Eurotax — juste un rappel de ce que **ce garage** a lui-même payé et
revendu pour des véhicules proches. C'est disponible dans les mois qui viennent, sans aucun coût
externe, et s'améliore automatiquement à mesure que le volume de données (dix garages) grandit.

---

## 6. Le point d'honnêteté : une cote maison a-t-elle une autorité ?

Non, pas face au client. Un garagiste qui annonce « 12 400 selon Eurotax » cite un tiers que le client
perçoit comme neutre, aussi imparfait que soit ce tiers en réalité (cote sur transactions, mais
methodology opaque pour le client). « 12 400 selon le logiciel du garage » n'a structurellement aucune
neutralité aux yeux du client : c'est le vendeur qui a écrit son propre chiffre de référence, et un
client informé le sait — même AutoScout24 (prix demandés, pas payés) garde plus d'autorité perçue
qu'un outil interne, simplement parce que c'est un tiers.

Deux usages, deux valeurs différentes :

- **En interne, pour décider d'acheter ou non une reprise et à quel prix** : la voie propriétaire est
  _supérieure_ à un argus générique, parce qu'elle reflète ce que ce garage précis a réellement payé
  et revendu sur son marché local — un signal plus juste qu'une moyenne nationale.
- **À la table de négociation, comme argument face au client** : aucune valeur ajoutée face à Eurotax
  ou même à un prix AutoScout24 que le client aura de toute façon déjà consulté lui-même.

Conséquence pour la feuille de route : construire l'outil interne maintenant, ne jamais le présenter
au client comme une « cote » au sens marketing du terme — c'est un outil d'aide à la décision du
vendeur, pas un argument de négociation externe.

---

## 7. Trajectoire recommandée

1. **Maintenant, coût nul** : garder la saisie manuelle, mais poser les champs manquants du §2.2
   (RM-COTE-01 à 06) dans les prochaines migrations du module ventes. Coût marginal aujourd'hui, non
   reconstituable dans deux ans.
2. **Court terme (prochains mois), coût nul** : livrer le rappel de comparables internes du §5 —
   valeur immédiate pour le vendeur, aucune dépendance externe, s'améliore avec le volume.
3. **Plus tard, si le volume le justifie** : un module d'aide à la décision interne un peu plus
   élaboré (fourchette calculée sur les comparables, jamais affichée comme une cote unique et
   autoritaire) — à spécifier une fois RM-COTE-01/02 en production depuis assez longtemps pour avoir
   des données.
4. **Hors périmètre tant que le zéro franc tient** : Eurotax/JD Power (achat), aspiration
   AutoScout24/Comparis (maintenance continue non gratuite en pratique). Les deux options restent
   documentées ici si la contrainte de gratuité est un jour levée pour les cas de négociation
   contentieuse.

---

## Sources consultées

- [Autovista API - JD Power](https://www.jdpower.com/business/autovista-api/)
- [DMS integration portal - JD Power Schwacke](https://schwacke.de/dms-integration-portal-de-at/)
- [Data Feeds & Solutions - JD Power](https://www.jdpower.com/business/data-feeds-solutions/)
- [Estimation d'un véhicule avec Eurotax - TCS](https://www.tcs.ch/fr/tests-conseils/conseils/achat-vente-vehicule/evaluation-eurotax-occasion.php)
- [Drive DMS - Nextlane](https://www.nextlane.com/product/drive/)
- [Nextlane - solutions DMS](https://www.nextlane.com/solutions/dealership-management-system-en/)
- [Estimation voiture gratuite - AutoScout24](https://www.autoscout24.fr/evaluation-du-vehicule/)
- [Conseils : estimation de la valeur - AutoScout24](https://www.autoscout24.be/fr/informer/conseils/a-propos-des-couts/evaluation-du-prix/)
- [Comparis, partenaire AutoScout24 pour la vente automobile](https://en.comparis.ch/carfinder/autokaufen/autoscout24)
- [AutoScout24 lance le service C2B AutoScout24 Direct - Swiss Marketplace Group](https://swissmarketplace.group/media-release/autoscout24-lanciert-neuen-service-autoscout24-direct/)
- [Swiss Marketplace Group — Wikipédia](https://fr.wikipedia.org/wiki/Swiss_Marketplace_Group)
- [ASTRA — données relatives aux véhicules](https://www.astra.admin.ch/astra/en/home/documentation/data-and-information-products/vehicle-information-products.html)
- [ASTRA — jeux de données TARGA](https://www.astra.admin.ch/dam/astra/fr/dokumente/abteilung_strassenverkehrallgemein/Informationsprodukte/informationsprodukte_typengenehmigungsdaten.pdf.download.pdf/Vue%20d%E2%80%99ensemble%20produits%20d%E2%80%99information%20r%C3%A9ceptions%20par%20type.pdf)
- [OFS — Open Government Data](https://www.bfs.admin.ch/bfs/fr/home/services/ogd.html)
- [OFS — véhicules routiers, parc et taux de motorisation](https://www.bfs.admin.ch/bfs/fr/home/statistiques/mobilite-transports/infrastructures-transport-vehicules/vehicules/vehicules-routiers-parc-taux-motorisation.html)
- [How to Scrape AutoScout24 in 2026 - Scrapfly](https://scrapfly.io/blog/posts/how-to-scrape-autoscout24)
- [How to scrape AutoScout24 in 2026: 3 working methods - RoundProxies](https://roundproxies.com/blog/scrape-autoscout24/)

**Ce qui n'a pas pu être prouvé, à noter explicitement** :

- Le tarif B2B réel d'Eurotax/JD Power pour une intégration DMS (par requête, par utilisateur, par
  tenant) — aucune page publique ne le publie ; seule une démarche commerciale directe le révélerait.
- Que Nextlane et/ou Auto-i intègrent spécifiquement la **cote de revente/reprise** Eurotax — les
  preuves trouvées portent sur l'intégration à des outils de **chiffrage de réparation** (même famille
  de marque, produit différent).
- L'existence d'une offre AutoScout24 ou Comparis dédiée aux garages pour une estimation en marque
  blanche (au-delà de la publication d'annonces et du programme C2B AutoScout24 Direct, dont les
  conditions d'accès et le coût n'ont pas été vérifiés en détail).
