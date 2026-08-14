# Conception métier — le rendez-vous d'atelier

Angle exclusif : le métier. Aucune table, aucun endpoint, aucun écran ici — deux autres
chantiers couvrent ces angles en parallèle sur la même branche `feat/rendez-vous-atelier`. Ce
document décrit ce que fait le personnel du garage, dans quel ordre, avec quelles contraintes
réelles, et fige le vocabulaire et les règles numérotées dont les deux autres agents ont besoin.

Déclencheur : un test d'utilisabilité a buté sur « la prise de rendez-vous viendra plus tard » —
alors que la prise de RDV est 80 % du travail du comptoir dans un garage. @laupernoe a tranché : on le
construit. Ce document sert de socle métier à cette construction.

## 1. Ce qui est déjà tranché dans le code — point de départ, pas terrain vierge

Le module atelier existant anticipe déjà le rendez-vous à plusieurs endroits. Ce document
construit SUR ces décisions, il ne les rouvre pas :

- `ordre_reparation.statut` est une machine à états **gelée**
  (`x-dfa-enum-extensible: false`) : `planifie → ouvert → en_cours → controle → termine →
facture → restitue → cloture`, plus `annule`. Un OR peut donc déjà naître **avant** l'arrivée
  du véhicule, à l'état `planifie` — c'est le point d'ancrage de toute cette conception.
- `parametreAtelier.etatPlanifieActif` (P-22) dit si un garage donné utilise cet état `planifie`
  du tout. Défaut : `false`. Un garage peut donc choisir de ne jamais faire exister l'OR avant
  que la voiture soit physiquement là.
- `parametreAtelier.orSansRdvAutorise` (P-21) : si `false`, créer un OR sans passer par un RDV
  déclenche une confirmation bloquante `OR_SANS_RDV` (rôle `chef_atelier` ou `direction` requis).
- `ordre_reparation.rendez_vous_id` existe déjà comme colonne nullable, **sans contrainte de clé
  étrangère** — le commentaire du schéma dit explicitement : _« sans FK, `rendez_vous` n'existe
  pas au lot 1 »_. La table `rendez_vous` est donc une table séparée de `ordre_reparation`,
  anticipée mais jamais créée. Ce document confirme et justifie ce choix (§5).
- Un catalogue `motif_rendez_vous` existe déjà (`tenant_id`, `code`, libellés FR/DE/IT,
  `duree_defaut_minutes`, `heures_atelier_defaut_centiemes`, `actif`) — le motif du RDV est donc
  déjà pensé comme une entrée de référentiel paramétrable par garage, porteuse d'une durée
  standard, PAS un champ texte libre.
- `ordre_reparation_demande` existe déjà, append-only (RM-52) : le verbatim de ce que le client a
  dit est conservé mot pour mot, distinct du motif structuré. Cette distinction (§2) n'est pas à
  inventer, elle existe déjà côté OR.
- `ordre_reparation.restitution_promise_le` et `restitution_initiale_le` existent déjà (RM-56),
  de même qu'un champ `motifReport` obligatoire dès que `restitutionPromiseLe` change (validation
  `400` sinon). Ce mécanisme répond directement à la question du testeur (§8).
- Le domaine `planning` des paramètres atelier est déjà **prévu dans le contrat**
  (`ReponseParametresAtelier.planning`) mais **inerte** (aucune colonne en base, `PATCH → 501`) :
  `noShowSeuilAlerte` (défaut 2), `tamponPretMinutes` (défaut 30), `rappel.canal` +
  `rappel.joursAvant`. Ces trois notions sont donc déjà nommées et attendues métier — ce document
  leur donne un sens d'usage (§4, §9).
- `poste_travail` (table par site : code, libellé) existe déjà — un pont, une baie, un poste de
  diagnostic. `parametre_site.capaciteHeuresJourCentiemes` existe déjà — la capacité d'un site,
  exprimée en heures/jour, pas en nombre de créneaux.

## 2. Vocabulaire — à utiliser tel quel, sans synonyme flottant

