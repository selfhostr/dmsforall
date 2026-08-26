Reprendre les données d'un garage — guide
=============================================

Ce guide répond à cinq questions, dans l'ordre où elles se posent : que préparer avant d'aller
chez le garage, ce qui se reprend et ce qui ne se reprend pas, comment se déroule l'import écran
par écran, comment vérifier que le résultat est juste, et que faire quand ça échoue. Il est écrit
pour toi, @laupernoe, en clientèle — vocabulaire garagiste, pas jargon informatique. Les passages entre
guillemets sont des phrases à dire telles quelles.

**Ce que ce guide ne couvre pas** : comment rejouer l'import plusieurs fois sur un tenant de test
pour le prouver avant une vraie bascule — ça, c'est [`harnais-de-test.md`](harnais-de-test.md).
Les onze décisions sur pièces/pneus/ventes/relances sont dans
[`decisions.md`](decisions.md), citées ici, jamais reformulées.

Avant de commencer
-------------------

Trois choses à faire avant même de penser à écrire un import, dans l'ordre qui débloque le plus :

1. **Demande l'export par écrit**, dès le premier contact avec l'éditeur du DMS en place. C'est le
   seul délai qui se compte en semaines et qui ne dépend d'aucun autre travail.
2. **Va sur place, une fois.** Remplis une fiche d'inventaire (quelles tables existent, quel
   volume, quelle qualité), prends un échantillon de 20 lignes par entité. Un nom de table ne
   prouve rien : mesuré sur un vrai garage, un fichier nommé `Autoi.mdb` de 1,3 Go s'est révélé
   être un catalogue tarifaire du constructeur, sans une seule fiche client dedans, pendant que le
   vrai fichier client vivait dans un fichier nommé `RepAw.backup`.
3. **Lis le contrat de licence.** Une clause de reconduction tacite ou de réversibilité peut
   décaler une bascule de six mois — une heure de lecture pour cette information-là.

Sans un vrai export en main, il n'y a rien à mapper : les colonnes que tu vois dans ce guide sont
des rôles fonctionnels (« le champ qui porte le nom du client »), jamais des noms de champs
réels. Chaque garage a les siens.

Ce qui se reprend, et ce qui ne se reprend pas
------------------------------------------------

Le test qui tranche, à répéter pour chaque type de donnée : **« que se passe-t-il le mardi qui
suit la bascule, si cette donnée n'est pas là ? »** Si la réponse est « rien » ou « on la retrouve
dans l'archive », elle ne se reprend pas. Reprendre par réflexe — « on prend tout, comme ça on est
tranquille » — est le premier facteur d'échec de ce genre de projet : ça importe la saleté de
l'ancien système, ça rend la vérification impossible (personne ne relit 400 000 lignes), et ça
fait porter au nouvel outil la réputation de l'ancien.

Voici la version à lire au garagiste avant de signer :

> **On reprend, sans discussion :** vos clients actifs, tous leurs véhicules, qui possède quoi
> aujourd'hui, **toutes vos factures et tous vos avoirs**, vos impayés, les travaux que vos
> clients ont refusés et qui restent à faire, et vos rendez-vous à venir.
>
> **On ne reprend pas, et voici pourquoi :**
>
> | Ce qu'on laisse                                                | Pourquoi                                                                           | Où c'est, si besoin                                                                      |
> | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
> | Fiches clients sans document ni véhicule depuis 5 ans (`D-07`) | Elles encombrent la recherche au comptoir                                          | Archive, retrouvable en 20 minutes                                                       |
> | Historique atelier de plus de 24 mois, en détail (`D-29`)      | Les factures gardent le total et la TVA ; le détail ligne à ligne s'ouvre rarement | Archive + les factures                                                                   |
> | Devis abandonnés (`D-09`)                                      | Aucune valeur légale ni commerciale                                                | Rien                                                                                     |
> | Rendez-vous passés (`D-16`)                                    | Déjà devenus une réparation ou une absence                                         | Rien                                                                                     |
> | Stock de pièces, les quantités (`D-14`)                        | Un stock repris est faux dès le lendemain                                          | Inventaire le jour de la bascule ; vos références et vos prix sont, eux, repris (`D-02`) |
> | Pointages des mécaniciens (`D-10`)                             | Vos indicateurs ne seraient pas comparables entre deux méthodes                    | Ils repartent au jour J                                                                  |
> | Consentements publicitaires (`D-11`)                           | Un consentement se prouve ; importé sans preuve, il est inventé                    | On les redemande                                                                         |
>
> **Ce que ça coûte** : un client de 2016 qui se présente le mardi suivant, tu refais sa fiche
> pendant qu'il te parle. Une à deux fois par mois. **Ce que ça rapporte** : une recherche qui
> trouve du premier coup, des compteurs justes, un import qui se vérifie sur pièces.

