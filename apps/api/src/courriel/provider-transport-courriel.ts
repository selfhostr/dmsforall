import type { Provider } from '@nestjs/common';
import { ServiceJournal } from '../common/journal/service-journal';
import { JETON_CONFIG, type Config } from '../config';
import { courrielDoitEnvoyerReellement, resoudreConfigSmtp } from './config-courriel';
import { JETON_TRANSPORT_COURRIEL } from './courriel.jetons';
import { TransportCapture } from './transport-capture';
import { TransportSmtp } from './transport-smtp';
import type { TransportCourriel } from './transport-courriel.interface';

/**
 * SEUL point où `TransportSmtp` (envoi réel) ou `TransportCapture` (aucun envoi réseau) est
 * choisi — voir `courrielDoitEnvoyerReellement` (`config-courriel.ts`) pour le verrou à deux clés
 * (`NODE_ENV=production` ET `COURRIEL_ENVOI_REEL=true`). Même patron de provider par factory que
 * `providerRedis` (`common/limitation/redis.provider.ts`) : la config déjà validée décide, jamais
 * un `if (process.env.NODE_ENV)` dispersé dans le code appelant.
 *
 * Si l'envoi réel est demandé mais que les identifiants SMTP sont incomplets,
 * `resoudreConfigSmtp` lève `ErreurConfigCourrielInvalide` — l'API refuse alors de démarrer
 * plutôt que d'échouer silencieusement au premier courriel envoyé.
 */
export const providerTransportCourriel: Provider = {
  provide: JETON_TRANSPORT_COURRIEL,
  useFactory: (config: Config, journal: ServiceJournal): TransportCourriel => {
    if (courrielDoitEnvoyerReellement(config)) {
      return new TransportSmtp(resoudreConfigSmtp(config));
    }
    return new TransportCapture(journal);
  },
  inject: [JETON_CONFIG, ServiceJournal],
};
