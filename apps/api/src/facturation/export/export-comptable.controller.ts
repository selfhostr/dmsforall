import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  CIBLES_EXPORT,
  schemaApercuExport,
  schemaConsulterMapping,
  schemaLancerExport,
  schemaListeExports,
  schemaMettreAJourMapping,
  type EntreeApercuExport,
  type EntreeConsulterMapping,
  type EntreeLancerExport,
  type EntreeMettreAJourMapping,
  type ParametresListeExports,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { PipeZod } from '../../common/validation';

import {
  ApercuExportDto,
  EtatMappingExportDto,
  ExportComptableAvecAvertissementsDto,
  PageExportsDto,
} from './dto';
import { ServiceApercuExport } from './service-apercu-export';
import { ServiceExportComptable } from './service-export-comptable';
import { ServiceHistoriqueExport } from './service-historique-export';
import { ServiceMappingExport } from './service-mapping-export';

const schemaUuidExport = z.string().uuid();

/**
 * Export fiduciaire (`RF-101` → `RF-113`, `MD-84` → `MD-95`) : déclenchement, aperçu de période,
 * historique, relecture du fichier et plan comptable. Actions FINANCIÈRES : toutes sous
 * `facturation.export.creer` (écriture) et `facturation.export.lire` (GET), réservées à `direction`/`comptable` (`RF-114`) — `admin` n'a
 * structurellement AUCUN droit financier (`RF-115`), voir `auth/matrice-droits.ts`.
 */
