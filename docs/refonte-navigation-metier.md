$=^
Document de conception, rédigé depuis le métier et non depuis l'arborescence du dépôt.

1. La journée réelle

---

Garage suisse type de nos clients : 3 à 9 personnes, un site (parfois deux), 8 à 20 véhicules qui
passent par jour. Qui fait quoi, dans l'ordre, et à quelle fréquence.

**Le réceptionniste — 7 h par jour dans le logiciel, sans exagération**

C'est lui l'utilisateur principal. Il est debout, le téléphone sonne, un client attend au comptoir.

- **07h15** — ouvre l'écran du jour : qui vient, quels OR sont en cours, quel véhicule sort ce soir.
  Une fois, mais rechargé dix fois dans la journée.
- **07h30-09h** — reçoit les clients du matin : plaque → véhicule → OR ouvert → signature → clés
  (**6 à 12×**).
- **Toute la journée** — « une dame au téléphone, une Golf, elle ne sait plus quand elle a fait le
  service » : cherche par plaque ou par nom, ouvre l'historique (**15 à 30×**). Et le client sans
  rendez-vous, « ça fait un bruit » : crée le client s'il n'existe pas, crée le véhicule, ouvre
  l'OR (**2 à 5×**).
- **10h-16h** — rappelle un client pour un devis complémentaire (« on a trouvé les plaquettes à
  2 mm ») : ouvre l'OR, ajoute les lignes, appelle, note l'accord (**3 à 8×**).
- **11h et 16h30** — le mécanicien pose un OR terminé sur le comptoir : contrôle, facture, encaisse
  (carte / Twint / espèces), imprime la QR-facture, rend les clés (**6 à 12×**).
- **En continu** — vérifie si une pièce est là et la commande sinon (**5 à 15×**) ; prend un
  rendez-vous et réserve un véhicule de remplacement (**5 à 10×**).

Ce qu'il ne fait **jamais** : ouvrir le paramétrage, consulter un référentiel de tarifs pour lui-même,
regarder les fournisseurs, faire une clôture de période.

**Le mécanicien / technicien — 30 minutes par jour, en tout**

Il a les mains sales. Il touche le logiciel **debout, à une borne murale ou à un poste partagé**,
et il déteste ça.

- Pointe le début d'un travail (arrivée, OR n°, position) : **4 à 8× par jour**.
- Lit l'OR : ce qu'il y a à faire, l'historique du véhicule, le kilométrage annoncé : **1× par OR**.
- Signale une trouvaille (« il faut aussi les disques ») : **1 à 3× par jour**.
- Marque une ligne réalisée : **8 à 15× par jour**.
- Prend une pièce au magasin : **5 à 10×** — et dans la moitié des garages, il ne le saisit pas
  lui-même.

Il ne veut voir que **deux choses** : sa liste de travaux et le chronomètre. Tout le reste est du bruit
qu'il traversera en soupirant.

**Les autres, beaucoup plus vite**

**Le chef d'atelier — 1 h par jour, par à-coups.** Le matin, il répartit les OR sur ses gens : le
geste le plus important du garage. Ensuite en continu : « où en est la 306 ? », « qui est libre à
14h ? », sous-traiter, commander, rappeler un client. Une fois par semaine, le temps vendu contre le
temps pointé ; une fois par mois, la clôture de période.

**Le magasinier — n'existe que dans les garages de 8 personnes et plus.** Quand il existe : réception
des livraisons (2× par jour), sortie de pièces sur OR, vente comptoir, retours fournisseur,
inventaire tournant. Quand il n'existe pas — **la majorité des cas** — c'est le réceptionniste ou le
chef d'atelier qui fait tout ça entre deux clients, sans en faire un métier.

**Le vendeur VN/VO — mi-temps, souvent le patron lui-même.** Constitue un dossier de vente (2 à 8 par
**mois**), estime une reprise, vérifie une dette de leasing résiduelle, suit les livraisons et les
échéances de garantie. Rythme hebdomadaire : aucune raison d'occuper autant de place que l'atelier.

