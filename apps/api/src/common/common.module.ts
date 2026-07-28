import { Global, Module } from '@nestjs/common';
import { JETON_AUDIT, ServiceAuditImpl } from './audit';
import { MiddlewareContexteRequete, ServiceContexteRequete } from './contexte';
import { GardeDroit } from './droits';
import { JETON_EVENEMENTS, ServiceEvenementsImpl } from './evenements';
import { FiltreProbleme } from './erreurs';
import { HorlogeModule } from './horloge';
import { JETON_IDEMPOTENCE, ServiceIdempotenceImpl } from './idempotence';
import { JournalModule } from './journal';
import { LimitationModule } from './limitation';

/**
 * Regroupe l'infrastructure transverse (contexte de requête, journalisation, horloge,
 * limitation de débit, filtre d'erreurs global, idempotence, événements métier, lecture d'audit)
 * partagée par tous les modules métier. Global : ces services s'injectent depuis n'importe quel
 * module sans réimport explicite. Importé une fois depuis `AppModule`.
 *
 * `FiltreProbleme` est fourni ici comme classe injectable ORDINAIRE (pas en `APP_FILTER`) :
 * l'ordre imposé par le contrat pose le filtre global explicitement dans `main.ts`
 * (`app.useGlobalFilters(app.get(FiltreProbleme))`), après la vérification de posture RLS et
 * avant `cookie-parser`/CORS. Un enregistrement en `APP_FILTER` doublerait ce câblage.
 *
 * `JETON_IDEMPOTENCE` / `JETON_EVENEMENTS` / `JETON_AUDIT` : fournis par jeton (`Symbol.for`,
 * comme `JETON_DB`) et non par classe — les modules métier (clients, véhicules, atelier)
 * dépendent de l'interface, jamais de l'implémentation SQL. Ni ce module ni ses providers
 * n'importent `DbModule` explicitement : `DbModule` est lui aussi `@Global`, et `AppModule` importe
 * les deux (précédent déjà en place : `SocleModule` injecte `JETON_DB` sans importer `DbModule`).
 */
@Global()
@Module({
  imports: [HorlogeModule, JournalModule, LimitationModule],
  providers: [
    ServiceContexteRequete,
    MiddlewareContexteRequete,
    GardeDroit,
    FiltreProbleme,
    { provide: JETON_IDEMPOTENCE, useClass: ServiceIdempotenceImpl },
    { provide: JETON_EVENEMENTS, useClass: ServiceEvenementsImpl },
    { provide: JETON_AUDIT, useClass: ServiceAuditImpl },
  ],
  exports: [
    ServiceContexteRequete,
    MiddlewareContexteRequete,
    GardeDroit,
    FiltreProbleme,
    HorlogeModule,
    JournalModule,
    LimitationModule,
    JETON_IDEMPOTENCE,
    JETON_EVENEMENTS,
    JETON_AUDIT,
  ],
})
export class CommonModule {}
