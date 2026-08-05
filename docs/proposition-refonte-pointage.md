# Proposition de refonte de l'écran de pointage technicien

**Date** : 2026-08-04  
**Auteur** : Proposition soumise à arbitrage  
**Destinataire** : @laupernoe (arbitrage et décisions métier)

---

## Déclencheur

Retour utilisateur : le module de pointage ne semble pas logique ni *user-friendly* ; **ça doit être ultra rapide et instinctif pour les ouvriers**. Cette proposition documente les constats factuels (vérifiés en exécution), récapitule ce qui fonctionne bien, et propose une redirection ergonomique.

---

## Synthèse exécutive

**Le module comprend correctement le modèle de données, mais inverse la fréquence réelle des gestes** : l'écran traite le changement de tâche (le geste de la journée le plus répété, ~12-16 fois) comme secondaire, au prix de cinq actions enchaînées, alors que le début/fin de journée (une fois) sont optimisés. La proposition pivote l'architecture vers un bandeau de rappel stationnaire en tête d'écran, libère la cible productife directement depuis une pause, et étend « Reprendre » à toutes les activités indirectes — pas seulement la pause.

---

## 1. Constats vérifiés en exécution

### 1.1 L'écran a régressé par rapport à sa propre spécification

**Fait** : `docs/design-etape-1-atelier.md` (ligne 445) prévoit dans la maquette de l'écran « pointage en cours » un bouton secondaire **« Changer de ligne »** (56 px). Ce bouton n'a jamais été construit.

**Évidence** : Consulter le composant `apps/web/src/ecrans/pointage/CartePointageEnCours.tsx` (lignes 11-24, interface `Props`) : seules trois actions sont exposées — `onArreter`, `onPause`, `onReprendre`. Aucune action « changer de ligne ».

**Conséquence de cette absence** : Pour passer d'une ligne à l'autre du MÊME OR, il faut : (1) arrêter le pointage courant, (2) attendre le basculement d'écran, (3) retaper le même OR, (4) ouvrir la modale « Que pointez-vous ? », (5) choisir la nouvelle ligne — **cinq gestes**. La maquette du design exigeait « Deux taps maximum » (ligne 428) ; cette promesse est rompue.

### 1.2 Inversion de fréquence — l'ergonomie traite le cas minoritaire

**Estimation à confirmer auprès d'un atelier** : Le changement de tâche en cours de service n'est ni le début de matinée ni l'arrêt du soir (une fois chacun) mais le geste **le plus répété** : 12–16 fois par jour sur 10–18 gestes de pointage au total. **C'est le cas dominant.**

**Aujourd'hui** : C'est le cas le moins bien servi, codé comme une exception (« interrompre la pause »), et qui coûte cinq actions (voir ci-dessus).

**Durée réelle d'un geste** : Le coût réel n'est pas le tap. C'est se redresser de sous le véhicule, essuyer une main, marcher jusqu'à la borne : **15 à 30 secondes par aller-retour**. Chaque étape superflue multiplie cette latence. Sur une borne partagée, c'est aussi une file d'attente aux heures de pointe.

### 1.3 Cibles tactiles sous la norme qu'on s'est fixée

**Norme du projet** : `design-etape-1-atelier.md` (ligne 594) impose **72 px** minimum pour la densité `très-aérée` — celle de l'écran de pointage, destiné aux mains gantées, lu vite.

**Réalité du code** : `CartePointageEnCours.tsx` (lignes 77, 88, 98) utilise `h-16` (64 px), soit 8 px sous la norme. Sur une tablette, c'est 1–2 millimètres de marge.

**Justification de la norme** : L'écran de pointage a plus d'excuses que d'autres pour réduire les cibles — c'est l'inverse de la logique du projet.

### 1.4 Couleur erronée sur le geste le plus répété

**Fait** : Le bouton « Arrêter » est en `variant="destructive"` (`CartePointageEnCours.tsx`, ligne 97), donc rouge.

**Problème** : Arrêter un pointage n'est ni dangereux ni irréversible — c'est le geste le plus répété de la journée. Vous arrêtez la pause, vous arrêtez une ligne pour passer à la suivante, vous arrêtez le soir. Le rouge doit rester réservé au réellement risqué (ex. supprimer un OR, annuler une facture). Ici, il fait hésiter sur un geste anodin.

### 1.5 État volatil interdit en mode borne

**Fait** : La cible mémorisée (`dernierCible`) vit dans l'état local du composant React.

