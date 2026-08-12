# Prise de rendez-vous d'atelier — écrans et parcours

Périmètre : écrans et parcours uniquement. Métier détaillé et modèle de données : agents dédiés, arbitrage par @laupernoe en synthèse. Ce document assume l'existence d'un rendez-vous comme objet distinct de l'OR (voir « Point d'arbitrage » en fin de document) mais décrit des gestes qui restent valables si l'arbitrage choisit une autre implémentation.

## Le test

Un réceptionniste, téléphone à l'oreille : « vous pouvez me prendre jeudi ? » Il doit répondre en dix secondes, sans changer d'écran, sans deviner. Chaque décision ci-dessous est jugée contre ce test.

## Ce qu'on ne reproduit pas

Le test d'utilisabilité sur l'existant a établi cinq défauts. Chaque écran ci-dessous porte la contre-mesure en face :

| Défaut observé                                  | Contre-mesure                                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un bouton peut ne rien faire, ou mentir         | Toute action change un état visible et daté. Aucune action « décorative ».                                                                                     |
| Un enregistrement ne dit pas ce qui s'est passé | Absence client, retard, report, annulation : chacun un état nommé, horodaté, avec l'auteur, jamais une carte qui disparaît.                                    |
| Boutons dont la réversibilité est inconnue      | Toute action qui n'est pas réversible le dit avant confirmation, dans le dialogue de confirmation lui-même — pas dans une doc à part.                          |
| Jargon informatique (OR, PO, imputation, ligne) | Vocabulaire ci-dessous, appliqué sans exception. « Rendez-vous », jamais « créneau système » ; « véhicule arrivé », jamais « transition ».                     |
| Deux tableaux de bord qui se contredisent       | Une seule source de la capacité du jour : l'agenda lui-même. Aucun chiffre de RDV ne doit être dupliqué dans une carte de tableau de bord (voir Priorisation). |

## Vocabulaire

| Terme UI                         | Ne jamais dire                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Rendez-vous                      | RDV en libellé visible (abréviation tolérée seulement dans un espace très contraint, jamais comme seul libellé) |
| Le véhicule est arrivé           | Réceptionner, check-in                                                                                          |
| Client absent                    | No-show                                                                                                         |
| Reporter le rendez-vous          | Déplacer, replanifier                                                                                           |
| Annuler le rendez-vous           | Supprimer                                                                                                       |
| Restitution promise              | Date de livraison, deadline                                                                                     |
| Capacité du jour / places libres | Slots, disponibilité système                                                                                    |
| Motif du rendez-vous             | Description, ticket                                                                                             |

MFK, VN/VO, expertise : vocabulaire garagiste, conservés tels quels.

## Vue par défaut : la semaine, pour le réceptionniste

L'agenda de prise de rendez-vous sert d'abord le réceptionniste au téléphone — c'est le geste qui donne son nom à l'écran. Le chef d'atelier a déjà son outil pour la journée en cours : la liste des OR du jour et son tableau de bord (`TableauBordChefAtelier`, `EcranListeOrdresReparation`), tous deux livrés. Dupliquer une vue jour optimisée pour l'atelier dans l'écran de prise de RDV produirait un écran qui sert mal les deux publics — exactement l'écueil à éviter.

Décision : **vue Semaine par défaut**, aujourd'hui visuellement distingué (bordure, pas seulement une teinte de fond). Bascule Jour/Semaine en un clic, position mémorisée par utilisateur (pas par session) — un réceptionniste qui bascule sur Jour pour préparer l'accueil du matin la retrouve le lendemain. Le chef d'atelier qui ouvre cet écran (cas secondaire : vérifier ce qui est prévu avant d'organiser les postes) bascule sur Jour lui-même ; l'écran ne devine pas son rôle pour changer de vue automatiquement — un agenda qui change de forme selon qui regarde est un agenda qu'on ne peut plus prévoir, contraire à « pas de mensonge silencieux ».