La phrase qui emporte la décision, mot pour mot : _« Je préfère vous livrer 3 000 fiches dont je
réponds que 8 000 dont je ne réponds pas. »_

**Le reste du périmètre**, décision par décision, avec son code — cite le code, ne reformule pas
le pourquoi, il est détaillé à la source :

- Clients actifs, horizon 5 ans à confirmer par garage — `D-07`.
- Ordres de réparation : détail sur 24 mois glissants, plus tout l'ouvert sans limite de date
  (factures impayées, OR en cours, véhicules en stock, leasing en cours) — `D-29`.
- En-têtes, totaux et TVA des documents jusqu'à 10 ans, jamais le détail des lignes au-delà de
  l'horizon `D-29` — `D-30`.
- Documents scannés : uniquement s'ils sont rattachables à un client ou un véhicule par un index
  fiable, et dans l'horizon — `D-31`. Le rattachement automatique par nom de fichier ne marche pas
  (taux mesuré entre 0,1 % et 4,2 % sur un garage réel) : il faut une vraie table d'index.
- Comptabilité : jamais, sauf les soldes ouverts (créances, dettes) pour que les relances
  fonctionnent dès le jour J — `D-32`.
- Référentiels constructeur (barèmes de temps, catalogues tarifs) : jamais — régénérés par
  connecteur, pas par une reprise ponctuelle déjà périmée le mois suivant — `D-33`.
- Toutes vos données, même celles qu'on ne reprend pas, partent dans un **paquet d'archive de
  conservation** distinct de l'import : PDF/A + CSV + index + empreintes SHA-256, 10 ans, c'est lui
  qui porte l'obligation légale suisse (art. 957f/958f CO, OELDI) — `D-34`. **À confirmer par la
  fiduciaire du garage avant chaque bascule**, en particulier durée et hébergement : ni ce guide ni
  toi n'êtes son mandataire sur ce point.
- Pièces : catalogue repris (`D-02`), fournisseurs repris en fiche d'identité seule (`D-39`),
  commandes fournisseur encore ouvertes reprises (`D-40`).
- Pneus : dépôts en cours repris, sans leur état d'usure ni leur emplacement de stockage (`D-41`).
- Ventes VN/VO : dossiers ouverts repris avec véhicule et financement, l'organisme de financement
  en nom libre par défaut (`D-42`) ; véhicules de stock encore à vendre repris (`D-43`).
- Relances : rien réactivé automatiquement, mais toute créance déjà relancée côté ancien système
  est signalée sur la facture reprise (`D-45`).

Détail complet de ces onze dernières décisions, options écartées et pourquoi :
[`decisions.md`](decisions.md) (`D-35` à `D-45`). Les décisions plus anciennes (`D-01` à `D-34`,
citées ci-dessus) vivent sur le wiki forge, page `Specifications-specification-reprise-donnees`
et sa méthode détaillée `Specifications-reprise-donnees`.

Ce que l'outillage sait faire aujourd'hui — à dire clairement, pas à cacher
-------------------------------------------------------------------------------