**Le patron — 20 minutes le matin, deux heures le vendredi soir.** Le matin, le chiffre d'hier et ce
qui coince ; le vendredi soir, les impayés, les relances, l'export pour la fiduciaire, les marges.

**La borne d'atelier.** Un compte de service sur un écran mural : elle doit afficher **une seule
chose** et n'a rien à faire avec un menu latéral. Déjà le cas dans le produit, et c'est bien vu.

2. Les cinq gestes qui font 80 % du temps

---

1. **Retrouver un véhicule ou un client** à partir d'une plaque, d'un nom, d'un numéro de téléphone
   ou d'un châssis — puis voir tout son passé d'un coup d'œil.
2. **Ouvrir un OR** pour un véhicule connu (rendez-vous ou passage), y compris pour un client qui
   n'existe pas encore dans le fichier.
3. **Faire vivre un OR ouvert** : ajouter une ligne, changer une quantité, réserver une pièce, noter
   l'accord du client sur un complément, marquer réalisé.
4. **Facturer et encaisser** l'OR terminé, puis rendre les clés.
5. **Savoir où en est la journée** : ce qui est au four, ce qui sort ce soir, ce qui attend une pièce.

Cinq gestes. Le logiciel doit être organisé autour d'eux, et tout le reste doit se ranger
**derrière**, sans jamais leur voler un pixel.

3. Confrontation avec les 30 entrées actuelles

---

Fréquence d'ouverture réelle, dans un garage de 5 personnes, par la personne concernée :

- **Plusieurs fois par heure** — Recherche (20-30×/jour), Ordres de réparation (15×), Clients (10×),
  Factures (10×), Recherche comptoir pièces (10×), Pointage saisie (6×, technicien).
- **Une à cinq fois par jour** — Véhicules (mais presque toujours atteint via un client ou la
  recherche), Articles, Réservations, Commandes fournisseur (si magasinier), Journal et Équipe de
  pointage, Tableau de bord (patron uniquement).
- **Une fois par semaine ou par mois** — Relances, Réapprovisionnement, Dossiers et Stock de ventes,
  Suivi financement, Référentiels, Fournisseurs, Consignes, Clôture de période.