## Écran 1 — Agenda des rendez-vous

Desktop d'abord (poste de comptoir/réception, souvent au téléphone en même temps) — pas de variante tablette prioritaire pour cet écran, à la différence du pointage.

**Ce qu'il montre**

- En-tête : fil d'Ariane, titre « Rendez-vous », sélecteur de site déjà existant dans l'en-tête global (pas de sélecteur local dupliqué). Un agenda reste toujours scopé à **un seul site** — jamais « tous les sites » agrégés : une capacité d'atelier n'a de sens que rapportée à un atelier précis. Si aucun site n'est sélectionné dans l'en-tête, l'écran affiche l'état « Choisissez un site » (voir États) plutôt que de deviner.
- Barre d'outils : bascule Jour/Semaine, navigation précédent/suivant/aujourd'hui, recherche (client, véhicule, plaque — même moteur que la recherche globale), action primaire **Nouveau rendez-vous**.
- Vue Semaine : sept colonnes (lun–dim, dimanche visuellement réduit si le garage est fermé — donnée de paramétrage, pas devinée), chaque colonne = un jour avec :
  - un en-tête de jour : date complète, jamais seulement un chiffre isolé (lecteur d'écran) ;
  - un **résumé de capacité** explicite : `5/8 rendez-vous` (nombre réservé sur nombre configuré), avec un mot et une icône, jamais la couleur seule (famille `BadgeStatut`, comme `BadgeStatutOr`) :
    - **Disponible** (icône cercle coché, teinte succès) ;
    - **Presque complet** (icône triangle, teinte attention) — dernier(s) créneau(x) ;
    - **Complet** (icône cercle plein, teinte danger) — aucun créneau cliquable ce jour, seule l'option « ajouter en dépassement » reste accessible, avec un avertissement explicite (jamais un blocage silencieux) ;
    - **Capacité non définie** (icône point d'interrogation, teinte neutre) — le site n'a pas de capacité configurée en paramétrage : l'écran affiche alors uniquement le compte brut de rendez-vous (`5 rendez-vous`), sans mot « disponible »/« complet », et un lien « Configurer la capacité ». Un chiffre sans dénominateur ne doit jamais prétendre dire s'il reste de la place — c'est exactement l'erreur qui rendrait l'écran pire que son absence.
  - les rendez-vous du jour, empilés par heure, chacun une carte compacte : heure, client, véhicule (plaque), motif court, badge de statut (voir Écran 3).
- Vue Jour : mêmes cartes, alignées sur une grille horaire (créneaux de l'amplitude d'ouverture du site), plus de place par carte (motif complet, durée visible).
- Vue Liste (bascule optionnelle, voir Accessibilité) : mêmes rendez-vous, `TableComptoir` (composant déjà utilisé par `EcranListeOrdresReparation`), une ligne par rendez-vous, triable, filtrable par statut — chemin de secours pour clavier et lecteur d'écran, jamais un mode dégradé en fonctionnalités.

**Gestes offerts**

- Cliquer un jour complet → bascule vue Jour sur ce jour.
- Cliquer un créneau libre → ouvre Écran 2 (Nouveau rendez-vous), date/heure préremplies.
- Cliquer une carte de rendez-vous → ouvre Écran 3 (Détail).
- Bouton primaire **Nouveau rendez-vous** → Écran 2, sans préremplissage de date (à saisir).
- Recherche → filtre les cartes affichées sur le client/véhicule trouvé, sans changer de vue.

**États**

- _Chargement_ : squelettes de sept colonnes (motif déjà utilisé par `CalendrierEcheances`).
- _Vide_ (site ouvert, aucun rendez-vous sur la période) : message « Aucun rendez-vous prévu cette semaine » + action Nouveau rendez-vous — jamais confondu avec « Complet » ni avec « Capacité non définie », trois messages, trois rendus.
- _Aucun site sélectionné_ : message dédié « Choisissez un site pour voir son agenda », aucune tentative de deviner un site par défaut.
- _Erreur réseau/serveur_ : `EtatErreur` standard avec réessayer.

## Écran 2 — Nouveau rendez-vous (dialogue)

Trois points d'entrée, un seul dialogue :

1. Depuis l'agenda (créneau cliqué ou bouton Nouveau rendez-vous) — client/véhicule à choisir.
2. Depuis la fiche client — client prérempli, véhicule à choisir parmi les siens (ou à saisir si nouveau).
3. Depuis la fiche véhicule — client **et** véhicule préremplis, non modifiables sans passer par « Changer de véhicule » explicite.

Sur les points d'entrée 2 et 3, le client ou le véhicule déjà affiché à l'écran n'est **jamais** rechoisi dans un sélecteur générique — ils apparaissent en lecture (même composant `IdentiteClient`/`IdentiteVehicule` que partout ailleurs), avec un lien « Changer » pour le cas rare où ce n'est pas le bon. Répond directement au reproche du testeur (rechoisir un véhicule déjà sous les yeux).

**Champs**

| Champ                | Obligatoire       | Remarque                                                                                                                             |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Client               | Oui               | Recherche si absent du contexte (réutilise le moteur de recherche global)                                                            |
| Véhicule             | Oui               | Liste des véhicules du client (réutilise le patron de `SelecteurVehiculeOrdre`) + option « Nouveau véhicule »                        |
| Site                 | Oui               | Prérempli au site courant de l'en-tête                                                                                               |
| Date du rendez-vous  | Oui               | Calendrier + saisie ; créneaux complets non sélectionnables sans confirmation explicite de dépassement                               |
| Heure                | Oui               | Créneaux du site, pas de saisie libre en minutes arbitraires                                                                         |
| Durée estimée        | Oui               | Options courtes du métier (ex. 30 min / 1 h / demi-journée / journée) — sert au calcul de capacité, jamais un champ numérique brut   |
| Motif du rendez-vous | Oui               | Texte libre court, ce que dit le client au téléphone — jamais un code                                                                |
| Restitution promise  | Non à cette étape | Raccourcis « même jour », « lendemain », « à définir », ou date précise — obligatoire au plus tard à l'arrivée du véhicule (Écran 3) |
| Remarque             | Non               | Texte libre                                                                                                                          |

**Geste** : un seul bouton primaire **Confirmer le rendez-vous**. Aucun brouillon silencieux — soit le rendez-vous est confirmé, soit le dialogue se ferme sans rien créer (bouton Annuler, sans confirmation supplémentaire : rien n'a encore été engagé).

**États** : erreurs de validation inline sous chaque champ (jamais un résumé générique en haut de formulaire qui oblige à deviner quel champ est fautif) ; conflit de capacité (créneau devenu complet pendant la saisie) signalé avant tout envoi, jamais après un message de succès trompeur.

## Écran 3 — Détail d'un rendez-vous (panneau ou dialogue selon la densité retenue par expert-react)

**Ce qu'il montre** : client, véhicule, site, date/heure, motif, durée, restitution promise, remarque, badge de statut, historique bref (qui a créé/modifié/annulé, quand — même doctrine d'audit que le reste du produit).

**Statuts** (famille `BadgeStatutRendezVous`, même patron que `BadgeStatutOr` — icône + mot + teinte, jamais la couleur seule) :

| Statut        | Icône/forme        | Sens                                                                      |
| ------------- | ------------------ | ------------------------------------------------------------------------- |
| Confirmé      | contour, neutre    | Prévu, rien d'anormal                                                     |
| Arrivé        | plein, succès      | Le véhicule est là ; converti en ordre de réparation                      |
| Client absent | plein, danger      | L'heure est passée sans arrivée, signalé explicitement                    |
| Reporté       | contour, attention | Déplacé à une autre date, l'ancienne date reste visible dans l'historique |
| Annulé        | contour, danger    | Jamais « supprimé » — reste consultable dans l'historique du client       |

**Gestes, un seul bouton primaire selon le moment** :

- _Avant le jour J_ : primaire = aucun (le rendez-vous est simplement confirmé) ; secondaires **Modifier**, **Reporter**, **Annuler le rendez-vous**.
- _Le jour J, à l'heure prévue ou après_ : primaire = **Le véhicule est arrivé** → ouvre la réception (réutilise le dialogue de réception déjà construit sur l'OR : kilométrage d'entrée, signature différée). Secondaire, seulement passé un délai de grâce configuré (jamais avant l'heure) : **Signaler l'absence du client**.
- _Statut Client absent_ : primaire redevient **Le véhicule est arrivé** (un client en retard n'est pas définitivement perdu) ; secondaire **Reporter**.
- _Statut Arrivé_ : plus d'action ici, lien direct vers l'ordre de réparation créé.
- _Statut Annulé_ : lecture seule, bandeau explicite (même motif que `BandeauLectureSeule`), pas de bouton d'action.

**Réversibilité, dite au bon endroit** : le dialogue de confirmation d'annulation affiche explicitement « Cette action est définitive : le rendez-vous n'apparaîtra plus dans l'agenda, mais reste visible dans l'historique du client » et exige un motif (même patron que l'action Annuler d'un OR). Le report n'est jamais silencieux : le dialogue affiche l'ancienne date barrée et la nouvelle, côte à côte, avant confirmation.

## Le lien avec l'ordre de réparation

Un seul geste, un seul écran de départ : le bouton **Le véhicule est arrivé** sur l'Écran 3. Il ouvre la réception avec tout ce que le rendez-vous connaît déjà prérempli (client, véhicule, motif transformé en première ligne constatée, restitution promise reprise si déjà saisie sinon demandée à cet instant). Le réceptionniste ne ressaisit rien de ce qu'il a déjà dit au téléphone. Après réception, le rendez-vous passe en Arrivé et n'apparaît plus comme actionnable dans l'agenda — l'OR devient la seule source de vérité pour la suite (statuts déjà livrés : ouvert, en cours, contrôle, etc.).

## Parcours pas à pas

**Réceptionniste, appel entrant « jeudi, vous pouvez me prendre ? »**

1. Ouvre l'agenda (vue Semaine par défaut) → regarde la colonne jeudi → lit `5/8, Disponible` en moins de deux secondes.
2. Clique un créneau libre jeudi → Écran 2 prérempli date/heure.
3. Cherche le client (ou vient déjà de sa fiche s'il a appelé depuis un dossier ouvert) → véhicule déjà connu apparaît, pas de ressaisie.
4. Saisit motif (« bruit au freinage »), confirme la durée proposée, laisse restitution promise sur « à définir ».
5. Confirme le rendez-vous → raccroche.

**Chef d'atelier, préparation du matin**

1. Ouvre l'agenda, bascule vue Jour (préférence mémorisée depuis la veille).
2. Voit les rendez-vous du jour avec motif et durée — organise les postes en conséquence (hors de cet écran, dans son tableau de bord/planning atelier).
3. À l'arrivée effective d'un véhicule qu'il constate lui-même (rare, généralement le réceptionniste), peut cliquer **Le véhicule est arrivé** avec les mêmes droits que sur l'OR.

**Technicien**

- Pas d'accès à la prise de rendez-vous (hors périmètre de son rôle, comme il n'a pas `atelier.or.creer` aujourd'hui). Voit, au mieux, la conséquence : l'OR créé après arrivée, dans ses écrans habituels (pointage, fiche OR). Aucun écran de cette conception ne lui est destiné directement.

## Accessibilité

- Grille Semaine : navigation clavier par flèches entre jours, `Entrée`/`Espace` ouvre le créneau ou la carte sous le focus, `Tab` unique pour entrer/sortir de la grille (roving tabindex) — pas une grille où chaque cellule vole un `Tab`.
- Chaque cellule de jour porte un `aria-label` complet : « jeudi 14 août, 5 rendez-vous sur 8, disponible » — jamais seulement le chiffre.
- Vue Liste : alternative de plein droit, pas un mode dégradé — même actions, même données, `TableComptoir` déjà conforme clavier/lecteur d'écran.
- Statut jamais porté par la seule couleur : icône + mot systématiques (voir tableau des statuts).
- Cibles tactiles ≥ 44px sur les créneaux et cartes, y compris en vue Semaine dense — si la densité l'interdit à l'échelle réelle, la carte reste cliquable dans son intégralité (pas seulement un petit bouton interne).
- Focus visible sur toutes les cellules, créneaux, cartes et boutons — aucune surcharge de l'anneau de focus par défaut du design system.
- Primitive manquante à date : pas de composant `Calendar`/grille dans `components/ui/` — à ajouter (shadcn) avant implémentation, distinct de `date-input.tsx` qui couvre la saisie ponctuelle, pas la grille.

## Priorisation

**Premier** (rend le test des dix secondes possible) :

- Écran 1 en vue Semaine + Jour, capacité explicite (y compris l'état « non définie »).
- Écran 2 complet, trois points d'entrée.
- Écran 3 : statuts Confirmé / Arrivé / Client absent / Annulé, et le geste Le véhicule est arrivé.
- Vue Liste (accessibilité — non négociable, pas une itération 2).

**Peut attendre** :

- Report (Écran 3, statut Reporté) — un contournement manuel (annuler + recréer, avec le motif qui dit pourquoi) reste correct le temps de livrer le vrai geste.
- Dépassement de capacité avec avertissement raffiné — au lancement, un dépassement peut rester une simple confirmation texte plutôt qu'un visuel dédié.
- Rappel automatique / confirmation SMS au client — hors écrans, sujet notifications.
- Vue mensuelle — la Semaine suffit à la décision téléphonique ; un mois n'aide personne à répondre en dix secondes.

## Point d'arbitrage pour @laupernoe

Cette conception présuppose un rendez-vous comme objet propre (avec ses statuts Confirmé/Arrivé/Absent/Reporté/Annulé), converti en OR à l'arrivée. Le dépôt contient déjà un signal fort en ce sens : le statut `planifie` existe sur l'ordre de réparation lui-même (`STATUTS_INITIAUX_ORDRE_REPARATION`, transition `planifie → ouvert` déjà câblée sur l'action **Réceptionner**), gated par un paramètre `etatPlanifieActif` (P-22) actuellement non exposé en écran. Selon ce que tranchent expert-métier et expert-database, deux implémentations sont possibles sans changer les écrans décrits ici :

- (a) un rendez-vous = un OR créé directement en statut `planifie`, l'Écran 3 devenant une vue spécialisée de la fiche OR existante ;
- (b) un rendez-vous = un objet distinct qui _génère_ un OR à l'arrivée.

Je n'ai pas tranché — les deux tiennent la route côté écrans, la différence est dans ce que porte la base et le contrôleur. À arbitrer en synthèse : si (a) est retenu, l'Écran 3 peut réutiliser une part importante de `EnTeteOrdreReparation`/`PanneauActionsOr` déjà livrés plutôt que d'être construit de zéro.

Second point : la case `CalendrierEcheances` actuelle du tableau de bord réceptionnaire affiche aujourd'hui les OR par date de restitution promise, avec un commentaire explicite du code disant qu'elle n'est PAS un agenda de rendez-vous. Une fois cet écran livré, ce widget de tableau de bord doit soit disparaître (remplacé par un lien direct vers l'agenda), soit être clairement distingué — deux widgets qui parlent de dates de véhicules sur le même tableau de bord recréeraient le grief « deux tableaux de bord qui se contredisent ».
