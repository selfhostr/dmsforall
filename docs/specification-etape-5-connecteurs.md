# Spécification étape 5 — Connecteurs

> **Statut de ce document** : spécification métier de la dernière étape de la feuille de route.
> **Rien n'existe encore côté connecteurs externes** hors l'export WinBIZ (étape 2, déjà livré et
> documenté dans `docs/exports-fiduciaires.md`). Ce document ne le réécrit pas : il dit ce qui
> manque autour, et couvre les cinq autres familles de connecteurs listées dans la feuille de route
> (`ARCHITECTURE.md` §5-6) : constructeurs (OEM), plateformes d'annonces, banques, fournisseurs de
> pièces, contrôles/administration.
>
> **Règle de rédaction, non négociable** (rappel du même principe que `docs/exports-fiduciaires.md`
> `EF-*`) : **aucun détail technique de protocole n'est inventé.** Pas de nom de champ, pas de
> format de fichier, pas d'URL, pas de nom d'endpoint que je n'aurais pas vérifié dans une
> documentation lue. Là où je ne sais pas comment un tiers expose ses données, je l'écris — c'est une
> information utile. Une invention ne l'est pas, et ce dépôt a déjà dû jeter une spécification
> construite sur des suppositions.

**Convention** : `RC-xx` = règle métier testable (« connecteurs »), `CC-xx` = cas de test métier,
`PC-xx` = point de paramétrage (varie d'un garage à l'autre, ne jamais coder en dur), `QC-xx` =
question ouverte à poser à @laupernoe ou au terrain. **[À VALIDER]** marque une hypothèse métier à
confirmer ; **[INCONNU]** marque un point technique qu'aucune source lue ne permet d'affirmer.
Préfixes déjà pris ailleurs dans le dépôt et donc évités ici : `RM`/`CT` (étape 1), `RF`/`CF`/`MD`/
`PF`/`QF` (étape 2), `RP`/`CP`/`PP`/`QP` (étape 3), `RV`/`CV`/`PV`/`QV` (étape 4), `EF` (exports
fiduciaires).

