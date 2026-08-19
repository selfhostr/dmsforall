Spécification — Reprise de données depuis un DMS existant
=========================================================

> **Jalon** : chantier transverse, pas une étape de la feuille de route (ARCHITECTURE §6) — il
> s'exécute **à chaque garage**, pas une fois. Sa première exécution réelle est la condition de
> tout premier client pilote en production, quelle que soit l'étape atteinte par le produit à ce
> moment-là.
>
> **Statut** : spécification décisionnelle — le _quoi_, le _pourquoi_ et **l'arbitrage tranché**.
> Elle est le point d'entrée du sujet. La méthode détaillée (investigation terrain, mapping
> champ à champ exhaustif, pièges de correspondance du terrain suisse, runbook horaire du jour J,
> zones aveugles restantes) vit dans **[reprise-donnees.md](reprise-donnees.md)**, qu'elle
> référence section par section plutôt que de la dupliquer. La checklist imprimable de visite
> terrain vit dans **[reprise-donnees-questionnaire.md](reprise-donnees-questionnaire.md)**.
>
> **Conventions** : reprises telles quelles de `reprise-donnees.md`, pour ne pas fragmenter les
> références déjà citées ailleurs dans le dépôt (`docs/index.md`, commentaires de schéma) :
> `D-xx` = décision de reprise · `N-xx` = règle de nettoyage/qualité · `CR-xx` = contrôle de
> recette exécutable par le garagiste · `QG-xx` / `QE-xx` = question au garagiste / à l'éditeur ·
> `R-xx` = risque juridique ou contractuel · `Z-xx` = zone aveugle (inconnue tant qu'aucun terrain
> réel n'a été observé).

---

0. Ce qui est vérifié dans notre code, ce qui est hypothèse sur la source

---

**Vérifié** — lu dans `apps/api/src/db/schema/`, `apps/api/src/db/migrations/` et
`packages/shared/src/contrats/` au 31.07.2026 (migrations `0000` → `0033`) : toutes les
contraintes, tous les triggers, tous les noms de colonnes cités dans ce document et dans
`reprise-donnees.md` §10-§11.

**Hypothèse, jamais vérifiée** — tout ce qui concerne Auto-i, Nextlane, ou tout autre DMS
source : noms de tables, de colonnes, formats d'export, existence d'une fonction d'export. **Ce
dépôt ne contient aucun export réel.** Les tableaux de mapping ci-dessous décrivent des **rôles
fonctionnels** (« le champ qui porte le nom du client »), jamais des noms de champs réels.
Quiconque écrit un adaptateur à partir de ce document doit d'abord remplir la colonne source avec
ce qu'il a observé — méthode complète en `reprise-donnees.md` §1.

⚠️ **Vocabulaire.** « Reprise », dans tout ce document, signifie **reprise de données** (le sujet
ci-dessous). Le mot désigne aussi, ailleurs dans ce dépôt (`apps/api/src/db/schema/ventes/
reprise.ts`, table SQL `reprise`, RV-19→RV-28), la **reprise de véhicule** — le fait qu'un garage
reprenne la voiture d'un client en déduction du prix d'une vente neuve ou d'occasion. Les deux
notions ne partagent ni table, ni colonne, ni code ; elles se sont déjà trouvées confondues une
fois dans une spécification de ce dépôt. Vérification faite : aucune collision de nom de table
n'existe (les tables de reprise de données, §5.2 de `reprise-donnees.md`, s'appellent
`lot_reprise`, `reprise_ligne_source`, `correspondance_reprise`, `reprise_anomalie` — jamais
`reprise` tout court, qui est déjà prise par le module Ventes).

---

1. Le périmètre — ce qui se reprend, ce qui ne se reprend pas

---

Test de décision unique, tenu pour chaque entité (`reprise-donnees.md` §3, en préambule) :
**« que se passe-t-il, le mardi suivant la bascule, si cette donnée n'est pas là ? »** Si la
réponse est « rien » ou « on la retrouve dans l'archive », elle n'est pas reprise. Le réflexe
« on reprend tout, comme ça on est tranquille » est le premier facteur d'échec observé sur ce
type de projet : il importe la saleté du système précédent, il rend la recette impossible (on ne
vérifie pas 400 000 lignes, on en vérifie 20 000) et il fait porter au nouvel outil la mauvaise
réputation de l'ancien.