@ApiTags('Facturation — export fiduciaire')
@ApiCookieAuth()
@Controller({ path: 'exports-fiduciaires', version: '1' })
@UseGuards(GardeDroit)
export class ExportComptableController {
  constructor(
    private readonly service: ServiceExportComptable,
    private readonly apercuService: ServiceApercuExport,
    private readonly historique: ServiceHistoriqueExport,
    private readonly mappingService: ServiceMappingExport,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.export.creer')
  @ApiOperation({
    summary:
      "Sélectionne les documents de vente et les paiements émis/enregistrés et non encore exportés d'une période, produit le fichier comptable, et les marque exportés.",
    description:
      'Cibles câblées : `winbiz` et `csv` (UTF-8 avec BOM, séparateur `;`, en-têtes français, une ligne par couple débit/crédit) — ' +
      'les autres valeurs de `cible` (`bexio`/`abacus`/`banana`) répondent `501 FONCTION_NON_DISPONIBLE`, jamais un fichier vide ou ' +
      "approximatif. Le fichier produit est conservé et relisible via `GET /exports-fiduciaires/{id}/fichier`. Seul `granularite: 'detaille'` (une écriture par " +
      'document PUIS une par paiement, MD-88) est implémenté ; `agrege` répond le même 501. La continuité de numérotation de la ' +
      'série (facture/avoir, par exercice) est vérifiée de façon BLOQUANTE avant toute écriture (RF-28/RF-105, `409 ' +
      "EXPORT_TROU_NUMEROTATION`) : un trou ne part jamais chez la fiduciaire — elle ne s'applique qu'aux documents, un paiement " +
      "n'a pas de série. Le mapping comptable du tenant (`mapping_compte`/`mapping_code_tva`) doit être COMPLET pour l'ensemble du " +
      "lot (documents ET paiements — comptes financiers par moyen de paiement, arrondi, escompte, perte), faute de quoi l'export " +
      'est refusé EN BLOC, jamais partiellement (`409 EXPORT_MAPPING_INCOMPLET`). Les 409 ' +
      '`EXPORT_MAPPING_INCOMPLET`, `EXPORT_TROU_NUMEROTATION` et `EXPORT_ECRITURES_DESEQUILIBREES` nomment ce qui bloque dans ' +
      '`blocages[].donnees` (comptes, numéros, montants) — les mêmes éléments que `prerequis` de `GET /exports-fiduciaires/apercu`. Une ' +
      'imputation `compensation`, ou un escompte/une perte sur un document à plusieurs taux de TVA, ne sont pas construits par ce ' +
      'lot (`501 FONCTION_NON_DISPONIBLE` — non documentés par MD-84 §6.2, jamais devinés). `Idempotency-Key` OBLIGATOIRE (uuid ' +
      'v4) : un rejeu réseau ne doit jamais produire un second lot ni marquer deux fois les mêmes documents ou paiements (MD-92 : ' +
      "un document ou un paiement déjà exporté ne repart dans un autre lot que par un geste explicite et tracé — un REJEU n'en est " +
      "justement pas un). Réponse `200` (au lieu de `201`) si rien n'était candidat sur la période (`donnees.lots: []`, " +
      '`donnees.documentsExportes: []`, `donnees.paiementsExportes: []`) — un résultat vide honnête, pas une erreur.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid v4, identité de la requête.',
  })
  @ApiResponse({
    status: 201,
    type: ExportComptableAvecAvertissementsDto,
    description: 'Au moins un document ou un paiement exporté.',
  })
  @ApiResponse({
    status: 200,
    type: ExportComptableAvecAvertissementsDto,
    description: 'Aucun document ni paiement candidat sur la période.',
  })
  @ApiReponseProbleme(400, 'Corps invalide ou Idempotency-Key manquante/mal formée.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(
    403,
    'Droit insuffisant (rôle sans facturation.export.creer — admin, notamment, RF-115).',
  )
  @ApiReponseProbleme(
    409,
    'EXPORT_TROU_NUMEROTATION, EXPORT_MAPPING_INCOMPLET, EXPORT_ECRITURES_DESEQUILIBREES (avec `blocages`), ou IDEMPOTENCE_CONFLIT.',
  )
  @ApiReponseProbleme(
    501,
    'FONCTION_NON_DISPONIBLE — cible autre que winbiz/csv, granularité agrege, lot dépassant la taille maximale WinBIZ, ou ' +
      'écriture de paiement non prise en charge (imputation compensation, ou escompte/perte sur un document à plusieurs taux de TVA).',
  )
  async lancer(
    @CorpsZod(schemaLancerExport, {
      exemple: {
        cible: 'csv',
        granularite: 'detaille',
        periodeDu: '2026-07-01',
        periodeAu: '2026-07-31',
      },
    })
    entree: EntreeLancerExport,
    @Headers('idempotency-key') cleIdempotence: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const ctx = this.contexte.contexteTenant();
    const resultat = await this.service.lancer(ctx, entree, cleIdempotence ?? '');

    res.status(resultat.reponse.statutHttp);
    if (resultat.rejoue) res.setHeader('Idempotency-Rejeu', 'true');
    return resultat.reponse.corps;
  }

  @Get('apercu')
  @ExigerDroit('facturation.export.lire')
  @ApiOperation({
    summary: "Aperçu d'une période avant export : compteurs, totaux et prérequis non satisfaits.",
    description:
      "Ne marque rien et n'écrit rien. Même sélection et même construction d'écritures que le déclenchement : " +
      '`exportable: true` garantit que `POST /exports-fiduciaires` ne répondrait pas 409 pour un prérequis. `prerequis` liste, ' +
      "sans s'arrêter au premier, le mapping incomplet (comptes et codes TVA manquants avec les pièces concernées), les trous de " +
      'numérotation (numéros), les écritures déséquilibrées et les cas non pris en charge. Une seule écriture déséquilibrée est ' +
      'détectée par document ou paiement.',
  })
  @ApiQuery({ name: 'cible', required: false, enum: CIBLES_EXPORT })
  @ApiQuery({ name: 'periodeDu', required: true, description: 'aaaa-mm-jj' })
  @ApiQuery({ name: 'periodeAu', required: true, description: 'aaaa-mm-jj' })
  @ApiOkResponse({ type: ApercuExportDto })
  @ApiReponseProbleme(400, 'Paramètres invalides (dates, fin avant début).')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.export.lire).')
  async apercu(
    @Query(new PipeZod(schemaApercuExport)) query: EntreeApercuExport,
  ): Promise<ApercuExportDto> {
    return this.apercuService.apercu(this.contexte.contexteTenant(), query);
  }

