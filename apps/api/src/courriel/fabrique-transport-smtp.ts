import { Injectable } from '@nestjs/common';
import type { ConfigSmtpResolue } from './config-courriel';
import type { TransportCourriel } from './transport-courriel.interface';
import { TransportSmtp } from './transport-smtp';

/** Seul point de construction d'un `TransportSmtp` par garage — remplaçable dans les tests. */
@Injectable()
export class FabriqueTransportSmtp {
  creer(config: ConfigSmtpResolue): TransportCourriel {
    return new TransportSmtp(config);
  }
}
