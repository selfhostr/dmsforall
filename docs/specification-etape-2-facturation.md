Spécification métier — Étape 2 : Facturation
============================================

> **Jalon** : fin d'étape 2 = **premier premier garage en production réelle** (ARCHITECTURE §6).
> C'est la première fois que DFA touche de l'argent réel, une déclaration TVA réelle et une
> fiduciaire réelle. Une erreur ici ne se corrige pas par un correctif : elle se corrige par une
> lettre à l'AFC.
>
> **Statut** : spécification métier — le _quoi_ et le _pourquoi_. Elle décide des règles de gestion
> et des parcours ; elle ne décide ni du schéma ni des endpoints.

---

Journal des arbitrages — révision du 29.07.2026
-----------------------------------------------

Trois hypothèses de la première rédaction ont été tranchées par @laupernoe. Elles sont répercutées dans
tout le document ; **aucune règle et aucun cas de test n'a été renuméroté**, y compris ceux qui
changent de sens ou de valeur. Les règles et cas modifiés portent la mention **`↻ révisé 29.07.2026`**.

- **A1** / Saisie HT ou TTC ? / **Toujours TTC**, y compris pour les entreprises. TVA détaillée en pied de facture uniquement / `RF-6`, `RF-35`, `RF-38`, `RF-39`, **`RF-40`**, `RF-42` → `RF-44`, `RF-78`, `RF-90`, `RF-96`, `RF-100` + **`RF-121`** → **`RF-123`** (nouvelles) / `CF-16`, `CF-18`, `CF-19`, `CF-20`, `CF-21`, `CF-22`, `CF-24`, `CF-25`, `CF-26`
- **A2** / Le client peut-il repartir sans avoir payé ? / **Oui, c'est courant.** Restitution et paiement sont indépendants, dans les deux ordres. Aucun blocage / **`RF-83`**, `RF-84`, `RF-98` / aucun (pas d'arithmétique)
- **A3** / Quelles fiduciaires au pilote ? / **WinBIZ** (prioritaire) et **iReach**. Abacus sort du périmètre / `RF-102`, `RF-106`, `RF-112` + §0.3 / `CF-27` (cibles renommées)

> **A1 était l'hypothèse marquée « irrattrapable après coup ».** Elle est fermée. Dériver la TVA
> depuis un TTC n'est pas l'inverse de l'ajouter à un HT : les arrondis ne tombent pas au même
> endroit. **Toute l'arithmétique de §10 a été réexécutée**, pas relue — script en `BigInt`, mêmes
> fonctions `arrondiCommercial()` / `arrondiCinqCentimes()`. Le détail de ce qui change et de ce qui
> ne change pas est en §10.0.

---

Sommaire
--------