- Clients / Actifs — document ou véhicule dans les N dernières années (défaut 5 ans, à valider par garage) / Fiches mortes / `D-07` / Elles polluent la recherche comptoir et augmentent l'exposition nLPD sans usage
- Véhicules / Tous ceux rattachés à un client repris, avec **détention courante** reconstruite / — / §2.2 `reprise-donnees.md` / Le véhicule est indissociable de son détenteur pour l'atelier
- Historique de détention (avant le 1er document repris) / — / Non repris, irrécupérable / Perte assumée n°1 / Le source ne connaît en général qu'un propriétaire courant
- Ordres de réparation / Horizon 24-36 mois (à valider), **clôturés et verrouillés** / Au-delà de l'horizon / `D-08` / Valeur consultative au-delà ; les factures gardent le détail commercial
- Devis / Devis **acceptés non transformés**, encore vivants — ressaisis à la main / Devis abandonnés, brouillons de tout type / `D-09` / Aucune valeur légale ni commerciale sur un devis mort
- Factures / avoirs / **Toutes**, sans discussion — soldées en archive documentaire, ouvertes dans la chaîne vivante / — / `D-04`/`D-05` / Valeur légale (art. 958f CO, 10 ans) et argument commercial de confiance
- Créances ouvertes / Oui, avec leur solde / Historique de paiement des factures **soldées** / §2.4 / Le détail vit chez la fiduciaire une fois le dossier clos
- Travaux reportés (encore ouverts) / Oui, depuis les OR repris / — / §2.2 / Manque à gagner commercial direct sinon
- RDV / **Futurs uniquement** / RDV passés / `D-16` / Un RDV passé est déjà devenu un OR ou une absence ; un RDV futur perdu, c'est le carnet de commandes qui disparaît
- Catalogue pièces (références, prix) / Oui / — / `D-02` / Réutilisable tel quel
- Stock pièces (quantités) / — / Jamais / `D-14` / Un stock repris est faux le lendemain ; inventaire physique le week-end de bascule à la place
- Pointages / — / Jamais / `D-10` / Indicateurs non comparables entre deux méthodes de pointage ; ils repartent au jour J
- Consentements marketing / — / Remis à zéro / `D-11` / Un consentement se prouve ; importé sans preuve, il est inventé — exposition nLPD directe
- Utilisateurs, mots de passe, droits / — / Jamais / `D-12` / Aucun rapport entre les droits d'un outil tiers et la matrice rôle × action DFA
- Paramétrage (tarifs, forfaits, motifs) / — / Ressaisie manuelle assistée / `D-13` / Le modèle de paramétrage DFA n'a pas d'équivalent structurel côté source
- Photos / pièces jointes anciennes / — / Sauf litige ou sinistre ouvert, repris nommément / `D-17` / Volume énorme, valeur quasi nulle passé le délai de litige
- Écritures comptables / — / Jamais / `D-18` / DFA n'a pas de comptabilité interne (ARCHITECTURE §1) ; domaine de la fiduciaire

**Ce qui compense chaque « non repris » : l'archive froide (`D-20`)** — export complet du source
(CSV + PDF), chiffré, horodaté, empreinte SHA-256, stocké en Suisse, procédure écrite de
consultation. Elle satisfait l'obligation de conservation légale (`R-06`) sans peser sur la base
opérationnelle. Détail complet et argumentaire présentable au garagiste : `reprise-donnees.md`
§3 et §12.1 (« la ligne de coupe, en une page, à lire à voix haute avant de signer »).

---

2. Mapping par entité — synthèse et pertes assumées

---

Détail champ à champ complet, avec la colonne « rôle du champ source » à remplir sur le terrain :
`reprise-donnees.md` §2 (intention) corrigée par §10 (contraintes réelles du schéma) et affinée
par §11 (pièges du terrain suisse : VIN, plaques réattribuées, doublons, type particulier/
entreprise). Ce qui suit est la synthèse **vérifiée contre le schéma réel**.

**2.1 Client → `client`**

- `type` ⇒ `nom NOT NULL` (particulier) ou `raison_sociale NOT NULL` (entreprise), et `client_verrouiller_type` (`ZDFA3`) rend `type` **immuable** après coup — Une fiche source sans nom exploitable **ne peut pas être insérée** — rejet en anomalie bloquante, jamais de fiche fantôme. Une erreur de type coûte une nouvelle fiche + fusion : la reprise **sur-déclare `particulier`** par défaut (erreur la plus facile à vivre) et sort la liste des cas douteux pour relecture (`N-02`)
- `ide` sous `CHECK ~ '^CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}$'` — Un IDE avec suffixe (`TVA`, `MWST`) ou sans points est **rejeté par la base** — normaliser avant, `NULL` + anomalie sinon
- Pas de colonne `mobile`, seulement `telephone` (libre) et `telephone_e164` (contraint) — La distinction fixe/mobile du source **n'a pas de destination** — perte à ajouter à la liste des pertes assumées
- Adresse `principale` unique par client (index partiel) — Deux adresses source marquées principales ⇒ échec du 2ᵉ `INSERT` — à dédoublonner avant, la 2ᵉ devient `facturation`
- `client_condition` sous contrainte d'exclusion de période (EXCLUDE GiST) — Une seule ligne à l'import, `valide_du` = date de bascule, `valide_au = NULL` — les conditions du source ne sont jamais datées, donc jamais justifiables a posteriori sur un ancien OR (perte assumée, le montant figé sur le document reprend le rôle de preuve)
- `client_consentement` : `SELECT, INSERT` seulement (append-only) — Cohérent avec `D-11` — non repris
- **Numéro de client** : `client.numero NOT NULL UNIQUE(tenant)`, pas de `numero_origine` sur `client` — Décision ouverte `D-26` (§4 ci-dessous)

