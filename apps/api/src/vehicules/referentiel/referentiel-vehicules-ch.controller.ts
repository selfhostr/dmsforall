import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import {
  schemaRechercheMarquesVehiculesCh,
  schemaRechercheModelesVehiculesCh,
  type ParametresRechercheMarquesVehiculesCh,
  type ParametresRechercheModelesVehiculesCh,
} from '@dfa/shared';

import { ApiReponseProbleme } from '../../common/erreurs';
import { ServiceContexteRequete } from '../../common/contexte';
import { ExigerDroit } from '../../common/droits';
import { PipeZod } from '../../common/validation';
import {
  ReponseMarquesVehiculesChDto,
  ReponseModelesVehiculesChDto,
} from './dto/reponse-referentiel-vehicules-ch.dto';
import { ServiceReferentielVehiculesCh } from './service-referentiel-vehicules-ch';

/**
 * `GET /referentiels/vehicules/marques` · `GET /referentiels/vehicules/modeles` — autocomplétion
 * du référentiel véhicules suisse (ASTRA/TAS, migration 0050 `type_approbation_ch`), mode 2 de sa
 * doctrine de saisie (cascade marque → modèle quand le permis de circulation n'est pas sous les
 * yeux).
 *
 * `vehicule.lire`, PAS un droit dédié : ce référentiel n'est qu'une donnée d'appoint pour la même
 * action que lire une fiche véhicule, et `vehicule.lire` est déjà accordé à TOUS les rôles
 * (`LECTURE_ETENDUE`, `auth/matrice-droits.ts`) — aucun droit financier, quiconque saisit un
 * véhicule doit pouvoir s'en servir.
 */
@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'referentiels/vehicules', version: '1' })
export class ReferentielVehiculesChController {
  constructor(
    private readonly service: ServiceReferentielVehiculesCh,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('vehicule.lire')
  @Get('marques')
  @ApiOperation({
    summary: 'Marques du référentiel véhicules suisse, par préfixe (autocomplétion).',
    description:
      '`recherche` absent ou vide = les marques les plus fréquentes du référentiel (classées par ' +
      'nombre de modèles), jamais une erreur ni la liste complète non triée. Insensible à la ' +
      'casse, aux accents et aux séparateurs (`normaliser_recherche`). Résout aussi les alias de ' +
      "comptoir (ex. « Volkswagen » -> VW, « MB » -> Mercedes-Benz — table d'alias, migration " +
      '0051) : `aliasTrouve` sur chaque résultat indique le terme qui a permis de le trouver ' +
      "quand ce n'est pas le nom canonique ASTRA.",
  })
  @ApiQuery({ name: 'recherche', required: false, type: String })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Marques correspondantes.',
    type: ReponseMarquesVehiculesChDto,
  })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — paramètres de requête invalides.')
  async marques(
    @Query(new PipeZod(schemaRechercheMarquesVehiculesCh))
    params: ParametresRechercheMarquesVehiculesCh,
  ): Promise<ReponseMarquesVehiculesChDto> {
    return this.service.rechercherMarques(this.contexte.contexteTenant(), params);
  }

  @ExigerDroit('vehicule.lire')
  @Get('modeles')
  @ApiOperation({
    summary:
      'Modèles du référentiel véhicules suisse pour une marque, par préfixe (autocomplétion).',
    description:
      "`marque` obligatoire (la marque est déjà choisie à l'étape précédente de la cascade). " +
      '`codeTypeCh` renseigné seulement quand le nom de modèle correspond à un UNIQUE code type ' +
      'ASTRA pour cette marque — `null` si plusieurs motorisations/variantes le partagent.',
  })
  @ApiQuery({ name: 'marque', required: true, type: String })
  @ApiQuery({ name: 'recherche', required: false, type: String })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Modèles correspondants.',
    type: ReponseModelesVehiculesChDto,
  })
  @ApiReponseProbleme(
    400,
    'VALIDATION_ECHOUEE — paramètres de requête invalides (ex. `marque` absente).',
  )
  async modeles(
    @Query(new PipeZod(schemaRechercheModelesVehiculesCh))
    params: ParametresRechercheModelesVehiculesCh,
  ): Promise<ReponseModelesVehiculesChDto> {
    return this.service.rechercherModeles(this.contexte.contexteTenant(), params);
  }
}
