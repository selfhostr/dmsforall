/**
 * `GET|PATCH /parametres-facturation/creancier` — bloc créancier du QR-facture (RF-54/PF-03) :
 * adresse structurée du garage + ses comptes IBAN/QR-IBAN. Singleton par tenant, jamais une
 * collection (une ligne au plus, `tenant_bloc_creancier_tenant_id_uk`) — même patron que
 * `parametres-atelier`/`parametres-site`, à une différence près, documentée sur
 * `versDtoBlocCreancier` : l'absence de ligne rend un paramétrage VIDE, jamais un `404`.
 *
 * Droits : `facturation.parametrage.creancier.lire`/`.modifier` (`auth/matrice-droits.ts`),
 * accordées à `direction`/`comptable` SEULEMENT — `admin: []` (`RF-115`, aucun droit financier).
 * Le contrôle est porté ici, par `@ExigerDroit`, et nulle part ailleurs : `GardeDroit` (APP_GUARD
 * global, refus par défaut) le fait mordre avant que `ServiceBlocCreancier` ne soit atteint.
 */
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Headers, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ApiReponseProbleme } from '../../common/erreurs';
import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit } from '../../common/droits';
import { calculerEtag, ifNoneMatchSatisfait } from '../etag';
import { ReponseBlocCreancierDto } from '../dto/reponse-bloc-creancier.dto';
import { schemaModificationBlocCreancier, type EntreeModificationBlocCreancier } from './schema-bloc-creancier';
import { ServiceBlocCreancier } from './service-bloc-creancier';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('parametres-facturation/creancier')
export class BlocCreancierController {
  constructor(
    private readonly service: ServiceBlocCreancier,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('facturation.parametrage.creancier.lire')
  @Get()
  @ApiOperation({
    summary: 'Bloc créancier du QR-facture (adresse du garage + comptes IBAN/QR-IBAN).',
    description:
      'Singleton par tenant. Ligne absente (aucun bloc créancier encore saisi) → paramétrage VIDE ' +
      '(tous les champs `null`, `pays` = `"CH"`, `version` = `0`), jamais un `404` : ce n\'est pas ' +
      'une erreur, c\'est l\'état initial de tout tenant après la migration 0014. `ETag` stable ' +
      '(dérivé de `modifie_le`) ; `304 Not Modified` si `If-None-Match` le couvre. Réservé à ' +
      '`direction`/`comptable` (donnée financière sensible, `RF-115` — voir `auth/matrice-droits.ts`).',
  })
  @ApiResponse({ status: 200, description: 'Bloc créancier (éventuellement vide).', type: ReponseBlocCreancierDto })
  @ApiResponse({ status: 304, description: 'Non modifié depuis `If-None-Match`.' })
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/comptable.')
  async obtenir(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const dto = await this.service.obtenir(this.contexte.contexteTenant());
    res.setHeader('ETag', calculerEtag(dto.version));
    res.setHeader('Cache-Control', 'private, must-revalidate');

    if (ifNoneMatchSatisfait(ifNoneMatch, dto.version)) {
      res.status(304).end();
      return;
    }
    res.status(200).json(dto);
  }

  @ExigerDroit('facturation.parametrage.creancier.modifier')
  @Patch()
  @ApiOperation({
    summary: 'Modifie partiellement le bloc créancier (upsert — aucune ligne préexistante requise).',
    description:
      'Un champ absent du corps n\'est pas touché ; un champ présent à `null` efface la valeur ' +
      'existante (utile pour un changement de banque : l\'ancien IBAN peut disparaître sans qu\'on ' +
      'lui substitue une valeur bidon). `iban`/`qrIban` sont validés en forme, pays (CH/LI), ' +
      'longueur ET clé de contrôle modulo 97 (ISO 7064) — une clé fausse est refusée bruyamment, ' +
      'jamais tronquée ou corrigée silencieusement. `iban` doit être un compte ORDINAIRE (IID hors ' +
      '30000–31999) et `qrIban` un QR-IBAN (IID dans cette plage) : un IBAN posé dans le mauvais ' +
      'champ est refusé, les deux colonnes ne se mélangent jamais. Réservé à `direction`/`comptable`.',
  })
  @ApiResponse({ status: 200, description: 'Bloc créancier mis à jour.', type: ReponseBlocCreancierDto })
  @ApiReponseProbleme(
    400,
    'VALIDATION_ECHOUEE — IBAN mal formé, pays hors CH/LI, clé de contrôle modulo 97 fausse, ou IBAN/QR-IBAN posé dans le mauvais champ.',
  )
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à direction/comptable.')
  async modifier(
    @CorpsZod(schemaModificationBlocCreancier, {
      exemple: {
        nom: 'Garage Martin SA',
        rue: 'Rue de la Gare',
        numero: '12',
        npa: '1000',
        localite: 'Lausanne',
        pays: 'CH',
        iban: 'CH93 0076 2011 6238 5295 7',
        qrIban: 'CH44 3199 9123 0008 89012',
      },
    })
    corps: EntreeModificationBlocCreancier,
  ): Promise<ReponseBlocCreancierDto> {
    return this.service.modifier(this.contexte.contexteTenant(), corps);
  }
}
