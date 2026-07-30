# Design — Impression de la facture et bulletin QR

> Auteur : expert-ui. Comble un trou signalé dans `docs/design-etape-2-facturation.md` §4.6 : le menu
> `⋯` de l'écran facture y prévoyait déjà une entrée « Imprimer / télécharger le PDF », **sans qu'aucun
> endpoint ni aucune génération n'existe** — `EcranFicheFacture.tsx` le documente lui-même dans son
> commentaire de tête (« Menu ⋯ réduit »). Ce document tranche comment cette entrée se câble enfin.
>
> Fondations métier : `docs/modele-documentaire-facturation.md` §5 (QR-facture, `MD-73` → `MD-83`) et
> `docs/specification-etape-2-facturation.md` §5 (`RF-53` → `RF-64bis`). Continuité visuelle :
> `docs/design-comptoir.md` (tokens, patrons), `docs/design-etape-2-facturation.md` (écran facture,
> vocabulaire, statuts). **Ce document ne redéfinit aucune primitive** — il ajoute une action et deux
> états sur un écran qui existe déjà, et tranche l'architecture serveur qui la rend possible.
>
> Vérifié avant d'écrire une ligne de ce document : ni PDF ni rendu QR n'existent dans le dépôt
> (aucune dépendance de type PDF/QR/Puppeteer/Playwright dans `apps/api/package.json` ni
> `apps/web/package.json`), mais le contrat les anticipe déjà — `ReponseDocumentVente.pdfCle` /
> `.pdfSha256` existent et sont `null` partout (colonnes `pdf_cle`/`pdf_sha256`,
> `apps/api/src/db/schema/facturation/document-vente.ts:139-140`), jamais écrites par aucun code à ce
> jour. Ce document dit ce qui doit les remplir.

---

## Sommaire