- [0](#0-comment-lire-ce-document) — Comment lire ce document, périmètre, articulation
- [1](#1-vocabulaire--la-collision-à-régler-avant-tout) — Vocabulaire — la collision `devis`
- [2](#2-chaîne-documentaire-et-immuabilité) — Chaîne documentaire et immuabilité (`RF-1` → `RF-19`)
- [3](#3-numérotation) — Numérotation, concurrence, trous (`RF-20` → `RF-32`)
- [4](#4-montants-tva-remises-escompte) — Montants, TVA, remises, escompte (`RF-33` → `RF-52`, **`RF-121` → `RF-123`**)
- [5](#5-qr-facture) — QR-facture (`RF-53` → `RF-64`)
- [6](#6-paiements-et-lettrage) — Paiements et lettrage (`RF-65` → `RF-80`)
- [7](#7-de-latelier-à-la-facture) — De l'atelier à la facture (`RF-81` → `RF-100`)
- [8](#8-export-fiduciaire) — Export fiduciaire (`RF-101` → `RF-113`)
- [9](#9-qui-a-le-droit-de-faire-quoi) — Droits par rôle (`RF-114` → `RF-120`)
- [10](#10-cas-de-test-métier-chiffrés) — Cas de test chiffrés `CF-16` → `CF-27`
- [11](#11-hypothèses-à-valider-et-questions-ouvertes) — Hypothèses ⚠️ et questions ouvertes

---

0. Comment lire ce document

---

**0.1 Articulation avec les documents existants**

Trois documents se partagent la facturation. **Ils ne se recouvrent pas.**

- `docs/modele-documentaire-facturation.md` / Le **modèle** : tables, colonnes, contraintes, triggers, arithmétique / `MD-01` → `MD-95`, `AC-01` → `AC-25`, `PF-01` → `PF-05`, `QF-01` → `QF-13`, `CF-01` → `CF-15`
- **Ce document** / La **règle métier** : parcours, décisions de gestion, ce que le garagiste voit et fait / `RF-1` → `RF-120`, `CF-16` → `CF-27`
- `docs/specification-etape-1-atelier-clients.md` / L'amont : OR, lignes, devis complémentaires, clients / `RM-xx`, `P-xx`, `CT-xx`
- `docs/exports-fiduciaires.md` / Les **cibles d'export** : WinBIZ, iReach, Bexio, Banana, CSV — formats, mapping, questions ouvertes / `EF-xx`

**Règle de non-duplication.** Quand une décision est déjà prise par un `MD-xx`, ce document la
**cite** et n'en écrit pas une deuxième version. Deux formulations d'une même règle finissent
toujours par diverger, et c'est alors la base qui arbitre — c'est-à-dire personne.

**0.2 Continuité de la numérotation des cas de test**

Le brief demandait `CF-1`, `CF-2`… **`CF-01` à `CF-15` existent déjà** dans le modèle documentaire,
avec leur arithmétique exécutée. Les renuméroter créerait deux jeux de tests portant les mêmes
identifiants — exactement le genre de collision qui fait qu'un test rouge ne désigne plus rien.

**Décision : ce document reprend la série existante à `CF-16`.** Les quinze premiers cas restent
normatifs et sont rappelés en §10.1. Les douze nouveaux couvrent ce que le modèle documentaire ne
traite pas : le passage de l'atelier à la facture, la garantie, la prise en charge par un tiers, le
multi-moyens de paiement, la remise multi-taux et la correction d'adresse.

> **Arithmétique** : les valeurs de `CF-16` à `CF-27` ont été **calculées en exécution** avec les
> fonctions `arrondiCommercial()` et `arrondiCinqCentimes()` de `MD-40` et `MD-47`, en `bigint`. Les
> reproductions de `CF-01`, `CF-07`, `CF-14` et `CF-15` par le même script rendent exactement les
> valeurs publiées dans le modèle documentaire — c'est le contrôle qui garantit que les deux
> documents parlent de la même arithmétique. **Ce sont des attendus, pas des ordres de grandeur.**

**0.3 Périmètre de l'étape 2**

**Dans le périmètre :**

- Chaîne `devis commercial → bon de commande → facture → avoir`, verrouillage à l'émission.
- Facturation d'un OR terminé, y compris multi-payeur et facturation partielle dans le temps.
- QR-facture suisse conforme, PDF stocké avec son empreinte.
- Encaissements : espèces, carte, virement, QR, TWINT ; partiels, acomptes, trop-perçus, lettrage.
- Relance simple (niveaux et dates), sans automatisation d'envoi.
- Export fiduciaire par l'interface `AccountingExporter` — **WinBIZ (prioritaire)**, CSV générique,
  Bexio, Banana. Détail des formats : `docs/exports-fiduciaires.md`.
- Périodes comptables et clôture.

**Hors périmètre, explicitement :**

- Comptabilité interne (grand livre, bilan, décompte TVA) / DFA n'est pas un logiciel de compta. La fiduciaire tient les comptes / jamais
- Rapprochement bancaire camt.054 / phase 2 ; seules les colonnes support sont posées (`MD-76` et §5.5 du modèle) / après étape 2
- Vente de véhicule (dossier, reprise, financement, prime) / étape 4. Seule `dossier_vente_id` est posée, vide (`MD-70`) / étape 4
- Stock pièces, valorisation, marge sur pièce / étape 3 / étape 3
- **Abacus** / **Tranché (A3) : aucune fiduciaire du pilote n'est sur Abacus.** L'adaptateur demandait un agrément et un format à obtenir — le coût n'est plus justifié / étape 5, ou jamais
- Relance automatisée (envoi d'e-mails, mise en demeure, contentieux) / l'étape 2 pose les niveaux et les dates ; l'envoi reste manuel / étape 5

**Arbitrage A3 — les fiduciaires du premier garage sont WinBIZ et iReach.** C'est un **ordre de
priorité, pas une liste d'abandons.** DFA vise plusieurs garages suisses ; Bexio en particulier est
très répandu chez les PME et restera une cible utile. Ce qui change est l'ordre dans lequel les
adaptateurs s'écrivent — **le pilote décide de ce qui passe en premier, pas de ce qui existe.**

- **WinBIZ** / **1 — bloquant pilote.** Format établi et sourcé, `EF-10` → `EF-19` / Fiduciaire réelle du pilote, déjà au périmètre initial. C'est l'export qui doit fonctionner au jour 1
- **iReach** / **2 — bloqué par une question, pas par du code.** `EF-20` → `EF-29` / Information nouvelle. **Aucune spécification d'échange publique trouvée.** Une ambiguïté de fond est à lever avant d'écrire une ligne (`EF-20`)
- **CSV générique** / **3 — filet de sécurité** / Une fiduciaire sans connecteur reprend toujours un CSV. C'est aussi le repli si iReach reste indéterminé au moment du pilote
- **Bexio** / 4 — **différé, pas abandonné** / Aucune fiduciaire du pilote, mais **la cible la plus fréquente du marché suisse PME** et une API publique documentée. Le travail déjà fait la concernant reste valable et ne doit pas être supprimé
- **Banana** / 5 — **différé, pas abandonné** / Seule cible qui motivait le mode `agrege` (`RF-106`). Le mode reste au périmètre : c'est une capacité du cœur, pas une particularité de Banana
- Abacus / Hors périmètre / Aucune fiduciaire du pilote ; l'adaptateur demandait un agrément et un format à obtenir

> **Contrat partagé.** `CIBLES_EXPORT = ['winbiz', 'ireach', 'csv']` ne liste que les cibles du
> **pilote**. Bexio et Banana entreront dans l'enum quand leur adaptateur sera écrit — l'enum décrit
> ce qui est livré, la table ci-dessus décrit ce qui est prévu. Les deux ne disent pas la même chose
> et ne doivent pas être confondues.
>
> ⚠️ **`ireach` figure dans l'enum sans qu'aucun format soit établi.** C'est assumé et documenté ici
> pour que personne ne déduise de sa présence que l'adaptateur existe ou que son format est connu.
> Même remarque pour les codes d'erreur **`EXPORT_*`**, déclarés par avance dans le contrat partagé
> **sans contrat HTTP complet derrière** — même parti pris qu'au lot 1. Un code d'erreur déclaré
> n'est pas une fonctionnalité livrée.

⚠️ **À VALIDER AVEC @laupernoe — iReach.** _Les recherches identifient « iReach » comme un **DMS
automobile** édité par Automotive Systems (Bornem, BE), distribué en Suisse, embarquant son
**propre module comptable**. Si c'est bien ce produit, alors iReach n'est pas une cible d'export
fiduciaire mais un **DMS concurrent** — donc un sujet de reprise de données, pas de connecteur
comptable. La question à poser avant tout développement est en `EF-20`, et elle tient en une phrase :
**qui utilise iReach — le garage, ou sa fiduciaire ?** Les deux réponses mènent à deux chantiers
différents, dans deux étapes différentes._

---

1. Vocabulaire — la collision à régler avant tout

---

L'étape 1 a livré un objet nommé **devis** qui n'est pas celui de l'étape 2. Les deux existent, les
deux sont légitimes, et les confondre casserait la chaîne documentaire dès la première ligne de code.

- Contrat / `contrats/atelier/devis.ts`, `devis_complementaire` / `document_vente`, `type_document = 'devis'`
- Objet / Faire approuver des **travaux supplémentaires** découverts pendant l'intervention / Proposer un **prix** avant tout engagement
- Porté par / Un OR en cours / Un client, éventuellement un véhicule
- Émis vers / Le client par téléphone / SMS / e-mail (`CANAUX_DEVIS`) / Le client, en PDF
- Réponse / `accepte` / `refuse` / `partiel`, ligne par ligne, avec `interlocuteurNom` / `accepte` / `refuse` / `expire` / `remplace`
- Numéroté / Rang dans l'OR (`numeroOrdre` : 1, 2, 3…) / Série continue par tenant et par année (`MD-11`)
- Devient une facture / **Non**, jamais directement / Oui, via bon de commande ou directement

**`RF-1`** — Les deux objets coexistent sans lien de conversion. Un devis complémentaire accepté
**ne produit pas** de devis commercial : il débloque des lignes d'OR, lesquelles seront facturées
avec le reste de l'OR (§7).

**`RF-2`** — Dans l'UI et dans toute la documentation utilisateur, on dit **« demande d'accord »**
pour le devis complémentaire de l'atelier et **« devis »** pour le document commercial. Le
garagiste ne doit jamais avoir à demander « lequel des deux ». Le terme technique
`devis_complementaire` reste inchangé dans le code et les contrats — c'est un contrat gelé de
l'étape 1, et le renommer serait une rupture pour un gain d'affichage.

⚠️ **À VALIDER AVEC @laupernoe** — _« demande d'accord » est ma proposition ; le terrain dit peut-être
« devis complémentaire », « accord client » ou « OK client » (et `Kostenvoranschlag` / `Freigabe` en
DE). C'est le vocabulaire des réceptionnaires qui tranche, pas le mien._

**`RF-3`** — Vocabulaire des documents, figé pour l'i18n (clés `facturation.document.type.*`) :

- `devis` / Devis / Offerte / Preventivo
- `bon_commande` / Bon de commande / Auftragsbestätigung / Conferma d'ordine
- `facture` / Facture / Rechnung / Fattura
- `avoir` / Avoir / Gutschrift / Nota di credito
- `facture` + `nature = acompte` / Facture d'acompte / Anzahlungsrechnung / Fattura di acconto
- `bulletin_paiement` / Bulletin de versement / Zahlteil / Polizza di pagamento

⚠️ **À VALIDER AVEC @laupernoe** — _les traductions DE/IT sont à faire confirmer par `expert-i18n` contre
l'usage des garages alémaniques et tessinois. `Gutschrift` en particulier désigne aussi un avoir
bancaire ; certains garages disent `Rechnungskorrektur`._

**`RF-4`** — « Avoir » désigne **toujours** le document de correction (`type_document = 'avoir'`).
L'avance disponible d'un client (trop-perçu non imputé, `MD-57`) se dit **« avance client »**,
jamais « avoir ». Confondre les deux est ce qui pousse à créer un avoir pour matérialiser un
trop-perçu — l'erreur que `CF-11` interdit explicitement.

**`RF-5`** — « Émettre » est le seul verbe du passage brouillon → document définitif. Pas
« valider », pas « confirmer », pas « imprimer » : l'impression n'engage rien, l'émission engage
tout (`MD-18`).

**`RF-6`** — ↻ **révisé 29.07.2026 (A1) — renforcé.** Le montant affiché au client est **toujours**
le TTC, **au comptoir comme à l'écran comme sur le document, et quel que soit le type de client —
particulier ou entreprise**. Le HT n'apparaît **qu'au récapitulatif TVA en pied de facture**
(`RF-123`). La rédaction précédente réservait le TTC au comptoir et tolérait le HT « sur les écrans
internes » : cette tolérance est supprimée. Le prix annoncé au client est celui qu'il paie.

---

2. Chaîne documentaire et immuabilité

---

**2.1 Le principe**

```
   devis ──accepté──▶ bon de commande ──▶ facture ──▶ (paiements)
     │                      │                │
     │                      │                └──▶ avoir  (correction, jamais modification)
     │                      │
     │                      └──▶ facture d'acompte ──▶ facture finale (ligne « acompte déduit »)
     │
     └──▶ remplacé par un nouveau devis (jamais modifié)

   OR terminé ──▶ 1..n factures  (une par payeur, §7)
```

**`RF-7`** — Aucune étape n'est obligatoire sauf la facture. On peut facturer sans devis ni bon de
commande — c'est le cas courant de l'atelier. La chaîne décrit ce qui est **possible**, pas ce qui
est **imposé**.

**`RF-8`** — Un document ne peut avoir qu'un seul document source, et un document source ne peut
être transformé qu'une fois. Un devis accepté donne un bon de commande **ou** une facture, jamais
les deux. C'est ce qui empêche de facturer deux fois la même affaire par deux chemins.

**`RF-9`** — Le brouillon est le seul état modifiable (`MD-19`). Tant qu'un document est en
brouillon : aucun numéro, aucune référence QR, aucun PDF, aucune écriture comptable, aucune
existence pour la fiduciaire. Un brouillon abandonné ne laisse **aucune trace** dans les séries.

**`RF-10`** — L'émission est **irréversible** et il n'existe aucun chemin inverse : pas d'endpoint,
pas de droit, pas de rôle, pas de script de maintenance (`MD-22`). La question « qui peut annuler
une émission ? » a une réponse unique et définitive : **personne**.

**2.2 Le cas qui fait céder les systèmes : « juste corriger l'adresse »**

C'est le scénario réel, et c'est celui sur lequel tout système mal conçu ouvre une porte dérobée qui
finit par tout traverser.

> Vendredi 17 h 40. Le réceptionnaire émet la facture 2026-00318 pour CHF 566.63. Le client est
> encore au comptoir. En relisant, il voit « Rue de Berne 12 » au lieu de « Route de Berne 12 ». La
> facture n'a pas été envoyée, pas imprimée, pas payée. Le client attend, sa voiture aussi.

**`RF-11` — La réponse est un avoir. Sans exception, et la liste des exceptions refusées est
explicite** : y compris si le document n'a jamais été imprimé, y compris s'il n'a jamais été envoyé,
y compris le jour même, y compris à la seconde qui suit l'émission, y compris si le client est
d'accord, y compris si l'erreur vient de DFA, y compris pour un caractère.

La raison n'est pas le formalisme. Dès qu'il existe **un** cas où une facture émise se modifie, il
existe un chemin de code qui modifie une facture émise — et ce chemin ne sait pas distinguer une
coquille d'adresse d'un changement de montant. Le trigger de `MD-20` ne fait aucune exception
précisément pour qu'aucune ne puisse être ajoutée « juste pour ce cas-là ».

**`RF-12` — Le geste au comptoir reste un seul geste.** L'écran propose l'action
**« Corriger cette facture »**, qui exécute dans **une seule transaction** :

1. un **avoir total** référençant la facture 2026-00318, à la même date, aux mêmes taux (`MD-23`) ;
2. une **nouvelle facture** reprenant toutes les lignes, avec l'adresse corrigée ;
3. le lettrage automatique de l'avoir sur la facture annulée — solde 0.00 des deux côtés ;
4. la mise à jour de la fiche client si l'erreur y était (voir `RF-14`).

Le réceptionnaire clique une fois, corrige un champ, valide. Ce qu'il vit est « j'ai corrigé la
facture ». Ce que la base enregistre est trois documents immuables. **C'est une commodité d'écran,
pas une exception au modèle** — et c'est la seule manière d'obtenir l'adhésion du terrain sans
céder sur la règle.

**`RF-13`** — Les trois documents portent trois numéros consommés dans leurs séries respectives :
facture _n_, avoir _m_, facture _n+1_. **Ce n'est pas un trou** — les séries restent contiguës.
Le garagiste qui s'étonne de « sauter » des numéros de facture reçoit la réponse en une phrase :
chaque document existe, aucun ne manque, et l'avoir explique l'écart.

**`RF-14` — Corriger le document et corriger la donnée sont deux actions distinctes.** L'adresse
fausse vient presque toujours de la fiche client. La corriger sur la fiche est **libre et normal**
(c'est une donnée vivante) et **ne change rien** aux documents déjà émis, qui ont figé la leur
(`MD-24`). L'écran de correction propose donc explicitement : « corriger aussi la fiche client ? »
— coché par défaut, parce que sinon l'erreur reviendra à la facture suivante.

**`RF-15`** — L'avoir de correction porte un motif obligatoire, choisi dans une liste courte :
`erreur_adresse`, `erreur_montant`, `erreur_destinataire`, `erreur_taux`, `prestation_annulee`,
`geste_commercial`, `autre` (texte libre obligatoire). Le motif part dans le journal d'audit et sur
le PDF de l'avoir. Une fiduciaire qui voit trois avoirs le même jour demandera pourquoi ; la réponse
doit être dans le document, pas dans la mémoire du réceptionnaire.

**`RF-16`** — L'avoir de correction et la facture de remplacement portent **la même date de
document** que la facture d'origine si elle est dans la même période comptable ouverte ; sinon la
date du jour (`MD-34` interdit d'émettre dans une période close). Le cas « la facture de décembre
est fausse, on est en février et décembre est clos » produit donc trois documents datés de février —
et c'est correct : la correction est un événement de février (`MD-93`).

**2.3 Ce qui n'est pas une correction**

**`RF-17`** — Ces trois cas **ne passent pas** par un avoir, et les confondre est l'erreur la plus
fréquente :

- Le client paie moins que dû (escompte accordé) / imputation `escompte` (`MD-71`) / La facture est juste. C'est le règlement qui est réduit
- Le client paie trop / avance client (`MD-57`, `CF-11`) / Aucun document n'est faux. Un avoir créerait de la TVA récupérée à tort
- La créance est abandonnée / imputation `perte` (`MD-72`) / La prestation a bien eu lieu. L'annuler falsifierait le chiffre d'affaires

**`RF-18`** — Un avoir **partiel** corrige une partie des lignes (`MD-23`). Il sert quand une seule
prestation est contestée sur une facture de vingt lignes. Il ne sert **jamais** à ajuster un montant
« pour tomber juste » : un avoir partiel reprend des lignes existantes, il n'invente pas un montant.

**`RF-19`** — Un duplicata est une **réimpression du PDF stocké**, à l'identique, y compris le QR
(`MD-77`). Il ne consomme pas de numéro, ne crée pas de document, et n'est pas régénéré : c'est
l'octet-pour-octet du fichier conservé qui est renvoyé (`MD-95`).

⚠️ **À VALIDER AVEC @laupernoe** — _faut-il imprimer la mention « DUPLICATA » sur une réimpression ? La
pratique varie : certaines fiduciaires l'exigent pour éviter qu'un double serve de justificatif deux
fois ; d'autres refusent qu'un duplicata diffère de l'original. Techniquement, une mention ajoutée
change le fichier et donc son empreinte — il faudrait alors deux PDF, l'original scellé et le
duplicata tamponné._

---

3. Numérotation

---

**3.1 Le principe et sa raison**

**`RF-20`** — Les séries `facture` et `avoir` sont **continues, sans trou, par tenant et par
exercice** (`MD-32`). Ce n'est pas une préférence de présentation : une suite `…317, 319, 320…`
oblige le garagiste à justifier le 318 devant l'AFC, et une justification absente fait présumer une
facture soustraite. Le coût d'un trou ne se mesure pas en confort, il se mesure en contrôle fiscal.

**`RF-21`** — Les séries `devis` et `bon_commande` utilisent le même mécanisme mais un trou n'y est
qu'un **avertissement** : ces documents n'ont pas de valeur fiscale. Le job de contrôle distingue
les deux niveaux (`MD-32`).

**`RF-22`** — Le numéro n'est attribué **qu'à l'émission** (`MD-19`). Il n'existe aucune
« réservation » de numéro, aucun numéro « à remplir plus tard » (`MD-31`). Un garagiste qui demande
« peux-tu me réserver le 400 pour lundi ? » reçoit non — et la raison : un numéro réservé et non
utilisé est exactement un trou.

**3.2 Deux factures à la même seconde**

Le cas est banal dès qu'il y a deux comptoirs, ou un comptoir et un atelier, ou simplement un
double-clic.

**`RF-23`** — La concurrence est résolue **en base**, par une ligne de compteur verrouillée dans la
transaction (modèle §2.3, `MD-28` → `MD-30`), jamais par une séquence Postgres, jamais par un verrou
applicatif, jamais par un `SELECT max(numero) + 1`.

**`RF-24`** — Comportement observable, qui est ce que la spec garantit au métier :

- Deux émissions simultanées, même tenant, même série — Deux numéros consécutifs distincts. La seconde transaction attend la première, quelques millisecondes
- Deux émissions simultanées, tenants différents — Aucune attente. Les compteurs sont des lignes distinctes
- Émission qui échoue après l'allocation — **Aucun numéro consommé.** Le `ROLLBACK` rembobine le compteur (modèle §2.3)
- Double-clic sur « Émettre » — Un seul document. `Idempotency-Key` obligatoire sur l'émission
- Panne serveur entre l'allocation et le `COMMIT` — Aucun numéro consommé. La transaction n'a jamais eu lieu

**`RF-25`** — L'émission est **idempotente** : rejouer la même requête avec la même
`Idempotency-Key` rend le **même** document, avec le même numéro, sans en créer un second. C'est ce
qui protège du réseau instable au comptoir — le cas où le réceptionnaire ne sait pas si ça a marché
et reclique.

**`RF-26`** — Tout ce qui peut échouer s'exécute **avant** l'allocation du numéro (`MD-28`) :
contrôles métier, période comptable, bloc créancier QR complet, plafonds de remise, contrôle des
avoirs, calcul et gel du payload QR. Après l'allocation il ne reste que l'écriture du document et
l'audit. **La génération du PDF est postérieure au `COMMIT`** (`MD-29`) : un PDF qui échoue est un
incident d'exploitation qu'on rejoue, pas un trou dans la comptabilité.

**`RF-27`** — Quand une transaction émet plusieurs documents d'un coup (facture client + facture
assurance dans le même geste), les numéros sont alloués dans un **ordre déterministe** (`MD-30`).
Sans cet ordre, deux transactions symétriques s'interbloquent — et un interblocage est une
transaction avortée, donc une facture non émise devant un client qui attend.

**3.3 Le trou accidentel : ce qu'on fait quand il arrive quand même**

Le dispositif rend le trou quasi impossible. « Quasi » n'est pas « impossible », et un plan qui
n'existe qu'en cas de succès n'est pas un plan.

**`RF-28` — Détection.** La requête de continuité (modèle §2.4, `MD-32`) tourne à trois moments : après chaque
émission en test d'intégration, **chaque nuit** en job, et **avant chaque export fiduciaire de
manière bloquante**. Un trou détecté avant l'export ne part jamais chez la fiduciaire.

**`RF-29` — Un trou ne se bouche jamais.** Il est formellement interdit de créer un document pour
combler une séquence, de renuméroter un document existant, ou de décaler les suivants. Un document
fabriqué après coup pour boucher un trou est un **faux**, et il est bien plus grave que le trou.

**`RF-30` — Procédure quand un trou est constaté**, dans cet ordre :

1. **Bloquer l'export** de la période concernée (automatique, `RF-28`).
2. **Établir la cause** depuis le journal d'audit et les logs : le numéro a-t-il été alloué ? à
   quelle transaction ? qu'est-elle devenue ? Le compteur étant transactionnel, un trou signale un
   défaut réel — corruption, intervention manuelle en base, ou bug — jamais un aléa normal.
3. **Rédiger une note d'incident datée**, conservée avec les pièces comptables de l'exercice :
   numéro manquant, date, cause établie, personne ayant constaté. C'est cette note qui répond au
   contrôle fiscal ; son absence est ce qui coûte cher, pas le trou lui-même.
4. **Informer la fiduciaire** avant qu'elle ne le découvre. Un trou annoncé est un incident ; un
   trou découvert est un soupçon.
5. **Corriger la cause.** La série reprend à sa valeur courante — on ne revient pas en arrière.

**`RF-31`** — Il n'existe **aucun `DELETE`** sur un document de vente, quel que soit le rôle, y
compris `admin`, y compris en brouillon (un brouillon passe en `abandonne`, `MD-19`). Le privilège
`DELETE` n'est pas accordé au rôle applicatif en base — même patron que `ligne_or` en étape 1
(`RM-71`). C'est la seule garantie qui résiste à un bug.

**`RF-32` — Un document annulé n'est pas un trou.** Une facture annulée par avoir garde son numéro,
sa place dans la série et sa visibilité. Elle apparaît dans les listes avec son statut
`annule_par_avoir` et le lien vers l'avoir. C'est ce que la fiduciaire veut voir : le document
existe, il est neutralisé, et par quoi.

---

4. Montants, TVA, remises, escompte

---

**4.1 Les invariants non négociables**

**`RF-33`** — Tout montant est un **entier de centimes** (`MD-35`). Aucun flottant, nulle part,
jamais — ni en base, ni en TypeScript, ni dans un payload d'API, ni dans un export. La règle ESLint
d'`AC-23` la rend mécanique.

**`RF-34`** — Les taux 2026 : **8.1 % normal, 2.6 % réduit, 3.8 % hébergement**, représentés en pour
mille (`81`, `26`, `38`) — exact et sans décimale perdue (`MD-36`).

**`RF-35`** — ↻ **révisé 29.07.2026 (A1) — même règle, raison renforcée.** La TVA se calcule **par
ligne**, puis s'agrège (`MD-44`). Jamais sur le total. L'écart avec l'autre méthode admise est d'un
centime sur une facture d'atelier de quatre lignes (`CF-03`) — négligeable en valeur, **non
négligeable en réconciliation**.

Depuis `RF-40`, cette règle n'est plus une préférence : elle est **la condition de `RF-122`**. En
ancrage TTC, chaque ligne vérifie `TTC = HT + TVA` par construction ; sommer les lignes propage
l'égalité au document. Calculer la TVA sur la base agrégée la casserait, et le total TTC annoncé au
client ne serait plus la somme de ce qui est déclaré. **`RF-35` est désormais une règle
structurelle, et non un choix de méthode.**

**`RF-36`** — Le taux applicable est celui de la **date de prestation**, pas de la date de facture
(`MD-39`). Un service exécuté le 28 décembre et facturé le 4 janvier porte le taux de décembre. La
ligne d'OR porte déjà `date_prestation` (`AC-04`).

**`RF-37`** — Un avoir hérite **obligatoirement** des taux de la facture qu'il corrige (`MD-23`),
jamais des taux courants. C'est le piège qui se déclenche au premier changement de taux, et il s'est
déjà produit une fois (7.7 % → 8.1 % au 01.01.2024). `CF-09` chiffre le dégât : CHF 4.00 de TVA
récupérée à tort sur une facture de CHF 1'077.00.

**`RF-38`** — Le total d'une facture est **exact au centime**. L'arrondi au 5 centimes appartient au
**paiement en espèces** et à lui seul (`MD-47`). Arrondir le document rendrait faux tout autre moyen
de paiement — et surtout le montant encodé dans le QR.

**4.2 Tout est TTC — arbitrage A1**

> **Décision de @laupernoe, 29.07.2026.** Les prix sont saisis et affichés **TVA comprise**, sans
> exception, y compris pour les clients entreprise. La TVA est **détaillée en pied de facture**.
> _Le prix annoncé au client est celui qu'il paie._
>
> C'était l'hypothèse marquée irrattrapable après coup, parce qu'aucune relecture ne permet de
> retrouver, six mois plus tard, quel mode portait une ligne donnée. Elle est fermée.

**`RF-39`** — ↻ **révisé 29.07.2026 (A1) — la règle change de sens, le numéro est conservé.**

_Ancienne rédaction_ : chaque ligne porte son mode de calcul (`ht` ou `ttc`), au choix.
_Nouvelle rédaction_ : **toute ligne produite par DFA est en mode `ttc`.** La colonne
`mode_calcul_tva` de `MD-43` **est conservée** — elle reste figée avec le reste du document — mais
elle ne prend qu'une seule valeur pour tout ce que DFA émet.

La colonne n'est pas supprimée, et ce n'est pas de la prudence de façade. Trois raisons la rendent
nécessaire :

1. **Les documents repris** (`origine = 'reprise'`, `CF-12`) viennent d'Auto-i et de Nextlane, où
   les lignes étaient en HT. Ils doivent se relire à l'identique dix ans plus tard.
2. **Les documents déjà émis** avant cette révision, s'il en existe au moment de la bascule, portent
   leur mode d'origine et ne se recalculent pas (`MD-20`).
3. Un enum figé à une seule valeur en pratique reste **auto-descriptif en base**. Une colonne
   supprimée, elle, ne se retrouve pas.

**Conséquence directe sur `CF-13`** : le cas garde toute sa valeur mais change de rôle. Il ne
démontre plus un arbitrage à faire — il **prouve que l'arbitrage retenu est le seul tenable**.
Vérifié en exécution : entre CHF 1.00 et CHF 4'000.00, **29 965 montants TTC sont inatteignables en
mode `ht`** ; en mode `ttc`, il y en a **zéro, par construction**. Un garage qui affiche « 70.— » en
vitrine peut désormais émettre une facture à 70.00. `CF-13` devient un test de non-régression :
le jour où quelqu'un proposera de « réintroduire la saisie HT pour les entreprises », il est la
réponse.

**`RF-40` — ↻ révisé 29.07.2026 (A1) — la règle change entièrement de contenu, le numéro est
conservé parce que du code et d'autres documents le citent.**

_Ancienne rédaction_ : un tableau de modes par défaut par type de ligne (main-d'œuvre en `ht`,
forfaits et pièces en `ttc`…), paramétrable par tenant et surchargeable par ligne.
**Cette table est supprimée. Elle n'est remplacée par aucune autre.**

- **Tous**, sans exception / `ttc` / **TTC**

Il n'y a plus de défaut par type de ligne, plus de paramètre de tenant `mode_calcul_tva`
(`PF-01` perd cette entrée), et **plus de surcharge par ligne**. Un réglage qui n'a qu'une valeur
n'est pas un réglage : c'est une porte laissée ouverte. Les deux seuls cas particuliers survivants
ne sont pas des exceptions au mode mais des contraintes de cohérence :

- `acompte_deduit` / Reprend obligatoirement le mode de la facture d'acompte — donc `ttc` pour toute facture d'acompte émise par DFA / `MD-55`, `CF-07`, `RF-78`
- Ligne de répartition (franchise, prise en charge) / Identique des deux côtés — donc `ttc` des deux côtés, **trivialement satisfait** / `MD-63`, `RF-96`, `CF-20`

**Ce que ce changement fait disparaître, et qu'il faut nommer** : `CF-10` chiffrait à CHF 37.47 la
fuite de base provoquée par une ligne de répartition saisie en `ht` d'un côté et `ttc` de l'autre.
**Cette classe de bug n'est plus atteignable depuis l'interface.** Le garde-fou reste néanmoins
testé au niveau du moteur de calcul (§10.14) : une règle qui n'est plus violable par l'UI reste
violable par un import, une reprise ou une régression.

**`RF-121` — Conversion des tarifs à la bascule. ✚ nouvelle règle (A1).**

`RF-40` change **l'unité** dans laquelle un tarif est exprimé, pas sa valeur économique. Un taux
horaire de « 165.00 » saisi avant la bascule signifiait 165.00 HT ; après, « 165.00 » signifierait
165.00 TTC — soit **7.5 % de chiffre d'affaires perdu en silence** sur chaque heure vendue. Une
bascule qui se contenterait de changer l'étiquette serait une baisse de prix non décidée.

**Règle de conversion, appliquée une fois, à la migration du paramétrage** :

```
prix_unitaire_ttc = arrondiCommercial(prix_unitaire_ht × (1000 + taux), 1000)
```

Elle préserve la recette du garage au centime près sur l'unité. Exemples vérifiés en exécution, au
taux 81 ‰ :

- 165.00 /h / **178.37** /h / Le tarif atelier de référence de `CF-01`, `CF-18`, `CF-19`, `CF-20`
- 155.00 /h / **167.56** /h / Tarif garantie constructeur (`CF-19`)
- 18.50 /L / **20.00** /L / Tombe sur un montant rond — cas favorable
- 142.50 / **154.04** / Pompe à eau (`CF-19`)
- 24.90 / **26.92** / Filtre à huile (`CF-01`)
- 3.50 / **3.78** / Taxe d'élimination (`CF-01`)

Trois obligations autour de cette conversion :

1. **Elle est proposée, jamais appliquée en silence.** L'écran de bascule affiche la table complète
   ancien tarif → nouveau tarif, et le garagiste valide. C'est sa grille de prix, pas la nôtre.
2. **Le résultat est rarement un prix rond**, et c'est précisément le moment où le garage voudra
   arbitrer : 178.37 /h se réécrit naturellement en 178.00 ou 180.00. **Ce choix lui appartient** et
   DFA ne doit ni l'imposer ni le suggérer — c'est une décision commerciale, pas arithmétique.
3. **La conversion ne touche aucun document émis.** Les documents figés gardent leurs montants et
   leur mode (`MD-24`, `RF-39`).

⚠️ **À VALIDER AVEC @laupernoe** — _le garage veut-il conserver ses tarifs au centime (178.37 /h) ou
arrondir sa grille à des valeurs affichables (178.00, 180.00) ? La conversion mécanique est neutre
et sans perte ; l'arrondi est une décision de prix. Cette question doit être posée **avant** la
bascule du paramétrage, pas après la première facture._

**`RF-122` — Le TTC annoncé fait foi. ✚ nouvelle règle (A1), invariant central.**

> **`Σ HT des lignes` + `Σ TVA des lignes` = `TTC annoncé`, exactement, au centime, toujours.**

Ce n'est pas un contrôle de cohérence parmi d'autres : c'est **la promesse faite au client de vive
voix**, et c'est elle qui arbitre en cas de conflit.

**En cas d'écart d'arrondi, c'est le total TTC qui l'emporte.** Jamais le HT, jamais la TVA. Le HT
et la TVA sont des grandeurs _dérivées_ du TTC ; le TTC est la seule qui ait été prononcée à voix
haute au comptoir.

Comment l'invariant est tenu, mécaniquement :

- Ligne simple / `TVA = arrondi(TTC × taux, 1000 + taux)`, `HT = TTC − TVA` / **Non.** `TTC = HT + TVA` par construction (`MD-43`)
- Document = somme de ses lignes / `RF-35` : la TVA du document est la somme des TVA de ligne / **Non.** L'égalité se propage par addition
- Remise de pied de facture / Ventilée au prorata des **bases TTC**, résidu absorbé par `RF-44` / **Non.** `Σ parts = remise saisie` au centime
- **Prix « tout compris » négocié** / Le garagiste annonce un TTC qui n'est pas la somme des lignes / **Oui — et c'est le seul cas.** Traité ci-dessous

**Le cas du prix « tout compris »** est celui qui donne sa raison d'être à la règle. Le
réceptionnaire annonce « je vous fais ça à 1'300.— tout compris » sur un document dont les lignes
totalisent 1'317.20. L'écart de CHF 17.20 **n'est pas une erreur d'arrondi** : c'est une remise, et
elle doit exister comme telle. Elle est ventilée au prorata des bases TTC comme n'importe quelle
remise de pied de facture (`RF-42`). Vérifié en exécution sur les lignes de `CF-24` :

```
lignes brutes TTC        =  86480 + 43240 + 12000  = 141720 ct
cible annoncée                                     = 130000 ct
remise à ventiler                                  =  11720 ct
parts au prorata TTC     =   7152 +  3576 +   992  =  11720 ct   ✅ (résidu 0)

total_ht  = 121084 ct        total_tva = 8916 ct
Σ HT + Σ TVA = 130000 ct     = TTC annoncé                       ✅ exact
```

**Ce qui est formellement interdit** : absorber un écart en modifiant la TVA d'une ligne au forçage,
ou en créant une ligne d'ajustement sans taux. Les deux produisent une base TVA fausse — invisible
sur le total, découverte au décompte trimestriel. L'écart se ventile, ou il n'existe pas.

**`RF-123` — Où le HT a le droit d'apparaître. ✚ nouvelle règle (A1).**

- Ligne de document (écran et PDF) — **Non.** Prix unitaire TTC, montant de ligne TTC
- Total du document — **Non.** TTC uniquement
- **Récapitulatif TVA en pied de facture** — **Oui** — une ligne par couple (régime, taux) : base HT, taux, montant de TVA. C'est le seul endroit
- Écran de saisie, y compris pour un client entreprise — **Non** (`RF-6` révisé)
- Export fiduciaire, écritures comptables — **Oui**, évidemment — la comptabilité est tenue en HT + TVA (§8)
- Écrans de rentabilité atelier, marge, statistiques internes — **Oui** — ce ne sont pas des documents client

Le récapitulatif de pied reste **obligatoire** : c'est une mention légale (LTVA, `QF-11`), pas un
confort d'affichage. Une facture TTC sans ventilation de TVA n'est pas déductible par un client
assujetti — et le premier client entreprise qui s'en aperçoit rappelle le garage.

**Ce que le garagiste perd, et qu'il faut assumer.** Il raisonnait HT sur son taux horaire, parce
que c'est la base de son calcul de rentabilité atelier. Il ne verra plus ce HT sur l'écran de
facturation. Il le retrouve à deux endroits, et l'UI doit les rendre évidents : le récapitulatif TVA
du document, et les écrans de rentabilité (`RF-123`, dernière ligne). **Si le terrain rejette ce
point, c'est l'ergonomie qui doit s'adapter, pas la règle de saisie** — le mélange des deux unités
sur un même écran est exactement ce que A1 ferme.

**4.3 Rabais de ligne, rabais de pied de facture, escompte**

Trois choses différentes que le terrain appelle parfois du même mot. La distinction n'est pas
académique : elles ne se comptabilisent pas pareil et n'ont pas le même effet sur la TVA.

**`RF-41` — Le rabais de ligne** est le cas normal (`MD-58`). En pour mille ou en montant, **jamais
les deux** (`MD-41`). ↻ **révisé (A1)** : il réduit désormais la **base TTC** de la ligne, avant
dérivation de la TVA. Le client qui négocie « 10 % sur les pièces » négocie 10 % de ce qu'il paie.

**`RF-42` — Le rabais de pied de facture** (« remise globale ») est saisi une fois, **en TTC**,
affiché une fois sur le document — le client voit bien « Remise fidélité : CHF −100.00 » — et
**ventilé sur toutes les lignes au prorata de leur base TTC** (`MD-59`).
↻ **révisé (A1) : le prorata porte sur les bases TTC, plus sur les bases HT.** La remise saisie est
elle-même un montant TTC : c'est ce que le client voit tomber du total.

**`RF-43`** — ↻ **révisé (A1) — même règle, chiffres recalculés, et le profil de l'erreur a
changé.** La ventilation est **obligatoire, y compris sur une facture mono-taux**, pour une raison
d'uniformité : une règle qui ne s'applique que parfois est une règle qu'on oublie d'appliquer le jour
où elle compte.

Sur une facture multi-taux, ne pas ventiler produit toujours une **déclaration TVA fausse**, mais
l'erreur ne se cache plus au même endroit :

- Grandeur rigoureusement identique dans les deux variantes / **le total HT** (CHF 1'220.00) / **le total TTC** (CHF 1'317.20)
- Écart de TVA / CHF 0.74 / **CHF 0.63**
- Écart de HT / **aucun** / **CHF 0.63** (en sens inverse)
- Écart sur la base déclarée au taux normal / CHF 9.09 / **CHF 7.84**

L'erreur reste **invisible pour le client** — il paie exactement le même total dans les deux
variantes, et c'est ce qui la rend dangereuse. Mais elle devient **visible en interne** : le total
HT diffère désormais de 63 centimes, là où il était auparavant identique au centime. `CF-24`
chiffre les deux variantes. C'est une amélioration réelle de détectabilité, pas une régression.

**`RF-44`** — Le résidu d'arrondi de la ventilation va à la ligne de plus grande base **TTC** ; à
égalité, à celle dont l'ordre d'affichage est le plus petit (`MD-60`). L'invariant
`Σ parts = remise saisie` tient au centime (`CF-06`), et il est ce qui rend `RF-122` mécanique.

Le résidu est réel et se produit sur des montants ordinaires. Sur les bases TTC de `CF-24`
(86'480 / 43'240 / 12'000 centimes), vérifié en exécution :

```
remise  4 ct → parts  2 +  1 +  0 =  3   résidu +1
remise  6 ct → parts  4 +  2 +  1 =  7   résidu −1
remise 17 ct → parts 10 +  5 +  1 = 16   résidu +1
remise 19 ct → parts 12 +  6 +  2 = 20   résidu −1
```

Le résidu tombe **dans les deux sens** — un dispositif qui ne saurait qu'ajouter serait faux une
fois sur deux.

**`RF-45` — Le type de ligne `remise` de l'étape 1 (`RM-63`) n'est pas utilisé en facturation.** Une
ligne de remise en pied de document imputerait la remise sur un taux arbitraire. DFA ventile
toujours ; la ligne `remise` reste dans l'enum pour l'OR mais ne produit jamais de ligne de facture
autonome.

**`RF-46` — L'escompte n'est pas un rabais.** Un rabais est décidé à la facturation et réduit le
document. Un escompte est **conditionnel au comportement de paiement** et ne peut donc pas être
connu à l'émission. Il vit sur le paiement, en imputation de nature `escompte` (`MD-71`), avec
correction proportionnelle de TVA. `CF-14` démontre que le calcul tombe juste au centime : la TVA
nette due est exactement celle qu'on aurait calculée si la facture avait porté le montant escompté
dès le départ.

**`RF-47`** — L'escompte n'est **jamais appliqué automatiquement**. Le client qui paie dans les
délais verse le montant escompté ; le rapprochement constate un écart, et l'écran propose au
comptable : _« Écart de CHF 69.18 — escompte 2 % à 10 jours, paiement reçu au 8ᵉ jour : accorder ? »_
Accorder est un clic, mais c'est un clic humain.

**`RF-48`** — Un escompte réclamé **hors délai** ne se refuse pas automatiquement non plus. Le solde
reste ouvert et l'écran signale « escompte pris hors délai (25ᵉ jour pour 10 jours convenus) ». Le
comptable accorde par geste commercial ou relance. `CF-26` fixe le comportement attendu : **aucune
imputation automatique, solde ouvert de CHF 69.18, statut `partiel`**.

⚠️ **À VALIDER AVEC @laupernoe** — _les garages accordent-ils réellement des escomptes ? C'est courant en
B2B (flottes, assurances, sous-traitance entre garages) et rare au comptoir particulier. Si aucun
garage du parc ne pratique l'escompte, `PF-04` reste à « 30 jours net, sans escompte » et tout le
dispositif dort sans coûter — mais il ne faut pas le supprimer, il faut le désactiver._

**4.4 Arrondi au 5 centimes**

**`RF-49`** — L'arrondi au 5 centimes s'applique **uniquement à un encaissement en espèces**, et
uniquement à celui qui **solde** le document. Les centimes n'ayant plus cours physique, la caisse ne
peut pas rendre 204.31 ; elle rend 204.30.

**`RF-50`** — Sur une facture réglée par plusieurs moyens, seule la **part encaissée en espèces**
est arrondie, et seulement si elle est la dernière (`CF-22`). Une part espèces intermédiaire est
encaissée pour son montant exact — sinon deux arrondis successifs sur la même facture produiraient
un écart de 4 centimes que personne ne saurait expliquer.

**`RF-51`** — L'écart d'arrondi est **matérialisé** en imputation de nature `arrondi`, valeur dans
`{−2, −1, 0, +1, +2}` centimes, sur un compte dédié (`MD-49`). Il n'est **jamais** absorbé dans le
montant encaissé : le contrôle de caisse du soir doit tomber juste au centime sur ce qui est
physiquement dans le tiroir.

**`RF-52`** — L'arrondi descend et monte (`CF-05`) : `204.31 → 204.30` et `204.33 → 204.35`. Un
arrondi qui ne descendrait jamais serait un arrondi qui vole le client, et il se verrait au premier
contrôle.

⚠️ **À VALIDER AVEC @laupernoe** — _`arrondi_especes_actif` (`AC-20`) est-il activé par défaut ? Un garage
qui n'encaisse plus d'espèces (de plus en plus fréquent) n'en a jamais besoin. Proposition : actif
par défaut, car le désactiver à tort est sans conséquence tant qu'aucune espèce n'entre._

---

5. QR-facture

---

> Référence : _Swiss Payment Standards — Implementation Guidelines QR-bill_. **Tout ce qui suit est
> à revérifier contre la version en vigueur au moment d'implémenter** : la spécification est
> vivante et a déjà supprimé une fonctionnalité en cours de route (l'adresse combinée, type `K`).
> Le contrôle se fait contre le document officiel, pas contre ce fichier.

**5.1 Obligatoire, facultatif, interdit**

**`RF-53`** — Toute facture émise en CHF ou EUR **porte une section paiement QR**. Ce n'est pas une
option : une facture sans QR est refusée par le client ou payée à côté, et le garage l'apprend une
semaine plus tard.

**`RF-54` — Un tenant dont le bloc créancier est incomplet ne peut pas émettre de facture**
(`PF-03`). L'émission est **refusée**, avec un message qui nomme le champ manquant et un lien vers
l'écran de paramétrage. C'est volontairement brutal : l'alternative — émettre une facture sans QR —
transforme un blocage de trente secondes en une créance non payée.

**`RF-55` — Le type de référence découle du type d'IBAN, et n'est pas un choix** (`MD-74`) :

- **QR-IBAN** (IID 30000–31999) / **QRR** — 27 chiffres, obligatoire / SCOR, NON
- IBAN ordinaire / **SCOR** (ISO 11649) ou **NON** / QRR

**`RF-56` — Ce qui est obligatoire dans le payload** : le type QR, la version, l'encodage, l'IBAN,
le bloc créancier **complet en adresse structurée**, la devise, le type de référence et le trailer
`EPD`.

**`RF-57` — Ce qui est facultatif** : le montant (un QR sans montant est valide — le payeur le
saisit), le bloc débiteur, le message non structuré, l'information de facturation Swico, les
procédures alternatives.

**`RF-58`** — Devise **CHF ou EUR uniquement**, montant de 0.01 à 999'999'999.99 (`MD-81`). Une
facture dans une autre devise existe, mais sa section paiement est remplacée par les coordonnées
bancaires en clair. ⚠️ **À VALIDER AVEC @laupernoe** — _un garage suisse facture-t-il jamais en EUR ?
Frontaliers, clients français ou allemands, véhicules exportés : le cas existe peut-être, et il
change les paramètres de compte bancaire._

**5.2 Le client du comptoir qui n'a pas d'adresse complète**

Cas fréquent et parfaitement légitime : un passage, un touriste en panne, un client dont la fiche
n'a que le nom et le téléphone parce qu'il a payé cash en trois minutes.

**`RF-59` — Le bloc débiteur est omis en entier, jamais partiellement** (`MD-79`). Une adresse
incomplète (nom sans rue, ou sans NPA) produit un payload **invalide** que la banque refuse. Sans
bloc débiteur, le payeur écrit son adresse à la main sur le bulletin et le paiement passe.

> **Règle d'or** : mieux vaut un QR valide et incomplet qu'un QR complet et refusé au guichet.

**`RF-60`** — Le bloc débiteur est donc émis **si et seulement si** les cinq champs sont présents :
nom, rue, numéro, NPA, localité (+ pays, par défaut `CH`). Un seul manquant → aucun bloc débiteur.
Le contrôle est mécanique, jamais laissé au jugement de l'utilisateur.

> **⚠️ `RF-60` est plus stricte que la norme SIX — écart documenté, non tranché.**
>
> La norme n'impose que **nom, NPA, localité et pays**. **Rue et numéro sont facultatifs.**
> `RF-60` les exige en plus, et fait donc tomber le bloc débiteur pour des adresses que les banques
> **accepteraient** :
>
> - Adresse / Norme SIX / `RF-60` actuelle
> - Case postale 42, 1950 Sion / ✅ acceptée / ❌ bloc débiteur omis
> - Les Rasses, 1450 Sainte-Croix (lieu-dit sans numéro) / ✅ acceptée / ❌ bloc débiteur omis
> - Hameau sans numérotation, commune rurale / ✅ acceptée / ❌ bloc débiteur omis
>
> **Ces cas sont courants en Suisse rurale — donc chez des clients de garage.** Ce n'est pas un
> détail théorique.
>
> **Conséquence exacte, à ne pas dramatiser** : le paiement n'est **jamais** perdu. Le QR reste
> valide et payable ; le client écrit son adresse à la main sur le bulletin (`RF-59`). Le seul coût
> est un bulletin **non pré-rempli** — un irritant, pas un incident.
>
> **Ce qui a motivé la règle stricte** : une adresse partielle produit un payload **invalide**
> refusé au guichet (`RF-59`), et distinguer « partielle » de « légitimement sans rue » demande un
> jugement que le code ne sait pas rendre. La règle actuelle fait tomber l'erreur du côté sûr.
>
> **L'assouplissement possible** : n'exiger que nom + NPA + localité + pays, et traiter rue et numéro
> comme facultatifs — strictement conforme à la norme, et couvrant les cas ci-dessus.
>
> **Non tranché. C'est une décision pour @laupernoe**, pas pour un agent : elle arbitre entre un irritant
> fréquent en zone rurale et un risque de payload refusé. Reportée en §11.1.

**`RF-61`** — L'écran d'émission **avertit sans bloquer** : « Adresse incomplète — le bulletin sera
émis sans destinataire pré-rempli. » L'avertissement propose de compléter la fiche en un clic. Il ne
bloque pas : un client qui paie cash immédiatement n'a pas besoin d'un bulletin pré-rempli, et
l'obliger à donner son adresse pour recevoir sa facture est un irritant sans contrepartie.

**`RF-62`** — En cas de paiement immédiat et intégral au comptoir, l'écran propose d'imprimer la
facture **sans section paiement** (mention « Payé le … , montant reçu … »). Émettre un bulletin de
versement pour une facture déjà soldée invite le client à payer deux fois.

⚠️ **À VALIDER AVEC @laupernoe** — _`RF-62` est une hypothèse d'ergonomie. Certains garages impriment
toujours la même facture, payée ou non, pour n'avoir qu'un seul gabarit. La question à poser :
« quand le client paie cash au comptoir, que lui donnez-vous exactement ? »_

**5.3 Structure et stabilité**

**`RF-63`** — Le payload est **figé à l'émission, octet pour octet** (`MD-77`), avec son empreinte.
Le garage peut changer de banque, déménager ou corriger sa raison sociale : les factures déjà
émises restent payables telles qu'envoyées, et un duplicata reproduit **le même** QR.

**`RF-64`** — Le QR d'une facture porte le **montant total et ne change jamais**, même après un
paiement partiel (`MD-82`). Pour encaisser un solde, DFA émet un **bulletin de paiement** distinct
portant la **même référence** — c'est ce qui permet au rapprochement camt.054 de continuer à pointer
la bonne facture (`CF-08`).

> ### ⚠️ Divergence assumée avec `modele-documentaire-facturation.md` — **c'est cette spec qui fait foi**
>
> §5.3 du modèle documentaire décrit le bloc _Ultimate Creditor_ comme **« 6 lignes vides »**.
> **C'est faux.** Un bloc d'adresse comporte `AdrTp` **plus** ses six lignes (nom, rue, numéro, NPA,
> localité, pays), soit **7 champs** — exactement comme pour le bloc débiteur omis.
>
> **Ne « corrigez » pas cette spec d'après le modèle documentaire.** La correction va dans l'autre
> sens, et elle est portée séparément. Une erreur d'un champ décale tout ce qui suit et rend le QR
> illisible.
>
> **Niveau de preuve, à ne pas surévaluer.** Le compte de 31 éléments est établi par **trois
> implémentations indépendantes concordantes** — `stapelberg/qrbill`, `claudep/swiss-qr-bill`, et la
> charge utile d'exemple publiée par `docs.qr-invoice.ch`. Il **n'est pas** établi par lecture de la
> spécification officielle de SIX : une tentative d'extraction du PDF a produit du contenu inventé et
> a été écartée. Trois implémentations qui tombent d'accord constituent une preuve **empirique
> forte**, pas une preuve documentaire. **La vérification contre le document officiel de SIX reste à
> faire**, et c'est lui qui trancherait en cas de conflit.

**`RF-64bis` — Le décompte des éléments du payload : la règle, puis l'énumération.**

L'ordre compte. Une énumération recopiée sans la règle qui la produit finit toujours par être
recopiée incomplète — **c'est exactement ce qui s'est produit ici**, et un garde-fou d'exécution
calqué sur une énumération partielle a **refusé d'émettre une facture parfaitement conforme**.

> **La règle : le compte de base est 31 éléments jusqu'au trailer `EPD` inclus. Chaque bloc
> facultatif présent ajoute ses lignes.** C'est la règle qui doit être implémentée ; l'énumération
> n'en est qu'une vérification.

- Aucun — **31**
- Information de facturation Swico — **32**
- **Une seule** procédure de paiement alternative (`AltPmt`) — **33**
- Les **deux** procédures alternatives, ou Swico + une `AltPmt` — **34**

**Les deux lignes `AltPmt` sont indépendantes.** N'en déclarer qu'une est un cas **conforme** à la
norme. Tout contrôle écrit comme `nb ∈ {31, 32, 34}` rejette une facture valide — la valeur
attendue est `nb ∈ {31, 32, 33, 34}`, et mieux encore, un contrôle dérivé de la règle plutôt que de
la liste.

---

6. Paiements et lettrage

---

**6.1 La structure**

**`RF-65`** — Un **encaissement** et son **affectation** sont deux objets distincts (`MD-50`) : le
`paiement` est ce qui est réellement entré en caisse ou en banque ; l'`imputation` est ce que cet
argent solde. Cette séparation, à elle seule, résout les quatre cas du terrain :

- Paiement partiel — Plusieurs imputations sur un même document
- Un paiement pour plusieurs factures — Plusieurs imputations d'un même paiement
- Trop-perçu — Une partie du paiement reste **non imputée**
- Acompte avant tout document — Un paiement non imputé, ou imputé sur un bon de commande

**`RF-66`** — Un paiement est **immuable** (`MD-52`). Une saisie erronée se corrige par un paiement
de sens opposé, lié au premier. La saisie fausse reste visible avec sa correction — c'est ce que la
fiduciaire cherche en premier, et une caisse dont les erreurs disparaissent est une caisse qu'on ne
peut pas auditer.

**`RF-67`** — Un document **n'affiche jamais un solde négatif** (`MD-51`). Le trop-perçu vit sur le
paiement, pas sur la facture. C'est ce qui garde le grand livre des débiteurs juste.

**6.2 Paiements partiels et lettrage**

**`RF-68`** — Le règlement **n'est pas un état du document** (`MD-16`). Une facture émise et soldée
reste `emis` ; seul son `statut_reglement` bouge (`non_regle` → `partiel` → `regle`). Mélanger les
deux produit une machine à états où « payer » ressemble à « modifier ».

**`RF-69`** — Le lettrage est **explicite par défaut, assisté toujours**. À la saisie d'un
encaissement, l'écran propose les factures ouvertes du client, triées par ancienneté, avec le
montant qui « tombe juste » présélectionné. L'utilisateur confirme. DFA ne lettre jamais en silence.

**`RF-70`** — Quand un virement solde exactement une facture ouverte et une seule, l'imputation est
**proposée pré-cochée**. Quand il correspond à plusieurs combinaisons, aucune n'est pré-cochée :
deviner une imputation ambiguë et se tromper coûte plus cher que de demander.

**`RF-71`** — Un paiement peut être imputé sur **plusieurs factures** (le client règle son relevé
mensuel d'un virement). La somme des imputations de nature `reglement` ne dépasse jamais le montant
du paiement (`MD-51` b).

**`RF-72`** — Un paiement **non imputé** est visible et réclame une action : il apparaît dans une
liste « encaissements à affecter » qui doit être vide en fin de journée. Un paiement qui dort non
imputé est une créance qu'on relance à tort.

**6.3 Moyens multiples sur une même facture**

**`RF-73`** — Une facture accepte **autant d'encaissements que nécessaire, de moyens différents** :
espèces, carte, virement, QR, TWINT, compensation, leasing. Chacun est un `paiement` distinct avec
son moyen, sa date de valeur et son imputation. Le cas réel : le client paie 100.— en carte parce
que c'est son plafond, et le reste en liquide (`CF-22`).

**`RF-74`** — L'ordre des encaissements est libre, mais l'**arrondi au 5 centimes ne s'applique
qu'au dernier s'il est en espèces** (`RF-50`). L'écran calcule et affiche le montant à encaisser
avant que le tiroir s'ouvre.

**`RF-75`** — Chaque moyen de paiement est associé à un compte financier distinct dans le mapping
(`MD-86`). Espèces → caisse, carte → compte d'encaissement carte, virement/QR → banque. Sans cette
distinction, le rapprochement bancaire de la fiduciaire ne tombe jamais juste, parce que les
recettes carte arrivent en banque avec deux jours de décalage et une commission.

⚠️ **À VALIDER AVEC @laupernoe** — _les commissions sur cartes et TWINT sont-elles comptabilisées par DFA
(encaissement brut + charge de commission) ou par la fiduciaire depuis le relevé du prestataire ?
La seconde est plus simple et plus courante chez les petits garages ; la première est plus juste.
Cela décide si `paiement` doit porter un montant brut et une commission, ou seulement le brut._

**6.4 Acomptes**

**`RF-76`** — Deux dispositifs coexistent et **ne se valent pas** (`MD-54`) :

- Document / Aucun (paiement sur bon de commande) / Une `facture` de nature `acompte`
- TVA due / **Non**, à ce stade / **Oui**, immédiatement
- Compte crédité / Acomptes reçus, en **TTC** / Acomptes reçus en **HT** + TVA due
- Facture finale / Lettrage du paiement, pas de ligne de déduction / Ligne `acompte_deduit` obligatoire (`MD-55`)
- Cas de test / `CF-23` / `CF-07`

La comparaison chiffrée de `CF-23` et `CF-07` sur le **même** véhicule à CHF 24'500.00 et le **même**
acompte de CHF 5'000.00 montre l'écart : CHF 374.65 de TVA déclarée à la date de l'acompte dans un
cas, CHF 0.00 dans l'autre. Ce n'est pas un détail de présentation, c'est un trimestre de décalage
sur une déclaration TVA.

**`RF-77`** — Le choix entre les deux dépend de la méthode de décompte du garage (contre-prestations
**convenues** ou **reçues**) et relève de `QF-02` — **une question pour la fiduciaire, jamais pour un
agent**. DFA livre les deux dispositifs ; le paramétrage décide lequel est proposé par défaut.

**`RF-78`** — La facture finale déduit l'acompte **par une ligne explicite**, jamais par un solde
implicite (`MD-55`), au **même taux et dans le même mode de calcul** que la facture d'acompte. Un
acompte ne peut être déduit qu'une fois, sur une seule facture finale (`MD-56`).

↻ **note A1** : la contrainte « même mode de calcul » est désormais **trivialement satisfaite** pour
toute facture d'acompte émise par DFA — les deux sont en `ttc` (`RF-40`). Elle reste écrite et reste
contrôlée, parce qu'une facture d'acompte **reprise** d'un ancien DMS peut être en `ht` : c'est
exactement le cas où la contrainte sert. Vérifié en exécution : la ligne `acompte_deduit` de
`CF-07` / `CF-23` (CHF 5'000.00 TTC à 81 ‰) rend **TVA 374.65 et HT 4'625.35** — inchangé, parce que
`CF-07` était déjà ancré TTC.

**6.5 Trop-perçus**

**`RF-79`** — Le montant non imputé est une **avance client** (`MD-57`). Trois issues, toutes
explicites, **aucune automatique** : remboursement, imputation sur une facture future, ou abandon en
faveur du garage par une imputation de compensation.

**`RF-80` — Ce qu'on ne fait jamais : créer un avoir pour matérialiser un trop-perçu.** `CF-11`
chiffre le dégât sur CHF 19.00 : CHF 1.42 de TVA récupérée à tort, un chiffre d'affaires diminué de
CHF 17.58 sans qu'aucune prestation n'ait été annulée, et un document de vente créé pour un mouvement
d'argent. **Un avoir corrige un document, pas un virement.**

---

7. De l'atelier à la facture

---

C'est le cœur de l'étape 2 et le point où le métier est le plus dense. L'étape 1 a livré l'OR avec
tous ses points d'accroche (`AC-01` → `AC-16`) ; l'étape 2 les active.

**7.1 Le passage**

**`RF-81`** — Une facture d'atelier n'est **jamais** saisie à la main depuis un OR. Elle est produite
par une action serveur qui sélectionne les lignes facturables, les groupe par payeur et **recopie**
leurs montants figés (`MD-24`, `AC-05`). Le réceptionnaire ne retape aucun chiffre — retaper, c'est
diverger.

**`RF-82`** — L'action est disponible sur un OR en statut `termine` (le travail est fait et
contrôlé). Un OR en `en_cours` ne se facture pas : on facture ce qui est terminé, pas ce qui est
prévu.

**`RF-83` — La facturation, le paiement et la restitution du véhicule sont indépendants.**
↻ **révisé 29.07.2026 (A2) — hypothèse confirmée et étendue au paiement.**

> **Décision de @laupernoe.** _Un client peut repartir sans avoir payé, c'est courant._ Restitution et
> paiement sont indépendants, **dans les deux ordres**.

L'énumération `STATUTS_ORDRE_REPARATION` est gelée et suggère un ordre
`termine → facture → restitue` ; le terrain impose les deux sens. Un client repart en payant au
comptoir (facture, paiement, restitution) ; une carrosserie repart bien avant l'accord de l'assureur
(restitution, puis facture six semaines plus tard) ; un client connu repart avec sa facture sous le
bras et paie par virement à trente jours.

**Résolution** : les transitions vivent dans une **table** (`MD-17`), pas dans l'enum. On y autorise
`termine → facture`, `termine → restitue`, `facture → restitue` et `restitue → facture`.
**Aucune valeur d'enum n'est ajoutée** — le contrat gelé de l'étape 1 est respecté, seule la table de
transitions gagne des lignes.

**Ce que A2 ferme définitivement — les trois blocages qui n'existeront pas :**

- « Véhicule non restituable tant que la facture n'est pas soldée » / **N'existe pas.** Aucun endpoint, aucun droit, aucun paramètre de tenant / La restitution est un fait physique. Un logiciel qui prétend l'empêcher ment sur ce qu'il contrôle, et le premier contournement sera de ne pas saisir la restitution — DFA perdrait la donnée en plus de la bataille
- « Restitution impossible tant que l'OR n'est pas facturé » / **N'existe pas** / C'est le cas carrosserie, majoritaire en volume sur les gros montants
- « Avertissement bloquant à la restitution d'un véhicule non payé » / **N'existe pas comme blocage** ; existe comme **information** (voir ci-dessous) / Un avertissement qu'on doit acquitter à chaque fois devient un réflexe, et un réflexe n'avertit plus

**Ce que le comptoir voit à la place — informer sans jamais barrer la route.** L'écran de
restitution affiche l'état de règlement en évidence, et propose l'action utile :

- Facture soldée → _« Facture 2026-00318 — soldée le 29.07.2026 »_, en gris. Rien à faire.
- Facture ouverte → _« Facture 2026-00318 — solde CHF 566.63 »_, avec deux boutons :
  **« Encaisser maintenant »** et **« Restituer sans encaisser »**. Les deux sont au même niveau
  hiérarchique ; aucun n'est un chemin dégradé.
- Aucune facture émise → _« OR non facturé »_, avec **« Facturer »** et **« Restituer »**, les deux
  disponibles.

Le second bouton n'est ni caché, ni grisé, ni précédé d'une confirmation modale. **Le réceptionnaire
connaît son client mieux que le logiciel** ; le rôle de DFA est de lui montrer le solde, pas de lui
retirer la décision.

**Conséquence sur les relances** : un véhicule restitué et non payé alimente la relance normalement
(§6). C'est là que le suivi se fait — dans le grand livre des débiteurs, pas à la barrière du
parking.

**`RF-84`** — L'OR passe au statut `facture` **si et seulement si** plus aucune de ses lignes n'est
en attente de facturation (`AC-16`). Un OR dont la part assurance reste à facturer n'est pas
`facture`, même si le client a payé la sienne. ↻ **note A2** : `facture` et `restitue` décrivent deux
faits distincts et **le statut de règlement n'entre dans ni l'un ni l'autre** (`RF-68`). Un OR peut
être `restitue` sans être `facture`, `facture` sans être payé, et les trois notions se lisent
séparément à l'écran.

⚠️ _Une question de terrain reste ouverte et n'est pas bloquante : le garage veut-il une **liste des
véhicules restitués non payés** au tableau de bord du comptoir ? C'est un écran de suivi, pas une
règle de gestion — il peut arriver après le pilote._

**7.2 Quelles lignes sont facturées, et à qui**

**`RF-85`** — Le tri est mécanique, jamais laissé à l'appréciation :

- `realisee` / **Facturée** / Le travail est fait
- `refusee` / **Jamais facturée** → travaux reportés / Le client a dit non (`RM-72`, `RM-73`)
- `annulee` / **Jamais facturée** / Elle reste visible avec son motif, mais n'a rien produit
- `validee`, `en_cours`, `proposee`, `a_valider` / **Bloquent l'émission** / On ne facture pas un travail dont l'état est indécis
- `facturee` / Déjà facturée / Une ligne d'OR n'apparaît que sur **un seul** document non annulé (`MD-15`)

**`RF-86`** — L'émission est **refusée** tant qu'une ligne est dans un état indécis, avec un message
qui **liste les lignes concernées** et propose les trois issues possibles (marquer réalisée, refuser,
annuler avec motif). Un message d'erreur qui dit « l'OR n'est pas facturable » sans dire quelle ligne
bloque fait perdre dix minutes à chaque fois.

**`RF-87` — Groupement par payeur** (`MD-62`). Un OR produit **une facture par payeur** :

- `client` — Le client (ou son adresse de facturation, `AC-13`)
- `assurance` — L'assurance désignée par `payeur_client_id` (`AC-08`)
- `constructeur` — L'importateur / le constructeur (garantie, campagne)
- `tiers` — Le tiers désigné (employeur, leaser, garage confrère)
- `garage` — **Personne** — facturée 0.00, valorisée quand même (`RF-92`)

**`RF-88`** — L'**invariant de non-fuite** (`MD-64`) est vérifié à l'émission et par requête de
contrôle nocturne : pour chaque OR et chaque taux, la somme des bases et des TVA de tous les
documents non annulés issus de l'OR égale celle des lignes facturables de l'OR. C'est le contrôle qui
détecte une prestation facturée deux fois ou pas du tout — l'erreur la plus coûteuse et la moins
visible sur un OR de carrosserie à quarante lignes. `CF-19` et `CF-20` l'exercent.

**7.3 Les lignes refusées et les travaux reportés**

**`RF-89`** — Une ligne refusée **n'est jamais facturée** et alimente les **travaux reportés** du
véhicule (`RM-73`). Elle réapparaît au passage suivant, dans le contexte-atelier et sur
`GET /vehicules/{id}/travaux-reportes`. Elle n'apparaît **pas** sur la facture, même à 0.00 : le
client n'a pas à payer pour lire ce qu'il a refusé.

**`RF-90`** — Le **démontage / remontage** effectué pour établir un devis ensuite refusé **est
facturable**, selon `P-24` (`facturer` / `offrir` / `au_dela_seuil`). C'est du travail réel, et le
refuser au garage serait lui faire payer le diagnostic.

**`RF-91`** — La ligne de démontage est **proposée, jamais créée en silence** (`CT-36`). Elle
apparaît dans les avertissements de l'écran de facturation avec son montant, et le réceptionnaire
l'ajoute ou non. ↻ **révisé (A1), montants revérifiés** : `CF-18` en fixe le montant — 1.2 h au tarif
converti de **CHF 178.37 TTC/h** (`RF-121`) → **CHF 214.04 TTC, dont CHF 16.04 de TVA et CHF 198.00
de HT**. **Les trois valeurs sont rigoureusement inchangées** par rapport à la rédaction HT : le
détour par le tarif converti retombe exactement au même endroit. C'est une coïncidence arithmétique
de ce jeu de chiffres, pas une propriété générale — `CF-01` et `CF-19`, eux, bougent.

**`RF-92` — Les lignes à charge du garage** (geste commercial, retouche, casse — `RM-70`) sont
**facturées à personne et valorisées quand même** (`MD-66`, `AC-07`). Elles apparaissent **à 0.00 sur
la facture du client avec leur mention** (« Retouche — offert »), parce que montrer ce qu'on offre est
commercialement utile, et partent sur un compte d'analyse à l'export avec leur coût interne.

**7.4 Garantie et prise en charge par un tiers**

**`RF-93` — Une ligne de garantie est une ligne facturée, pas une ligne gratuite.** `origine =
'garantie'` (ou `campagne`) et `payeur = 'constructeur'` produisent une **vraie facture à
l'importateur**, avec TVA. Le travail sous garantie est payé — par quelqu'un d'autre. Un garage qui
« offre » la garantie perd son remboursement.

**`RF-94`** — Le taux horaire de garantie est **figé sur la ligne à sa création** (`AC-01`, `RM-65`)
et diffère généralement du taux client : l'importateur impose le sien. `CF-19` l'illustre avec 1.8 h
à CHF 155.00 (garantie) coexistant avec 1.0 h à CHF 165.00 (client) sur le même OR.

**`RF-95`** — Une **campagne** (rappel constructeur, `RM-30`) suit le même chemin que la garantie :
payeur `constructeur`, facture à l'importateur. Elle n'apparaît pas sur la facture du client, mais le
récapitulatif d'intervention remis au client la mentionne — le client doit savoir ce qui a été fait
sur son véhicule.

**`RF-96` — La prise en charge partielle par un tiers se modélise par une ligne de répartition
explicite, exactement comme la franchise** (`MD-63`). L'importateur qui accepte 50 % d'un dossier hors
garantie (geste commercial) donne : une ligne négative sur la facture du client, la même ligne
positive sur la facture de l'importateur, **au même taux et dans le même mode de calcul**. `CF-20`
chiffre le cas et vérifie la non-fuite.

↻ **révisé (A1) — la part se calcule sur le TTC, et le partage n'est plus toujours exact.** La
répartition s'exprime en pour mille du **TTC** et suit la formule de ventilation standard :
`part_ttc = arrondiCommercial(total_ttc × pourmille, 1000)`.

Conséquence non triviale, révélée par le recalcul : **un partage à 50 % ne tombe plus forcément
juste.** En saisie HT, la base de `CF-20` valait 117'500 centimes — un nombre pair, coupé en deux
sans reste. En saisie TTC elle vaut **127'019 centimes**, un nombre **impair** : la moitié tombe sur
un demi-centime. La formule tranche de façon déterministe (63'510 d'un côté, 63'509 de l'autre) et
**les trois invariants de non-fuite tiennent toujours au centime** — vérifié en exécution. La TVA,
elle, reste **rigoureusement identique des deux côtés** (CHF 47.59), parce que c'est la même ligne de
répartition, prise une fois en positif et une fois en négatif.

**Il n'y a donc aucune règle nouvelle à écrire** : le centime impair est attribué par la formule de
ventilation qui existait déjà. Mais l'écran doit l'assumer et ne jamais afficher « 50 % / 50 % »
comme deux montants égaux quand ils diffèrent d'un centime — le gestionnaire de garantie de
l'importateur le verra, et il faut que la facture réponde avant qu'il ne demande.

**`RF-97`** — Il est **interdit** de représenter une prise en charge partielle par un rabais sur la
facture du client. Un rabais réduit le chiffre d'affaires du garage ; une prise en charge le déplace
vers un autre payeur. Les deux donnent le même montant à encaisser du client et deux comptabilités
différentes — et seule la seconde permet de réclamer sa part à l'importateur.

**7.5 Pièces remplacées, pièces non retournées, consignes**

**`RF-98` — La vieille pièce que le client demande à récupérer** (`aRestituer`, `RM-78`) est un
engagement à tenir : elle lui est remise à la restitution du véhicule, et `restituee` en fait foi.

**`RF-99` — La taxe d'élimination n'est facturée que si le garage élimine effectivement la pièce.**
Un client qui repart avec son ancien amortisseur n'a pas à payer sa mise au rebut. Quand
`aRestituer = true` et `restituee = true`, la ligne de taxe correspondante est **exclue de la
facture** ; l'écran de facturation le signale.

↻ **révisé (A2) — l'ordre des événements n'est plus garanti, et cette règle en dépendait.** Depuis
que la restitution peut suivre la facturation (`RF-83`), `restituee` peut valoir `false` **au moment
de l'émission** et passer à `true` deux jours plus tard. La règle telle qu'écrite ne savait pas
traiter ce cas. Elle se lit désormais sur l'**intention**, pas sur le fait accompli :

- `aRestituer = false` / **Facturée** / Le garage élimine. Rien à faire
- `aRestituer = true`, `restituee = true` / **Exclue** / Cas nominal inchangé : la pièce est déjà partie avec le client
- **`aRestituer = true`, `restituee = false`** / **Exclue**, et l'écran le signale / **C'est le cas nouveau.** Le client a _demandé_ sa pièce ; c'est son intention qui décide, et elle est connue à l'émission
- `aRestituer = true`, pièce finalement **non reprise** par le client / La taxe devient due / **Facture complémentaire**, jamais une modification (`RF-11`). Montant faible, cas rare

Le choix d'exclure sur l'intention plutôt que sur le fait est délibéré : **il fait tomber l'erreur du
bon côté**. Exclure à tort produit une facture complémentaire de CHF 3.78 dans un cas rare ; facturer
à tort produit un avoir et un client qui a payé pour un service qu'il n'a pas reçu — et qui s'en
souvient.

⚠️ _`RF-98` (la vieille pièce est remise à la restitution) reste inchangé et devient plus important :
c'est maintenant le seul point du parcours où l'engagement se matérialise, et il peut survenir avant
comme après la facture._

**`RF-100` — La consigne d'un échange standard est facturée sur la facture initiale, et remboursée
par un avoir partiel au retour de la vieille pièce.** L'alternative — attendre le retour avant de
facturer — subordonne l'émission d'une facture à un événement physique incertain, ce qui bloque la
caisse. ↻ **révisé (A1), montants revérifiés** : `CF-25` fixe les montants — consigne annoncée
**CHF 162.15 TTC**, dont CHF 12.15 de TVA et CHF 150.00 de HT. **Valeurs inchangées** : la consigne
de CHF 150.00 HT se convertit exactement en CHF 162.15 TTC (`RF-121`). L'avoir partiel rend
**exactement** l'opposé au centime — nouvelle démonstration de la symétrie d'arrondi de `MD-40`.

Une conséquence d'ergonomie à ne pas manquer : la consigne s'annonce désormais au client
**« 162.15 »** et non plus « 150.— plus TVA ». C'est le montant qu'il verra revenir sur son avoir, et
c'est celui qu'il faut lui dire au comptoir.

⚠️ **À VALIDER AVEC @laupernoe** — _trois questions de terrain sur ce paragraphe, que je ne peux pas
trancher :_

> 1. _Les garages du parc pratiquent-ils réellement l'échange standard avec consigne (alternateurs,
>    démarreurs, injecteurs, turbos, boîtes) ? Si oui, quel ordre de grandeur ?_
> 2. _La consigne est-elle soumise à TVA au taux normal ? Je la traite comme une livraison à 8.1 %,
>    ce qui me paraît l'hypothèse la plus probable, mais c'est une question fiscale (`QF-06`)._
> 3. _Que se passe-t-il quand le client ne rend pas la vieille pièce et ne la réclame pas non plus,
>    et que le garage la garde ? La consigne reste acquise — mais qui décide, et au bout de combien
>    de temps ?_

---

8. Export fiduciaire

---

**8.1 Ce qu'on exporte, et ce qu'on n'exporte pas**

**`RF-101` — DFA ne tient aucune comptabilité.** Pas de grand livre, pas de bilan, pas de compte de
résultat, pas de décompte TVA. DFA produit des **écritures équilibrées** et les remet à l'outil de la
fiduciaire (`MD-84`). C'est un choix de positionnement autant que d'architecture : c'est précisément
là que Nextlane Suisse a abandonné, et le garage a déjà une fiduciaire qu'il ne changera pas pour DFA.

**`RF-102` — Le cœur produit les écritures, les adaptateurs les sérialisent.** Aucun adaptateur ne
calcule un montant, ne choisit un compte, ni n'arrondit (`MD-84`). **Toutes** les cibles reçoivent la
**même** liste d'écritures, au format près — c'est ce que `CF-04` vérifie.

↻ **révisé (A3) — les cibles changent, l'interface ne change pas.** C'est exactement ce que
`AccountingExporter` devait démontrer, et l'arbitrage A3 en est le premier test réel : Abacus sort du
périmètre, iReach y entre sous réserve, WinBIZ passe en tête — **et pas une règle de §8 ne bouge**.
La liste à jour des cibles est en §0.3 ; les formats sont dans `docs/exports-fiduciaires.md`.

**Ce que A3 impose comme discipline** : le nombre d'adaptateurs n'est pas connu à l'avance et ne le
sera jamais. Un garage qui change de fiduciaire (§8.3) ou un pilote qui découvre un outil inattendu
— exactement ce qui vient de se passer avec iReach — ne doit toucher **que** son adaptateur. Toute
tentation de faire remonter une spécificité de cible dans le cœur (« WinBIZ veut ce champ-là »,
« iReach n'accepte pas les décimales ») est à refuser : elle transforme le cœur en somme des
particularités de toutes les cibles connues, et le prochain export révélera la suivante.

**`RF-103` — Ce qui part** : facture émise, facture d'acompte, avoir, encaissement, écart d'arrondi,
escompte, perte sur créance (tableau §6.2 du modèle). **Ce qui ne part pas** : devis, bons de commande,
brouillons, OR, lignes à charge du garage (sauf sur compte d'analyse), et documents repris
(`origine = 'reprise'`) tant que `QF-10` n'est pas tranché.

**`RF-104` — L'équilibre est vérifié avant l'appel à l'adaptateur**, écriture par écriture, en
`bigint` (`MD-85`). Une seule écriture déséquilibrée fait échouer le **lot entier**. On ne transmet
pas un journal partiellement faux à une fiduciaire : on corrige et on retransmet.

**`RF-105`** — La continuité des séries est vérifiée **avant** chaque export, de manière bloquante
(`RF-28`). Un trou ne part jamais chez la fiduciaire sans avoir été expliqué.

**8.2 Granularité**

**`RF-106`** — Deux modes, paramétrables par tenant **et par cible** (`PF-05`, `MD-88`) :

- `detaille` (défaut) / Document, puis par paiement / **WinBIZ**, CSV générique, Bexio : la fiduciaire tient le grand livre des débiteurs dans son outil
- `agrege` / Jour × compte × taux de TVA / Le petit garage dont la fiduciaire ne veut pas 900 écritures par mois — DFA reste alors le grand livre des débiteurs. Cas typique de Banana, et disponible en CSV générique

↻ **note A3** : le mode `agrege` **reste au périmètre** bien que Banana soit différée. C'est une
**capacité du cœur** (`MD-88`), pas une particularité d'une cible : elle est atteignable dès
maintenant via le CSV générique, et c'est elle que `CF-27` exerce.

↻ **note A3** : le mode retenu pour **iReach** est **indéterminé** — c'est l'une des questions de
`EF-22`. Tant qu'elle n'est pas tranchée, aucun défaut n'est codé pour cette cible. Un défaut
inventé ici serait découvert faux au premier export réel, c'est-à-dire au pire moment.

**`RF-107` — Trois choses ne sont jamais agrégées** (`MD-89`), quel que soit le mode : les **taux de
TVA** entre eux (la déclaration deviendrait infaisable), le **compte de créances clients** par client
(l'agrégation détruit le lettrage), et les **exercices** entre eux.

**`RF-108`** — Toute écriture porte de quoi revenir à sa source : le **numéro affiché** du document —
celui que le garagiste et le client connaissent — et l'identifiant interne (`MD-90`). Une fiduciaire
qui trouve une écriture bizarre demande « la facture 2026-00318 » et doit la recevoir en trente
secondes.

**`RF-109`** — Un document déjà exporté ne repart pas dans un autre lot sans une action
d'exploitation explicite et tracée (`MD-92`). Le double comptage est la faute qui coûte le plus cher
en confiance, parce qu'elle se découvre au bouclement, trois mois plus tard.

**`RF-110`** — Une correction postérieure à un export part dans le **lot suivant**, jamais dans le
lot transmis (`MD-93`). Un avoir émis en avril sur une facture de mars est une écriture d'avril.
C'est exactement pourquoi la chaîne interdit la modification : elle rend cette règle mécanique au
lieu de la confier à la vigilance de quelqu'un.

**8.3 Ce qui casse quand le garage change de fiduciaire**

Cela arrive, et plus souvent qu'on ne croit : départ à la retraite du fiduciaire, reprise de cabinet,
changement d'outil, garage qui grandit. Le jour où ça arrive, DFA doit être la partie facile.

**`RF-111` — Ce qui ne casse pas, par construction :**

- Les **documents** : ils sont figés et ne dépendent d'aucune cible d'export.
- Les **écritures** : le modèle est neutre (`MD-84`). Changer de cible, c'est changer d'adaptateur.
- Les **lots déjà transmis** : conservés à vie avec leur empreinte (`MD-91`), donc reproductibles à
  l'identique si l'ancienne fiduciaire ou un contrôle les redemande.

**`RF-112` — Ce qui casse, et comment on l'encaisse :**

- **Le plan comptable** — la nouvelle fiduciaire impose ses comptes / Les écritures futures changent de compte / Le mapping est **versionné par dates** (`actif_du`, `actif_au`, `MD-86`). On **n'écrase jamais** un mapping : on le clôt et on en ouvre un nouveau. Sinon les exports passés deviennent irreproductibles
- **Les correspondances externes** — identifiants de contacts et de comptes chez la cible / La nouvelle cible ne connaît aucun identifiant / `correspondance_externe` est indexée **par cible** (`MD-87`). La nouvelle repart vide et se remplit au premier export. Risque réel : **doublons de contacts** chez la nouvelle fiduciaire au premier lot
- **Le mode d'agrégation** — passage de `detaille` (WinBIZ) à `agrege` (CSV, Banana) / Deux granularités pour la même période / **Le changement ne prend effet qu'à une frontière de période comptable**, jamais en cours de mois. Sinon la fiduciaire reçoit mars en détaillé et avril en agrégé avec un chevauchement, et personne ne sait ce qui a déjà été saisi
- **Les codes TVA** — propres à chaque cible / Les codes de l'ancienne cible ne veulent rien dire dans la nouvelle / `mapping_code_tva` est indexé sur `(cible, régime, taux)` (`MD-86`). À remplir avant le premier export, et c'est un travail humain de trente minutes avec la fiduciaire
- **Le grand livre des débiteurs** — qui le tient ? / Si WinBIZ le tenait et que la nouvelle cible ne le tient pas, il faut basculer la responsabilité / **C'est le seul point qui demande une décision humaine.** Solde d'ouverture des créances à la date de bascule, produit par DFA, saisi une fois par la fiduciaire. Même problème que `QF-10` à la reprise

**`RF-113`** — Le changement de fiduciaire se fait donc **à une date de bascule** qui est une
frontière de période comptable close, avec : dernier lot transmis et accepté à l'ancienne cible,
nouveau mapping ouvert à la date de bascule, état des créances ouvertes produit pour la nouvelle. `CF-27`
en fixe le scénario de test.

⚠️ **À VALIDER AVEC @laupernoe** — _combien de garages du parc ont changé de fiduciaire ces cinq dernières
années, et comment ça s'est passé avec leur DMS actuel ? Si la réponse est « on a tout ressaisi »,
c'est un argument commercial direct pour DFA, et il vaut la peine d'être mesuré._

---

9. Qui a le droit de faire quoi

---

**`RF-114`** — La matrice est **serveur**, jamais seulement affichée. Un bouton caché n'est pas une
autorisation.

- Voir les montants / ✅ / ✅ / ✅ / ✅ / ✅ / ✅ / ❌ / ❌
- Créer / modifier un brouillon / ✅ / ✅ / ✅ / ✅ / ✅ / ✅ / ❌ / ❌
- Émettre un devis / bon de commande / ✅ / ✅ / ✅ / ✅ / ✅ / ❌ / ❌ / ❌
- **Émettre une facture** / ✅ / ✅ / ✅ / ✅ / ❌ / ❌ / ❌ / ❌
- **Émettre un avoir** / ✅ / ✅ / ❌ / ⚠️ plafonné / ❌ / ❌ / ❌ / ❌
- Remise au-delà du plafond du rôle / ✅ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌
- Encaisser / imputer / ✅ / ✅ / ✅ / ✅ / ❌ / ✅ / ❌ / ❌
- Rembourser un trop-perçu / ✅ / ✅ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌
- Marquer irrécouvrable / ✅ / ✅ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌
- Clore une période comptable / ✅ / ✅ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌
- Générer / transmettre un export / ✅ / ✅ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌
- Modifier le mapping comptable / ✅ / ✅ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌
- Modifier le bloc créancier QR / ✅ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌ / ❌

**`RF-115` — `admin` est un rôle technique et n'a aucun droit financier.** Il administre les
utilisateurs, les sites et les paramètres techniques ; il ne voit pas les montants, n'émet rien et
n'encaisse rien. C'est une séparation des pouvoirs élémentaire : la personne qui peut créer des
comptes ne doit pas pouvoir émettre des factures.

**`RF-116`** — `technicien` ne voit **aucun montant**, en facturation comme en atelier
(`ROLES_SANS_MONTANT` de l'étape 1). Le filtrage est une décision d'**autorisation** appliquée côté
serveur : les montants sont absents de la charge utile, pas masqués en CSS.

**`RF-117`** — L'émission d'un **avoir** par un réceptionnaire est plafonnée en montant
(paramétrable) et **toujours** motivée (`RF-15`). Au-delà du plafond, la direction ou le comptable
prend le relais. Un avoir est le seul geste qui fait sortir de l'argent sans contrepartie : il mérite
un garde-fou, et le garde-fou ne doit pas empêcher de corriger une coquille d'adresse un vendredi
soir — d'où un plafond, et non une interdiction.

**`RF-118`** — Les plafonds de remise par rôle (`P-13`) sont contrôlés **à l'émission**, sur le
montant effectivement remisé (remise de ligne + part de remise globale), pas à la saisie du brouillon
(`MD-61`). Un brouillon peut tout contenir ; c'est l'émission qui engage.

**`RF-119`** — Toute action financière est **journalisée** (qui, quoi, quand, avant/après) :
émission, avoir, encaissement, imputation, remboursement, clôture de période, export, modification de
mapping. Le journal est consultable depuis le document.

**`RF-120`** — Un document émis n'est **jamais** modifiable, quel que soit le rôle — y compris
direction, y compris admin, y compris par un script de maintenance (`MD-20`). La matrice ci-dessus ne
contient volontairement aucune ligne « modifier une facture émise » : cette action n'existe pas.

---

10. Cas de test métier chiffrés

---

**10.0 ↻ Ce que l'arbitrage A1 a changé dans l'arithmétique**

> **Réexécuté, pas relu.** Les douze cas ont été recalculés par script en `BigInt`, avec les mêmes
> `arrondiCommercial()` et `arrondiCinqCentimes()` (`MD-40`, `MD-47`), sous ancrage TTC. **Toutes les
> assertions passent**, y compris les invariants de non-fuite et le nouvel invariant `RF-122`.

**Méthode de recalcul, à connaître pour lire le reste.** Les cas d'origine énonçaient des prix
unitaires HT. Les rejouer en TTC demandait de choisir ce que devient « 165.00 ». La convention
retenue est celle de `RF-121` — **conversion du tarif, pas réétiquetage** :

```
prix_unitaire_ttc = arrondiCommercial(prix_unitaire_ht × 1081, 1000)      [taux 81 ‰]
ttc_ligne         = arrondiCommercial(prix_unitaire_ttc × quantité, 1000)
tva_ligne         = arrondiCommercial(ttc_ligne × 81, 1081)
ht_ligne          = ttc_ligne − tva_ligne
```

Elle préserve la recette du garage. La convention inverse — garder « 165.00 » et le déclarer TTC —
aurait amputé chaque cas de 7.5 % et n'aurait rien prouvé du tout.

**Résultat, cas par cas :**

- `CF-16` / **Change** / Facture `CF-01` : CHF 566.60 → **CHF 566.63**. HT 524.15 → **524.18**. **TVA inchangée à 42.45**
- `CF-17` / Inchangé / Aucune arithmétique de montants — numérotation et concurrence uniquement
- `CF-18` / **Inchangé** / 198.00 / 16.04 / 214.04 à l'identique. Le détour par 178.37 TTC/h retombe exactement
- `CF-19` / **Change** / Importateur 455.64 → **455.65** ; client 278.36 → **278.37**. **Les deux TVA inchangées** (34.14 / 20.86)
- `CF-20` / **Change, et révèle un cas nouveau** / 635.09 / 635.09 → **635.10 / 635.09**. Le partage 50 % tombe sur un demi-centime (`RF-96`)
- `CF-21` / **Change** / Montant du payload QR : 566.60 → **566.63**. Décompte des champs **inchangé** (31 éléments)
- `CF-22` / **Inchangé** / 204.31 / 1.531 / 189.00 à l'identique, arrondi 5 centimes compris
- `CF-23` / **Inchangé** / Déjà ancré TTC dans la rédaction d'origine — c'est le cas témoin
- `CF-24` / **Change, et le profil de l'erreur se déplace** / Voir §10.10. TTC 1'309.84 → **1'317.20** ; écart de la variante fautive 0.74 → **0.63**
- `CF-25` / **Inchangé** / 150.00 / 12.15 / 162.15 à l'identique
- `CF-26` / **Inchangé** / 3'459.20 / 259.20 / 3'200.00 et l'escompte de 69.18 à l'identique
- `CF-27` / Change de cibles, pas de montants / Bexio → **WinBIZ** (A3)

**Trois constats qui méritent d'être dits, parce qu'ils étaient contre-intuitifs :**

1. **La TVA totale ne bouge presque jamais** (`CF-16`, `CF-19`), alors que le HT et le TTC bougent
   d'un ou deux centimes. La conversion des tarifs déplace le TTC vers le haut de l'arrondi ; la
   TVA dérivée retombe sur la même valeur. Ce n'était pas prévisible sans l'exécuter.
2. **Cinq cas sur douze sont rigoureusement inchangés.** Ce n'est pas une preuve que A1 est anodin —
   c'est la preuve que ces cas portaient déjà des montants atteignables dans les deux modes. Les
   sept autres montrent l'écart réel.
3. **Un cas devient impossible à reproduire depuis l'interface** : la variante fautive de `CF-20`
   (répartition en `ht` d'un côté, `ttc` de l'autre). Elle reste un test du moteur de calcul, mais
   elle ne décrit plus un risque de production. Dit franchement en §10.6.

**⚠️ Hors de mon périmètre d'écriture, et à répercuter par le propriétaire de l'autre document.**
`docs/modele-documentaire-facturation.md` porte `CF-01` → `CF-15`, dont l'arithmétique est
**antérieure à A1**. Sous ancrage TTC :

- `CF-01` / **HT 524.15 → 524.18, TTC 566.60 → 566.63**, TVA inchangée / **Haute** — cité par `CF-03`, `CF-04`, `CF-16`, `CF-21`
- `CF-03` / À rejouer sur les nouvelles bases de `CF-01` / Haute
- `CF-04` / Écriture à recalculer (débit 566.63, ventilation des crédits) / Haute
- `CF-13` / **Change de rôle**, pas de valeurs : devient un test de non-régression (`RF-39`) / Moyenne
- `CF-10` / La variante fautive `ht`/`ttc` n'est plus atteignable depuis l'UI / Moyenne
- `CF-02`, `CF-05`, `CF-07`, `CF-14`, `CF-15` / **Inchangés** — déjà ancrés TTC ou indépendants du mode / —
- `CF-06`, `CF-08`, `CF-09`, `CF-11`, `CF-12` / À revérifier ; non recalculés ici faute de périmètre / Moyenne

Je n'ai **pas** modifié ce document et je n'ai **pas** recalculé les cas que je n'ai pas repris.
Ce tableau est une liste de travail, pas un résultat.

**10.1 Les quinze cas existants restent normatifs**

`CF-01` → `CF-15` sont définis dans `docs/modele-documentaire-facturation.md` §9, leur arithmétique
est exécutée, et **ce document ne les redéfinit pas**. Rappel de leur objet :

- `CF-01` — Facture d'atelier, 8.1 % — ↻ **CHF 566.63** en ancrage TTC (566.60 en mode `ht`), voir §10.0
- `CF-02` — Avoir total : symétrie de l'arrondi
- `CF-03` — TVA par ligne agrégée ≠ TVA sur base agrégée
- `CF-04` — Écriture de facture émise, équilibrée
- `CF-05` — Arrondi 5 centimes à l'encaissement, dans les deux sens
- `CF-06` — Remise globale ventilée, résidu d'arrondi
- `CF-07` — Vente de véhicule avec **facture** d'acompte, mode `ttc`
- `CF-08` — Paiement partiel et bulletin de solde
- `CF-09` — Avoir sur facture émise sous un taux antérieur
- `CF-10` — Carrosserie multi-payeur, invariant de non-fuite
- `CF-11` — Trop-perçu
- `CF-12` — Facture reprise à TVA non ventilée
- `CF-13` — Le mode de calcul n'est pas une préférence d'affichage
- `CF-14` — Escompte 2 % avec correction proportionnelle de TVA
- `CF-15` — Référence QR : composition et chiffre de contrôle

**10.2 `CF-16` — Correction d'adresse : avoir total + refacturation ↻ _recalculé (A1)_**

Prouve `RF-11`, `RF-12`, `RF-13`, `MD-22`. Facture de `CF-01` **recalculée en ancrage TTC**
(**CHF 566.63**), coquille d'adresse détectée avant tout envoi.

**La facture support, ligne à ligne** (tarifs convertis par `RF-121`, taux 81 ‰) :

- 1 / Main-d'œuvre atelier / `2500` (2.5 h) / `17837` / `44593` / `3341` / `41252`
- 2 / Filtre à huile / `1000` (1 pce) / `2692` / `2692` / `202` / `2490`
- 3 / Huile moteur 5W30 / `4500` (4.5 L) / `2000` / `9000` / `674` / `8326`
- 4 / Taxe d'élimination / `1000` (1 pce) / `378` / `378` / `28` / `350`

```
total_ttc = 44593 + 2692 + 9000 + 378 = 56663 ct   →  CHF 566.63
total_tva =  3341 +  202 +  674 +  28 =  4245 ct   →  CHF  42.45   (inchangée vs mode ht)
total_ht  = 41252 + 2490 + 8326 + 350 = 52418 ct   →  CHF 524.18   (524.15 en mode ht)

RF-122 : 52418 + 4245 = 56663 ct = total_ttc annoncé                     ✅
```

- Facture 2026-00318 / `52418` / `4245` / `56663`
- Avoir 2026-00007 / `−52418` / `−4245` / `−56663`
- Facture 2026-00319 (adresse corrigée) / `52418` / `4245` / `56663`

```
solde de la facture 2026-00318 après lettrage de l'avoir  =  0 ct        ✅
TVA nette de l'exercice : 4245 − 4245 + 4245              =  4245 ct     ✅ (inchangée)
numéros consommés : 2 dans la série facture, 1 dans la série avoir       ✅ aucun trou
```

> **Le point à retenir de ce recalcul** : la TVA totale est **exactement la même** qu'en mode `ht`
> (CHF 42.45), alors que le HT et le TTC gagnent 3 centimes. La conversion des tarifs a poussé
> chaque TTC de ligne d'un ou deux centimes vers le haut, et la TVA dérivée est retombée sur la
> même valeur à chaque ligne. Ce n'était pas prévisible sans l'exécuter — et c'est la raison pour
> laquelle « inverser les libellés » n'était pas une option.

À vérifier **en plus** des montants, et qui est le vrai objet du cas :

- Un `UPDATE` de l'adresse figée sur 2026-00318 est **refusé**, code stable `document_verrouille`.
- Les trois documents portent la **même** `date_document`.
- Le `qr_payload` de 2026-00319 **diffère** de celui de 2026-00318 : nouvelle référence QR, nouvelle
  adresse débiteur. Les deux payloads restent lisibles et valides.
- La correction de la fiche client (`RF-14`) **ne modifie aucun** des trois documents.
- L'avoir porte un `motif = 'erreur_adresse'` non vide.

**10.3 `CF-17` — Concurrence et rollback : la série reste contiguë**

Prouve `RF-23`, `RF-24`, `RF-26`, `MD-28` → `MD-31`. Test d'intégration, base réelle.

- Deux émissions concurrentes, même tenant/série — Numéros `n` et `n+1`, distincts, aucune perte
- Transaction B échoue après allocation (`CHECK` violé) — A obtient `n`. **B ne consomme rien.** L'émission suivante obtient `n+1`
- Même `Idempotency-Key` rejouée — **Même** document, **même** numéro, aucun second document
- Deux tenants en parallèle — Aucune attente mutuelle, séries indépendantes
- Requête de continuité (modèle §2.4) après le scénario — **0 ligne**

```
attendu après 2 émissions réussies et 1 rollback : count(*) = 2, min = n, max = n+1
                                                   count(*) = max − min + 1        ✅
```

**Contrepoint obligatoire dans le même test** : le compteur `reference_qr` **conserve son trou**
après le rollback, et c'est le comportement voulu (`MD-75`). Une référence QR réutilisée
rapprocherait un paiement de 2031 sur une facture de 2026 encore ouverte. Le test doit porter un
commentaire pour que personne ne « corrige » ce trou.

**10.4 `CF-18` — Démontage facturé après refus de devis ↻ _revérifié (A1) — valeurs inchangées_**

Prouve `RF-90`, `RF-91`, `P-24`. Devis complémentaire refusé, démontage/remontage réel de 1.2 h au
tarif atelier, `P-24 = 'facturer'`.

```
tarif converti (RF-121) : arrondi(16500 × 1081, 1000)  = 17837 ct/h  →  CHF 178.37/h

ttc  = arrondi(17837 × 1200, 1000)  = 21404 ct   →  CHF 214.04
tva  = arrondi(21404 × 81,   1081)  =  1604 ct   →  CHF  16.04
ht   = 21404 − 1604                 = 19800 ct   →  CHF 198.00

RF-122 : 19800 + 1604 = 21404 ct                                          ✅
```

**Les trois valeurs sont rigoureusement identiques à la rédaction HT** (198.00 / 16.04 / 214.04).
Le test n'a pas à être modifié — seule sa _dérivation_ change, et le commentaire du test doit le
dire, sinon le prochain lecteur croira que le cas n'a pas été revu. **C'est une coïncidence
arithmétique propre à ce jeu de chiffres, pas une propriété générale** : `CF-01` et `CF-19`, eux,
bougent d'un à trois centimes.

À vérifier en plus : les lignes **refusées** n'apparaissent pas sur la facture (`RF-89`), elles
apparaissent dans les travaux reportés du véhicule, et la ligne de démontage est **absente** tant que
l'utilisateur ne l'a pas explicitement ajoutée (`CT-36`) — un test qui l'obtiendrait automatiquement
signale une régression.

**10.5 `CF-19` — Garantie constructeur et travaux client sur un même OR ↻ _recalculé (A1)_**

Prouve `RF-87`, `RF-88`, `RF-93`, `RF-94`, `MD-62`, `MD-64`.

Tarifs convertis par `RF-121` : 155.00 HT → **167.56 TTC/h** (garantie), 165.00 HT → **178.37
TTC/h** (client), 142.50 → **154.04**, 18.50 → **20.00**.

- MO garantie / `constructeur` / 1.8 h à 167.56 / `16756` / `30161` / `2260` / `27901`
- Pompe à eau / `constructeur` / 1 × 154.04 / `15404` / `15404` / `1154` / `14250`
- MO service annuel / `client` / 1.0 h à 178.37 / `17837` / `17837` / `1337` / `16500`
- Huile 5W30 / `client` / 5.0 L à 20.00 / `2000` / `10000` / `749` / `9251`

- `total_ht` / `42151` (CHF 421.51) / `25751` (CHF 257.51)
- `total_tva` / `3414` (CHF 34.14) / `2086` (CHF 20.86)
- `total_ttc` / `45565` (CHF 455.65) / `27837` (CHF 278.37)

**Invariant de non-fuite (`MD-64`), au taux 81 ‰ :**

```
Σ bases des deux documents  = 42151 + 25751 = 67902 ct
Σ bases facturables de l'OR = 27901 + 14250 + 16500 + 9251 = 67902 ct     ✅

Σ TVA des deux documents    =  3414 +  2086 =  5500 ct
Σ TVA des lignes de l'OR    =  2260 +  1154 +  1337 +  749 =  5500 ct     ✅

Σ TTC des deux documents    = 45565 + 27837 = 73402 ct
Σ TTC des lignes de l'OR    = 30161 + 15404 + 17837 + 10000 = 73402 ct    ✅

RF-122 importateur : 42151 + 3414 = 45565 ct                              ✅
RF-122 client      : 25751 + 2086 = 27837 ct                              ✅
```

**Ce que le recalcul confirme et qu'il fallait vérifier** : les **deux TVA sont inchangées** (34.14
et 20.86), et l'invariant de non-fuite tient maintenant sur **trois grandeurs** au lieu de deux — le
TTC s'y ajoute naturellement puisqu'il est l'ancre. Le contrôle nocturne de `RF-88` doit être étendu
au TTC : c'est un contrôle gratuit et c'est celui qui correspond à ce que le client a payé.

À vérifier en plus : les **deux taux horaires coexistent** sur le même OR sans que l'un contamine
l'autre (155.00 figé sur les lignes garantie, 165.00 sur les lignes client) ; l'OR ne passe
`facture` qu'une fois les **deux** documents émis (`RF-84`).

**10.6 `CF-20` — Prise en charge partielle par l'importateur (50 %) ↻ _recalculé (A1) — cas nouveau révélé_**

Prouve `RF-96`, `RF-97`, `MD-63`, `MD-64`. Réparation hors garantie, l'importateur accepte 50 % par
geste commercial.

```
MO 3.0 h à 178.37 TTC :  ttc = 53511 ct   tva = 4010 ct   ht = 49501 ct
Pièce 1 × 735.08 TTC  :  ttc = 73508 ct   tva = 5508 ct   ht = 68000 ct
                         ──────────────────────────────────────────────
TTC total OR = 127019 ct     tva totale = 9518 ct     ht total = 117501 ct
```

Ligne de répartition « Prise en charge importateur 50 % », **mode `ttc` des deux côtés**
(trivialement satisfait depuis `RF-40`) :

```
part = arrondi(127019 × 500, 1000)  = 63510 ct
tva  = arrondi( 63510 ×  81, 1081)  =  4759 ct
ht   = 63510 − 4759                 = 58751 ct
```

> **⚠️ Le cas nouveau que A1 fait apparaître.** En saisie HT, la base valait 117'500 centimes — un
> nombre **pair**, coupé en deux sans reste : les deux factures étaient rigoureusement identiques.
> En saisie TTC elle vaut **127'019 centimes**, un nombre **impair** : la moitié tombe sur
> **63'509.5 centimes**. Le partage à 50 % n'est plus exact, et il ne le sera plus qu'une fois sur
> deux. La formule de ventilation existante tranche de façon déterministe — aucune règle nouvelle —
> mais **les deux factures diffèrent désormais d'un centime**, et l'écran ne doit pas prétendre le
> contraire (`RF-96`).

- `total_ht` / `58750` (CHF 587.50) / `58751` (CHF 587.51)
- `total_tva` / `4759` (CHF 47.59) / `4759` (CHF 47.59)
- `total_ttc` / `63509` (CHF 635.09) / **`63510`** (CHF 635.10)

```
non-fuite base : 58750 + 58751 = 117501 ct    ✅
non-fuite TVA  :  4759 +  4759 =   9518 ct    ✅
non-fuite TTC  : 63509 + 63510 = 127019 ct    ✅

RF-122 client      : 58750 + 4759 = 63509 ct  ✅
RF-122 importateur : 58751 + 4759 = 63510 ct  ✅
```

**La TVA reste rigoureusement identique des deux côtés** (CHF 47.59) : c'est la même ligne de
répartition, prise une fois en positif et une fois en négatif. Seul le centime impair du TTC se
déplace, et il va à l'importateur. Le test doit asserter **les deux montants distincts** — un test
qui vérifierait l'égalité des deux factures échouerait, et c'est exactement ce qu'on veut.

**Variante fautive n°1 — répartition en mode `ht` d'un côté et `ttc` de l'autre.** ↻ **Statut
changé par A1 : elle n'est plus atteignable depuis l'interface**, puisque toute ligne est en `ttc`
(`RF-40`). Elle reste un test du **moteur de calcul** dans `@dfa/shared`, avec un commentaire
disant pourquoi elle survit : un import, une reprise ou une régression peuvent encore produire une
ligne en `ht`. Elle ne décrit plus un risque de production — le dire franchement évite qu'on la
supprime en croyant faire du ménage, ou qu'on la brandisse comme un danger actuel.

**Variante fautive n°2 — la même prise en charge exprimée en rabais de 50 %** sur la facture du
client (`RF-97`). **Inchangée et toujours pleinement d'actualité** : le client paie le même montant,
mais le chiffre d'affaires du garage est amputé de CHF 635.10 TTC et rien n'est réclamable à
l'importateur. C'est désormais la **seule** des deux variantes qui décrive une erreur qu'un
utilisateur peut réellement commettre.

**10.7 `CF-21` — QR au comptoir sans adresse de débiteur**

↻ _montant recalculé (A1), décompte des champs inchangé._

Prouve `RF-59`, `RF-60`, `MD-79`, et le décompte des champs du payload. Facture de `CF-01`
recalculée en ancrage TTC (**CHF 566.63**), client de passage dont la fiche n'a qu'un nom et un
téléphone.

Décompte attendu du payload, séparateur `CR+LF`, encodage UTF-8 :

- En-tête / 3 / `SPC` / `0200` / `1`
- IBAN / 1 / QR-IBAN du garage, sans espaces
- Créancier / 7 / `S` + nom + rue + n° + NPA + localité + pays
- **Ultimate Creditor** / **7** / **7 champs vides** — réservé, jamais rempli
- Montant + devise / 2 / `566.63` / `CHF`
- **Débiteur** / **7** / **7 champs vides** — adresse incomplète (`RF-59`)
- Référence / 2 / `QRR` + 27 chiffres
- Message non structuré / 1 / `Facture 2026-00424`
- Trailer / 1 / `EPD`

```
éléments jusqu'à EPD inclus                    =  31          ✅
séparateurs CR+LF                              =  30 (+1 avant l'information Swico)
champs vides du bloc débiteur                  =   7          ✅
champs vides du bloc Ultimate Creditor         =   7          ✅
longueur totale du payload                     ≤ 997 caractères
```

> **↻ Correction du 29.07.2026 — défaut réel de la rédaction précédente.** Ce cas énumérait
> « 31, 32 ou 34 » éléments. **Il manquait 33**, qui correspond à une facture déclarant **une seule**
> des deux procédures de paiement alternatives — un cas **conforme**. Un garde-fou d'exécution calqué
> sur cette énumération a **refusé d'émettre une facture valide**. C'est un test qui l'a trouvé, pas
> une relecture ; l'énumération était plausible et fausse.
>
> **Valeur attendue : `nb ∈ {31, 32, 33, 34}`.** Et le test doit dériver son attente de la règle de
> `RF-64bis` (base 31 + un par ligne facultative présente), **pas** recopier la liste. Une liste
> recopiée sans sa règle se recopie incomplète — c'est la leçon du défaut, plus que le défaut
> lui-même.

Trois assertions, toutes nécessaires :

- Le payload compte **exactement 31 éléments** jusqu'à `EPD` dans ce cas précis, où aucun bloc
  facultatif n'est présent. **Un test à 30 ou 32 éléments signale l'erreur d'un champ qui décale
  tout le reste et rend le QR illisible.** Le cas doit être décliné sur les quatre comptes possibles
  (`31`, `32`, `33`, `34`), la variante à **33** étant celle qui manquait.
- Aucun champ du bloc débiteur n'est rempli — pas même le nom. Le test doit inclure la variante
  fautive « nom rempli, adresse vide » et vérifier qu'elle est **refusée** à l'émission.
- La même facture avec une adresse complète produit **7 champs remplis** et un payload valide.

**10.8 `CF-22` — Deux moyens de paiement, arrondi sur la seule part espèces**

↻ _revérifié (A1) — valeurs inchangées._

Prouve `RF-50`, `RF-73`, `RF-74`, `MD-49`, `MD-51` (b). Forfait **annoncé CHF 204.31 TTC** (le
tarif de 189.00 HT se convertit exactement en 204.31 TTC, `RF-121`), client dont le plafond carte
est atteint à 100.00.

```
ttc = 20431 ct        tva = arrondi(20431 × 81, 1081) = 1531 ct       ht = 18900 ct
```

**Identique à la rédaction HT au centime près, TVA comprise.** C'est aussi le cas qui montre que
`RF-40` ne perturbe pas l'arrondi au 5 centimes : celui-ci vit sur le **paiement**, jamais sur le
document (`RF-49`), et il est donc indifférent au mode de calcul de la TVA.

- 1 / Carte / `10000` (CHF 100.00) / `10431` (CHF 104.31)
- 2 / Espèces / `10430` (CHF 104.30) / `0`

```
arrondiCinqCentimes(10431) = ((10431 + 2) / 5) × 5 = 10430 ct
écart d'arrondi                                    =     1 ct

imputations : reglement 10000 + reglement 10430 + arrondi 1 = 20431 ct = total facture   ✅
montant réellement encaissé                                 = 20430 ct
```

**Le point du cas** : les imputations totalisent **plus** que l'argent encaissé, et c'est correct —
c'est exactement la restriction de `MD-51` (b) aux imputations de nature `reglement`. Le contrôle de
caisse du soir doit trouver CHF 104.30 dans le tiroir, pas CHF 104.31.

Écriture correspondante :

```
D 1000 Caisse                              104.30
D 1021 Encaissements carte                 100.00
D <compte d'arrondi, QF-03>                  0.01
    C 1100 Créances clients                        204.31     Σ = 204.31  ✅
```

**Variante fautive à tester comme rejet** : arrondir la part **carte** à 100.00 alors qu'elle est
déjà exacte, ou arrondir une part espèces **intermédiaire** (`RF-50`) — deux arrondis successifs sur
la même facture produiraient un écart de 4 centimes inexplicable.

**10.9 `CF-23` — Acompte encaissé **sans** facture d'acompte**

Prouve `RF-76`, `RF-77`, `MD-54` (dispositif 1). **À lire en regard de `CF-07`, qui traite le même
argent par l'autre dispositif** — c'est la comparaison qui donne à `QF-02` sa réponse.

Véhicule à **CHF 24'500.00 TTC**, mode `ttc`, 81 ‰. Acompte de **CHF 5'000.00** encaissé à la
signature du bon de commande.

```
tva véhicule = arrondi(2'450'000 × 81, 1081) =   183'580 ct  →  CHF  1'835.80
ht  véhicule = 2'450'000 − 183'580           = 2'266'420 ct  →  CHF 22'664.20
solde après lettrage de l'acompte            = 1'950'000 ct  →  CHF 19'500.00
```

Écritures :

```
à l'encaissement de l'acompte (aucune TVA) :
D 1020 Banque                            5'000.00
    C 2030 Acomptes de clients                   5'000.00     Σ = 5'000.00  ✅

à l'émission de la facture finale :
D 1100 Créances clients                 24'500.00
    C 3000 Ventes de véhicules                  22'664.20
    C 2200 TVA due 8.1 %                         1'835.80     Σ = 24'500.00 ✅

au lettrage de l'acompte sur la facture :
D 2030 Acomptes de clients               5'000.00
    C 1100 Créances clients                      5'000.00     Σ = 5'000.00  ✅
```

**Les deux différences avec `CF-07`, qui sont tout l'objet du cas :**

```
compte 2030 mouvementé en TTC (5'000.00) — en CF-07 il l'était en HT (4'625.35)
TVA déclarée à la date de l'acompte : 0.00 — en CF-07 elle valait 374.65
```

Dans les deux dispositifs le client verse la même somme et le garage encaisse la même somme. **Seule
la date d'exigibilité de la TVA change** — un trimestre d'écart sur une déclaration. Le test doit
asserter les deux valeurs côte à côte pour que la discussion avec la fiduciaire (`QF-02`) parte de
chiffres et non d'une intuition.

À vérifier en plus : la facture finale de `CF-23` **ne porte aucune** ligne `acompte_deduit`
(`RF-78` ne s'applique qu'au dispositif 2) ; le solde du compte `2030` revient exactement à zéro pour
le dossier.

**10.10 `CF-24` — Remise de pied de facture sur une facture **multi-taux** ↻ _recalculé (A1) — l'erreur change de cachette_**

Prouve `RF-42`, `RF-43`, `RF-44`, `MD-59`, `MD-60`, `RF-122`. Le cas qui justifie la ventilation :
sans elle, le client paie **exactement la même chose** et la déclaration TVA est **fausse**.

Facture mêlant du 8.1 % et un débours hors champ (émoluments du service des automobiles avancés pour
le client), remise globale de **CHF 100.00 TTC**. Bases converties par `RF-121` : 800.00 HT →
**864.80 TTC**, 400.00 HT → **432.40 TTC** ; le débours en régime `exclu` reste à **120.00** (taux
nul, la conversion est l'identité).

- 1 / Main-d'œuvre / `normal` 81 ‰ / `86480` / `6102` / `80378` / `6023` / `74355`
- 2 / Pièces / `normal` 81 ‰ / `43240` / `3051` / `40189` / `3011` / `37178`
- 3 / Débours émoluments / `exclu` 0 ‰ / `12000` / `847` / `11153` / `0` / `11153`

```
parts au prorata des bases TTC : arrondi(10000 × 86480, 141720) = 6102
                                 arrondi(10000 × 43240, 141720) = 3051
                                 arrondi(10000 × 12000, 141720) =  847
Σ parts = 10000 ct = remise globale saisie                              ✅ (invariant MD-60)

total_ttc = 131720 ct   (CHF 1'317.20)   = 141720 − 10000              ✅ TTC annoncé tenu
total_tva =   9034 ct   (CHF    90.34)
total_ht  = 122686 ct   (CHF 1'226.86)

RF-122 : 122686 + 9034 = 131720 ct                                      ✅

document_vente_tva :  (normal, 81, base 111533, tva 9034)
                      (exclu,   0, base  11153, tva    0)
```

**La variante fautive, à tester explicitement** — remise imputée en totalité sur le taux normal :

```
ttc 81 ‰ fautif = 129720 − 10000 = 119720 ct
tva fautive     = arrondi(119720 × 81, 1081) = 8971 ct
ht  fautif      = 119720 − 8971              = 110749 ct

total_ttc = 131720 ct   ← IDENTIQUE à la variante correcte
total_tva =   8971 ct   ← écart de 63 ct
total_ht  = 122749 ct   ← écart de 63 ct, en sens inverse
base déclarée au taux normal : 110749 au lieu de 111533  ← fausse de 784 ct
```

**Ce qui a changé, et c'est l'essentiel du recalcul.** En saisie HT, la grandeur rigoureusement
identique entre les deux variantes était le **total HT** ; la TVA seule divergeait, de CHF 0.74.
En saisie TTC, la grandeur identique est le **total TTC** — CHF 1'317.20 dans les deux cas — et
l'écart de CHF 0.63 se répartit **en miroir sur la TVA et sur le HT**.

- Identique dans les deux variantes / total HT (1'220.00) / **total TTC (1'317.20)**
- Écart de TVA / 0.74 / **0.63**
- Écart de HT / **0.00** — invisible / **0.63** — visible en interne
- Base fausse au taux normal / 9.09 / **7.84**

**L'argument de `RF-43` survit intact, et se renforce.** L'erreur reste **totalement invisible pour
le client** : il paie CHF 1'317.20 dans les deux cas, et aucune relecture du document ne peut la
détecter. Mais elle devient **détectable en interne**, puisque le total HT diverge désormais lui
aussi. C'est un gain net de détectabilité — un contrôle de cohérence sur le HT attrape maintenant ce
que seul un contrôle sur la TVA attrapait avant.

La conclusion ne bouge pas d'un pouce : **la ventilation doit être imposée par le code, pas
recommandée par une procédure.** Ce qui bouge, c'est qu'on dispose d'un second filet.

**10.11 `CF-25` — Consigne d'échange standard et retour de la vieille pièce**

↻ _revérifié (A1) — valeurs inchangées._

Prouve `RF-100`, `MD-23`, `MD-40`. Alternateur en échange standard, consigne **annoncée
CHF 162.15 TTC** (le tarif de 150.00 HT se convertit exactement en 162.15 TTC, `RF-121`).

- Facture initiale, ligne de consigne / `15000` / `1215` / `16215`
- Avoir partiel au retour de la pièce / `−15000` / `−1215` / `−16215`

```
tva = arrondi(16215 × 81, 1081) = 1215 ct        →  CHF 12.15
ht  = 16215 − 1215              = 15000 ct       →  CHF 150.00
solde de la ligne après avoir   =     0 ct                           ✅
```

**Identique à la rédaction HT au centime près.** Le seul changement est d'ergonomie et il compte :
la consigne s'annonce désormais **« 162.15 »** au comptoir, et c'est ce montant que le client verra
revenir sur son avoir.

À vérifier en plus : l'avoir partiel ne porte **que** la ligne de consigne, pas la pièce elle-même ;
il hérite du taux de la facture (`MD-23`) ; sa TVA est **exactement** l'opposée au centime (symétrie
de `MD-40`) ; et un second avoir sur la même ligne de consigne est **refusé** (`MD-23` : Σ avoirs ≤
total de la facture, par taux).

⚠️ _Ce cas repose sur les hypothèses de `RF-100` — existence de la pratique, taux applicable à la
consigne. À reprendre si @laupernoe indique une autre pratique._

**10.12 `CF-26` — Escompte réclamé hors délai**

↻ _revérifié (A1) — valeurs inchangées._

Prouve `RF-47`, `RF-48`. Même facture que `CF-14`, **annoncée CHF 3'459.20 TTC** (le tarif de
3'200.00 HT se convertit exactement en 3'459.20 TTC, `RF-121`) :

```
ttc = 345920 ct   tva = arrondi(345920 × 81, 1081) = 25920 ct   ht = 320000 ct
```

**Rigoureusement identique à la rédaction HT.** Et il y a une raison de fond, qui vaut d'être dite :
**l'escompte était déjà calculé sur le TTC** (`CF-14` : 2 % de 3'459.20), parce que c'est le montant
que le client déduit de son virement. A1 ne pouvait donc rien changer ici — tout le mécanisme
d'escompte, y compris la correction proportionnelle de TVA, était déjà ancré du bon côté.

Conditions 2 % à 10 jours. **Le client paie le 25ᵉ jour** en déduisant quand même l'escompte.

```
montant versé              = 339002 ct   (CHF 3'390.02)
escompte pris par le client =   6918 ct   (CHF    69.18)
```

- Imputation `reglement` — `339002` ct
- Imputation `escompte` — **aucune** — pas d'imputation automatique
- `solde_centimes` — **`6918`** (CHF 69.18)
- `statut_reglement` — **`partiel`**
- Signalement à l'écran — « Escompte pris hors délai : 25ᵉ jour pour 10 jours convenus »

Le comptable dispose alors de deux actions, **toutes deux humaines** :

```
accorder  → imputation 'escompte' 6918, dont TVA 518 et HT 6400   → statut 'regle'
relancer  → le solde de 69.18 reste ouvert et part en relance
```

Les valeurs de la branche « accorder » sont **exactement** celles de `CF-14`, ce que le test doit
asserter pour prouver que le chemin hors délai et le chemin dans les délais produisent la même
comptabilité une fois la décision prise :

```
TVA de l'escompte = arrondi(6918 × 81, 1081)              =   518 ct   ✅
HT  de l'escompte = 6918 − 518                            =  6400 ct   ✅
TVA nette due     = 25920 − 518                           = 25402 ct
                  = arrondi((320000 − 6400) × 81, 1000)   = 25402 ct   ✅
```

**Variante fautive à tester comme rejet** : une imputation `escompte` créée automatiquement à la
réception du paiement. `RF-47` l'interdit dans les deux sens — ni accord ni refus automatique.

**10.13 `CF-27` — Changement de fiduciaire en cours d'exercice ↻ _cibles mises à jour (A3)_**

Prouve `RF-109`, `RF-110`, `RF-112`, `RF-113`, `MD-86`, `MD-91`, `MD-92`. **WinBIZ** en `detaille`
jusqu'au 30.06.2026, **CSV générique** en `agrege` à partir du 01.07.2026.

**Pourquoi ces deux cibles, et pas iReach ni Banana.** Le scénario a besoin de deux cibles dont le
format **et** le mode d'agrégation sont établis, sinon le test valide une fiction. Ce sont
exactement les deux cibles de `CIBLES_EXPORT` dont le format est connu : WinBIZ est la cible du
pilote et son format est sourcé (`EF-10`) ; le CSV générique est le seul autre format maîtrisé de
bout en bout, et il supporte le mode `agrege` — ce que le cas doit exercer.

- **Banana** aurait fait un contraste plus naturel, mais son adaptateur est **différé** (§0.3). Le
  cas se réécrira avec Banana le jour où elle sera livrée ; **le scénario ne change pas**, seule la
  cible change. C'est précisément la neutralité que `RF-102` promet.
- **iReach n'apparaît volontairement dans aucun cas de test** tant que `EF-20` n'est pas tranché. Un
  test écrit contre un format supposé est **pire qu'un test absent** : il donne la sensation d'une
  couverture qu'on n'a pas, et il passera au vert jusqu'au premier export réel.

- Lot WinBIZ de juin, déjà transmis — Reproductible à l'identique — même `empreinte_sha256`
- Documents de juin dans le lot CSV de juillet — **Aucun** (`MD-92`)
- Mapping WinBIZ — `actif_au = 2026-06-30`, **jamais supprimé ni écrasé**
- Mapping CSV — `actif_du = 2026-07-01`
- Ré-génération d'un export de mai après la bascule — Utilise le mapping **de mai**, pas celui de juillet
- `correspondance_externe` cible CSV — Vide avant le premier export, remplie après
- `correspondance_externe` cible WinBIZ — **Inchangée** — elle reste exploitable si l'on revient
- Bascule tentée au 15.07 (milieu de période) — **Refusée** (`RF-112`)
- Avoir émis le 05.07 sur une facture de juin — Part dans le lot **CSV de juillet** (`MD-93`)

```
Σ débits = Σ crédits sur chacun des deux lots, en bigint                        ✅
Σ des écritures WinBIZ (jan–juin) + Σ des écritures CSV (juil–déc)
  = Σ de tous les documents de l'exercice, sans doublon ni manquant             ✅
```

Ce dernier contrôle est le seul qui prouve qu'aucune écriture n'a été perdue ou comptée deux fois à
la charnière — et c'est exactement ce que le garage et sa nouvelle fiduciaire voudront voir.

**10.14 Table de couverture ↻ _révisée — contrainte de budget_**

> **Consigne de @laupernoe pour l'étape 2 : pas de tests d'intégration, pas de suite de sécurité.**
> Elle est appliquée telle quelle ci-dessous. Elle a un coût, il est chiffrable, et le taire serait
> la pire façon de la respecter — d'où la colonne « ce qui n'est plus prouvé ».

**Ce qui reste testé, et qui couvre l'essentiel de l'argent :**

- `CF-16` / `RF-11` → `RF-15` / `@dfa/shared` (montants) / **Partiel** — les montants oui, le verrouillage non
- `CF-17` / `RF-23` → `RF-26`, `RF-28` / — / **Non.** Voir ci-dessous
- `CF-18` / `RF-89`, `RF-90`, `RF-91` / `@dfa/shared` / **Oui**
- `CF-19` / `RF-87`, `RF-88`, `RF-93`, `RF-94` / `@dfa/shared` / **Oui** — le groupement par payeur et la non-fuite sont du calcul pur
- `CF-20` / `RF-96`, `RF-97` / `@dfa/shared` / **Oui**
- `CF-21` / `RF-59`, `RF-60`, `RF-61` / `@dfa/shared` / **Oui**
- `CF-22` / `RF-50`, `RF-51`, `RF-73`, `RF-74` / `@dfa/shared` / **Oui**
- `CF-23` / `RF-76`, `RF-77`, `RF-78` / `@dfa/shared` / **Oui** — montants et écritures
- `CF-24` / `RF-42`, `RF-43`, `RF-44`, `RF-122` / `@dfa/shared` / **Oui**
- `CF-25` / `RF-100` / `@dfa/shared` / **Oui**
- `CF-26` / `RF-47`, `RF-48` / `@dfa/shared` / **Oui**
- `CF-27` / `RF-109`, `RF-110`, `RF-112`, `RF-113` / `@dfa/shared` (équilibre des lots) / **Partiel** — l'équilibre oui, l'unicité des lots non

**Bonne nouvelle du recalcul A1** : dix des douze cas deviennent praticables **sans base de
données**, parce que A1 a déplacé l'essentiel du risque vers l'arithmétique pure — et l'arithmétique
pure est exactement ce qu'un test unitaire prouve le mieux. La contrainte de budget coûte donc
beaucoup moins cher qu'il n'y paraît sur §10.

**Ce qui n'est plus prouvé, et qu'il faut assumer explicitement :**

- **`RF-23` → `RF-28`, `CF-17`** / **Numérotation continue sous concurrence.** Le compteur transactionnel, le rollback qui ne consomme pas de numéro, l'idempotence de l'émission / **Maximale.** Un trou dans la série est le seul défaut de ce document qui se paie devant l'AFC (`RF-20`). Il ne se démontre que sur une vraie base, avec deux transactions réelles — aucun test unitaire ne peut l'approcher
- `RF-10`, `RF-31`, `RF-120` / Le trigger d'immuabilité et l'absence de privilège `DELETE` / Élevée — c'est une garantie de **base**, pas de code
- `RF-114` → `RF-118` / Matrice rôle × action côté serveur / Élevée — et c'est précisément ce que couvrirait la suite de sécurité écartée
- `RF-88` (contrôle nocturne) / La requête de non-fuite sur données réelles / Moyenne — le calcul est testé, la requête ne l'est pas
- `RF-105`, `RF-28` / Le blocage d'export sur détection de trou / Moyenne

**Recommandation, à l'arbitrage de @laupernoe.** Je ne rouvre pas la décision de budget. Mais je note qu'un
**seul** test d'intégration — `CF-17`, la continuité de la numérotation sous concurrence — couvre à
lui seul le risque le plus cher du document, et qu'il est court à écrire : deux transactions
concurrentes, un rollback, une requête de continuité. Si un seul devait être fait, c'est celui-là.
Tout le reste peut raisonnablement attendre le retour du pilote.

**Règles exigeant leurs propres tests, non couvertes par les douze cas ci-dessus** : `RF-54` (refus
d'émission sans bloc créancier), `RF-85` et `RF-86` (matrice statut de ligne × facturabilité),
`RF-99` (taxe d'élimination et intention de restitution — ↻ **cas étendu par A2**),
**`RF-121`** (conversion des tarifs : la table de §4.2 est directement un jeu de test),
**`RF-122`** (l'invariant, à asserter sur **chacun** des douze cas, pas dans un test dédié),
**`RF-123`** (aucun HT hors du récapitulatif de pied — vérifiable sur le gabarit PDF).

**Règles de rédaction, non négociables** (reprises de `CONTRIBUTING.md` et du modèle documentaire §9) :

- **Aucun `toBeCloseTo` sur de l'argent**, jamais. Égalité stricte sur des entiers de centimes.
- Montants **en centimes dans le code** (`56663`), **en francs dans le nom du test**
  (« facture d'atelier de CHF 566.63 »), pour que l'échec soit lisible sans conversion mentale.
- Chaque cas produisant des écritures vérifie **Σ débits = Σ crédits** en plus des montants.
- Chaque variante fautive citée ci-dessus est un test à part entière qui doit **échouer** si le
  garde-fou disparaît.

---

11. Hypothèses à valider et questions ouvertes

---

**11.1 Ce que ce document suppose du terrain — pour @laupernoe**

**✅ Tranchées le 29.07.2026 — ne pas rouvrir**

- **1** / Répartition `ht` / `ttc` par type de ligne / ❌ **Rejetée. Tout est TTC**, saisie et affichage, y compris pour les entreprises. TVA détaillée en pied de facture / `RF-6`, `RF-35`, `RF-39`, **`RF-40`**, `RF-41` → `RF-44`, `RF-78`, `RF-91`, `RF-96`, `RF-100`, **`RF-121`** → **`RF-123`**, §10.0 et 9 cas recalculés
- **2** / Le client peut repartir sans avoir payé / ✅ **Confirmée, et étendue.** C'est courant. Restitution et paiement indépendants dans les deux ordres ; **aucun blocage** / **`RF-83`**, `RF-84`, `RF-99`
- **3** / La fiduciaire du pilote n'est pas sur Abacus / ✅ **Confirmée.** WinBIZ et iReach. Abacus sort du périmètre / §0.3, `RF-102`, `RF-106`, `CF-27`, `docs/exports-fiduciaires.md`

L'hypothèse n°1 était la seule marquée **irrattrapable après coup**. Sa fermeture est le principal
gain de cette révision : il n'existe plus de document dont on ne saura pas, dans six mois, dans
quelle unité il a été saisi.

**⚠️ Encore ouvertes — reclassées par coût, les trois tranchées étant retirées**

Le classement a changé : les deux hypothèses les plus chères sont tombées, et **deux nouvelles
questions sont nées de la révision elle-même** (n°1 et n°2 ci-dessous). Elles arrivent en tête,
parce qu'elles conditionnent des développements qui ne sont pas encore écrits.

- **1** / **✚ iReach est une cible d'export fiduciaire** — et non un DMS concurrent utilisé par le garage lui-même / §0.3, `EF-20` / **Maximal.** Les deux réponses mènent à deux chantiers différents, dans deux étapes différentes. Un adaptateur écrit contre un format supposé est découvert faux au premier export réel. **À lever avant toute ligne de code**
- **2** / **✚ Le garage accepte des tarifs TTC non ronds** (178.37 /h) plutôt que d'arrondir sa grille / `RF-121` / **Élevé** — c'est une décision de **prix**, pas d'arithmétique. À poser avant la bascule du paramétrage, pas après la première facture
- **3** / **✚ `RF-60` doit-elle rester plus stricte que la norme SIX ?** Exiger rue + numéro fait tomber le bloc débiteur pour les cases postales, lieux-dits et hameaux — **courants en Suisse rurale** / `RF-60`, §5.2 / **Moyen à élevé selon le parc.** Jamais un paiement perdu, seulement un bulletin non pré-rempli. Mais si le premier garage est en zone rurale, l'irritant est quotidien. **Décision de @laupernoe**
- 4 / **Les garages pratiquent l'échange standard avec consigne**, TVA au taux normal / `RF-100`, `CF-25` / Moyen — le dispositif dort sans coûter s'il est inutile, mais le taux est une question fiscale (`QF-06`)
- 5 / **Les commissions carte / TWINT sont comptabilisées par la fiduciaire**, pas par DFA / `RF-75` / Moyen — décide si `paiement` porte un montant brut et une commission
- 6 / **Vocabulaire « demande d'accord » vs « devis »** / `RF-2` / Moyen — se corrige, mais après que les utilisateurs ont pris l'habitude
- 7 / **✚ Le garagiste accepte de ne plus voir le HT à la facturation** / `RF-123` / Moyen — conséquence directe de A1. Si le terrain le rejette, c'est l'**ergonomie** qui s'adapte (où retrouver le HT), jamais la règle de saisie
- 8 / **Le client qui paie cash au comptoir reçoit une facture sans bulletin** / `RF-62` / Faible — question de gabarit
- 9 / **L'escompte est pratiqué** (au moins en B2B) / `RF-48` / Faible — le dispositif se désactive par paramètre
- 10 / **Arrondi 5 centimes actif par défaut** / `RF-52` / Faible — sans conséquence tant qu'aucune espèce n'entre
- 11 / **Mention « DUPLICATA » sur une réimpression** / `RF-19` / Faible, mais structurant s'il faut deux PDF distincts
- 12 / **Facturation en EUR** — le cas existe-t-il ? / `RF-58` / Faible — change le paramétrage bancaire
- 13 / **Traductions DE/IT des types de document** / `RF-3` / Faible — à confirmer par `expert-i18n`

**Deux questions à poser aux garages qui n'apparaissent nulle part ailleurs :**

- **Facture comptoir sans OR.** Un client achète des balais d'essuie-glace et repart. Est-ce une
  facture DFA (donc un numéro de la série), un ticket de caisse, ou un OR fictif ? Ce document ne
  tranche pas et le modèle le permet (une facture sans `ordre_reparation_id`), mais le parcours
  d'écran en dépend entièrement.
- **Facturation groupée mensuelle pour les flottes.** Un gestionnaire de flotte reçoit-il une
  facture par OR ou un relevé mensuel ? La seconde forme change la chaîne documentaire (plusieurs OR
  → une facture) et n'est pas couverte par ce document.

⚠️ **À VALIDER AVEC @laupernoe** — _ces deux questions sont susceptibles d'ajouter du périmètre à l'étape 2.
Mieux vaut les poser avant l'implémentation que les découvrir au pilote._

**11.2 Les questions qui ne sont pas les miennes**

`QF-01` → `QF-13` du modèle documentaire restent ouvertes et **aucune ne doit être tranchée par un
agent**. Ce document n'en résout aucune ; il les rend seulement plus concrètes :

- `QF-01` — TVA = Σ des TVA de ligne ? — Confirmé comme règle (`RF-35`), écart chiffré par `CF-03`. ↻ **A1 durcit la réponse** : ce n'est plus un choix de méthode, c'est la condition de `RF-122`. La fiduciaire peut contester la valeur ; elle ne peut pas demander l'autre méthode sans casser l'égalité `Σ HT + Σ TVA = TTC annoncé`
- `QF-02` — Acomptes : facture ou encaissement ? — **`CF-23` chiffre enfin l'autre branche** et la met en regard de `CF-07`. La décision se prend maintenant sur deux jeux de chiffres
- `QF-03` — Plan comptable, compte d'arrondi, TVA sur l'arrondi — `CF-22` ajoute le compte d'encaissement carte à la liste à valider
- `QF-04` — Escompte : imputation ou avoir ? — `RF-46` retient l'imputation ; `CF-26` ajoute le cas hors délai
- `QF-05` — Sinistre : facture adressée au client ou à l'assurance ? — `RF-87` sépare destinataire et payeur, sans imposer de pratique
- `QF-06` — Taxes de recyclage, débours, taux historiques — `RF-99` ajoute une question : la taxe d'élimination est-elle due quand le client reprend sa pièce ? ↻ **A2 en ajoute une seconde, plus fine** : elle se juge désormais sur l'**intention** du client à l'émission, la restitution pouvant survenir après la facture. `CF-24` ajoute le traitement des débours en régime `exclu`
- `QF-07` — Occasions, impôt préalable fictif — Hors périmètre étape 2 (`dossier_vente_id` posée, vide)
- `QF-08` — `exonere` vs `exclu`, justificatifs — `CF-24` exerce le régime `exclu` sur un débours
- `QF-09` — Monotonie des dates : bloquant ou avertissement ? — `RF-16` en dépend directement pour le cas de la correction tardive. **Reste ouverte, et volontairement** : **aucun code d'erreur n'a été créé** dans le contrat partagé, précisément pour ne pas préjuger de la réponse. Créer un code `DATE_NON_MONOTONE` reviendrait à trancher « bloquant » par le seul fait de l'existence du code. C'est une question pour la fiduciaire de @laupernoe
- `QF-10` — Créances reprises, grand livre des débiteurs — `RF-112` montre que le **même** problème se repose à chaque changement de fiduciaire, pas seulement à la reprise
- `QF-11` — Mentions légales obligatoires (LTVA art. 26) — Non traité ici : c'est le gabarit PDF
- `QF-12` — Délais, escompte, cadence de relance — `RF-48` en dépend
- `QF-13` — Conservation 10 ans, intégrité — `RF-19` en dépend (duplicata = PDF stocké, pas régénéré)

**11.3 Ce que ce document affirme, et avec quel degré de certitude**

Par honnêteté sur le statut de ce qui précède :

- **L'arithmétique de §10 est exécutée**, pas relue — et **réexécutée** après l'arbitrage A1, sous
  ancrage TTC, avec les mêmes `arrondiCommercial()` et `arrondiCinqCentimes()` (`MD-40`, `MD-47`) en
  `bigint`. Toutes les assertions passent, y compris les trois invariants de non-fuite de `CF-19` et
  `CF-20`, le nouvel invariant `RF-122`, et le contrôle de reproduction des valeurs d'origine sur les
  cinq cas inchangés. C'est le seul endroit de ce document dont je réponds sans réserve.
- **Ce dont je ne réponds pas** : `CF-01` → `CF-15` vivent dans
  `docs/modele-documentaire-facturation.md`, **hors de mon périmètre d'écriture**. J'ai listé en
  §10.0 ceux que A1 affecte et l'effet attendu, mais **je ne les ai ni modifiés ni recalculés** —
  sauf `CF-01`, dont j'avais besoin comme support de `CF-16` et `CF-21`. Ce tableau est une liste de
  travail à confier au propriétaire de ce document, pas un résultat.
- **La convention de recalcul est un choix, et il se discute.** J'ai retenu la conversion des tarifs
  (`RF-121`) plutôt que leur réétiquetage, parce qu'elle préserve la recette du garage. L'autre
  convention aurait amputé chaque cas de 7.5 %. Si @laupernoe préfère que le garage rebaptisse ses prix sans
  les convertir — c'est-à-dire baisse ses prix de 7.5 % — **tous les montants de §10 changent une
  seconde fois**. Cette question est la n°2 de §11.1 et elle n'est pas tranchée.
- **La couverture de tests est volontairement réduite** (§10.14), sur consigne de budget. Le risque
  résiduel le plus cher est nommément la continuité de la numérotation sous concurrence (`CF-17`),
  qui n'est plus prouvée par rien. Ce n'est pas une réserve sur la spécification : c'est une réserve
  sur ce qui sera livré.
- **iReach n'est décrit nulle part dans ce document comme un format.** Ce qui est écrit à son sujet,
  en §0.3 et dans `docs/exports-fiduciaires.md`, est soit sourcé, soit explicitement marqué comme
  inconnu. Aucun champ, aucune extension, aucune capacité produit n'a été supposé.
- **Le décompte des champs du payload QR** (§5.3, `CF-21`) : 7 champs pour le bloc _Ultimate
  Creditor_ et 31 éléments jusqu'à `EPD`. Cela **contredit** le « 6 lignes vides » de
  `modele-documentaire-facturation.md` §5.3. Ma lecture est qu'un bloc d'adresse comporte `AdrTp`
  **plus** six lignes, mais **c'est la spécification officielle qui tranche, pas moi** — à vérifier
  avant d'écrire l'encodeur.
- **Les règles de droits de §9** sont une proposition cohérente, pas une observation. Dans un garage
  de quatre personnes, le réceptionnaire fait tout et la matrice sera vécue comme une entrave ; dans
  une concession de trente, elle sera jugée trop laxiste. Elle doit être confrontée au pilote.
- **Les traitements de la garantie, de la consigne et de la prise en charge par un tiers** (§7.4,
  §7.5) sont déduits de la logique comptable et de ce que permettent les contrats de l'étape 1. Ils
  **n'ont été confrontés à aucun garage**. Ce sont les paragraphes de ce document dont je suis le
  moins sûr, et ils sont marqués comme tels.
- **Les taux de TVA, les comptes et les mentions légales** restent ce qu'en dit le modèle
  documentaire : une base de travail soumise à `QF-03`, `QF-06` et `QF-11`, **pas une source
  fiscale**.

---