**2.2 Véhicule → `vehicule` (+ plaques, détentions, kilométrages, expertises)**

- `marque NOT NULL`, `modele NOT NULL`, non vides — Un véhicule sans marque/modèle exploitable **ne peut pas être inséré** — déduction depuis un champ libre, sinon sentinelle lisible `'MODÈLE INCONNU'` + `identification_incomplete = true` (`D-27`)
- `vehicule_vin_format_chk` : VIN de 17 caractères validé strictement (`A-HJ-NPR-Z0-9`, refuse I/O/Q) ; VIN d'une autre longueur **accepté sans contrôle** — Un VIN 17 avec un `O`/`I`/`Q` est rejeté — jamais corrigé automatiquement (`O`→`0` proposé en liste de nettoyage, jamais appliqué seul). Un VIN tronqué (10 caractères) **passe sans broncher** et devient une clé de déduplication silencieusement fausse — jamais utilisé comme clé si `≠ 17`
- `vehicule_vin_actif_uk` : unique partiel sur VIN, `where statut='actif'` — Deux véhicules actifs même VIN ⇒ trancher avant l'insert (le plus récent documenté reste actif, l'autre `archive` + `motif_archivage='doublon'`)
- `vehicule_plaque.du NOT NULL` + `vehicule_plaque_collision_excl` (EXCLUDE GiST) — `du = NULL` est **impossible** — la plaque réattribuée (cas suisse classique : la plaque suit le détenteur, pas le véhicule) exige une reconstruction par intervalles jointifs depuis les dates de documents, jamais un import naïf. Cas ambigu (dates chevauchantes) ⇒ **aucune plaque écrite**, anomalie bloquante, arbitrage humain (détail complet et pseudocode : `reprise-donnees.md` §11.2)
- `vehicule_detention` : `au NULL ⇔ motif_fin NULL`, EXCLUDE sur période — Un seul détenteur courant par véhicule, invariant vérifié **avant** insert ; `motif_fin = 'correction'` par défaut (source rarement causal)
- `vehicule_expertise.resultat NOT NULL` — Une date d'expertise sans résultat connu **ne suffit pas** à créer la ligne — inventer un résultat certifierait un contrôle technique non vu. Part en note véhicule à la place (`D-28`, à trancher avec @laupernoe : perdre la relance MFK vs écrire une donnée fausse)
- Colonnes techniques (motorisation, couleur, pneus, huile…) — Toutes nullable, confort de comptoir, reprise « au mieux » sans blocage

**2.3 Article / Stock → `article`, `stock_article` (étape 3, en base depuis `0022`-`0029`)**

`D-02` — le catalogue fournisseur (référence, désignation, prix, TVA) se reprend ; `D-14` — le
stock physique (quantités) ne se reprend jamais, inventaire physique à la place. Détail :
`reprise-donnees.md` §2.3. Note structurelle : `article.numero_article` est nullable
« pour la même raison que `ordre_reparation.numero_origine` [...] laisser la porte ouverte à une
reprise verbatim future, jamais exploitée aujourd'hui » (commentaire du schéma,
`apps/api/src/db/schema/pieces/article.ts`) — `article` n'a **pas** de colonne `origine` /
`numero_origine` dédiée à ce jour ; si un garage a besoin de conserver une référence catalogue
verbatim au-delà du simple `numero_article`, c'est une question à transmettre à
`expert-database`, pas une chose que ce document peut trancher seul.

**2.4 Document de vente (devis / facture / avoir) → `document_vente`**

