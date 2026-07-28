import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  schemaCreationOrdreReparation,
  schemaDemandeOrdreReparation,
  schemaFiltresJournal,
  schemaFiltresOrdresReparation,
  schemaIdentifiant,
  schemaModificationOrdreReparation,
  type EntreeCreationOrdreReparation,
  type EntreeDemandeOrdreReparation,
  type EntreeModificationOrdreReparation,
  type ReponseOrdreReparation,
  type ReponseOrdreReparationDemande,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { JETON_IDEMPOTENCE, type ServiceIdempotence } from '../common/idempotence';
import { PipeZod } from '../common/validation';

import { EnveloppeOrDto, PageOrDto, ReponseEntreeJournalDto, ReponseOrdreReparationDemandeDto, ReponseOrdreReparationDto } from './dto';
import { etagOrdreReparation } from './ordre-reparation.etag';
import { ServiceOr } from './service-or';

const EnveloppeOrdreReparationDto = EnveloppeOrDto(ReponseOrdreReparationDto, 'OrdreReparation');
const PageOrdreReparationDto = PageOrDto(ReponseOrdreReparationDto, 'OrdreReparation');
const PageEntreeJournalDto = PageOrDto(ReponseEntreeJournalDto, 'EntreeJournal');

/** `?limite=&curseur=` fusionnés au filtre domaine — même pattern que `vehicules/vehicule.controller.ts`. */
const schemaListeOrdresReparation = schemaFiltresOrdresReparation.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListeOrdresReparation = z.infer<typeof schemaListeOrdresReparation>;

const schemaListeJournal = schemaFiltresJournal.extend({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  curseur: z.string().max(512).optional(),
});
type EntreeListeJournal = z.infer<typeof schemaListeJournal>;

/**
 * Ordre de réparation — ressource (liste, création, fiche, modification, demandes client,
 * journal). Les 11 actions de transition (§7.7) sont dans `ordre-reparation-transitions.controller.ts` ;
 * les lignes et devis complémentaires dans `ligne-or.controller.ts`/`devis-complementaire.controller.ts` —
 * tous partagent le préfixe `ordres-reparation`, découpés par sous-domaine plutôt qu'un unique
 * fichier de plusieurs centaines de lignes (même organisation que `vehicules/`).
 */
