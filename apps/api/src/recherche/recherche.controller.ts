import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  schemaParametresRecherche,
  TYPES_RESULTAT_RECHERCHE,
  type ParametresRecherche,
} from '@dfa/shared';
import { z } from 'zod';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { GardeLimitationRecherche } from '../common/securite';
import { PipeZod } from '../common/validation';
import { ReponseRechercheDto } from './dto';
import { ServiceRecherche } from './service-recherche';

/**
 * `schemaParametresRecherche` (gelé, `@dfa/shared`) type `types` en `z.array(z.enum(...))
 * .optional()`. Express/`qs` (le parseur de requête par défaut de Nest) rend UNE seule occurrence
 * de paramètre répétable (`?types=vehicule`) en CHAÎNE, pas en tableau à un élément — seules deux
 * occurrences ou plus (`?types=vehicule&types=client`) produisent un tableau. Sans ce
 * `preprocess`, `?types=vehicule` échouerait la validation zod (« Expected array, received
 * string »), alors que c'est la forme la plus courante en pratique (filtrer sur un seul type).
 * Le schéma gelé lui-même n'est PAS modifié : cette adaptation est locale à la lecture de la
 * requête HTTP, avant que le schéma partagé ne s'applique.
 */
const schemaParametresRechercheRequete = schemaParametresRecherche.extend({
  types: z.preprocess(
    (valeur) => (valeur === undefined ? undefined : Array.isArray(valeur) ? valeur : [valeur]),
    schemaParametresRecherche.shape.types,
  ),
});

/**
 * `GET /recherche` — §7.5 du contrat d'API (D-08), point d'entrée n°1 du comptoir (RM-112).
 *
 * `GardeLimitationRecherche` (finding D-01, audit sécurité, `common/securite/`) APRÈS `GardeDroit`
 * dans la liste : un rôle sans le droit `recherche.executer` est refusé (403) avant de consommer
 * le budget de débit — voir `garde-limitation-recherche.ts` pour le détail de la limite (par
 * utilisateur, jamais par IP) et son motif (scan non indexé sur `ordre_reparation`, pool de
 * connexions partagé entre tous les tenants).
 */
@ApiTags('Recherche')
@ApiCookieAuth()
@Controller({ path: 'recherche', version: '1' })
@UseGuards(GardeDroit, GardeLimitationRecherche)
@ExigerDroit('recherche.executer')
export class RechercheController {
  constructor(
    private readonly serviceRecherche: ServiceRecherche,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Recherche comptoir unifiée — véhicules, clients, ordres de réparation.',
    description:
      'Projection, pas une collection : aucun curseur, `limite` <= 50 (défaut 20). La ' +
      'normalisation (casse, accents, espaces, apostrophes, tirets, points) est strictement ' +
      "serveur (§7.5) — le front ne normalise que pour l'affichage. `types` est répétable " +
      '(`?types=vehicule&types=client`), jamais une liste séparée par virgules. Une plaque ' +
      'historique (RM-17) reste trouvable : `correspondance.historique = true` + ' +
      '`porteeJusquLe`. Une plaque interchangeable (RM-18) renvoie les DEUX véhicules et ' +
      '`plaqueInterchangeable = true` — le serveur ne choisit jamais à la place de ' +
      "l'utilisateur.",
  })
  @ApiQuery({ name: 'q', required: true, type: String, example: '123456' })
  @ApiQuery({
    name: 'types',
    required: false,
    isArray: true,
    enum: TYPES_RESULTAT_RECHERCHE,
    explode: true,
    description: 'Répétable. Par défaut, les trois natures sont cherchées.',
  })
  @ApiQuery({
    name: 'limite',
    required: false,
    type: Number,
    example: 20,
    description: 'Entre 1 et 50, défaut 20.',
  })
  @ApiOkResponse({ type: ReponseRechercheDto })
  @ApiReponseProbleme(
    400,
    'Paramètres de recherche invalides (q vide, limite hors bornes, type inconnu).',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans recherche.executer).')
  @ApiReponseProbleme(
    429,
    "Trop de recherches pour cet utilisateur (limitation de débit, finding D-01). L'en-tête " +
      'Retry-After indique le nombre de secondes à attendre avant de retenter.',
  )
  async rechercher(
    @Query(new PipeZod(schemaParametresRechercheRequete)) params: ParametresRecherche,
  ): Promise<ReponseRechercheDto> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceRecherche.rechercher(ctx, params);
  }
}
