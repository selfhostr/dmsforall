import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  schemaArchivageVehicule,
  schemaCreationVehicule,
  schemaFiltresVehicules,
  schemaFusionVehicule,
  schemaIdentifiant,
  schemaModificationVehicule,
  type EntreeArchivageVehicule,
  type EntreeCreationVehicule,
  type EntreeFusionVehicule,
  type EntreeModificationVehicule,
  type ReponseContexteAtelier,
  type ReponseVehicule,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { JETON_IDEMPOTENCE, type ServiceIdempotence } from '../common/idempotence';
import { PipeZod } from '../common/validation';
import { EnveloppeDto, PageVehiculeResumeDto, ReponseContexteAtelierDto, ReponseVehiculeDto } from './dto';
import { ServiceVehicule } from './service-vehicule';
import { ServiceVehiculeContexteAtelier } from './service-vehicule-contexte-atelier';

const EnveloppeVehiculeDto = EnveloppeDto(ReponseVehiculeDto, 'Vehicule');

/**
 * `?limite=&curseur=` fusionnés au filtre domaine (`schemaFiltresVehicules` porte déjà son propre
 * `tri`, à valeurs fermées — contrairement au `tri` générique et non typé de
 * `schemaParametresPage`, socle, non réutilisable tel quel ici).
 */
const schemaListeVehicules = schemaFiltresVehicules.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListeVehicules = z.infer<typeof schemaListeVehicules>;

@ApiTags('Véhicules')
@ApiCookieAuth()
@Controller({ path: 'vehicules', version: '1' })
@UseGuards(GardeDroit)
export class VehiculeController {
  constructor(
    private readonly serviceVehicule: ServiceVehicule,
    private readonly serviceContexteAtelier: ServiceVehiculeContexteAtelier,
    @Inject(JETON_IDEMPOTENCE) private readonly serviceIdempotence: ServiceIdempotence,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('vehicule.lire')
  @ApiOperation({ summary: 'Liste des véhicules du tenant courant (§6.2, §7.4).' })
  @ApiOkResponse({ type: PageVehiculeResumeDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans vehicule.lire).')
  async lister(@Query(new PipeZod(schemaListeVehicules)) query: EntreeListeVehicules): Promise<PageVehiculeResumeDto> {
    const ctx = this.contexte.contexteTenant();
    const { limite, curseur, ...filtres } = query;
    return this.serviceVehicule.lister(ctx, filtres, { limite, curseur });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('vehicule.creer')
  @ApiOperation({
    summary: "Création d'un véhicule.",
    description:
      "`Idempotency-Key` obligatoire (uuid v4) : un doublon de véhicule pollue durablement la " +
      'recherche par plaque, le point d’entrée n°1 du comptoir.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiResponse({ status: 201, type: EnveloppeVehiculeDto })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans vehicule.creer).')
  @ApiReponseProbleme(409, 'VEHICULE_VIN_EXISTANT, VEHICULE_PLAQUE_COLLISION ou IDEMPOTENCE_CONFLIT.')
  async creer(
    @Body(new PipeZod(schemaCreationVehicule)) entree: EntreeCreationVehicule,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.serviceIdempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/vehicules', cle: cleIdempotence ?? '', corps: entree },
      async (tx) => {
        const { donnees, avertissements } = await this.serviceVehicule.creerDansTransaction(tx, ctx, entree);
        return { statutHttp: HttpStatus.CREATED, corps: avertissements.envelopper(donnees) };
      },
    );

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) {
      res.setHeader('Idempotency-Rejeu', 'true');
    }
    return resultat.reponse.corps;
  }

  @Get(':vehiculeId')
  @ExigerDroit('vehicule.lire')
  @ApiOperation({ summary: "Détail d'un véhicule." })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseVehiculeDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async parId(@Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string): Promise<ReponseVehicule> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceVehicule.parId(ctx, vehiculeId);
  }

  @Get(':vehiculeId/contexte-atelier')
  @ExigerDroit('vehicule.lire')
  @ApiOperation({
    summary: 'Contexte atelier complet du véhicule (RM-36, D-01, CT-13, §8.1).',
    description:
      "Agrégat consommé au même instant à la prise de RDV ET à la réception du matin : travaux " +
      "reportés, campagnes ouvertes, échéance d'expertise (MFK), garantie, alertes client et OR " +
      "déjà ouverts. Chaque section projette la MÊME donnée que sa ressource dédiée — aucun champ " +
      "n'existe uniquement ici.",
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseContexteAtelierDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async contexteAtelier(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
  ): Promise<ReponseContexteAtelier> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.serviceContexteAtelier.obtenir(ctx, vehiculeId, principal.role);
  }

  @Patch(':vehiculeId')
  @ExigerDroit('vehicule.modifier')
  @ApiOperation({ summary: "Modification des données d'atelier et de garantie (RM-26, RM-33)." })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeVehiculeDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VEHICULE_VIN_EXISTANT.')
  async modifier(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Body(new PipeZod(schemaModificationVehicule)) entree: EntreeModificationVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    const { donnees, avertissements } = await this.serviceVehicule.modifier(ctx, vehiculeId, entree);
    return avertissements.envelopper(donnees);
  }

  @Post(':vehiculeId/archiver')
  @ExigerDroit('vehicule.archiver')
  @ApiOperation({ summary: "Archivage d'un véhicule (RM-31) — aucun DELETE n'existe." })
  @ApiParam({ name: 'vehiculeId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeVehiculeDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'VEHICULE_ARCHIVAGE_IMPOSSIBLE — blocages = les OR ouverts.')
  async archiver(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Body(new PipeZod(schemaArchivageVehicule)) entree: EntreeArchivageVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    const { donnees, avertissements } = await this.serviceVehicule.archiver(ctx, vehiculeId, entree);
    return avertissements.envelopper(donnees);
  }

  @Post(':vehiculeId/fusionner')
  @ExigerDroit('vehicule.archiver')
  @ApiOperation({
    summary: 'Fusion de deux fiches véhicule en doublon (RM-32).',
    description:
      'Droit `direction` (contrat §7.4) resserré au niveau du service — voir le commentaire de ' +
      '`ServiceVehicule.fusionner` sur le manque d’action dédiée dans `matrice-droits.ts`.',
  })
  @ApiParam({ name: 'vehiculeId', format: 'uuid', description: 'Le véhicule SURVIVANT.' })
  @ApiOkResponse({ type: EnveloppeVehiculeDto })
  @ApiReponseProbleme(400, 'VIN de confirmation manquant ou incorrect.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (réservé à la direction).')
  @ApiReponseProbleme(404, 'Véhicule introuvable pour ce tenant.')
  async fusionner(
    @Param('vehiculeId', new PipeZod(schemaIdentifiant)) vehiculeId: string,
    @Body(new PipeZod(schemaFusionVehicule)) entree: EntreeFusionVehicule,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { donnees, avertissements } = await this.serviceVehicule.fusionner(ctx, principal.role, vehiculeId, entree);
    return avertissements.envelopper(donnees);
  }
}
