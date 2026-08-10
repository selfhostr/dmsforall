# Audit de cohérence visuelle — écrans dmsforall

Date : 2026-08-09. Périmètre : `apps/web/src/ecrans/` et `apps/web/src/composants/`, en lecture seule. N'a pas touché aux tokens (`index.css`) ni aux primitives (`components/ui/`), en chantier parallèle.

Méthode : recherche systématique de couleurs Tailwind brutes, comparaison des composants de badge entre domaines, vérification des trois états obligatoires (chargement/vide/erreur), recherche de `tabular-nums` manquant sur les rendus monétaires, et des cibles tactiles sous 44px.

**Constat général : la discipline est très bonne.** Un patron canonique existe (`BadgeStatutOr`, `composants/identite/BadgeStatutOr.tsx`) — token `--statut-*` + forme (plein/contour) + icône + mot, jamais la couleur seule — et la grande majorité des badges de statut du produit (atelier, facturation, ventes/dossiers, ventes/reprises, ventes/financements) le suivent à la lettre, avec des commentaires qui citent explicitement le patron de référence. Les listes (`EcranListeClients`, `EcranListeArticles`, `EcranListeFactures`, `EcranListeOrdresReparation`, `EcranListeFournisseurs`, `EcranListeCommandesFournisseur`, `EcranListeDossiersVente`, `EcranListeVehiculesStock`) passent toutes par le même composant `TableComptoir` — la densité y est donc déjà unifiée par construction, pas de divergence trouvée. Les trois états (chargement/vide/erreur) sont gérés partout via des composants partagés (`EtatChargement`, `EtatErreur`, `EtatVide`/`EtatVidePremierUsage`/`EtatVideFiltre`/`EtatVideRecherche`), y compris dans les écrans qui délèguent à des sous-composants. `tabular-nums` est déjà posé à 102 endroits.

Les divergences trouvées sont donc peu nombreuses mais réelles. Classées par famille.

---

## Famille 1 — Deux badges dupliqués et DIVERGENTS pour le même statut métier (cohérence, gravité haute)

Le même statut de dossier de vente est rendu avec deux implémentations différentes, visibles sur deux écrans que le même utilisateur enchaîne dans le même parcours.

**`BadgeStatutFinancement` existe en double avec des règles de couleur différentes :**

- `apps/web/src/ecrans/ventes/dossiers/BadgeStatutFinancement.tsx` (ancien patron, un seul jeu de classes `CLASSES`, `refuse` → token `attention` ambre, toujours en contour). **Vivant** : importé par `apps/web/src/ecrans/ventes/suivi/CelluleFinancementSuivi.tsx:7` (utilisé dans `EcranSuiviVentes`).
- `apps/web/src/ecrans/ventes/financements/BadgeStatutFinancement.tsx` (patron canonique à jour, `refuse` → token `danger` rouge, en contour ; `en_attente`/`confirme` en plein). **Vivant** : importé par `apps/web/src/ecrans/ventes/financements/CarteFinancement.tsx:11`, elle-même montée dans `apps/web/src/ecrans/ventes/dossiers/EcranFicheDossierVente.tsx:146`.

Conséquence concrète : un financement « Refusé » s'affiche en **ambre contour** sur l'écran de suivi des ventes et en **rouge contour** sur la fiche du dossier — pour le même dossier, le même jour. Un garagiste qui passe de l'un à l'autre apprend deux couleurs pour le même fait.

**`BadgeStatutReprise` existe aussi en double**, mais l'un des deux exemplaires est du code mort :

