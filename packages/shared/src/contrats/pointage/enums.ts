/**
 * Enums propres au domaine Pointage (lot 2).
 *
 * Ce qui N'EST PAS ici, volontairement : `StatutPointage`, `SourcePointage`,
 * `NatureActivitePointage` et `StatutPeriodePointage` sont déjà déclarés par avance dans
 * `contrats/atelier/enums.ts` (section « Pointage — déclaré au lot 1, servi au lot 2 ») et sont
 * réutilisés PAR IMPORT dans ce domaine, jamais redéclarés ici ni réexportés par
 * `pointage/index.ts` — un `export *` en dupliquerait le nom dans le barrel `@dfa/shared` (même
 * règle que `pieces/primitives.ts` vis-à-vis d'`atelier/primitives.ts`, §11.1 du contrat étape 1).
 *
 * Rappel de ce qui vit déjà côté atelier, pour qui lit ce fichier sans l'autre sous les yeux :
 *  - `StatutPointage` = `'en_cours' | 'termine' | 'valide' | 'verrouille'` — **GELÉ**.
 *  - `SourcePointage` = `'ecran_atelier' | 'badge' | 'mobile' | 'saisie'` — extensible.
 *  - `NatureActivitePointage` = `'productif_ligne' | 'productif_or' | 'indirect'` — extensible.
 *    **C'est le discriminant des TROIS CIBLES de RM-87** (ligne d'OR précise / OR sans ligne
 *    précise / activité indirecte). Il n'existe PAS de second enum « cible » à côté de celui-ci :
 *    `NatureActivitePointage` EST déjà ce discriminant, posé un lot à l'avance très précisément
 *    pour cet usage — c'est pourquoi le champ `nature` de `ReponsePointage` et de
 *    `schemaDemarragePointage` (`pointage.ts`) n'impose AUCUNE valeur par défaut ni restriction :
 *    le paramétrage P-33 (granularité proposée par défaut à l'écran) ne change QUE ce que
 *    l'interface propose en premier, jamais ce que l'API accepte (spécification §4 : « Ce n'est
 *    pas un verrou : quel que soit le défaut, RM-87 autorise toujours les deux formes
 *    d'événement »).
 *  - `StatutPeriodePointage` = `'ouverte' | 'verrouillee'` — extensible.
 */

/**
 * `activite_indirecte_pointage` — extensible (`x-dfa-enum-extensible: true`, §11.2). Catalogue
 * RM-87 / §5 de la spécification, VERBATIM du namespace i18n déjà complet et à parité FR/DE/IT
 * (`apps/web/src/i18n/locales/{fr,de,it}/pointage.json`, clé `activites.*`) : sept tuiles déjà
 * traduites. Valeurs en snake_case pour suivre la convention enum de l'API
 * (`activites.attentePieces` → `attente_pieces`). Rien d'inventé : la spécification dit
 * explicitement « rien à ajouter sur la liste elle-même » (§5).
 */
export const ACTIVITES_INDIRECTES = [
  'nettoyage',
  'attente_pieces',
  'attente_accord',
  'magasin',
  'formation',
  'pause',
  'absence',
] as const;
export type ActiviteIndirecte = (typeof ACTIVITES_INDIRECTES)[number];