| Terme                        | Définition                                                                                                                                                     | Ce qu'il n'est PAS                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Rendez-vous (RDV)**        | Promesse d'un site à un client : « amenez le véhicule tel jour ». Existe **avant** que le véhicule soit là.                                                    | Pas un OR. Pas une réservation de pont ou de technicien nommé. |
| **Motif de rendez-vous**     | Entrée du catalogue `motif_rendez_vous` (« service », « pneus », « expertise »…) portant une durée standard. Choisi par le réceptionniste à la prise de RDV.   | Pas le texte que le client a dit — voir demande verbatim.      |
| **Demande verbatim**         | Ce que le client a dit, mot pour mot, jamais reformulé (« ça fait un bruit à l'avant droit »). Append-only.                                                    | Pas un diagnostic. Pas classé, pas structuré.                  |
| **Créneau**                  | Plage horaire précise (ex. 08h00–08h30) — réservée seulement quand le motif l'exige (§3).                                                                      | Pas le mode par défaut d'un garage.                            |
| **Capacité du jour**         | Volume d'heures atelier qu'un site peut absorber une journée donnée (`capaciteHeuresJourCentiemes`), consommé au fil des RDV confirmés et des OR ouverts.      | Pas un nombre de véhicules. Pas un nombre de créneaux.         |
| **Réception / réceptionner** | Action déjà existante (`POST /ordres-reparation/:id/receptionner`, T-03) : le véhicule arrive physiquement, kilométrage saisi, l'OR passe `planifie → ouvert`. | Pas la prise de RDV. Pas la confirmation téléphonique.         |
| **Restitution promise**      | Date/heure à laquelle le garage s'engage à rendre le véhicule — champ déjà existant sur l'OR, mutable, avec motif de report obligatoire.                       | Pas l'heure du RDV. Voir §8.                                   |
| **Restitution initiale**     | Première valeur de restitution promise, **jamais réécrite** — sert à mesurer la fiabilité des promesses dans la durée.                                         | Pas affichée au client — un indicateur interne.                |
| **No-show**                  | Le RDV arrive à son terme sans que le véhicule ne se présente et sans annulation préalable.                                                                    | Pas un retard. Pas une annulation.                             |
| **Report**                   | Le client (ou le garage) déplace la date/heure d'un RDV **avant** son échéance.                                                                                | Pas un no-show. Pas une nouvelle demande.                      |
| **Poste de travail**         | Ressource physique nommée d'un site (pont 3, baie carrosserie) — affectée par le chef d'atelier au jour le jour.                                               | Pas réservée à la prise de RDV (§3).                           |

## 3. Ce qu'on réserve réellement — RÈGLE STRUCTURANTE

**Décision : on réserve de la capacité de journée, jamais un créneau horaire, sauf si le motif
l'exige explicitement.**

Un garage suisse fonctionne très majoritairement en « déposez la voiture le matin, on vous
appelle » — pas en agenda façon dentiste. Forcer un créneau horaire pour un service ou une
vidange serait un mensonge d'interface : personne ne le tient, personne ne le lit. Le catalogue
`motif_rendez_vous` porte déjà les deux grandeurs qui permettent de trancher motif par motif,
sans code supplémentaire :

- **RV-01.** Si le motif porte `heuresAtelierDefautCentiemes` (et pas de
  `dureeDefautMinutes` précise), le RDV consomme de la capacité du jour — le client reçoit un
  jour, jamais une heure. C'est le cas par défaut : service, révision, petite réparation, pneus.
- **RV-02.** Si le motif porte `dureeDefautMinutes`, le RDV réserve un vrai créneau horaire. C'est
  le cas des motifs contraints par un tiers ou une logistique externe : expertise MFK (l'expert
  ou le mandataire a ses propres plages), essai routier programmé, remorquage/rendez-vous
  d'enlèvement, intervention avec sous-traitant.
- **RV-03.** Un rendez-vous ne réserve jamais un technicien nommé. L'affectation d'un technicien
  à une ligne d'OR est un acte d'atelier du jour (déjà porté par `ligne_or.technicien_id`), pas
  un engagement pris au comptoir des semaines à l'avance — un technicien malade la veille ne doit
  jamais annuler un rendez-vous.
- **RV-04.** Un rendez-vous ne réserve jamais un poste de travail nommé par défaut. Un garage peut
  paramétrer une exception motif par motif (ex. « carrosserie » exige la baie peinture, seule
  ressource contrainte du site) — c'est un paramétrage avancé, pas le comportement par défaut.
- **RV-05.** La compétence rare (diagnostic électronique d'une marque spécifique, habilitation
  climatisation) se traite comme une contrainte de MOTIF, pas de technicien : le motif porte
  l'exigence, le chef d'atelier choisit qui la couvre le jour venu.

## 4. Comment le réceptionniste sait qu'il peut dire oui — le cœur du sujet

Aujourd'hui, sans logiciel, la réponse tient en trois pratiques observées dans les garages
suisses, à remplacer une par une :

- **Le tableau blanc / planning papier au mur du bureau atelier** — visuel, collectif, mais
  personne d'autre que le chef d'atelier ne sait le lire correctement, et rien n'est calculable a
  posteriori (c'est exactement le trou qui a produit la contradiction relevée par le testeur).
- **Le carnet de RDV du comptoir** — fiable pour la liste, aveugle sur la charge réelle : il ne
  dit pas si le jour est plein.
- **L'intuition du chef d'atelier**, consultée par un cri à travers l'atelier ou un coup de fil —
  fonctionne, mais ne scale pas au-delà d'un site et disparaît le jour où il est absent.

Le mécanisme qui remplace les trois sans en inventer un quatrième, à partir de ce qui existe déjà
en base :

- **RV-06.** La capacité disponible d'un jour donné, pour un site donné, se calcule comme
  `parametreSite.capaciteHeuresJourCentiemes` moins la somme des charges déjà engagées ce jour :
  RDV confirmés (leur `heuresAtelierDefautCentiemes` de motif, ou la durée du créneau réservé) +
  OR déjà `planifie`/`ouvert`/`en_cours` dont le travail n'est pas terminé. Le réceptionniste voit
  un nombre (ou une jauge), jamais une grille d'heures à lire lui-même.
- **RV-07.** Le réceptionniste dit oui tant que la capacité restante du jour couvre le motif
  demandé ; au-delà, il voit un avertissement (jamais un blocage dur — un garage sait absorber un
  peu de dépassement, c'est une décision humaine, pas logicielle) et une proposition du jour
  ouvré suivant avec de la capacité.
- **RV-08.** `capaciteHeuresJourCentiemes` étant NULL par défaut (aucun plafond renseigné), un
  site qui n'a jamais paramétré sa capacité reste en mode « toujours oui, avertissement jamais
  affiché » — dégradation explicite, jamais un blocage silencieux d'un site non configuré.
- **RV-09.** Pour les motifs à créneau (RV-02), le réceptionniste ne propose que des plages non
  déjà occupées par un autre RDV à créneau du même site — collision de créneau refusée, jamais
  simplement avertie (contrairement à RV-07, ici deux véhicules au même expert MFK à la même
  minute est une impossibilité physique, pas une question de charge).

## 5. Le lien rendez-vous → OR — décision structurante, à deux modes paramétrés

**Le rendez-vous et l'ordre de réparation sont deux objets distincts.** Un RDV porte la promesse
d'ARRIVÉE (client, véhicule si connu, site, motif, jour ou créneau). L'OR porte tout le reste, y
compris la promesse de DÉPART (`restitutionPromiseLe`, déjà existante) et l'arrivée réelle
(`ouvertLe`, `kmEntree`). Fusionner les deux forcerait chaque garage dans le même choix — or ce
choix varie réellement d'un garage à l'autre, et le code l'anticipe déjà via P-22
(`etatPlanifieActif`).

**RV-10 — mode « OR anticipé » (`etatPlanifieActif = true`).** À la confirmation du RDV, l'OR est
créé immédiatement à l'état `planifie`, `rendezVousId` renseigné dès la création. Le chef
d'atelier voit sa charge de la semaine dans sa liste d'OR habituelle, sans écran séparé à
consulter. La réception du véhicule déclenche l'action déjà existante `receptionner` (T-03,
`planifie → ouvert`).

**RV-11 — mode « RDV seul » (`etatPlanifieActif = false`, défaut actuel).** Le RDV reste seul
jusqu'à l'arrivée physique du véhicule. Aucun OR fantôme n'encombre le tableau de l'atelier avant
que la voiture ne soit là. À l'arrivée, un OR est créé directement à l'état `ouvert` (jamais
`planifie`), `rendezVousId` renseigné pour tracer l'origine.

**RV-12.** Dans les deux modes, `rendezVousId` sur l'OR est ce qui permet de mesurer après coup :
le taux de no-show (RDV jamais transformé en OR), le retard réel à l'arrivée (heure de RDV
promise vs `ouvertLe` effectif), et de pré-remplir l'OR depuis le RDV (client, véhicule, motif →
demande verbatim initiale, durée standard → proposition de `restitutionPromiseLe` par défaut,
voir §8).