C'est l'entité la plus sensible : traitée en détail au §5.2 ci-dessous (l'immuabilité) et au §5.4
(numérotation). Synthèse du mapping : `reprise-donnees.md` §2.4 et §10.4.

**2.5 Ordre de réparation repris → `ordre_reparation`**

Depuis `migrations/0011_ordre_reparation_origine_reprise.sql`, `ordre_reparation` porte
`origine` + `numero_origine` **exactement** comme `document_vente` — un OR repris ne consomme
jamais la séquence DFA. Détail : `reprise-donnees.md` §10.5 (mis à jour le 31.07.2026 : la
question `Z-17` qui y était posée est résolue).

---

3. Réconciliation — la preuve, pas l'intention

---

« 8 000 lignes importées » ne prouve rien. Le dispositif complet (rapport automatique,
formulaire exact) : `reprise-donnees.md` §6.6 et §12.3. Principe :

**L'équation de conservation**, qui doit tomber juste pour chaque entité, sans reste :

```
lignes_source  =  importées  +  écartées_par_règle  +  rejetées_en_anomalie
                       (D-07, D-08, D-09…)              (bloquantes)
```

Aucun bac « autre » : un écart de 3 lignes non attribué invalide le rapport entier, quelle que
soit sa taille par ailleurs — ce n'est pas une question de proportion, c'est la preuve qu'on ne
sait pas ce qui se passe. Chaque bac est un **fichier ouvrable** (`ecartes-clients-<lot>.csv`),
pas un nombre : le garagiste doit pouvoir l'ouvrir dans Excel et vérifier lui-même.

**Trois niveaux de preuve, dans l'ordre où ils convainquent** :

- 1. Comptage / Aucune ligne perdue en route / Que le contenu est juste / Automatique
- 2. Somme (centimes, exacte) / Montants non déformés / Montants sur les bons clients / Automatique
- 3. Nominatif / Le système dit vrai sur _ses propres_ clients / Rien d'autre — mais c'est le seul qui emporte l'adhésion / **Le garagiste**, `CR-01`→`CR-12`

**Les contrôles nominatifs (`reprise-donnees.md` §6.4)**, exécutés par le garagiste sur son écran,
avec ses propres exemples — à titre d'illustration, les trois qui portent le plus :

- `CR-01` — « Retrouve la dernière facture de M. Rossier » (client réel, choisi par lui) : même
  numéro, même date, **même montant au centime** que son papier.
- `CR-04` — 10 factures tirées au hasard dans son classeur papier, retrouvées une à une : 10/10.
- `CR-07` — chiffre d'affaires d'un mois passé, comparé à celui de la **fiduciaire** (source
  tierce, sans rapport avec la migration) : **écart 0, sinon on ne bascule pas.**

**Les sommes qui doivent tomber à zéro centime, sans tolérance** : total TTC des factures par
année civile, total des avoirs par année, créances ouvertes (solde), écart Σlignes−total
(`ecart_reprise_centimes`, doit être **égal**, jamais absorbé), nombre de détenteurs courants =
nombre de véhicules repris. Détail et requêtes : `reprise-donnees.md` §12.3.

---

4. Plan de bascule

---

Calendrier type (8 semaines), critères GO/NO-GO détaillés, runbook heure par heure du week-end
de bascule : `reprise-donnees.md` §6 et §13 — non dupliqués ici. Ce qui suit est l'arbitrage.

**4.1 Deux passes, jamais une bascule directe**

1. **À blanc** — 3 itérations minimum dans un tenant bac à sable (`<garage>-bac`), jusqu'à un taux
   d'anomalies bloquantes sous 0.1 %. La mise au point ne se fait **jamais** par annulation de
   lot : `dfa_app` n'a **aucun** droit `DELETE` sur les tables métier (§5.5 ci-dessous), donc la
   correction d'un import raté passe par la destruction et la recréation du tenant bac à sable
   (`pnpm db:migrate` + réimport), pas par une commande d'annulation qui n'existe pas au sens où
   on l'imagine.
2. **Réelle** — le week-end de la bascule, sur la copie restaurée d'une sauvegarde fraîche,
   jamais sur la production du DMS source.

**4.2 Fenêtre d'indisponibilité**

**Zéro minute côté DFA le lundi matin.** L'indisponibilité est entièrement contenue dans le
week-end et porte sur l'**ancien** système : lecture seule dès vendredi 18h, import + recette
samedi-dimanche, décision GO/NO-GO écrite et signée **au plus tard dimanche 18h** — après cette
heure, NO-GO par défaut, quelle que soit la proximité du but.

**4.3 Point de non-retour**

**Il existe, et il est net : l'émission d'un document.** Avant émission, un document repris est
en `statut='brouillon'` — modifiable, abandonnable, le lot peut être détruit et rejoué. Dès que le
chargeur exécute `UPDATE ... SET statut='emis'` (§5.2 ci-dessous), le trigger
`document_vente_verrouiller_apres_emission` prend effet : seule une liste blanche de 13 colonnes
reste modifiable, et aucune n'est un montant ni une ligne. **Un document repris émis n'est pas
rejouable.** C'est la raison pour laquelle le chargeur ne doit émettre qu'une fois toutes les
vérifications automatiques et le rapport de réconciliation validés — jamais avant.

**4.4 Ce qui n'a pas de retour arrière — à dire en toutes lettres**

- Document de vente **avant** l'étape `emis` (brouillon) / ✅ Oui / Modifiable, abandonnable, ou le lot entier peut être détruit (tenant bac à sable)
- Document de vente **émis** (facture, avoir, ou OR/devis passés en `emis`/`cloture`) / ❌ **Non** / `document_vente_verrouiller_apres_emission` — correction possible uniquement par un **avoir**, jamais par annulation
- Fusion de deux fiches client / ❌ **Non**, pour l'utilisateur / `dfa_app` n'a pas `DELETE` sur `client` ; `client_fusionne_inactif_chk` impose `statut='inactif'` sur la fiche absorbée à vie. C'est pour cela que la reprise ne fusionne **jamais** automatiquement les doublons incertains (`D-21`) — seules les identités fortes (IDE, e-mail non générique) sont fusionnées, et en lot, validées par le garagiste
- Type de client (particulier/entreprise) / ❌ **Non** / `client_verrouiller_type` (`ZDFA3`) — une erreur coûte une nouvelle fiche + fusion, donc un doublon volontaire définitif
- Relevé de kilométrage, consentement, récapitulatif TVA de document / ❌ **Non** / Append-only strict (`SELECT, INSERT` seulement) — une valeur fausse se corrige par un **nouveau** relevé motivé, jamais par correction de l'ancien
- Numéro de compteur calé (`compteur_document`) après import / ⚠️ Partiellement / Se recale vers le haut sans casser la continuité tant qu'aucun document DFA n'a encore été émis dessus ; après la première émission réelle, un mauvais calage devient un problème de collision, pas de correction

La procédure de **marche arrière opérationnelle** (retour au DMS source après un GO qui tourne
mal) n'est **jamais** une suppression dans DFA — techniquement impossible (tableau ci-dessus) et
inutile : la base DFA du tenant devient la pièce à conviction, conservée intacte. Elle consiste à
remettre l'ancien système en écriture et à **ressaisir** ce que DFA a produit pendant la fenêtre,
avec un point de bascule de coût qui grimpe fortement après J+5. Détail complet, les deux
réponses possibles selon que l'ancien système accepte ou non de forcer un numéro de facture, et
le calendrier heure par heure : `reprise-donnees.md` §13.4.

**4.5 Double saisie — position tranchée**

**`D-25` — pas de double saisie générale.** Dans un garage de 5 personnes un mardi matin avec six
clients à la file, personne ne saisit deux fois ; le résultat serait deux systèmes également
faux. À la place : ancien système en lecture seule dès J-2 (accessible 30 jours), DFA seul en
écriture dès J, vigilance renforcée J→J+5, contrôle croisé quotidien (total facturé du jour vs
ruban de caisse). Seule exception : bascule imposée en milieu de période comptable — double
saisie limitée aux factures émises, 2 semaines maximum, un responsable nommé — et la bonne
réponse est presque toujours de décaler la bascule plutôt que d'ouvrir cette exception.

---

5. Les six points durs du modèle cible, traités frontalement

---

**5.1 Prix TVA comprise (`RF-40`) — ce qu'on refuse d'importer**

Le modèle DFA stocke le **TTC** comme vérité (`ligne_document.ttcCentimes NOT NULL`), avec HT et
TVA dérivés (`htCentimes`, `tvaCentimes`), sous la contrainte
`ligne_document_montant_coherent_chk : ttc = ht + tva`, exacte à la ligne, et le lot pilote
impose `mode_calcul_tva = 'ttc'` (`ligne_document_mode_ttc_lot_pilote_chk`). Un DMS source qui
stocke du HT en décimal (le cas courant) produit un écart d'arrondi dès la conversion.

**Traitement :**

- Le chargeur **calcule** le TTC depuis le HT et le taux du document (jamais l'inverse — le TTC
  affiché sur le document papier fait foi quand il existe, `D-04`).
- Écart entre `Σ lignes` et le total stocké côté source : **jamais corrigé silencieusement**.
  Le total source fait foi (`D-04`), et la ligne dédiée `type_ligne_document = 'ecart_reprise'` +
  la colonne `document_vente.ecart_reprise_centimes` rendent l'écart **visible**, jamais absorbé
  (`N-06`).
- **Ce qu'on refuse d'importer, sans négociation** : tout document où le parsing d'un montant
  échoue le contrôle `^-?\d+([.,]\d{1,2})?$` (§`N-06`), ou dont l'écart Σlignes/total dépasse un
  seuil de vraisemblance qui suggère une erreur de mapping plutôt qu'un simple arrondi d'époque —
  le document part en anomalie **bloquante**, jamais en approximation. Un import s'arrête
  entièrement (aucune écriture) si le taux d'anomalies bloquantes dépasse 1 % des lignes d'une
  entité (`N-09`) : c'est le signe que le mapping est faux, pas que les données le sont.
- Le taux de TVA appliqué est celui **de l'époque du document**, jamais le taux courant (`N-07`,
  table des taux 2001→aujourd'hui dans `reprise-donnees.md` §4.7) — appliquer 8.1 % à une facture
  de 2015 fausse le document lui-même, ce qui est inacceptable sur une pièce à valeur légale.

**5.2 Immuabilité — le point le plus dangereux de tout ce chantier**

**Un document émis (`document_vente`) est verrouillé par trigger et ne peut pas être supprimé,
même par le rôle de reprise.** Corollaire : **une reprise de facturation ratée n'est pas
rejouable** une fois les documents passés à l'état `emis`. Le protocole d'écriture, imposé par
deux triggers réels (`document_vente_creation_brouillon` BEFORE INSERT,
`document_vente_verrouiller_apres_emission` BEFORE UPDATE), est en **deux temps obligatoires** :

```
1. INSERT document_vente   statut='brouillon' (imposé), numero=NULL, numero_sequence=NULL,
                            exercice=NULL, emis_le=NULL — tous imposés par CHECK dédiés
   INSERT ligne_document (× n), document_vente_tva (× régimes)
2. UPDATE document_vente   SET statut='emis', numero=numero_origine, exercice=…, emis_le=…
   → passe verifier_transition_document, et document_vente_verifier_periode (ZDFA5) —
     n'accepte l'émission que si aucune période comptable close ne couvre la date du document
3. Le document est désormais VERROUILLÉ. Un rejeu de l'import ne peut plus le toucher.
```

**Conséquences opérationnelles, non négociables :**

- Toute validation (encodage, format de date, cohérence Σlignes/total, calage préalable des FK
  client/véhicule/site) doit être **complète avant** le passage à l'étape 2. Une fois émis, un
  document faux ne se corrige que par un **avoir** — y compris sur un document repris (`D-24`),
  exactement comme un document créé dans DFA.
- La clôture d'une période comptable doit intervenir **après** l'import de tous les documents de
  cette période (phase 14, la dernière de l'ordonnancement §9.2 de `reprise-donnees.md`) — dans
  l'ordre inverse, l'erreur `ZDFA5` survient **après** que toutes les lignes du document ont déjà
  été écrites, ce qui coûte un nettoyage manuel, pas une simple relance.
- Le calage du compteur (§5.3) doit intervenir **après** la fin du chargement des documents de
  l'année en cours, jamais avant : caler tôt produit un compteur partiel, et la première facture
  DFA émise porte alors un numéro déjà consommé par un document repris chargé ensuite.

**5.3 Numérotation continue par tenant et par année**

**`D-23` — un document repris ne consomme jamais la séquence DFA.** Le numéro source est
conservé **verbatim** (préfixes, zéros de tête compris) dans `numero_origine`, jamais recalculé.
Le chargeur n'appelle jamais le service de numérotation DFA. En fin d'import, le compteur est
**calé une seule fois** au maximum observé par type et par année :

```sql
update compteur_document
   set valeur = greatest(valeur, :max_numero_source_annee_courante)
 where tenant_id = :tenant and type_document = 'facture' and annee = :annee_courante;
```

La non-collision est **structurelle**, pas disciplinaire : `document_vente_numero_uk` est un
index unique commun aux numéros émis et aux numéros repris, par `(tenant_id, type_document,
numero)`, et `document_vente_numero_origine_uk` empêche l'import du même numéro source deux fois
— l'idempotence de l'import est **garantie par la base**, même si la table de correspondance
applicative venait à être perdue.

**Le meilleur levier reste le calendrier, pas la technique** : basculer au 1ᵉʳ janvier fait
repartir la séquence DFA proprement, sans même avoir besoin de caler un compteur au milieu d'une
série. Détail : `reprise-donnees.md` §6.1.

**5.4 `document_vente.origine` et `ecart_reprise_centimes`**

`origine enum('dfa','reprise')` distingue les deux populations dans **la même table**, la même
recherche, la même fiche client — décision déjà tranchée et honorée en base (§8.2 de
`reprise-donnees.md`) : il n'existe **pas** de table d'archive séparée `document_repris`, ce
choix ayant été abandonné au profit de l'intégration directe. `ecart_reprise_centimes` n'est
autorisé **que** sur `origine='reprise'` (contrainte `document_vente_taux_tva_doc_reprise_chk`
et son équivalent sur l'écart) : un document créé dans DFA ne peut structurellement pas porter un
écart d'arrondi hérité — c'est une garantie de schéma, pas une convention de code.

**5.5 `tenant_id`, RLS, et le rôle `dfa_app`**

**L'import écrit avec `DATABASE_URL` (rôle `dfa_app`), jamais avec `DATABASE_URL_MIGRATION`
(rôle `dfa_migrator`).** `dfa_migrator` est propriétaire du schéma et ses politiques RLS sont
`using (true) with check (true)` — s'y connecter pour « simplifier » l'import désactiverait de
fait le RLS, exactement la faille que l'isolation tenant existe pour empêcher. `dfa_app` est
`NOSUPERUSER`/`NOBYPASSRLS`, sans aucun droit `DELETE` sur les tables métier, sauf `ligne_document`
(lignes de brouillon) — l'import se plie donc aux mêmes politiques, aux mêmes contraintes, aux
mêmes triggers que l'API. Quatre verrous cumulés garantissent que le `tenant_id` ne peut jamais
venir du fichier source : ligne de commande + double confirmation (`--tenant` et
`--confirmer-slug`), transaction scopée par `AccesBase.enTenant()` (`set_config('app.tenant_id',
…, true)`), et FK composites `(tenant_id, lot_id)` sur les tables de reprise elles-mêmes — détail
complet : `reprise-donnees.md` §5.4 (dispositif) et §9.3 (« import lancé avec
`DATABASE_URL_MIGRATION` » — le seul incident classé « silencieux et catastrophique » du
document).

**5.6 Le piège `timestamptz` → `Date` sur une insertion en lot**

**Constaté et corrigé dans ce dépôt** (`apps/api/src/common/pagination/valeur-temporelle.ts`,
en-tête) : le pilote `pg`, en configuration par défaut, parse un `timestamptz` en objet `Date`
JavaScript **avant même** que le code applicatif ne s'exécute — et `Date` ne représente que la
milliseconde, quand PostgreSQL stocke la microseconde. Sur une pagination par curseur keyset
`(cree_le, id) < (curseur, curseur.id)`, une valeur de curseur construite depuis un `Date` tronqué
exclut à tort toute ligne dont la microseconde réelle dépasse le seuil tronqué — **silencieusement**,
sans erreur. Le commentaire du correctif le dit explicitement : _« la cause générale frappe tout
lot de lignes qui partagent seulement la même milliseconde — typiquement une reprise de données
ou un import. »_

**Conséquence directe pour ce chantier**, sur deux fronts :

1. **Toute vérification post-import faite par pagination applicative** (parcourir `GET
/clients?tri=creeLe:desc` page par page pour vérifier un lot, par exemple) doit passer par le
   même mécanisme que l'API — sélection `::text` explicite + `valeurCurseurTimestamptz()` —
   jamais reconstruire un curseur à la main depuis une réponse JSON désérialisée en `Date`. Un
   contrôle de recette qui « perd » silencieusement des lignes en fin de page produirait un faux
   négatif exactement au moment où la confiance du garagiste se joue (`CR-06`, comptage de
   clients).
2. **Les requêtes de réconciliation du §3 ci-dessus ne doivent jamais s'appuyer sur une
   pagination applicative** — elles utilisent des agrégats SQL directs (`count(*)`, `sum(...)`,
   `group by`), qui ne passent pas par le pilote `pg` en mode `Date` et ne sont donc pas
   concernées par ce défaut. C'est un argument de plus, indépendant de la performance, pour tenir
   la doctrine déjà posée en `reprise-donnees.md` §12.3 : le comptage de preuve se fait par somme
   SQL, jamais en reconstituant un total à partir d'un parcours d'API paginé.

Les index de pagination existants incluent déjà `id` comme départage
(`document_vente_pagination_idx` sur `(tenantId, creeLe, id)`, `vehicule_pagination_idx` sur
`(tenantId, creeLe.desc(), id.desc())`) — ce qui protège la **base** contre l'ambiguïté d'ordre
entre deux lignes de même timestamp, mais ne protège **pas** un appelant qui reconstruit son
curseur depuis un `Date` tronqué : les deux défenses sont nécessaires, ni l'une ni l'autre ne
remplace l'autre.

---

6. Questions pour @laupernoe

---

**6.1 Décisions encore ouvertes (à trancher en observant un vrai garage)**

- 1 / Horizon de reprise des clients (`D-07`) / 5 ans sans document ni véhicule ⇒ archive froide / `reprise-donnees.md` §3
- 2 / Horizon de reprise de l'historique atelier (`D-08`) / 24 mois, 36 si le volume le permet / idem
- 3 / Numéro de client d'origine : dans `client.numero` ou `reference_externe` ? (`D-26`) / Option A — `numero` = numéro source verbatim / §10.2
- 4 / Expertise sans résultat connu : note ou expertise inventée ? (`D-28`) / Note véhicule, jamais de résultat inventé / §10.3
- 5 / L'ancien système accepte-t-il de forcer un numéro de facture ? (`QE-08`, marche arrière) / À tester en répétition générale (S-1) / §13.4
- 6 / L'archive froide : hébergée par DFA ou remise au garage ? / Remise au garage + copie chiffrée chez DFA 12 mois / §8.1

**6.2 Questions à poser au premier garage visité**

La liste complète (17 questions au garagiste `QG-01`→`QG-17`, 8 questions à l'éditeur
`QE-01`→`QE-08`) est en `reprise-donnees.md` §7.1-§7.2, formulées pour être posées devant l'écran.
Les trois qui débloquent le plus, dans l'ordre :

1. **`QE-01`** — demande d'export formelle envoyée à un éditeur **dès aujourd'hui** : c'est le
   seul délai qui se compte en semaines et ne dépend d'aucun travail préalable.
2. **`QG-06`+profilage** — une visite terrain (méthode §1 de `reprise-donnees.md`), une fiche
   d'inventaire remplie, un échantillon de 20 lignes par entité : transforme la moitié de ce
   document (les colonnes « rôle du champ source ») en travail exécutable.
3. **Le contrat de licence lu** — une heure, et ça peut décaler une bascule de six mois
   (reconduction tacite, clause de réversibilité, `R-01`/`R-04`).

**6.3 Ce qui manque avant d'écrire le premier chargeur**

Sans surprise : **un export réel**. `reprise-donnees.md` §14 recense 21 zones aveugles (`Z-01`
à `Z-21`) classées par ce qu'elles bloquent (écriture du premier chargeur, chiffrage, calendrier,
décisions produit). Une seule est résolue à ce jour (`Z-17`, ordre de réparation repris — voir
§2.5 ci-dessus). Toutes les autres attendent la même chose : une visite chez un vrai garage.

---

7. Ce qui reste à construire côté DFA — remontée pour arbitrage

---

Rien de ce qui suit n'est du code écrit par ce document (hors périmètre, cf. consigne permanente
du dépôt) — c'est la liste, déjà posée en `reprise-donnees.md` §5.2/§8.2/§14.4, de ce qui doit
exister avant qu'un premier import réel puisse s'exécuter :

- **Les tables de reprise elles-mêmes** (`lot_reprise`, `reprise_ligne_source`,
  `correspondance_reprise`, `reprise_anomalie`) ne sont **pas en base** (`Z-20`). Sans elles,
  l'idempotence (§4.1 ci-dessus) et la traçabilité (« d'où sort cette fiche ? » en trois
  secondes) sont des plans, pas des garanties.