- `apps/web/src/ecrans/ventes/dossiers/BadgeStatutReprise.tsx` — **aucun importeur trouvé** en dehors de son propre fichier de test (`grep` sur toute l'app : zéro résultat hors `.spec.tsx`). Divergences avec la version vivante si jamais remontée par erreur : icône `FileText` au lieu de `Circle` pour `estimee`, `refusee` en token `attention` (ambre) au lieu de `danger` (rouge), pas de distinction plein/contour.
- `apps/web/src/ecrans/ventes/reprises/BadgeStatutReprise.tsx` — version vivante et à jour, importée par `CarteReprise.tsx:18`.

**Correction proposée** : supprimer les deux fichiers `ventes/dossiers/BadgeStatut{Financement,Reprise}.tsx`, faire pointer `CelluleFinancementSuivi.tsx` vers `ventes/financements/BadgeStatutFinancement.tsx` (déjà cohérent avec `CarteFinancement`). Périmètre disjoint évident : un seul agent, deux imports à changer, deux fichiers à retirer.

---

## Famille 2 — Couleurs ambre/bleu en dur avec variante `dark:` alors qu'il n'existe aucun mode sombre (cohérence + dette, gravité moyenne)

Trois fichiers, et seulement trois dans toute la base (`grep -rl "dark:"` confirmé), utilisent des classes Tailwind `dark:*` :

- `apps/web/src/ecrans/pneus/composants/BadgeSaisonPneu.tsx:31-32` — `amber-*`/`sky-*` en dur, avec `dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200` etc. Le commentaire (lignes 18-20) justifie le choix de couleurs fixes hors palette `--statut-*` (bonne décision métier : été/hiver n'est pas un statut à sémantique success/danger), mais pas la variante `dark:`.
- `apps/web/src/ecrans/console/BandeauContexteConsole.tsx:54` — `bg-amber-400`/`dark:bg-amber-600` etc.
- `apps/web/src/ecrans/console/BadgeStatutGarage.tsx:31` — `bg-amber-600`/`dark:bg-amber-500` pour le token `attention`.

`apps/web/src/index.css` ne définit aucun sélecteur `.dark` et aucune stratégie de thème sombre n'est documentée : ces classes `dark:` ne s'activeront jamais dans l'état actuel de l'app. Ce n'est pas qu'un mort-code cosmétique — la présence de `dark:` dans exactement ces 3 fichiers et nulle part ailleurs donne l'illusion trompeuse que le mode sombre est une fonctionnalité partiellement câblée, alors que c'est un vestige isolé.

Second problème dans `BadgeStatutGarage.tsx:31` : le token `attention` y est réimplémenté en `amber-600`/`amber-500` au lieu de consommer `--statut-attention` (déjà utilisé correctement à la ligne 27 pour `critique` via `bg-destructive`). Rien ne justifie que la console plateforme échappe au token partagé — contrairement à `BadgeSaisonPneu`, il n'y a pas de doctrine métier qui l'exige ici.

**Correction proposée** : retirer les trois variantes `dark:` (mort-code). Pour `BadgeStatutGarage.tsx`, remplacer `amber-600`/`amber-500` par `--statut-attention` comme le reste du produit. `BandeauContexteConsole.tsx` et `BadgeSaisonPneu.tsx` peuvent garder leurs couleurs fixes hors palette (justification métier documentée), juste sans `dark:`.

---

## Famille 3 — Cibles tactiles sous 44px sur des écrans tactiles (accessibilité, gravité moyenne-haute)

`apps/web/src/components/ui/button.tsx:23` définit `size: sm` à `h-10` (40px), sous le seuil de 44px que le même fichier documente en commentaire (`ligne 7-8 : "cibles tactiles >=44px obligatoires (tablette d'atelier)"`) — la taille par défaut (`h-11`, ligne 22) et `icon` (`h-11 w-11`, ligne 25) respectent la règle, `sm` y déroge silencieusement. C'est un fichier primitive, hors périmètre d'écriture ici, mais l'usage réel de `size="sm"` sur des écrans tactiles mérite d'être signalé pour dispatch :

- `apps/web/src/ecrans/pieces/EcranRechercheComptoirPieces.tsx:126,135` — comptoir pièces, poste tactile par doctrine CONTRIBUTING.md.
- `apps/web/src/ecrans/pneus/EcranHangarPneus.tsx:280,288` et `apps/web/src/ecrans/pneus/composants/CarteJeuPneu.tsx:111,119,124` — hangar pneus, dépôt/sortie au comptoir.
- `apps/web/src/ecrans/pointage/VueEquipePointage.tsx:227` et `apps/web/src/ecrans/pointage/DialogueCloturePeriode.tsx:250` — pointage, tablette d'atelier par doctrine.
- `apps/web/src/ecrans/pieces/EcranReservationsPieces.tsx:142,153`, `EcranFicheCommandeFournisseur.tsx:252`, `EcranConsignesPieces.tsx:161` — plutôt bureau, gravité moindre.

**Correction proposée** : soit relever `size: sm` à `h-11` dans la primitive (décision qui appartient à l'agent tokens en cours), soit — si `sm` doit rester compact pour des écrans desktop denses — remplacer `size="sm"` par `size="default"` sur les boutons d'action des écrans tactiles listés ci-dessus. Nécessite une décision d'abord (qui possède `button.tsx` en ce moment), puis un dispatch mécanique.

---

## Famille 4 — Montants sans `tabular-nums` (cosmétique, gravité basse)

`tabular-nums` est déjà large (102 occurrences, 40+ fichiers). Six endroits rendent un montant sans :

- `apps/web/src/ecrans/ventes/dossiers/EnTeteDossierVente.tsx:231`
- `apps/web/src/ecrans/ventes/dossiers/PanneauActionsDossierVente.tsx:290,444`
- `apps/web/src/ecrans/atelier/EnTeteOrdreReparation.tsx:212`
- `apps/web/src/ecrans/vehicules/PanneauTravauxReportes.tsx:353`
- `apps/web/src/composants/vehicule/ListeTravauxReportes.tsx:74`
- `apps/web/src/composants/motifs/ListeElementsBloquants.tsx:68`

Gravité basse car ce sont des montants isolés en en-tête ou en liste verticale à une colonne (pas un tableau de chiffres empilés où l'œil compare visuellement) — l'effet « ça danse » que la consigne cible est surtout un problème de colonnes alignées, absent ici. À corriger par cohérence plutôt que par urgence.

---

## Ce qui n'est PAS un problème (vérifié, pour éviter un dispatch inutile)

- **États chargement/vide/erreur** : couverts partout sur les écrans de liste prioritaires (OR, clients, factures, véhicules, articles, commandes/fournisseurs, dossiers de vente, stock véhicules), via les composants partagés `EtatChargement`/`EtatErreur`/`EtatVide*`. Aucun écran trouvé où le vide se confond avec une erreur ou où le chargement est silencieux.
- **Densité des listes** : unifiée par construction, tous les écrans de liste métier passent par `composants/comptoir/TableComptoir.tsx`.
- **Badges informatifs neutres** (`BadgeTypeClient`, `BadgeImporte`, `BadgeLangueCorrespondance`, `BadgeIdentificationIncomplete`, `BadgeEcheanceExpertise`) : cohérents entre eux, tous `border-input bg-background text-muted-foreground`, délibérément hors palette `--statut-*` — pas une divergence, une doctrine assumée et respectée.
- Aucune couleur hexadécimale en dur trouvée dans `ecrans/`/`composants/` — les seules couleurs brutes sont les classes Tailwind déjà listées en famille 2.

---

## Les trois corrections à faire en premier

1. **Famille 1 (badges dupliqués financement/reprise)** — le seul défaut qui produit une incohérence _visible en usage réel_, pas seulement dans le code : le même dossier de vente change de couleur de badge selon l'écran. Deux imports à rebrancher, deux fichiers morts à retirer. Effort : une heure. Impact : élimine la seule contradiction visuelle qu'un garagiste peut réellement remarquer.
2. **Famille 3 (`size="sm"` à 40px sur comptoir/hangar pneus/pointage)** — ce sont exactement les postes tactiles que CONTRIBUTING.md cite en exemple (« pointage, signature client »). Sept fichiers à corriger une fois la décision prise sur `button.tsx`. Impact accessibilité direct pour le personnel d'atelier.
3. **Famille 2 (`dark:` mort dans 3 fichiers + `amber` en dur dans `BadgeStatutGarage`)** — petit effort (suppression de code mort + un remplacement de classe), mais évite qu'un futur agent construise sur l'illusion qu'un mode sombre est amorcé quelque part.