**RV-13.** Un OR créé sans RDV préalable (walk-in, RV-14) reste un OR valide à part entière —
`rendezVousId` reste NULL. Le paramètre `rdvRetroactifAuto`, déjà nommé en base, ouvre en option
la création automatique d'un RDV rétroactif marqué honoré à la volée, pour que les statistiques
de charge et de no-show restent lisibles même dans un garage qui accepte largement le sans-RDV —
signalé comme affinement, pas un prérequis du premier lot (§11).

## 6. Parcours pas à pas

### 6.1 Prise de RDV par téléphone — client déjà connu

1. Le réceptionniste identifie le client (recherche déjà existante par nom/plaque/téléphone).
2. Le véhicule concerné est choisi parmi ceux déjà rattachés au client — ou saisi si le client
   parle d'un véhicule non encore en base (achat récent, prêt d'un tiers).
3. Le motif est choisi dans le catalogue `motif_rendez_vous` (« pneus », « service »…) — ce choix
   fixe la nature de la réservation (jour ou créneau, RV-01/RV-02).
4. Le client énonce le problème dans ses mots — capturé verbatim, sans reformulation (même
   mécanisme que `ordre_reparation_demande`, RM-52).
5. Le réceptionniste propose un jour (ou une plage, selon le motif) sur la base de la capacité
   disponible (§4) — jamais une place qu'il devine.
