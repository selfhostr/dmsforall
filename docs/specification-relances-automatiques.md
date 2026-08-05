# Spécification métier — Relances automatiques

Spécification métier, avant toute implémentation. Aucun code, aucune migration, aucun contrat
OpenAPI ici — juste les règles à figer avant que quiconque écrive une ligne.

## 0. En une phrase

Le DMS sait qu'un événement mérite un rappel (facture échue, devis sans réponse, pneus à
remonter, expertise qui approche…) et envoie, seul, le bon message au bon client, dans sa langue,
sur le bon canal — sans qu'un garagiste y pense, et sans jamais le faire deux fois.

## 1. Le cadre légal d'abord : deux familles, pas treize cas particuliers

Le module de consentements nLPD existe déjà (`apps/api/src/clients/`) avec exactement trois
types : `marketing_email`, `marketing_sms`, `marketing_appel`. Arbitrage non rouvert. La question
qui structure tout le reste : **une relance est-elle de la sollicitation commerciale, ou
l'exécution d'un contrat déjà engagé ?**

**Famille A — Exécution du contrat.** Le client a déjà engagé quelque chose : un devis demandé,
une facture due, une réparation en cours, un bien déposé (pneus). Base légale : exécution du
contrat / recouvrement (nLPD art. 31 al. 2 let. a), pas de la prospection. **Aucun consentement
marketing requis** — seule condition : une coordonnée valide sur le canal, et le client n'a pas
demandé l'arrêt de tout contact (RA-14).

**Famille B — Sollicitation commerciale.** Rien n'est ouvert : le garage prend l'initiative sur un
état du véhicule ou une échéance calendaire (saison, MFK). C'est exactement le scénario que le
consentement marketing couvre. **`marketing_sms`/`marketing_email` requis** selon le canal —
silencieusement absent du calcul si non accordé, jamais une erreur.

**Cas limite tranché — campagnes constructeur (`vehicule_campagne`).** Une campagne
`obligatoire = true` (rappel sécurité) est traitée comme la Famille A : ne pas notifier un défaut
de sécurité pour une question de consentement marketing est un risque plus grave pour le garage
que l'inverse. `obligatoire = false` (confort) reste Famille B.

## 2. Catalogue des rappels — la vraie valeur, pas le bruit

@laupernoe en évoque 13. J'en retiens **9** avec un ancrage réel en base et une valeur claire, j'en
**écarte 3**, j'en **reporte 1** faute de donnée exploitable. Le compte ne fait pas 13 parce que
certains "types" évoqués sont du bruit qui abîme la relation, pas des fonctionnalités qui
manquent.

### Retenus

| # | Rappel | Univers | Fam. | Ancrage en base | Valeur |
|---|---|---|---|---|---|
| 1 | Devis émis, sans réponse | Facturation | A | `document_vente` (`devis`, `envoye`) | Ferme des ventes qui dorment. |
| 2 | Facture échue, rappel puis sommation | Facturation | A | `relanceNiveau`/`relanceLe` (déjà en base, jamais alimenté auto) | Trésorerie — un manque comblé, pas une nouveauté. |
| 3 | Devis complémentaire en attente, mi-travaux | Atelier | A | OR ouvert, décision client due | Pont bloqué, urgence réelle. |
| 4 | Véhicule prêt, non restitué | Atelier | A | OR clôturé, véhicule sur site | Évite parking qui déborde + responsabilité. |
| 5 | Pneus en dépôt oubliés | Atelier | A | `depots-pneus` (liste manuelle `à-relancer` existe déjà) | Rendre un bien gardé, pas prospecter. |
| 6 | Travail reporté urgent/sécurité non repris | Atelier | A | `vehicule_travail_reporte` (`urgent`/`securite`, chiffré) | Ancré à un diagnostic déjà discuté. |
| 7 | Pneus saisonniers à remonter | Vente/service | B | Hangar pneus + saison | Cas en or : biannuel, universel, donnée déjà là. |
| 8 | Échéance MFK qui approche | Vente/service | B | `vehicule_expertise.prochaineEcheance` | Échéance légale connue, occasion de RDV. |
| 9 | Campagne constructeur sécurité (`obligatoire=true`) | Vente/service | A (§1) | `vehicule_campagne` | Sécurité + responsabilité garage. |

### Écartés

- **Anniversaire d'achat / fidélisation générique** : aucun besoin réel derrière, pur marketing
  calendaire — le genre de message qui fait dire "ils m'écrivent pour rien" à un client que le
  garagiste connaît personnellement.
- **"On ne vous a pas vu depuis N mois"** : aucun signal fiable (déménagement, revente, ou simple
  satisfaction). Lu comme de la surveillance commerciale. Écarté de l'automatique ; reste
  envisageable comme liste manuelle, même doctrine que `/depots-pneus/a-relancer`, jamais en envoi
  auto.