**Spécification-pointage-borne.md** existe depuis une semaine ; elle a été écrite en parallèle de la spécification pointage, et ce couplage n'est signalé nulle part dans l'une ni l'autre.

**Problème** : La mémoire React est perdue à chaque rechargement de page. Problématique en mode personnel (F5 pendant une pause, le bouton « Reprendre » disparaît). **Critique en mode borne** : chaque identification PIN recharge l'écran pour switcher de technicien — `dernierCible` s'évapore. « Reprendre » ne pourra jamais fonctionner en mode borne avec cette architecture.

**C'est le point technique le plus important à remonter à @laupernoe.**

**Illustration** :
- Technicien A pointe une ligne, puis prend une pause (démarre activité `pause`).
- Technicien B tape son PIN → rechargement de l'écran, `dernierCible` du technicien A est oubliée.
- Technicien A reprend son identification → nouvel écran. Le bouton « Reprendre » n'existe plus.
- Technicien A ne peut retrouver sa ligne que via « Mes OR du jour ».

### 1.6 Apprenti bloqué par une présomption de propriété de ligne

**Fait** : `DialogueChoixCiblePointage.tsx` (lignes 57-58) filtre les lignes pointables sur `ligne.technicienId === technicienId` — seules les lignes assignées au technicien sont affichées.

**Specification-pointage.md (RM-121)** documente que « plusieurs lignes `en_cours` en même temps » sont autorisées. La règle de base ne limite pas le nombre de techniciens sur la même ligne.

**Cas réel à confirmer auprès de @laupernoe** : Un apprenti qui prête main-forte sur la ligne d'un compagnon : doit-il être assigné à la ligne pour la voir ? Ou cet assignement est-il un détail d'organisation qui n'a pas sa place dans l'écran de pointage ?

**Si le cas est courant** : C'est un blocage ergonomique sérieux.

### 1.7 « Mes OR du jour » affiche tous les OR du garage

**Fait documenté** : `apps/api/src/atelier/service-or.ts` (lignes 531-535) documente honnêtement que `technicienId` n'est **pas câblé** — « SIMPLIFICATION SIGNALÉE ». Le paramètre existe dans le contrat OpenAPI, le code ne l'utilise pas.

**Divergence front/back** : Le hook `apps/web/src/hooks/pointage/mes-ordres-assignes.api.ts` (lignes 6-15) affirme dans ses commentaires que le filtre existe « côté service (…, vérifié) ». C'est faux : le serveur était transparent, le front a supposé.

**Conséquence** : L'écran affiche tous les OR du site, pas seulement ceux du technicien. Plus grave en gros atelier : le scroll pour trouver SON OR coûte des secondes.

### 1.8 Mode borne bloqué sur le choix du site

**Fait** : Le site est un paramètre d'URL (`?site=`, ligne 130 de `EcranPointageTechnicien.tsx`). Le sélecteur (`SelecteurSitePointage.tsx`) est un `<Select>` inline qui met à jour l'URL, mais cette URL n'est stockée nulle part côté serveur.

**Mode borne, plusieurs sites** : Supposons une borne multi-site (prestataire avec deux garages). Le technicien tape son PIN, l'écran demande « Quel site ? » Il choisit. À la fin de son pointage, il se déconnecte. Le technicien suivant tape SON PIN → le sélecteur réapparaît. Le paramètre d'URL a été reset avec le rechargement.

**Pire encore** : Si un technicien veut pointer avant d'avoir choisi son site, l'appui sur une tuile d'activité indirecte (« Pause ») échoue silencieusement — `siteId` est `undefined`.

---

## 2. Ce qui fonctionne bien et doit être conservé

Ces points ne sont pas perfectibles — ce sont de vraies bonnes décisions qu'il serait contreproductif de rouvrir.

- **RM-116 appliquée** : Pas d'état « pause » sur la base, deux transitions (`en_cours → pause` = arrêt+redémarrage indirect), pas d'état tiers. C'est la bonne décision technique.

- **Pas d'imposé sur le parcours** : Aucune saisie de texte n'est forçée avant de pouvoir pointer — le chronomètre démarre sans attendre du contexte textuel.

- **Séparation clair « Arrêter » vs « Marquer réalisée »** (RM-118) : Un technicien qui arrête son pointage à midi pour manger ne doit pas déclarer son travail fini. Cette distinction évite une source d'erreur très fréquente.

