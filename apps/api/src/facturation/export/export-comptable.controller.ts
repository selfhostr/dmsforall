import { Controller, Headers, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { schemaLancerExport, type EntreeLancerExport } from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit, GardeDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';

import { ExportComptableAvecAvertissementsDto } from './dto';
import { ServiceExportComptable } from './service-export-comptable';

/**
 * `POST /exports-fiduciaires` — déclenchement d'export comptable (`RF-101` → `RF-113`, `MD-84` →
 * `MD-95`). Action FINANCIÈRE : `facturation.export.creer`, réservée à `direction`/`comptable`
 * (`RF-114`) — `admin` n'a structurellement AUCUN droit financier (`RF-115`), voir `auth/matrice-
 * droits.ts`. Aucun autre verbe que `POST` : cette ressource n'expose ni lecture ni modification
 * dans ce lot (`export_comptable` est un objet de première classe conservé à vie, `MD-91`, mais
 * son historique n'est pas encore consultable via l'API — hors périmètre de cette tâche).
 */
@ApiTags('Facturation — export fiduciaire')
@ApiCookieAuth()
@Controller({ path: 'exports-fiduciaires', version: '1' })
@UseGuards(GardeDroit)
export class ExportComptableController {
  constructor(
    private readonly service: ServiceExportComptable,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('facturation.export.creer')
  @ApiOperation({
    summary:
      "Sélectionne les documents de vente et les paiements émis/enregistrés et non encore exportés d'une période, produit le fichier comptable, et les marque exportés.",
    description:
      'Cible unique câblée dans ce lot : `winbiz` — les autres valeurs de `cible` (`bexio`/`abacus`/`banana`/`csv`) répondent ' +
      "`501 FONCTION_NON_DISPONIBLE`, jamais un fichier vide ou approximatif. Seul `granularite: 'detaille'` (une écriture par " +
      'document PUIS une par paiement, MD-88) est implémenté ; `agrege` répond le même 501. La continuité de numérotation de la ' +
      'série (facture/avoir, par exercice) est vérifiée de façon BLOQUANTE avant toute écriture (RF-28/RF-105, `409 ' +
      "EXPORT_TROU_NUMEROTATION`) : un trou ne part jamais chez la fiduciaire — elle ne s'applique qu'aux documents, un paiement " +
      "n'a pas de série. Le mapping comptable du tenant (`mapping_compte`/`mapping_code_tva`) doit être COMPLET pour l'ensemble du " +
      "lot (documents ET paiements — comptes financiers par moyen de paiement, arrondi, escompte, perte), faute de quoi l'export " +
      'est refusé EN BLOC, jamais partiellement (`409 EXPORT_MAPPING_INCOMPLET`, qui nomme précisément ce qui manque). Une ' +
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
    'EXPORT_TROU_NUMEROTATION, EXPORT_MAPPING_INCOMPLET, ou IDEMPOTENCE_CONFLIT.',
  )
  @ApiReponseProbleme(
    501,
    'FONCTION_NON_DISPONIBLE — cible autre que winbiz, granularité agrege, lot dépassant la taille maximale WinBIZ, ou ' +
      'écriture de paiement non prise en charge (imputation compensation, ou escompte/perte sur un document à plusieurs taux de TVA).',
  )
  async lancer(
    @CorpsZod(schemaLancerExport, {
      exemple: {
        cible: 'winbiz',
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
}