6. Confirmation immédiate : **il n'existe pas d'état « en attente de confirmation »** — un RDV
   pris par téléphone est confirmé par construction, parce que c'est un humain du garage qui
   l'engage. Voir §7.
7. Si le garage a activé le rappel automatique (`planning.rappel.canal` +
   `planning.rappel.joursAvant`, déjà nommés), un rappel est programmé — hors périmètre RDV
   lui-même, simple consommateur du RDV confirmé.

### 6.2 Prise de RDV — nouveau client

Même parcours, avec création de la fiche client minimale AVANT confirmation du RDV — jamais un
RDV rattaché à un client fantôme « à identifier plus tard ». Un nom seul au téléphone n'est pas
un client exploitable pour la facturation à venir ; le réceptionniste demande au moins nom et
téléphone avant de confirmer.

### 6.3 Arrivée du véhicule — jour J, ça correspond

Le client se présente au jour promis. Le réceptionniste retrouve le RDV (liste du jour, déjà
filtrable par site), déclenche la réception : création de l'OR si mode RV-11, ou transition
`planifie → ouvert` (T-03, `receptionner`) si mode RV-10. Kilométrage saisi (obligatoire par
défaut, `kmEntreeObligatoire`). Le RDV passe à l'état `honore` (§7).

### 6.4 Arrivée du véhicule — sans RDV (walk-in)

Client sans rendez-vous. Si `orSansRdvAutorise = true` (défaut), l'OR se crée directement,
`rendezVousId` NULL. Si `false`, la création déclenche la confirmation bloquante `OR_SANS_RDV`
déjà nommée en base — un rôle `chef_atelier` ou `direction` doit trancher, jamais le comptoir
seul. **RV-14.** Un garage qui interdit le sans-RDV le fait pour piloter sa charge, pas pour
fermer la porte au client — la confirmation reste un « oui, mais sciemment », jamais un refus.

### 6.5 Expertise MFK — motif à créneau, délai réglementaire

Le motif « expertise » porte une `dureeDefautMinutes` (RV-02) : créneau réel, souvent contraint
par l'expert ou le mandataire externe. L'échéance légale du véhicule (déjà trackée,
`echeanceExpertise` / `sourceEcheanceExpertise` : `calculee` ou `convocation`) motive la prise de
RDV, souvent via une relance déjà existante (module relances) — le RDV lui-même n'est que la
concrétisation d'un appel réussi, pas un mécanisme de suivi d'échéance en soi.

### 6.6 Pic pneus (octobre–décembre)