- **Clôture automatique de fin de journée** (RM-91/RM-119) : L'oubli le plus courant — un technicien qui part à 17h58 sans cliquer — est anticipé et résolu. C'est du bon design métier.

- **Chronomètre calculé localement** : Pas d'attente réseau à chaque tick, il continue en avion. Très bon choix.

- **Filtrage des lignes pointables** : On affiche uniquement les statuts qui ont du sens (pas `facturee`, pas `annulee`). Le serveur reste l'arbitre final.

- **Mode borne à PIN** : Réponse correcte à la réalité physique — pas de clavier, mains sales, plusieurs personnes au même endroit.

---

## 3. Architecture proposée

### Direction retenue : un bandeau de rappel en tête d'écran

**Rejeté explicitement** : L'option d'un « fil chronologique » de tous les pointages du jour. Raison 1 : elle duplique l'écran `EcranJournalPointage` qui existe déjà. Raison 2 : elle dégrade le cas dominant en fin de matinée — si vous avez six à huit segments à scanner pour retrouver la bonne ligne, vous êtes revenu à zéro sur la vitesse.

**Choisi** : Un **bandeau stationnaire de 80 px** en tête d'écran quand il y a une reprise possible. Ce bandeau est plein écran, restant visible en scroll s'il y a du contenu sous. Un seul appui sur le bandeau démarre directement le pointage — pas de tuile, pas de modale, pas de nouvelle question.

### 3.1 État : « Repos, rien n'est pointé »

**Cas** : Matin à l'arrivée, ou après arrêt du soir précédent.

**À l'écran** :
```
┌─────────────────────────────────────────────────────────────────┐
│ Pointage technicien                                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ [Tuile:Nettoyage] [Tuile:Attente pièces] [Tuile:Pause] ...     │
└─────────────────────────────────────────────────────────────────┘

┌─ Mes OR du jour ──────────────────────────────────────────────┐
│ [OR-2026-1040 - Plaquettes avant] • 2 lignes                 │
│ [OR-2026-1041 - Révision 60k km] • 1 ligne                   │
│ [OR-2026-1042 - Batterie] • 3 lignes                          │
└────────────────────────────────────────────────────────────────┘
```

**Raison** : Matin, il n'y a rien à reprendre. La question « Que pointez-vous ? » est aussi logique que la réponse.

### 3.2 État : « Repos avec reprise possible »

**Cas** : Vous avez interrompu une ligne productive (pause, changement de tâche, interruption inattendue), ou une activité indirecte.

**À l'écran** :
```
┌─────────────────────────────────────────────────────────────────┐
│ ↺ Reprendre : Plaquettes de frein — OR-2026-1042             │
│   Interrompu il y a 12 min • 0h48 déjà pointées aujourd'hui   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ [Tuile:Nettoyage] [Tuile:Attente pièces] [Tuile:Pause] ...     │
└─────────────────────────────────────────────────────────────────┘

┌─ Mes OR du jour ──────────────────────────────────────────────┐
│ [OR-2026-1040 - Plaquettes avant] • 2 lignes                 │
│ [OR-2026-1041 - Révision 60k km] • 1 ligne                   │
│ [OR-2026-1042 - Batterie] • 3 lignes                          │
└────────────────────────────────────────────────────────────────┘
```

**Maquette du bandeau** (80 px, pleine largeur) :

| Partie | Contenu | Taille |
|--------|---------|--------|
| Icône/indication | `↺` (ou icône généralisée « reprendre ») | 32 px |
| Titre | **Reprendre :  {libellé court}** | Titre compact, pouvant wrap |
| Sous-texte | `Interrompu il y a {dur}` · `{cumul} déjà pointées aujourd'hui`* | Texte petit, couleur muted |

*Le cumul ne s'affiche que s'il existe : si c'est la première visite sur cette ligne aujourd'hui, pas besoin de polluer le sous-texte.

**Geste** : Un seul tap sur le bandeau démarre directement le pointage sur la cible mémorisée. Pas de modale intermédiaire, pas de choix — c'est une décision faite, juste confirmer une fois.

**Avantage** : Vous êtes interrompu par le chef, vous revivifiez le pointage d'une tape en traversant la cuisine (0,5 secondes), pas un aller-retour à la borne pour scanner l'OR.

### 3.3 État : « Choix de cible »

**Cas** : Vous avez appuyé sur un OR du matin, ou sur le bandeau de reprise d'une OR, mais il y a plusieurs lignes pointables dessus.

