/**
 * `GET|PATCH /parametres-atelier` (contrats-api-etape-1.md §8.2, §7.12).
 *
 * Singleton du tenant, lisible par TOUT utilisateur authentifié (l'UI en dépend à chaque écran),
 * modifiable par `admin`/`chef_atelier`/`direction` (`INFERE_PARAMETRAGE_GOUVERNANCE`,
 * `auth/matrice-droits.ts`) — SAUF les deux plafonds financiers de `reception`,
 * `plafondAvoirReceptionnaireCentimes` (RF-117, issue #45) et `plafondDefautCentimes` (issue #52,
 * même sémantique), retirés d'`admin` et réservés à `direction`/`comptable`
 * (`parametrage.atelier.plafond_avoir.modifier`, vérifié EN SERVICE — voir le commentaire sur
 * `modifier` ci-dessous). `ETag` + `Cache-Control: private, must-revalidate` sur `GET`.
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
      "est calculé, pas stocké : c'est le drapeau d'étape qui remplace un endpoint qui répondrait " +
      '`501`. `ETag` stable (dérivé de `modifie_le`) ; `304 Not Modified` si `If-None-Match` le couvre.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paramètres atelier.',
    type: ReponseParametresAtelierDto,
  })
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
   * `RF-117` / issue #45 — FERMÉ, puis ÉTENDU par issue #52 : `reception.
   * plafondAvoirReceptionnaireCentimes` ET `reception.plafondDefautCentimes` (même sémantique
   * documentée, `db/schema/atelier/parametrage.ts`) partageaient CE MÊME droit générique
   * (`parametrage.atelier.modifier`, `chef_atelier`/`direction`/`admin` via
   * `INFERE_PARAMETRAGE_GOUVERNANCE`, `auth/matrice-droits.ts`) que le reste de cet endpoint,
   * donnant l'écriture de deux plafonds FINANCIERS à `admin` — violation prouvée en exécution de
   * `RF-115` (« admin est un rôle technique et n'a aucun droit financier »), exactement le problème
   * déjà affronté par le bloc créancier QR-facture (`facturation.parametrage.creancier.*`).
   * `parametrage.atelier.modifier` reste posé ICI, statiquement, pour TOUS les autres réglages de
   * l'endpoint (kilométrage obligatoire, signature de réception, préfixe OR…) : un droit fort posé
   * statiquement sur toute la route interdirait aussi ces réglages ordinaires à `chef_atelier`. Le
   * droit dédié `parametrage.atelier.plafond_avoir.modifier` (direction/comptable seuls,
   * `admin: []`) couvre les DEUX champs, vérifié EN SERVICE, uniquement quand l'un d'eux change
   * effectivement — voir `ServiceParametresAtelier.verifierDroitPlafondsFinanciers`, même patron
   * que `ServiceOr.modifier`/`atelier.or.plafond_modifier`.
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
  @ApiResponse({
    status: 200,
    description: 'Paramètres atelier mis à jour.',
    type: ReponseParametresAtelierDto,
  })
  @ApiReponseProbleme(
    400,
    'VALIDATION_ECHOUEE — corps invalide, ou valeur hors périmètre lot 1 (ex. `travaux.controleQualite`).',
  )
  @ApiReponseProbleme(404, 'RESSOURCE_INTROUVABLE — aucune ligne de paramétrage pour ce tenant.')
  @ApiReponseProbleme(
    501,
    "FONCTION_NON_DISPONIBLE — le champ modifié dépend d'une fonctionnalité non livrée au lot 1.",
  )
  async modifier(
    @CorpsZod(schemaModificationParametresAtelierEtendu, {
      exemple: { or: { prefixe: 'OR', resetAnnuel: true, sansRdvAutorise: false } },
    })
    corps: EntreeModificationParametresAtelierEtendue,
  ): Promise<ReponseParametresAtelierDto> {
    const principal = this.contexte.exigerPrincipal();
    const dto = await this.service.modifier(this.contexte.contexteTenant(), principal.role, corps);
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