Aucune mécanique différente : le calcul de capacité (§4) absorbe le pic comme n'importe quel
afflux — la capacité du jour se remplit plus vite, RV-07 propose plus systématiquement le jour
suivant. **RV-15.** Un garage qui veut réserver une part de sa capacité quotidienne aux seuls
motifs pneus en pleine saison (éviter qu'un service urgent ne mange toute la place) le fait par un
paramétrage de répartition par motif — signalé comme affinement du lot 3 (§11), pas un
prérequis pour débloquer le comptoir.

## 7. Machine à états du rendez-vous

Le rendez-vous a son propre cycle de vie, séparé de celui — gelé — de l'OR. Il ne s'y substitue
jamais, il le précède.

| État       | Entrée                                                                                    | Sortie possible                                                                                                                                   | Ce qui autorise la transition                    |
| ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `confirme` | Création (RV : toujours créé confirmé, §6.1 point 6)                                      | `honore`, `reporte`, `annule`, `no_show`                                                                                                          | — état initial unique, pas de brouillon          |
| `reporte`  | Le client ou le garage déplace la date/heure avant l'échéance                             | Reste `reporte` ou redevient effectivement `confirme` fonctionnellement (le champ date change, l'état logique de fond ne change pas — voir RV-16) | Date/heure future encore valide                  |
| `honore`   | Le véhicule arrive et un OR est créé/réceptionné en référence à ce RDV                    | — état terminal                                                                                                                                   | Création ou réception de l'OR lié                |
| `no_show`  | L'heure/le jour du RDV est dépassé, aucune arrivée, aucune annulation ni report préalable | — état terminal (peut donner lieu à un nouveau RDV, jamais à une réouverture)                                                                     | Job planifié ou constat manuel en fin de journée |
| `annule`   | Le client ou le garage annule avant l'échéance, motif obligatoire                         | — état terminal                                                                                                                                   | Action explicite, jamais silencieuse             |

**RV-16.** Un report n'est pas un changement d'état au sens machine — c'est une modification de
date sur un RDV qui reste `confirme`, journalisée (qui/quoi/quand/avant-après, comme toute entité
sensible du projet). Lui donner un état à part multiplierait les états sans ajouter de règle
métier nouvelle.

**RV-17.** Passage à `no_show` : jamais immédiat à la minute où l'heure promise expire — un délai
de grâce paramétrable (proposition : fin de journée du site, ou +2h pour un motif à créneau)
évite de marquer no-show un client qui a simplement 20 minutes de retard (§9).

**RV-18.** `honore` ne se déclare jamais manuellement — c'est un effet de bord de la création ou
réception de l'OR lié (RV-10/RV-11), jamais un bouton séparé « marquer honoré » qui pourrait
diverger de la réalité de l'atelier.

**RV-19.** Depuis `no_show` ou `annule`, aucune transition ne rouvre le même RDV — un client qui
revient prend un nouveau RDV. L'historique du raté reste visible sur la fiche client (matière au
compteur `noShowSeuilAlerte`, §9), jamais effacé.

## 8. Restitution promise et heure de RDV — deux notions distinctes, pas une vue de deux bouts

Réponse explicite à la question posée : **ce sont deux notions différentes**, qui encadrent l'OR
par les deux bouts, pas la même chose vue sous deux angles.

- **L'heure de RDV** (ou le jour promis, §3) répond à « QUAND le véhicule arrive ». Elle vit sur
  le rendez-vous, avant même que l'OR existe (mode RV-11) ou dès sa création à l'état `planifie`
  (mode RV-10).
- **La restitution promise** (`restitutionPromiseLe`, déjà en base) répond à « QUAND le véhicule
  repart ». Elle vit sur l'OR, s'affine au fil de la prise en charge — souvent inconnue au moment
  du RDV (le motif donne une durée standard, pas un engagement client), affinée à la réception, et
  peut légitimement bouger en cours de travaux (devis complémentaire accepté avec délai, pièce en
  retard, panne d'un pont).

**RV-20.** La restitution promise DOIT être renseignée au plus tard à la réception du véhicule
(transition `planifie/nouveau → ouvert`) — jamais laissée vide par défaut. C'est la cause directe
de la contradiction relevée par le testeur : le champ existe en base depuis le début, mais rien
n'obligeait à le remplir, donc les deux tableaux de bord (chef d'atelier, réceptionniste)
partaient de deux réalités différentes — l'un déduisant une sortie du jour par une autre voie
(charge estimée, intuition), l'autre lisant un champ resté vide.