**Changement ergonomique clé** : La modale devient un **écran plein écran** avec un bouton `← Retour` en haut.

**Raison** : L'écran de pointage passe déjà en plein écran dès qu'un pointage démarre (voir 3.4). La modale est le seul endroit qui rompt ce principe. De plus, le tap accidentel sur le fond assombri d'une modale est un vrai risque quand vous portez des gants — l'écran plein écran prend tout l'espace tactile.

```
┌────────────────────────────────┐
│ ← Retour                       │
│                                │
│ Que pointez-vous ?             │
│                                │
│ [ Démarrer sur l'OR entier ]   │
│                                │
│ Lignes pointables :            │
│ [ Plaquettes avant ]           │
│ [ Plaquettes arrière ]         │
│ [ Remplissage liquide ]        │
│                                │
└────────────────────────────────┘
```

**Nombre de gestes** : Toujours deux — choisir l'OR, puis choisir la ligne. Compresser ce choix serait deviner à la place du technicien, ce qu'on ne peut pas faire.

### 3.4 État : « Pointage productif en cours »

**Cas** : Vous pointez une ligne d'OR ou un OR entier (pas une activité indirecte).

**Chrono** : Géant (56–64 px), centré.

**Cumul du jour** (affichage optionnel) : **Uniquement s'il existe un segment antérieur sur cette même ligne/cet OR** :

```
┌─────────────────────────────────────────────────────────────────┐
│ Pointage en cours : Plaquettes de frein — OR-2026-1042         │
│                                                                  │
│ Aujourd'hui sur cette ligne : 0h48 + en cours ci-dessous        │
│                                                                  │
│                          01:23:45                               │  ← Chrono géant
│                                                                  │
│ [ Pause ]        [ Arrêter ]                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Boutons** :
- **« Pause »** : Action primaire (pleine, pas d'outline), couleur standard (pas de rouge).
- **« Arrêter »** : Action secondaire de contour, couleur neutre (pas destructive).

**Raison du changement** : Dans une journée type, « Pause » est cliqué ~10 fois (plus que « Arrêter »), et c'est juste interrompre, pas supprimer. Le rouge crée une tension inutile.

### 3.5 État : « Activité indirecte en cours »

**Cas** : Vous pointez Pause, Nettoyage, Attente pièces, etc.

**Reprise directe** : Le bandeau de reprise s'affiche (voir 3.2) avec le libellé de ce que vous faisiez avant (`Reprendre : Plaquettes...`).

```
┌─────────────────────────────────────────────────────────────────┐
│ ↺ Reprendre : Plaquettes de frein — OR-2026-1042             │
│   Interrompu il y a 1 min • 0h48 déjà pointées aujourd'hui    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Pointage en cours : Pause                                       │
│                                                                  │
│                          00:03:22                               │  ← Chrono
│                                                                  │
│ [ Reprendre : Plaquettes... ]    [ Arrêter ]                   │
└─────────────────────────────────────────────────────────────────┘
```

**Boutons** :
- **« Reprendre : {cible} »** : Action primaire (pleine, 80 px), libellé informatif.
- **« Arrêter »** : Action secondaire de contour.

**Étendue de « Reprendre »** : Recouvre **toutes** les activités indirectes, pas seulement `pause`. Un technicien qui range le magasin en attendant une pièce — dès que la pièce arrive, il reprend sa ligne. Les données existent déjà : on connaît le pointage qui précédait l'activité indirecte.

---

## 4. Affichage du temps — deux nombres, jamais un seul

**Règle** : Dès qu'il existe plus d'un segment sur la même cible (même jour), afficher:

1. **Le cumul depuis ce matin** : « 0h48 déjà pointées aujourd'hui »
2. **Le chrono du segment courant** : celui qui tourne

**Raison** : Le chrono qui repart de zéro à chaque segment n'est pas un défaut — c'est un chronomètre honnête sur ce qu'il mesure (ce segment, là maintenant). Ce qui manquait, c'est le cumul : « Ah, j'ai déjà 0h48 sur cette ligne, je suis à mi-chemin de ce que le devis prévoit ».

**Cas où on n'affiche que le chrono** : Première visite sur cette cible aujourd'hui, cumul = 0.

---

## 5. Tableau des libellés proposés

Remplace le langage du mockup d'origine, en cohérence avec RM-118 :

| Champ | Valeur |
|-------|--------|
| Titre du bandeau de reprise | `↺ Reprendre : {libellé de cible}` (ex. `↺ Reprendre : Plaquettes de frein — OR-2026-1042`) |
| Sous-texte bandeau reprise | `Interrompu il y a {durée}` · `{cumul} déjà pointées aujourd'hui` |
| Bouton reprise en pause | `Reprendre : {libellé court}` (ex. `Reprendre : Plaquettes de frein`) |
| Bouton arrêt | `Arrêter` (pas `Terminer`) — terme technique neutre, pas `Terminer` du mockup originel (antérieur à RM-118, risque de confusion avec « marquer réalisée »). |