- **Rappel avant échéance de facture ("pensez à payer")** : pratique quasi inexistante dans les
  garages suisses sur des tickets courants, perçue comme intrusive sur une facture pas encore en
  retard. Si un garage le veut un jour, c'est un palier de plus dans #2, pas un type séparé.

### Reporté — donnée manquante

**Révision/entretien périodique dû** (date ou km) : probablement le rappel le plus rentable après
pneus et MFK, mais **aucun intervalle d'entretien n'est modélisé** aujourd'hui (ni par véhicule,
ni par modèle, ni dérivé de `vehicule_kilometrage`). Le spécifier maintenant reviendrait à
inventer un modèle de données. Hors lots ci-dessous ; chantier séparé, probablement lié au
référentiel constructeur de l'étape 5.

## 3. Règles métier

**Consentement et ciblage**

- **RA-01** — Famille A : jamais de consultation de `client_consentement`. Famille B : consulte le
  dernier consentement `accorde` pour le canal visé ; absent ou `false` → client hors calcul,
  silencieusement, sans trace d'échec.
- **RA-02** — Une révocation (nouvelle ligne `accorde=false`, RM-09) annule aussitôt tout rappel
  Famille B encore `a_planifier`/`prete` pour ce client/canal. Ne touche jamais la Famille A.
- **RA-14** — Un client peut demander l'arrêt de tout contact (litige, mandataire). Pas un
  consentement marketing : un interrupteur opérationnel au niveau du client, qui suspend TOUS les
  rappels, Famille A comprise — plus fort que RA-01/RA-02.

**Coordonnées, canal, langue**

- **RA-03** — Pas de coordonnée valide sur le canal ciblé → rappel jamais planifié, visible dans
  un tableau "non planifiable", jamais une erreur silencieuse ni bloquante.
- **RA-11** — Langue d'envoi = `client.langue` lue **au moment de l'envoi**, pas figée à la
  planification (contrairement à `langue_figee` en facturation : rien n'est contractuel ici, une
  correction de langue doit profiter à un rappel pas encore parti).

**Groupement et bruit**

