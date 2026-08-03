# Spécification métier — Étape 1 : Atelier + Clients

> Périmètre : clients, véhicules, rendez-vous, ordre de réparation (OR), pointage.
> Public : expert-database, expert-api, expert-tests.
> Statut : spécification métier de référence. Les points marqués **[À VALIDER]** doivent être
> confirmés avec un garagiste avant implémentation (voir §12).
> Convention : `RM-xx` = règle métier testable, `CT-xx` = cas de test métier,
> `P-xx` = point de paramétrage (varie d'un garage à l'autre, ne jamais coder en dur).

---

## Sommaire

1. [Périmètre et non-périmètre](#1-périmètre-et-non-périmètre)
2. [Acteurs, rôles et vocabulaire](#2-acteurs-rôles-et-vocabulaire)
3. [Le flux réel de bout en bout](#3-le-flux-réel-de-bout-en-bout)
4. [Règles métier (RM-01 → RM-112)](#4-règles-métier)
5. [Machines à états](#5-machines-à-états)
6. [Les cas tordus](#6-les-cas-tordus)
7. [Modèle de données métier](#7-modèle-de-données-métier)
8. [Contexte suisse](#8-contexte-suisse)
9. [Ce qui doit être paramétrable](#9-ce-qui-doit-être-paramétrable)
10. [Matrice rôle × action](#10-matrice-rôle--action)
11. [Cas de test métier](#11-cas-de-test-métier)
12. [Questions ouvertes à poser au garagiste](#12-questions-ouvertes-à-poser-au-garagiste)

---

## 1. Périmètre et non-périmètre

### Dans le périmètre de l'étape 1

| Domaine                  | Contenu                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Clients                  | Particuliers et entreprises, contacts multiples, adresses multiples, conditions commerciales, consentements, détection et fusion de doublons |
| Véhicules                | Identité (VIN, type CH), plaques historisées, détention historisée, kilométrage historisé, expertise, données techniques d'atelier           |
| Rendez-vous              | Planning atelier par site, capacité en heures, ressources (technicien, poste, véhicule de remplacement), rappels                             |
| OR                       | Document central : demandes client, lignes de travaux et de pièces, devis complémentaire, multi-payeurs, contrôle qualité, restitution       |
| Pointage                 | Temps réel par technicien, activités productives et indirectes, corrections, indicateurs                                                     |
| Véhicule de remplacement | Parc de courtoisie, contrat de prêt, disponibilité comme ressource de planning                                                               |

### Hors périmètre, mais dont l'étape 1 doit préparer les points d'accroche

- **Facturation (étape 2)** : l'OR produit une _proposition de facturation_ (lignes ventilées par payeur, TVA calculée, totaux). L'émission du document, la numérotation légale, la QR-facture et le verrouillage sont de l'étape 2. L'étape 1 doit donc modéliser `payeur` sur la ligne, les montants en centimes et l'état `facturé` de l'OR, mais **ne pas** implémenter le document facture.
- **Stock pièces (étape 3)** : en étape 1, une ligne de pièce est une ligne libre (référence texte + désignation + prix saisi). Pas de réservation, pas de mouvement de stock. Le modèle doit prévoir dès maintenant le champ « article » nullable pour un rattachement ultérieur sans migration destructive.
- **Ventes / stock véhicules (étape 4)** : un véhicule d'atelier et un véhicule en stock sont deux vues d'une même identité physique. L'étape 1 pose l'entité `Véhicule` avec son historique de détention ; l'étape 4 y greffe `VéhiculeStock`.
- **Dossier de garantie constructeur (étape 5)** : l'OR sait _marquer_ une ligne « garantie constructeur » avec code opération et code défaut, et produire un dossier imprimable. La transmission électronique au constructeur est un connecteur.
- **Dépôt de pneus (hôtel à pneus)** : très demandé en Suisse, touche véhicule + RDV + facturation récurrente. Recommandation : **le tenir hors étape 1** mais réserver la relation `Véhicule 1—n DépôtPneus` pour ne pas se bloquer (§12, Q-19).

---

## 2. Acteurs, rôles et vocabulaire

### 2.1 Acteurs

| Acteur                                  | Ce qu'il fait dans l'étape 1                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Réceptionnaire** (conseiller service) | Prend les RDV, réceptionne les véhicules, ouvre l'OR, gère les devis complémentaires, contrôle l'OR avant facturation, restitue |
| **Chef d'atelier**                      | Répartit la charge, affecte les techniciens, valide le contrôle qualité, corrige les pointages, arbitre les gestes commerciaux  |
| **Technicien**                          | Pointe, exécute, remonte des constats (travaux constatés), demande des pièces                                                   |
| **Magasinier**                          | Sort les pièces sur l'OR (étape 3 ; en étape 1 il saisit les lignes de pièces)                                                  |
| **Comptable**                           | Consulte, ne modifie pas l'atelier                                                                                              |
| **Direction**                           | Voit les indicateurs (charge, rendement, productivité, taux de retouche)                                                        |
| **Client**                              | Signe le mandat, accepte ou refuse un devis complémentaire, retire son véhicule                                                 |

> **Impact socle** : `ARCHITECTURE.md §3` liste les rôles _direction, vendeur, chef d'atelier, technicien,
> magasinier, comptable, admin_. Le rôle **réceptionnaire** manque et il est l'acteur central de l'étape 1.
> Dans les petits garages, une même personne cumule réceptionnaire + chef d'atelier + direction : les rôles
> doivent être **cumulables** sur un utilisateur, jamais exclusifs (voir §10).

### 2.2 Vocabulaire imposé (FR source ; DE/IT pour l'i18n)

| FR                       | DE                                   | IT                       | Sens                                            |
| ------------------------ | ------------------------------------ | ------------------------ | ----------------------------------------------- |
| Ordre de réparation (OR) | Reparaturauftrag (RA)                | Ordine di riparazione    | Document central atelier                        |
| Réception                | Annahme                              | Accettazione             | Prise en charge du véhicule                     |
| Expertise                | MFK (Motorfahrzeugkontrolle)         | Collaudo                 | Contrôle technique cantonal                     |
| Pré-expertise            | MFK-Vorkontrolle                     | Pre-collaudo             | Contrôle préalable au garage                    |
| Pointage                 | Zeiterfassung                        | Timbratura               | Saisie du temps technicien                      |
| Devis complémentaire     | Nachtragsofferte / Kostenvoranschlag | Preventivo supplementare | Accord client sur travaux constatés             |
| Montant plafond          | Kostendach                           | Tetto di spesa           | Limite d'engagement autorisée par le client     |
| Véhicule de remplacement | Ersatzfahrzeug                       | Veicolo sostitutivo      | Voiture de courtoisie                           |
| Travaux reportés         | Zurückgestellte Arbeiten             | Lavori rinviati          | Constatés, non exécutés, à représenter          |
| Retouche                 | Nacharbeit                           | Rilavorazione            | Reprise à la charge du garage                   |
| Temps barémé             | Richtzeit / AW                       | Tempario                 | Temps de référence facturé                      |
| Plaque                   | Kontrollschild                       | Targa                    | Immatriculation cantonale                       |
| Permis de circulation    | Fahrzeugausweis                      | Licenza di circolazione  | Carte grise CH                                  |
| Détenteur                | Halter                               | Detentore                | Celui au nom de qui le véhicule est immatriculé |

**Interdit dans l'UI** : « ticket », « workflow », « entité », « statut technique », « instance », « job ».

---

## 3. Le flux réel de bout en bout

### Étape A — Prise de rendez-vous

**Qui** : réceptionnaire (80 % au téléphone, 15 % au comptoir, 5 % en ligne ou par e-mail).
**Contexte réel** : l'appel dure 90 secondes, le réceptionnaire a un client devant lui en même temps. La saisie
doit être possible **dans n'importe quel ordre** et rester incomplète sans bloquer.

**Ce qui est saisi** :

1. Recherche du véhicule **par plaque** (usage n°1), à défaut par nom de client, par VIN, par téléphone.
2. Client (existant ou création rapide : nom + téléphone suffisent).
3. Motif(s) : service, expertise / pré-expertise, pneus, diagnostic (symptôme), carrosserie, rappel constructeur, retouche, devis.
4. **Verbatim du client**, mot pour mot (« ça claque à froid quand je tourne à gauche »). Ne jamais forcer le réceptionnaire à traduire en code technique à ce stade.
5. Date, heure, durée estimée / heures atelier estimées.
6. Mode d'attente : le client attend sur place / il dépose / il dépose la veille (boîte à clés) / navette / prise en charge.
7. Besoin d'un véhicule de remplacement → réservation d'un véhicule du parc.
8. Ressource pressentie : technicien et/ou poste de travail (selon organisation).

**Ce qui peut mal tourner** :

- Le véhicule est trouvé mais rattaché à un **autre client** (revendu). → §6.2.
- La plaque correspond à **deux véhicules** (plaques interchangeables). → §6.9.
- Le client est un **doublon** (« Dupont Jean » et « Dupont J. »). → RM-05, RM-06.
- Le créneau est libre mais l'atelier est **déjà saturé en heures** ce jour-là : le planning par créneau ment, c'est la charge en heures qui compte. → RM-33.
- Le véhicule a une **campagne de rappel ouverte** ou des **travaux reportés** du passage précédent : le système doit le dire **au moment de la prise de RDV**, c'est là que le chiffre d'affaires se fait. → RM-34, RM-35.
- L'expertise du véhicule arrive à échéance dans 3 mois → proposition de pré-expertise. → RM-28.

### Étape B — Réception du véhicule

**Qui** : réceptionnaire. **Quand** : entre 7h00 et 8h30, en rush, 6 clients à la file.

**Ce qui est saisi** :

1. **Kilométrage** relevé (jamais déclaratif si le véhicule est là).
2. Tour du véhicule : dégâts préexistants (schéma carrosserie + photos), présence de la roue de secours / kit, effets personnels, niveau de carburant.
3. Confirmation / reformulation des demandes ; ajout de ce que le client dit sur le pas de la porte (« et tant qu'à faire, regardez l'essuie-glace »).
4. **Montant plafond autorisé** (Kostendach) : le client autorise jusqu'à X CHF sans être rappelé.
5. Heure de restitution promise + numéro de téléphone **joignable dans la journée** (le fixe du domicile ne sert à rien).
6. Le client veut-il **récupérer les pièces remplacées** ? (question obligatoire dans certains garages).
7. Signature du mandat de réparation (tablette) : travaux demandés, plafond, CGV, essai routier autorisé, protection des données.
8. Remise du véhicule de remplacement : contrat de prêt, permis de conduire, km et carburant de départ, franchise.

**Ce qui peut mal tourner** :

- Pas de RDV (dépannage, urgence) → OR ouvert directement. RM-42.
- Le client vient avec **un autre véhicule** que celui du RDV. → §6.3.
- Dépôt la veille dans la boîte à clés : **pas de signature possible** à la réception, km relevé par le technicien. → §6.6.
- Le kilométrage relevé est **inférieur** au dernier connu. → RM-24, §6.10.
- Le client est une entreprise et le conducteur présent n'a **aucun pouvoir d'engagement** (pas de plafond, pas de signature valable). → §6.4.
- Le véhicule est en leasing : certains travaux nécessitent l'accord du leaser.

### Étape C — Diagnostic

**Qui** : technicien. Il prend l'OR (papier ou écran atelier), **pointe dessus**, constate.

**Sortie** : chaque constat devient une **ligne d'OR** avec une origine explicite :

- **Commandée** — demandée par le client à la réception ;
- **Constatée** — découverte par le technicien, nécessite un accord si elle dépasse le plafond ;
- **Campagne** — rappel constructeur, payée par le constructeur ;
- **Garantie** — couverte par une garantie (constructeur, garage, extension) ;
- **Retouche** — reprise interne, non facturable au client.

Le technicien qualifie chaque constat : **urgent / à faire / à surveiller**. Les « à surveiller » alimentent les
**travaux reportés** même sans passer par le client.

**Ce qui peut mal tourner** :

- Le symptôme n'est pas reproductible → ligne « recherche de panne » facturée au temps réel, avec l'accord du client. Le client conteste souvent une facture de diagnostic sans réparation : la trace de l'accord est vitale.
- Le diagnostic révèle que le véhicule est **dangereux** (freins, direction, pneus lisses) et le client refuse la réparation → §6.12.
- Le véhicule est déjà démonté quand le devis part.

### Étape D — Devis complémentaire

**Qui** : réceptionnaire (rarement le technicien).
**Déclencheur** : total des lignes à valider + lignes déjà validées **dépasse le montant plafond**, ou une ligne
constatée existe quel que soit le montant si le plafond est à 0.

**Ce qui est saisi** (et qui sauve en cas de litige) :

- Les lignes soumises, le montant TTC total et le nouveau plafond demandé ;
- Le canal (téléphone / SMS / e-mail / lien de signature) ;
- **Le nom de la personne qui a répondu** (« Mme Dupont, l'épouse »), la date et l'heure ;
- La décision : accepté / refusé / **partiel** (ligne par ligne) ;
- Le report éventuel de la restitution promise.

**Ce qui peut mal tourner** :

- Le client est injoignable : les travaux s'arrêtent, le pont est bloqué, le véhicule de remplacement tourne. → RM-58, RM-60.
- Refus après démontage → §6.1 (le cas le plus important de cette spécification).
- Accord verbal non tracé → litige perdu.
- Le client accepte, puis conteste à la restitution (« je n'ai jamais dit ça »).

### Étape E — Travaux

Pointage démarré, pièces sorties, exécution. Interruptions fréquentes : attente de pièces, attente d'accord,
sous-traitance (carrosserie, géométrie, boîte automatique, injection, tapisserie), essai routier.

**Ce qui peut mal tourner** :

- La pièce commandée n'est pas la bonne / arrive cassée → attente pièces prolongée.
- Le technicien **casse** une pièce non prévue → ligne à charge du garage (payeur = garage), traçable.
- Le véhicule part chez un sous-traitant → il n'est plus dans le garage, la localisation doit le dire.
- Le technicien qui a commencé est absent le lendemain → un autre reprend, deux pointages sur la même ligne.
- Les travaux dépassent l'estimation en temps : le temps barémé reste facturé, mais l'écart doit être visible (indicateur de rendement).

### Étape F — Contrôle qualité et essai

**Qui** : chef d'atelier (ou un technicien autre que l'exécutant).

- Check-list selon le type d'intervention (freins → essai de freinage obligatoire ; roues → couple de serrage et **contrôle à 50 km** ; vidange → niveau et absence de fuite après essai).
- Remise à zéro de l'indicateur d'entretien, autocollant prochain service, mise à jour du carnet (papier ou digital).
- Nettoyage / passage au lavage selon la politique du garage.
- Retour du véhicule à sa place, clés au tableau.

**Ce qui peut mal tourner** : le contrôle révèle un défaut → retour en travaux ; l'OR ne doit pas pouvoir passer
« terminé » avec une check-list incomplète si le garage l'exige (P-08).

### Étape G — Préparation de la facturation

**Qui** : réceptionnaire, puis validation chef d'atelier selon montant.

- Comparaison **temps pointé / temps barémé** ligne par ligne, arbitrage.
- Ventilation par payeur : client, constructeur (garantie/campagne), assurance (sinistre, avec franchise à charge du client), tiers (leaser, gestionnaire de flotte, contrat de service), garage (geste commercial, retouche).
- Application des conditions du client (rabais main-d'œuvre / pièces / pneus).
- Ajout des lignes de fin : produits d'atelier, élimination des déchets, taxes de recyclage.
- Contrôle des travaux reportés : ils doivent apparaître sur le document remis au client.

**Ce qui peut mal tourner** : un OR sans pointage (P-07) ; une ligne validée jamais réalisée mais facturée ;
un multi-payeur mal ventilé (le grand classique : la franchise d'assurance oubliée).

### Étape H — Restitution

- Explication de la facture (le moment le plus sensible de la relation client).
- Paiement (particuliers : souvent comptant/carte au retrait ; entreprises : facture 30 jours).
- Remise des clés, du véhicule de remplacement (km et carburant de retour, dégâts éventuels), des pièces remplacées si demandé.
- Remise du rapport de contrôle et des **travaux reportés** (support commercial du prochain RDV).
- Proposition du prochain RDV / rappel d'échéance d'expertise.

**Ce qui peut mal tourner** : le client ne vient pas (§6.5) ; le client refuse de payer (litige, droit de rétention) ;
il revient 3 jours plus tard avec le même symptôme (§6.11, retouche).

---

## 4. Règles métier

> Chaque règle est formulée pour devenir un test. Les règles marquées **(P)** dépendent d'un paramètre : le test
> doit alors couvrir les deux configurations.

### 4.1 Clients (RM-01 → RM-14)

- **RM-01** — Un client est de type `particulier` ou `entreprise`. Un particulier a nom + prénom obligatoires ; une entreprise a une raison sociale obligatoire. Le type est immuable après création (transformation = nouvelle fiche + fusion).
- **RM-02** — Tout client porte une **langue de correspondance** (fr/de/it, en optionnel). Elle détermine la langue de tous les documents qui lui sont remis, indépendamment de la langue d'interface de l'utilisateur.
- **RM-03** — Un client peut avoir plusieurs adresses typées : `principale` (une seule, obligatoire), `facturation` (0 ou 1), `livraison` (0..n). Si aucune adresse de facturation n'existe, l'adresse principale fait foi.
- **RM-04** — Un client entreprise peut avoir n contacts (nom, fonction, téléphone, e-mail, langue) avec des rôles cumulables : `conducteur`, `gestionnaire de flotte`, `signataire` (peut engager la dépense), `comptabilité` (destinataire des factures).
- **RM-05** — À la création d'un client, le système détecte les doublons probables sur (nom normalisé + NPA), (e-mail), (téléphone mobile normalisé E.164) et (n° IDE pour une entreprise). Il **avertit** sans bloquer : au comptoir, on ne bloque jamais le réceptionnaire.
- **RM-06** — Deux fiches client peuvent être **fusionnées** : véhicules, OR, RDV, documents et historique de la fiche absorbée sont rattachés à la fiche cible ; la fiche absorbée devient inactive et conserve un renvoi vers la cible. La fusion est journalisée et **irréversible par l'utilisateur** (annulation = intervention support).
- **RM-07** — Un client a des conditions commerciales : rabais % distincts par catégorie (main-d'œuvre, pièces, pneus), délai de paiement, mode de paiement par défaut, taux horaire spécifique éventuel. Ces conditions sont **datées** : un OR applique celles en vigueur à sa date d'ouverture et en **fige la valeur** sur la ligne.
- **RM-08** — Un client peut être `actif`, `inactif`, `bloqué` (impayés). Un client bloqué : la création d'un OR est possible mais déclenche un avertissement obligatoire nécessitant une confirmation par un rôle habilité (chef d'atelier ou direction).
- **RM-09** — Les consentements (marketing e-mail, SMS, appel) sont stockés avec date, canal de recueil et preuve. Aucun rappel commercial ne peut partir sans consentement actif. Les rappels **opérationnels** (RDV, véhicule prêt) ne sont pas du marketing et ne requièrent pas de consentement marketing.
- **RM-10** — Un client peut appartenir à un groupe (maison mère / filiales). Les conditions du groupe s'appliquent par défaut aux membres, surchargeables au niveau du membre.
- **RM-11** — Le numéro de client est unique par tenant, généré automatiquement, jamais réutilisé même après fusion.
- **RM-12** — Un client ne peut pas être supprimé s'il porte au moins un OR, un RDV ou une détention de véhicule : il est désactivé.
- **RM-13** — Les notes client sont de deux natures : `interne` (jamais imprimée) et `alerte` (affichée en rouge à l'ouverture de la fiche, au RDV et à la réception — ex. « paie toujours en retard », « exige d'être rappelé avant tout supplément »).
- **RM-14** — Un client entreprise peut exiger un **numéro de commande interne** (PO) obligatoire : si le paramètre est actif sur la fiche, aucun OR ne peut être clôturé pour ce client sans ce numéro renseigné.

### 4.2 Véhicules (RM-15 → RM-33)

- **RM-15** — L'identité d'un véhicule est le **VIN**, pas la plaque. Le VIN est unique par tenant. Il fait 17 caractères pour les véhicules postérieurs à 1981 ; les VIN plus courts (anciens, certains importés) sont acceptés avec un avertissement. Les caractères I, O, Q sont refusés sur un VIN à 17 caractères.
- **RM-16** — Un véhicule peut exister **sans VIN** (saisie d'urgence au comptoir) ; il est alors marqué « identification incomplète » et doit être complété avant l'ouverture d'un second OR **(P)**.
- **RM-17** — La **plaque est un attribut historisé** du véhicule (valeur, canton, du/au). Une même plaque peut successivement appartenir à plusieurs véhicules ; une recherche par plaque retourne le véhicule **courant** et signale les correspondances historiques.
- **RM-18** — Une plaque active ne peut pas être portée par deux véhicules simultanément, **sauf** si elle est marquée `interchangeable` (deux véhicules, une seule plaque, un seul en circulation à la fois) ou `professionnelle` (plaque U du garage).
- **RM-19** — Le format de plaque suisse est `XX` (2 lettres de canton) + 1 à 6 chiffres. Les plaques étrangères sont acceptées en saisie libre avec un code pays. Le canton est déduit du préfixe et modifiable.
- **RM-20** — La **détention** est historisée : (véhicule, client, du, au, motif de fin : vente, reprise, décès, correction). Il ne peut exister qu'un détenteur courant à un instant donné.
- **RM-21** — Changer le détenteur d'un véhicule **ne modifie ni ne réattribue les OR passés** : l'historique atelier reste rattaché au client de l'époque. Le nouveau détenteur voit un historique technique du véhicule, pas les montants ni les documents de l'ancien détenteur **(P — certains garages montrent tout, d'autres masquent les prix)**.
- **RM-22** — Distinguer **détenteur** (au nom de qui le véhicule est immatriculé, celui qui commande les travaux) et **propriétaire économique** (société de leasing). Les deux peuvent différer ; le payeur par défaut d'un OR est le détenteur.
- **RM-23** — Le **kilométrage est historisé** : (date, valeur, unité km/mi, source : réception, OR, expertise, vente, déclaratif client, import). La dernière valeur connue est affichée avec sa date et sa source.
- **RM-24** — Un kilométrage saisi **inférieur** au dernier connu est refusé par défaut ; il n'est acceptable qu'avec un motif explicite parmi : compteur remplacé, erreur de saisie antérieure, changement d'unité (mi→km), correction. Le motif et l'auteur sont journalisés.
- **RM-25** — Un kilométrage dont l'écart avec le précédent est aberrant (> 100 000 km depuis le dernier relevé, ou > 500 km/jour d'écart moyen) déclenche un avertissement non bloquant.
- **RM-26** — Le véhicule porte les données d'atelier utiles au comptoir : date de 1re mise en circulation, code type CH, dimensions et indices de pneus été/hiver, type et quantité d'huile, type de batterie, code radio, intervalle d'entretien (km et mois), plan d'entretien constructeur.
- **RM-27** — Un véhicule porte un indicateur **importé** (oui/non + pays d'origine + date d'importation). Cet indicateur est affiché à la prise de RDV et à la réception car il conditionne les droits de garantie et l'absence d'historique constructeur.
- **RM-28** — Le véhicule porte la date de la **dernière expertise** et la date de **prochaine expertise**. La prochaine expertise est soit calculée depuis les règles de périodicité (§8.1), soit **saisie depuis la convocation cantonale — qui prime toujours sur le calcul**. La source (calculée / convocation) est stockée.
- **RM-29** — Un véhicule dont l'expertise est échue ou échoit dans les N mois (**P**, défaut 3) est signalé à la prise de RDV, à la réception et dans une liste de relance.
- **RM-30** — Un véhicule peut porter des **campagnes constructeur** ouvertes (code campagne, description, obligatoire/optionnelle). Une campagne ouverte est signalée à la prise de RDV et proposée à l'ajout automatique à l'OR.
- **RM-31** — Un véhicule ne peut pas être supprimé s'il porte un OR : il est archivé (motif : détruit, exporté, vendu hors clientèle, doublon fusionné).
- **RM-32** — Deux véhicules peuvent être fusionnés (même VIN saisi deux fois avec une faute) selon les mêmes principes que RM-06.
- **RM-33** — Le véhicule porte une **garantie constructeur** (date de début = 1re mise en circulation ou date de livraison, durée en mois, plafond km) et éventuellement une garantie/extension vendue par le garage. À l'ouverture d'un OR, le système indique si le véhicule est **encore sous garantie** au regard de la date et du kilométrage relevé, sans décider à la place du réceptionnaire.

### 4.3 Rendez-vous (RM-34 → RM-48)

- **RM-34** — Un RDV appartient à un site, porte une date/heure de début, une durée, un motif principal et 0..n motifs secondaires.
- **RM-35** — Un RDV peut être créé avec un client identifié seulement par nom + téléphone, et sans véhicule identifié (« véhicule à confirmer »). Il ne peut pas être **honoré** (conversion en OR) tant que client et véhicule ne sont pas identifiés.
- **RM-36** — À la sélection d'un véhicule dans un RDV, le système affiche automatiquement : travaux reportés du ou des OR précédents, campagnes ouvertes, échéance d'expertise, garantie en cours, alertes client, dépôt de pneus éventuel.
- **RM-37** — Le RDV porte une **estimation d'heures atelier** (distincte de la durée d'immobilisation du véhicule : un véhicule peut rester 8 h au garage pour 1,5 h de travail).
- **RM-38** — La **capacité** d'un site est exprimée en heures productives par jour et par compétence **(P)**. Le planning affiche la charge (somme des heures estimées) contre la capacité et **avertit** en cas de dépassement sans bloquer (le surbooking est une pratique volontaire).
- **RM-39** — Une ressource (technicien, poste de travail, véhicule de remplacement) ne peut pas être réservée deux fois sur des plages qui se chevauchent, **sauf** forçage explicite par le chef d'atelier, journalisé.
- **RM-40** — Un véhicule de remplacement réservé sur un RDV est bloqué de la date de réception à la date de restitution promise, **plus** un délai tampon **(P)** pour la remise en état.
- **RM-41** — Le RDV enregistre son origine : téléphone, comptoir, e-mail, formulaire web, importé, rappel automatique. C'est un indicateur commercial.
- **RM-42** — Un OR peut être ouvert **sans RDV** (dépannage, sans-rendez-vous) **(P — certains garages l'interdisent)**. Dans ce cas, un RDV « rétroactif » peut être créé automatiquement pour que les statistiques de charge restent justes **(P)**.
- **RM-43** — Un RDV honoré est lié à exactement un OR. Un OR est lié à 0 ou 1 RDV.
- **RM-44** — Un RDV `absent` (no-show) est comptabilisé sur la fiche client. Au-delà de N absences **(P)**, un avertissement s'affiche à la prise de RDV suivante.
- **RM-45** — Un RDV `reporté` crée un nouveau RDV lié au précédent (chaîne de report visible), il n'est pas modifié en place : le déplacement subi par le client est une information de qualité de service.
- **RM-46** — Le rappel client (SMS/e-mail) est envoyé J-N **(P)** dans la langue du client, uniquement si un canal de contact valide existe. L'envoi et la réponse éventuelle sont journalisés sur le RDV.
- **RM-47** — Un RDV ne peut pas être annulé si son OR est ouvert : il faut d'abord traiter l'OR.
- **RM-48** — Un RDV ne peut pas être planifié sur un jour de fermeture du site ni hors des horaires d'ouverture atelier, sauf forçage journalisé (les dépôts la veille au soir existent).

### 4.4 Ordre de réparation — général (RM-49 → RM-62)

- **RM-49** — Un OR appartient à un site et porte un numéro unique par tenant, séquentiel, avec préfixe et remise à zéro annuelle **(P)**. Le numéro est attribué à l'ouverture et n'est jamais réutilisé.
- **RM-50** — Un OR référence un **client payeur principal**, un **véhicule** et fige à l'ouverture : la plaque, le détenteur, l'adresse de facturation, les conditions commerciales et les taux horaires applicables. Ces valeurs figées ne changent plus, même si la fiche client ou véhicule évolue ensuite.
- **RM-51** — Le **kilométrage d'entrée** est obligatoire à l'ouverture d'un OR quand le véhicule est physiquement présent **(P — quasi universellement obligatoire)**. Le kilométrage de sortie est optionnel.
- **RM-52** — Un OR porte les **demandes du client en verbatim**, séparées des lignes techniques. Le verbatim n'est jamais écrasé par une reformulation : il est conservé tel quel et reproduit sur le document.
- **RM-53** — Un OR porte un **montant plafond autorisé** (TTC) et l'identité de la personne qui l'a autorisé. Défaut paramétrable par tenant **(P)**, surchargeable par client. Valeur 0 = tout supplément nécessite un accord.
- **RM-54** — Le **total des lignes validées ne peut pas dépasser le montant plafond** sans un accord enregistré. Toute tentative de valider une ligne qui ferait franchir le plafond exige la création d'un devis complémentaire.
- **RM-55** — Un OR porte une **localisation du véhicule** : parc, atelier (poste), sous-traitant (lequel), essai routier, lavage, prêt au retrait, restitué. Elle est modifiable à tout moment et journalisée. C'est ce qui permet de répondre à « où est ma voiture ? » en 5 secondes.
- **RM-56** — Un OR porte une **date/heure de restitution promise**. Tout report est journalisé avec un motif ; c'est l'indicateur de tenue de promesse.
- **RM-57** — Un OR peut avoir un **OR parent** dans deux cas : retouche (reprise à la charge du garage) ou suite d'un OR interrompu (travaux reportés puis exécutés).
- **RM-58** — Un OR bloqué en attente d'accord ou en attente de pièces depuis plus de N jours **(P)** apparaît dans une liste d'exceptions destinée au chef d'atelier.
- **RM-59** — Toute modification d'un OR (statut, ligne, montant, plafond, payeur, affectation) est journalisée : qui, quoi, quand, valeur avant / après.
- **RM-60** — Un OR ne peut pas passer à `terminé` s'il subsiste au moins une ligne en statut `à valider`, ou un pointage ouvert, ou une ligne `validée` non `réalisée`.
- **RM-61** — Un OR peut être **imprimé/exporté à tout moment** dans son état courant (ordre de travail pour l'atelier, récapitulatif client, proposition de facturation).
- **RM-62** — Un OR annulé conserve ses lignes et son historique (jamais de suppression physique) et n'est plus modifiable. L'annulation n'est possible que s'il n'existe aucun pointage, aucune pièce sortie et aucune facture (voir RM-71).

### 4.5 Lignes d'OR (RM-63 → RM-78)

- **RM-63** — Une ligne d'OR a un **type** parmi : `main-d'œuvre barémée`, `main-d'œuvre au temps réel`, `forfait`, `pièce`, `fourniture`, `sous-traitance`, `produit d'atelier`, `taxe/élimination`, `remise`, `texte` (ligne d'information non chiffrée).
- **RM-64** — Une ligne d'OR a une **origine** : `commandée` (client), `constatée` (technicien), `campagne`, `garantie`, `retouche`, `interne`.
- **RM-65** — Une ligne de main-d'œuvre porte : un temps (en heures décimales ou en unités de temps constructeur, **P**), un taux horaire **figé** au moment de la création, le technicien affecté, et éventuellement un code opération constructeur.
- **RM-66** — Une ligne porte un **payeur** parmi : `client`, `constructeur`, `assurance`, `tiers` (leaser, gestionnaire de flotte, contrat de service), `garage` (geste commercial, retouche, casse). Le payeur par défaut est `client`.
- **RM-67** — Un OR peut avoir **plusieurs payeurs** simultanément **(P — certains garages l'interdisent)**. La proposition de facturation produit alors un regroupement par payeur, chacun donnant lieu à un document distinct en étape 2.
- **RM-68** — Une ligne de payeur `assurance` porte le n° de sinistre et, le cas échéant, l'accord de l'expert (n°, date). Une **franchise** est modélisée comme une ligne de répartition explicite à charge du client, jamais comme un calcul implicite.
- **RM-69** — Une ligne de payeur `constructeur` porte le code défaut, le code opération et le n° de campagne ou de dossier de garantie. Le temps barémé constructeur peut différer du temps barémé client : les deux valeurs coexistent.
- **RM-70** — Une ligne de payeur `garage` est facturée à personne mais **valorisée** (coût interne) pour l'analyse : elle apparaît sur le récapitulatif client à 0.00 avec la mention correspondante **(P — offrir en visible ou masquer)**.
- **RM-71** — Une ligne ne peut pas être **supprimée** dès qu'elle porte du temps pointé, une pièce sortie ou une facturation : elle est **annulée** (statut), avec motif.
- **RM-72** — Une ligne `refusée` par le client ne peut jamais devenir `réalisée`. Pour l'exécuter malgré tout, il faut une nouvelle ligne rattachée à un nouvel accord.
- **RM-73** — Une ligne `refusée` ou `reportée` alimente automatiquement les **travaux reportés** du véhicule, avec la date, le kilométrage du jour, le degré d'urgence et le montant estimé de l'époque. Ils sont représentés au prochain RDV (RM-36).
- **RM-74** — Les rabais s'appliquent **par ligne** et par catégorie, jamais globalement sur un total : la TVA est calculée par ligne puis agrégée.
- **RM-75** — Le **produit d'atelier** (petites fournitures) est calculé selon le mode paramétré : pourcentage de la main-d'œuvre avec plafond, forfait fixe, lignes réelles, ou désactivé **(P)**.
- **RM-76** — Une ligne de **sous-traitance** porte le fournisseur, le coût d'achat et le prix de vente (marge appliquée selon paramètre). Elle implique un changement de localisation du véhicule si celui-ci quitte le garage.
- **RM-77** — Une **pièce apportée par le client** est saisissable en ligne à 0.00 avec le type `fourniture` et l'indicateur « fournie par le client », si le paramètre l'autorise **(P)**. Elle déclenche une mention de décharge sur le document (pas de garantie sur la pièce ni sur la main-d'œuvre associée).
- **RM-78** — Une ligne peut être marquée « pièce remplacée à restituer au client » ; la restitution effective est cochée au retrait.

### 4.6 Devis complémentaire (RM-79 → RM-86)

- **RM-79** — Un devis complémentaire est un objet **immuable une fois répondu**. Un OR peut en porter plusieurs, numérotés dans l'ordre.
- **RM-80** — Un devis complémentaire référence les lignes soumises, le montant TTC, le nouveau plafond demandé et l'impact sur la date de restitution.
- **RM-81** — La réponse enregistre obligatoirement : la décision (`accepté` / `refusé` / `partiel`), le canal, le **nom de l'interlocuteur**, la date/heure, l'utilisateur qui a saisi et un champ libre de retranscription. Pour une réponse `partiel`, chaque ligne porte sa propre décision.
- **RM-82** — Tant qu'un devis complémentaire est en attente, les lignes concernées restent `à valider` et ne peuvent pas être pointées ni réalisées.
- **RM-83** — Un devis complémentaire peut être envoyé par e-mail ou SMS avec un lien d'acceptation en ligne (signature simple). La réponse électronique est horodatée et conserve l'adresse IP et l'agent **[À VALIDER : valeur probante suffisante ? cf. Q-14]**.
- **RM-84** — Le refus d'un devis complémentaire n'annule **pas** l'OR : il fait basculer les lignes en `refusée`, alimente les travaux reportés, et l'OR reprend son cours sur les lignes déjà validées.
- **RM-85** — Si le refus intervient après démontage, une ligne de **remontage / remise en état** peut être ajoutée. Elle est soumise à accord au même titre que les autres et sa politique de facturation est paramétrable **(P : facturée, offerte, facturée si supérieure à X)**.
- **RM-86** — Une pièce déjà commandée ou déballée au moment du refus reste due : la ligne passe en `refusée` mais un traitement explicite est demandé (retour fournisseur, mise en stock, facturation au client des frais de retour). En étape 1 cela se traduit par une **tâche de suivi** sur l'OR ; en étape 3 par un mouvement de stock.

### 4.7 Pointage (RM-87 → RM-99)

- **RM-87** — Un pointage lie un technicien, une plage horaire (début, fin) et une **activité** : soit une ligne d'OR (productif), soit un OR sans ligne précise (productif non ventilé, **P**), soit une activité indirecte (nettoyage, entretien de l'atelier, formation, attente, magasin, retouche interne, absence).
- **RM-88** — Un pointage ouvert n'a pas de fin. Un technicien ne peut avoir **qu'un seul pointage ouvert** à la fois, sauf si le chevauchement est autorisé **(P)**.
- **RM-89** — Si le chevauchement est interdit (défaut), démarrer un pointage **clôture automatiquement** le pointage ouvert précédent, avec une mention « clôturé automatiquement » et une notification visible au technicien.
- **RM-90** — Si le chevauchement est autorisé, le temps de la plage partagée est **réparti au prorata** entre les OR concernés pour le calcul de productivité, et la valeur brute reste consultable. La règle de répartition doit être explicite sur le document interne.
- **RM-91** — Un pointage ouvert au-delà de l'heure de fermeture de l'atelier est **clôturé automatiquement** à l'heure de fermeture paramétrée **(P)**, marqué « clôture automatique » et placé en anomalie pour correction.
- **RM-92** — Un pointage ne peut pas être démarré sur un OR au statut `terminé`, `facturé`, `restitué`, `clôturé` ou `annulé`.
- **RM-93** — Un pointage ne peut pas être démarré sur une ligne au statut `à valider`, `refusée` ou `annulée`.
- **RM-94** — Une correction de pointage (heures, affectation, activité) n'est possible que pour un rôle habilité, exige un **motif**, conserve la valeur d'origine et est journalisée.
- **RM-95** — Un pointage appartenant à une période clôturée (mois validé pour la paie ou les statistiques) est **verrouillé** : plus aucune modification, correction par contre-passation uniquement.
- **RM-96** — Un pointage dont la durée dépasse N heures **(P, défaut 10 h)** ou qui chevauche la nuit apparaît en anomalie.
- **RM-97** — Le temps pointé est **arrondi à l'affichage et au calcul** selon le paramètre du tenant (à la minute, au 1/4 h, au 1/10 h) ; la valeur brute reste stockée à la seconde.
- **RM-98** — Le pointage ne détermine **jamais automatiquement** le temps facturé : le temps facturé vient du barème ou du forfait, sauf pour les lignes explicitement « au temps réel », où le temps pointé est proposé et reste modifiable par un rôle habilité.
- **RM-99** — Indicateurs calculés à partir du pointage, disponibles par technicien, par site et par période : **présence** (heures pointées toutes activités), **productivité** (heures productives / heures de présence), **rendement** (heures vendues / heures productives pointées), **taux de retouche** (heures de retouche / heures productives).

### 4.8 Véhicule de remplacement (RM-100 → RM-105)

- **RM-100** — Un véhicule de remplacement est un véhicule du parc du garage marqué comme tel, rattaché à un site, avec un état : disponible, prêté, en entretien, hors service.
- **RM-101** — Un prêt lie : véhicule de courtoisie, OR, client, **conducteur nommé avec son numéro de permis**, dates prévues et réelles, km départ/retour, carburant départ/retour, franchise, tarif.
- **RM-102** — Un prêt ne peut pas démarrer sans conducteur identifié ni contrat accepté (signature ou case de confirmation selon paramètre).
- **RM-103** — Un véhicule de courtoisie ne peut pas être prêté à deux clients sur des plages qui se chevauchent, sauf forçage journalisé.
- **RM-104** — Si la restitution du véhicule client est reportée et que le véhicule de courtoisie est réservé pour un autre client, une **alerte** est levée à destination du réceptionnaire dès le report.
- **RM-105** — Au retour, tout écart (carburant manquant, km au-delà du forfait, dégât constaté) génère des lignes proposées sur l'OR, jamais facturées silencieusement.

### 4.9 Transversal (RM-106 → RM-112)

- **RM-106** — Toutes les entités de cette spécification portent `tenant_id` et sont scopées par site quand elles sont opérationnelles (RDV, OR, pointage, prêt). Clients et véhicules sont partagés entre les sites d'un même tenant **(P — certains groupes veulent un cloisonnement par site ; défaut : partagé)**.
- **RM-107** — Tous les montants sont en centimes (entiers), TVA 8.1 % par défaut sur les prestations et pièces d'atelier, calculée par ligne puis agrégée.
- **RM-108** — Tout document remis au client (mandat de réparation, ordre de travail, récapitulatif, contrat de prêt) est généré dans la **langue du client** (RM-02) et conserve une copie figée de ce qui a été signé.
- **RM-109** — Les signatures (réception, restitution, prêt) sont stockées avec date, heure, appareil, nom du signataire et empreinte du document signé.
- **RM-110** — Aucune donnée d'atelier n'est physiquement supprimée : annulation, archivage ou désactivation. Les demandes d'effacement nLPD sont traitées par anonymisation de la personne, en conservant les documents comptables et techniques.
- **RM-111** — Toute action modifiant un OR, un pointage ou une détention de véhicule est journalisée avec l'utilisateur, l'horodatage et les valeurs avant/après.
- **RM-112** — Les recherches du comptoir (plaque, VIN, nom, téléphone) doivent être insensibles à la casse, aux espaces, aux apostrophes et aux tirets, et fonctionner sur des fragments (« 12345 » retrouve « VD 123456 »).

---

## 5. Machines à états

### 5.1 Ordre de réparation

```
                    ┌──────────┐
                    │ planifie │  (créé depuis un RDV, véhicule pas encore là — optionnel P-22)
                    └────┬─────┘
                         │ réception du véhicule (km, signature)
                         ▼
   ┌────────────────►┌────────┐
   │                 │ ouvert │◄──────────────────┐
   │                 └───┬────┘                   │
   │                     │ premier pointage       │
   │                     ▼                        │
   │        ┌───────► ┌──────────┐ ◄──────────────┤
   │        │         │ en_cours │                │
   │        │         └────┬─────┘                │
   │        │              │                      │
   │   ┌────┴───────┬──────┴────────┬─────────────┴──────┐
   │   │            │               │                    │
   │   ▼            ▼               ▼                    │
   │ attente_    attente_       attente_                 │
   │ accord      pieces         externe                  │
   │   │            │               │                    │
   │   └────────────┴───────────────┴────────────────────┘
   │                     │ tous travaux exécutés
   │                     ▼
   │                ┌──────────┐
   │                │ controle │
   │                └────┬─────┘
   │  contrôle échoué    │ contrôle validé
   └─────────────────────┤
                         ▼
                    ┌─────────┐
                    │ termine │  (prêt au retrait / prêt à facturer)
                    └────┬────┘
                         │ émission d'au moins une facture (étape 2)
                         ▼
                    ┌─────────┐
                    │ facture │
                    └────┬────┘
                         │ remise des clés
                         ▼
                    ┌──────────┐        ┌────────┐
                    │ restitue │───────►│ cloture│ (terminal)
                    └──────────┘        └────────┘

   ┌────────┐
   │ annule │ (terminal, depuis planifie / ouvert uniquement, sous conditions RM-62)
   └────────┘
```

#### Transitions AUTORISÉES

| #    | De                                                        | Vers                | Condition                                                                              | Acteur                        |
| ---- | --------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| T-01 | (création)                                                | `planifie`          | depuis un RDV, véhicule absent                                                         | réceptionnaire                |
| T-02 | (création)                                                | `ouvert`            | véhicule présent, km relevé                                                            | réceptionnaire                |
| T-03 | `planifie`                                                | `ouvert`            | réception effective : km relevé (RM-51), demandes confirmées                           | réceptionnaire                |
| T-04 | `ouvert`                                                  | `en_cours`          | au moins un pointage démarré, ou déclenchement manuel                                  | technicien / chef d'atelier   |
| T-05 | `en_cours`                                                | `attente_accord`    | au moins une ligne `à valider` et un devis complémentaire envoyé                       | réceptionnaire                |
| T-06 | `attente_accord`                                          | `en_cours`          | réponse enregistrée (accepté / refusé / partiel)                                       | réceptionnaire                |
| T-07 | `en_cours`                                                | `attente_pieces`    | au moins une ligne bloquée en attente de pièce                                         | technicien / magasinier       |
| T-08 | `attente_pieces`                                          | `en_cours`          | pièce disponible                                                                       | magasinier                    |
| T-09 | `en_cours`                                                | `attente_externe`   | véhicule ou pièce parti chez un sous-traitant                                          | chef d'atelier                |
| T-10 | `attente_externe`                                         | `en_cours`          | retour du sous-traitant                                                                | chef d'atelier                |
| T-11 | `en_cours`                                                | `controle`          | aucune ligne `à valider`, aucune ligne `validée` non `réalisée`, aucun pointage ouvert | technicien                    |
| T-12 | `controle`                                                | `en_cours`          | contrôle non conforme, motif obligatoire                                               | chef d'atelier                |
| T-13 | `controle`                                                | `termine`           | check-list complète si exigée (P-08)                                                   | chef d'atelier                |
| T-14 | `en_cours`                                                | `termine`           | uniquement si le contrôle qualité n'est pas obligatoire (P-08)                         | chef d'atelier                |
| T-15 | `termine`                                                 | `en_cours`          | réouverture avant facturation, motif obligatoire, journalisée                          | chef d'atelier                |
| T-16 | `termine`                                                 | `facture`           | émission d'au moins une facture couvrant les lignes du payeur (étape 2)                | réceptionnaire                |
| T-17 | `facture`                                                 | `restitue`          | clés remises ; paiement préalable exigé ou non selon P-11                              | réceptionnaire                |
| T-18 | `termine`                                                 | `restitue`          | restitution sans facturation (garantie pure, retouche, payeur externe uniquement)      | réceptionnaire                |
| T-19 | `restitue`                                                | `cloture`           | plus rien en suspens (facture soldée ou transmise, prêt clôturé, pièces rendues)       | automatique ou réceptionnaire |
| T-20 | `planifie` \| `ouvert`                                    | `annule`            | aucun pointage, aucune pièce sortie, aucune facture (RM-62)                            | réceptionnaire                |
| T-21 | `attente_accord` \| `attente_pieces` \| `attente_externe` | `attente_*` (autre) | cumul d'attentes : l'état affiché est le plus bloquant, les motifs coexistent          | système                       |

> **Note sur T-21** : en pratique un OR peut attendre une pièce **et** un accord. Recommandation d'implémentation :
> les motifs d'attente sont des **drapeaux cumulables** portés par les lignes, l'état de l'OR étant dérivé.
> Le modèle reste une machine à états pour l'OR, mais l'état `attente_*` est calculé, pas saisi.

#### Transitions INTERDITES (les tests à écrire en priorité)

| #    | Tentative                                                       | Pourquoi c'est interdit                                                            | Comportement attendu                                                                                              |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| I-01 | `ouvert` → `facture`                                            | On ne facture pas des travaux jamais déclarés terminés                             | Erreur métier `or.transition.interdite`                                                                           |
| I-02 | `facture` → `en_cours`                                          | Un OR facturé est figé ; toute reprise passe par un **OR de retouche** lié (RM-57) | Erreur + proposition de créer l'OR de retouche                                                                    |
| I-03 | `facture` → `annule`                                            | Correction par avoir uniquement (règle facturation)                                | Erreur `or.annulation.facture`                                                                                    |
| I-04 | `restitue` → `en_cours` / `termine`                             | Le véhicule est parti ; nouvelle intervention = nouvel OR                          | Erreur + proposition de nouvel OR                                                                                 |
| I-05 | `annule` → tout autre état                                      | État terminal                                                                      | Erreur                                                                                                            |
| I-06 | `cloture` → tout autre état                                     | État terminal                                                                      | Erreur                                                                                                            |
| I-07 | `planifie` → `en_cours`                                         | On ne travaille pas sur un véhicule non réceptionné (km, dégâts, signature)        | Erreur `or.reception.requise`                                                                                     |
| I-08 | `en_cours` → `termine` avec une ligne `à valider`               | Chaque ligne doit être tranchée (RM-60)                                            | Erreur listant les lignes concernées                                                                              |
| I-09 | `en_cours` → `termine` avec un pointage ouvert                  | Le temps serait faux                                                               | Erreur listant les techniciens concernés                                                                          |
| I-10 | `en_cours` → `controle` avec une ligne `validée` non `réalisée` | Travaux payés non faits                                                            | Erreur listant les lignes                                                                                         |
| I-11 | `attente_accord` → `termine`                                    | Un accord en attente doit être tranché                                             | Erreur                                                                                                            |
| I-12 | `ouvert` → `restitue` sans passer par `termine`                 | Restitution sans clôture technique = perte de traçabilité                          | Autorisé **seulement** via l'annulation d'OR (T-20) ou la sortie provisoire (§6.7), jamais par transition directe |
| I-13 | Toute transition sur un OR d'un autre tenant                    | Isolation                                                                          | 404, jamais 403 (ne pas divulguer l'existence)                                                                    |
| I-14 | `termine` → `facture` sans ligne facturable pour le payeur      | Facture vide                                                                       | Erreur `or.facturation.aucune_ligne`                                                                              |
| I-15 | Modification d'une ligne d'un OR `facture`/`restitue`/`cloture` | Immuabilité                                                                        | Erreur `or.ligne.verrouillee`                                                                                     |

### 5.2 Ligne d'OR

```
  proposee ──► a_valider ──► validee ──► en_cours ──► realisee ──► facturee
      │            │            │            │            │
      │            └──► refusee │            │            │
      │                         │            │            │
      └──► validee (si dans le plafond, pas d'accord nécessaire)
                                │
      annulee ◄─────────────────┴────────────┴────────────┘  (motif obligatoire)
```

**Autorisées** : `proposee`→`a_valider` ; `proposee`→`validee` (si le total reste sous le plafond) ;
`a_valider`→`validee` / `refusee` ; `validee`→`en_cours` ; `en_cours`→`realisee` ; `realisee`→`facturee` ;
`validee`/`en_cours`/`realisee`→`annulee` (motif) ; `refusee`→`a_valider` (le client rappelle et change d'avis —
crée un nouveau devis complémentaire).

**Interdites** : `refusee`→`realisee` (RM-72) ; `facturee`→ tout autre état ; suppression d'une ligne pointée
(RM-71) ; `a_valider`→`en_cours` (RM-93) ; `annulee`→ tout autre état ; passer `realisee` une ligne dont la pièce
n'a pas été sortie **(P — contrôle actif en étape 3)**.

### 5.3 Rendez-vous

```
  demande ──► planifie ──┬──► honore   (OR ouvert — terminal)
   (web)        ▲        ├──► absent   (no-show — terminal)
                │        ├──► annule_client   (terminal)
                │        ├──► annule_garage   (terminal)
                └────────┴──► reporte  (terminal, crée un nouveau RDV lié)
```

**Autorisées** : `demande`→`planifie` (validation garage) ; `demande`→`annule_garage` (refus) ;
`planifie`→`honore` / `absent` / `annule_client` / `annule_garage` / `reporte` ; `reporte`→(nouveau RDV `planifie`).

**Interdites** : `honore`→ tout (terminal ; corriger = annuler l'OR puis rouvrir un RDV) ;
`absent`→`honore` (le client arrive à 16h alors qu'il était attendu à 8h → nouveau RDV du jour, sinon les
statistiques d'absence sont fausses) ; `annule_*`→`planifie` (réactiver = créer un nouveau RDV) ;
annuler un RDV dont l'OR est ouvert (RM-47) ; `planifie`→`honore` sans client **et** véhicule identifiés (RM-35).

### 5.4 Pointage

```
  en_cours ──► termine ──► valide ──► verrouille (terminal)
      │            ▲          │
      │            └──────────┘  (correction par rôle habilité, motif obligatoire)
      └──► termine (clôture automatique : fin de journée ou nouveau pointage)
```

**Autorisées** : `en_cours`→`termine` (manuel ou automatique) ; `termine`→`valide` (chef d'atelier) ;
`valide`→`termine` (dévalidation avec motif, tant que la période est ouverte) ; `valide`→`verrouille` (clôture de période).

**Interdites** : modifier ou supprimer un pointage `verrouille` (RM-95 : contre-passation uniquement) ;
créer un pointage sur un OR non modifiable (RM-92) ; créer un pointage dans le futur ;
créer un pointage rétroactif sur une période verrouillée ; un second pointage `en_cours` pour le même technicien
quand le chevauchement est interdit (RM-88).

### 5.5 Prêt de véhicule de remplacement

`reserve` → `en_cours` (remise) → `retourne` → `cloture`.
**Interdites** : remettre un véhicule déjà `en_cours` sur un autre prêt ; clôturer sans km de retour ;
supprimer un prêt (annulation avec motif uniquement).

---

## 6. Les cas tordus

### 6.1 L'OR ouvert dont le client refuse le devis complémentaire à mi-travaux

**Scénario** : service annuel accepté (CHF 380). Le technicien constate des disques hors cote. Devis
complémentaire à CHF 940. Le véhicule est sur le pont, roues déposées, étriers démontés. Le client refuse.

**Traitement attendu** :

1. Les lignes du devis passent `refusée`, l'OR **reste vivant** (RM-84) et repasse `en_cours`.
2. Les lignes refusées alimentent les **travaux reportés** du véhicule avec la date, le km, le montant estimé et le degré d'urgence (RM-73).
3. Le temps de démontage déjà pointé existe : il doit trouver une destination. Trois politiques (**P-24**) :
   a. facturé au client sous forme d'une ligne « recherche de panne / démontage » (le plus courant si la limite d'engagement le couvrait) ;
   b. offert (payeur `garage`) — geste commercial ;
   c. facturé au-delà d'un seuil.
   Le système **propose** selon le paramètre, l'utilisateur peut trancher autrement avec le droit correspondant.
4. Une ligne « remontage / remise en état » peut être ajoutée (RM-85). Si elle fait franchir le plafond, elle exige elle-même un accord — cas réel qui rend furieux les clients : le prévoir, le paramétrer, ne jamais l'ajouter en silence.
5. Si les disques avaient déjà été commandés : tâche de suivi obligatoire sur l'OR (retour fournisseur / mise en stock / facturation des frais de retour) (RM-86).
6. Le document de restitution doit mentionner en clair les travaux refusés avec la formule de sécurité (« l'usure constatée nécessite une intervention, le véhicule a été restitué à la demande du client »). Voir §6.12 pour les défauts touchant la sécurité.

**Ce qu'il ne faut surtout pas faire** : annuler l'OR, ni supprimer les lignes refusées, ni perdre le temps pointé.

### 6.2 Le véhicule vendu entre la prise de RDV et le passage à l'atelier

**Scénario** : RDV pris le 3 mars par M. Meier pour son Touran. Le 20 mars, c'est Mme Rossi qui se présente : elle
a acheté le véhicule. Elle a la clé et la plaque, mais elle est inconnue du garage.

**Traitement attendu** :

1. La recherche par plaque retrouve le véhicule et affiche **le détenteur enregistré** avec la date de début de détention.
2. Le réceptionnaire déclare un **changement de détenteur** : fin de la détention Meier (motif « vente »), création de la fiche Rossi, début de la nouvelle détention à la date déclarée (RM-20).
3. Les OR passés **restent rattachés à M. Meier** (RM-21). L'historique **technique** (interventions, km, travaux reportés) reste attaché au véhicule et donc visible ; l'affichage des montants et documents de l'ancien détenteur suit P-25.
4. Le RDV, encore rattaché à Meier, est **réaffecté** à Rossi avant d'être honoré (transition autorisée sur un RDV `planifie`).
5. Les conditions commerciales de Meier (rabais fidélité) ne s'appliquent pas à Rossi : l'OR fige les conditions du **nouveau** détenteur (RM-50).
6. Cas fréquent associé : Mme Rossi n'a pas la plaque de Meier — le véhicule a changé de canton. Le système enregistre la nouvelle plaque et clôt l'ancienne (RM-17), sans créer de doublon de véhicule.
7. Piège à éviter : Meier revient plus tard chercher « sa » facture de 2024 ; elle doit rester accessible sous **sa** fiche client même s'il ne détient plus le véhicule.

### 6.3 Le client vient avec un autre véhicule que celui du RDV

Fréquent chez les clients à deux voitures. Le RDV référence le véhicule A, le client arrive avec le B.
**Attendu** : le véhicule d'un RDV `planifie` est modifiable jusqu'à l'honorer ; le changement est journalisé ;
les alertes du véhicule (campagnes, travaux reportés, expertise) sont **rechargées** pour le B ; la durée estimée
est signalée comme potentiellement obsolète (un service sur une Golf n'est pas un service sur un Touareg).
**Interdit** : changer le véhicule d'un OR après ouverture — c'est un autre OR.

### 6.4 Le client entreprise avec plusieurs conducteurs et une adresse de facturation distincte

**Scénario** : Transports Beaulieu SA, 14 véhicules, 9 conducteurs, facturation centralisée chez une fiduciaire à
Fribourg, accord préalable du gestionnaire de flotte au-delà de CHF 300, numéro de commande interne obligatoire.

**Traitement attendu** :

1. Client `entreprise` avec adresse principale (siège) **et** adresse de facturation (fiduciaire) (RM-03).
2. Contacts multiples avec rôles : conducteurs (RM-04), gestionnaire de flotte marqué `signataire`, comptabilité marquée destinataire des documents.
3. À la réception, le **conducteur présent est enregistré** sur l'OR (champ distinct du client), mais **ne peut pas** autoriser un dépassement de plafond s'il n'a pas le rôle `signataire` : le devis complémentaire part au gestionnaire de flotte, pas au conducteur (RM-53 + §10).
4. Le plafond par défaut vient de la fiche entreprise (CHF 300), pas du paramètre tenant.
5. Le **numéro de commande interne** (PO) est obligatoire (RM-14) : blocage à la clôture, pas à l'ouverture — sinon on bloque la réception du matin.
6. Le récapitulatif remis au conducteur ne porte pas les montants **(P-26)** ; la facture part à l'adresse de facturation.
7. Les 14 véhicules sont rattachés à l'entreprise comme détenteur ; le conducteur habituel est un attribut du **véhicule** (« véhicule attribué à M. X »), utile au comptoir pour appeler la bonne personne.
8. Variante fréquente : le véhicule est en leasing opérationnel et c'est **le leaser** (Arval, ALD, Alphabet…) qui paie l'entretien avec accord préalable numéroté. Alors : payeur `tiers`, n° d'accord obligatoire sur les lignes concernées, et souvent une partie à charge de l'entreprise (pneus hors contrat, dégâts) → OR multi-payeurs (RM-67).

### 6.5 L'OR abandonné : le client ne revient pas chercher sa voiture

**Scénario** : véhicule terminé et facturé le 12 mai. Le 20 juin il est toujours sur le parc. Le client ne répond
plus. Il occupe une place, l'assurance du garage le couvre, et la facture n'est pas payée.

**Traitement attendu** :

1. L'OR reste `facture` avec une localisation `prêt au retrait` et un **compteur de jours d'attente** depuis le passage en `termine`.
2. Liste d'exceptions « véhicules en attente de retrait » avec des **paliers de relance paramétrables** (P-15) : J+3 SMS/appel, J+10 e-mail, J+20 courrier recommandé de mise en demeure.
3. À partir de J+N **(P)**, des **frais de garde/parcage** peuvent être ajoutés (CHF/jour) — uniquement s'ils sont annoncés dans les CGV du garage ; le système ne les ajoute jamais automatiquement à la facture, il les **propose** avec un rappel de cette condition.
4. Le garage dispose d'un **droit de rétention** sur le véhicule pour ses créances (art. 895 CC) **[À VALIDER avec un juriste, cf. Q-15]** : l'OR porte un indicateur `rétention invoquée` avec sa date, et le véhicule ne peut pas être restitué sans levée explicite par la direction.
5. Après restitution tardive, l'OR passe `restitue` puis `cloture` normalement — et le délai est conservé comme indicateur.
6. Cas voisin : le client refuse de payer la facture. L'OR reste `facture`, un **litige** est ouvert (motif, montant contesté, personne en charge) ; le règlement passe par un avoir en étape 2, jamais par une modification de l'OR (I-02, I-03).

### 6.6 Le dépôt la veille au soir (boîte à clés)

Pas de contact, pas de signature, pas de km relevé au dépôt. **Attendu** : OR créé au statut `planifie` la veille
avec la mention « dépôt boîte à clés » ; le lendemain, la réception est faite par le technicien qui relève le km ;
la signature du mandat est **différée au retrait** ou remplacée par un accord téléphonique tracé ; le plafond
appliqué est celui convenu par téléphone, à défaut le plafond par défaut du tenant. Le système doit accepter un
OR `ouvert` **sans signature** si le paramètre le permet (P-09) et le signaler dans la liste d'exceptions.

### 6.7 L'attente de pièces longue : rendre le véhicule et le reprendre plus tard

**Scénario** : pièce en rupture usine, 3 semaines. Le client a besoin de sa voiture.
**Deux pratiques observées, à paramétrer (P-27)** :

- **A** : l'OR reste ouvert en `attente_pieces`, le véhicule est marqué `sorti provisoirement` (localisation), le client repart avec sa voiture. Avantage : un seul OR, pas de perte du contexte. Inconvénient : les indicateurs de durée d'immobilisation deviennent faux.
- **B** : l'OR en cours est **clôturé et facturé** pour ce qui est fait ; la pièce en attente devient un **travail reporté** avec un statut « pièce commandée » ; un nouvel OR sera ouvert à l'arrivée de la pièce, lié au précédent (RM-57).
  Le système doit supporter les deux et le choix doit être explicite au moment de la décision, pas figé par un
  paramètre global — **recommandation : paramètre pour le comportement par défaut, choix possible au cas par cas.**

### 6.8 Le technicien qui pointe sur deux OR en même temps

**Cas légitimes** : charge de batterie ou passage au banc pendant qu'on travaille sur un autre véhicule ;
le technicien démarre un diagnostic pendant qu'une purge se termine.
**Cas illégitime** : oubli de clôture du pointage précédent (le plus fréquent, de loin).

**Traitement attendu** :

- Défaut (P-06 = interdit) : le démarrage du second pointage clôture le premier automatiquement et **le dit** au technicien à l'écran, avec la possibilité de corriger l'heure de fin dans la foulée (RM-89).
- Si autorisé : les deux pointages coexistent, la plage commune est **répartie au prorata** pour la productivité, la valeur brute reste consultable, et l'OR affiche « temps partagé » sur la ligne (RM-90).
- Dans les deux cas, une **anomalie** est levée si le chevauchement dépasse N minutes (P) — ça révèle soit une mauvaise pratique, soit un besoin réel à paramétrer.
- Cas jumeau à ne pas oublier : **deux techniciens sur le même OR en même temps** (dépose de boîte à deux). Toujours autorisé, jamais une anomalie.

### 6.9 Les plaques interchangeables et les plaques professionnelles

Un client possède une voiture de collection et une voiture courante avec **une seule plaque**. La recherche par
plaque doit retourner **deux véhicules** et demander lequel. Les plaques U (professionnelles, du garage) servent
aux essais et transferts : elles n'appartiennent à aucun véhicule client et ne doivent jamais créer de collision
(RM-18). Le système doit permettre de tracer quel véhicule porte une plaque U et quand (utile en cas d'amende).

### 6.10 Le kilométrage qui recule

Trois causes réelles : compteur remplacé (l'ancienne valeur doit être conservée avec la mention), véhicule importé
dont le compteur est en **miles** (conversion, et la saisie de 60 000 mi après 120 000 km affichés n'est pas une
régression), ou faute de frappe passée. **Attendu** : refus par défaut, motif explicite exigé, journalisation,
et l'ancienne valeur reste dans l'historique — jamais d'écrasement (RM-23, RM-24).

### 6.11 Le client revient avec le même symptôme (retouche)

**Attendu** : le réceptionnaire ouvre un OR de type `retouche` **lié à l'OR d'origine** (RM-57). Les lignes ont
l'origine `retouche` et le payeur `garage` par défaut. Les heures pointées sont productives mais **non vendues** :
elles alimentent le taux de retouche (RM-99). Si l'analyse révèle que la cause est une **pièce défectueuse
fournisseur**, le payeur des pièces bascule sur `tiers` (fournisseur) tandis que la main-d'œuvre reste souvent à
charge du garage. Le système ne doit pas empêcher cette ventilation hybride. Un OR de retouche ne doit **jamais**
être créé par réouverture de l'OR facturé (I-02).

### 6.12 Le client refuse une réparation touchant la sécurité

Freins hors service, pneus sous la limite légale, direction avec du jeu. Le garage engage sa responsabilité s'il
restitue le véhicule sans trace. **Attendu** : la ligne refusée peut être marquée `sécurité` ; l'OR devient
non clôturable sans une **mention de restitution sous réserve** imprimée et signée par le client (P-28 : mention
obligatoire, recommandée, ou désactivée). Cette signature est le seul document qui protège le garage.
**[À VALIDER : formulation type avec un juriste ou l'UPSA, cf. Q-16]**

### 6.13 Le véhicule qui arrive en dépanneuse, sans client

Pas de RDV, pas de signature, souvent pas de coordonnées complètes. **Attendu** : OR ouvert avec un client
provisoire (« client à identifier »), km relevé, photos obligatoires du véhicule à l'arrivée (état + dégâts),
localisation `parc`. L'OR ne peut pas être clôturé tant que le client n'est pas identifié. L'assistance
(TCS, assurance) peut être le payeur.

### 6.14 Le géant du planning : le rush pneus

Octobre-novembre et mars-avril, 25 changements de roues par jour, RDV de 20 minutes en série, souvent sans OR
individuel dans certains garages (un OR par véhicule reste la bonne pratique). **Attendu** : création rapide
d'OR en série depuis le planning, motif prédéfini, lignes préremplies (forfait montage + équilibrage +
élimination + valves), et surtout le **lien avec le dépôt de pneus** (quel jeu, quel emplacement) — d'où
l'importance de ne pas se fermer la porte (§1, Q-19).

### 6.15 La sous-traitance : le véhicule n'est plus au garage

Carrosserie, géométrie, boîte automatique, injection diesel, sellerie. **Attendu** : localisation
`chez un sous-traitant` avec le nom et la date de départ, l'OR en `attente_externe`, et une ligne de
sous-traitance avec coût d'achat et prix de vente (RM-76). Le véhicule de remplacement continue de courir.
Si le sous-traitant facture plus que prévu, un devis complémentaire est nécessaire comme pour tout dépassement.

### 6.16 Deux véhicules du même client le même jour, ou un véhicule avec deux OR ouverts

Un client peut avoir plusieurs OR ouverts simultanément (deux véhicules). En revanche, **deux OR ouverts sur le
même véhicule** est presque toujours une erreur de saisie : à **avertir** (pas bloquer — cas réel : un OR
carrosserie et un OR mécanique en parallèle sur le même véhicule, pratique courante en concession) **(P-29)**.

---

## 7. Modèle de données métier

> Niveau métier : entités, attributs significatifs, relations, historisation. Le schéma SQL, les index et les
> politiques RLS relèvent d'`expert-database`.

### 7.1 Client

| Attribut                               | Remarques                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| numéro client                          | unique par tenant, jamais réutilisé (RM-11)                                                                                    |
| type                                   | particulier / entreprise, immuable (RM-01)                                                                                     |
| civilité, nom, prénom / raison sociale |                                                                                                                                |
| n° IDE (CHE-xxx.xxx.xxx)               | entreprise ; base de la détection de doublon                                                                                   |
| langue de correspondance               | fr/de/it/en (RM-02)                                                                                                            |
| adresses (0..n typées)                 | principale / facturation / livraison (RM-03)                                                                                   |
| contacts (0..n)                        | rôles cumulables : conducteur, gestionnaire de flotte, signataire, comptabilité (RM-04)                                        |
| téléphones, e-mail, canal préféré      | mobile normalisé E.164                                                                                                         |
| conditions commerciales                | **historisées** : rabais MO / pièces / pneus, taux horaire spécifique, délai et mode de paiement, plafond d'engagement (RM-07) |
| consentements                          | **historisés** : type, date, canal, preuve (RM-09)                                                                             |
| statut                                 | actif / inactif / bloqué (RM-08)                                                                                               |
| PO obligatoire                         | booléen (RM-14)                                                                                                                |
| groupe                                 | maison mère / filiale (RM-10)                                                                                                  |
| notes                                  | interne / alerte (RM-13)                                                                                                       |
| référence externe                      | pour l'export fiduciaire (étape 2)                                                                                             |

**Historisé et pourquoi** : les **conditions commerciales** (justifier a posteriori le rabais appliqué sur un OR
de 2025), les **consentements** (preuve nLPD), l'**adresse de facturation** (une facture émise garde l'adresse du
moment — snapshot sur le document, pas de lien vivant).

### 7.2 Véhicule

| Attribut                          | Remarques                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| VIN                               | identité, unique par tenant (RM-15), nullable en saisie d'urgence (RM-16)                                                           |
| plaques                           | **historisées** : valeur, canton, du/au, interchangeable, professionnelle (RM-17, RM-18)                                            |
| marque, modèle, version, finition | référentiel marque global                                                                                                           |
| **code type CH**                  | numéro d'homologation du permis de circulation — identifie la version exacte, très demandé au comptoir pour les pièces              |
| 1re mise en circulation           | base des calculs de garantie et d'expertise                                                                                         |
| motorisation                      | carburant, cylindrée, kW/CV, boîte, transmission, norme d'émission                                                                  |
| couleur / code couleur            |                                                                                                                                     |
| poids à vide / total, places      | figurent sur le permis                                                                                                              |
| pneus                             | dimensions et indices été / hiver, pression                                                                                         |
| huile                             | type, viscosité, quantité                                                                                                           |
| batterie, code radio, code clé    | données de service                                                                                                                  |
| plan d'entretien                  | intervalle km et mois, prochain service calculé                                                                                     |
| importé                           | oui/non, pays, date d'importation (RM-27)                                                                                           |
| détentions                        | **historisées** : client, du/au, motif de fin (RM-20)                                                                               |
| propriétaire économique           | leaser éventuel (RM-22)                                                                                                             |
| kilométrages                      | **historisés** : date, valeur, unité, source (RM-23)                                                                                |
| expertises                        | **historisées** : date, résultat (accepté / défauts / refusé), défauts, délai de contre-visite, prochaine échéance + source (RM-28) |
| garanties                         | constructeur (début, durée, plafond km), extension, garantie garage (RM-33)                                                         |
| campagnes                         | code, description, ouverte/close (RM-30)                                                                                            |
| travaux reportés                  | date, km, désignation, urgence, montant estimé, OR d'origine (RM-73)                                                                |
| conducteur habituel               | texte ou contact (flottes)                                                                                                          |
| statut                            | actif / archivé + motif (RM-31)                                                                                                     |

**Historisé et pourquoi** : la **détention** (savoir qui a commandé quoi, et ne pas exposer les données d'un
ancien propriétaire), la **plaque** (elle change de canton et de véhicule ; l'historique sert à retrouver un
dossier « c'était la VD 123456 à l'époque »), le **kilométrage** (détection de rollback, calcul d'échéance
d'entretien, valeur de reprise en étape 4), l'**expertise** (obligation légale, relances).

### 7.3 Rendez-vous

site, date/heure début, durée, heures atelier estimées (RM-37), client (ou nom+téléphone provisoire), véhicule
(nullable), contact/conducteur, motif principal + secondaires, verbatim client, mode d'attente, ressources
réservées (technicien, poste, véhicule de remplacement), origine (RM-41), rappel envoyé/répondu, statut, OR lié,
RDV précédent (chaîne de report, RM-45), notes.

### 7.4 Ordre de réparation

| Attribut                                 | Remarques                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| numéro                                   | unique par tenant, préfixe + année (RM-49)                                               |
| site, date d'ouverture, réceptionnaire   |                                                                                          |
| type                                     | service / réparation / diagnostic / expertise / pneus / carrosserie / retouche / interne |
| client payeur principal                  | **figé** avec adresse et conditions (RM-50)                                              |
| véhicule + plaque figée + détenteur figé | (RM-50)                                                                                  |
| conducteur présent                       | distinct du client (flottes, §6.4)                                                       |
| km entrée / km sortie                    | (RM-51)                                                                                  |
| demandes client (verbatim, 0..n)         | jamais écrasées (RM-52)                                                                  |
| montant plafond + autorisé par           | (RM-53)                                                                                  |
| restitution promise + reports            | (RM-56)                                                                                  |
| localisation du véhicule                 | (RM-55)                                                                                  |
| lignes                                   | voir 7.5                                                                                 |
| devis complémentaires                    | voir 7.6                                                                                 |
| pointages                                | voir 7.7                                                                                 |
| prêt de véhicule                         | 0 ou 1                                                                                   |
| contrôle qualité                         | check-list, contrôleur, date, résultat                                                   |
| pièces à restituer au client             | oui/non + effectif                                                                       |
| signatures                               | réception, restitution (RM-109)                                                          |
| photos / documents joints                | tour du véhicule, dégâts, rapports                                                       |
| OR parent + motif de lien                | retouche / suite (RM-57)                                                                 |
| RDV d'origine                            | 0 ou 1                                                                                   |
| n° de commande interne (PO)              | flottes (RM-14)                                                                          |
| statut                                   | §5.1                                                                                     |
| indicateurs de litige / rétention        | §6.5                                                                                     |

### 7.5 Ligne d'OR

type (RM-63), origine (RM-64), désignation, référence (texte en étape 1, article en étape 3), quantité,
temps barémé, unité de temps, taux horaire **figé**, prix unitaire **figé**, rabais %, taux de TVA, payeur (RM-66),
statut (§5.2), technicien affecté, temps pointé cumulé (dérivé), code opération et code défaut constructeur,
n° de sinistre / n° d'accord, urgence (urgent / à faire / à surveiller), indicateur `sécurité` (§6.12),
indicateur « fournie par le client » (RM-77), motif d'annulation, ordre d'affichage.

### 7.6 Devis complémentaire

OR, numéro d'ordre, lignes soumises, montant TTC, nouveau plafond demandé, impact sur la restitution,
date d'envoi, canal, utilisateur émetteur, **nom de l'interlocuteur**, date/heure de réponse, décision
globale, décision par ligne, retranscription libre, preuve électronique éventuelle (RM-79 → RM-83).
**Immuable après réponse.**

### 7.7 Pointage

technicien, site, OR (nullable), ligne d'OR (nullable), type d'activité (productif / indirect avec sous-type),
début, fin, durée brute (secondes), durée retenue (arrondie, RM-97), source (écran atelier, badge, mobile, saisie),
clôture automatique oui/non, correction (valeur d'origine, motif, auteur), statut (§5.4), période de verrouillage.

### 7.8 Prêt de véhicule de remplacement

véhicule de courtoisie, OR, client, conducteur + n° de permis + validité, dates prévues et réelles,
km départ/retour, carburant départ/retour, franchise, tarif, contrat signé, dégâts au retour, statut (§5.5).

### 7.9 Référentiels et paramétrage

- **Catalogue de prestations** : forfaits du garage (service A, service B, changement de roues, pré-expertise), désignation multilingue, temps, prix, TVA, catégorie de taux horaire. Prix **historisés** (un OR de 2025 doit pouvoir être rejoué avec le prix de 2025).
- **Taux horaires** : par catégorie de travail, par marque, par catégorie de véhicule, avec **dates de validité** (RM-65).
- **Motifs de RDV**, **types d'OR**, **check-lists de contrôle** par type d'intervention.
- **Capacité atelier** : heures productives par jour, par site, par compétence, calendrier de fermeture (RM-38).
- **Techniciens** : compétences, taux de facturation, horaires, statut (apprenti / mécanicien / diagnosticien).

### 7.10 Ce qui doit être historisé — récapitulatif et justification

| Donnée                         | Pourquoi c'est daté                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Kilométrage                    | rollback de compteur, échéance d'entretien, valeur de reprise, litige garantie (« au-delà du plafond km »)                 |
| Détention du véhicule          | rattacher chaque OR au bon client, protéger les données de l'ancien propriétaire, retrouver l'historique en cas de revente |
| Plaque                         | change de canton, est réattribuée à un autre véhicule, sert de clé de recherche sur l'ancien                               |
| Prix et taux horaires          | justifier a posteriori le montant d'un OR ancien, rejouer un document                                                      |
| Conditions commerciales client | prouver le rabais consenti à l'époque                                                                                      |
| Expertise                      | obligation légale, relance, historique de défauts                                                                          |
| Consentements                  | preuve nLPD                                                                                                                |
| Statut d'OR et de ligne        | piste d'audit, litige, indicateur de délai                                                                                 |
| Pointages corrigés             | intégrité de la paie et des indicateurs                                                                                    |

---

## 8. Contexte suisse

### 8.1 Expertise (MFK) et échéances

- L'expertise périodique est organisée **par le service des automobiles du canton**, qui envoie une **convocation** au détenteur avec un délai. Le garage n'a pas la main sur le calendrier : **la convocation prime toujours sur toute périodicité calculée** (RM-28).
- Périodicité usuelle pour une voiture de tourisme : **premier contrôle 5 ans après la première mise en circulation, puis 3 ans, puis tous les 2 ans**. Véhicules utilitaires légers, taxis, auto-écoles, véhicules de location et remorques ont des périodicités plus courtes (souvent annuelles). **[À VALIDER, cf. Q-17]** — ces valeurs doivent être des **paramètres** (P-14), par type de véhicule et éventuellement par canton, jamais des constantes de code.
- Prestations liées, à modéliser comme motifs et forfaits : **pré-expertise** (contrôle préalable au garage, souvent forfait fixe), **présentation à l'expertise** (le garage y amène le véhicule, facturé au temps ou au forfait), **contre-visite / repassage** après défauts constatés, avec un délai imparti par le service des automobiles.
- Une expertise stocke : date, résultat (accepté / accepté avec défauts / refusé), liste des défauts, délai de correction, date de contre-visite, prochaine échéance.
- Un véhicule dont l'expertise est échue circule illégalement : c'est un argument commercial majeur pour la relance (RM-29).

### 8.2 Plaques cantonales

- Format : 2 lettres de canton + 1 à 6 chiffres (`VD 123456`, `FR 4711`). Le canton se déduit du préfixe.
- Un déménagement intercantonal **change la plaque** : nouvelle plaque, ancienne clôturée (RM-17).
- **Plaques interchangeables** : une plaque, deux véhicules du même détenteur, un seul en circulation (§6.9).
- **Plaques professionnelles (U)** : appartiennent au garage, servent aux essais et transferts, ne doivent jamais entrer en collision avec les plaques clients.
- Plaques temporaires / jour, plaques vétéran : cas marginaux à accepter en saisie libre.
- **La plaque n'est pas une clé d'identité**, mais c'est la **clé de recherche n°1** au comptoir : l'ergonomie doit en tenir compte (recherche partielle, tolérance aux espaces et à la casse, RM-112).

### 8.3 Véhicules importés

- Import direct (surtout d'Allemagne) : le véhicule n'a **pas d'historique** dans les systèmes du constructeur suisse, le carnet est étranger, les mises à jour de maintenance digitale peuvent être indisponibles.
- Conséquences métier : les **droits de garantie constructeur** peuvent différer ou nécessiter une vérification, l'accès aux campagnes de rappel n'est pas automatique, la date de 1re mise en circulation étrangère sert de base aux calculs.
- Le compteur peut être en **miles** (imports UK/US) → unité stockée sur chaque relevé (RM-23, §6.10).
- L'indicateur `importé` doit être **visible dès la prise de RDV** (RM-27) : le réceptionnaire ne doit jamais promettre une garantie qui n'existe pas.

### 8.4 Véhicule de remplacement

Pratique très répandue en Suisse et attendue par les clients de concession. Points métier : contrat de prêt signé,
permis de conduire du conducteur, franchise en cas de sinistre, carburant rendu au même niveau, kilométrage
forfaitaire ou facturé, disponibilité comme **ressource de planning au même titre qu'un pont** (RM-40, RM-103).
Tarification variable : gratuit, forfait par jour, gratuit au-delà d'un montant d'OR **(P-18)**.

### 8.5 Garantie constructeur vs garantie garage

|             | Garantie constructeur                                                                       | Garantie garage (interne)       | Garantie pièce fournisseur                          |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| Payeur      | constructeur                                                                                | garage                          | fournisseur (pièce) + souvent garage (main-d'œuvre) |
| Déclencheur | défaut couvert, dans la durée et le km                                                      | reprise d'un travail du garage  | pièce défaillante posée par le garage               |
| Barème      | temps constructeur, souvent inférieur                                                       | temps réel                      | temps réel                                          |
| Exigences   | code défaut, code opération, n° de dossier, **conservation de la pièce déposée** pour audit | traçabilité vers l'OR d'origine | retour de la pièce au fournisseur                   |
| Étape 1     | marquage de ligne + dossier imprimable                                                      | OR de retouche lié (RM-57)      | ventilation de payeurs hybride (§6.11)              |
| Étape 5     | transmission électronique au constructeur                                                   | —                               | —                                                   |

À prévoir également : **extensions de garantie et contrats de service** (payeur `tiers`, plafonds, franchise),
et le **geste commercial** (payeur `garage`, plafonné par rôle, §10).

### 8.6 TVA et argent

TVA **8.1 %** sur la main-d'œuvre, les pièces et les fournitures d'atelier. Montants en **centimes entiers**,
TVA calculée par ligne puis agrégée (RM-107), arrondi au 5 centimes pour les totaux en espèces.
Les **taxes de recyclage** (pneus, batteries, huiles, gaz clim) sont des lignes distinctes, soumises à TVA
**[À VALIDER avec la fiduciaire, cf. Q-18]**. Un client domicilié à l'étranger ne change pas le régime :
la prestation est exécutée en Suisse **[À VALIDER, cf. Q-18]**.

### 8.7 Protection des données (nLPD)

Photos du véhicule à la réception, plaque, numéro de permis du conducteur pour un prêt, verbatim client :
ce sont des données personnelles. Durées de conservation à définir, droit d'accès et d'effacement traité par
**anonymisation** en conservant les pièces comptables et techniques (RM-110).

---

## 9. Ce qui doit être paramétrable

> Ces points varient réellement d'un garage à l'autre parmi les 10+ garages accessibles pour validation.
> Aucun ne doit être codé en dur. Chacun a un défaut proposé, à confirmer sur le terrain.

| #    | Paramètre                                                                                              | Niveau                                | Défaut proposé                                      |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------- |
| P-01 | Numérotation des OR : préfixe, portée (tenant ou site), remise à zéro annuelle                         | tenant                                | préfixe + année + séquence par tenant               |
| P-02 | Taux horaires : un seul, ou par type de travail / marque / catégorie de véhicule / technicien          | tenant                                | plusieurs taux par type de travail                  |
| P-03 | Unité de temps : heures décimales (0.1 h) ou unités de temps constructeur                              | tenant                                | heures décimales                                    |
| P-04 | Produits d'atelier : % de la main-d'œuvre plafonné / forfait / lignes réelles / désactivé              | tenant                                | % plafonné                                          |
| P-05 | Montant plafond par défaut à la réception                                                              | tenant, surchargé par client          | CHF 300 **[À VALIDER]**                             |
| P-06 | Chevauchement de pointage autorisé                                                                     | tenant                                | interdit, clôture automatique du précédent          |
| P-07 | Pointage obligatoire pour passer un OR à `terminé`                                                     | tenant                                | non obligatoire (avertissement)                     |
| P-08 | Contrôle qualité obligatoire : jamais / toujours / selon le type d'intervention / au-delà d'un montant | tenant                                | selon le type d'intervention                        |
| P-09 | Signature client à la réception : obligatoire / recommandée / désactivée                               | tenant                                | recommandée                                         |
| P-10 | Km d'entrée obligatoire / km de sortie obligatoire                                                     | tenant                                | entrée obligatoire, sortie facultative              |
| P-11 | Restitution possible avant paiement                                                                    | tenant, surchargé par client          | oui pour les entreprises, non pour les particuliers |
| P-12 | Multi-payeurs sur un OR autorisé                                                                       | tenant                                | oui                                                 |
| P-13 | Rabais maximum par rôle (montant et %)                                                                 | tenant × rôle                         | à définir                                           |
| P-14 | Périodicités d'expertise par type de véhicule (et par canton si nécessaire)                            | tenant / global                       | 5 / 3 / 2 ans voiture de tourisme **[À VALIDER]**   |
| P-15 | Véhicules non retirés : délai avant relance, paliers, frais de garde CHF/jour                          | tenant                                | J+3 / J+10 / J+20, frais désactivés                 |
| P-16 | Rappels de RDV : canal (SMS / e-mail / aucun), J-N                                                     | tenant                                | SMS J-1                                             |
| P-17 | Pièces apportées par le client : interdit / autorisé avec décharge                                     | tenant                                | autorisé avec décharge                              |
| P-18 | Véhicule de remplacement : gratuit / forfait jour / gratuit au-delà d'un montant d'OR                  | tenant                                | forfait jour                                        |
| P-19 | Arrondi du temps pointé : minute / 1/10 h / 1/4 h                                                      | tenant                                | 1/10 h                                              |
| P-20 | Capacité atelier : heures productives par jour et par compétence, calendrier                           | site                                  | à saisir                                            |
| P-21 | OR sans RDV autorisé, et création automatique d'un RDV rétroactif                                      | tenant                                | autorisé, RDV rétroactif créé                       |
| P-22 | Utilisation de l'état `planifie` (OR préparé avant l'arrivée du véhicule)                              | tenant                                | activé                                              |
| P-23 | Langue des documents : langue du client / langue du site                                               | tenant                                | langue du client                                    |
| P-24 | Refus de devis après démontage : facturer le démontage / offrir / facturer au-delà d'un seuil          | tenant                                | facturer au-delà d'un seuil                         |
| P-25 | Visibilité de l'historique du véhicule pour un nouveau détenteur : tout / technique seulement / rien   | tenant                                | technique seulement                                 |
| P-26 | Montants visibles sur le document remis au conducteur d'une flotte                                     | client                                | masqués                                             |
| P-27 | Attente de pièces longue : garder l'OR ouvert (A) ou clôturer et rouvrir (B)                           | tenant, choix possible au cas par cas | A                                                   |
| P-28 | Mention de restitution sous réserve pour un défaut de sécurité refusé                                  | tenant                                | obligatoire                                         |
| P-29 | Deux OR ouverts sur le même véhicule : bloquer / avertir / autoriser                                   | tenant                                | avertir                                             |
| P-30 | Clients et véhicules partagés entre les sites d'un tenant, ou cloisonnés                               | tenant                                | partagés                                            |
| P-31 | Heure de clôture automatique des pointages ouverts                                                     | site                                  | heure de fermeture atelier                          |
| P-32 | Délai tampon entre deux prêts d'un même véhicule de remplacement                                       | tenant                                | 2 h                                                 |

---

## 10. Matrice rôle × action

| Action                                              | Réceptionnaire | Chef d'atelier | Technicien                  | Magasinier   | Comptable | Direction   |
| --------------------------------------------------- | -------------- | -------------- | --------------------------- | ------------ | --------- | ----------- |
| Créer / modifier un client                          | oui            | oui            | non                         | oui          | lecture   | oui         |
| Fusionner deux clients                              | non            | non            | non                         | non          | non       | oui         |
| Créer / modifier un véhicule                        | oui            | oui            | km seulement                | oui          | lecture   | oui         |
| Changer le détenteur d'un véhicule                  | oui            | oui            | non                         | non          | non       | oui         |
| Corriger un kilométrage à la baisse                 | non            | oui            | non                         | non          | non       | oui         |
| Créer / déplacer un RDV                             | oui            | oui            | non                         | non          | non       | oui         |
| Forcer une double réservation de ressource          | non            | oui            | non                         | non          | non       | oui         |
| Ouvrir un OR                                        | oui            | oui            | non                         | non          | non       | oui         |
| Ajouter une ligne constatée                         | oui            | oui            | oui                         | oui (pièces) | non       | oui         |
| Valider une ligne dans le plafond                   | oui            | oui            | non                         | non          | non       | oui         |
| Enregistrer une réponse de devis complémentaire     | oui            | oui            | non                         | non          | non       | oui         |
| Modifier le montant plafond                         | oui            | oui            | non                         | non          | non       | oui         |
| Appliquer un rabais                                 | jusqu'à P-13   | jusqu'à P-13   | non                         | non          | non       | sans limite |
| Passer une ligne en payeur `garage` (geste)         | jusqu'à P-13   | jusqu'à P-13   | non                         | non          | non       | sans limite |
| Démarrer / arrêter son propre pointage              | —              | oui            | oui                         | oui          | non       | oui         |
| Corriger le pointage d'un autre                     | non            | oui            | non                         | non          | non       | oui         |
| Verrouiller une période de pointage                 | non            | non            | non                         | non          | oui       | oui         |
| Valider le contrôle qualité                         | non            | oui            | oui (autre que l'exécutant) | non          | non       | oui         |
| Passer l'OR à `terminé`                             | oui            | oui            | non                         | non          | non       | oui         |
| Facturer (étape 2)                                  | oui            | non            | non                         | non          | oui       | oui         |
| Restituer le véhicule                               | oui            | oui            | non                         | non          | non       | oui         |
| Annuler un OR                                       | oui            | oui            | non                         | non          | non       | oui         |
| Lever une rétention                                 | non            | non            | non                         | non          | non       | oui         |
| Voir les indicateurs de productivité par technicien | non            | oui            | ses propres chiffres        | non          | non       | oui         |

> Les rôles sont **cumulables** : dans un garage de 4 personnes, le patron porte réceptionnaire + chef d'atelier +
> direction. La matrice décrit des permissions, pas des personnes.

---

## 11. Cas de test métier

> Format : contexte / action / attendu, avec les règles couvertes. Ces cas sont destinés à `expert-tests` comme
> base de la suite d'intégration ; chacun doit s'exécuter sur une vraie base avec RLS actif.

### Clients et véhicules

- **CT-01** — Doublon client. Contexte : « Dupont Jean, 1004 Lausanne » existe. Action : créer « DUPONT jean, 1004 Lausanne ». Attendu : avertissement de doublon, création **non bloquée**. (RM-05)
- **CT-02** — Fusion. Contexte : deux fiches Dupont avec 1 véhicule et 3 OR chacune. Action : fusionner. Attendu : la cible porte 2 véhicules et 6 OR, la source est inactive avec un renvoi, l'opération est journalisée. (RM-06)
- **CT-03** — Conditions figées. Contexte : client avec 10 % de rabais MO ; OR ouvert le 10.03 ; le rabais passe à 5 % le 15.03. Action : facturer l'OR le 20.03. Attendu : 10 % appliqué. (RM-07, RM-50)
- **CT-04** — Recherche par plaque partielle. Action : rechercher « 123456 ». Attendu : le véhicule « VD 123456 » est trouvé. (RM-112)
- **CT-05** — Plaque réattribuée. Contexte : « VD 123456 » portée par le véhicule A jusqu'au 01.02, puis par B. Action : rechercher la plaque. Attendu : B en résultat courant, A signalé en historique. (RM-17)
- **CT-06** — Plaque en double active. Action : affecter « VD 123456 » (déjà active sur A) au véhicule B. Attendu : refus, sauf si marquée interchangeable. (RM-18)
- **CT-07** — Kilométrage régressif. Contexte : dernier relevé 120 000 km. Action : saisir 95 000. Attendu : refus sans motif ; acceptation avec motif « compteur remplacé », historisation des deux valeurs. (RM-24)
- **CT-08** — Miles. Contexte : véhicule importé du Royaume-Uni, relevés en miles. Action : saisir 60 000 mi après 90 000 km. Attendu : pas de régression détectée après conversion. (RM-23, §6.10)
- **CT-09** — Expertise échue. Contexte : prochaine expertise au 15.06, date du jour 20.06. Action : ouvrir un RDV. Attendu : alerte affichée. (RM-29)
- **CT-10** — Convocation prioritaire. Contexte : périodicité calculée au 01.09 ; convocation cantonale saisie au 30.06. Action : consulter le véhicule. Attendu : prochaine expertise = 30.06, source `convocation`. (RM-28)
- **CT-11** — Isolation tenant. Action : lire un véhicule d'un autre tenant par son identifiant. Attendu : 404. (RM-106, I-13)

### Rendez-vous

- **CT-12** — RDV incomplet. Action : honorer un RDV sans véhicule identifié. Attendu : refus. (RM-35)
- **CT-13** — Alertes au RDV. Contexte : véhicule avec 2 travaux reportés, 1 campagne ouverte et une expertise dans 2 mois. Action : sélectionner le véhicule. Attendu : les trois informations sont retournées par l'API du RDV. (RM-36)
- **CT-14** — Surcharge. Contexte : capacité 24 h/jour, 22 h déjà planifiées. Action : ajouter un RDV de 4 h. Attendu : avertissement de dépassement, création acceptée. (RM-38)
- **CT-15** — Chevauchement de ressource. Action : réserver le même technicien sur deux plages qui se chevauchent. Attendu : refus pour le réceptionnaire, forçage possible et journalisé pour le chef d'atelier. (RM-39)
- **CT-16** — No-show puis retour. Contexte : RDV passé en `absent`. Action : le passer à `honore`. Attendu : refus ; un nouveau RDV doit être créé. (§5.3)
- **CT-17** — Annulation impossible. Contexte : RDV `honore` avec OR ouvert. Action : annuler le RDV. Attendu : refus. (RM-47)

### Ordre de réparation

- **CT-18** — Réception obligatoire. Action : passer un OR `planifie` à `en_cours`. Attendu : refus `or.reception.requise`. (I-07)
- **CT-19** — Km obligatoire. Action : ouvrir un OR sans km d'entrée, paramètre P-10 actif. Attendu : refus. (RM-51)
- **CT-20** — Plafond. Contexte : plafond CHF 300, lignes validées CHF 280. Action : valider une ligne de CHF 90. Attendu : refus, exigence d'un devis complémentaire. (RM-54)
- **CT-21** — Terminer avec une ligne à valider. Attendu : refus, la réponse liste les lignes bloquantes. (RM-60, I-08)
- **CT-22** — Terminer avec un pointage ouvert. Attendu : refus, la réponse liste les techniciens concernés. (RM-60, I-09)
- **CT-23** — Facturer sans terminer. Action : `ouvert` → `facture`. Attendu : refus. (I-01)
- **CT-24** — Rouvrir un OR facturé. Attendu : refus, avec proposition de créer un OR de retouche lié. (I-02)
- **CT-25** — Annuler un OR facturé. Attendu : refus (avoir uniquement). (I-03)
- **CT-26** — Annuler un OR pointé. Contexte : OR `ouvert` avec 1 h pointée. Action : annuler. Attendu : refus. (RM-62, T-20)
- **CT-27** — Suppression de ligne pointée. Attendu : refus ; l'annulation avec motif est acceptée et la ligne reste visible. (RM-71)
- **CT-28** — Ligne refusée exécutée. Action : passer une ligne `refusee` à `realisee`. Attendu : refus. (RM-72)
- **CT-29** — Multi-payeurs. Contexte : OR avec 3 lignes client, 2 lignes constructeur, 1 ligne assurance + franchise. Action : générer la proposition de facturation. Attendu : 3 regroupements, totaux TVA calculés par ligne puis agrégés, la franchise apparaît côté client. (RM-67, RM-68, RM-107)
- **CT-30** — Immutabilité après facturation. Action : modifier le prix d'une ligne d'un OR `facture`. Attendu : refus. (I-15)
- **CT-31** — Journalisation. Action : changer le plafond d'un OR de 300 à 800. Attendu : entrée d'audit avec utilisateur, horodatage, avant/après. (RM-59)

### Devis complémentaire

- **CT-32** — Traçabilité obligatoire. Action : enregistrer une réponse sans nom d'interlocuteur. Attendu : refus. (RM-81)
- **CT-33** — Refus partiel. Contexte : devis de 3 lignes, le client en accepte 2. Action : enregistrer `partiel`. Attendu : 2 lignes `validee`, 1 ligne `refusee`, la ligne refusée apparaît dans les travaux reportés du véhicule. (RM-81, RM-73)
- **CT-34** — Pointage bloqué. Action : démarrer un pointage sur une ligne `a_valider`. Attendu : refus. (RM-93, RM-82)
- **CT-35** — Immuabilité. Action : modifier un devis complémentaire déjà répondu. Attendu : refus. (RM-79)
- **CT-36** — Refus après démontage. Contexte : §6.1, 1,2 h pointées, P-24 = « facturer au-delà d'un seuil ». Action : enregistrer le refus. Attendu : l'OR reste `en_cours`, une ligne de diagnostic/démontage est **proposée** (pas créée en silence), une tâche de suivi apparaît pour la pièce commandée. (RM-84, RM-85, RM-86)

### Pointage

- **CT-37** — Chevauchement interdit. Contexte : P-06 = interdit, pointage ouvert sur l'OR A. Action : démarrer sur l'OR B. Attendu : le pointage A est clôturé automatiquement avec la mention correspondante, une notification est retournée. (RM-89)
- **CT-38** — Chevauchement autorisé. Contexte : P-06 = autorisé, 60 min communes sur A et B. Attendu : 30 min productives imputées à chacun, durée brute conservée. (RM-90)
- **CT-39** — Deux techniciens, un OR. Attendu : accepté, aucune anomalie. (§6.8)
- **CT-40** — Clôture de fin de journée. Contexte : pointage ouvert à 17h00, fermeture 18h00, contrôle exécuté à 23h00. Attendu : pointage clôturé à 18h00, marqué `clôture automatique`, placé en anomalie. (RM-91)
- **CT-41** — Pointage sur OR facturé. Attendu : refus. (RM-92)
- **CT-42** — Correction. Action : un technicien modifie le pointage d'un collègue. Attendu : refus. Le chef d'atelier peut, avec motif, et la valeur d'origine est conservée. (RM-94, §10)
- **CT-43** — Période verrouillée. Action : corriger un pointage de mars après verrouillage de mars. Attendu : refus. (RM-95)
- **CT-44** — Temps facturé ≠ temps pointé. Contexte : ligne barémée 1,2 h, 2,4 h pointées. Attendu : la facturation propose 1,2 h ; l'écart apparaît dans le rendement. (RM-98, RM-99)

### Véhicule de remplacement et cas composés

- **CT-45** — Double prêt. Action : prêter un véhicule déjà `en_cours` sur un autre prêt. Attendu : refus. (RM-103)
- **CT-46** — Report en cascade. Contexte : restitution reportée de 2 jours, véhicule de courtoisie réservé pour un autre client le lendemain. Attendu : alerte au réceptionnaire dès l'enregistrement du report. (RM-104)
- **CT-47** — Vente entre RDV et atelier. Contexte : §6.2. Action : dérouler le changement de détenteur et honorer le RDV. Attendu : nouvelle détention active, ancienne clôturée, OR rattaché au nouveau détenteur avec ses conditions, OR passés inchangés. (RM-20, RM-21, RM-50)
- **CT-48** — Flotte. Contexte : §6.4. Action : le conducteur non signataire tente d'accepter un dépassement de plafond. Attendu : refus, le devis complémentaire est adressé au contact `signataire`. (RM-04, RM-53)
- **CT-49** — PO obligatoire. Action : clôturer un OR d'un client à PO obligatoire sans numéro. Attendu : refus à la clôture, pas à l'ouverture. (RM-14)
- **CT-50** — Véhicule non retiré. Contexte : OR `facture` depuis 25 jours. Attendu : apparition dans la liste d'exceptions, paliers de relance déclenchés, frais de garde **proposés** et non appliqués automatiquement. (§6.5, P-15)
- **CT-51** — Retouche. Contexte : OR-1000 facturé, le client revient avec le même symptôme. Action : créer l'OR de retouche. Attendu : OR-1001 lié à OR-1000, lignes d'origine `retouche`, payeur `garage`, heures comptées dans le taux de retouche, OR-1000 inchangé. (RM-57, §6.11, RM-99)
- **CT-52** — Défaut de sécurité refusé. Contexte : P-28 = obligatoire. Action : restituer sans mention de réserve. Attendu : refus tant que la mention n'est pas générée et signée. (§6.12)

---

## 12. Questions ouvertes à poser au garagiste

> À poser avant l'implémentation, idéalement à trois garages de tailles différentes (indépendant 3 personnes,
> garage 10 personnes, concession multi-marques). Les réponses fixent les défauts des paramètres du §9.

**Réception et engagement**

- **Q-01** — Faites-vous signer un mandat de réparation à chaque réception ? Sur papier, sur tablette, ou pas du tout ? Que se passe-t-il quand le client dépose la clé dans la boîte la veille ?
- **Q-02** — Notez-vous un montant plafond au-delà duquel vous devez rappeler le client ? Quel montant par défaut ? Est-il différent selon les clients ?
- **Q-03** — Quand un client refuse un supplément alors que la voiture est démontée, facturez-vous le démontage et le remontage ? Toujours, jamais, ou selon le montant ?
- **Q-04** — Faites-vous un tour du véhicule avec photos à la réception ? Avez-vous déjà eu un litige sur un dégât préexistant ?

**Planning**

- **Q-05** — Raisonnez-vous en créneaux horaires ou en heures de charge ? Surbookez-vous volontairement ? De combien ?
- **Q-06** — Affectez-vous les RDV à un technicien nommé dès la prise de RDV, ou seulement le matin même ?
- **Q-07** — Combien de rendez-vous non honorés par mois ? Envoyez-vous un rappel ? Par SMS ou par e-mail ?

**OR et facturation**

- **Q-08** — Un même OR peut-il donner lieu à plusieurs factures (client + constructeur + assurance) ? À quelle fréquence ?
- **Q-09** — Comment facturez-vous les petites fournitures : pourcentage de la main-d'œuvre, forfait, ou lignes réelles ? Quel pourcentage et quel plafond ?
- **Q-10** — Combien de taux horaires différents pratiquez-vous, et sur quels critères (type de travail, marque, ancienneté du véhicule, client) ?
- **Q-11** — Le client peut-il repartir avec sa voiture avant d'avoir payé ? Selon quel critère ?
- **Q-12** — Que faites-vous des travaux constatés mais non réalisés ? Les représentez-vous au passage suivant ? Comment aujourd'hui ?

**Pointage**

- **Q-13** — Vos techniciens pointent-ils par OR, par ligne, ou seulement en présence ? Sur quel support (terminal atelier, papier, téléphone) ? Quelle est la principale source d'erreur aujourd'hui ?
- **Q-13b** — Arrive-t-il qu'un technicien travaille sur deux véhicules en même temps ? Faut-il que le système l'accepte ou l'empêche ?

**Juridique et sécurité**

- **Q-14** — Une acceptation de devis par SMS ou par clic sur un lien vous semble-t-elle suffisante en cas de litige ? Qu'exigez-vous aujourd'hui ? _(À croiser avec un avis juridique.)_
- **Q-15** — Avez-vous déjà gardé un véhicule non payé ? Quelle procédure avez-vous suivie ? Facturez-vous des frais de garde, et à partir de quand ?
- **Q-16** — Quand un client refuse une réparation de sécurité, lui faites-vous signer une décharge ? Avez-vous un texte type (UPSA / assurance RC) ?

**Suisse**

- **Q-17** — Comment gérez-vous les échéances d'expertise ? Le client arrive-t-il avec sa convocation ? Faites-vous des pré-expertises ? Présentez-vous les véhicules vous-même ? Les périodicités que vous constatez correspondent-elles à 5 / 3 / 2 ans ?
- **Q-18** — Comment traitez-vous les taxes de recyclage (pneus, batteries, huiles) sur la facture, et sont-elles soumises à TVA ? _(À croiser avec la fiduciaire.)_
- **Q-19** — Faites-vous du dépôt de pneus ? Combien de jeux stockés ? Comment retrouvez-vous l'emplacement d'un jeu ? Est-ce facturé annuellement ? _(Détermine si le module doit remonter dans la feuille de route.)_
- **Q-20** — Combien de véhicules importés dans votre clientèle ? Avez-vous des problèmes de garantie ou de campagnes de rappel avec eux ?

**Organisation**

- **Q-21** — Qui, chez vous, fait la réception ? Est-ce la même personne que le chef d'atelier ? Une même personne cumule-t-elle plusieurs rôles ?
- **Q-22** — Faites-vous un contrôle qualité systématique avant restitution ? Avec une check-list ? Qui le fait ?
- **Q-23** — Combien de retouches (le client revient pour le même problème) par mois ? Suivez-vous ce chiffre ?
- **Q-24** — Avez-vous des clients entreprises avec facturation centralisée, numéro de commande obligatoire, ou accord préalable d'un gestionnaire de flotte ? Combien ?
- **Q-25** — Quels chiffres regardez-vous chaque mois pour piloter l'atelier ? (Si la réponse est « aucun », c'est une opportunité produit majeure.)

---

## Annexe — Points d'attention architecturale

**Backend et schéma**

- L'état `attente_*` de l'OR est **dérivé** des drapeaux portés par les lignes, pas saisi (§5.1, T-21). Décider tôt : colonne calculée ou état matérialisé recalculé à chaque transition.
- Les valeurs **figées** (taux horaire, prix, conditions, adresse, plaque, détenteur) sont copiées sur l'OR et ses lignes à la création. C'est de la dénormalisation volontaire et non négociable (RM-50, RM-65).
- Le pointage a besoin d'un **verrou par technicien** pour garantir RM-88 sous concurrence (deux terminaux atelier).
- Les travaux reportés sont une **projection** de lignes refusées/reportées vers le véhicule : décider s'ils sont matérialisés (recommandé, ils sont éditables et « éteignables ») ou calculés.
- Prévoir dès l'étape 1 les champs `article_id` (étape 3) et `facture_id` (étape 2) nullables, pour éviter une migration destructive.

**Frontend et ergonomie**

- Trois écrans portent 90 % de l'usage : le **planning du jour**, la **fiche OR**, l'**écran atelier du technicien** (grand tactile, gants, pointage en un geste).
- La recherche par plaque est le point d'entrée n°1 : elle doit être présente sur tous les écrans, tolérante et instantanée.
- La réception du matin est un rush : la saisie doit être possible dans le désordre, sans champ obligatoire bloquant hors km et véhicule.
- L'écran OR doit répondre en un coup d'œil à : où est le véhicule, qui travaille dessus, combien ça fait aujourd'hui, qu'est-ce qui attend un accord, quand doit-il partir.
- Les listes d'exceptions (attente d'accord, attente de pièces, véhicules non retirés, pointages anormaux) sont le tableau de bord réel du chef d'atelier.

**Pour expert-tests**

- Priorité absolue aux transitions **interdites** (§5, tableaux I-xx) et aux règles de figement de valeurs.
- Chaque paramètre du §9 exige un test dans les deux configurations.
- Aucun `toBeCloseTo` sur les montants ; tous les calculs en centimes entiers.