@ApiTags('Ordres de réparation')
@ApiCookieAuth()
@Controller({ path: 'ordres-reparation', version: '1' })
@UseGuards(GardeDroit)
export class OrdreReparationController {
  constructor(
    private readonly serviceOr: ServiceOr,
    @Inject(JETON_IDEMPOTENCE) private readonly serviceIdempotence: ServiceIdempotence,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({
    summary: 'Liste des ordres de réparation du tenant courant (§6.2, §6.3, §7.6).',
    description:
      'SOUS-ENSEMBLE des filtres du contrat au lot 1 (`siteId`, `statut`, `clientId`, `vehiculeId`) — ' +
      'voir `ServiceOr.lister` pour le détail des filtres non câblés (signalé, non silencieux).',
  })
  @ApiOkResponse({ type: PageOrdreReparationDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans atelier.or.lire).')
  async lister(@Query(new PipeZod(schemaListeOrdresReparation)) query: EntreeListeOrdresReparation) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { limite, curseur, ...filtres } = query;
    const { donnees, curseurSuivant } = await this.serviceOr.lister(ctx, principal, filtres, limite, curseur);
    return { donnees, curseurSuivant, limite };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.or.creer')
  @ApiOperation({
    summary: "Création d'un ordre de réparation (§7.6).",
    description:
      "`Idempotency-Key` obligatoire (uuid v4) : un rejeu ne doit jamais brûler un numéro d'OR (RM-49). " +
      '`confirmations` couvre `CLIENT_BLOQUE`, `VEHICULE_DEUX_OR_OUVERTS` et `OR_SANS_RDV`, évaluées en une passe.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'uuid v4, identité de la requête.' })
  @ApiResponse({ status: 201, type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Corps invalide, Idempotency-Key manquante/mal formée, ou état planifié désactivé (P-22).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, 'Client ou véhicule introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'CONFLIT (OR déjà ouvert), CONFIRMATION_REQUISE, OR_KM_ENTREE_REQUIS ou IDEMPOTENCE_CONFLIT.')
  async creer(
    @Body(new PipeZod(schemaCreationOrdreReparation)) entree: EntreeCreationOrdreReparation,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const resultat = await this.serviceOr.creer(ctx, principal, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    res.setHeader('ETag', etagOrdreReparation(resultat.reponse.corps.donnees.version));
    return resultat.reponse.corps;
  }

  @Get(':orId')
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({ summary: "Fiche complète d'un ordre de réparation — le document entier (D-10, §8.3)." })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseOrdreReparationDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  async parId(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReponseOrdreReparation> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const document = await this.serviceOr.obtenirComplet(ctx, principal, orId);
    res.setHeader('ETag', etagOrdreReparation(document.version));
    return document;
  }

  @Patch(':orId')
  @ExigerDroit('atelier.or.modifier')
  @ApiOperation({
    summary: "Modification des champs libres de l'en-tête (localisation, sous-traitant, restitution promise, plafond, PO — §9).",
    description: '`If-Match: W/"<version>"` OBLIGATOIRE. Un report de restitution exige `motifReport` (RM-56).',
  })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiHeader({ name: 'If-Match', required: true, description: 'W/"<version>" lu sur la dernière lecture (ETag).' })
  @ApiOkResponse({ type: EnveloppeOrdreReparationDto })
  @ApiReponseProbleme(400, 'Corps invalide, `If-Match` manquant/mal formé, ou `motifReport` absent sur un report de restitution.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, 'CONFLIT (version périmée) ou OR_LIGNE_VERROUILLEE (OR facturé/restitué/clôturé/annulé).')
  async modifier(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new PipeZod(schemaModificationOrdreReparation)) entree: EntreeModificationOrdreReparation,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    const { donnees, avertissements } = await this.serviceOr.modifier(ctx, principal, orId, ifMatch, entree);
    res.setHeader('ETag', etagOrdreReparation(donnees.version));
    return { donnees, avertissements };
  }

  @Get(':orId/demandes')
  @ExigerDroit('atelier.or.lire')
  @ApiOperation({ summary: 'Demandes du client au verbatim (RM-52).' })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: [ReponseOrdreReparationDemandeDto] })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  async listerDemandes(@Param('orId', new PipeZod(schemaIdentifiant)) orId: string): Promise<readonly ReponseOrdreReparationDemande[]> {
    const ctx = this.contexte.contexteTenant();
    return this.serviceOr.listerDemandes(ctx, orId);
  }

  @Post(':orId/demandes')
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('atelier.or.modifier')
  @ApiOperation({ summary: "Ajout d'une demande client au verbatim (RM-52) — append-only, aucun `PATCH`." })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ReponseOrdreReparationDemandeDto })
  @ApiReponseProbleme(400, 'Verbatim manquant ou vide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  @ApiReponseProbleme(409, 'OR_LIGNE_VERROUILLEE (OR facturé/restitué/clôturé/annulé).')
  async ajouterDemande(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Body(new PipeZod(schemaDemandeOrdreReparation)) entree: EntreeDemandeOrdreReparation,
  ): Promise<ReponseOrdreReparationDemande> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.serviceOr.ajouterDemande(ctx, principal, orId, entree);
  }

  @Get(':orId/journal')
  @ExigerDroit('atelier.journal.lire')
  @ApiOperation({ summary: "Journal d'audit complet de l'OR — en-tête, lignes et devis (RM-59, RM-111)." })
  @ApiParam({ name: 'orId', format: 'uuid' })
  @ApiOkResponse({ type: PageEntreeJournalDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans atelier.journal.lire).')
  @ApiReponseProbleme(404, "Ordre de réparation introuvable pour ce tenant.")
  async journal(
    @Param('orId', new PipeZod(schemaIdentifiant)) orId: string,
    @Query(new PipeZod(schemaListeJournal)) query: EntreeListeJournal,
  ) {
    const ctx = this.contexte.contexteTenant();
    const { limite, curseur, ...filtres } = query;
    const { donnees, curseurSuivant } = await this.serviceOr.journal(ctx, orId, filtres, limite, curseur);
    return { donnees, curseurSuivant, limite };
  }
}
