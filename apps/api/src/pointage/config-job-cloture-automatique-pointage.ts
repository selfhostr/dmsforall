import { z } from 'zod';

/**
 * Configuration du job quotidien de clôture automatique de fin de journée du pointage
 * (RM-91/RM-119/CT-57) — voir `service-cloture-automatique-pointage.ts` (le service métier,
 * déjà livré et testé, jusqu'ici sans déclencheur) et `ordonnanceur-cloture-automatique-
 * pointage.ts` (le déclencheur BullMQ posé par ce chantier).
 *
 * MÊME DOCTRINE que `vehicules/referentiel/config-job-referentiel-vehicules-ch.ts` (modèle
 * explicitement désigné par la consigne de ce chantier, LECTURE SEULE — rien de ce fichier-là
 * n'est modifié ici) — TRISTATE, jamais un booléen à défaut fixe : un défaut « désactivé partout »
 * reproduirait exactement le trou qu'on comble (un technicien qui oublie de pointer sa sortie
 * reste « en cours » indéfiniment tant que personne ne pense à activer la variable en
 * production — précisément le défaut qui a coûté la panne ASTRA du 17.08.2026, même mécanisme).
 * Actif par défaut en PRODUCTION, inactif ailleurs, forçage EXPLICITE dans les deux sens.
 *
 * Fusionnée dans `schemaConfig` par `apps/api/src/config/charger-config.ts` via
 * `...schemaConfigJobClotureAutomatiquePointage.shape` — POINT DE CONTACT hors du périmètre
 * d'écriture exclusif de ce lot (`config/` n'y figure pas). Ajout d'UNE ligne d'import + UNE
 * ligne de fusion, signalé explicitement dans le rapport de livraison, même geste que les trois
 * blocs déjà fusionnés là (courriel, console, ASTRA) — sans cette fusion, les deux variables
 * ci-dessous sont silencieusement ignorées par zod (`schemaConfig` ne les connaît pas) et
 * `ConfigAvecJobClotureAutomatiquePointage` ci-dessous, bien que typé correctement, recevrait des
 * valeurs `undefined` au runtime même quand l'opérateur les a posées dans `.env`.
 */
export const schemaConfigJobClotureAutomatiquePointage = z.object({
  /**
   * Interrupteur EXPLICITE, TRISTATE (voir l'en-tête de fichier pour le sens du défaut).
   * `undefined` (variable absente ou vide) laisse `clotureAutomatiquePointageJobDoitEtreActif`
   * DÉCIDER selon `NODE_ENV`. `'true'`/`'false'` EXPLICITES forcent dans les deux sens, quel que
   * soit `NODE_ENV`.
   */
  POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['true', 'false']).optional(),
  ),
  /**
   * Expression cron (5 champs, BullMQ — fuseau UTC, jamais l'heure locale du conteneur) du
   * passage quotidien. Défaut `30 0 * * *` (00:30 UTC).
   *
   * JUSTIFICATION DE L'HEURE (consigne de ce chantier : ne pas inventer une heure, réutiliser ce
   * que `journeeTravailCourante` définit déjà comme journée de travail — `regles-pointage.ts`) :
   * une journée civile suisse (`common/temps/fuseau-suisse.ts::finJourneeSuisse`) se termine à
   * `23:59:59.999` heure de Zurich. `parametre_site.heure_cloture_pointage` (P-31, colonne SQL
   * `time`) est BORNÉE par construction à l'intérieur de cette même journée civile — aucun site
   * ne peut porter une heure de clôture postérieure à minuit suisse, le type de la colonne
   * l'interdit. Il suffit donc que le job se déclenche À N'IMPORTE QUEL INSTANT APRÈS minuit
   * suisse pour être GARANTI d'avoir dépassé l'heure de clôture configurée de TOUS les sites pour
   * la journée qui vient de se terminer — pas besoin de connaître l'heure de fermeture la plus
   * tardive parmi tous les tenants/sites, la borne du domaine (`time` ≤ 23:59:59.999) le garantit
   * structurellement. Décider autrement (deviner « la plupart des garages ferment vers 18h-19h,
   * disons 22h pour être large ») aurait été une heure inventée, coupant potentiellement une
   * équipe du soir dont le site configure une clôture tardive (P-31 est un paramètre LIBRE, pas
   * borné à une plage « raisonnable » côté schéma).
   *
   * `00:30` (et non `00:00` pile) — cinq minutes après minuit CEST (heure d'été, l'écart le plus
   * défavorable : minuit Zurich = 22:00 UTC en été, 23:00 UTC en hiver) garantirait déjà la
   * propriété ci-dessus ; la marge de 30 minutes est prise pour la même raison que le décalage de
   * l'ASTRA (`17 4 * * *`, jamais une heure ronde) : ne pas cogner une éventuelle tâche de
   * maintenance externe programmée pile à minuit UTC, et laisser le temps à une horloge serveur
   * légèrement en avance de ne jamais déclencher AVANT minuit Zurich même dans le pire cas (CEST).
   * `determinerDecisionClotureAutomatique` (`regles-pointage.ts`) reste de toute façon la garde
   * ultime : même si ce cron se déclenchait par erreur avant l'heure de clôture d'un site, aucun
   * pointage de ce site ne serait clos avant l'heure due — cette expression cron ne fait que
   * borner QUAND le job passe voir, jamais QUAND il ferme.
   *
   * Cadence QUOTIDIENNE (pas horaire) : conforme au nom même de la règle (« clôture automatique
   * de FIN DE JOURNÉE », RM-91/RM-119) et au patron ASTRA — un pointage resté ouvert après
   * l'heure de clôture de son site n'est de toute façon vu (et corrigé) par le chef d'atelier que
   * le lendemain matin (voir l'en-tête de `service-cloture-automatique-pointage.ts`) : rien ne
   * justifie une cadence plus fine que « une fois par nuit », et cela minimise la charge sur le
   * pool de connexions partagé par tous les tenants (`DATABASE_POOL_MAX`).
   */
  POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON: z.string().min(1).default('30 0 * * *'),
});

/**
 * Forme MINIMALE de `Config` nécessaire à ce module — structurelle, volontairement PAS
 * `Pick<Config, …>` (même raison que `ConfigAvecJobReferentielVehiculesCh` : importer `Config`
 * depuis `charger-config.ts` créerait un cycle).
 */
export interface ConfigAvecJobClotureAutomatiquePointage {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: 'true' | 'false' | undefined;
  readonly POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON: string;
  /** Rôle `dfa_migrator` — seul canal utilisé par ce job pour énumérer les tenants actifs (voir
   *  `enumerer-tenants-actifs-pointage.ts`), jamais `DATABASE_URL`/`AccesBase`. */
  readonly DATABASE_URL_MIGRATION: string;
}

/**
 * SEUL point de décision entre job actif/inactif — même patron que
 * `referentielVehiculesChJobDoitEtreActif` (`vehicules/referentiel/config-job-referentiel-
 * vehicules-ch.ts`), même sens de défaut (risque ici aussi l'OUBLI, pas l'envoi accidentel) :
 *
 *   - variable EXPLICITE (`'true'`/`'false'`) -> elle gagne, quel que soit `NODE_ENV` ;
 *   - variable ABSENTE -> actif SEULEMENT en production, inactif en `development`/`test`.
 */
export function clotureAutomatiquePointageJobDoitEtreActif(
  config: ConfigAvecJobClotureAutomatiquePointage,
): boolean {
  if (config.POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF !== undefined) {
    return config.POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF === 'true';
  }
  return config.NODE_ENV === 'production';
}