**RV-21.** Les deux tableaux de bord (chef d'atelier, réceptionniste) DOIVENT lire exactement le
même champ (`restitutionPromiseLe`, filtre déjà défini côté contrat : `restitution_aujourdhui`,
RM-56) — jamais deux requêtes ou deux notions différentes de « ce qui sort aujourd'hui ». C'est la
règle qui empêche la contradiction de revenir : un seul champ, une seule vérité, deux vues dessus.

**RV-22.** Toute modification de `restitutionPromiseLe` après sa première valeur exige un motif de
report (`motifReport`, déjà validé côté contrat) — jamais un déplacement silencieux. La première
valeur reste conservée intacte dans `restitutionInitialeLe`, jamais réécrite, pour mesurer dans la
durée l'écart moyen entre promesse initiale et réalité (fiabilité du garage) — un indicateur
interne, jamais montré au client tel quel.

**RV-23.** Déplacer une restitution promise n'est jamais un acte isolé : si un véhicule de
remplacement est réservé pour le client suivant sur ce même véhicule ou ce même OR, le
déplacement doit avertir de la collision potentielle (mécanisme déjà nommé côté contrat,
`PRET_CASCADE_RESTITUTION`) — hors périmètre de ce document, mais le comptoir doit savoir que
reporter une sortie peut avoir un effet domino.

## 9. Cas tordus — les cas normaux d'un garage, pas des exceptions

- **RV-24 — No-show.** Le RDV passe `no_show` après le délai de grâce (RV-17). Le compteur de
  no-show du client s'incrémente (fiche client). Au-delà de `noShowSeuilAlerte` (défaut 2, déjà
  nommé en base) sur une fenêtre glissante à définir en paramétrage, un avertissement — jamais un
  blocage — s'affiche au réceptionniste lors d'une prochaine prise de RDV pour ce client, sur le
  même modèle que `CLIENT_BLOQUE` (RM-08) : information, décision humaine.
- **RV-25 — Retard à l'arrivée.** Un véhicule qui arrive après l'heure promise mais avant le
  délai de grâce (RV-17) suit le parcours normal (§6.3) — la réception saisit l'heure réelle
  (`ouvertLe`), l'écart avec l'heure promise du RDV reste calculable a posteriori (RV-12), jamais
  affiché comme un reproche à l'écran.
- **RV-26 — Débordement sur le lendemain.** Un OR `en_cours` non terminé en fin de journée
  occupe de la capacité le lendemain (RV-06 le compte comme charge engagée) — RV-07 en tient
  compte automatiquement pour refuser/avertir sur les nouveaux RDV du lendemain, sans intervention
  manuelle du réceptionniste.
- **RV-27 — Pièce en retard.** Le mécanisme d'attente existe déjà côté OR (drapeau
  `attente_pieces`, orthogonal au statut) — un RDV honoré dont l'OR part en attente pièces doit
  faire bouger `restitutionPromiseLe` avec motif (RV-22), jamais laisser une date promise devenir
  fausse silencieusement.
- **RV-28 — Véhicule vendu entre la prise de RDV et l'arrivée.** Le RDV référence un véhicule
  précis (§6.1 point 2). Si à l'arrivée le véhicule annoncé n'est plus celui présenté (vendu,
  remplacé, prêté), le réceptionniste modifie le véhicule de l'OR au moment de sa création — le
  RDV garde son véhicule d'origine dans son historique (jamais réécrit), l'OR porte la réalité du
  jour. Ce n'est pas un cas d'erreur, c'est un choix explicite au comptoir.
- **RV-29 — Devis complémentaire refusé à mi-travaux.** N'affecte pas le RDV (déjà honoré, état
  terminal) — affecte uniquement l'OR et sa restitution promise (RV-22), hors périmètre de ce
  document.
- **RV-30 — Deux RDV/OR sur le même véhicule.** Le paramètre `deuxOrMemeVehicule` (P-29, défaut
  `avertir`) s'applique déjà à la création d'OR — un RDV qui mènerait à un deuxième OR ouvert sur
  un véhicule déjà en atelier suit la même politique, jamais un blocage dur par défaut.
- **RV-31 — Multi-site (Martigny/Sion).** Un rendez-vous appartient à UN site, comme l'OR
  aujourd'hui (`siteId` non nul). **Un client n'est jamais renvoyé automatiquement vers l'autre
  site** — si Martigny est plein, le réceptionniste propose explicitement Sion et crée un
  deuxième RDV, rattaché à Sion, avec sa propre capacité (RV-06) calculée indépendamment. Aucune
  notion de RDV « partagé entre sites ».