- **La colonne `origine_lot_id`** sur les tables métier recevant un import (`client`, `vehicule`,
  `document_vente`, `ordre_reparation`…) n'existe pas davantage.
- **Le module `apps/api/src/reprise/`** (chargeurs, adaptateurs, CLI) n'existe pas — sa
  conception (arborescence, doctrine CLI plutôt qu'endpoint HTTP au lot pilote, connexion
  obligatoire en `dfa_app`) est posée en `reprise-donnees.md` §5.1, prête à être découpée en
  tâches par la session principale une fois qu'un premier export réel donne prise au travail.

Destinataire naturel : `expert-database` pour les deux premiers points (migration _expand_, sur
le modèle de `migrations/0011_ordre_reparation_origine_reprise.sql` qui vient de démontrer que ce
type de changement est peu coûteux tant qu'aucune donnée n'est en production).

---

8. Où trouver quoi

---

- Méthode d'investigation terrain complète (identifier le moteur, obtenir l'export, profiler la qualité sans rien casser) — `reprise-donnees.md` §1
- Checklist imprimable de visite chez un garage — `reprise-donnees-questionnaire.md`
- Mapping champ à champ exhaustif, avec toutes les pertes annoncées — `reprise-donnees.md` §2, corrigé par §10
- Règles de nettoyage (encodage, doublons, VIN, plaques, dates, montants, TVA d'époque) — `reprise-donnees.md` §4
- Conception technique de l'import (staging, idempotence, isolation tenant, nLPD) — `reprise-donnees.md` §5
- Ordre d'écriture des entités et ce qui casse si on l'inverse — `reprise-donnees.md` §9
- Pièges de correspondance du terrain suisse (VIN saisi à la main, plaque réattribuée, doublons, entreprise saisie comme particulier) — `reprise-donnees.md` §11
- Runbook horaire du week-end de bascule, marche arrière — `reprise-donnees.md` §13
- Zones aveugles restantes, classées par ce qu'elles bloquent — `reprise-donnees.md` §14
- Questionnaire métier plus large (au-delà de la seule reprise) — `questionnaire-garages.md`