/**
 * `motif_anomalie_pointage` — extensible. Les SIX premières valeurs sont le miroir EXACT des clés
 * `pointage:anomalies.motifs.*` déjà posées en FR/DE/IT — ne pas en inventer une variante
 * (`dureeTrop`, `nuit`, `chevauchement`, `periodeVerrouillee`, `orFacture`, `ligneNonPointable`).
 *
 * `ligne_non_pointable` joue DEUX rôles distincts, volontairement partagés — la spécification les
 * réunit explicitement (§7, RM-93, RM-123), ce n'est pas un raccourci pris ici :
 *  (a) code de refus BLOQUANT (`POINTAGE_LIGNE_NON_POINTABLE`, `probleme.ts`, 409) quand un
 *      pointage essaie de DÉMARRER sur une ligne `a_valider` / `refusee` / `annulee` (RM-93) ;
 *  (b) motif d'ANOMALIE, non bloquant, posé sur un pointage DÉJÀ OUVERT quand la ligne devient
 *      `annulee` / `refusee` PENDANT que le pointage tourne (RM-123 : on ne l'interrompt pas de
 *      force, on le signale au prochain événement le concernant).
 *
 * `derive_horloge` — absente du namespace i18n actuel au moment de son ajout.
 * Source : `plan-etape-1-frontend.md` §4.3 point 6 (dérive d'horloge mesurée au dernier échange
 * réussi, anomalie si l'écart dépasse un seuil) — le mécanisme est déjà spécifié et déjà justifié
 * métier (une tablette hors ligne plusieurs heures a une horloge qui dérive), seul le NOM du
 * motif est neuf ici. CONSÉQUENCE SIGNALÉE À L'ÉPOQUE, TOUJOURS VRAIE : une clé
 * `anomalies.motifs.deriveHorloge` doit être ajoutée aux trois fichiers
 * `apps/web/src/i18n/locales/{fr,de,it}/pointage.json` avant qu'un écran puisse l'afficher — sans
 * elle, l'enum accepte la valeur (il est extensible) mais la corbeille d'anomalies n'a rien à
 * rendre pour ce motif précis : un repli générique, pas un crash, mais un motif muet à l'écran.
 *
 * `cloture_fin_journee` — AJOUTÉE le 14.08.2026 (RM-91/RM-119, clôture automatique de fin de
 * journée à l'heure de fermeture du site, `parametre_site.heure_cloture_pointage`/P-31). AUCUNE
 * des six valeurs précédentes ne porte ce sens : `nuit` est un CHEVAUCHEMENT de nuit (deux
 * pointages, horloge en désordre — voir `pointage:anomalies.motifs.nuit` = « Chevauchement de
 * nuit », `apps/web/src/i18n/locales/fr/pointage.json`), pas un pointage simplement oublié ouvert
 * au-delà de l'heure de fermeture. `docs/specification-pointage.md` §3.3/§11/§12 (RM-91, RM-119,
 * CT-57) encadre ce motif explicitement comme distinct — pas un raccourci pris ici. MÊME
 * CONSÉQUENCE QUE `derive_horloge` CI-DESSUS, SIGNALÉE ICI POUR LA MÊME RAISON : aucune clé
 * `anomalies.motifs.clotureFinJournee` n'existe encore dans le namespace i18n `pointage` —
 * l'enum accepte la valeur (extensible), la corbeille d'anomalies n'a rien à rendre pour elle tant
 * que cette clé n'est pas ajoutée aux trois locales. Voir le rapport de livraison du chantier qui a
 * introduit ce motif pour le détail du mécanisme de clôture automatique lui-même
 * (`apps/api/src/pointage/service-cloture-automatique-pointage.ts`).
 */
export const MOTIFS_ANOMALIE_POINTAGE = [
  'duree_trop',
  'nuit',
  'chevauchement',
  'periode_verrouillee',
  'or_facture',
  'ligne_non_pointable',
  'derive_horloge',
  'cloture_fin_journee',
] as const;
export type MotifAnomaliePointage = (typeof MOTIFS_ANOMALIE_POINTAGE)[number];

/**
 * Segments d'action de la machine à états du pointage (§10 de la spécification), même convention
 * que `ACTIONS_ORDRE_REPARATION` (`atelier/enums.ts`) : kebab-case, infinitif, chaque segment
 * implique `POST` seul.
 *
 * `demarrer` N'Y FIGURE PAS, délibérément : comme pour l'OR (`ACTIONS_ORDRE_REPARATION` n'a pas
 * de `creer`), démarrer un pointage EST la création de la ressource (`POST /pointages`), pas une
 * action sur une ressource déjà existante.
 *
 * Il n'existe PAS de segment `pause` / `reprendre` (RM-116, §3.1 de la spécification) : une pause
 * est DEUX appels ordinaires — `arreter` puis un nouveau `POST /pointages` sur l'activité
 * `pause` — jamais un troisième état ni une troisième action.
 *
 * `valider` — HYPOTHÈSE, à confirmer avec l'équipe métier (voir `pointage.ts` pour le détail) : la
 * machine à états §10 de la spécification montre `termine → valide` sans nommer qui déclenche
 * cette transition ni pourquoi ; ce fichier lui donne un nom d'action plutôt que de la laisser
 * sans contrat.
 */
export const ACTIONS_POINTAGE = ['arreter', 'corriger', 'valider'] as const;
export type ActionPointage = (typeof ACTIONS_POINTAGE)[number];
