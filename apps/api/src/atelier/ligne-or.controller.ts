import { Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  schemaAnnulationLignes,
  schemaCreationLigneOr,
  schemaFiltresLignesOr,
  schemaIdentifiant,
  schemaMarquageRealisee,
  schemaModificationLigneOr,
  schemaRefusLignes,
  schemaSoumissionLignesADevis,
  schemaValidationLignes,
  type EntreeAnnulationLignes,
  type EntreeCreationLigneOr,
  type EntreeMarquageRealisee,
  type EntreeModificationLigneOr,
  type EntreeRefusLignes,
  type EntreeSoumissionLignesADevis,
  type EntreeValidationLignes,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { EnveloppeOrDto, PageOrDto, ReponseLigneOrDto, ReponseOrdreReparationDto } from './dto';
import { etagOrdreReparation } from './ordre-reparation.etag';
import { ServiceLigneOr } from './service-ligne-or';

const EnveloppeLigneOrDto = EnveloppeOrDto(ReponseLigneOrDto, 'LigneOr');
const EnveloppeOrdreReparationDto = EnveloppeOrDto(ReponseOrdreReparationDto, 'OrdreReparationActionLignes');
const PageLigneOrDto = PageOrDto(ReponseLigneOrDto, 'LigneOr');

const schemaListeLignes = schemaFiltresLignesOr.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListeLignes = z.infer<typeof schemaListeLignes>;

/**
 * Lignes d'ordre de réparation (§7.8) : création, modification, marquage réalisée, et les QUATRE
 * actions GROUPÉES portées par l'OR (§7.7 : `valider-lignes`, `refuser-lignes`, `annuler-lignes`,
 * `soumettre-lignes-a-devis`) — toutes sous le préfixe `ordres-reparation`, servies par
 * `ServiceLigneOr` (voir son en-tête pour l'interprétation signalée de `soumettre-lignes-a-devis`).
 */
@ApiTags('Ordres de réparation — lignes')
@ApiCookieAuth()
@Controller({ path: 'ordres-reparation', version: '1' })
@UseGuards(GardeDroit)
export class LigneOrController {
  constructor(
    private readonly serviceLigneOr: ServiceLigneOr,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':orId/lignes')
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({
    summary: "Collection paginée des lignes d'un OR — destinée aux connecteurs.",
    description: "L'écran lit les lignes EMBARQUÉES dans le document OR (§8.3) ; ce endpoint sert la pagination hors de ce seuil.",
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: PageLigneOrDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  async lister(@Param('orId', new PipeZod(schemaIdentifiant)) orId: string, @Query(new PipeZod(schemaListeLignes)) query: EntreeListeLignes) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { limite, curseur, ...filtres } = query;
    return this.serviceLigneOr.lister(ctx, principal, orId, filtres, limite, curseur);
  }

  @Post(':orId/lignes')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.ligne.creer')
  @ApiOperation({
    summary: "Ajout d'une ligne à l'OR — saisie libre (RM-65 : taux horaire et prix figés par le serveur).",
    description: '`Idempotency-Key` obligatoire (uuid v4) : la saisie se fait en rafale au comptoir.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiResponse({ status: 201, type: EnveloppeLigneOrDto })
  @ApiReponseProbleme(400, 'Corps invalide, Idempotency-Key manquante/mal formée, ou taux horaire introuvable pour une ligne de main d’œuvre.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE ou IDEMPOTENCE_CONFLIT.')
  async creer(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaCreationLigneOr, {
      exemple: {
        type: 'main_oeuvre_bareme',
        origine: 'constatee',
        designation: 'Remplacement plaquettes de frein avant',
        quantiteMillieme: 1000,
        tempsBaremeCentiemes: 80,
        payeur: 'client',
      },
    })
    entree: EntreeCreationLigneOr,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceLigneOr.creer(ctx, principal, orId, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Patch(':orId/lignes/:ligneId')
  @ExigerDroit('atelier.ligne.modifier')
  @ApiOperation({
    summary: "Modification libre d'une ligne (§10 L970/L971 : rabais/payeur bornés par le service, pas ce guard).",
    description: 'Sur une ligne déjà `validee`, une hausse de montant peut produire `409 OR_PLAFOND_DEPASSE`.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiParam({ name: 'ligneId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeLigneOrDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation ou ligne introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE ou OR_PLAFOND_DEPASSE.')
  async modifier(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Param('ligneId', new PipeZod(schemaIdentifiant)) ligneId: string,
    @CorpsZod(schemaModificationLigneOr, { exemple: { designation: 'Remplacement plaquettes + disques avant', rabaisPourmille: 50 } })
    entree: EntreeModificationLigneOr,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.serviceLigneOr.modifier(ctx, principal, orId, ligneId, entree);
  }

  @Post(':orId/lignes/:ligneId/marquer-realisee')
  @ExigerDroit('atelier.ligne.marquer_realisee')
  @ApiOperation({ summary: '`en_cours -> realisee`. `refusee -> realisee` n’existe pas (RM-72, CT-28) — `LIGNE_TRANSITION_INTERDITE`.' })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiParam({ name: 'ligneId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeLigneOrDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Ordre de réparation ou ligne introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'LIGNE_TRANSITION_INTERDITE ou OR_LIGNE_VERROUILLEE.')
  async marquerRealisee(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Param('ligneId', new PipeZod(schemaIdentifiant)) ligneId: string,
    @CorpsZod(schemaMarquageRealisee, { exemple: { tempsReelCentiemes: 75 } }) entree: EntreeMarquageRealisee,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.serviceLigneOr.marquerRealisee(ctx, principal, orId, ligneId, entree);
  }

  @Post(':orId/valider-lignes')
  @ExigerDroit('atelier.ligne.valider')
  @ApiOperation({
    summary: 'Action groupée ATOMIQUE : `proposee|a_valider -> validee` (§10 L967).',
    description: 'Le plafond de l’OR (RM-54) est vérifié UNE FOIS sur la somme du lot avant toute écriture — tout ou rien.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Liste de lignes vide ou invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, 'OR_PLAFOND_DEPASSE, OR_LIGNE_VERROUILLEE ou LIGNE_TRANSITION_INTERDITE.')
  async validerLignes(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaValidationLignes, { exemple: { ligneIds: ['5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10'] } }) entree: EntreeValidationLignes,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceLigneOr.validerLignes(ctx, principal, orId, entree);
    res.setHeader('ETag', etagOrdreReparation(resultat.donnees.version));
    return resultat;
  }

  @Post(':orId/refuser-lignes')
  @ExigerDroit('atelier.ligne.refuser')
  @ApiOperation({ summary: 'Action groupée ATOMIQUE : `a_valider -> refusee` (CT-33).' })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Liste de lignes vide ou invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE ou LIGNE_TRANSITION_INTERDITE.')
  async refuserLignes(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaRefusLignes, {
      exemple: { ligneIds: ['5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10'], motif: 'Client refuse le devis complémentaire' },
    })
    entree: EntreeRefusLignes,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceLigneOr.refuserLignes(ctx, principal, orId, entree);
    res.setHeader('ETag', etagOrdreReparation(resultat.donnees.version));
    return resultat;
  }

  @Post(':orId/annuler-lignes')
  @ExigerDroit('atelier.ligne.annuler')
  @ApiOperation({
    summary: 'Action groupée ATOMIQUE : annulation avec motif obligatoire (RM-71).',
    description: 'Refusée par la base depuis `proposee`/`a_valider` (lacune connue de `transition_autorisee`, migration 0003 §5.2).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Motif manquant ou liste de lignes vide/invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE ou LIGNE_TRANSITION_INTERDITE.')
  async annulerLignes(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaAnnulationLignes, {
      exemple: { ligneIds: ['5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10'], motif: 'Pièce indisponible chez le fournisseur' },
    })
    entree: EntreeAnnulationLignes,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceLigneOr.annulerLignes(ctx, principal, orId, entree);
    res.setHeader('ETag', etagOrdreReparation(resultat.donnees.version));
    return resultat;
  }

  @Post(':orId/soumettre-lignes-a-devis')
  @ExigerDroit('atelier.devis.creer')
  @ApiOperation({
    summary: 'Action groupée ATOMIQUE : `proposee -> a_valider` (blocage `accord`).',
    description: 'Prépare l’envoi d’un devis complémentaire (`POST .../devis-complementaires`) — ne l’envoie pas elle-même.',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Liste de lignes vide ou invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE ou LIGNE_TRANSITION_INTERDITE.')
  async soumettreLignesADevis(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @CorpsZod(schemaSoumissionLignesADevis, { exemple: { ligneIds: ['5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10'] } })
    entree: EntreeSoumissionLignesADevis,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceLigneOr.soumettreLignesADevis(ctx, principal, orId, entree);
    res.setHeader('ETag', etagOrdreReparation(resultat.donnees.version));
    return resultat;
  }
}
