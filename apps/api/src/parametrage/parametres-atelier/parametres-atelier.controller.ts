/**
 * `GET|PATCH /parametres-atelier` (contrats-api-etape-1.md §8.2, §7.12).
 *
 * Singleton du tenant, lisible par TOUT utilisateur authentifié (l'UI en dépend à chaque écran),
 * modifiable par `admin`/`chef_atelier`/`direction` (`INFERE_PARAMETRAGE_GOUVERNANCE`,
 * `auth/matrice-droits.ts`). `ETag` + `Cache-Control: private, must-revalidate` sur `GET`.
 */
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Header, Headers, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MODES_PRODUITS_ATELIER, type ModeProduitsAtelier } from '@dfa/shared';

import { ApiReponseProbleme } from '../../common/erreurs';
import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit } from '../../common/droits';
import { calculerEtag, ifNoneMatchSatisfait } from '../etag';
import { ReponseParametresAtelierDto } from '../dto/reponse-parametres-atelier.dto';
import { ServiceParametresAtelier } from './service-parametres-atelier';
import {
  schemaModificationParametresAtelierEtendu,
  type EntreeModificationParametresAtelierEtendue,
} from './schema-modification-parametres-atelier-etendu';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('parametres-atelier')
export class ParametresAtelierController {
  constructor(
    private readonly service: ServiceParametresAtelier,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('parametrage.atelier.lire')
  @Get()
  @ApiOperation({
    summary: 'Paramètres atelier du tenant courant.',
    description:
      'Singleton, regroupé par domaine (§8.2) — jamais de liste plate de `P-xx`. `fonctionnalites` ' +
      'est calculé, pas stocké : c\'est le drapeau d\'étape qui remplace un endpoint qui répondrait ' +
      '`501`. `ETag` stable (dérivé de `modifie_le`) ; `304 Not Modified` si `If-None-Match` le couvre.',
  })
  @ApiResponse({ status: 200, description: 'Paramètres atelier.', type: ReponseParametresAtelierDto })
  @ApiResponse({ status: 304, description: 'Non modifié depuis `If-None-Match`.' })
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — aucune ligne de paramétrage pour ce tenant.')
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

  /**
   * `RF-117` : `reception.plafondAvoirReceptionnaireCentimes` est gouverné par CE MÊME droit
   * générique (`parametrage.atelier.modifier`, `chef_atelier`/`direction`/`admin` via
   * `INFERE_PARAMETRAGE_GOUVERNANCE`, `auth/matrice-droits.ts` — hors périmètre de ce module).
   * MESURÉ, PAS SUPPOSÉ : ce droit donne l'écriture à `admin`, alors que `RF-115` est littéral
   * (« admin est un rôle technique et n'a aucun droit financier ») — le bloc créancier QR-facture
   * a précisément affronté ce même problème pour un autre champ de gouvernance financière et en
   * est sorti avec DEUX actions dédiées (`facturation.parametrage.creancier.*`,
   * direction+comptable seuls, `admin: []`) plutôt que de rester sur le droit générique. Ce champ
   * partage l'endpoint et le droit de `plafondDefautCentimes` (déjà générique) sur consigne
   * explicite de tâche — SIGNALÉ, à arbitrer par @laupernoe : soit ce plafond mérite le même traitement
   * que le bloc créancier (action dédiée, nouvel endpoint ou vérification de service), soit le
   * dégradé (`admin` peut aujourd'hui le relever) est accepté tel quel.
   */
  @ExigerDroit('parametrage.atelier.modifier')
  @Patch()
  @Header('Cache-Control', 'private, must-revalidate')
  @ApiOperation({
    summary: 'Modifie les paramètres atelier, par domaine, partiellement.',
    description:
      'Un paramètre dont le drapeau de fonctionnalité est `false` au lot 1 est en lecture seule : ' +
      'toute tentative de le modifier renvoie `501 FONCTION_NON_DISPONIBLE` — jamais une écriture ' +
      'silencieusement acceptée mais sans effet. `version` et `fonctionnalites` ne sont jamais ' +
      'entrants (calculés côté serveur).',
  })
  @ApiResponse({ status: 200, description: 'Paramètres atelier mis à jour.', type: ReponseParametresAtelierDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — corps invalide, ou valeur hors périmètre lot 1 (ex. `travaux.controleQualite`).')
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — aucune ligne de paramétrage pour ce tenant.')
  @ApiReponseProbleme(501, 'FONCTION_NON_DISPONIBLE — le champ modifié dépend d\'une fonctionnalité non livrée au lot 1.')
  async modifier(
    @CorpsZod(schemaModificationParametresAtelierEtendu, {
      exemple: { or: { prefixe: 'OR', resetAnnuel: true, sansRdvAutorise: false } },
    })
    corps: EntreeModificationParametresAtelierEtendue,
  ): Promise<ReponseParametresAtelierDto> {
    const dto = await this.service.modifier(this.contexte.contexteTenant(), corps);
    return {
      ...dto,
      facturation: {
        ...dto.facturation,
        produitsAtelier: {
          ...dto.facturation.produitsAtelier,
          mode: this.assurerModeProduitsAtelier(dto.facturation.produitsAtelier.mode),
        },
      },
    };
  }

  /**
   * `DtoParametresAtelier.facturation.produitsAtelier.mode` (mappeur-parametres-atelier.ts, hors
   * périmètre de ce fichier) est typé `string` — plus large que l'union gelée `ModeProduitsAtelier`
   * de `@dfa/shared` qu'exige `ReponseParametresAtelierDto`. En pratique le mappeur ne produit
   * jamais qu'une valeur de `MODES_PRODUITS_ATELIER` (défaut ou colonne contrainte en base) ; ce
   * garde-fou le reconfirme à la frontière HTTP plutôt que d'admettre l'écart par un cast non
   * prouvé. GAP DE CONTRAT signalé : le typage de `DtoParametresAtelier` gagnerait à être resserré
   * sur `ModeProduitsAtelier` directement dans le mappeur.
   */
  private assurerModeProduitsAtelier(mode: string): ModeProduitsAtelier {
    if ((MODES_PRODUITS_ATELIER as readonly string[]).includes(mode)) {
      return mode as ModeProduitsAtelier;
    }
    throw new Error(`Mode "produitsAtelier" inattendu, hors énumération lot 1 : ${mode}`);
  }
}
