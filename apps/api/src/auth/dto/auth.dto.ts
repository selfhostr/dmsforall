/**
 * DTO de documentation Swagger pour le module auth.
 *
 * `SessionCourante`/`UtilisateurCourant`/`TenantCourant`/`SiteResume`/`ProblemeDetail` sont des
 * *interfaces* TypeScript (`@dfa/shared`), pas des classes : `@nestjs/swagger` a besoin de classes
 * décorées avec `@ApiProperty` pour dériver un schéma OpenAPI, une interface seule ne produit
 * rien. Ces classes ne sont que la projection Swagger de ces interfaces (`implements` garantit
 * qu'elles ne peuvent pas diverger silencieusement) — la logique métier continue de manipuler les
 * interfaces partagées, jamais ces DTO.
 *
 * Portée strictement limitée aux endpoints de ce module (`apps/api/src/auth/`). D'autres modules
 * (ex. le futur `socle` pour `/tenant/courant` et `/sites`) définiront leurs propres DTO
 * Swagger pour `TenantCourant`/`SiteResume` — la duplication entre modules est le compromis
 * accepté pour ne pas créer de dépendance de compilation entre répertoires appartenant à des
 * experts différents (voir contrats-etape-0.md §1).
 */
import { CapacitesPersonneDto } from './capacites.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CODES_ERREUR,
  LANGUES,
  MODULES_APP,
  MODES_SIGNALEMENT,
  type ModeSignalement,
  ROLES_UTILISATEUR,
  type CodeErreur,
  type ErreurChamp,
  type Langue,
  type ModuleApp,
  type ProblemeDetail,
  type RoleUtilisateur,
  type SessionCourante,
  type SiteResume,
  type TenantCourant,
  type UtilisateurCourant,
} from '@dfa/shared';

export class UtilisateurCourantDto implements UtilisateurCourant {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  prenom!: string;

  @ApiProperty()
  nom!: string;

  @ApiProperty({ enum: ROLES_UTILISATEUR })
  role!: RoleUtilisateur;

  @ApiProperty({ enum: LANGUES })
  langue!: Langue;
}

export class TenantCourantDto implements TenantCourant {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  raisonSociale!: string;

  @ApiProperty({ enum: LANGUES })
  langueDefaut!: Langue;

  @ApiProperty({ enum: MODES_SIGNALEMENT })
  modeSignalement!: ModeSignalement;

  @ApiProperty()
  assujettiTva!: boolean;
}

export class SiteResumeDto implements SiteResume {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ description: 'Étiquette compacte (1 à 5 caractères A-Z/0-9), ex. MART.' })
  codeCourt!: string;

  @ApiProperty()
  nom!: string;

  @ApiProperty()
  actif!: boolean;
}

export class SessionCouranteDto implements SessionCourante {
  @ApiProperty({ type: UtilisateurCourantDto })
  utilisateur!: UtilisateurCourantDto;

  @ApiProperty({
    required: false,
    description:
      'true tant que le mot de passe temporaire n’a pas été remplacé : toute route métier répond 403 AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS.',
  })
  motDePasseAChanger?: boolean;

  @ApiProperty({ type: TenantCourantDto })
  tenant!: TenantCourantDto;

  /**
   * Sites sur lesquels CE compte peut agir — pas « tous les sites du tenant » par principe. Un
   * compte de service (borne d'atelier) n'en reçoit qu'un, le sien.
   */
  @ApiProperty({ type: [SiteResumeDto] })
  sites!: readonly SiteResumeDto[];

  /**
   * Site de rattachement du COMPTE (`utilisateur.site_id`), `null` pour un compte de personne.
   * Renseigné exactement pour les rôles de `ROLES_COMPTE_DE_SERVICE`. Purement informatif côté
   * client : la valeur qui fait foi est résolue par le serveur depuis la session, ce champ ne se
   * renvoie jamais au serveur.
   */
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  siteRattachementId!: string | null;

  /** Site principal de la personne : défaut des filtres de site (jamais un droit). */
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  sitePrincipalId!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Actions de la matrice de droits détenues par le rôle du compte (triées). Informatif : le serveur re-vérifie chaque requête.',
    example: ['atelier.or.lire', 'client.lire'],
  })
  actions!: readonly string[];

  @ApiProperty({
    type: () => CapacitesPersonneDto,
    description:
      "Grille de capacités du compte (niveaux par domaine, encadrer, options). Pour l'affichage ; la décision reste `actions`.",
  })
  capacites!: CapacitesPersonneDto;

  @ApiProperty({
    enum: MODULES_APP,
    isArray: true,
    description:
      'Modules effectivement actifs pour le garage (Réglages > Modules). Le front masque menus, routes et raccourcis des autres ; le serveur refuse leurs écritures (`MODULE_DESACTIVE`).',
  })
  modulesActifs!: readonly ModuleApp[];

  @ApiProperty({ format: 'date-time' })
  expireLe!: string;
}

export class ErreurChampDto implements ErreurChamp {
  @ApiProperty()
  champ!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;
}

export class ProblemeDetailDto implements ProblemeDetail {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: number;

  @ApiProperty({ enum: CODES_ERREUR })
  code!: CodeErreur;

  @ApiPropertyOptional()
  detail?: string;

  @ApiProperty()
  instance!: string;

  @ApiPropertyOptional({ type: [ErreurChampDto] })
  erreurs?: readonly ErreurChampDto[];
}