---

## 6. Ce qui relève d'un choix de conception (tranché)

Ces points **ne demandent pas d'arbitrage supplémentaire** — ils représentent une cohérence interne de la proposition. Ils peuvent être critiqués sur les bases du projet, mais l'arbitrage ici porte sur le fait que la proposition les applique uniformément.

1. **Bandeau plutôt que fil chronologique** : Pas de duplication, pas de dégradation du cas dominant.
2. **Extension de « Reprendre » à toutes les activités indirectes** : Les données existent, aucun coût technique supplémentaire, gain ergonomique direct.
3. **Écran plein écran plutôt que modale** pour le choix de cible : Cohérence avec le reste de l'écran, robustesse des gants.
4. **Retrait du rouge sur « Arrêter »** : « Arrêter » n'est pas risqué, juste répété. Le rouge doit rester pour le réellement dangereux.
5. **Affichage du cumul dès qu'il existe** : Deux nombres clarifiés plutôt qu'un seul mystérieux.

---

## 7. Ce qui exige l'accord d'un lead technique

### 7.1 Basculer `dernierCible` d'une source React vers une dérivation serveur

**Changement** : Remplacer l'état local `dernierCible` (qui s'évapore au rechargement) par une **requête serveur** au montage de l'écran : « Quel était mon dernier pointage en cours ou interrompu aujourd'hui ? »

**Pourquoi** : 
- Mode personnel : F5 pendant une pause ne perd plus le bouton « Reprendre ».
- **Mode borne : critique** — chaque PIN reset l'écran. La cible mémorisée doit vivre côté serveur pour traverser ce rechargement.

**Ce que ça change**:
- Une requête `GET /pointages/dernier-du-jour?technicienId=&siteId=` (ou équivalent) au montage.
- Pas d'état React persistant.
- Synchro possible : si deux technicidens pointent en parallèle (borne multitab, par erreur), le dernier GET gagne — comportement transparent et correct.

**Coût** : Une requête HTTP supplémentaire au montage de l'écran. Négligeable en pratique (l'écran se charge une fois par jour de travail en mode borne, dix fois en mode personnel).

**Décision** : Cela sort du périmètre d'une décision d'ergonomie — c'est un changement de source de vérité. **Lead technique à valider** (expert-api, expert-react, ou lead-backend selon l'organisation).

---

## 8. Ce qui revient à @laupernoe — questions d'arbitrage métier

### 8.1 Seuil au-delà duquel une reprise n'a pas de sens

**P-34** (nouveau paramètre, aucun défaut proposé) : Quand proposer une reprise après une interruption ?

- **Seuil bas (30 min)** : Vous revenez vite, probablement la même session de travail.
- **Seuil moyen (2-4 h)** : Avant midi vs. après-midi.
- **Seuil haut (jamais le lendemain)** : Le jour ouvrable suivant, « Reprendre » ne s'affiche pas, faut refiler depuis « Mes OR ».

**Besoin de données terrain** : Quelle est la durée typique d'une interruption qu'on veut reprendre ? Interruption involontaire (chef qui demande un changement urgment) vs. volontaire (pause) ne se traitent-elles pas pareil ?

### 8.2 Persistance du site en mode borne

**Constat** : Le site est un paramètre d'URL perdu au rechargement. En mode borne, c'est bloquant (point 1.8).

**Trois options** :

**Option A** : Chaque PIN apporte le site (« quels techniciens peuvent pointer à CETTE borne ? »). La table `pin_pointage` (specification-pointage-borne.md:79) porte `site_id` — elle sait. Au montage, dériver le site depuis le PIN, pas depuis un paramètre d'URL.

**Option B** : Persister le site en `localStorage` ou `sessionStorage` (du navigateur, pas la session serveur). Moins robuste si la tablette redémarre, mais beaucoup plus simple à coder.

