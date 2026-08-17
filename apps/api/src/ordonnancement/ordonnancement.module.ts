import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { JETON_CONFIG, type Config } from '../config';

import { analyserUrlRedisPourBullMq } from './analyser-url-redis';

/**
 * Socle d'ordonnancement — PREMIER ordonnanceur de ce dépôt (mesuré, pas supposé : ni
 * `@nestjs/schedule` ni BullMQ n'étaient des dépendances installées avant ce chantier — voir
 * `apps/api/src/pointage/service-cloture-automatique-pointage.ts` et
 * `apps/api/src/relances/service-relances-facture.ts`, qui documentaient tous deux ce trou).
 *
 * CHOIX : BullMQ (`@nestjs/bullmq`) plutôt que `@nestjs/schedule`, pour deux raisons pesées
 * explicitement :
 *   1. l'API tournera à terme en PLUSIEURS instances. Un `@Cron` `@nestjs/schedule` est un
 *      minuteur EN PROCESS : chaque instance porte le sien, donc un déclenchement attendu UNE
 *      fois se produirait N fois (N réimports concurrents du référentiel véhicules, par exemple).
 *      Un job planifié BullMQ (`Queue.upsertJobScheduler`, voir
 *      `../vehicules/referentiel/referentiel-vehicules-ch-job.module.ts`) vit dans REDIS, pas
 *      dans le process : quel que soit le nombre d'instances API, une seule consomme chaque tick
 *      — sans verrou distribué à écrire ni à maintenir à la main.
 *   2. Redis est déjà une dépendance de production de ce dépôt (`ioredis`, limitation de débit +
 *      verrouillage PIN pointage) — BullMQ n'ajoute donc pas de nouvelle INFRASTRUCTURE, juste
 *      une bibliothèque cliente. En échange, il donne gratuitement ce qu'un `@Cron` + verrou
 *      maison n'offre pas : jobs durables et rejouables (survivent à un redémarrage de l'API),
 *      historique/observabilité par job (statut, tentatives, erreur), et retries configurables —
 *      utile en particulier pour un job qui dépend d'une source TIERCE (opendata.astra.admin.ch)
 *      pouvant échouer sans faute du code.
 *
 * RÉUTILISABLE SANS ÊTRE REFAIT par le prochain besoin de planification déjà identifié dans ce
 * dépôt — la clôture automatique de fin de journée du pointage
 * (`pointage/service-cloture-automatique-pointage.ts`, non câblée à un déclencheur, HORS
 * PÉRIMÈTRE de ce chantier) : un futur `PointageJobModule` n'a qu'à importer `OrdonnancementModule`
 * (ou compter sur son caractère `@Global`), poser `BullModule.registerQueue({ name: ... })` et son
 * propre `@Processor`, exactement comme `ReferentielVehiculesChJobModule` le fait pour l'import
 * ASTRA. Reste à décider pour ce futur job (pas ici) : l'énumération des tenants à traiter à
 * chaque passage (voir le commentaire de tête du service, § point 2) et l'identité d'appel du
 * déclencheur (§ point 3).
 *
 * `forRootAsync` + `inject: [JETON_CONFIG]` — PAS une instance `Redis` construite à la main
 * (voir `analyser-url-redis.ts` pour la raison : BullMQ possède et ferme lui-même la connexion
 * qu'il construit à partir d'options plates). Le facteur est différé à l'instanciation RÉELLE du
 * module par Nest (jamais exécuté par un simple appel statique comme `AppModule.pourConfig(...)`
 * dans un test qui n'instancie jamais le conteneur — voir `vehicules/vehicules.module.spec.ts`,
 * qui appelle exactement ça).
 *
 * `@Global()` implicite via `BullModule` lui-même : chaque module de job importe `BullModule.
 * registerQueue(...)` explicitement (voir `referentiel-vehicules-ch-job.module.ts`), qui se
 * raccroche automatiquement à la configuration partagée posée ici par `forRootAsync` — ce module
 * n'a donc PAS besoin d'être lui-même `@Global`, il suffit qu'il soit importé UNE FOIS, à la
 * racine (`app.module.ts`).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [JETON_CONFIG],
      useFactory: (config: Config) => ({
        connection: analyserUrlRedisPourBullMq(config.REDIS_URL),
      }),
    }),
  ],
  exports: [BullModule],
})
export class OrdonnancementModule {}