- **RA-04** — Au plus **un message Famille B par client, par canal, par jour** : plusieurs types
  dus le même jour (pneus + MFK) → un seul message qui liste tout. Les rappels Famille A urgents
  (#3, #4) partent immédiatement hors digest, mais se fusionnent entre eux si même jour/client.
- **RA-10** — Le groupement se fait au niveau du **client**, pas du véhicule : trois véhicules dus
  le même jour → un message listant les trois, pas trois messages.

**Arrêt automatique — le rappel doit savoir se taire**

- **RA-08** — Le rappel facture (#2) s'arrête net dès `contentieux = true` ou
  `statutReglement = 'regle'` — un dossier en contentieux revient au mandataire, pas à la relance
  amiable automatique.
- **RA-09** — Le rappel devis (#1) s'arrête dès changement de statut du devis (accepté, refusé,
  annulé, transformé), vérifié **à l'exécution**, pas seulement à la planification (le client
  accepte dix minutes avant l'envoi programmé).
- **RA-07** — Un rappel Famille B déjà planifié (#7, #8, #9) est annulé si le véhicule change de
  détenteur avant l'envoi — ne pas relancer l'ancien propriétaire pour un véhicule qui n'est plus
  le sien.
- **RA-05** — Un même palier (type + objet + échéance) n'est jamais renvoyé automatiquement :
  contrainte d'unicité en base (§5), pas une simple vérification applicative. Un échec technique
  reprogramme le MÊME enregistrement, jamais une deuxième ligne.

**Client entreprise**

- **RA-13** — Le rappel facture suit le contact de facturation figé sur le document (le payeur),
  jamais le conducteur. Les rappels atelier/pneus/MFK ciblent aussi le payeur aujourd'hui :
  `vehicule.conducteur_habituel` est un champ texte libre, pas une fiche contact avec coordonnées
  propres — cibler un conducteur distinct n'est pas possible avec le modèle actuel. **Limite
  assumée**, pas un bug ; un vrai besoin de conducteurs multiples contactables (flotte
  d'entreprise) est un chantier de modélisation à part.

**Traçabilité**

- **RA-12** — Le contenu réellement envoyé (texte, destinataire, canal, langue) est figé dans la
  ligne d'envoi et jamais recalculé après coup — même doctrine que `client_designation_figee` en
  facturation. Un modèle de texte modifié demain ne change pas la preuve d'hier.

## 4. Préréglage recommandé, un clic

Chaque type a un délai par défaut proposé (devis : J+7 puis J+15 ; pneus : 3 semaines avant le
week-end de bascule saisonnière habituel du canton ; MFK : J-60 puis J-30). "Activer le
préréglage" copie ces valeurs comme point de départ modifiable dans la même table de
configuration (`regle_relance`, §5) — pas un mode magique séparé. Un garage qui n'y touche jamais
doit déjà avoir un comportement raisonnable.

## 5. Modèle de données minimal

Conventions du dépôt : UUID, `timestamptz`, `tenant_id NOT NULL` + RLS sur chaque table, enums
Postgres. Pas de montants ici — ce module ne facture rien.

- **`regle_relance`** (config par tenant) — `tenant_id`, `type_relance` (enum des 9 types),
  `actif bool`, `delais_jours integer[]` (paliers), `canaux` (sous-ensemble email/sms),
  `texte_modele_id`, `prereglage_applique_le timestamptz`.
- **`relance_planifiee`** (une ligne par occasion — source de vérité de l'idempotence) —
  `tenant_id`, `type_relance`, `objet_type` (`document_vente`/`ordre_reparation`/`vehicule`/
  `depot_pneu`/`vehicule_campagne`/`vehicule_travail_reporte`), `objet_id`, `palier smallint`,
  `client_id`, `echeance_prevue timestamptz`, `statut` (§8), `annule_raison` (nullable —
  `objet_traite`/`consentement_revoque`/`contact_absent`/`client_ne_plus_contacter`/
  `vehicule_cede`). **Contrainte unique `(tenant_id, type_relance, objet_id, palier)`** — c'est
  elle, pas la logique applicative, qui garantit qu'un palier ne se planifie jamais deux fois.
- **`relance_envoi`** (append-only, une ligne par tentative — même doctrine que
  `client_consentement`) — `tenant_id`, `relance_planifiee_id`, `tentative smallint`, `canal`,
  `destinataire_fige text`, `langue_figee`, `contenu_fige text`, `statut_envoi`
  (`envoye`/`echoue`), `fournisseur_message_id`, `erreur text`, `envoye_le timestamptz`.

Pas de table séparée pour RA-14 : une colonne `plus_aucun_contact bool` + `motif` sur `client`,
cohérente avec ce qui existe déjà (`langue`, `email`…).

## 6. Le point dur : idempotence, échec, et absence de travail de fond

Le dépôt n'a **aucun mécanisme de tâche planifiée** aujourd'hui : zéro usage de BullMQ vérifié
dans `apps/api/src`, malgré sa présence dans le choix de stack déclaré. Ce module en serait le
**premier usage réel** — une dépendance d'infra nouvelle (un worker en continu, pas seulement des
pods requête-réponse), à signaler à expert-devops avant le lot 1.

1. **L'idempotence ne repose jamais sur la file.** Une file redémarre, redistribue, exécute deux
   fois après un crash — nature "at least once". Seule garantie fiable : la **contrainte unique en
   base** sur `relance_planifiee` (§5). Le job de planification tourne deux fois sans dommage
   (`ON CONFLICT DO NOTHING`) ; le job d'envoi ne traite qu'une ligne dont il vient de gagner le
   passage `a_planifier → en_cours` par une mise à jour conditionnelle (`WHERE statut = 'prete'`),
   jamais par relecture optimiste côté application.
2. **Un échec n'est pas silencieux.** `relance_envoi` garde CHAQUE tentative. Le socle
   `connecteurs/` (résilience — délai, réessais, disjoncteur) existe déjà pour
   `PartsCatalogProvider` et consorts : à réutiliser ici, pas réinventer.
3. **Il manque une sixième interface de connecteur.** Les cinq interfaces figées
   (`PartsCatalogProvider`, `VehicleReferenceProvider`, `OrderProvider`, `ListingPublisher`,
   `AccountingExporter`) ne couvrent pas l'envoi SMS/e-mail. Il en faut une nouvelle
   (`NotificationSender`), même doctrine — port générique, aucun nom de fournisseur en dur,
   adaptateur factice pour les tests. Préalable au lot d'envoi.
4. **La preuve après coup, c'est `relance_envoi`** : pour n'importe quel client, à n'importe quel
   moment, répondre "qu'est-ce qu'on lui a envoyé, quand, et est-ce que ça a marché" sans
   reconstruction.

## 7. L'alerte "tu coupes un rappel qui rapporte" — mesurable, pas comme promis

Une mesure causale honnête ("ce rappel a généré CHF X") n'est **pas vérifiable** avec les moyens
du bord : pas de groupe témoin, biais de sélection évident (un client qui répond à un rappel
pneus est structurellement plus fidèle, rappel ou pas). Promettre un montant en francs serait
mentir avec des chiffres.

**Ce qui est honnêtement mesurable** : une corrélation observée sur l'historique du tenant —
"sur 12 mois, X% des rappels #7 ont été suivis, sous 30 jours, d'un passage atelier du même
véhicule". Un indicateur descriptif, pas une preuve de causalité.

**Décision** : construire l'alerte, avec ce vocabulaire assumé — "ce rappel précède une visite
dans N% des cas historiques", jamais "vous allez perdre CHF X". Historique trop court (tenant
récent, < 20 occurrences) → rien afficher plutôt qu'un pourcentage sur trois échantillons.

## 8. Machine à états — `relance_planifiee.statut`

```
a_planifier ──(coordonnée/consentement OK)──> prete ──(job d'envoi)──> en_cours_envoi
     │                                           │                          │
     │ (RA-07/08/09/14 : objet traité,           │ (RA-01/02/03/14)         ├──> envoyee
     │  consentement révoqué, véhicule cédé,      ▼                          │
     │  client "plus aucun contact")           annulee                      └──> echouee ──(retry)──> prete
     └────────────────────────────────────────────┘                                   │
                                                                           (retry épuisés)
                                                                                        ▼
                                                                              echouee (définitif)
```

`envoyee`, `annulee` et `echouee (définitif)` sont terminaux — jamais de retour en arrière ; une
correction se fait par une nouvelle occasion (nouveau palier), jamais par réédition d'une ligne
déjà tranchée (même doctrine que la chaîne documentaire facturation).

## 9. Cas de test métier

1. Facture avec deux rappels déjà envoyés, payée le jour du palier 3, et devis accepté par
   téléphone juste avant le job de planification → dans les deux cas, statut vérifié à
   l'exécution : rien ne part (RA-09).
2. Client avec deux véhicules dus le même jour (pneus + MFK) → un seul SMS listant les deux
   (RA-04 + RA-10).
3. Consentement `marketing_sms` révoqué la veille d'un envoi pneus programmé → ligne `annulee`
   avant l'envoi, aucune tentative dans `relance_envoi` (RA-02).
4. Client en contentieux → aucun rappel facture, même échéance dépassée (RA-08).
5. Véhicule cédé entre planification et échéance d'un rappel MFK → annulation automatique,
   raison `vehicule_cede` (RA-07).
6. Pneus en dépôt depuis 20 mois, client sans aucun consentement marketing → le rappel part quand
   même (Famille A, RA-01 ne s'applique pas).
7. Double exécution du job de planification (redémarrage worker) pour le même devis/palier, puis
   un envoi SMS qui échoue → une seule ligne planifiée au final (contrainte unique, §6.1), qui
   repasse en `prete` après l'échec tracé, jamais une deuxième ligne pour le même palier (RA-05).
8. Client demande "ne me contactez plus jamais" alors qu'une facture échue est due → plus aucun
   rappel, Famille A comprise (RA-14 prime sur tout).
9. Client entreprise, adresse de facturation différente du site du véhicule → le rappel facture
   utilise l'adresse figée du document, pas celle du véhicule (RA-13).
10. Campagne constructeur `obligatoire=true` sans aucun consentement marketing du client → le
    rappel part quand même (§1, cas limite tranché).

## 10. Découpage en lots

Un lot = un répertoire, un propriétaire.

**Lot 1 — Facturation (rappel #2).** Alimente enfin `relanceNiveau`/`relanceLe`. Pose
`regle_relance`/`relance_planifiee`/`relance_envoi` et le connecteur `NotificationSender` (§6.3)
— premier usage réel d'un worker planifié, donc le lot le plus cher en infra, dont tous les
suivants dépendent. Propriétaire : `apps/api/src/facturation/relances/` (nouveau) +
`apps/api/src/connecteurs/`.

**Lot 2 — Pneus saisonniers (#7).** Le cas en or, et le moins cher en donnée (hangar existant,
liste manuelle `à-relancer` à automatiser). Rien de nouveau côté infra une fois le lot 1 posé.
**Meilleur ratio valeur/effort, juste après le lot 1.**

**Lot 3 — MFK et campagne sécurité (#8, #9).** Même mécanique que le lot 2, sur
`vehicule_expertise`/`vehicule_campagne`. Livrable en parallèle du lot 2 — périmètres disjoints
(`pneus/` vs `vehicules/`).

**Lot 4 — Atelier (#1, #3, #4, #5, #6).** Le plus dépendant du temps réel de l'OR (un devis
complémentaire en attente est urgent, pas un digest du soir) — déclenchement quasi immédiat, pas
un batch quotidien comme 2/3. En dernier, une fois le mécanisme éprouvé sur des cas moins pressés.

**Hors lots** : révision périodique (§2, donnée manquante), conducteur d'entreprise distinct du
payeur (RA-13, modélisation à part), "on ne vous a pas vu" (§2, écarté).

**Ordre recommandé : Lot 1 → Lot 2 → Lot 3 → Lot 4.** Le lot 1 coûte le plus en infra mais rien
d'autre ne peut s'envoyer sans lui ; le lot 2 est celui où la valeur perçue par le garagiste sera
la plus immédiate et la plus incontestable.