0. [Ce qui est déjà tranché ailleurs, repris tel quel](#0-ce-qui-est-déjà-tranché-ailleurs-repris-tel-quel)
1. [`DI-1` — Génération serveur, PDF natif — pas d'impression navigateur seule](#1-di-1--génération-serveur-pdf-natif--pas-dimpression-navigateur-seule)
2. [`DI-2` — Rendu du QR : côté serveur, une seule fois, jamais dans le navigateur](#2-di-2--rendu-du-qr--côté-serveur-une-seule-fois-jamais-dans-le-navigateur)
3. [`DI-3` — Cycle de vie : génération à la demande, cache, jamais de régénération silencieuse](#3-di-3--cycle-de-vie--génération-à-la-demande-cache-jamais-de-régénération-silencieuse)
4. [`DI-4` — Contraintes dimensionnelles SIX : ce qui est vérifié, ce qui ne l'est pas](#4-di-4--contraintes-dimensionnelles-six--ce-qui-est-vérifié-ce-qui-ne-lest-pas)
5. [`DI-5` — L'écran : les trois cas mesurés](#5-di-5--lécran--les-trois-cas-mesurés)
6. [`DI-6` — Multilingue : la langue du client, jamais celle de l'utilisateur connecté](#6-di-6--multilingue--la-langue-du-client-jamais-celle-de-lutilisateur-connecté)
7. [Composants et endpoints à ajouter](#7-composants-et-endpoints-à-ajouter)
8. [Hors périmètre, volontairement](#8-hors-périmètre-volontairement)
9. [À vérifier avant implémentation](#9-à-vérifier-avant-implémentation)
10. [Ce qui appartient à @laupernoe](#10-ce-qui-appartient-à-laupernoe)
11. [Implémentation backend — bibliothèque, invariant de vérification, état de livraison (expert-facturation)](#11-implémentation-backend--bibliothèque-invariant-de-vérification-état-de-livraison-expert-facturation)

---

## 0. Ce qui est déjà tranché ailleurs, repris tel quel

Trois faits du modèle documentaire structurent tout ce qui suit — je ne les redécide pas, je les
prends comme contraintes dures :

- **`MD-77`** : `qr_payload` est figé octet pour octet à l'émission. Un duplicata **reproduit** cette
  chaîne, il ne la **recalcule** jamais — un changement d'IBAN ou de raison sociale ne doit jamais
  réécrire le bulletin d'une facture déjà envoyée.
- **`MD-78`** : ce qui n'est **pas** figé, c'est la mise en page et l'image du QR elle-même — les deux
  sont *dérivées à l'affichage* depuis le payload stocké. Régénérer avec un gabarit corrigé est
  légitime tant que le payload ne bouge pas. **Conséquence directe pour ce document** : le PDF stocké
  (`pdfCle`) est un **cache de confort et une preuve d'intégrité** (`pdfSha256`), pas la source de
  vérité. La source de vérité reste `qrPayload` + `qrPayloadSha256`.
- **`RF-19`** (déjà écrit comme intention dans `EcranFicheFacture.tsx`, jamais câblé) : « Dupliquer
  (réimpression) » réimprime l'octet **stocké**, il ne recrée rien.

---

## 1. `DI-1` — Génération serveur, PDF natif — pas d'impression navigateur seule

**Décision : le document imprimable (facture + bulletin QR) est un PDF produit côté serveur par une
bibliothèque de génération PDF native (positionnement en unités physiques exactes), jamais par
`window.print()` / `@media print` sur le HTML de l'écran, et jamais par un navigateur headless
(Puppeteer/Playwright) qui imprimerait une page HTML.**

**Pourquoi pas l'impression navigateur**, alors qu'elle ne coûte aucune dépendance et colle à la
philosophie « 100% navigateur » : le bulletin de versement a des tolérances dimensionnelles imposées
par SIX, et **un bulletin hors tolérance est refusé par la banque** — ce n'est pas une question
esthétique, c'est un paiement qui échoue. Or `@media print` ne donne aucune garantie sur le résultat
physique : l'échelle « Ajuster à la page » (souvent activée par défaut), le format papier choisi par
l'utilisateur, les marges du pilote d'impression et les en-têtes/pieds de page automatiques du
navigateur sont hors du contrôle de DFA une fois le dialogue d'impression ouvert. Un PDF déjà mis en
page en unités physiques exactes, ouvert et imprimé depuis un lecteur PDF, élimine cette variable :
ce n'est plus le moteur d'impression du navigateur qui décide de la taille du QR sur le papier.

**Pourquoi pas un navigateur headless** (Puppeteer/Playwright rendant le HTML de l'écran en PDF) :
cette option donnerait un contrôle correct de la mise en page, mais au prix d'une dépendance système
lourde (binaire Chromium, plusieurs centaines de Mo), alors que l'environnement actuel — dev **et**
prod — ne fait tourner que Postgres et Redis en conteneurs (`pnpm docker:up`). Ajouter un navigateur
headless change la nature de l'infrastructure (image Docker beaucoup plus grosse, surface d'attaque
supplémentaire, gestion mémoire d'un processus notoirement gourmand) pour un besoin qui ne demande pas
de moteur de rendu web : une facture est une mise en page fixe, pas une page interactive.

**Ce que ce choix rend difficile — honnêtement** :
- Le gabarit de facture se code en positions physiques (bibliothèque de type PDFKit ou équivalent),
  **pas en HTML/CSS** : ce n'est pas le langage que l'équipe front manipule tous les jours, et toute
  évolution future du gabarit (logo, réagencement) passe par ce code-là, pas par une feuille de style.
- **Pas d'aperçu « live » facile** pendant qu'on regarde l'écran : sans rendu HTML, il n'y a pas
  d'équivalent simple à « Ctrl+P pour voir si ça a l'air bon ». Ce document tranche (§8) qu'il n'y a
  **aucun aperçu intégré à l'écran en V1** — seulement un bouton qui télécharge le PDF final. C'est un
  choix de portée assumé, pas un oubli.
- Ce n'est **pas** une entorse au principe « 100% navigateur » : ce principe protège le **garage** de
  toute installation cliente (ARCHITECTURE.md : « zéro installation, zéro serveur chez le client »). Il
  ne dit rien du lieu où un calcul serveur a lieu. Le garagiste continue tout depuis son navigateur ;
  la génération PDF est un détail d'infrastructure invisible pour lui.

---

## 2. `DI-2` — Rendu du QR : côté serveur, une seule fois, jamais dans le navigateur

**Décision : le symbole QR est encodé en image au moment de la génération du PDF (§1), côté serveur,
à partir de `qrPayload` figé — et nulle part ailleurs.** Aucun rendu QR côté client, ni comme aperçu
sur l'écran de la facture, ni ailleurs.

**Raison** : `DI-1` a déjà tranché que le PDF est l'artefact qui fait foi visuellement. Faire aussi un
rendu QR côté navigateur (une petite bibliothèque de génération SVG, par exemple) pour un aperçu à
l'écran créerait **deux implémentations indépendantes du même symbole** — une pour l'écran, une pour
le PDF — avec le risque réel qu'elles divergent (police de fond, marges, version de bibliothèque) sur
un document où la moindre différence visuelle peut faire douter un garagiste de ce qu'il envoie. Une
seule implémentation, une seule fois, élimine ce risque par construction plutôt que par discipline.

**Conséquence pour l'écran `/factures/:id`** : pas de composant `<AperçuQr>` en React. La carte
« Bulletin de versement » décrite en §5 affiche les informations du bulletin **en texte** (créancier,
référence, montant, langue) sans image QR — l'image QR existe uniquement dans le PDF téléchargé.

---

## 3. `DI-3` — Cycle de vie : génération à la demande, cache, jamais de régénération silencieuse

**Décision : le PDF est généré au premier clic explicite sur « Imprimer / télécharger le PDF »** — pas
automatiquement à l'émission de la facture. Le résultat est stocké (`pdfCle` = clé de l'objet stocké,
`pdfSha256` = son empreinte, colonnes déjà présentes et inutilisées). Tout accès ultérieur — réouverture
de la fiche, « Dupliquer (réimpression) » (`RF-19`), futur envoi par courriel — sert l'octet **stocké**,
sans jamais régénérer.

**Pourquoi pas une génération systématique à l'émission** : une partie des documents émis (devis
transformés sans être jamais réimprimés, avoirs seulement consultés à l'écran) ne sera jamais
téléchargée. Payer le coût de génération PDF sur 100% des émissions pour ne servir qu'une fraction
d'entre elles est un gaspillage mesurable dès le pilote — dix garages, un volume de documents réel.

**Coût assumé** : le tout premier clic sur « Imprimer » a une latence perceptible (génération
synchrone, une page). Un état de chargement sur le bouton suffit probablement ; pas besoin d'une file
de job asynchrone pour un document d'une page — à confirmer une fois la bibliothèque PDF choisie et
son temps de génération mesuré.

**Garde-fou explicite** : modifier la fiche client (compléter une adresse manquante, par exemple)
**ne doit jamais** invalider ni régénérer un PDF déjà stocké — cf. `MD-77`, un changement de donnée
vivante ne doit jamais réécrire un document déjà remis au client. La seule régénération légitime
(`MD-78`) est une correction manuelle de gabarit, un geste d'exploitation hors écran, pas un
sous-produit d'une action utilisateur normale.

---

## 4. `DI-4` — Contraintes dimensionnelles SIX : ce qui est vérifié, ce qui ne l'est pas

**Aucune dimension en millimètres n'est vérifiée dans ce dépôt à ce jour, et je n'en invente aucune
ici.** Une recherche dans `docs/*.md` ne fait remonter aucune mesure physique du bulletin — seul le
contenu du payload (`docs/modele-documentaire-facturation.md` §5.3) et des règles de contenu (adresse,
langues, longueurs de champ) sont documentés et vérifiés.

Ce qui **est** documenté et vérifié dans ce dépôt, et qui doit servir de garde-fou méthodologique
avant d'aller chercher les dimensions : `docs/specification-etape-2-facturation.md` (`RF-64`,
autour de la ligne 830) rapporte qu'**une tentative antérieure d'extraction du PDF officiel SIX a
produit du contenu inventé, et a été écartée** — le décompte de 31 éléments du payload n'a finalement
pas été établi par lecture de la spec officielle, mais par concordance de trois implémentations open
source indépendantes (`stapelberg/qrbill`, `claudep/swiss-qr-bill`, `docs.qr-invoice.ch`). C'est une
preuve empirique forte, explicitement **pas** une preuve documentaire — et le même document dit noir
sur blanc que « la vérification contre le document officiel de SIX reste à faire ».

**Pour ce document (mise en page imprimée), la même prudence s'applique, en pire** : le contenu du
payload tolère une marge d'erreur (un champ mal ordonné casse tout, un champ manquant aussi — c'est
binaire), mais une **dimension physique légèrement fausse** (taille du symbole QR, zone de repos
autour de lui, taille et présence de la croix suisse en son centre, position et dimensions de la
section paiement sur la page, format du récépissé) peut produire un bulletin qui **scanne encore**
mais que la banque refuse pour non-conformité — une erreur plus sournoise qu'un payload cassé,
parce qu'elle ne se révèle qu'au guichet, pas en test automatisé.

**Recommandation méthodologique, pas une mesure** : ne pas retenter une extraction automatique du PDF
officiel SIX en espérant un résultat différent — l'échec précédent est documenté, pas accidentel.
Deux voies plus sûres, à trancher à l'implémentation :
1. Lire le document officiel SIX (« Swiss Implementation Guidelines QR-bill », publié par SIX / le
   registre `paymentstandards.ch`) **manuellement**, page par page, en citant la page exacte pour
   chaque mesure retenue — pas d'extraction automatisée non vérifiée.
2. Adopter une bibliothèque de génération QR-bill suisse déjà largement utilisée et maintenue, qui
   encode déjà ces dimensions dans son code — et **vérifier sa conformité** (maintenue, testée par sa
   communauté, dimensions traçables à la spec) plutôt que redériver les mesures à la main.

Les deux voies convergent vers la même exigence : **aucune dimension ne doit entrer dans le code sans
une citation vérifiable de sa source.**

---

## 5. `DI-5` — L'écran : les trois cas mesurés

Route inchangée, `/factures/:id` (`EcranFicheFacture.tsx`). Trois amendements, correspondant aux trois
cas mesurés — **aucun n'est une erreur, les trois sont des états normaux à afficher clairement.**

### 5.1 Action « Imprimer / télécharger le PDF »

Ajoutée au menu `⋯` déjà existant (celui qui porte aujourd'hui « Corriger cette facture » et
« Créer un avoir »), **uniquement pour un document `typeDocument = 'facture'`, `statut ∈ {emis,
annule_par_avoir}`** — un brouillon n'a rien à imprimer, l'émission verrouille avant tout.

**Gate de droit, pas seulement d'affichage** : cette action ne doit **jamais** être visible — et
encore moins active — pour un rôle sans droit aux montants (`RF-116`, `ROLES_SANS_MONTANT_FACTURATION`
dans `apps/api/src/facturation/documents/mappeurs.ts`, déjà responsable de rendre `qr: null` et les
totaux absents pour ce rôle). **Un PDF de facture contient nécessairement les montants** : si l'action
n'est masquée qu'à l'écran sans être refusée côté serveur, `RF-116` est contournable en un clic
(appel direct de l'endpoint PDF). Ce n'est pas une préférence d'écran, c'est une condition de
correction de `RF-116` — signalé explicitement pour `expert-api`/`reviewer-securite` : l'endpoint PDF
doit appliquer la même règle de droit que `GET /documents-vente/{id}`, pas une règle plus permissive.

**Incohérence relevée dans le code actuel, à trancher à l'implémentation** : `EcranFicheFacture.tsx`
masque aujourd'hui **tout** le menu `⋯` (pas seulement « Imprimer ») dès que `estAnnuleeParAvoir` est
vrai — alors que `docs/design-etape-2-facturation.md` §4.6 prévoyait explicitement que « le menu ⋯ ne
garde que Voir le journal et Imprimer » sur une facture annulée par avoir (le document annulé reste
consultable, `RF-32`). Câbler « Imprimer » implique de rouvrir cette condition pour cette seule entrée.

### 5.2 Carte « Bulletin de versement » — colonne secondaire, sous `RecapitulatifTVA`

Résumé texte, jamais d'image QR (`DI-2`) :

```
┌ Bulletin de versement ───────────────────────────────┐
│ Payable à       Garage Martin SA · Rue de l'Avenir 4  │
│ Référence       21 00000 00003 13947 14300 09017      │
│ Montant         CHF 302.90                            │
│ Langue          Allemand                    ⓘ         │  ← DI-6, si ≠ langue de l'utilisateur connecté
└────────────────────────────────────────────────────────┘
```

**Cas A — `qr` est `null`.** Trois sous-cas, trois rendus différents, jamais un message d'erreur
générique :

| Sous-cas | Rendu |
|---|---|
| Type `devis`/`bon_commande`/`avoir` | Carte **absente** — pas d'état vide affiché, ces documents n'ont structurellement pas de section paiement (l'avoir crédite, il ne se paie pas). |
| Facture en `brouillon` | Carte **absente** — le bulletin n'existe qu'à l'émission, cohérent avec l'absence du bouton « Imprimer » en brouillon. |
| Facture émise, rôle sans droit aux montants (`RF-116`) | Carte **absente**, action « Imprimer » absente du menu (§5.1) — pas de version dégradée de la carte qui laisserait deviner un montant. |
| Facture émise, devise ni CHF ni EUR (`RF-58`) | Carte **absente**, mais « Imprimer » **reste proposée** : le PDF existe, sa section paiement affiche les coordonnées bancaires en clair au lieu d'un QR — cas géré au niveau du gabarit PDF (`DI-1`), pas de l'écran. |

**Cas B — `debiteur` est `null` sur un `qr` présent** (`RF-59`, adresse client incomplète à
l'émission — cas mesuré sur la facture de démonstration `2026-00002`). La carte s'affiche
normalement (créancier, référence, montant, langue sont indépendants du débiteur), avec une ligne
supplémentaire neutre-informative : « Bulletin émis sans destinataire pré-rempli — le payeur complète
l'adresse à la main. » **Jamais un ton d'alerte** : un bulletin sans débiteur est valide, c'est le cas
normal prévu par la norme.

Différence de formulation à trancher explicitement avec l'écran actuel : la Card « Destinataire »
existante affiche aujourd'hui, avant **et** après émission, le même texte `champs.adresseIncompleteEmission`
(« le bulletin **sera** émis sans destinataire pré-rempli »). Une fois la facture `emis`, ce texte au
futur est trompeur — il laisse croire que compléter la fiche maintenant corrigera **ce** bulletin, alors
que le payload est figé (`MD-77`, `DI-3`). Sur une facture déjà émise, le message doit passer au passé
(« a été émis sans destinataire pré-rempli ») et le lien « Compléter la fiche » doit rester utile
uniquement pour les **prochains** documents de ce client, pas pour celui-ci — à clarifier dans le
libellé i18n au moment de l'implémentation.

**Cas C — le payload ne se recompose jamais.** Rien à afficher spécifiquement pour ce cas — c'est une
garantie d'implémentation (`DI-3`), pas un état d'écran. Il se traduit uniquement par l'absence de tout
mécanisme de rafraîchissement automatique du PDF stocké (§3).

### 5.3 États

- **Chargement du PDF** (premier clic) : le bouton « Imprimer / télécharger le PDF » passe en état de
  chargement, reste cliquable une seule fois (pas de double génération concurrente pour le même
  document — à protéger côté serveur par idempotence sur `documentId`, pas seulement côté écran).
- **Erreur de génération** : bandeau d'erreur au point d'appel (menu ou carte), `Réessayer` — la
  facture elle-même reste consultable, une erreur de PDF n'est jamais une erreur de la fiche entière.

---

## 6. `DI-6` — Multilingue : la langue du client, jamais celle de l'utilisateur connecté

Le contrat porte déjà les deux champs nécessaires, figés à l'émission :
`ReponseDocumentVente.figees.clientLangue` (langue du document entier) et
`ReponseDocumentVente.qr.qrLangue` (langue de la seule section paiement, `MD-77` : « la langue de la
section paiement, celle du client au moment de l'émission — `P-23` »). Vérifié dans
`apps/api/src/facturation/documents/service-emission.ts:169` : `qrLangue: doc.langueFigee` — c'est
déjà la langue figée du document qui alimente le bulletin, pas une valeur indépendante à
resynchroniser. Sur la facture de démonstration `2026-00002`, `qrLangue = 'de'`.

**Décision : le PDF se génère dans `figees.clientLangue`, jamais dans la langue de l'utilisateur qui
clique sur « Imprimer ».** Un réceptionnaire francophone qui imprime la facture d'un client
germanophone doit obtenir un document en allemand — c'est le client qui le lit, pas lui.

**Conséquence d'architecture, pas seulement d'écran** : le gabarit PDF (`DI-1`) tourne côté serveur,
hors de tout rendu React — il ne peut donc **pas** réutiliser `react-i18next` ni les fichiers de
`apps/web/src/i18n/locales/*`, qui n'existent que pour l'application web et tournent dans le navigateur
avec la langue de **session**. Il faut un jeu de libellés fixes (« Facture », « Total TTC », « Payable
par », etc. — un gabarit d'une page a un vocabulaire fermé, une trentaine d'entrées au plus) en fr/de/it
(le même triplet que `LANGUES` dans `packages/shared/src/contrats/enums.ts`, pas de quatrième langue :
DFA n'a pas d'anglais). **Ce jeu de libellés doit vivre une seule fois** — cohérent avec la règle du
projet « aucune chaîne en dur » — dans `@dfa/shared` (déjà le point de partage entre API et web) plutôt
que dupliqué à la main côté API, pour qu'une correction de libellé ne se fasse pas deux fois avec le
risque de diverger.

**Sur l'écran** : si `figees.clientLangue` diffère de la langue d'interface de l'utilisateur connecté,
la carte « Bulletin de versement » (§5.2) porte l'indicateur `ⓘ` déjà anticipé par le précédent
`reception:langue` (« Langue du document : {langue} », `apps/web/src/i18n/locales/fr/reception.json`,
clé existante mais non encore câblée à un écran) — même formulation, même idée : prévenir que le
document produit ne sera pas dans la langue que l'utilisateur voit à l'écran, avant qu'il ne s'en
étonne après impression.

---

## 7. Composants et endpoints à ajouter

| Élément | Rôle | Propriétaire |
|---|---|---|
| `GET /documents-vente/{id}/pdf` (esquissé ici, contrat complet à formaliser) | Retourne le PDF — génère au premier appel, sert le cache ensuite (`DI-3`). Doit refuser (pas seulement masquer) l'accès à un rôle sans droit aux montants (§5.1). | `expert-api` pour le contrat OpenAPI définitif, `expert-nestjs` pour l'implémentation |
| Générateur PDF facture + bulletin QR | Gabarit en unités physiques, lit `figees`, `lignes`, `ventilationTva`, `qr` — n'en recompose aucun (`DI-3`). Bibliothèque à choisir (§9). | `expert-nestjs`/`expert-facturation` |
| Libellés fixes du gabarit PDF (fr/de/it) | Vocabulaire fermé du document imprimé, dans `@dfa/shared` (§6). | `expert-i18n` |
| Carte « Bulletin de versement » (§5.2) | Nouveau composant, résumé texte uniquement. | `expert-react` |
| Item menu « Imprimer / télécharger le PDF » (§5.1) | Ajout au `DropdownMenu` existant de `EcranFicheFacture.tsx`, gating par droit et par `estAnnuleeParAvoir` corrigé. | `expert-react` |
| Indicateur `ⓘ` langue du document (§6) | Réutilise/câble la clé `reception:langue` existante. | `expert-react` |

---

## 8. Hors périmètre, volontairement

- **Aucun aperçu PDF intégré à l'écran en V1** (§1) — le bouton télécharge/imprime directement.
  Un aperçu (par exemple via `pdf.js` embarqué) est une amélioration ultérieure indépendante, pas
  une condition pour livrer l'impression.
- **`bulletin_paiement`** (relance, solde partiel, créance reprise — `MD-82`/`MD-83`) : table et besoin
  déjà documentés dans `docs/modele-documentaire-facturation.md` §5.4, mais **rien n'existe encore**
  dans `apps/api/src/db/schema` sous ce nom autre que l'énumération de motif — c'est un document
  distinct de la facture, avec son propre `qr_payload`, hors périmètre de ce document qui couvre
  l'impression de la facture **au moment de son émission**.
- **Devis, bon de commande, avoir** : la même mécanique PDF (`DI-1`) s'étend naturellement à ces types
  (leur `qr` est structurellement `null`, donc pas de section paiement) — mais leur écran, leur bouton
  et leurs libellés ne sont pas conçus ici. Le gabarit PDF gagnera à être pensé pour cette extension dès
  sa conception, sans que ce document ne la spécifie.
- **Envoi par courriel** : mentionné dans le menu `⋯` d'origine (§4.6 de `design-etape-2-facturation.md`)
  mais sans endpoint ni décision produit — question posée à @laupernoe (§10), pas tranchée ici.

---

## 9. À vérifier avant implémentation

- **Toutes les dimensions physiques du bulletin** (§4) contre la spécification officielle SIX (« Swiss
  Implementation Guidelines QR-bill », `paymentstandards.ch`) — taille et zone de repos du symbole QR,
  taille/présence de la croix suisse, dimensions et position du récépissé et de la section paiement sur
  la page A4, polices et corps imposés. **Aucune de ces mesures n'est vérifiée dans ce dépôt à ce jour.**
- **Le choix de bibliothèque de génération PDF** (§1) : évaluer une bibliothèque déjà spécialisée
  QR-bill suisse (licence compatible, maintenue, dimensions traçables à la spec officielle) avant
  d'envisager de coder le gabarit à la main depuis une bibliothèque PDF générique.
- **Le temps de génération réel** du PDF une fois la bibliothèque choisie, pour confirmer que la
  génération synchrone au clic (`DI-3`) reste acceptable sans file de job asynchrone.
- **L'application effective de la règle `RF-116`** sur le nouvel endpoint PDF (§5.1) — à confirmer par
  `reviewer-securite` une fois l'endpoint écrit : un rôle sans droit aux montants ne doit obtenir ni le
  bouton, ni une réponse 200 en appelant l'endpoint directement.
- **La formulation exacte des libellés i18n** du cas B (§5.2) — le passage du futur (« sera émis ») au
  passé (« a été émis ») sur une facture déjà `emis`, à vérifier avec `expert-i18n` pour les trois
  langues, pas seulement le français.

## 10. Ce qui appartient à @laupernoe

- **Impriment-ils vraiment, ou envoient-ils par courriel ?** La réponse change tout : si le pilote
  envoie systématiquement par courriel plutôt que d'imprimer sur papier, le PDF reste l'artefact, mais
  la pression sur les tolérances physiques du bulletin papier (§4) devient moins immédiate au jour un —
  sans changer qu'il faudra les respecter avant le premier envoi postal. Vaut la peine d'être demandé
  aux dix garages déjà accompagnés plutôt que supposé.
- **Comment Auto-i et Nextlane impriment-ils leur bulletin aujourd'hui ?** @laupernoe a un accès direct à ces
  systèmes chez ses clients. Un bulletin déjà produit et accepté par les banques suisses, examiné
  physiquement (dimensions à la règle, pas à l'œil), serait une validation empirique bien plus rapide
  que la lecture de la spec officielle — à condition de vérifier qu'il s'agit bien de la version
  actuelle du standard (l'adresse combinée `K` a été supprimée le 21.11.2025, `MD-77` point 2 — un
  bulletin imprimé par un concurrent avant cette date pourrait être obsolète).
- **`RF-62`** (déjà signalé comme non tranché dans `docs/specification-etape-2-facturation.md`) :
  quand le client paie cash et immédiatement au comptoir, que lui remet le garagiste exactement — une
  facture sans section paiement, ou toujours le même gabarit avec bulletin, payée ou non ? Ce document
  suppose qu'« Imprimer » produit toujours le même PDF (avec bulletin si `qr` existe) ; si la réponse
  terrain est différente, la carte §5.2 et le gabarit PDF ont besoin d'une variante « soldée ».
- **L'envoi par courriel** (§8) : geste attendu au comptoir, ou uniquement l'impression papier ? Détermine
  si le prochain document de conception après celui-ci est un écran d'envoi ou reste sans objet.

---

## 11. Implémentation backend — bibliothèque, invariant de vérification, état de livraison (expert-facturation)

> Auteur : expert-facturation. Répond à `DI-4` §« voie 2 » (adopter une bibliothèque QR-bill suisse
> déjà maintenue plutôt que redériver les cotes à la main) et à `§9`/`§7` de la section précédente
> (choix de bibliothèque, endpoint, RF-116). N'écrase rien de ce qui précède — l'ajoute. Code :
> `apps/api/src/facturation/impression/`.

### 11.1 Bibliothèque retenue : `swissqrbill`

Évaluation mesurée en exécution (Node portable, décodage indépendant PyMuPDF + OpenCV, artefacts
conservés hors dépôt) : trois alternatives écartées sur preuve (deux antérieures au retrait de
l'adresse combinée de type `K`, 21.11.2025 — voir `MD-77` point 2 cité en tête de §4 ; la troisième a
une licence non standard et une dépendance native `canvas`, rejetée pour la même raison que `DI-1`
rejette un navigateur headless : dépendance lourde pour un besoin de mise en page fixe).
`swissqrbill` (npm, MIT, v4.4.0) est le seul candidat sérieux : aucun binaire natif, dépendance
directe unique (`svg-engine`), `pdfkit` en peer dependency, rendu correct (croix suisse, débiteur
absent traité comme case vide, QRR/SCOR/sans référence, CHF/EUR, libellés FR/DE/IT idiomatiques).
Cela répond à `DI-4` §« voie 2 » : la mise en page physique (positions du bulletin, cotes SIX) est
déléguée à cette bibliothèque plutôt que rederivée à la main — **`DI-4` reste néanmoins vraie sans
changement** : aucune cote millimétrique n'est vérifiée ici non plus (voir §11.6).

Versions **épinglées exactement** dans `apps/api/package.json` (`"swissqrbill": "4.4.0"`,
`"pdfkit": "0.19.1"`, pas de `^`) — délibéré : une divergence de version pourrait changer la
structure interne que `verification-payload-qr.ts` observe (voir §11.3), et la criticité financière
de ce chemin justifie de ne jamais la découvrir en production via une mise à jour silencieuse.

### 11.2 L'incompatibilité décisive, et comment `DI-3`/`MD-77` la traverse quand même

`swissqrbill` ne recompose jamais le payload à partir d'une chaîne déjà construite — il le reconstruit
TOUJOURS depuis des champs structurés (`Data`), et n'expose PUBLIQUEMENT aucune fonction acceptant un
payload tout fait. Sa fonction interne `generateQRData` (qui fait exactement ça) existe dans les
sources mais **n'est pas dans `exports`** du `package.json` — vérifié en exécution, pas supposé :
```
require('swissqrbill/lib/cjs/shared/qr-code.cjs')
→ ERR_PACKAGE_PATH_NOT_EXPORTED
```
Un deep-import est donc **impossible**, pas seulement déconseillé — Node le bloque lui-même. Router
autour (lire le fichier `.cjs` sur disque et l'`eval`) aurait été un contournement du même ordre que
lire un payload figé « à peu près » : explicitement exclu par la consigne du coordinateur.

**Solution retenue, sans deep-import et sans dépendance native de rendu** : `swissqrbill/svg` (sous-
chemin PUBLIC du package, listé dans `exports`) expose `SwissQRCode`, une classe dédiée UNIQUEMENT au
symbole QR (pas à la mise en page de la facture), qui appelle EN INTERNE le même
`renderQRCode`/`generateQRData` que la classe PDF `SwissQRBill` — même chemin de code pour les deux
rendus. Son SVG contient un `<rect>` par module QR sombre, en coordonnées mm **émises par la
bibliothèque elle-même** (on ne les invente pas, on les relit). Ces rects sont rastérisés en RGBA pur
JavaScript (aucun canvas, aucune dépendance native — arithmétique de remplissage de rectangles
connus), puis décodés par `jsQR` (npm, pur JS, zéro dépendance, décodeur indépendant de `swissqrbill`
— exactement ce qu'un scanner ou une application bancaire ferait). Le texte décodé est comparé au
`qrPayload` figé en base après la seule normalisation autorisée :
- `\r\n` → `\n` (le payload figé est joint par `\r\n` ; `generateQRData` de `swissqrbill` joint par
  `\n` seul — vérifié en exécution) ;
- retrait d'**une seule** ligne vide finale surnuméraire (`additionalInformation`, poussé par
  `swissqrbill` même `undefined`).

Rien d'autre n'est absorbé — une divergence sur autre chose (espace, casse, champ manquant) fait
échouer la comparaison. Code : `apps/api/src/facturation/impression/verification-payload-qr.ts`.
Preuve empirique initiale du pipeline (avant intégration au code de production) :
`.../scratchpad/qrbill-eval/verif_pipeline.cjs` — identique après normalisation sur le cas RF-59
(débiteur absent) de la facture 2026-00002.

**Le résultat n'est PAS une coïncidence de mapping vérifiée une fois** (c'était le constat de l'agent
d'évaluation précédent) — c'est un **invariant vérifié à chaque génération**, document par document,
avant que le PDF ne soit produit. `verifierEquivalencePayload()` lève `ErreurMetier('ERREUR_INTERNE')`
et **refuse de produire le PDF** si le décodage échoue ou si les payloads normalisés diffèrent —
jamais un bulletin joli dont le QR dirait autre chose que ce qui a été émis. `refus prouvé, pas
seulement écrit` : `verification-payload-qr.spec.ts` fabrique une divergence artificielle (montant
modifié après figeage, numéro erroné dans le message reconstruit) et prouve le rejet, en plus de
prouver l'équivalence sur cinq combinaisons réelles (QRR+QR-IBAN, SCOR+IBAN ordinaire, sans
référence, débiteur présent, débiteur absent, CHF, EUR) — construites avec le VRAI encodeur
d'émission (`facturation/qr/encodeur.ts`), pas une fixture écrite à la main.

### 11.3 Ce que l'implémentation a découvert, non anticipé dans les sections précédentes

- **`pdfkit` émet ses événements `data` de façon ASYNCHRONE**, pas synchrone après `.end()` — vérifié
  en exécution (0 octet lu juste après `.end()`, contenu complet seulement à l'événement `end`).
  `genererPdfFacture()` est donc `async`, résolue sur l'événement `end` du flux — pas un détail
  anodin : une première version synchrone aurait renvoyé un buffer vide.
- **`noUncheckedIndexedAccess` (tsconfig du dépôt) s'applique aux groupes capturants de regex** : tout
  accès à `match[n]` est typé `string | undefined`, même après un test de non-nullité du tableau de
  correspondance lui-même. Traité explicitement (`?? null`, contrôle avant usage), jamais par une
  assertion — signalé par le coordinateur en cours de route, corrigé dans `verification-payload-qr.ts`
  et `formatage-suisse.ts`.
- **`CreationDate`/`ModDate` du PDF sont fixées à `document.emisLe`** (figé, immuable), pas à
  l'horodatage de génération : élimine une fenêtre de course bénigne entre deux premières requêtes
  concurrentes sur le même document (§11.4) en rendant la génération déterministe octet pour octet.

### 11.4 Cycle de vie et stockage (`DI-3` appliqué)

`ServiceImpressionFacture.obtenirPdf()` : lit `document.pdfCle` ; si posé, relit le fichier stocké et
vérifie son empreinte SHA-256 contre `document.pdfSha256` (refuse si elles divergent — corruption de
stockage détectée plutôt que servie) ; sinon, génère (§11.2-11.3), écrit le fichier, pose
`pdfCle`/`pdfSha256` en base via `UPDATE ... WHERE pdf_cle IS NULL` (la génération étant
déterministe, une course bénigne entre deux premières requêtes ne produit jamais deux contenus
différents — seule la première écriture gagne la colonne).

**Stockage** : interface `StockagePdf` (`stockage-pdf.ts`), un seul adaptateur aujourd'hui —
`StockagePdfDisqueLocal`, disque local sous `apps/api/uploads/documents-pdf/<tenantId>/<documentId>.pdf`
(`uploads/` déjà dans le `.gitignore` racine). **Suffisant pour le développement et un premier pilote
mono-instance, pas une décision de production** : un adaptateur S3-compatible (Infomaniak/Exoscale,
cohérent avec `ARCHITECTURE.md`) devra le remplacer derrière la même interface avant un déploiement
multi-instance — décision et implémentation `expert-devops`, hors du périmètre de cette tâche.

### 11.5 `RF-116` : droit dédié — résolu

Le PDF contient le montant en clair (charge QR) — `@ExigerDroit(...)` doit gouverner la route, pas un
masquage d'affichage (repris de §5.1). `'facturation.document.imprimer'` (`auth/matrice-droits.ts`)
existe désormais, ajoutée par l'agent des droits, accordée EXACTEMENT aux rôles pour lesquels
`roleVoitLesMontants()` (`facturation/documents/mappeurs.ts`) est vrai — **direction, comptable,
vendeur, réceptionnaire, chef_atelier, magasinier** ; **PAS technicien, PAS admin** (`RF-115`,
`RF-116`).

**Correction d'une affirmation fausse d'une version précédente de cette section**, signalée par
l'agent des droits : ce n'était PAS « le même ensemble de rôles que `EMISSION_FACTURE` ».
`EMISSION_FACTURE` n'a que QUATRE rôles (direction, comptable, vendeur, réceptionnaire) — ni
`chef_atelier` ni `magasinier`. La règle réelle est `roleVoitLesMontants()` : `chef_atelier` et
`magasinier` VOIENT les montants d'une facture (lecture non masquée de `GET /documents-vente/{id}`)
sans avoir le droit de l'ÉMETTRE — consulter n'est pas engager, et imprimer est un geste de
consultation, pas d'engagement. `matrice-droits.spec.ts` (`apps/api/src/auth/`, hors périmètre)
vérifie cette égalité STRUCTURELLEMENT : il boucle sur les huit rôles et compare
`MATRICE_DROITS[role].includes('facturation.document.imprimer')` directement à
`roleVoitLesMontants(role)` — pas contre une liste recopiée, ni ici ni là-bas. Le droit d'imprimer
ne peut donc jamais dériver silencieusement du droit d'émettre.

**État de livraison** : le service (`ServiceImpressionFacture`, génération, cache, invariant
DI-3/MD-77) est complet, testé, et prouvé en exécution contre la base de développement (§11.7). Le
contrôleur HTTP (`GET /documents-vente/{id}/pdf`) a d'abord été écrit puis retiré (l'action
n'existait pas encore, un `as Action` sur le littéral ne compile pas par construction — voir
l'historique de cette section dans l'historique git) ; une fois l'action ajoutée par l'agent des
droits, il a été RÉINTÉGRÉ, `impression.module.ts` expose désormais `controllers:
[ImpressionFactureController]`, et `ImpressionModule` est importé dans `apps/api/src/app.module.ts`
(périmètre d'écriture étendu explicitement à ce fichier par le coordinateur pour cette seule
raison). La route existe réellement — voir §11.7 pour la preuve HTTP réelle (mapping de routes,
403 pour `technicien`, 200 pour `receptionnaire`).

Code du contrôleur (`impression-facture.controller.ts`, en place) :

```ts
import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { schemaIdentifiant } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import { ServiceImpressionFacture } from './service-impression-facture';

@ApiTags('Documents de vente')
@ApiCookieAuth()
@Controller({ path: 'documents-vente', version: '1' })
@UseGuards(GardeDroit)
export class ImpressionFactureController {
  constructor(
    private readonly service: ServiceImpressionFacture,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':id/pdf')
  @ExigerDroit('facturation.document.imprimer')
  @ApiOperation({
    summary: 'Bulletin QR-facture au format PDF (facture émise uniquement).',
    description:
      "Génération paresseuse au premier appel, mise en cache (`document_vente.pdfCle`/`pdfSha256`), " +
      "JAMAIS régénérée ensuite — une facture émise est immuable, son PDF aussi (DI-3). " +
      "`RF-116` : la charge QR contient le montant en clair — droit dédié, distinct de `facturation.document.lire`.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Document introuvable pour ce tenant.')
  @ApiReponseProbleme(409, "DOCUMENT_PDF_INDISPONIBLE — le document n'est pas une facture émise.")
  async telechargerPdf(@Param('id', new PipeZod(schemaIdentifiant)) id: string, @Res() res: Response): Promise<void> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { buffer, sha256, nomFichier } = await this.service.obtenirPdf(ctx, principal, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomFichier}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('ETag', `"${sha256}"`);
    res.status(200).send(buffer);
  }
}
```

`ImpressionModule` importe `FacturationModule` (lecture seule, pour `ServiceDocumentsVente` exporté)
afin d'éviter un cycle de modules ; l'inverse (`FacturationModule` important `ImpressionModule`,
comme il le fait pour `PaiementsModule`/`ExportModule`) aurait créé ce cycle — c'est pour cette
raison que le câblage final se fait dans `AppModule`, pas dans `FacturationModule`.

Erreurs de codes réutilisées, aucune n'ajoutée au contrat gelé (`packages/shared/src/contrats/probleme.ts`,
hors périmètre) : `DOCUMENT_PDF_INDISPONIBLE` (409, déjà existant, déjà utilisé pour « pas de PDF pour
ce document ») pour un devis/bon de commande/avoir/brouillon ; `ERREUR_INTERNE` (500, déjà existant)
pour la divergence de payload et la corruption de cache — ces deux cas ne devraient JAMAIS se produire
en fonctionnement normal, un `500` est le bon signal (alerte, pas erreur utilisateur à corriger).

### 11.6 Ce qui reste hors de portée — non vérifié, et qui doit le rester tant que non fait

Reprend et confirme `DI-4`, sans l'affaiblir : **aucune cote millimétrique n'est vérifiée**, ni par
l'agent d'évaluation précédent ni par cette implémentation. Déléguer la géométrie à `swissqrbill`
(§11.1) est une décision cohérente avec `DI-4` §« voie 2 », **pas une vérification** — c'est la
bibliothèque qui porte la responsabilité du gabarit physique, DFA n'en a vérifié ni les cotes ni la
conformité SIX par une lecture manuelle de la spécification officielle.

**La seule vérification qui tranche est de faire scanner un bulletin de test par une vraie banque ou
une vraie application e-banking suisse.** Ce n'est pas une note de bas de page : c'est un
**prérequis avant mise en production du premier garage**, au même titre qu'une migration de données
réelle ou qu'un test de charge — aucune lecture de documentation, aucun décodage logiciel (même
indépendant, même répété) ne le remplace. Le décodage prouvé en §11.7 établit que **le contenu**
encodé est fidèle au payload figé ; il ne dit rien sur la **conformité physique** du bulletin (zone de
repos, taille de la croix suisse, dimensions du récépissé) qu'un scanner bancaire tolérant pourrait
accepter alors qu'un contrôle strict au guichet la refuserait.

### 11.7 Preuve — facture `2026-00002` (`dfa_dev`, débiteur absent — RF-59)

Exécutée contre la base de développement réelle (`ServiceAccesBase` connecté à `dfa_dev`,
`ServiceDocumentsVente`/`ServiceAuditImpl` réels — pas de mock), sans passer par la route HTTP
(§11.5, non câblée) :

- **Premier appel** : génère un PDF de 10 564 octets (`%PDF-1.3`), écrit sur disque
  (`apps/api/uploads/documents-pdf/11ed8af1-bcb7-486c-8643-8648380f0221/8cf6de58-d78a-46b1-8add-bf68fb8f371f.pdf`),
  pose `pdf_cle`/`pdf_sha256` en base — `pdf_sha256 = 02da2923d5e9694b117e0762f945a430b930b5a7f1097a8e497d270345bc8554`.
- **Second appel** : 13 ms (contre 317 ms au premier), relit le cache, buffer octet pour octet
  identique — `genererPdfFacture` n'est PAS rappelée (vérifié par instrumentation).
- **Décodage indépendant du PDF réellement produit**, avec un TROISIÈME outil (ni `swissqrbill`, ni
  `jsQR`) : rastérisation à 300 dpi via **PyMuPDF**, décodage via **`cv2.QRCodeDetector`** (OpenCV) —
  163 caractères décodés, identiques après normalisation autorisée au `qr_payload` figé en base
  (192 caractères, 30 séparateurs `\r\n`, aucune ligne vide finale surnuméraire côté figé — cohérent
  avec `31 × \r\n`-joints sans 32ᵉ élément vide, contre `31 × \n`-joints + 32ᵉ élément vide côté
  `swissqrbill`, exactement l'écart que la normalisation autorisée corrige).

Aucun fichier de preuve n'est resté dans le dépôt (script temporaire retiré après usage, conformément
au périmètre d'écriture de cette tâche) — le PDF produit est disponible pour relecture par @laupernoe à
`apps/api/uploads/documents-pdf/11ed8af1-bcb7-486c-8643-8648380f0221/8cf6de58-d78a-46b1-8add-bf68fb8f371f.pdf`
(chemin gitignoré, généré par la preuve ci-dessus — régénérable à l'identique par un nouvel appel à
`obtenirPdf`, la génération étant déterministe, §11.3).

### 11.8 Preuve HTTP réelle — le garde mord

Une fois l'action `'facturation.document.imprimer'` ajoutée (§11.5) et la route câblée, l'API
(`nest start --watch`, hot-reload) a repris la route à chaud — confirmé dans les logs réels :

```
[RoutesResolver] ImpressionFactureController {/api/documents-vente} (version: 1):
[RouterExplorer] Mapped {/api/documents-vente/:id/pdf, GET} (version: 1) route
[NestApplication] Nest application successfully started
```

Trois connexions réelles (`POST /api/v1/auth/connexion`, `Demo1234!Garage`) contre le seed
`garage-martin`, puis `GET /api/v1/documents-vente/8cf6de58-d78a-46b1-8add-bf68fb8f371f/pdf` :

| Rôle | Résultat mesuré |
|---|---|
| `technicien@garage-martin.ch` | **`403 DROIT_INSUFFISANT`** — ne voit pas les montants, n'obtient pas le PDF |
| `admin@garage-martin.ch` | **`403 DROIT_INSUFFISANT`** — `RF-115`, aucun droit financier |
| `receptionniste@garage-martin.ch` (rôle `receptionnaire`) | **`200`**, `Content-Type: application/pdf`, `Content-Length: 10564`, `ETag: "02da2923d5e9694b117e0762f945a430b930b5a7f1097a8e497d270345bc8554"` — exactement le PDF généré et mis en cache en §11.7 (même empreinte), servi cette fois par la vraie route HTTP, pas par un appel direct au service. |

C'est la vérification qui compte le plus : elle prouve qu'on ne peut pas télécharger, via l'endpoint
PDF, des montants qu'on n'a pas le droit de voir à l'écran — `@ExigerDroit('facturation.document.imprimer')`
mord réellement, ce n'est pas un masquage d'affichage contournable par un appel direct.

### 11.9 État de test et de compilation à la livraison

- `tsc --noEmit` : exit 0 sur l'ensemble du dépôt API.
- `eslint apps/api/src/facturation/impression apps/api/src/app.module.ts --max-warnings=0` : aucun
  problème.
- `common/droits/toutes-les-actions-couvertes.spec.ts` : **994/994 tests verts** — l'unique test
  rouge (action non couverte faute de route) est refermé par le décorateur `@ExigerDroit` de
  `ImpressionFactureController`, maintenant enregistré.
- `auth/matrice-droits.spec.ts` : 61 tests verts, dont le test structurel qui compare
  `MATRICE_DROITS[role].includes('facturation.document.imprimer')` à `roleVoitLesMontants(role)`
  rôle par rôle — garantit que le droit d'imprimer ne peut pas dériver silencieusement du droit
  d'émettre (§11.5).
- 43 tests unitaires verts dans `facturation/impression/` (`formatage-suisse`, `donnees-swissqrbill`,
  `verification-payload-qr` — invariant DI-3/MD-77 sur 5 combinaisons + 2 refus prouvés,
  `stockage-pdf`, `service-impression-facture` — gating, cache, corruption détectée).
- Suite complète de l'API : 994 tests verts sur 84 fichiers au moment de la livraison.
- Preuve HTTP réelle (§11.8) : garde-fou vérifié en exécution, pas seulement en test.
