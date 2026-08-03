import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';
// NOTE D'INTERPRÉTATION (voir réponse de tâche) : `Public`/`CLE_META_PUBLIC` sont définis par le
// contrat §2.10 dans apps/api/src/auth/ (propriété expert-auth) sans nom de fichier précisé. Au
// moment d'écrire ce fichier, auth/ ne contient que auth.types.ts, jetons.ts, erreurs-auth.ts et
// services/ — pas encore ce décorateur. Chemin ci-dessous suppose un fichier
// `public.decorator.ts` à créer par expert-auth ; à corriger d'un import si le nom réel diffère.
import { Public } from '../auth/decorateurs/public.decorator';
import { ApiReponseProbleme, ErreurMetier } from '../common/erreurs';
import { JETON_REDIS } from '../common/limitation';
import { JETON_CONFIG, type Config } from '../config';
import { JETON_DB } from '../db/db.jetons';
import type { AccesBase } from '../db/db.types';
import { SanteDto, SantePreteDto } from './dto';

/** `GET /api/v1/sante` et `GET /api/v1/sante/pret` — endpoints 7 et 8 du contrat étape 0. */
@ApiTags('Santé')
@Controller({ path: 'sante', version: '1' })
export class SanteController {
  constructor(
    @Inject(JETON_CONFIG) private readonly config: Config,
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Sonde de vie',
    description: 'Ne vérifie aucune dépendance externe : répond tant que le process Node tourne.',
  })
  @ApiOkResponse({ type: SanteDto })
  sante(): SanteDto {
    return { statut: 'ok', version: this.config.VERSION_APP };
  }

  @Public()
  @Get('pret')
  @ApiOperation({
    summary: 'Sonde de disponibilité',
    description: "Vérifie Postgres et Redis. 503 si l'une des deux dépendances est indisponible.",
  })
  @ApiOkResponse({ type: SantePreteDto })
  @ApiReponseProbleme(503, 'Une dépendance (base ou cache) est indisponible.')
  async pret(): Promise<SantePreteDto> {
    const [base, redis] = await Promise.allSettled([
      this.acces.verifierConnexion(),
      this.redis.ping(),
    ]);

    const baseOk = base.status === 'fulfilled';
    const redisOk = redis.status === 'fulfilled';

    if (!baseOk || !redisOk) {
      throw new ErreurMetier('ERREUR_INTERNE', 'Une dépendance de santé est indisponible.', {
        status: 503,
        detail: `base=${baseOk ? 'ok' : 'ko'} redis=${redisOk ? 'ok' : 'ko'}`,
      });
    }

    return { base: 'ok', redis: 'ok' };
  }
}