| §                                                                           | Contenu                                                                          | Identifiants      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------- |
| [1](#1-principe-transversal--un-connecteur-nest-jamais-une-dépendance-dure) | Principe transversal : panne, source de vérité, idempotence, nLPD                | `RC-01` → `RC-19` |
| [2](#2-constructeurs-oem)                                                   | Constructeurs (OEM) : pièces, garanties, campagnes, forfaits MO, immatriculation | `RC-20` → `RC-39` |
| [3](#3-plateformes-dannonces)                                               | AutoScout24 et plateformes d'annonces                                            | `RC-40` → `RC-49` |
| [4](#4-fiduciaires--ce-qui-manque-autour-de-lexistant)                      | Fiduciaires — ce qui manque autour de l'existant                                 | `RC-50` → `RC-59` |
| [5](#5-banques--rapprochement-camt054)                                      | Banques — rapprochement camt.054                                                 | `RC-60` → `RC-69` |
| [6](#6-fournisseurs-de-pièces)                                              | Fournisseurs de pièces (Derendinger, Technomag, ESA…)                            | `RC-70` → `RC-79` |
| [7](#7-contrôles-et-administration)                                         | MFK, offices cantonaux                                                           | `RC-80` → `RC-89` |
| [8](#8-cas-de-test-métier-transversaux)                                     | Cas de test métier                                                               | `CC-01` → `CC-16` |
| [9](#9-paramétrage)                                                         | Paramétrage par garage                                                           | `PC-01` → `PC-10` |
| [10](#10-ce-qui-doit-remonter-à-laupernoe)                                        | **Ce qui doit remonter à @laupernoe**                                                   | `QC-01` → `QC-20` |

---

## 1. Principe transversal — un connecteur n'est jamais une dépendance dure

Ce paragraphe s'applique aux six familles de connecteurs qui suivent. Il n'est pas répété
domaine par domaine ; chaque section renvoie ici et ne précise que ses écarts.

**`RC-01` — Un garage ne s'arrête pas parce qu'un portail externe ne répond pas.** Aucune opération
métier essentielle — ouvrir un OR, facturer, encaisser, vendre un véhicule, sortir une pièce du
stock — ne peut avoir pour condition la disponibilité d'un connecteur. C'est le principe fondateur
de toute cette étape, et il prime sur tout le reste : un connecteur accélère ou fiabilise un geste
qui reste possible à la main.

**`RC-02` — Aucun geste métier bloquant ne doit attendre une réponse d'un tiers en synchrone.**
Tout appel sortant qui n'est pas immédiatement nécessaire à l'écran affiché (publier une annonce,
transmettre une commande fournisseur, envoyer un export) passe par la file de jobs (BullMQ, déjà en
place pour les imports/exports — `ARCHITECTURE.md` §3) et non par un appel bloquant dans la requête
HTTP qui sert l'utilisateur.

**`RC-03` — Chaque connecteur a un état visible, pas seulement des journaux techniques.** Un
utilisateur du garage (souvent le magasinier ou le vendeur, jamais un informaticien) doit pouvoir
voir, sans ouvrir de log : configuré ou non, dernier échange réussi et quand, en échec et depuis
quand. Sans cet état visible, un connecteur en panne depuis trois jours n'est découvert que par
l'absence du résultat attendu — un devis reçu sans réponse constructeur, une annonce qui n'apparaît
jamais.

**`RC-04` — Tout échange asynchrone en échec est réessayé avec un espacement croissant, puis
retombe en attente d'action humaine.** Un connecteur qui échoue silencieusement en boucle n'est pas
acceptable ; un connecteur qui alerte à la première tentative ratée sur un tiers connu pour ses
pannes de nuit ne l'est pas non plus. Le nombre de tentatives et le délai avant bascule en
« nécessite une action » sont **paramétrables par connecteur** (`PC-01`), pas codés en dur.

**`RC-05` — Source de vérité : principe général, affiné par domaine plus loin.** Sur tout ce que DFA
vend ou facture au nom du garage (prix affiché, statut d'un véhicule en stock, contenu d'une
facture), **DFA reste la source de vérité** — un flux entrant ne l'écrase jamais silencieusement.
Sur tout ce qu'un tiers détient exclusivement (référentiel technique constructeur, cote de reprise,
solde bancaire réel), **le tiers est la source de vérité** — DFA l'importe, ne le recalcule pas et
ne le corrige pas de son propre chef. Le désaccord entre les deux n'est **jamais résolu par un
écrasement automatique** : il est signalé à un humain qui tranche. Chaque section ci-dessous précise
qui gagne dans son domaine, parce que la réponse n'est pas la même pour un prix pièce (§6) et un
avis de crédit bancaire (§5).

**`RC-06` — Idempotence sur toute création sortante sensible.** Le dépôt applique déjà cette règle
aux factures, paiements et exports comptables (`MD-91`, `RF-109`, prouvée en migration). Elle
s'étend ici à toute action qui, répétée par erreur après un timeout ou une reprise de job, créerait
un doublon coûteux côté tiers : publier une annonce une seconde fois, transmettre deux fois la même
commande fournisseur ou constructeur, réimporter deux fois le même fichier bancaire. Chaque
connecteur porte donc une clé d'idempotence stable côté DFA (l'identifiant du document ou de la
ligne qui a déclenché l'envoi), vérifiée avant tout envoi sortant.

**`RC-07` — nLPD : tout flux sortant vers un tiers est un flux à documenter, pas une évidence.**
L'hébergement de DFA est en Suisse par choix délibéré (`ARCHITECTURE.md` §1). Chaque connecteur fait
sortir des données vers un tiers dont l'hébergement n'est pas garanti suisse — c'est **le cas par
défaut à vérifier**, pas l'exception : un portail constructeur, une plateforme d'annonces adossée à
un groupe international, un fournisseur de pièces, hébergent où ils veulent. Deux règles en
découlent : (1) **minimisation** — un connecteur n'envoie que ce que sa fonction exige (un VIN et
une plaque pour une commande de pièce, pas l'historique de facturation du client) ; (2) **traçabilité
par tenant** — quel connecteur, activé par quel tenant, envoie quel type de donnée, doit pouvoir se
répondre sans relire le code. Ce paragraphe pose le principe ; l'inventaire précis (quel tiers,
quel pays héberge réellement) est une question ouverte par connecteur (`QC-*`), pas une affirmation.

**`RC-08` — Identifiants et secrets d'accès sont par tenant, jamais partagés.** Un identifiant de
portail constructeur, une clé API AutoScout24, un accès EBICS bancaire appartiennent au garage, pas
à dmsforall. Leur stockage suit les mêmes exigences que tout secret applicatif (chiffrement au
repos, jamais en clair dans un journal) — détail d'implémentation hors du périmètre métier de ce
document, à porter par `expert-devops`/`expert-auth`.

---

## 2. Constructeurs (OEM)

C'est, par construction, le connecteur le plus lourd et le plus hétérogène : chaque marque a son
propre portail, son propre format, son propre calendrier d'agrément (`ARCHITECTURE.md` §5, phase 3
— « au rythme des agréments obtenus »). Ce paragraphe ne prétend décrire aucun portail précis ; il
décrit ce qui est **commun à toutes les marques au niveau du besoin métier**, parce que c'est ce
niveau-là que l'interface stable (`OrderProvider`, `PartsCatalogProvider`, `VehicleReferenceProvider`
— `ARCHITECTURE.md` §5) doit couvrir sans connaître aucune marque.

**Point d'ancrage important** : l'étape 1 a déjà modélisé côté DFA les objets que ce connecteur doit
nourrir — il ne les invente pas. Une **campagne constructeur** (`RM-30`) porte déjà un code, une
description, un caractère obligatoire/optionnel. Une **ligne d'OR** a déjà une origine `campagne` ou
`garantie` (`RM-64`). Un **payeur constructeur** porte déjà un code défaut, un code opération, un
numéro de campagne ou de dossier de garantie, et un temps barémé constructeur distinct du temps
barémé client (`RM-69`). **Le rôle du connecteur OEM n'est donc pas de créer un nouveau modèle, mais
de peupler et de faire vivre ces champs sans saisie manuelle.**

### 2.1 Les cinq besoins communs, marque par marque différents dans leur forme

**`RC-20` — Commande de pièces d'origine.** Le constructeur (via son importateur national) est,
pour une grande partie du parc, le fournisseur de référence des pièces d'origine — c'est un cas
particulier du fournisseur de pièces générique (§6), mais avec un réseau fermé propre à la marque
(codes atelier, tarifs négociés par le contrat de concession). **[INCONNU]** : aucun format de
catalogue ou d'API de commande constructeur n'est vérifié à ce stade — à obtenir marque par marque
auprès de chaque importateur, jamais deviné par analogie avec une autre marque.

**`RC-21` — Garanties.** Déclarer un sinistre garantie, constituer le dossier, obtenir
l'autorisation puis le remboursement. C'est le prolongement direct de `RM-69` : le connecteur
transmet ce que la ligne payeur `constructeur` contient déjà (code défaut, code opération) et
rapatrie un statut de dossier (accepté, refusé, en instruction) et, le cas échéant, un montant
remboursé qui peut différer du montant facturé au tarif garage (`RC-24`).

**`RC-22` — Campagnes de rappel.** Deux flux distincts, à ne pas confondre : (a) **la liste des
campagnes ouvertes pour un VIN donné arrive dans DFA** — soit par consultation à la demande (le
technicien interroge le VIN), soit par import périodique du référentiel constructeur ; (b) **la
preuve que le travail a été fait repart vers le constructeur**, parce qu'une campagne de sécurité
obligatoire engage la responsabilité du réseau, pas seulement celle du garage (`RC-32`).

**`RC-23` — Forfaits de main-d'œuvre / temps barémés.** Le référentiel des temps constructeur
(combien de temps un forfait X paie, indépendamment du temps réel passé) est un référentiel versionné
dans le temps — un tarif change, et l'OR doit rester rattaché à la version en vigueur à sa date, pas
à la version courante au moment de la facturation (`RC-25`). C'est la même logique de versionnement
que le mapping comptable des exports fiduciaires (`EF-05`), appliquée à un autre domaine.

**`RC-24` — Remontée d'immatriculation.** Quand un véhicule change de détenteur ou est vendu, le
constructeur tient son propre registre de parc et peut vouloir en être informé (garantie qui suit le
véhicule, statistiques réseau, ciblage marketing du nouveau propriétaire). **[À VALIDER — `QC-08`]** :
il n'est pas établi que ce flux existe électroniquement pour les marques représentées par les
garages de @laupernoe, ni qu'il s'agisse d'un flux DFA→constructeur plutôt que d'une déclaration déjà faite
ailleurs (service des automobiles, `§7`).

### 2.2 Ce qui ne varie jamais, quelle que soit la marque

**`RC-25` — Le tarif garage n'est jamais écrasé par le tarif constructeur.** Le prix facturé au
client (main-d'œuvre, pièces) reste celui du garage. Le tarif ou temps barémé constructeur n'alimente
que la ligne payeur `constructeur` (`RM-69`) — c'est ce qui détermine ce que le constructeur
rembourse, pas ce que le client paie. Un client ne voit jamais un « prix constructeur » qui ne serait
pas le sien.

**`RC-26` — Une déclaration de garantie ou de campagne peut toujours être saisie à la main si le
portail est indisponible.** Elle porte un statut « en attente de transmission » et repart en file
dès que le connecteur répond — conforme à `RC-01`/`RC-04`. Un technicien ne doit jamais être bloqué
dans son OR par un portail constructeur en panne un vendredi soir.

**`RC-27` — Le montant remboursé par le constructeur sur une garantie peut différer du montant
facturé au tarif garage, et les deux valeurs doivent rester visibles séparément** — même logique que
la reprise gonflée d'un VO (`RV-20`/`RV-21` de l'étape 4) : ne jamais fusionner deux valeurs qui
répondent à deux questions différentes (ce que le client a payé au constructeur en tant que
payeur / ce que le constructeur rembourse réellement au garage).

### 2.3 Cas tordus propres à ce domaine

- Une **garantie acceptée puis contestée a posteriori** par le constructeur, après que l'OR a déjà
  été facturé avec le constructeur comme payeur : le mécanisme de correction est l'avoir, jamais une
  modification de la facture verrouillée (même principe que `MD-70`, étape 2) — voir `CC-01`.
- Une **campagne de rappel apparaît après coup** sur un véhicule dont le même défaut vient d'être
  facturé au client la semaine précédente (le constructeur n'avait pas encore ouvert la campagne au
  moment des travaux) : question de reclassement du payeur rétroactif, à trancher — voir `QC-09`.
- Un **rappel obligatoire (sécurité)** diffère d'une **campagne optionnelle (courtoisie)** : le
  premier engage une obligation de moyens de contact du détenteur que le garage doit pouvoir prouver
  (traçabilité de la tentative, pas seulement de l'exécution) ; la seconde ne l'exige pas. **[À
  VALIDER]** — voir `QC-10`.
- Le **forfait constructeur change de version en cours d'OR ouvert** (nouveau tarif publié entre la
  prise de RDV et la facturation) : la version applicable est celle en vigueur à la date de
  facturation, pas à la date d'ouverture de l'OR — **[À VALIDER, `QC-11`]**, cohérence à vérifier
  avec la pratique constatée.

---

## 3. Plateformes d'annonces

Dominée en Suisse par **AutoScout24** (fait déjà établi dans `ARCHITECTURE.md` §5). Ce connecteur
est le complément direct de l'étape 4 (ventes VN/VO) déjà spécifiée — il ne redéfinit aucune règle
du dossier de vente, il synchronise ce que ce dossier expose déjà.

**`RC-40` — Le statut commercial du véhicule en stock pilote la présence de l'annonce, pas
l'inverse.** L'étape 4 modélise déjà `statut_commercial` (`RV-09` : `en_commande`, `disponible`,
`reserve`, `vendu`, `livre`). Le passage à `disponible` déclenche la possibilité de publier ;
le passage à `reserve` ou `vendu` déclenche le retrait ou la mise à jour de l'annonce. **DFA est
source de vérité sur ce statut** — un événement venant de la plateforme (ex. un tiers signale le
véhicule comme vendu ailleurs) n'écrase jamais le statut sans confirmation humaine (`RC-05`).

**`RC-41` — Le prix synchronisé est `prix_vente_affiche_centimes` (`RV-05`), jamais le prix
finalement facturé.** La négociation, la remise, la reprise restent internes au dossier de vente
(`RV-14` : jamais montrées au client sur un document, a fortiori jamais publiées).

**`RC-42` — La synchronisation est à sens unique, DFA vers la plateforme, sur le prix et le
statut.** Une modification faite directement sur le portail de la plateforme (certains outils
permettent l'édition en ligne) n'est pas la source de vérité et ne doit pas revenir écraser le
dossier DFA sans passer par une confirmation — même principe que `RC-05`.

**`RC-43` — Retrait d'annonce à la vente : c'est un geste qui ne doit jamais attendre.** Le cas le
plus coûteux pour un garage n'est pas l'annonce absente, c'est **l'annonce présente pour un véhicule
déjà vendu** — un client rappelle sur un véhicule qui n'existe plus au catalogue. Le retrait suit
donc immédiatement le passage à `reserve` (`RV-10` : un véhicule réservé ne peut plus être engagé sur
un second dossier), en file asynchrone mais prioritaire (`RC-02`).

**`RC-44` — Photos.** Le modèle de données prévoit déjà des photos/360° par véhicule en stock
(`ARCHITECTURE.md` §4, `VéhiculeStock`). La synchronisation vers la plateforme est un envoi, pas une
resynchronisation permanente : republier après chaque changement de statut ou de prix, pas à chaque
octet du fichier.

**`RC-45` — Panne de la plateforme : le véhicule reste vendable sans elle.** Une annonce non publiée
faute de connecteur disponible n'empêche ni la vente au comptoir, ni la facturation, ni la livraison
— seul le canal de visibilité externe est perdu temporairement (`RC-01`).

**`RC-46` — Idempotence de publication.** Publier deux fois la même annonce (retry après timeout) ne
doit jamais produire un doublon visible côté plateforme — clé d'idempotence sur l'identifiant du
véhicule en stock (`RC-06`).

**[INCONNU]** — Aucune API, aucun format de flux AutoScout24 n'est vérifié ici. Le fait établi est
uniquement leur position dominante sur le marché suisse (`ARCHITECTURE.md` §5) ; le mode d'accès
technique (accès partenaire concessionnaire, conditions commerciales, format d'échange) reste à
obtenir directement auprès d'AutoScout24 avant toute conception d'adaptateur — voir `QC-12`.

---

## 4. Fiduciaires — ce qui manque autour de l'existant

**Ne pas relire ce paragraphe comme une redite** : `docs/exports-fiduciaires.md` (`EF-01` → `EF-40`)
est la référence complète — principes, WinBIZ sourcé en détail, iReach explicitement non spécifié,
CSV générique, cibles différées, questions à poser. Ce paragraphe ajoute uniquement ce qui n'y est
pas : la dimension **connecteur** (au sens de ce document — panne, source de vérité, planification)
par-dessus la dimension **format** déjà traitée là-bas.

**`RC-50` — L'export fiduciaire n'est jamais un flux temps réel, et ne doit pas le devenir sans
demande explicite.** WinBIZ (seule cible livrée) fonctionne par lot déclenché manuellement
(`POST /exports-fiduciaires`, déjà en production). C'est le bon modèle par défaut pour toute cible
future : un fiduciaire clôture par période, pas en flux continu — automatiser l'envoi ne doit pas
présumer que la fiduciaire veut recevoir chaque facture au fil de l'eau.

**`RC-51` — Ce qui manque à Bexio, Abacus, Banana par rapport à WinBIZ n'est pas le principe
d'écriture neutre (`EF-01`, déjà acquis pour toute cible), c'est uniquement l'adaptateur de
sérialisation et sa documentation.** Bexio a une API publique documentée (`EF-35`) — c'est la
prochaine cible après le pilote, pas une inconnue technique comme iReach. Abacus reste hors périmètre
tant qu'aucun garage réel ne l'exige (`EF-37`). Banana n'a besoin d'aucun nouveau mode d'agrégation :
le mode `agrege` existe déjà dans le cœur et s'exerce dès maintenant via le CSV générique (`EF-36`).

**`RC-52` — iReach reste, à ce stade, une question de reprise de données plus probable qu'un
connecteur d'export** (`EF-20` → `EF-26`). Ce document ne rouvre pas cette analyse ; il en hérite. Si
la réponse à `QC` (reprise ci-dessous, identique à `EF-40` Q1-Q4) confirme qu'il s'agit d'un DMS
concurrent, ce connecteur sort purement et simplement de l'étape 5.

**`RC-53` — Panne d'un export fiduciaire : aucune facture n'attend un export pour exister.** La
chaîne devis→facture→avoir (étape 2) fonctionne indépendamment de tout export ; l'export est un
geste périodique de clôture, jamais une condition pour facturer (`RC-01`).

---

## 5. Banques — rapprochement camt.054

C'est, comme demandé, le connecteur au meilleur rapport valeur/effort : il complète directement ce
qui vient d'être livré (QR-facture, étape 2), et **une partie substantielle de son terrain a déjà
été posée** en base au moment de la conception de la facturation — ce paragraphe le constate plutôt
que de l'inventer.

**Ce qui existe déjà, vérifié dans le schéma (`apps/api/src/db/schema/facturation/paiement.ts`,
`docs/modele-documentaire-facturation.md` `MD-76`/`MD-77`)** :

- `paiement.reference_qr` — la référence QR (QRR ou SCOR) qui identifie la facture visée, avec
  unicité perpétuelle par tenant (`MD-76`) : c'est la clé de rapprochement.
- `paiement.identifiant_transaction_banque` — **unique par tenant** : c'est déjà, au niveau de la
  contrainte de base de données, l'idempotence d'ingestion d'un avis de crédit (`RC-06` appliqué
  avant même que l'import existe) — un même fichier camt réimporté deux fois ne peut pas créditer
  deux fois la même transaction.
- `paiement.date_valeur`, distincte de la date de création de l'enregistrement.
- `paiement.source` — énumération `manuel` / `camt054` / `terminal` : le champ qui distinguera un
  paiement pointé à la main d'un paiement rapproché automatiquement existe déjà.
- `paiement.contre_passe_id` — le mécanisme de contre-passation (annulation d'un paiement erroné)
  déjà modélisé pour la correction manuelle est directement réutilisable pour corriger un
  rapprochement automatique erroné.

**Ce qui manque, et que ce document spécifie** :

**`RC-60` — Le relevé bancaire (camt.054) est toujours la source de vérité sur ce qui est
effectivement arrivé en banque.** C'est l'exception à la règle générale `RC-05` : ici, DFA ne discute
pas le montant reçu — il constate. Ce qui reste arbitrable, c'est le **rapprochement** (quelle
facture ce montant solde), pas le montant lui-même.

**`RC-61` — Le rapprochement automatique ne modifie jamais une facture émise.** Une facture verrouillée
(`MD-18`→`MD-22`, étape 2) reste verrouillée. Un avis de crédit ne fait qu'enregistrer un `paiement`
et son imputation — exactement le mécanisme déjà en place pour un pointage manuel, avec `source =
camt054` au lieu de `manuel`.

**`RC-62` — Rapprochement exact = automatique ; tout écart part en attente d'un humain, jamais
corrigé seul.** Le cas nominal (référence QR retrouvée, montant reçu = montant dû) se solde sans
intervention. Tout écart — montant partiel, montant supérieur (trop-perçu), référence introuvable,
référence retrouvée mais sur une facture déjà soldée — **n'ajuste rien automatiquement** : il crée un
paiement en attente de lettrage manuel. C'est directement le prolongement de `RC-05` : la banque
fait foi sur le montant, un humain du garage fait foi sur son affectation quand elle n'est pas
triviale.

**`RC-63` — Cas fréquent à traiter explicitement : l'escompte / le paiement anticipé.** Un client qui
paie dans les délais d'escompte verse un montant inférieur au montant facturé, en accord avec les
conditions du garage. Le rapprochement doit reconnaître cet écart comme **plausible** (montant reçu
inférieur, dans une fourchette et un délai cohérents) sans le traiter comme une simple anomalie à
soumettre systématiquement à un humain — même logique déjà anticipée pour la facturation
(`docs/specification-etape-2-facturation.md`, ligne consacrée à ce cas : « … délais verse le montant
escompté ; le rapprochement constate un écart, et l'écran propose au… »). Le seuil et la fenêtre
temporelle sont **paramétrables par tenant** (`PC-*`), pas déduits d'une règle unique.

**`RC-64` — Idempotence d'ingestion de fichier, au-delà de la transaction individuelle.** La
contrainte unique sur `identifiant_transaction_banque` protège la transaction ; il faut aussi éviter
de retraiter un **fichier** camt déjà importé en entier (retéléchargement manuel par erreur). Le même
principe d'empreinte que celui déjà appliqué aux lots d'export comptable (`MD-91`, SHA-256) est
directement réutilisable ici.

**`RC-65` — Ce paragraphe ne fixe pas le mode de transmission du fichier camt.054, parce qu'aucune
source lue ne l'établit pour les banques réellement utilisées par les garages de @laupernoe.** Les modes
usuels pour ce type de standard bancaire (dépôt manuel via e-banking, échange automatisé) existent
sur le marché suisse en général, mais **lequel s'applique à chaque banque du pilote est une question
terrain, pas une hypothèse à coder** — voir `QC-15`. Ce qui est certain, indépendamment du mode de
transmission : le fichier une fois obtenu est **importé**, jamais interrogé en direct depuis la
banque à chaque page vue.

**`RC-66` — Panne ou absence du connecteur bancaire : le pointage manuel déjà existant reste le
chemin de repli permanent, pas une solution provisoire en attendant le connecteur.** Le rapprochement
manuel (cocher une facture comme payée) existe indépendamment de camt.054 — c'est un geste de caisse
de base. Le connecteur accélère ce geste pour le volume, il ne le remplace jamais complètement : une
banque non raccordée, un garage qui n'a pas encore activé le connecteur, doivent pouvoir facturer et
encaisser normalement (`RC-01`).

**`QC-16`** — Multidevise : `paiement.devise` accepte CHF et EUR (`paiement_devise_chk`, vu dans le
schéma). Le camt.054 d'un client transfrontalier payant en EUR est-il un cas réel dans les garages du
pilote ? À vérifier plutôt que supposé absent.

---

## 6. Fournisseurs de pièces

Lié à l'étape 3 (`docs/specification-etape-3-pieces.md`, repères `RP`/`CP`/`PP`/`QP`), déjà bien
posée côté modèle : la commande fournisseur (`RP-26`→`RP-31`), la réception partielle (`RP-27`), les
retours (`RP-30`), les consignes (`RP-39`), les remises fournisseur (`RP-35`), et surtout **le
numéro d'article interne, distinct des références constructeur/fournisseur** (`RP-08`), qui est
exactement le point d'ancrage dont un connecteur de catalogue a besoin pour faire correspondre une
référence externe à un article interne.

**`RC-70` — Trois usages distincts à ne pas fusionner** : consultation de catalogue (chercher une
référence, un prix, une équivalence), consultation de disponibilité (le fournisseur a-t-il la pièce
en stock, sous quel délai), et transmission de commande. Un connecteur peut couvrir les trois ou
seulement le premier — un garage peut très bien vouloir consulter le catalogue en ligne d'un
fournisseur et continuer à commander par téléphone.

**`RC-71` — Le prix reçu du fournisseur à la réception reste l'arbitre, pas le prix catalogue
consulté en amont.** L'étape 3 a déjà tranché ce point sans connecteur (`RP-29` : le prix payé à
réception peut différer du prix attendu à la commande). Un connecteur de catalogue ne change pas
cette règle : il alimente un prix **indicatif** au moment de la commande, la réception reste le point
de vérité — cohérent avec `RC-05` (le tiers fait foi sur son référentiel technique, jamais sur ce que
le garage doit effectivement payer, qui se constate à la facture reçue).

**`RC-72` — Panne du fournisseur en ligne : la commande passe par le canal historique (téléphone,
portail web du fournisseur saisi à la main), saisie a posteriori dans DFA.** Aucun magasinier ne doit
attendre qu'un connecteur revienne pour commander une pièce urgente (`RC-01`).

**`RC-73` — Idempotence de la commande transmise.** Un retry après timeout ne doit jamais faire
partir deux fois la même commande fournisseur électronique — même mécanisme que `RC-06`, appliqué à
l'objet `commande_fournisseur` déjà modélisé à l'étape 3.

**`RC-74` — Un article reçu qui ne correspond à aucune commande DFA en attente n'est pas rejeté par
le connecteur : il est réceptionné avec un rattachement a posteriori**, cas déjà envisagé côté métier
étape 3 pour l'écart de quantité (`RP-30`, retour fournisseur, ou entrée en stock hors commande).

**[INCONNU]** — Aucun format de catalogue, d'API ou de portail de commande n'est vérifié ici pour
Derendinger, Technomag, ESA ou tout autre fournisseur suisse. `ARCHITECTURE.md` cite **TecDoc** comme
catalogue générique de phase 1 (licence à négocier), ce qui est distinct d'un connecteur de commande
par grossiste — deux briques différentes, deux besoins différents (l'une identifie la pièce à partir
du véhicule, l'autre la commande auprès d'un fournisseur donné). Voir `QC-17`.

---

## 7. Contrôles et administration

**`RC-80` — Ce paragraphe est délibérément prudent : aucun échange électronique établi entre un DMS
tiers et l'expertise (MFK) ou un office cantonal des automobiles n'a été identifié dans les sources
disponibles pour la rédaction de ce document.** Ce qui existe déjà côté DFA à ce sujet est purement
interne : `vehicule_expertise` (étape 1, `RM-28`/`CT-10`), qui distingue une échéance **calculée**
d'une échéance connue par **convocation** saisie manuellement — c'est une donnée que le garage entre
lui-même, pas un flux entrant automatisé.

**`RC-81` — Chaque canton administre son propre service des automobiles**, ce qui exclut par
construction un connecteur unique « administration suisse » — au mieux, un connecteur par canton,
avec un coût de couverture très élevé pour un bénéfice qui reste à démontrer. **Avant toute
conception**, il faut établir si un échange électronique existe réellement quelque part dans les
garages du pilote — démarche de dépôt de plaques, changement de détenteur, présentation à
l'expertise — ou si tout se fait aujourd'hui par un canal physique/postal ou un portail web sans
interface programmable. Voir `QC-19`.

**`RC-82` — En l'absence de connecteur, la fonction déjà livrée reste la seule à date : alerter le
garage sur une échéance qui approche, et documenter le résultat d'un passage à l'expertise après
coup.** Ce n'est pas une limitation de ce document : c'est l'état réel du terrain tant que `QC-19`
n'est pas répondue.

---

## 8. Cas de test métier transversaux

- **`CC-01`** — Garantie constructeur acceptée, OR facturé avec le constructeur comme payeur, puis
  **contestée par le constructeur trois semaines plus tard**. Contexte : dossier de garantie n° X,
  facture déjà verrouillée, payeur `constructeur`. Attendu : le constructeur refuse tout ou partie du
  montant → un avoir est émis sur la part refusée, la ligne d'origine n'est jamais modifiée
  (`MD-70`), le solde repasse sur le client ou reste une perte du garage selon la décision commerciale
  — arbitrage qui n'est **pas** du ressort du connecteur.
- **`CC-02`** — Connecteur constructeur en panne un vendredi soir pendant qu'un technicien constate
  un défaut couvert par une campagne connue. Attendu : la ligne d'OR est créée avec origine `campagne`
  et payeur `constructeur` (`RM-64`/`RM-69`) sans que le portail réponde ; la transmission repart en
  file dès le retour du connecteur.
- **`CC-03`** — Véhicule publié sur AutoScout24, vendu **au comptoir sans passer par le dossier de
  vente en ligne** (client physique, paiement immédiat). Attendu : dès le passage du véhicule à
  `reserve` puis `vendu` (`RV-09`/`RV-10`), le retrait de l'annonce part en priorité (`RC-43`) — le
  cas dangereux à éviter est l'inverse : l'annonce qui survit au véhicule vendu.
- **`CC-04`** — Prix de vente modifié deux fois dans la même minute (négociation en direct avec le
  client pendant qu'un collègue regarde l'annonce en ligne). Attendu : la dernière valeur de
  `prix_vente_affiche_centimes` gagne côté DFA, et une seule mise à jour part vers la plateforme (pas
  une par changement intermédiaire) — cohérence avec `RC-46`.
- **`CC-05`** — Import d'un fichier camt.054 contenant un avis de crédit dont la référence QR ne
  correspond à **aucune facture ouverte** (référence mal formée, ou facture déjà soldée
  manuellement avant réception du relevé). Attendu : le paiement est créé avec `source = camt054`,
  reste **non imputé**, et apparaît dans une liste d'attente de lettrage — jamais rejeté silencieusement,
  jamais imputé au hasard.
- **`CC-06`** — Le même fichier camt.054 est réimporté par erreur (le comptable le retélécharge et le
  redépose). Attendu : chaque transaction déjà connue (`identifiant_transaction_banque` déjà en base)
  est ignorée sans créer de doublon — la contrainte unique existante le garantit déjà au niveau base.
- **`CC-07`** — Client qui bénéficie d'un escompte contractuel verse `montant_facture − 2 %` dans le
  délai convenu. Attendu : le rapprochement reconnaît l'écart comme plausible et propose le
  lettrage plutôt que de le classer en anomalie à traiter comme un impayé partiel (`RC-63`).
- **`CC-08`** — Commande de pièce transmise à un fournisseur, la requête HTTP sortante time-out côté
  DFA sans qu'on sache si le fournisseur l'a reçue, le job retente. Attendu : au plus une commande
  arrive réellement chez le fournisseur (`RC-73`), et l'état visible du connecteur (`RC-03`) ne
  montre jamais une commande « en échec » si elle est en réalité partie.
- **`CC-09`** — Pièce livrée par un fournisseur qui ne correspond à aucune commande ouverte dans DFA
  (le magasinier avait commandé par téléphone en direct sans passer par l'outil). Attendu : la
  réception peut se faire quand même, rattachée a posteriori ou en entrée libre — jamais bloquée en
  attendant une commande qui n'existe pas côté DFA (`RC-74`).
- **`CC-10`** — Export WinBIZ déclenché deux fois par erreur sur la même période (utilisateur qui
  double-clique). Attendu : cas déjà couvert et prouvé par l'implémentation existante (`MD-92`,
  idempotence de l'export) — ce document ne fait que le rappeler comme le patron à suivre pour toute
  future cible.

---

## 9. Paramétrage

Points qui varient d'un garage à l'autre et ne doivent jamais être codés en dur — conformément à la
convention déjà appliquée aux étapes 1 à 4.

| #       | Contenu                                                                                                                                  | Portée         | Valeur par défaut                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `PC-01` | Nombre de tentatives et espacement avant qu'un connecteur en échec bascule en « nécessite une action » (`RC-04`)                         | par connecteur | **aucune valeur avancée — dépend du connecteur, à définir à l'implémentation**    |
| `PC-02` | Connecteurs activés pour le tenant (un garage peut ne représenter qu'une marque, n'utiliser qu'une plateforme d'annonces)                | tenant         | aucun connecteur actif par défaut — activation explicite                          |
| `PC-03` | Seuil et fenêtre temporelle de reconnaissance d'un escompte lors du rapprochement bancaire (`RC-63`)                                     | tenant         | **aucune valeur avancée — dépend des conditions commerciales du garage, `QC-18`** |
| `PC-04` | Compte ou emplacement de destination du prix « indicatif » importé d'un catalogue fournisseur, avant validation à la réception (`RC-71`) | tenant         | pas de préremplissage automatique tant que le point n'est pas confirmé terrain    |
| `PC-05` | Fréquence de synchronisation catalogue/disponibilité fournisseur, si un connecteur de consultation est activé                            | par connecteur | **inconnu — dépend de ce que chaque fournisseur autorise, `QC-17`**               |

---

## 10. Ce qui doit remonter à @laupernoe

Formulé pour un garagiste, pas pour un développeur — et pensé pour ce que @laupernoe peut vérifier
directement, prestataire IT de plus de dix garages avec accès aux systèmes existants.

### Les deux questions qui décident de l'ordre de priorité

**`QC-01` — Lesquels de ces connecteurs sont réellement utilisés dans tes garages, et lesquels ne le
sont que sur le papier ?** Concrètement, pour chaque garage : est-ce que quelqu'un se connecte
vraiment chaque semaine au portail du constructeur pour une garantie ou une campagne ? Est-ce que
les annonces AutoScout24 sont mises à jour à la main aujourd'hui (et combien de temps ça prend), ou
est-ce déjà semi-automatisé via Auto-i/Nextlane ? Est-ce que le rapprochement bancaire se fait
aujourd'hui en pointant une par une les lignes du relevé, ou la fiduciaire s'en charge entièrement en
aval ? La réponse ne sera probablement pas la même pour tous.

**`QC-02` — Lequel ferait le plus de différence si on le livrait en premier ?** Mon évaluation, à
confirmer par toi : **le rapprochement camt.054 (§5) a le meilleur rapport effort/valeur**, parce
qu'une bonne partie du terrain (référence QR unique, colonnes camt déjà posées en base) est déjà en
place depuis la conception de la facturation — il ne reste qu'à écrire l'import et l'écran de
lettrage. Les connecteurs OEM (§2) sont probablement ceux qui feraient le plus gagner de temps au
quotidien mais sont aussi les plus lourds à couvrir marque par marque — à ne traiter qu'une fois le
reste stabilisé, et marque par marque en fonction de ce qui pèse vraiment dans le parc de chaque
garage.

### Où aller regarder, connecteur par connecteur

| Connecteur                                               | Où trouver la réponse                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OEM — commandes pièces, garanties, campagnes**         | Le poste qui se connecte aujourd'hui au portail constructeur dans chaque garage (souvent le chef d'atelier ou le magasinier) — demande-lui de te montrer un dossier de garantie de bout en bout                        |
| **OEM — accès et conditions**                            | L'importateur national de chaque marque représentée ; c'est lui qui gère les accès agréés, pas le constructeur central                                                                                                 |
| **AutoScout24**                                          | Le vendeur VO qui publie les annonces aujourd'hui — et le contrat commercial du garage avec AutoScout24, qui devrait mentionner un accès « professionnel »/« intégration » distinct de la saisie manuelle grand public |
| **Fiduciaires (Bexio/Abacus/Banana, au-delà de WinBIZ)** | Les fiduciaires elles-mêmes des garages qui ne sont pas sur WinBIZ — la même question que `EF-40` Q1-Q4, à reposer pour chaque garage non couvert                                                                      |
| **Banque / camt.054**                                    | Le service e-banking de la banque du garage — demande directement « pouvez-vous me fournir des avis de crédit au format camt.054, et par quel canal ? »                                                                |
| **Fournisseurs de pièces**                               | Le magasinier de chaque garage : quel fournisseur a un portail de commande en ligne aujourd'hui, lequel se fait encore par téléphone/fax                                                                               |
| **MFK / cantonal**                                       | À vérifier en priorité que ce connecteur a un sens avant d'y investir une ligne de code — demande directement au garage comment se passe concrètement un dépôt de plaques ou un changement de détenteur aujourd'hui    |

### Questions ouvertes qui touchent ce domaine, déjà croisées ailleurs dans le dépôt

- **`QC-03`** (reprise de `EF-40` Q1-Q4) — **iReach : le garage l'utilise-t-il comme DMS, ou est-ce
  sa fiduciaire qui l'utilise ?** Tant que ce n'est pas tranché, aucun développement ne doit commencer
  sur cette cible — voir `docs/exports-fiduciaires.md` §3 pour le détail complet.
- **`QC-04`** (reprise de `EF-40` Q10) — **Le régime TVA attendu par WinBIZ (champ `Montant` : TTC ou
  HT selon `TVA_meth`) reste à trancher par un test sur un dossier réel**, pas par la documentation.
  C'est le seul vrai bloquant technique connu sur la cible pourtant la mieux documentée.
- **`QC-05` à `QC-19`** — Numérotées dans le corps du document à l'endroit où elles apparaissent :
  immatriculation remontée au constructeur (`QC-08`), reclassement rétroactif du payeur après
  ouverture tardive d'une campagne (`QC-09`), traçabilité d'un rappel obligatoire (`QC-10`),
  version applicable d'un forfait constructeur en cours d'OR (`QC-11`), accès et conditions
  AutoScout24 (`QC-12`), mode de transmission du fichier camt.054 par banque (`QC-15`), format de
  catalogue/commande des grossistes suisses (`QC-17`), seuil d'escompte par garage (`QC-18`),
  existence réelle d'un échange électronique cantonal/MFK (`QC-19`).
- **`QC-20`** — Ce document suppose, sans l'avoir vérifié, que les connecteurs OEM couvrent des
  marques dont chacune a son propre agrément commercial à obtenir. **Combien de marques
  distinctes faut-il réellement couvrir sur l'ensemble du parc des dix garages** avant de savoir si
  « un connecteur par marque, au rythme des agréments » (`ARCHITECTURE.md` §5) est un chantier de
  deux marques ou de quinze ?

---

## Ce que ce document n'affirme pas

Par honnêteté sur son propre statut, à l'image de `docs/exports-fiduciaires.md` :

- **Rien de ce qui touche un protocole tiers n'est sourcé par une documentation lue** pour les OEM,
  AutoScout24, les fournisseurs de pièces ou l'administration cantonale/MFK — chaque paragraphe le
  signale explicitement par **[INCONNU]** plutôt que de combler par une supposition plausible.
- **Le rapprochement bancaire (§5) est la partie la mieux fondée de ce document**, parce qu'une part
  substantielle de son terrain (schéma de `paiement`, `MD-76`/`MD-77`) est déjà vérifiable dans le
  code du dépôt, pas seulement dans une intention d'architecture.
- **Les questions de la §10 sont le livrable prioritaire de ce document**, au même titre que `EF-40`
  l'était pour les exports fiduciaires : y répondre coûte quelques appels et vérifications sur
  place ; concevoir un adaptateur sans les avoir posées coûte un adaptateur à refaire.
