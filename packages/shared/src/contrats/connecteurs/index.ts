/**
 * Contrats de l'étape 5 — Connecteurs (`docs/specification-etape-5-connecteurs.md`, repères
 * `RC-xx`). Socle commun aux sept familles (OEM, plateformes d'annonces, fiduciaires, banques,
 * fournisseurs de pièces, administration, messagerie) : déclaration d'un type de connecteur,
 * activation par tenant, secrets référencés, état de santé, journal d'exécution, reprise après
 * échec, import et export génériques, déclenchement (manuel/planifié/événementiel), abonnements
 * webhook, envoi de message client. La famille `messagerie` et l'interface `NotificationSender`
 * viennent d'un second document, `docs/specification-relances-automatiques.md` §6.3 — pas un
 * `RC-xx` : le module de relances automatiques ne peut exister sans cette sixième interface.
 *
 * Point d'entrée unique du domaine, même règle que `contrats/pieces/index.ts` : tout ce qui est
 * exporté ici est GELÉ au nom près et à la signature près une fois validé par l'orchestrateur. Un
 * écart nécessaire se remonte, il ne se code pas « en attendant ».
 *
 * `primitives.ts` n'est PAS réexporté ici — même règle que les autres domaines : ses symboles sont
 * internes au domaine connecteurs, les primitives génériques déjà publiques restent celles de
 * `contrats/atelier/primitives`.
 *
 * PRINCIPE D'ARCHITECTURE PORTÉ PAR CE MODULE (`ARCHITECTURE.md` §5, rappelé dans chaque fichier) :
 * le cœur ne connaît AUCUNE marque, AUCUNE plateforme, AUCUN partenaire nommé. Un partenaire est
 * une DONNÉE (`ReponseTypeConnecteur.code`), jamais une valeur de type — le cœur ne connaît que
 * des FAMILLES fonctionnelles (`FamilleConnecteur`) et des interfaces stables
 * (`NomInterfaceConnecteur`).
 *
 * Règle de compatibilité opposable à toute revue future, reprise à l'identique des autres
 * domaines : un client de cette API doit ignorer les champs qu'il ne connaît pas et ne doit jamais
 * échouer sur une valeur d'enum inconnue.
 */

export * from './enums';
export * from './connecteur';
export * from './sante';
export * from './execution';
export * from './import';
export * from './export';
export * from './declenchement';
export * from './webhook';
export * from './notification-sender';