- **RV-32 — Client entreprise, plusieurs conducteurs.** Le RDV est pris pour le VÉHICULE, pas
  pour le conducteur qui l'amène — la fiche « conducteur présent » existe déjà côté OR
  (`conducteurPresentNom`) et se saisit à la réception, jamais à la prise de RDV où le nom du
  conducteur du jour n'est souvent pas encore connu.

## 10. Vocabulaire exact à l'écran (FR — source des traductions DE/IT)

| À utiliser                       | À ne jamais utiliser                                             |
| -------------------------------- | ---------------------------------------------------------------- |
| Rendez-vous, RDV                 | Réservation, booking, slot                                       |
| Prendre un rendez-vous           | Créer un événement, ajouter au calendrier                        |
| Motif du rendez-vous             | Catégorie, tag                                                   |
| Créneau (uniquement pour RV-02)  | Horaire (ambigu avec les horaires d'ouverture du site)           |
| Capacité du jour / de la journée | Charge, occupation (trop technique côté atelier)                 |
| Client absent / non présenté     | No-show (jargon anglais à bannir à l'écran, réservé au code/API) |
| Restitution promise              | Date de fin, date de livraison (confond avec la vente VN/VO)     |
| Report                           | Déplacement, reprogrammation                                     |
| Réceptionner le véhicule         | Check-in, enregistrement                                         |

## 11. Priorisation — ce qui débloque le comptoir en premier

Le risque nommé dans la commande : un module complet livré d'un bloc arrive trop tard, une
version minimale qui ne sert à rien est pire. La ligne se trace sur une question simple : **est-ce
que ça remplace le tableau blanc et le carnet, ou est-ce un raffinement que le comptoir peut
attendre sans souffrir ?**

**Lot RDV-1 — débloque le comptoir, rien de plus.**

- Prise de RDV téléphone/guichet : client (existant ou nouveau minimal), véhicule, motif (issu du
  catalogue déjà existant `motif_rendez_vous`), jour proposé selon la capacité (RV-06/RV-07, en
  mode dégradé RV-08 si le site n'a pas paramétré sa capacité).
- Lien vers l'OR dans les deux modes déjà prévus par le code (RV-10/RV-11), gouverné par
  `etatPlanifieActif` qui existe déjà — aucun nouveau paramètre à inventer pour ce lot.
- États `confirme → honore/annule/no_show` (§7), sans grâce fine ni compteur (RV-17/RV-24 en
  version simplifiée : seuil fixe, pas encore paramétrable).
- `restitutionPromiseLe` rendu obligatoire à la réception (RV-20) et les deux tableaux de bord
  unifiés sur ce champ (RV-21) — **c'est la correction qui règle la contradiction relevée par le
  testeur, elle doit sortir dans ce lot, pas plus tard.**
- Cas RV-28 (véhicule changé) et RV-31 (multi-site, pas de transfert auto) : comportements
  déjà couverts nativement par « le RDV référence un site et un véhicule, point » — aucun
  développement spécifique, juste ne pas les casser.

**Lot RDV-2 — fiabilise, sans quoi le lot 1 s'essouffle en usage réel.**

- Report explicite (RV-16) avec historique visible.
- Délai de grâce paramétrable avant `no_show` (RV-17) et compteur `noShowSeuilAlerte` exploité
  avec avertissement au comptoir (RV-24) — le paramètre existe déjà en base, seul le comportement
  manque.
- Rappel automatique avant RDV (`planning.rappel`, déjà nommé côté contrat) — SMS/email.
- Créneaux horaires réels pour les motifs qui l'exigent (RV-02, MFK en tête).

**Lot RDV-3 — affinements, jamais bloquants pour le comptoir.**

- Répartition de capacité par motif en période de pointe pneus (RV-15).
- RDV rétroactif automatique pour tout walk-in (`rdvRetroactifAuto`, RV-13).
- Réservation de poste de travail par motif (RV-04, exception paramétrable).
- Cascade automatique vers les réservations de véhicules de remplacement (RV-23) au-delà du
  simple avertissement.

**Ce qui reste explicitement hors de ce document** : la prise de RDV en libre-service par le
client lui-même (portail client, en ligne, sans passer par un membre du personnel) n'est traitée
nulle part ici — tout le raisonnement du §7 (RDV toujours créé confirmé, par un humain du garage)
suppose l'absence de ce canal. Si un portail client doit exister un jour, il rouvre §7 (un état
« en attente de confirmation interne » redeviendrait nécessaire) et mérite sa propre conception,
pas une extension silencieuse de celle-ci.
