/**
 * Rôle du process (chantier « socle d'ordonnancement — découplage worker/API », 27.08.2026) —
 * SEUL point de décision entre les trois rôles, lu depuis la config validée
 * (`MODE_PROCESSUS`, `config/charger-config.ts`). Jamais une comparaison directe
 * `config.MODE_PROCESSUS === 'worker'` dispersée dans chaque module de job : les deux fonctions
 * ci-dessous portent le sens réel (« ce mode doit-il traiter des files BullMQ ? » / « ce mode
 * doit-il servir du HTTP métier ? ») plutôt que la valeur brute de l'énumération, pour que
 * l'ajout d'un futur quatrième mode (hypothétique) ne demande qu'une modification ICI.
 *
 * Structure minimale plutôt que `Pick<Config, 'MODE_PROCESSUS'>` — même doctrine que
 * `ConfigAvecConsole` (`exploitation/config-console.ts`) et `ConfigAvecJobReferentielVehiculesCh`
 * (`vehicules/referentiel/config-job-referentiel-vehicules-ch.ts`) : importer `Config` depuis
 * `config/charger-config.ts` dans un module de domaine créerait un cycle inutile pour un besoin
 * qui ne porte que sur UN champ.
 *
 * CE QUI EST GATÉ PAR `modeIncluTraitementFilesAttente` — les DEUX familles de providers d'un
 * bundle de job (jamais une seule des deux, voir `pointage/pointage-cloture-automatique-job.module.ts`
 * pour le patron complet appliqué aux quatre bundles du dépôt) :
 *   - le `@Processor`/`WorkerHost` qui CONSOMME la file (le cœur de l'exigence 1 du chantier :
 *     absent du graphe Nest en mode 'api', pas seulement inactif) ;
 *   - l'ordonnanceur `OnApplicationBootstrap` qui POSE le job planifié (`Queue.upsertJobScheduler`)
 *     — pas strictement exigé par l'exigence 1 (qui ne parle que du processeur), mais gaté quand
 *     même par cohérence : c'est le WORKER qui porte la responsabilité de « piloter le travail de
 *     fond », jamais l'API. Un `upsertJobScheduler` posé par CHAQUE instance API à chaud n'aurait
 *     rien cassé (idempotent), mais n'aurait aucune raison d'exister là.
 *
 * CE QUI N'EST JAMAIS GATÉ par ce fichier — les producteurs (`@InjectQueue`, `queue.add(...)`,
 * ex. `ServiceAnalyseReprise.lancer`, `ServiceDeclenchementExportResiliation.declencher`) : un
 * `Queue` producteur ne fait que publier, il ne consomme rien et ne connecte aucun `Worker` à
 * Redis — il reste TOUJOURS disponible, y compris en mode 'api' pur, parce que c'est justement
 * lui qu'un endpoint HTTP appelle pour poser un job (voir le rapport de livraison du chantier
 * pour la liste des producteurs identifiés et pourquoi chacun reste hors de ce gate).
 */

export type ModeProcessus = 'api' | 'worker' | 'combine';

export interface ConfigAvecModeProcessus {
  readonly MODE_PROCESSUS: ModeProcessus;
}

/** Ce mode doit-il servir du HTTP métier (contrôleurs, `NestFactory.create` + `app.listen`) ? */
export function modeIncluTraitementHttp(config: ConfigAvecModeProcessus): boolean {
  return config.MODE_PROCESSUS === 'api' || config.MODE_PROCESSUS === 'combine';
}

/** Ce mode doit-il enregistrer les processeurs/ordonnanceurs BullMQ (consommer des files) ? */
export function modeIncluTraitementFilesAttente(config: ConfigAvecModeProcessus): boolean {
  return config.MODE_PROCESSUS === 'worker' || config.MODE_PROCESSUS === 'combine';
}