- **Deux à quatre fois par an, ou jamais** — Accueil (on la subit à la connexion, on ne l'ouvre pas),
  Doublons clients, Paramétrage pièces, et les quatre écrans du groupe Paramétrage.
- **Cas à part, saisonnier** — Hangar à pneus : 20×/jour en mars et en octobre, zéro les huit autres
  mois. Jeux à relancer : deux fois par saison.

Bilan : sur 30 entrées, **11 sont ouvertes moins d'une fois par mois** et occupent pourtant la même
largeur, la même hauteur et la même dignité visuelle qu'un écran ouvert quinze fois par jour. Cinq ne
sont jamais ouvertes par personne d'autre que celui qui a installé le logiciel. Un menu n'est pas une
table des matières du logiciel : c'est une **carte des endroits où on retourne**.

4. L'organisation que je propose

---

**Le principe qui commande tout**

**Un menu n'est pas masqué par rôle — il est construit par rôle.** Aujourd'hui, une liste unique de
30 entrées dont on cache des morceaux selon qui regarde : personne ne voit un menu conçu pour lui,
chacun voit les restes d'un menu conçu pour tout le monde. Je propose trois **postes de travail**,
chacun avec sa propre barre.

**Poste « comptoir » — réceptionniste, chef d'atelier, direction, admin**

Six entrées. Pas sept.

```
  Aujourd'hui         ← ce qui se passe maintenant : le jour, l'atelier, les alertes
  Atelier             ← les OR, le planning, le pointage
  Clients             ← clients, véhicules, historique
  Magasin             ← pièces + dépôt pneus (voir §4.3)
  Facturation         ← factures, encaissements, relances, export fiduciaire
  Ventes              ← VN/VO, stock, dossiers        (masqué si le garage ne vend pas)
  ───────────────
  ⚙ Réglages          ← en pied de colonne, discret, gris
```

Pourquoi six : ce n'est pas un chiffre magique, c'est le nombre d'entrées qui tient **sans défilement
sur un écran de comptoir 1366×768**, et celui au-delà duquel on cesse de lire une liste pour se
mettre à la fouiller. Passé huit lignes l'œil balaye ; à quinze il abandonne et on tape l'adresse à
la main — ce que faisait déjà l'équipe pour les ordres de réparation avant qu'on remarque l'oubli.
Chaque entrée correspond à **un moment de la journée**, pas à un module du code : « Aujourd'hui »
c'est le matin, « Atelier » la journée, « Facturation » le soir, « Réglages » une fois par an.

**Poste « atelier » — technicien, sur poste partagé ou tablette**

```
  Mon travail         ← chronomètre, mes OR, mes lignes
  Atelier             ← le tableau de tous les OR
  Magasin             ← chercher une pièce, sa disponibilité
```

Trois entrées. Il n'a rien à faire dans les clients, les factures ou les ventes, et lui montrer une
liste grise de choses interdites est une insulte quotidienne.

**Poste « borne »** (compte `poste_atelier`) : aucun menu, plein écran, gros boutons, pavé numérique.
Déjà le cas — **ne pas y toucher**.

**4.3 « Stock » : d'accord sur le regroupement, pas sur le mot**

@laupernoe propose de regrouper Pièces et Pneus sous « Stock ». **Le regroupement, oui. Le mot, non.**

Ce n'est pas une chicane de vocabulaire. Un jeu de pneus au dépôt **appartient au client** : pas de
prix d'achat, pas de valeur d'inventaire, pas de fournisseur, aucun calcul de marge — et le jour où
le garage ferme, ces pneus se rendent, ils ne se liquident pas. Juridiquement c'est un **dépôt** : le
garage en a la garde, pas la propriété. Un mot faux dans un menu finit toujours par produire une
erreur de gestion ; quelqu'un les comptera un jour dans une valeur d'inventaire.

Le regroupement, lui, est juste : pour celui qui travaille, les deux répondent à la même question —
**« où est la chose physique dans mon bâtiment ? »**. C'est le même homme qui va au même endroit
chercher un filtre ou un jeu de pneus ; les séparer en deux entrées ne reflète aucune réalité.

**Ma proposition : « Magasin ».** Le mot que le garagiste emploie déjà (« va voir au magasin »), il
désigne le lieu et non la propriété, et accueille honnêtement les deux : ce qui m'appartient et ce
que je garde pour autrui. En allemand « Lager », en italien « Magazzino ». Deux onglets à
l'intérieur : **Pièces** et **Dépôt pneus** — et dans ce dernier, la colonne « propriétaire » est la
première, pas la dernière.

**Réserve importante.** Le dépôt pneus a un second point d'entrée, et c'est même le principal :
**la fiche du véhicule**. On n'ouvre pas « le hangar » pour chercher un jeu ; le client arrive, on
ouvre son véhicule, et on doit lire là _« jeu hiver au dépôt, emplacement C-14, posé le
12.11.2025 »_. Le menu Magasin sert au magasinier qui range ; la fiche véhicule sert au
réceptionniste qui reçoit — et il y a dix fois plus de réceptionnistes que de magasiniers.

**4.4 Ce qui descend d'un niveau**

- **Véhicules** → onglet de **Clients**, plus la recherche globale, plus la fiche client.
- **Relances** → onglet de **Facturation**. **Tableau de bord** → fusionné dans **Aujourd'hui**.
- **Pointage** (4 entrées) → onglets d'**Atelier** (journal, équipe) + « Mon travail » côté technicien.
- **Pièces** (7 entrées) → **Magasin** › Pièces, Réservations et Réappro devenant des filtres de la
  même liste. **Pneus** (2 entrées) → **Magasin** › Dépôt pneus.
- **Ventes stock et suivi** → onglets de **Ventes**.

**4.5 Ce qui sort complètement du menu**

- **Doublons clients** — ne se cherche jamais « en général ». Un bouton secondaire dans l'écran
  Clients, et surtout un **bandeau contextuel sur la fiche client** quand un homonyme probable existe
  (« un client au même NPA porte un nom proche — comparer ? »). C'est au moment où on tombe dessus
  que la fusion se décide.
- **Fournisseurs** et **Consignes** — deux onglets du Magasin. Un fournisseur se consulte depuis une
  commande, jamais dans l'absolu.
- **Référentiels (tarifs et prestations)** — je conteste l'argument inscrit dans le code selon lequel
  ce serait « un outil de comptoir ». Un réceptionniste ne consulte pas un tarif horaire : il ajoute
  une prestation sur un OR et le prix vient tout seul. S'il doit voir un prix, c'est **dans le
  sélecteur de prestation de l'OR**. Le référentiel est un écran de réglage ouvert une fois par mois
  par le chef d'atelier → **Réglages**.
- **Clôture de période de pointage** — geste mensuel : un bouton en haut du journal.
- **Suivi financement & garantie** et **Jeux de pneus à relancer** — ce ne sont pas des écrans mais
  des **listes de choses à faire aujourd'hui**, à mettre en blocs actionnables dans « Aujourd'hui »
  (« 4 garanties à échéance ce mois », « 23 jeux d'hiver à relancer ») qui ouvrent la liste complète
  au clic. Un menu ne devrait jamais héberger une file d'attente.
- **Tout le paramétrage** — quatre entrées ouvertes deux fois par an, derrière une seule porte
  « Réglages » en pied de colonne, en gris.

5. Le point vraiment important : les chemins, pas les menus

---

**Le diagnostic, mesuré et non supposé**

J'ai regardé ce que les écrans savent faire aujourd'hui. Le résultat explique tout le reste :

- **Fiche OR** (`EcranFicheOrdreReparation.tsx`) : aucun lien sortant. L'en-tête affiche l'identité
  du client et du véhicule, mais rien n'y est cliquable.
- **Fiche véhicule** (`EcranFicheVehicule.tsx`) : aucun lien sortant. Depuis un véhicule, on
  n'atteint **ni son propriétaire, ni ses OR, ni ses factures, ni ses pneus au dépôt**.
- **Fiche article** (`EcranFicheArticle.tsx`) : aucun lien sortant vers un OR ou une commande.
- Seules `EcranFicheFacture.tsx` (sept liens) et `EcranFicheClient.tsx` (trois) sont réellement
  câblées.

**Voilà la cause du menu à trente entrées** : on met dans le menu ce qu'on ne peut atteindre
autrement. Chaque lien manquant dans un écran devient une ligne de plus dans la barre latérale.
Réduire le menu sans réparer les chemins ne ferait qu'enfermer les gens.

**Les enchaînements que l'application doit offrir**

Le fil de tous les jours, à parcourir dans les deux sens sans jamais repasser par le menu :

```
plaque ─→ VÉHICULE ─→ CLIENT ─→ ses autres véhicules
             │
             ├─→ historique des OR ─→ OR ─→ FACTURE ─→ encaissement
             ├─→ jeu de pneus au dépôt
             ├─→ échéances (MFK, prochain service, garantie)
             └─→ travaux reportés ─→ « ouvrir un OR avec ces lignes »
```

Le retour compte autant que l'aller : d'une facture à l'OR, de l'OR au véhicule, du véhicule au
client. C'est ce qui permet de raccrocher le téléphone en sachant de quoi on parle.

**Ce que chaque fiche doit ouvrir, concrètement :**

- **Fiche véhicule** → propriétaire actuel · détenteurs précédents · tous ses OR · ses factures · son
  jeu de pneus au dépôt et son emplacement · ses travaux reportés avec « ouvrir un OR à partir de ces
  travaux » · bouton « nouvel OR » · échéance MFK.
- **Fiche OR** → le client · le véhicule · l'OR précédent du même véhicule · chaque ligne pièce vers
  l'article et sa disponibilité · le devis d'origine · la facture émise · qui a pointé et combien.
- **Fiche client** → ses véhicules · ses OR · ses factures et son solde ouvert · son dossier de vente
  en cours · ses jeux de pneus au dépôt · pour une entreprise, ses conducteurs et son adresse de
  facturation.
- **Fiche article** → les OR qui l'ont consommé · les réservations en cours et pour quel OR · les
  commandes fournisseur en attente · le fournisseur.
- **Dossier de vente** → le véhicule (le même objet que côté atelier) · l'OR de préparation · la
  reprise et son véhicule · la facture · le client.
- **Dépôt pneus** → le véhicule · le client · le dernier OR de changement de saison.
- **Fiche facture** → déjà bien faite, à prendre comme modèle pour toutes les autres.

**La recherche n'est pas une destination**

Aujourd'hui « Recherche » est une entrée de menu qui mène à un écran. Erreur de nature : chercher
n'est pas un endroit où l'on va, c'est **un geste qu'on fait depuis là où on est**.

Elle doit être **un champ permanent en haut de l'application**, focalisable au clavier, acceptant
indifféremment une plaque, un châssis partiel, un nom, un téléphone, un numéro d'OR ou de facture,
une référence de pièce, et proposant les résultats typés sous le curseur. Le réceptionniste tape
quatre lettres et appuie sur Entrée pendant que le client finit sa phrase : c'est le geste numéro un
du métier, il ne peut pas coûter deux clics et un changement d'écran. Une fois cette barre en place,
une entrée disparaît et le besoin de dix autres s'évapore — on ne va plus « dans les véhicules » pour
trouver un véhicule.

**Le fil d'Ariane doit porter le contexte, pas l'adresse**

Sur un OR, le haut de l'écran doit dire _qui_ et _quoi_, chaque morceau cliquable :

```
Martin SA  ›  VD 123 456 · Golf VII  ›  OR-2026-0184
```

Pas `Atelier > Ordres de réparation > Détail`. Le premier est une carte du dossier en cours, le
second une carte du logiciel — et personne ne travaille dans un logiciel : on travaille sur une Golf
qui appartient à Martin SA.

**Un écran, une action principale**

« Pas un milliard de boutons partout » : la règle qui rend ça vrai, c'est **une seule action primaire
par écran**, en couleur, à un endroit constant. Tout le reste — corriger, annuler, dupliquer,
imprimer, exporter — descend derrière un bouton « … ». Sur un OR, l'action primaire change avec
l'état du dossier : _Ajouter une ligne_ quand il est en cours, _Facturer_ quand tout est réalisé.
L'écran répond à « et maintenant, je fais quoi ? » sans qu'on ait à choisir.

6. Ce que je pense, sans ménagement

---

**Mal conçu, à corriger même si personne ne l'a demandé :**

1. **Accueil et Tableau de bord sont le même écran coupé en deux** : l'un sans rien d'utile (trois
   raccourcis vers des listes), l'autre avec les chiffres. Un seul écran « Aujourd'hui », dont le
   contenu dépend du rôle.
2. **Le menu est masqué par rôle, ce qui n'est pas la même chose qu'être pensé par rôle.** Un
   technicien qui voit six groupes dont quatre lui sont inutiles perd du temps chaque jour.
3. **Rien n'est cliquable dans les fiches.** C'est le vrai défaut, et il coûte plus cher que la
   longueur du menu.
4. **Trois entrées pour le pointage, plus une pour la borne**, alors que pointer se résume à « je
   commence » / « j'ai fini ». Le pointage n'est pas un module, c'est un bouton.
5. **« Réservations » et « Réapprovisionnement » sont deux vues filtrées de la même liste de pièces** :
   deux entrées de menu pour deux filtres, symptôme d'une liste qui ne sait pas filtrer.

**Ce que je garde tel quel, même si on me propose de le changer :**

1. **Le site dans l'adresse plutôt que dans un état global** — deux onglets sur deux sites ne doivent
   pas se contredire, et un lien envoyé par messagerie doit ouvrir le bon site.
2. **La borne d'atelier, écran séparé et sans menu.** Exactement ce qu'il faut.
3. **Un véhicule vendu et un véhicule d'atelier sont le même objet** — c'est ce qui rend possible
   l'enchaînement dossier de vente → OR de préparation.
4. **Les ordres de réparation gardent leur entrée de premier niveau** : document central du métier,
   il ne doit pas être enterré sous trois niveaux.
5. **La facturation reste séparée de l'atelier** — deux moments distincts, souvent deux personnes.

**Ce qui ne devrait pas exister en tant qu'entrée de menu, du tout :** Doublons clients, Fournisseurs,
Consignes, Référentiels, Clôture de période, Jeux à relancer, Suivi financement, et les quatre écrans
de paramétrage. Dix entrées supprimées d'un coup sans perdre une seule fonctionnalité — elles
existent toutes, mais à l'endroit où on en a besoin.

**Ce que je n'ajouterais pas, malgré la tentation :** des compteurs partout. Deux pastilles au
maximum — les OR ouverts sur _Atelier_, les factures en retard sur _Facturation_. Un menu qui
clignote de partout ne signale plus rien.

7. Questions à @laupernoe

---

Chaque réponse change concrètement la proposition.

1. **Combien de vos garages ont réellement plusieurs sites, et un employé travaille-t-il sur deux
   sites dans la même journée ?** → Si c'est rare, le sélecteur de site descend dans les Réglages ;
   s'il est courant, il reste visible en permanence en haut.
2. **Un même employé cumule-t-il plusieurs rôles ?** (le patron aussi vendeur et comptable, le chef
   d'atelier qui reçoit) → Si oui, mes trois postes ne suffisent pas : il faut un sélecteur de mode
   plutôt qu'un menu déduit d'un rôle unique.
3. **Combien de vos garages ont un magasinier à plein temps ?** → S'ils sont une minorité, le Magasin
   passe en cinquième position et s'ouvre sur la recherche comptoir, pas sur l'inventaire.
4. **Les techniciens ont-ils un compte nominatif, ou passent-ils tous par la borne murale ?** → S'ils
   passent tous par la borne, le poste « atelier » disparaît : deux barres au lieu de trois.
5. **Le patron veut-il vraiment faire ses relances et son export fiduciaire dans DFA, ou son
   fiduciaire fait-il déjà tout ?** → Si le fiduciaire fait tout, Facturation se réduit fortement et
   Relances redevient un simple bloc de « Aujourd'hui ».
6. **Les postes de comptoir sont-ils tactiles, et quelle est la taille d'écran la plus modeste
   installée chez vos clients ?** → Cela fixe le nombre d'entrées qui tiennent sans défilement et la
   taille minimale des cibles.
7. **Combien de vos garages vendent réellement des véhicules (VN/VO) ?** → Si c'est une minorité,
   Ventes devient une option activée par garage et le poste comptoir tombe à cinq entrées.
8. **Le gardiennage de pneus est-il facturé annuellement, ou compris dans le prix du changement ?**
   → S'il est facturé, le dépôt pneus a besoin d'un lien direct vers la facturation et gagne sa place
   dans « Aujourd'hui » à la saison ; sinon il reste un pur outil de rangement.
9. **Quelle est la langue de travail réelle des équipes chez vos dix garages ?** → Les mots que je
   propose (« Magasin », « Aujourd'hui ») doivent survivre à l'allemand et à l'italien sans devenir
   bancals ; si le terrain est germanophone, je fais valider les libellés par un garagiste.
10. **Y a-t-il des habitudes venues d'Auto-i ou de Nextlane qu'il ne faut surtout pas casser ?** → Une
    réorganisation qui a raison sur le papier échoue à la reprise si elle déplace un geste que les
    gens font sans réfléchir depuis dix ans. Je préfère le savoir avant de trancher.
