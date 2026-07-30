# Spécification — Pointage (lot 2)

> Périmètre : le temps que passe un technicien sur un OR, une ligne d'OR, ou une activité indirecte.
> Ce document **consolide et prolonge** ce qui existe déjà, dispersé dans les livrables de l'étape 1 :
> RM-87 → RM-99 et §5.4 de [`specification-etape-1-atelier-clients.md`](specification-etape-1-atelier-clients.md),
> l'architecture hors ligne du §4.3 de [`plan-etape-1-frontend.md`](plan-etape-1-frontend.md), les écrans du
> §6 de [`design-etape-1-atelier.md`](design-etape-1-atelier.md), et le namespace i18n
> `apps/web/src/i18n/locales/{fr,de,it}/pointage.json`. Il **n'annule ni ne renumérote** rien de ce qui précède ;
> il comble les trous et tranche ce qui pouvait encore l'être sans le terrain.
>
> **Hors périmètre, explicitement** : la paie. DFA calcule des heures (présence, productif, indirect,
> rendement) et les met à disposition ; le décompte de salaire, les charges sociales, les IJM et les
> conventions collectives sont l'affaire de la fiduciaire, via export. Aucune règle ci-dessous ne doit
> dériver vers du calcul de paie.

## 0. Ce qui est déjà tranché — ne pas rouvrir

Une investigation préalable (voir la consigne de cette tâche) a établi, preuves à l'appui, que le module
pointage a déjà des points d'ancrage réels dans le dépôt bien qu'aucun code ne l'implémente :

- La transition `ligne_or.validee → en_cours` existe en base (`migrations/0003_prealables_etape1.sql:419`)
  mais **rien ne la déclenche** — c'est le pointage qui doit le faire (§4 ci-dessous).
- `JETON_LECTURE_POINTAGE` a une implémentation vide (`LecturePointageVide`) qui documente elle-même son
  remplacement au lot 2.
- La table `pointage` est déjà dans l'enum d'audit `entite_auditee`.
- Le namespace i18n `pointage.json` est **complet et à parité FR/DE/IT**, écrit en avance sur l'écran :
  identification par PIN, chronomètre, activités indirectes, anomalies, synchronisation. Ce document doit
  rester compatible avec les clés qui y sont déjà posées — je les cite au fil du texte plutôt que d'en
  inventer de nouvelles sans besoin.
- `service-ligne-or.ts:359` documente explicitement que `temps_reel_centiemes` « n'a nulle part où se poser
  en base au lot 1, module pointage absent » — et que le contrat expose ce champ à `null` en attendant.
