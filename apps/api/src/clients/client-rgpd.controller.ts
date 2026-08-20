import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { ReponseClient } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { AucunDroitRequis, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import { CorpsZod } from '../common/documentation';

import { ClientDto, ExportClientDto } from './dto';
import { schemaAnonymisationClient, schemaUuid, type EntreeAnonymisationClient } from './schemas';
import { ServiceClientRgpd } from './service-client-rgpd';

/**
 * Droits nLPD sur la fiche client (tâche « effacement nLPD », migration 0061) — voir l'en-tête de
 * `service-client-rgpd.ts` pour le détail de ce que fait chaque geste. Contrôleur DISTINCT de
 * `client.controller.ts` (même principe que `client-sous-collections.controller.ts` /
 * `client-projections.controller.ts` : un périmètre de routes disjoint, un fichier).
 *
 * Les deux routes portent `@AucunDroitRequis()` + vérification de rôle EN SERVICE
 * (`ServiceClientRgpd.anonymiser`/`.exporter` via `droits-provisoires.ts`) : `apps/api/src/auth/
 * matrice-droits.ts` n'est pas dans le périmètre d'écriture de cette tâche — même patron que
 * `arreter-contact`/`reprendre-contact` sur `client.controller.ts`.
 */
@ApiTags('Clients')
@ApiCookieAuth()
@Controller({ path: 'clients', version: '1' })
@UseGuards(GardeDroit)
export class ClientRgpdController {
  constructor(
    private readonly serviceRgpd: ServiceClientRgpd,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get(':clientId/export')
  @AucunDroitRequis()
  @ApiOperation({
    summary: "Export complet des données détenues sur un client (droit d'accès nLPD, art. 25).",
    description:
      'Bundle exhaustif : fiche, adresses, contacts, conditions, consentements, notes (TOUTES ' +
      'natures, interne comprise), véhicules détenus, ordres de réparation, documents de vente, ' +
      'rendez-vous et historique de relances (adresse/contenu réellement envoyés). Lecture seule. ' +
      'Rôle vérifié EN SERVICE (`client.export.generer`, droit provisoire — voir `droits-provisoires.ts`).',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ExportClientDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async exporter(@Param('clientId', new PipeZod(schemaUuid)) clientId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.serviceRgpd.exporter(ctx, clientId);
  }

  @Post(':clientId/anonymiser')
  @AucunDroitRequis()
  @ApiOperation({
    summary: "Anonymise un client (droit à l'effacement nLPD, art. 32) — IRRÉVERSIBLE.",
    description:
      "Neutralise l'identité du client et de ses satellites (adresse/contact/note), redacte " +
      "l'historique d'audit de sa fiche, coupe tout contact futur (RA-14). NE TOUCHE JAMAIS les " +
      'factures ni les ordres de réparation, qui restent en place montants et dates intacts ' +
      "(arbitrage @laupernoe) — voir l'en-tête de `migrations/0061_anonymisation_client.sql` pour le " +
      'recensement complet. `motif` obligatoire : raison STAFF de la demande, jamais une donnée du ' +
      'client. Un seul geste par client (`409 CLIENT_DEJA_ANONYMISE` au second appel). Rôle vérifié ' +
      'EN SERVICE (`client.anonymiser`, droit provisoire — voir `droits-provisoires.ts`).',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ClientDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Rôle non autorisé (contrôle provisoire en service).')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'CLIENT_DEJA_ANONYMISE — un seul geste par client, irréversible.')
  async anonymiser(
    @Param('clientId', new PipeZod(schemaUuid)) clientId: string,
    @CorpsZod(schemaAnonymisationClient, {
      exemple: { motif: 'Demande écrite du client reçue le 18.08.2026 (art. 32 nLPD).' },
    })
    entree: EntreeAnonymisationClient,
  ): Promise<ReponseClient> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.serviceRgpd.anonymiser(ctx, role, clientId, entree);
  }
}
