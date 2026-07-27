import { Global, Module } from '@nestjs/common';
import { MiddlewareContexteRequete, ServiceContexteRequete } from './contexte';
import { GardeDroit } from './droits';
import { FiltreProbleme } from './erreurs';
import { HorlogeModule } from './horloge';
import { JournalModule } from './journal';
import { LimitationModule } from './limitation';

/**
 * Regroupe l'infrastructure transverse (contexte de requête, journalisation, horloge,
 * limitation de débit, filtre d'erreurs global) partagée par tous les modules métier.
 * Global : ces services s'injectent depuis n'importe quel module sans réimport explicite.
 * Importé une fois depuis `AppModule`.
 *
 * `FiltreProbleme` est fourni ici comme classe injectable ORDINAIRE (pas en `APP_FILTER`) :
 * l'ordre imposé par le contrat pose le filtre global explicitement dans `main.ts`
 * (`app.useGlobalFilters(app.get(FiltreProbleme))`), après la vérification de posture RLS et
 * avant `cookie-parser`/CORS. Un enregistrement en `APP_FILTER` doublerait ce câblage.
 */
@Global()
@Module({
  imports: [HorlogeModule, JournalModule, LimitationModule],
  providers: [ServiceContexteRequete, MiddlewareContexteRequete, GardeDroit, FiltreProbleme],
  exports: [
    ServiceContexteRequete,
    MiddlewareContexteRequete,
    GardeDroit,
    FiltreProbleme,
    HorlogeModule,
    JournalModule,
    LimitationModule,
  ],
})
export class CommonModule {}