**Trois domaines ont un écrivain réel : clients, véhicules, documents de vente.** Le contrat de
l'écran de validation en propose huit de plus (ordres de réparation, paiements, articles/stock,
fournisseurs, documents scannés, pneus, ventes VN/VO, relances) : ils peuvent apparaître dans le
plan, jamais dans l'import — un domaine sans écrivain est explicitement signalé comme tel
(« écrivain non encore implémenté »), jamais silencieusement ignoré ni faussement marqué réussi.

Concrètement, aujourd'hui : un garage dont l'essentiel de la valeur est dans ses factures et ses
ordres de réparation ne peut pas encore être basculé de bout en bout par cet outil. Ce qui est déjà
solide : la fiche client, le véhicule et sa détention (qui possède quoi, reconstruite par
intervalles même quand une plaque a changé de mains), et l'en-tête d'une facture ou d'un avoir
avec ses totaux (jamais encore le détail ligne à ligne).

**Un mot sur la conception d'origine, pour éviter une confusion en la relisant** : la spécification
de méthode (wiki) décrit un outil en ligne de commande, avec des tables de correspondance dédiées
(`lot_reprise`, `reprise_ligne_source`…). Ce n'est **pas** ce qui a été construit. L'import réel
est un écran de validation piloté par API (voir le parcours ci-dessous), et la correspondance
source → DFA vit directement sur la fiche cible (`client.numero_origine`, `vehicule.numero_origine`,
`document_vente.numero_origine`), pas dans une table à part. Le principe d'idempotence tient
quand même : la base elle-même refuse un doublon de `numero_origine` pour un même tenant, rejouer
un import ne peut donc pas dupliquer une fiche déjà écrite.

Ce que le nLPD change en pratique
-------------------------------------

Trois règles concrètes, pas de la théorie juridique :

- **Les données personnelles reprises restent en Suisse**, du fichier source jusqu'à la base du
  garage — hébergement compris.
- **Les fichiers intermédiaires d'extraction sont chiffrés et détruits après la bascule**, jamais
  laissés « au cas où » sur un poste ou une clé USB. L'archive déposée elle-même est purgée
  automatiquement dès qu'un dossier de reprise est annulé, et l'outillage purge aussi tout résidu
  d'extraction abandonné par un plantage — un répertoire d'extraction ne doit jamais survivre au
  traitement qui l'a créé.
- **Les consentements marketing ne se présument pas** (`D-11`) : sans preuve du consentement
  d'origine, il repart à zéro. Un consentement importé sans preuve est un consentement inventé —
  c'est le garage qui porte le risque, pas l'ancien DMS.

Le paquet d'archive de conservation (`D-34`, ci-dessus) répond à l'obligation légale de
conservation ; il ne dispense pas de ces trois règles, qui portent sur la donnée AVANT et PENDANT
la bascule, pas seulement sur ce qui en sort.

Le parcours, écran par écran
-------------------------------

Le garagiste (ou toi, en démonstration) suit six étapes, dans cet ordre, sans retour en arrière
possible une fois une étape franchie :

1. **Dépôt de l'archive.** Un fichier ZIP contenant l'export du DMS (peu importe le moteur —
   Access, FoxPro, autre — la détection se fait au contenu, jamais à l'extension d'un fichier :
   mesuré, un fichier nommé `RepAw.backup` était une base Access parfaitement valide). Pour une
   grosse archive, le dépôt se fait par petits morceaux — une coupure réseau au milieu reprend là
   où elle s'est arrêtée, sans tout retélécharger.
2. **Analyse automatique.** L'outil ouvre l'archive, reconnaît chaque table (client ? véhicule ?
   facture ? autre chose ?) au CONTENU de ses colonnes — jamais à son nom, qui ment souvent (une
   table appelée « clients » peut être vide, la vraie donnée vivant ailleurs sous un nom sans
   rapport). Quelques minutes sur une grosse archive.
3. **Plan proposé.** Un écran qui dit ce qui SERA importé, domaine par domaine, et ce qui est
   ÉCARTÉ, avec le motif — jamais une table qui disparaît sans explication. Le seul geste possible
   ici : inclure ou exclure un domaine en bloc, pas retoucher le détail d'un mapping.