**Option C** : Accepter que l'utilisateur rechoisisse son site à chaque entrée, tant qu'il n'y a qu'un PIN par site. Moins friction que le paramètre d'URL perdu, mais encore non-optimal.

**Besoin** : Validation de @laupernoe sur le mode borne réel — une borne par garage (Option A triviale), ou des bornes partagées multi-site (Option A compliquée, Option B ou C préférable) ?

### 8.3 Cas de l'apprenti

**Situation** : Un apprenti aide un compagnon sur une ligne assignée au compagnon seulement. Qui pointe ?

**Trois interprétations** :

1. **L'apprenti doit être assigné à la ligne** pour la voir et la pointer. (Aujourd'hui : DialogueChoixCiblePointage filtre sur technicienId.)
2. **L'apprenti n'est pas assigné mais pointé en productif par le compagnon** (« je dois ajouter {apprenti} à ma facture »). DFA exporte le temps pointé ; le compagnon le règle en paie locale.
3. **Deux pointages en parallèle** : Compagnon sur la ligne, apprenti aussi — simultanément. RM-121 l'autorise, mais l'écran n'expose pas ce flux.

**Besoin** : Clarification de la pratique réelle. Si l'apprenti doit voir la ligne du compagnon, c'est une régression ergonomique sérieuse (bloquerait la modale de choix de cible).

### 8.4 Distinction entre pauses payées et impayées

**Contexte** : Aujourd'hui, un seul bouton « Pause » couvre tout. Pause de 9h (snack, probablement payée) et pause de midi (repas, probablement pas payée) sont traitées identiquement.

**Donnée métier** : Faut-il exposer plusieurs types d'activité indirecte, ou rester sur une classification simple (pause = pause, indépendant du type) ?

**Besoin** : Décision métier. La proposition n'y change rien — elle élargit juste « Reprendre » à toutes les indirectes, unifié ou distincts, peu importe.

---

## 9. Synthèse pour arbitrage

### Ce qui change structurellement

| Aspect | Aujourd'hui | Proposé | Justification |
|--------|-----------|---------|---------------|
| **Espace mental** | Modale « Que pointez-vous ? » | Écran plein écran, même principe | Pas de tap accidentel sur l'assombrissement. Cohérence. |
| **Reprise après pause** | Tuile « Pause » → bouton « Reprendre » | Bandeau de rappel en tête, tap unique | Cas dominant (12–16 fois/jour) en un geste au lieu de 5. |
| **Étendue de « Reprendre »** | Pause uniquement | Toutes activités indirectes | Les données existent, aucun surcoût, gain ergonomique. |
| **Couleur du bouton Arrêter** | Destructive (rouge) | Neutre (contour) | Arrêter n'est ni dangereux ni rare. Rouge pour le risqué. |
| **Cible tactile** | 64 px (sous-norme) | 72 px (conforme) | Mains gantées, norme du projet. |
| **Affichage du temps** | Chrono seul | Chrono + cumul si > 1 segment | Clarification du what/where. |
| **Mémoire de cible** | État React (volatil) | Requête serveur (persistant) | Critique pour mode borne. |

### Ce qui ne change pas

- Structure de données, RM-87 → RM-123.
- Pas d'état « pause » en base (RM-116).
- Séparation « Arrêter » / « Marquer réalisée » (RM-118).
- Clôture automatique (RM-91/RM-119).
- Droits, matrice de pointage.

### Points de blocage pour @laupernoe

1. **P-34** : Seuil de reprise (30 min ? 2 h ? jamais le lendemain ?).
2. **Site en mode borne** : Persister comment ? (PIN porte le site, localStorage, ou accepter rechoisir ?)
3. **Apprenti** : Doit-il être assigné à la ligne pour la pointer, ou existe-t-il un flux à inventer ?
4. **Pause payée/impayée** : Faut-il deux types d'activité, ou une seule suffira ?

---

## Conclusion

Le module comprend correctement le modèle métier et les règles de saisie. **L'inversion de fréquence** — traiter le cas rare (début/fin de journée) comme optimal et le cas dominant (changement de tâche) comme pénible — est la racine du problème ergonomique. Cette proposition repositionne les flux autour de ce qui arrive réellement, sans réinventer le métier. La source de volatilité (`dernierCible` en React) doit être résolue pour que le mode borne fonctionne — et ce changement bénéficie également au mode session personnelle.