- **Correction d'une prémisse de la consigne** : la matrice des droits (`apps/api/src/auth/matrice-droits.ts`)
  **ne contient aucune action `pointage.*` ni `atelier.pointage.*`** aujourd'hui. Son propre test le vérifie
  et l'affirme (`matrice-droits.spec.ts:141-145` : « hors périmètre du lot 1 (Δ4 : fusion client, RDV,
  pointage, facturation étape 2…) : aucune action de ces domaines n'existe »). Ce qui existe, ce n'est pas
  la matrice de droits codée, c'est la **matrice narrative** au §10 de la spécification étape 1
  (`specification-etape-1-atelier-clients.md:972-974`) : trois lignes seulement (démarrer/arrêter son
  pointage, corriger celui d'un autre, verrouiller une période). Le §10 de ce document construit le
  jeu d'actions complet à partir de cette base, dans la convention déjà utilisée (`atelier.<domaine>.<verbe>`).

## 1. RM-87 → RM-99 : rappel sans répétition

Ces treize règles sont déjà écrites et ne sont pas reproduites ici in extenso — se référer à
`specification-etape-1-atelier-clients.md:339-351`. Résumé d'une ligne chacune pour mémoire de travail :

| # | Résumé |
|---|---|
| RM-87 | Un pointage porte technicien + plage horaire + activité : ligne d'OR, OR sans ligne précise (**P**), ou activité indirecte. |
| RM-88 | Un seul pointage ouvert par technicien, sauf chevauchement autorisé (**P**, P-06). |
| RM-89 | Chevauchement interdit (défaut) → le nouveau pointage clôture automatiquement le précédent. |
| RM-90 | Chevauchement autorisé → répartition au prorata pour la productivité, brut consultable. |
| RM-91 | Clôture automatique à l'heure de fermeture (**P**, P-31), anomalie. |
| RM-92 | Pas de pointage sur un OR `terminé`/`facturé`/`restitué`/`clôturé`/`annulé`. |
| RM-93 | Pas de pointage sur une ligne `à valider`/`refusée`/`annulée`. |
| RM-94 | Correction = rôle habilité + motif obligatoire + valeur d'origine conservée + journalisée. |
| RM-95 | Période verrouillée → aucune modification, contre-passation uniquement. |
| RM-96 | Anomalie si durée > N heures (**P**, défaut 10 h) ou chevauchement de nuit. |
| RM-97 | Arrondi à l'affichage/calcul (**P**, P-19), brut conservé à la seconde. |
| RM-98 | Le pointage ne détermine jamais le temps facturé (sauf lignes « au temps réel »). |
| RM-99 | Indicateurs : présence, productivité, rendement, taux de retouche. |

Ces règles sont le socle. Ce qui suit les **prolonge** — nouveaux repères numérotés à partir de RM-113,
parce que le bloc RM-87 → RM-99 est déjà cité, tel quel, par au moins six documents (contrats API, plans
d'exécution, doc de design, i18n) : insérer au milieu casserait ces renvois sans qu'un grep ne le révèle
immédiatement. Prolonger est le choix le plus sûr.

## 2. Identification du technicien — le code PIN

**Ce que le PIN est** (déjà décidé ailleurs, `plan-etape-1-frontend.md:443` : « code PIN à 4 chiffres au
pavé tactile ») : un moyen de **désigner rapidement** quel technicien, parmi ceux affectés au site, est en
train d'agir sur une borne partagée, mains sales ou gantées, sans clavier.

**Ce que le PIN n'est pas, et ce que ça implique (établi — logique de sécurité, pas une préférence)** :

- **RM-113** — Un code PIN n'est **pas un facteur d'authentification du technicien**. C'est un facteur
  d'**attribution** : il répond à « qui a fait ce geste », pas à « qui a le droit de faire ce geste ».
  Le droit lui-même est porté par la **session de la borne** (un compte de service scopé au site, avec un
  rôle « poste atelier », lui authentifié normalement au sens de l'auth existante) — pas par le PIN. Un
  technicien qui tape le PIN d'un collègue n'obtient aucun privilège que la borne n'a pas déjà ; il fait
  seulement porter l'heure au mauvais nom. C'est un problème de **fiabilité de la donnée** (le pointage
  ment sur qui a travaillé), pas un problème d'**élévation de privilège** — et les deux appellent des
  réponses très différentes (le premier se corrige à froid, le second se bloque à chaud).
- **RM-114** — Parce que l'espace des PIN est volontairement petit (lisibilité, vitesse, mains sales), il
  **doit** être protégé par un ralentissement après échecs répétés (verrouillage temporaire du
  sélecteur, ou de l'identifiant tenté) — sans quoi n'importe qui devant la borne peut essayer les 10'000
  combinaisons en quelques minutes. Le nombre d'essais et la durée de blocage sont **des paramètres de
  sécurité, pas de ce document** : à trancher avec `expert-auth`, pas ici.
- **RM-115** — Le PIN identifie, il n'autorise pas les gestes sensibles. Toute action qui touche un
  document ou un engagement (signature, transition d'OR, réponse de devis) reste **hors du geste PIN**
  (cohérent avec `plan-etape-1-frontend.md:511-514`, liste de ce qui reste interdit hors ligne — même
  logique ici : le PIN couvre uniquement le pointage et le constat, jamais plus).

**Alternative à ne pas exclure** : plusieurs garages du parc de @laupernoe ont peut-être déjà un lecteur de badge
(RFID, déjà utilisé pour un contrôle d'accès ou une pointeuse RH existante). Le geste « badger » est plus
rapide et plus fiable qu'un PIN tapé — voir Q-A en fin de document.

## 3. Le cycle d'un pointage

### 3.1 Il n'y a que deux états, pas quatre

**RM-116 (clarifie RM-87 → RM-89, à ne pas manquer à l'implémentation)** — La consigne de cette tâche
demande « démarrage, pause, reprise, arrêt » comme si c'étaient quatre opérations distinctes. **Ce n'en
est pas quatre : ce n'en est structurellement que deux**, `démarrer` et `arrêter`, déjà présentes dans la
machine à états §5.4 (`en_cours → termine`). Il n'existe **pas** d'état « en pause » et il ne doit pas en
apparaître un au lot 2 :

- **Pause** = arrêter le pointage courant (ou le laisser se faire clôturer automatiquement par RM-89) et
  **démarrer un nouveau pointage sur l'activité indirecte `pause`** — la tuile existe déjà
  (`pointage.json:activites.pause`, `design-etape-1-atelier.md:418`).
- **Reprise** = arrêter le pointage `pause` et démarrer un nouveau pointage sur la ligne ou l'OR d'origine.

Un agent qui coderait un statut `PAUSE` ou un champ `enPause: boolean` introduirait un état que rien dans
la spécification ne prévoit, dupliquerait la logique de clôture automatique (RM-89) pour rien, et casserait
la propriété la plus utile du modèle actuel : **un pointage a toujours exactement un début, une fin
optionnelle, et une activité** — jamais un statut intermédiaire à faire évoluer. Toute discussion de
« pause/reprise » doit se traduire en **deux appels à l'API de pointage** (`fin` puis `debut`), pas en un
état nouveau.

### 3.2 Ce qui manque encore : le lien pointage → statut de la ligne et de l'OR

C'est le trou identifié dans la consigne (`0003_prealables_etape1.sql:419`, `service-ligne-or.ts:359`).
Deux règles nouvelles le comblent :

- **RM-117** — Démarrer un pointage sur une ligne au statut `validee` la fait passer à `en_cours`
  (transition déjà présente en base, §5.2 de la spec étape 1 : « `validee`→`en_cours` »). Si l'OR est
  encore `ouvert`, ce même geste déclenche **T-04** (`ouvert → en_cours`, déjà écrit :
  « au moins un pointage démarré »). Un seul geste technicien peut donc produire jusqu'à deux transitions
  d'état en cascade — c'est voulu, pas un effet de bord à éviter.
- **RM-118 [HYPOTHÈSE — à trancher avec `expert-ui`, pas par ce document]** — Le bouton `Terminer` de
  l'écran « en cours » (`design-etape-1-atelier.md:438`) **arrête le chronomètre**. Rien dans les documents
  existants ne dit qu'il **marque aussi la ligne `réalisée`** (`atelier.ligne.marquer_realisee`, action déjà
  codée et déjà droitée dans `matrice-droits.ts`, mais aujourd'hui inatteignable faute de trigger amont).
  Ce sont deux gestes de nature différente : arrêter le chrono est réversible et anodin (le technicien va
  déjeuner, un collègue le relaie) ; marquer une ligne réalisée engage la facturation et le contrôle
  qualité (I-10 : pas de passage en `contrôle` avec une ligne validée non réalisée). **Les confondre serait
  une régression silencieuse** : un technicien qui tape `Terminer` pour aller manger déclarerait sans le
  vouloir son travail fini. Recommandation de ce document, à confirmer : garder les deux gestes
  **séparés**, `Terminer` n'arrête que le temps ; `marquer réalisée` reste une action explicite
  (bouton distinct, ou question « ligne terminée ? » posée seulement quand le technicien change de ligne ou
  quitte l'écran atelier, jamais un `oui` par défaut).

### 3.3 Oubli de clôture, absence prolongée

- Couvert par **RM-91**, déjà écrite : clôture automatique à l'heure de fermeture du site (P-31), marquage
  « clôture automatique », anomalie. Un technicien qui part en congé avec un pointage ouvert **n'a pas
  besoin d'une règle spéciale** : RM-91 le clôture le soir même. Le seul risque réel n'est pas métier mais
  d'exécution :
- **RM-119** — La clôture automatique de fin de journée doit être un mécanisme qui s'exécute **même si
  personne n'ouvre l'écran atelier ce jour-là ni les jours suivants** (job planifié par site/fuseau, pas un
  calcul paresseux déclenché seulement à la prochaine visite d'écran). Sans ça, un technicien en congé
  2 semaines avec un pointage resté ouvert continuerait d'accumuler des heures fantômes jusqu'au jour où
  quelqu'un rouvre l'écran — et l'anomalie daterait de sa détection, pas de l'heure de fermeture réelle.
  C'est une exigence d'implémentation (BullMQ ou équivalent), pas une nouvelle règle métier : je la note
  ici parce qu'elle a été manquée dans un projet comparable et que la conséquence (heures de présence
  fausses sur deux semaines) est le genre d'erreur qu'un garagiste remarque immédiatement et qui coûte la
  confiance dans l'outil entier.

## 4. Granularité : pointer la ligne ou l'OR — la question à ne pas trancher seul

**Établi (le modèle le permet déjà, structurellement)** : RM-87 prévoit les trois cas depuis le début —
ligne, OR sans ligne précise, activité indirecte — comme trois valeurs possibles du même événement, pas
comme trois modes de fonctionnement différents à choisir pour le tenant. Il n'y a donc **rien à développer
en plus** pour supporter les deux pratiques : la question porte sur ce que **l'écran propose par défaut**,
pas sur le modèle de données.

**Ce que le questionnaire garage a déjà préparé** : `questionnaire-garages.md:194-224` (S3) pose exactement
la question qui tranche — « sur une voiture avec trois travaux, savez-vous combien de temps a été passé sur
les freins seuls, ou seulement le temps total ? » — et documente cinq réponses plausibles (A, indépendant
qui ne pointe pas du tout ; B, badgeuse RH seule ; C, par voiture ; D, par opération, souvent garanti par
la marque ; E, saisie différée sur papier). Je ne retranche rien à cette analyse, je la relie au produit :

- **P-33 [nouveau, à valider avec le terrain, aucun défaut imposé ici]** — Niveau de pointage **proposé par
  défaut** à l'écran atelier : `ligne` ou `OR`. Si `OR`, l'écran saute directement à `en_cours` sans faire
  choisir de ligne (cas C du questionnaire) ; le technicien peut toujours viser une ligne précise via
  `Changer de ligne` si le besoin apparaît ponctuellement. Si `ligne`, l'écran impose le choix (cas D,
  garantie constructeur). Ce n'est **pas** un verrou : quel que soit le défaut, RM-87 autorise toujours les
  deux formes d'événement — P-33 ne fait que réduire le nombre de taps dans le cas dominant du garage.
- **RM-120** — Si aucune ligne n'est pointée sur tout l'OR (cas A et B du questionnaire), l'OR doit rester
  terminable et facturable : le pointage est **facultatif**, cohérent avec P-07 déjà écrit (« pointage
  obligatoire pour passer un OR à terminé », défaut : non obligatoire).

### 4.1 La question qui en découle : plusieurs lignes `en_cours` en même temps sur un même OR

**RM-121** — Rien dans §5.2 (machine à états de la ligne) ne limite le nombre de lignes `en_cours`
simultanées sur un même OR, et §6.8 de la spec étape 1 valide déjà explicitement le cas jumeau « deux
techniciens, un OR » (CT-39 : accepté, jamais une anomalie). Ce document **affirme** que le cas symétrique
— **deux techniciens, deux lignes différentes du même OR, en parallèle** (révision + plaquettes en même
temps par deux mécaniciens) — est le même cas et doit être traité pareil : autorisé, pas d'anomalie. Le
statut `en_cours` de l'**OR** est un état agrégé (au moins une ligne active), exactement comme `attente_*`
est déjà documenté comme dérivé et non saisi (note sous T-21, `specification-etape-1-atelier-clients.md:453-455`).
Il n'y a **pas** de verrou « un seul pointage actif par OR » à construire — ce serait une régression pour
tout garage au-dessus de 3-4 techniciens.

## 5. Activités indirectes et taux d'occupation productif

Déjà cadrées par RM-87 (liste : nettoyage, entretien atelier, formation, attente, magasin, retouche
interne, absence) et par le namespace i18n (`pointage.json:activites` — nettoyage, attentePieces,
attenteAccord, magasin, formation, pause, absence : sept tuiles déjà traduites en trois langues). Rien à
ajouter sur la liste elle-même ; deux précisions utiles pour l'implémentation :

- **RM-122** — Toute activité indirecte est du temps **payé et non facturable**. Ce n'est pas du temps
  hors pointage : un technicien en formation ou en attente de pièce doit être pointé comme tel, pas laissé
  sans pointage ouvert — sinon RM-99 (indicateur de présence) sous-compte silencieusement l'atelier.
- Les indicateurs de RM-99 (présence, productivité, rendement, taux de retouche) **sont** la mesure du
  taux d'occupation productif que regarde un chef d'atelier : productivité = heures productives / heures
  de présence. Rien de nouveau à définir ici, seulement le confirmer comme la métrique de référence — pas
  besoin d'un indicateur distinct nommé « taux d'occupation ».

## 6. Temps pointé contre temps facturé — qui fait foi pour quoi

**Déjà tranché par RM-98 et testé par CT-44** (ligne barémée 1,2 h, 2,4 h pointées → la facturation propose
1,2 h, l'écart alimente le rendement). Ce document précise la portée par destination, parce que la
question « lequel fait foi » n'a pas une seule réponse — elle dépend de ce qu'on en fait :

| Destination | Quelle valeur | Pourquoi |
|---|---|---|
| **Facturation** | Le temps **barémé ou forfaitaire** de la ligne, jamais le temps pointé — sauf ligne explicitement « au temps réel », où le temps pointé est **proposé** et reste modifiable par un rôle habilité (RM-98). | Un forfait constructeur facture ce qui est convenu, pas ce que le technicien a réellement mis — sans quoi un technicien lent facturerait plus cher le même travail. |
| **Rendement / indicateurs (RM-99)** | Le temps **pointé**, comparé au temps vendu. | C'est précisément l'écart qui a de la valeur pour le chef d'atelier : un rendement < 100 % pointe un problème de méthode, d'outillage ou de formation. |
| **Paie** *(hors périmètre produit)* | Le temps **pointé**, présence + productif + indirect. | DFA exporte la donnée ; le calcul du salaire (majorations, absences, CCT) appartient à la fiduciaire. **Aucune règle de ce document ne doit dicter comment ce temps devient un montant de salaire.** |

## 7. Anomalies

Le namespace i18n a déjà six motifs prêts (`pointage.json:anomalies.motifs`) : `dureeTrop` (RM-96, défaut
10 h — déjà décidé, pas inventé ici), `nuit` (RM-96), `chevauchement` (RM-88/90), `periodeVerrouillee`
(RM-95), `orFacture` (RM-92), `ligneNonPointable` (RM-93). Un trou identifié par la consigne de cette
tâche n'a pas encore de règle qui le couvre, alors que le motif `ligneNonPointable` semble déjà anticiper
le cas dans le namespace i18n — le texte de RM-93, lui, ne couvre que le **démarrage** :

- **RM-123** — Si une ligne passe à `annulee` ou `refusee` **pendant qu'un pointage est ouvert dessus**
  (le chef d'atelier annule la ligne en cours d'exécution, décision commerciale ou technique), le pointage
  ouvert **n'est pas interrompu de force** (le technicien continue physiquement, une interruption serveur
  ne l'arrête pas dans l'atelier) mais est **placé en anomalie** dès le prochain événement le concernant
  (fin, ou contrôle périodique), sous le motif `ligneNonPointable` déjà prévu dans le namespace i18n — pas
  un nouveau motif. Un rôle habilité tranche ensuite : réaffecter le temps à une autre ligne/l'OR global,
  ou le classer en improductif avec motif. **[À VALIDER — le traitement par défaut (réaffectation
  automatique proposée vs. correction manuelle obligatoire) n'est pas tranché ici, voir Questions pour
  @laupernoe.]**

Le seuil de chevauchement « anomalie si > N minutes » mentionné au §6.8 de la spec étape 1 n'a pas encore
de paramètre officiel :

- **P-34 [nouveau, aucun défaut proposé]** — Seuil de chevauchement toléré avant anomalie, en minutes,
  quand P-06 autorise le chevauchement. En dessous, un recouvrement de quelques minutes entre deux
  pointages (le temps de taper sur la tablette) est normal et ne doit pas noyer la corbeille d'anomalies
  sous du bruit ; au-dessus, il révèle une vraie pratique à comprendre ou une erreur de saisie.

## 8. Hors ligne — c'est réel, pas anticipé

**Constat, pas hypothèse** : l'architecture hors ligne est déjà entièrement spécifiée et justifiée par le
métier, pas par la technique pour la technique — voir `plan-etape-1-frontend.md:469-527` (§4.3, huit
points : journal IndexedDB append-only, écriture locale avant tout retour visuel, worker FIFO,
`Idempotency-Key`, `pointageId` généré côté client, dérive d'horloge, rien supprimé de la file avant un
2xx, conservation 7 jours) et `design-etape-1-atelier.md:395-478` (§6, écrans et rendu de la tolérance à la
latence). La justification métier tient en une phrase déjà écrite : « un pointage perdu est un litige de
paie » (`plan-etape-1-frontend.md:438`) — un atelier a un wifi qui tient mal contre des ponts élévateurs et
des outils électriques, les mains des techniciens ne sont pas toujours libres ou propres, et un
pointage qui disparaît parce que la tablette a perdu le réseau à 16h58 un vendredi est le genre d'incident
qui fait qu'un garagiste retourne au papier.

Rien à trancher ici : ce document **confirme** que la contrainte hors ligne est réelle et non
négociable pour l'écran de pointage lui-même, et rappelle la limite déjà posée et à ne pas franchir : **rien
qui touche un document ou un engagement (signature, transition d'OR, réponse de devis, kilométrage) ne
passe par cette file** (`plan-etape-1-frontend.md:511-514`) — seul le pointage et le constat le peuvent.

## 9. Droits — construire la matrice manquante

Comme noté au §0, `matrice-droits.ts` ne porte aujourd'hui aucune action de pointage. Voici le jeu
d'actions proposé, dans la convention déjà en usage (`atelier.<domaine>.<verbe>`, cf. `atelier.or.*`,
`atelier.ligne.*`, `atelier.devis.*`) et réconcilié avec la matrice narrative existante
(`specification-etape-1-atelier-clients.md:972-974`).

| Action proposée | Réceptionnaire | Chef d'atelier | Technicien | Magasinier | Comptable | Direction | Source |
|---|---|---|---|---|---|---|---|
| `atelier.pointage.demarrer` (le sien) | — | oui | oui | oui | non | oui | reprend la ligne 972 telle quelle |
| `atelier.pointage.arreter` (le sien) | — | oui | oui | oui | non | oui | idem |
| `atelier.pointage.lire` (le sien) | — | oui | oui | oui | non | oui | inféré, nécessaire pour afficher l'écran atelier au technicien lui-même |
| `atelier.pointage.lire_equipe` (tous les techniciens d'un site) | non | oui | non | non | non | oui | inféré du rôle de supervision déjà écrit ailleurs (« le chef d'atelier supervise et peut se substituer à tout instant ») |
| `atelier.pointage.corriger_autrui` | non | oui | non | non | non | oui | reprend la ligne 973 telle quelle |
| `atelier.pointage.corriger_soi_meme` | — | oui | **[OUVERT]** | **[OUVERT]** | non | oui | absent de la matrice narrative — voir Questions pour @laupernoe |
| `atelier.pointage.verrouiller_periode` | non | non | non | non | oui | oui | reprend la ligne 974 telle quelle |
| `atelier.pointage.deverrouiller_periode` (contre-passation, RM-95) | non | non | non | non | **[OUVERT]** | oui | RM-95 dit « contre-passation uniquement », ne dit pas qui |
| `atelier.pointage.lire_indicateurs` (RM-99) | **[OUVERT]** | oui | **[OUVERT — ses propres chiffres ?]** | non | **[OUVERT]** | oui | RM-99 définit les indicateurs, pas qui les consulte |

**Ce que la consigne de cette tâche demandait explicitement de trancher — je ne le tranche pas, je pose les
deux hypothèses avec leurs conséquences** : « un technicien peut-il corriger son propre pointage d'hier ? »

- **Option A (fermée)** — Seul le chef d'atelier (ou la direction) corrige, y compris pour le propre
  pointage d'un technicien sur lui-même : cohérent avec RM-94 tel qu'écrit (« rôle habilité »), qui ne
  nomme pas le technicien parmi les rôles habilités, et avec la logique de séparation des tâches (on ne se
  corrige pas soi-même sur une donnée qui nourrit sa propre paie). Coût : le chef d'atelier devient un
  goulot pour la moindre correction (« j'ai oublié d'arrêter hier soir »), qui est de très loin le cas
  d'anomalie le plus fréquent (§6.8 : « oubli de clôture… le plus fréquent, de loin »).
- **Option B (ouverte, avec garde-fou)** — Un technicien peut corriger **son propre** pointage, mais
  seulement **le jour même ou le lendemain** (fenêtre à définir) et seulement s'il n'appartient pas à une
  période verrouillée (RM-95 continue de s'appliquer sans changement) ; passé ce délai, seul le chef
  d'atelier corrige. Coût : il faut définir la fenêtre, et RM-94 (motif obligatoire, valeur d'origine
  conservée, journalisée) s'applique à l'identique — l'auto-correction n'est pas une auto-correction
  silencieuse.

## 10. Machine à états — reprise et compléments

La machine §5.4 de la spec étape 1 n'est pas modifiée :

```
  en_cours ──► termine ──► valide ──► verrouille (terminal)
      │            ▲          │
      │            └──────────┘  (correction par rôle habilité, motif obligatoire)
      └──► termine (clôture automatique : fin de journée ou nouveau pointage)
```

Compléments issus de ce document, sans toucher au diagramme :

- Il n'existe **pas** de troisième état « pause » (§3.1, RM-116) : une pause est deux transitions
  `en_cours → termine` puis `en_cours` (nouveau pointage), jamais un état intermédiaire.
- Une transition **externe** doit être ajoutée à la doc d'implémentation (pas ici, dans le contrat API) :
  `pointage.demarrer` déclenche, en cascade, `ligne_or.validee → en_cours` puis, si nécessaire,
  `ordre_reparation.ouvert → en_cours` (RM-117, T-04). C'est un effet de bord assumé du pointage sur deux
  autres machines à états, pas une nouvelle transition de la machine pointage elle-même.
- `pointage.en_cours → termine` **ne déclenche rien** sur la ligne (§3.2, RM-118) : `marquer_realisee`
  reste une action séparée, explicite.

## 11. Récapitulatif des nouveaux repères

Pour que personne ne les cherche dans le bloc RM-87 → RM-99 par erreur — tous introduits par **ce**
document, à la suite de RM-112 (dernier repère pris avant ce document) :

| Bloc | Repères | Sujet |
|---|---|---|
| RM | RM-113 → RM-115 | PIN : attribution ≠ authentification, ralentissement anti-brute-force, périmètre du geste PIN |
| RM | RM-116 | Pas d'état « pause » — deux transitions, pas un troisième état |
| RM | RM-117, RM-118 | Le déclencheur manquant ligne/OR ; `Terminer` ≠ `marquer réalisée` |
| RM | RM-119 | Clôture automatique : exigence de job planifié, pas de calcul paresseux |
| RM | RM-120, RM-121 | Pointage facultatif si aucune ligne n'est pointée ; plusieurs lignes `en_cours` simultanées autorisées |
| RM | RM-122 | Activité indirecte = temps payé non facturable, doit être pointé |
| RM | RM-123 | Ligne annulée/refusée pendant un pointage ouvert → anomalie `ligneNonPointable`, pas d'arrêt forcé |
| P | P-33 | Granularité proposée par défaut à l'écran (ligne / OR) |
| P | P-34 | Seuil de chevauchement toléré avant anomalie (minutes) |
| CT | CT-53 → CT-57 | Voir §12 |

## 12. Cas de test métier — nouveaux, en continuité de CT-52

Les cas de pointage déjà écrits (CT-34, CT-37 → CT-44, `specification-etape-1-atelier-clients.md:1037,1043-1050`)
restent valides tels quels et ne sont pas reproduits ici.

- **CT-53** — Ligne annulée sous un pointage ouvert. Contexte : technicien pointé sur une ligne `en_cours` ;
  le chef d'atelier annule la ligne (motif : pièce introuvable). Attendu : le pointage n'est pas interrompu
  côté tablette, il passe en anomalie `ligneNonPointable` au prochain événement le concernant. (RM-123)
- **CT-54** — Deux techniciens, deux lignes, un OR. Contexte : OR avec ligne A (révision) et ligne B
  (plaquettes), deux techniciens démarrent chacun un pointage sur sa ligne au même moment. Attendu :
  accepté, aucune anomalie, les deux lignes passent `en_cours`, l'OR affiche `en_cours`. (RM-121, CT-39
  étendu)
- **CT-55** — Déclenchement en cascade. Contexte : OR `ouvert`, ligne `validee`. Action : démarrer un
  pointage sur cette ligne. Attendu : la ligne passe `en_cours`, l'OR passe `en_cours` (T-04), dans la même
  opération. (RM-117)
- **CT-56** — Pause sans état dédié. Action : arrêter un pointage sur une ligne, démarrer un pointage sur
  l'activité `pause`. Attendu : le premier pointage est clôturé normalement (pas une clôture automatique
  RM-89, puisque l'arrêt est volontaire), le second démarre sur l'activité indirecte ; aucun champ
  « en pause » n'existe sur la ligne ni sur l'OR. (RM-116)
- **CT-57** — Absence prolongée. Contexte : pointage ouvert la veille d'un départ en congé de deux
  semaines, personne ne rouvre l'écran atelier du site pendant cette période. Attendu : le pointage est
  clôturé automatiquement **le soir même** du départ (heure de fermeture, P-31), pas à la date de
  détection ; il apparaît en anomalie dès ce soir-là, pas deux semaines plus tard. (RM-91, RM-119)

## 13. Questions pour @laupernoe

Formulées pour un garagiste, avec où aller vérifier — Auto-i et Nextlane sont directement accessibles.

1. **Granularité (P-33)** — *La question qui change l'architecture, pas un détail.* Sur les garages où tu
   interviens : est-ce qu'on pointe par ligne (« combien de temps sur les freins ») ou par voiture entière ?
   Où regarder : dans Auto-i, l'écran de pointage atelier propose-t-il un choix d'opération, ou seulement le
   numéro d'OR ? Dans Nextlane, pareil. Si la réponse diffère entre un garage indépendant de 3 personnes et
   une concession multimarque, les deux comportements doivent exister — la question est juste laquelle est
   le **défaut**.

2. **Hors ligne (architecture, pas juste ce document)** — *Deuxième question qui change l'architecture.*
   Le wifi d'atelier est-il aussi mauvais dans les garages que tu suis que ce que le plan suppose (perte
   de réseau fréquente sur les ponts, coins morts) ? Si la réalité est meilleure (fibre + wifi correct
   partout), la complexité de la file IndexedDB/FIFO peut être simplifiée en dégradant l'exigence, ce qui
   ferait gagner un temps de développement réel. Où regarder : demande directement aux garages si Auto-i
   ou Nextlane leur a déjà fait perdre du pointage pour une coupure réseau — c'est le genre d'anecdote
   qu'un chef d'atelier raconte sans qu'on ait besoin d'insister.

3. **Correction de son propre pointage (§9, option A/B)** — Un technicien qui a oublié d'arrêter la veille
   au soir : chez toi, qui corrige aujourd'hui ? Le technicien lui-même le lendemain matin, ou uniquement
   le chef d'atelier ? Où regarder : dans Auto-i/Nextlane, un compte technicien a-t-il seulement accès à
   ses propres pointages passés, ou l'écran est-il complètement fermé après clôture ?

4. **PIN ou badge** — Les garages où tu es déjà ont-ils un lecteur de badge (RFID) existant, pour un
   contrôle d'accès ou une pointeuse RH ? Si oui, ce serait plus rapide et plus fiable qu'un PIN tapé à
   quatre chiffres, et ça vaut la peine de l'intégrer plutôt que de faire taper un code. Où regarder :
   l'entrée de l'atelier ou le vestiaire — la plupart des pointeuses RH physiques ont déjà un badge.

5. **Ligne annulée pendant un pointage ouvert (RM-123)** — Quand ça arrive (rare mais réel : la pièce
   n'existe plus, le client a annulé entre-temps), qu'est-ce qui se passe aujourd'hui dans les garages que
   tu suis ? Le temps est-il réaffecté à une autre ligne à la main, ou juste noté comme improductif ? La
   réponse fixe le comportement par défaut de la correction proposée en RM-123.

6. **Visibilité des indicateurs (RM-99, §9 lire_indicateurs)** — Un technicien voit-il son propre taux de
   rendement dans les outils actuels, ou est-ce réservé au chef d'atelier / à la direction ? C'est autant
   une question de management que de droits techniques — certains garages en font un outil de motivation
   affiché, d'autres le gardent strictement confidentiel.