4. **Validation.** Un clic déclenche l'import dans la foulée — pas de deuxième confirmation
   séparée, parce que ce clic-là est délibérément le seul geste lourd de tout le parcours.
5. **Import.** Écriture réelle dans la base du garage. Un document de vente s'écrit en deux temps
   internes (brouillon, puis émis) — une fois émis, il est verrouillé, une correction ne se fait
   plus que par un avoir, jamais par une nouvelle tentative d'import sur ce document précis.
6. **Rapport.** Combien de lignes sont entrées, combien ont été écartées et pourquoi, les écarts de
   montant éventuels entre la source et ce qui a été écrit — jamais absorbés en silence.

À aucun moment le garagiste ne choisit LE tenant de destination : c'est la session de connexion
qui le détermine, jamais un champ du fichier déposé ni un paramètre d'écran. C'est la garantie que
l'import d'un garage n'écrit jamais chez un autre.

Vérifier que ça s'est bien passé
-----------------------------------

« 8 000 lignes importées » ne prouve rien. La preuve qui compte se construit en trois niveaux, du
moins convaincant au plus convaincant :

1. **Comptage** — aucune ligne perdue en route.
2. **Somme** — les montants n'ont pas été déformés (au centime, jamais une tolérance).
3. **Nominatif** — le système dit vrai sur les clients précis du garagiste. Le seul des trois qui
   emporte l'adhésion.

Les douze contrôles nominatifs, à faire faire par le garagiste lui-même, sur son écran, avec ses
propres exemples :

| Code    | Le garagiste fait                                                              | Ce qui doit être vrai                                                           |
| ------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `CR-01` | Cherche « la dernière facture de M. Rossier » (un vrai client, choisi par lui) | Même numéro, même date, même montant au centime que son papier                  |
| `CR-02` | Cherche une plaque qu'il connaît par cœur                                      | Le bon véhicule, le bon détenteur courant, son historique                       |
| `CR-03` | Ouvre la fiche de son plus gros client                                         | Rabais, délai de paiement, contacts, tous ses véhicules                         |
| `CR-04` | Retrouve 10 factures tirées au hasard dans son classeur papier                 | 10/10, montants identiques au centime, TVA au taux de l'époque                  |
| `CR-05` | Ouvre un véhicule vendu l'an dernier                                           | Détention courante = nouveau propriétaire ; les anciens OR restent sur l'ancien |
| `CR-06` | « Combien de clients as-tu vus en 2025 ? »                                     | Même nombre que l'ancien système, ou écart expliqué ligne à ligne               |
| `CR-07` | Compare le chiffre d'affaires d'un mois passé à celui de la **fiduciaire**     | Écart **0**. Sinon, pas de bascule                                              |
| `CR-08` | Ouvre la fiche d'un client au nom accentué (Müller, Genève) et génère un PDF   | Accents corrects à l'écran ET sur le PDF                                        |
| `CR-09` | Ouvre le carnet de rendez-vous de la semaine prochaine                         | Tous les RDV futurs, au bon jour, au bon véhicule                               |
| `CR-10` | Facture un client fictif de test, puis l'annule par avoir                      | Le numéro suit celui de l'ancien système ; rien ne bouge après émission         |
| `CR-11` | Ouvre un véhicule avec des travaux reportés                                    | Les travaux refusés au dernier passage sont proposés                            |
| `CR-12` | Ouvre un client bloqué ou en litige                                            | L'alerte s'affiche                                                              |

`CR-07` est celui qui vaut tous les autres : il ne vient pas des données elles-mêmes, il compare à
une source tierce (la fiduciaire) qui n'a rien à voir avec la migration.

**Avant de montrer quoi que ce soit**, fais dire au garagiste, sur un papier, devant toi : combien
de clients il pense avoir vus l'an dernier, son chiffre d'affaires, combien de voitures il suit.
Quand les trois chiffres du rapport tombent dans son ordre de grandeur, la conversation est finie
en deux minutes. Quand ils n'y tombent pas, c'est souvent LUI qui a raison sur le sens de l'écart —
et c'est une information de premier ordre sur le fichier source, pas un défaut de l'import.

