import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { ReponseClient } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
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
 * Les deux routes portent désormais `@ExigerDroit(...)` — bascule du palliatif
 * `droits-provisoires.ts` (`@AucunDroitRequis()` + vérification de rôle EN SERVICE) : ces gestes
 * (export d'accès nLPD, anonymisation d'effacement nLPD) échappaient jusqu'ici au dispositif qui
 * garantit que toute route est couverte par la matrice
 * (`common/droits/toutes-les-actions-couvertes.spec.ts`) — exactement le genre de contrôle qu'un
 * audit nLPD examinerait. Voir `auth/matrice-droits.ts` (`INFERE_CLIENT_EXPORT`/
 * `INFERE_CLIENT_ANONYMISATION`) pour les rôles, désormais la SEULE source de vérité — le
 * palliatif est supprimé, pas seulement contourné.
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
  @ExigerDroit('client.export.generer')
  @ApiOperation({
    summary: "Export complet des données détenues sur un client (droit d'accès nLPD, art. 25).",
    description:
      'Bundle exhaustif : fiche, adresses, contacts, conditions, consentements, notes (TOUTES ' +
      'natures, interne comprise), véhicules détenus, ordres de réparation, documents de vente, ' +
      'rendez-vous et historique de relances (adresse/contenu réellement envoyés). Lecture seule.',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ExportClientDto })
  @ApiReponseProbleme(400, 'Identifiant mal formé.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans client.export.generer).')
  @ApiReponseProbleme(404, 'Client introuvable pour ce tenant.')
  async exporter(@Param('clientId', new PipeZod(schemaUuid)) clientId: string) {
    const ctx = this.contexte.contexteTenant();
    return this.serviceRgpd.exporter(ctx, clientId);
  }

  @Post(':clientId/anonymiser')
  @ExigerDroit('client.anonymiser')
  @ApiOperation({
    summary: "Anonymise un client (droit à l'effacement nLPD, art. 32) — IRRÉVERSIBLE.",
    description:
      "Neutralise l'identité du client et de ses satellites (adresse/contact/note), redacte " +
      "l'historique d'audit de sa fiche, coupe tout contact futur (RA-14). NE TOUCHE JAMAIS les " +
      'factures ni les ordres de réparation, qui restent en place montants et dates intacts ' +
      "(arbitrage @laupernoe) — voir l'en-tête de `migrations/0061_anonymisation_client.sql` pour le " +
      'recensement complet. `motif` obligatoire : raison STAFF de la demande, jamais une donnée du ' +
      'client. Un seul geste par client (`409 CLIENT_DEJA_ANONYMISE` au second appel).',
  })
  @ApiParam({ name: 'clientId', format: 'uuid' })
  @ApiOkResponse({ type: ClientDto })
  @ApiReponseProbleme(400, 'Motif manquant.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans client.anonymiser).')
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
    return this.serviceRgpd.anonymiser(ctx, clientId, entree);
  }
}
