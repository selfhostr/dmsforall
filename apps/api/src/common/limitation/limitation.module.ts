import { Global, Module } from '@nestjs/common';
import { HorlogeModule } from '../horloge/horloge.module';
import { JETON_SERVICE_LIMITATION_DEBIT } from './limitation-debit.jetons';
import { providerRedis } from './redis.provider';
import { ServiceLimitationDebitRedis } from './service-limitation-debit';

/**
 * Global : le client Redis et la limitation de débit sont réutilisés par AuthModule (login)
 * et par SanteModule (`/sante/pret`) sans avoir à réimporter ce module partout.
 *
 * Le service est exposé de deux façons : par sa classe (usage direct) et par le jeton
 * `JETON_SERVICE_LIMITATION_DEBIT` du contrat gelé, qu'`AuthModule` injecte pour ne dépendre
 * que de l'interface. `useExisting` et non `useClass` : les deux chemins doivent résoudre vers
 * la MÊME instance, sinon la fenêtre glissante serait comptée deux fois — un attaquant
 * obtiendrait le double de tentatives de connexion autorisées.
 */
@Global()
@Module({
  imports: [HorlogeModule],
  providers: [
    providerRedis,
    ServiceLimitationDebitRedis,
    { provide: JETON_SERVICE_LIMITATION_DEBIT, useExisting: ServiceLimitationDebitRedis },
  ],
  exports: [providerRedis, ServiceLimitationDebitRedis, JETON_SERVICE_LIMITATION_DEBIT],
})
export class LimitationModule {}