Les sommes qui doivent tomber exactement à zéro centime d'écart, sans tolérance : le total TTC des
factures par année civile, le total des avoirs par année, le solde des créances ouvertes, l'écart
`Σ lignes − total` par document (rendu visible sur une ligne dédiée, jamais absorbé), et le nombre
de détenteurs courants qui doit égaler exactement le nombre de véhicules repris.

Que faire quand ça échoue
----------------------------

- **L'empreinte ne correspond pas après le dépôt** (`REPRISE_EMPREINTE_INVALIDE`) : l'archive a été
  corrompue en transit. Aucune tranche n'est effacée — redépose seulement les tranches concernées,
  pas tout le fichier.
- **L'analyse échoue** : le dossier reste consultable, relance-la (le contrat le permet
  explicitement depuis `depot_receptionne` ou `analyse_echoue`) une fois la cause traitée.
- **Le plan ne propose rien à importer** : un résultat réel à regarder en face, pas forcément une
  panne — ça peut vouloir dire que l'archive ne contient rien de reconnaissable comme donnée de
  garage (mesuré une fois : un fichier de 1,3 Go qui était en réalité un catalogue tarifaire
  constructeur). Valider un plan vide est refusé par construction.
- **L'import échoue** : le rapport montre ce qui a réellement été écrit avant l'échec — jamais
  masqué en attendant une éventuelle reprise. Le dossier peut être relancé sans redéposer
  l'archive ; ce qui a déjà été écrit ne sera pas dupliqué (l'idempotence est garantie par la base,
  pas seulement par le code).
- **Il faut tout annuler et recommencer** : un dossier peut être annulé tant qu'il n'est pas
  terminé — l'archive déposée est purgée immédiatement, aucune trace ne reste sur disque.
- **Un document est déjà émis et faux** : plus de retour en arrière possible sur CE document —
  correction par un avoir uniquement, exactement comme un document créé normalement dans l'outil.
  C'est pour ça que toute vérification (montants, dates, rattachement client/véhicule) doit être
  complète AVANT de valider le plan, jamais après.

Le jour de la bascule
-------------------------

Deux passes, jamais une bascule directe : d'abord **à blanc**, plusieurs fois, sur un tenant de
test — voir [`harnais-de-test.md`](harnais-de-test.md) — jusqu'à ce que le taux d'anomalies
bloquantes tombe sous 0,1 %. Puis la bascule **réelle**, sur une copie fraîche restaurée, jamais
sur la production de l'ancien système en direct.

Fenêtre visée : zéro minute d'indisponibilité côté DFA le lundi matin. Toute l'indisponibilité
porte sur l'ANCIEN système, contenue dans le week-end : lecture seule dès vendredi soir, import et
recette samedi-dimanche, décision GO/NO-GO écrite et signée au plus tard dimanche 18h — passé cette
heure, NO-GO par défaut, quelle que soit la proximité du but. Pas de double saisie générale une
fois DFA en production : l'ancien système reste en lecture seule 30 jours, contrôle croisé
quotidien (total facturé du jour comparé au ruban de caisse) pendant la première semaine.

Où trouver le détail
-------------------------

- Les onze décisions pièces/pneus/ventes/relances, options écartées incluses :
  [`decisions.md`](decisions.md).
- La méthode complète (investigation terrain, mapping champ à champ, pièges suisses — VIN, plaques
  réattribuées, doublons, particulier/entreprise, runbook heure par heure) : wiki forge, page
  `Specifications-reprise-donnees`.
- Le paquet d'archive de conservation, raisonnement juridique complet : wiki forge, page
  `Specifications-reprise-donnees-archive-conservation`.
- Comment prouver que ce parcours fonctionne, plusieurs garages, plusieurs fois, avant de le
  proposer pour de vrai : [`harnais-de-test.md`](harnais-de-test.md).