  @Get('mapping')
  @ExigerDroit('facturation.export.lire')
  @ApiOperation({
    summary: "État du plan comptable de l'export : comptes par poste et codes TVA de la cible.",
    description:
      "Chaque poste porte son `compte` actif aujourd'hui (null = non réglé) et une suggestion `compteParDefaut` du plan PME " +
      "suisse (jamais appliquée automatiquement). `complet` ne considère que les postes `requis` ; l'aperçu reste la vérité pour une période.",
  })
  @ApiQuery({ name: 'cible', required: false, enum: CIBLES_EXPORT })
  @ApiOkResponse({ type: EtatMappingExportDto })
  @ApiReponseProbleme(400, 'Cible invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.export.lire).')
  async consulterMapping(
    @Query(new PipeZod(schemaConsulterMapping)) query: EntreeConsulterMapping,
  ): Promise<EtatMappingExportDto> {
    return this.mappingService.consulter(this.contexte.contexteTenant(), query.cible);
  }

  @Put('mapping')
  @ExigerDroit('facturation.export.creer')
  @ApiOperation({
    summary: 'Règle des comptes et des codes TVA du plan comptable de la cible.',
    description:
      "Idempotent par poste : un compte déjà réglé à l'identique n'écrit rien. Un compte est VERSIONNÉ (RF-112) — jamais réécrit : " +
      "la version active est close à la date d'effet et une nouvelle s'ouvre. Date d'effet par défaut : `1970-01-01` pour un " +
      "poste jamais réglé (valable pour les périodes passées à exporter), aujourd'hui pour le changement d'un compte existant. " +
      "Les codes TVA sont par cible et modifiés en place. Renvoie l'état à jour.",
  })
  @ApiOkResponse({ type: EtatMappingExportDto })
  @ApiReponseProbleme(400, 'Corps invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.export.creer).')
  @ApiReponseProbleme(
    409,
    "CONFLIT — une version du compte existe déjà à la date d'effet ou plus tard (changement le même jour).",
  )
  async mettreAJourMapping(
    @CorpsZod(schemaMettreAJourMapping, {
      exemple: {
        cible: 'csv',
        comptes: [{ usage: 'creances_clients', categorie: 'defaut', compte: '1100' }],
        codesTva: [{ regimeTva: 'normal', tauxPourmille: 81, codeExterne: '8.1' }],
      },
    })
    entree: EntreeMettreAJourMapping,
  ): Promise<EtatMappingExportDto> {
    return this.mappingService.mettreAJour(this.contexte.contexteTenant(), entree);
  }

  @Get()
  @ExigerDroit('facturation.export.lire')
  @ApiOperation({
    summary: 'Historique des exports du tenant, du plus récent au plus ancien.',
    description:
      "Pagination par curseur (`genereLe:desc`). Un lot antérieur à la migration 0084 n'a ni compteurs ni fichier " +
      '(`fichierDisponible: false`, champs concernés à null).',
  })
  @ApiQuery({ name: 'limite', required: false })
  @ApiQuery({ name: 'curseur', required: false })
  @ApiQuery({ name: 'cible', required: false, enum: CIBLES_EXPORT })
  @ApiOkResponse({ type: PageExportsDto })
  @ApiReponseProbleme(400, 'Paramètres ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.export.lire).')
  async lister(
    @Query(new PipeZod(schemaListeExports)) query: ParametresListeExports,
  ): Promise<PageExportsDto> {
    return this.historique.lister(this.contexte.contexteTenant(), query);
  }

  @Get(':exportId/fichier')
  @ExigerDroit('facturation.export.lire')
  @ApiOperation({
    summary: 'Relit le fichier exporté, octet pour octet identique à celui remis à la fiduciaire.',
    description:
      "Le fichier est celui conservé à la génération (gzip en base), pas une régénération. L'empreinte SHA-256 est revérifiée " +
      "à chaque lecture et rendue dans l'en-tête `X-Empreinte-Sha256`. `404` pour un lot antérieur à la migration 0084.",
  })
  @ApiParam({ name: 'exportId', format: 'uuid' })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'Fichier (text/csv).' })
  @ApiReponseProbleme(400, 'Identifiant invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans facturation.export.lire).')
  @ApiReponseProbleme(404, 'Export introuvable pour ce tenant, ou fichier non conservé.')
  async fichier(
    @Param('exportId', new PipeZod(schemaUuidExport)) exportId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.historique.fichier(this.contexte.contexteTenant(), exportId);
    res.setHeader('Content-Type', f.typeMime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${f.nomFichier.replace(/[^\w.-]/g, '_')}"`,
    );
    res.setHeader('X-Empreinte-Sha256', f.empreinteSha256);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.contenu);
  }
}
