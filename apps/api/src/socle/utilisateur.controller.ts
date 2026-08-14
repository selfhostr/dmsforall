/**
 * `POST/GET/PATCH /api/v1/utilisateurs` — gestion des employés par le garage lui-même (issue
 * #137). Chaque route pose `@ExigerDroit('socle.utilisateur.*')` (matrice-droits.ts) — seuls
 * `direction` et `admin` les détiennent. Le tenant vient exclusivement de la session
 * (`ServiceContexteRequete.contexteTenant()`) : aucune méthode ne lit de `tenantId` dans un
 * paramètre ou un corps de requête, et les schémas zod (`@dfa/shared`) sont `.strict()` — un
 * `tenantId` glissé dans le corps produit `400 VALIDATION_ECHOUEE`, jamais un tenant substitué.
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  schemaCreationUtilisateur,
  schemaModificationUtilisateur,
  schemaParametresPage,
  type ParametresPage,
} from '@dfa/shared';
import { z } from 'zod';

import { ServiceContexteRequete } from '../common/contexte';
import { CorpsZod } from '../common/documentation';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';
import {
  PageUtilisateurResumeDto,
  ReponseAccesTemporaireDto,
  ReponseCreationUtilisateurDto,
  UtilisateurResumeDto,
} from './dto';
import { ServiceUtilisateur } from './service-utilisateur';

const schemaUtilisateurId = z.string().uuid();

@ApiTags('Socle')
@ApiCookieAuth()
@Controller({ path: 'utilisateurs', version: '1' })
@UseGuards(GardeDroit)
export class UtilisateurController {
  constructor(
    private readonly service: ServiceUtilisateur,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('socle.utilisateur.lire')
  @ApiOperation({
    summary: 'Liste des employés du tenant courant',
    description:
      "Pagination par curseur opaque, tri stable (creeLe desc, id desc). N'inclut jamais les " +
      "comptes de service (bornes d'atelier) — voir POST /pointage/comptes-de-service pour ceux-ci.",
  })
  @ApiQuery({ name: 'limite', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'curseur', required: false, type: String })
  @ApiOkResponse({ type: PageUtilisateurResumeDto })
  @ApiReponseProbleme(400, 'Curseur illisible ou paramètres de pagination invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.utilisateur.lire).')
  async lister(
    @Query(new PipeZod(schemaParametresPage)) params: ParametresPage,
  ): Promise<PageUtilisateurResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.lister(ctx, params);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ExigerDroit('socle.utilisateur.creer')
  @ApiOperation({
    summary: 'Créer un employé',
    description:
      "Le mot de passe n'est jamais choisi par l'appelant : le serveur en génère un et le rend " +
      'UNE SEULE FOIS dans la réponse (acces.motDePasseTemporaire) — à transmettre oralement à ' +
      "l'employé. Un patron (direction) ne peut jamais créer de compte admin (403) — seul un " +
      'compte admin le peut.',
  })
  @ApiCreatedResponse({ type: ReponseCreationUtilisateurDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide, ou un ou plusieurs siteIds introuvables pour ce tenant.',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(
    403,
    'Droit insuffisant (rôle sans socle.utilisateur.creer), ou tentative de créer un compte ' +
      'admin par un acteur non-admin.',
  )
  @ApiReponseProbleme(409, 'Adresse email déjà utilisée par un autre compte.')
  async creer(
    @CorpsZod(schemaCreationUtilisateur, {
      exemple: {
        prenom: 'Julie',
        nom: 'Rey',
        email: 'julie.rey@garage-martin.ch',
        role: 'technicien',
        siteIds: ['11111111-1111-4111-8111-111111111111'],
      },
    })
    corps: z.infer<typeof schemaCreationUtilisateur>,
  ): Promise<ReponseCreationUtilisateurDto> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.creer(ctx, corps, principal.role);
  }

  @Patch(':utilisateurId')
  @ExigerDroit('socle.utilisateur.modifier')
  @ApiOperation({
    summary: 'Modifier le rôle et/ou les sites d’un employé',
    description:
      'Au moins un des deux champs (role, siteIds) requis. Promouvoir vers admin est réservé ' +
      'à un acteur déjà admin (403 sinon), même avec le droit socle.utilisateur.modifier.',
  })
  @ApiParam({ name: 'utilisateurId', format: 'uuid' })
  @ApiOkResponse({ type: UtilisateurResumeDto })
  @ApiReponseProbleme(
    400,
    'Corps invalide, ou un ou plusieurs siteIds introuvables pour ce tenant.',
  )
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(
    403,
    'Droit insuffisant, ou tentative de promotion vers admin par un acteur non-admin.',
  )
  @ApiReponseProbleme(404, 'Employé introuvable pour ce tenant.')
  async modifier(
    @Param('utilisateurId', new PipeZod(schemaUtilisateurId)) utilisateurId: string,
    @CorpsZod(schemaModificationUtilisateur, { exemple: { role: 'chef_atelier' } })
    corps: z.infer<typeof schemaModificationUtilisateur>,
  ): Promise<UtilisateurResumeDto> {
    const ctx = this.contexte.contexteTenant();
    const principal = this.contexte.exigerPrincipal();
    return this.service.modifier(ctx, utilisateurId, corps, principal.role);
  }

  @Post(':utilisateurId/desactiver')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('socle.utilisateur.desactiver')
  @ApiOperation({
    summary: 'Désactiver un employé (jamais une suppression)',
    description:
      "L'historique (OR, factures, pointages) reste attribuable — le compte est suspendu, pas " +
      'supprimé. Révoque immédiatement toute session active de cet employé.',
  })
  @ApiParam({ name: 'utilisateurId', format: 'uuid' })
  @ApiOkResponse({ type: UtilisateurResumeDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.utilisateur.desactiver).')
  @ApiReponseProbleme(404, 'Employé introuvable pour ce tenant.')
  @ApiReponseProbleme(409, 'Tentative de désactiver son propre compte.')
  async desactiver(
    @Param('utilisateurId', new PipeZod(schemaUtilisateurId)) utilisateurId: string,
  ): Promise<UtilisateurResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.desactiver(ctx, utilisateurId);
  }

  @Post(':utilisateurId/reactiver')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('socle.utilisateur.desactiver')
  @ApiOperation({ summary: 'Réactiver un employé précédemment désactivé' })
  @ApiParam({ name: 'utilisateurId', format: 'uuid' })
  @ApiOkResponse({ type: UtilisateurResumeDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.utilisateur.desactiver).')
  @ApiReponseProbleme(404, 'Employé introuvable pour ce tenant.')
  async reactiver(
    @Param('utilisateurId', new PipeZod(schemaUtilisateurId)) utilisateurId: string,
  ): Promise<UtilisateurResumeDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.reactiver(ctx, utilisateurId);
  }

  @Post(':utilisateurId/reinitialiser-acces')
  @HttpCode(HttpStatus.OK)
  @ExigerDroit('socle.utilisateur.reinitialiser_acces')
  @ApiOperation({
    summary: "Réinitialiser l'accès d'un employé (mot de passe perdu)",
    description:
      'Nouveau mot de passe temporaire généré par le serveur, rendu UNE SEULE FOIS dans la ' +
      "réponse. Toute session active de l'employé est révoquée. Tracé dans l'audit — jamais la " +
      'valeur du mot de passe.',
  })
  @ApiParam({ name: 'utilisateurId', format: 'uuid' })
  @ApiOkResponse({ type: ReponseAccesTemporaireDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant (rôle sans socle.utilisateur.reinitialiser_acces).')
  @ApiReponseProbleme(404, 'Employé introuvable pour ce tenant.')
  async reinitialiserAcces(
    @Param('utilisateurId', new PipeZod(schemaUtilisateurId)) utilisateurId: string,
  ): Promise<ReponseAccesTemporaireDto> {
    const ctx = this.contexte.contexteTenant();
    return this.service.reinitialiserAcces(ctx, utilisateurId);
  }
}
