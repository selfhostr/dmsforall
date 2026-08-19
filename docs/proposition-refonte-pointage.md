$=^
**Date d'arbitrage** : 2026-08-14  
**Statut** : Décision prise, périmètre exécutable  
**Fondement** : Retour utilisateur (ergonomie borne d'atelier) + arbitrage métier @laupernoe

---

Déclencheur
-----------

Retour utilisateur : le module de pointage ne semble pas logique ni _user-friendly_ ; **ça doit être ultra rapide et instinctif pour les ouvriers**. Cette proposition documente les constats factuels (vérifiés en exécution), récapitule ce qui fonctionne bien, et propose une redirection ergonomique.

---

Synthèse exécutive
------------------

**Le module comprend correctement le modèle de données, mais inverse la fréquence réelle des gestes** : l'écran traite le changement de tâche (le geste de la journée le plus répété, ~12-16 fois) comme secondaire, au prix de cinq actions enchaînées, alors que le début/fin de journée (une fois) sont optimisés. La proposition pivote l'architecture vers un bandeau de rappel stationnaire en tête d'écran, libère la cible productife directement depuis une pause, et étend « Reprendre » à toutes les activités indirectes — pas seulement la pause.

---

1. Constats vérifiés en exécution

---

**1.1 Inversion de fréquence — l'ergonomie traite le cas minoritaire**

**Estimation à confirmer auprès d'un atelier** : Le changement de tâche en cours de service n'est ni le début de matinée ni l'arrêt du soir (une fois chacun) mais le geste **le plus répété** : 12–16 fois par jour sur 10–18 gestes de pointage au total. **C'est le cas dominant.**

**Aujourd'hui** : C'est le cas le moins bien servi, codé comme une exception (« interrompre la pause »), et qui coûte cinq actions (voir ci-dessus).

**Durée réelle d'un geste** : Le coût réel n'est pas le tap. C'est se redresser de sous le véhicule, essuyer une main, marcher jusqu'à la borne : **15 à 30 secondes par aller-retour**. Chaque étape superflue multiplie cette latence. Sur une borne partagée, c'est aussi une file d'attente aux heures de pointe.

**1.2 Cibles tactiles sous la norme qu'on s'est fixée**

**Norme du projet** : `design-etape-1-atelier.md` (ligne 594) impose **72 px** minimum pour la densité `très-aérée` — celle de l'écran de pointage, destiné aux mains gantées, lu vite.

**Réalité du code** : `CartePointageEnCours.tsx` (lignes 77, 88, 98) utilise `h-16` (64 px), soit 8 px sous la norme. Sur une tablette, c'est 1–2 millimètres de marge.

**Justification de la norme** : L'écran de pointage a plus d'excuses que d'autres pour réduire les cibles — c'est l'inverse de la logique du projet.

**1.3 Couleur erronée sur le geste le plus répété**

**Fait** : Le bouton « Arrêter » est en `variant="destructive"` (`CartePointageEnCours.tsx`, ligne 97), donc rouge.

**Problème** : Arrêter un pointage n'est ni dangereux ni irréversible — c'est le geste le plus répété de la journée. Vous arrêtez la pause, vous arrêtez une ligne pour passer à la suivante, vous arrêtez le soir. Le rouge doit rester réservé au réellement risqué (ex. supprimer un OR, annuler une facture). Ici, il fait hésiter sur un geste anodin.

**1.4 État volatil interdit en mode borne**

**Fait** : La cible mémorisée (`dernierCible`) vit dans l'état local du composant React.

**Spécification-pointage-borne.md** existe depuis une semaine ; elle a été écrite en parallèle de la spécification pointage, et ce couplage n'est signalé nulle part dans l'une ni l'autre.

**Problème** : La mémoire React est perdue à chaque rechargement de page. Problématique en mode personnel (F5 pendant une pause, le bouton « Reprendre » disparaît). **Critique en mode borne** : chaque identification PIN recharge l'écran pour switcher de technicien — `dernierCible` s'évapore. « Reprendre » ne pourra jamais fonctionner en mode borne avec cette architecture.

**C'est le point technique le plus important à remonter à @laupernoe.**

**Illustration** :

- Technicien A pointe une ligne, puis prend une pause (démarre activité `pause`).
- Technicien B tape son PIN → rechargement de l'écran, `dernierCible` du technicien A est oubliée.
- Technicien A reprend son identification → nouvel écran. Le bouton « Reprendre » n'existe plus.
- Technicien A ne peut retrouver sa ligne que via « Mes OR du jour ».

**1.5 Apprenti bloqué par une présomption de propriété de ligne**

**Fait** : `DialogueChoixCiblePointage.tsx` (lignes 57-58) filtre les lignes pointables sur `ligne.technicienId === technicienId` — seules les lignes assignées au technicien sont affichées.

**Specification-pointage.md (RM-121)** documente que « plusieurs lignes `en_cours` en même temps » sont autorisées. La règle de base ne limite pas le nombre de techniciens sur la même ligne.

**Cas réel à confirmer auprès de @laupernoe** : Un apprenti qui prête main-forte sur la ligne d'un compagnon : doit-il être assigné à la ligne pour la voir ? Ou cet assignement est-il un détail d'organisation qui n'a pas sa place dans l'écran de pointage ?

**Si le cas est courant** : C'est un blocage ergonomique sérieux.

**1.6 Mode borne bloqué sur le choix du site**

**Fait** : Le site est un paramètre d'URL (`?site=`, ligne 130 de `EcranPointageTechnicien.tsx`). Le sélecteur (`SelecteurSitePointage.tsx`) est un `<Select>` inline qui met à jour l'URL, mais cette URL n'est stockée nulle part côté serveur.

**Résolu** : Le site est déduit du PIN (section 8.2). Le paramètre d'URL `?site=` n'est plus une source de vérité — il vient du PIN.

**1.7 Aucun mécanisme n'existe pour clôturer automatiquement un pointage oublié**

**Constat (14.08.2026)** : Recherche dans `apps/api/src/pointage/` — aucun `@Cron`, `@Processor`, ni file BullMQ n'existe pour fermer les pointages `en_cours` en fin de journée. Le commentaire du code (`regles-pointage.ts`) admet explicitement : « AUCUN job de clôture automatique de fin de journée (RM-91/RM-119) n'existe à ce jour dans ce dépôt ».

**Conséquence métier** : Un technicien qui part à 17h58 sans arrêter son pointage laisse un pointage `en_cours` ouvert indéfiniment. Le temps facturé devient faux — chaque ligne arrêtée manuellement plus tard intégrera cet excédent de temps.

**Note technique** : La décision §8.1 (« la reprise reste proposée toute la journée et disparaît le lendemain ») s'appuie sur le bornage de journée (section 1.8), pas sur un mécanisme de clôture inexistant. La décision reste valide — c'est la définition de journée qui borne la reprise, jamais un job qui n'existe pas.

**1.8 Bornage de journée en UTC pur, sans fuseau par site**

**Constat (14.08.2026)** : Les fonctions de bornage (`debutDeJourneeUtc`, `finDeJourneeUtc` dans `service-or.ts` lignes 1125-1140) produisent des instants UTC sans tenir compte du fuseau horaire du site (`parametre_atelier`/`site` ne portent aucune colonne de fuseau).

**Écart réel** : Entre minuit UTC et l'aube locale suisse, l'écart est de 1 h (hiver) à 2 h (été). Un pointage saisi entre minuit et 2 h du matin est rattaché à la veille, non au jour où le travail a eu lieu.

**Cas courant aujourd'hui** : Rare en atelier de jour. **Blocage futur** : Critique le jour où un garage tourne en équipes de nuit ou en décalé. La correction demande un fuseau par site — non disponible à ce jour, signalé comme limitation documentée du code.

---

Ce qui a été corrigé depuis la proposition (04.08.2026)
-------------------------------------------------------

- **Bouton « Changer »** : Implémenté en tant que correctif #117 (`CartePointageEnCours.tsx` ligne 120-130, prop `onChanger`). Permet de passer à une nouvelle cible sans arrêter d'abord, avec clôture automatique de l'ancien pointage côté serveur.
- **Filtre technicienId** : Câblé au SQL via `exists()` (`service-or.ts` lignes 735-751). Le filtre « Mes OR du jour » fonctionne correctement et n'affiche que les OR assignés au technicien.

---

2. Ce qui fonctionne bien et doit être conservé

---

Ces points ne sont pas perfectibles — ce sont de vraies bonnes décisions qu'il serait contreproductif de rouvrir.

- **RM-116 appliquée** : Pas d'état « pause » sur la base, deux transitions (`en_cours → pause` = arrêt+redémarrage indirect), pas d'état tiers. C'est la bonne décision technique.

- **Pas d'imposé sur le parcours** : Aucune saisie de texte n'est forçée avant de pouvoir pointer — le chronomètre démarre sans attendre du contexte textuel.

- **Séparation clair « Arrêter » vs « Marquer réalisée »** (RM-118) : Un technicien qui arrête son pointage à midi pour manger ne doit pas déclarer son travail fini. Cette distinction évite une source d'erreur très fréquente.

- **Chronomètre calculé localement** : Pas d'attente réseau à chaque tick, il continue en avion. Très bon choix.

- **Filtrage des lignes pointables** : On affiche uniquement les statuts qui ont du sens (pas `facturee`, pas `annulee`). Le serveur reste l'arbitre final.

- **Mode borne à PIN** : Réponse correcte à la réalité physique — pas de clavier, mains sales, plusieurs personnes au même endroit.

---

3. Architecture proposée

---

**Direction retenue : un bandeau de rappel en tête d'écran**

**Rejeté explicitement** : L'option d'un « fil chronologique » de tous les pointages du jour. Raison 1 : elle duplique l'écran `EcranJournalPointage` qui existe déjà. Raison 2 : elle dégrade le cas dominant en fin de matinée — si vous avez six à huit segments à scanner pour retrouver la bonne ligne, vous êtes revenu à zéro sur la vitesse.

**Choisi** : Un **bandeau stationnaire de 80 px** en tête d'écran quand il y a une reprise possible. Ce bandeau est plein écran, restant visible en scroll s'il y a du contenu sous. Un seul appui sur le bandeau démarre directement le pointage — pas de tuile, pas de modale, pas de nouvelle question.

**3.1 État : « Repos avec ou sans reprise possible »**

**Cas** : Matin à l'arrivée (rien à reprendre) ou après interruption (reprise proposée).

**Sans reprise** :

```
┌─ Activités indirectes ────────────────────────────────────────┐
│ [Pause] [Nettoyage] [Attente pièces] …                       │
└───────────────────────────────────────────────────────────────┘

┌─ Mes OR du jour ──────────────────────────────────────────────┐
│ [OR-2026-1040 - Plaquettes avant] • 2 lignes                 │
│ [OR-2026-1041 - Révision 60k km] • 1 ligne                   │
└───────────────────────────────────────────────────────────────┘
```

**Avec reprise** : Bandeau de rappel apparaît en tête (voir 3.2).

**3.2 État : « Repos avec reprise possible »**

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

Composition du bandeau (80 px, pleine largeur) :

- **Icône/indication** : `↺` (ou icône généralisée « reprendre ») · Taille : 32 px
- **Titre** : **Reprendre : {libellé court}** · Titre compact, pouvant wrap
- **Sous-texte** : `Interrompu il y a {dur}` · `{cumul} déjà pointées aujourd'hui`* · Texte petit, couleur muted

*Le cumul ne s'affiche que s'il existe : si c'est la première visite sur cette ligne aujourd'hui, pas besoin de polluer le sous-texte.

**Geste** : Un seul tap sur le bandeau démarre directement le pointage sur la cible mémorisée. Pas de modale intermédiaire, pas de choix — c'est une décision faite, juste confirmer une fois.

**Avantage** : Vous êtes interrompu par le chef, vous revivifiez le pointage d'une tape en traversant la cuisine (0,5 secondes), pas un aller-retour à la borne pour scanner l'OR.

**3.3 État : « Choix de cible »**

**Cas** : OR avec plusieurs lignes pointables.

**Changement clé** : Écran plein écran (pas de modale) — évite les taps accidentels sur l'assombrissement quand on porte des gants. Bouton `← Retour` en haut.

**Nombre de gestes** : Deux (choisir OR, puis ligne). Compresser ce choix serait deviner à la place du technicien.

**3.4 États : « Pointage productif » et « Activité indirecte »**

**Pointage productif** (ligne d'OR) :

- Chrono géant (56–64 px), centré
- Cumul du jour affiché (ex. « 0h48 déjà pointées ») — seulement s'il existe un segment antérieur
- Boutons : « Pause » (primaire), « Arrêter » (secondaire, contour neutre — pas de rouge)

**Activité indirecte** (Pause, Nettoyage, etc.) :

- Chrono normal
- Bandeau de reprise visible (voir 3.2) : « ↺ Reprendre : Plaquettes... »
- Boutons : « Reprendre : {cible} » (primaire, informatif), « Arrêter » (secondaire)

**Étendue de « Reprendre »** : Couvre **toutes** les activités indirectes (pas seulement Pause). Les données du pointage précédent existent déjà en base — aucun surcoût technique.

---

4. Affichage du temps — deux nombres, jamais un seul

---

**Règle** : Dès qu'il existe plus d'un segment sur la même cible (même jour), afficher:

1. **Le cumul depuis ce matin** : « 0h48 déjà pointées aujourd'hui »
2. **Le chrono du segment courant** : celui qui tourne

**Raison** : Le chrono qui repart de zéro à chaque segment n'est pas un défaut — c'est un chronomètre honnête sur ce qu'il mesure (ce segment, là maintenant). Ce qui manquait, c'est le cumul : « Ah, j'ai déjà 0h48 sur cette ligne, je suis à mi-chemin de ce que le devis prévoit ».

**Cas où on n'affiche que le chrono** : Première visite sur cette cible aujourd'hui, cumul = 0.

---

5. Tableau des libellés proposés

---

Remplace le langage du mockup d'origine, en cohérence avec RM-118 :

Composition du bandeau (paramétrage) :

- **Titre du bandeau de reprise** : `↺ Reprendre : {libellé de cible}` (ex. `↺ Reprendre : Plaquettes de frein — OR-2026-1042`)
- **Sous-texte bandeau reprise** : `Interrompu il y a {durée}` · `{cumul} déjà pointées aujourd'hui`
- **Bouton reprise en pause** : `Reprendre : {libellé court}` (ex. `Reprendre : Plaquettes de frein`)
- **Bouton arrêt** : `Arrêter` (pas `Terminer`) — terme technique neutre

---

6. Choix de conception (appliqués uniformément)

---

1. **Bandeau plutôt que fil chronologique** — Élimine la duplication avec `EcranJournalPointage`, n'affecte pas les performances.
2. **Extension de « Reprendre » à toutes les activités indirectes** — Données existantes, zéro surcoût technique.
3. **Écran plein écran pour le choix de cible** — Évite les accidents tactiles avec gants, cohérence de design.
4. **Bouton « Arrêter » neutre (pas rouge)** — Geste répété, non-dangereux (seulement stoppage temporaire).
5. **Affichage du cumul quand > 1 segment** — Clarification : deux nombres plutôt qu'un chrono cryptique.

---

7. Point technique : persistance de `dernierCible`

---

**7.1 État persistant côté serveur (EN COURS D'IMPLÉMENTATION)**

**Constat** : `dernierCible` vit en `useState` React (`EcranPointageTechnicien.tsx` ligne ~157) — elle s'évapore au rechargement de page. En mode borne, cela bloque la reprise (chaque PIN recharge l'écran).

**Solution en cours** : Endpoint `GET /pointages/dernier-du-jour` (implémentation par un agent parallèle). Au montage de l'écran, charger le dernier pointage du jour côté serveur plutôt que de le relire depuis l'état React.

**Bénéfice** : Fonctionne en mode borne (survit au rechargement) ET en mode personnel (F5 ne perd plus la reprise).

**Coût** : Une requête HTTP au montage (négligeable en pratique).

---

8. Arbitrages métier tranchés par @laupernoe (14.08.2026)

---

**8.1 Seuil de reprise après interruption — Décision**

**Décision** : La reprise reste proposée **toute la journée de travail** et **disparaît le lendemain**. Aucun paramètre configurable par garage (P-34 abandonné).

**Justification** : Préserve une cohérence sémantique : une journée de travail est une unité atomique ; un pointage interrompu après 17h ne « reprend » pas le lendemain. Le bornage repose sur la définition de journée (UTC pur, voir constat 1.8), jamais sur un mécanisme de clôture automatique (qui n'existe pas, constat 1.7).

**Implémentation** : Le bandeau de reprise disparaît si le pointage précédent date de plus d'une journée (calculé depuis `debutDeJourneeUtc` du pointage).

**8.2 Persistance du site en mode borne — Décision**

**Décision** : Le site se déduit du PIN tapé. La table `pin_pointage` porte `site_id` — elle est la source de vérité. Le paramètre d'URL `?site=` n'est qu'un cache temporaire pour la session courante.

**Justification** : Chaque borne physique est associée à un seul garage (ou site). Un PIN identifie à la fois la personne et le site de sa borne. Faire dériver le site du PIN plutôt que d'un sélecteur supprime un geste et un point de défaillance.

**Implémentation** : Au montage de l'écran de pointage (après identification PIN), charger le site depuis la fiche PIN — jamais demander à l'utilisateur de le choisir de nouveau.

**Écartées** : Les options B (localStorage) et C (rechoisir à chaque entrée).

**8.3 Cas de l'apprenti — Décision**

**Décision** : Un technicien peut pointer une ligne sans y être assigné. L'assignement redevient un détail d'organisation, jamais un droit de pointage. La modale « Que pointez-vous ? » ne filtre plus sur `technicienId`.

**Justification** : RM-121 l'autorise déjà en base (plusieurs lignes `en_cours` en parallèle, techniciens multiples par ligne). L'écran ne doit pas inventer une restriction au-delà du modèle métier. Un apprenti qui aide un compagnon doit pouvoir pointer la ligne du compagnon sans être assigné.

**Implémentation** : Supprimer le filtre `ligne.technicienId === technicienId` dans `DialogueChoixCiblePointage.tsx`.

**Écartées** : Les interprétations 1 (apprenti assigné obligatoire) et 2 (pointage indirect via le compagnon).

**8.4 Distinction entre pauses payées et impayées — Décision**

**Décision** : Un seul type « Pause ». La distinction payée/non payée se règle à la paie, à partir des horaires de pointage, jamais à la borne.

**Justification** : Ajouter un sélecteur de type de pause complexifie l'écran sans bénéfice métier immédiat (la paie recalcule de toute façon). Les données de pointage restent nettes — une pause est une pause, le contexte de paie décide de son traitement.

**Implémentation** : Conserver un seul bouton « Pause » en activité indirecte.

---

9. Synthèse des changements

---

**Ce qui change structurellement**

Tableau de comparaison : avant/après refonte

- **Espace mental** : Avant = Modale « Que pointez-vous ? » · Après = Écran plein écran, même principe · Bénéfice = Pas de tap accidentel sur l'assombrissement. Cohérence.

- **Reprise après pause** : Avant = Tuile « Pause » → bouton « Reprendre » · Après = Bandeau de rappel en tête, tap unique · Bénéfice = Cas dominant (12–16 fois/jour) en un geste au lieu de 5.

- **Étendue de « Reprendre »** : Avant = Pause uniquement · Après = Toutes activités indirectes · Bénéfice = Les données existent, aucun surcoût, gain ergonomique.

- **Couleur du bouton Arrêter** : Avant = Destructive (rouge) · Après = Neutre (contour) · Bénéfice = Arrêter n'est ni dangereux ni rare. Rouge pour le risqué.

- **Cible tactile** : Avant = 64 px (sous-norme) · Après = 72 px (conforme) · Bénéfice = Mains gantées, norme du projet.

- **Affichage du temps** : Avant = Chrono seul · Après = Chrono + cumul si > 1 segment · Bénéfice = Clarification du what/where.

- **Mémoire de cible** : Avant = État React (volatil) · Après = Requête serveur (persistant) · Bénéfice = Critique pour mode borne.

- **Filtrage des lignes** : Avant = Filtre sur assignation · Après = Aucun filtre écran (modèle = source) · Bénéfice = Apprenti peut pointer ligne du compagnon.

**Ce qui ne change pas**

- Structure de données, RM-87 → RM-123.
- Pas d'état « pause » en base (RM-116).
- Séparation « Arrêter » / « Marquer réalisée » (RM-118).
- Droits, matrice de pointage.

---

Conclusion
----------

Le module comprend correctement le modèle métier et les règles de saisie. **L'inversion de fréquence** — traiter le cas rare (début/fin de journée) comme optimal et le cas dominant (changement de tâche) comme pénible — est la racine du problème ergonomique. Cette proposition repositionne les flux autour de ce qui arrive réellement, sans réinventer le métier. La source de volatilité (`dernierCible` en React) doit être résolue pour que le mode borne fonctionne — et ce changement bénéficie également au mode session personnelle.
