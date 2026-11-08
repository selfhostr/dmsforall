/**
 * `utilisateur` — compte de connexion, appartenant à exactement un tenant.
 *
 * Décision assumée et documentée : **l'email est unique globalement**, pas par tenant. Cela
 * permet une connexion sans identifiant de société (l'écran de login ne demande que
 * email + mot de passe, comme le veut le contrat §4). Conséquence acceptée : une même personne
 * physique travaillant pour deux tenants a besoin de deux adresses. C'est le compromis retenu ;
 * l'alternative (unicité par tenant + sélecteur de société au login) dégrade le parcours
 * quotidien de 100 % des utilisateurs pour un cas marginal.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { NIVEAUX_ACCES } from '@dfa/shared';

import { colonneId, colonnesHorodatage } from './colonnes-communes';
import { langueEnum, roleUtilisateurEnum, statutUtilisateurEnum } from './enums';
import { site } from './site';
import { tenant } from './tenant';

/** Niveau d'accès d'une personne à un domaine de la grille (migration 0087). */
export const niveauAccesEnum = pgEnum('niveau_acces', NIVEAUX_ACCES);

/**
 * Colonnes de la grille de capacités, SANS valeur par défaut en base : un trigger `BEFORE INSERT`
 * (`utilisateur_grille_par_defaut`) remplit toute colonne omise depuis le préréglage du `role`.
 * `default(sql\`null\`)` n'existe ici que pour rendre le champ optionnel dans `$inferInsert` (les
 * dizaines d'insertions de fixtures et de CLI ne changent pas) ; Drizzle émet alors `default`, la
 * base rend NULL, le trigger tranche. Une colonne NOT NULL ne voit JAMAIS NULL : le trigger passe
 * avant la vérification.
 */
const sansDefautBase = sql`null`;

export const utilisateur = pgTable(
  'utilisateur',
  {
    id: colonneId(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),

    /** Normalisé (trim + lowercase) par le schéma zod avant toute écriture ; garanti par CHECK. */
    email: text('email').notNull(),

    /** Argon2id encodé PHC (`$argon2id$v=19$m=19456,t=2,p=1$...`). Jamais exposé par l'API. */
    motDePasseHash: text('mot_de_passe_hash').notNull(),

    prenom: text('prenom').notNull(),
    nom: text('nom').notNull(),

    /** Langue de l'interface, indépendante de `tenant.langue_defaut` (personnel plurilingue). */
    langue: langueEnum('langue').notNull().default('fr'),

    /**
     * Préréglage d'ORIGINE et libellé d'affichage (« Technicien (personnalisé) »). Ne décide plus
     * des droits d'une personne : c'est sa grille (colonnes `niveau_*` et suivantes). Reste lu
     * pour la borne (`poste_atelier`, profil d'appareil figé), la durée de session et le site.
     */
    role: roleUtilisateurEnum('role').notNull(),

    /** Grille de capacités (voir `@dfa/shared` `GrilleCapacites`) — typée, pas JSONB : six niveaux
     *  fermés + cinq booléens, contraints en base et indexables, pas des attributs variables. */
    niveauAtelier: niveauAccesEnum('niveau_atelier').notNull().default(sansDefautBase),
    niveauAccueil: niveauAccesEnum('niveau_accueil').notNull().default(sansDefautBase),
    niveauFacturation: niveauAccesEnum('niveau_facturation').notNull().default(sansDefautBase),
    niveauPieces: niveauAccesEnum('niveau_pieces').notNull().default(sansDefautBase),
    niveauVentes: niveauAccesEnum('niveau_ventes').notNull().default(sansDefautBase),
    niveauFinances: niveauAccesEnum('niveau_finances').notNull().default(sansDefautBase),
    peutEncadrer: boolean('peut_encadrer').notNull().default(sansDefautBase),
    /** « Employés & réglages » : comptes, bornes, préparation de la reprise. Suit le préréglage. */
    peutGererEmployes: boolean('peut_gerer_employes').notNull().default(sansDefautBase),
    /** Gestes irréversibles (IBAN, lancement de la reprise). Suit le préréglage. */
    estPatron: boolean('est_patron').notNull().default(sansDefautBase),
    voitMontants: boolean('voit_montants').notNull().default(sansDefautBase),
    voitPrixAchat: boolean('voit_prix_achat').notNull().default(sansDefautBase),
    avoirsPlafonnes: boolean('avoirs_plafonnes').notNull().default(sansDefautBase),

    /** Migration 0096 : true tant que la personne n'a pas remplacé le mot de passe temporaire donné
     *  par la direction. Jamais vrai pour un compte de service (CHECK en base). */
    motDePasseAChanger: boolean('mot_de_passe_a_changer').notNull().default(false),

    /**
     * Site de rattachement du COMPTE (migration 0039).
     *
     * Renseigné pour un compte de SERVICE (`role = 'poste_atelier'` — la borne tactile de
     * l'atelier), obligatoirement NULL pour un compte de personne. La biconditionnelle est
     * imposée en base (`utilisateur_site_compte_de_service_chk`), pas seulement en code.
     *
     * Ce n'est PAS une affectation utilisateur↔site généralisée : aucune autorisation du produit
     * n'est scopée par site (la matrice est rôle × action, l'étanchéité est tenant), et aucun
     * compte de personne n'en porte. Voir l'en-tête de la migration 0039 pour le raisonnement
     * complet.
     *
     * C'est la SOURCE du site de la borne, résolu depuis la session
     * (`PrincipalAuthentifie.siteId`) et jamais depuis un paramètre de requête — la même doctrine
     * que le tenant, pour la même raison : c'est ce qui empêche une borne de lire les PIN d'un
     * autre site.
     */
    siteId: uuid('site_id'),

    /**
     * Site principal d'une PERSONNE (migration 0091) : défaut des filtres de site de l'interface.
     * Nullable. Ne confère aucun droit. Une borne (`poste_atelier`) n'en a pas (CHECK) : son site
     * est `siteId` ci-dessus.
     */
    sitePrincipalId: uuid('site_principal_id'),

    /** `invite` = créé mais mot de passe jamais posé → ne peut pas se connecter. */
    statut: statutUtilisateurEnum('statut').notNull().default('invite'),

    /**
     * Compteur d'échecs consécutifs, remis à zéro à la première connexion réussie.
     * Persisté en base (et non seulement en Redis) : le verrouillage progressif d'un compte doit
     * survivre à un redémarrage ou à une purge du cache. Redis porte la limitation de débit
     * (fenêtre glissante, volatile), la base porte l'état du compte (durable).
     */
    echecsConnexion: smallint('echecs_connexion').notNull().default(0),

    /** Non nul = compte verrouillé jusqu'à cette date (→ `423 AUTH_COMPTE_VERROUILLE`). */
    verrouilleJusquA: timestamp('verrouille_jusqu_a', { withTimezone: true, mode: 'date' }),

    derniereConnexionLe: timestamp('derniere_connexion_le', {
      withTimezone: true,
      mode: 'date',
    }),

    ...colonnesHorodatage(),
  },
  (t) => [
    // Unicité globale de l'email + index servant LE chemin de connexion
    // (`amorcage.utilisateur_par_email`). Une seule ligne remontée, index unique : l'accès reste
    // constant que la table contienne 100 ou 100 000 comptes.
    unique('utilisateur_email_uk').on(t.email),

    // Cible de la clé étrangère composite de `session`. Rend impossible une session dont le
    // tenant_id ne correspond pas à celui de son utilisateur — le scénario de fuite le plus
    // direct qu'on puisse imaginer sur cette table.
    unique('utilisateur_tenant_id_uk').on(t.tenantId, t.id),

    // Pas d'index de pagination ici à l'étape 0 : aucun endpoint ne liste les utilisateurs, et
    // `utilisateur_tenant_id_uk` fournit déjà le préfixe (tenant_id, …) pour un filtrage par
    // tenant. Il sera ajouté avec l'écran d'administration des comptes.

    check(
      'utilisateur_email_format_chk',
      sql`${t.email} = lower(${t.email}) and ${t.email} like '%@%' and length(${t.email}) between 3 and 320`,
    ),
    check('utilisateur_prenom_non_vide_chk', sql`length(btrim(${t.prenom})) > 0`),
    check('utilisateur_nom_non_vide_chk', sql`length(btrim(${t.nom})) > 0`),
    check('utilisateur_echecs_connexion_chk', sql`${t.echecsConnexion} >= 0`),
    check('utilisateur_mot_de_passe_hash_non_vide_chk', sql`length(${t.motDePasseHash}) > 0`),

    // --- Rattachement de site des comptes de service (migration 0039) --------------------------
    // FK COMPOSITE avec le tenant, comme toutes les FK du produit : rattacher une borne au site
    // d'un AUTRE tenant devient structurellement impossible, pas seulement improbable.
    foreignKey({
      name: 'utilisateur_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'utilisateur_fk_site_principal',
      columns: [t.tenantId, t.sitePrincipalId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    check(
      'utilisateur_site_principal_personne_chk',
      sql`${t.role} <> 'poste_atelier' or ${t.sitePrincipalId} is null`,
    ),
    index('utilisateur_site_principal_idx')
      .on(t.tenantId, t.sitePrincipalId)
      .where(sql`${t.sitePrincipalId} is not null`),

    // Biconditionnelle, PAS une simple implication : elle interdit aussi de rattacher un compte
    // de personne à un site, ce qui donnerait l'illusion d'une affectation utilisateur↔site
    // générale qui n'existe pas et que rien n'appliquerait (voir en-tête de la migration 0039).
    check(
      'utilisateur_site_compte_de_service_chk',
      sql`(${t.role} = 'poste_atelier') = (${t.siteId} is not null)`,
    ),

    // La borne est un profil d'appareil FIGÉ : aucune grille stockée n'a de sens sur elle.
    check(
      'utilisateur_borne_sans_grille_chk',
      sql`${t.role} <> 'poste_atelier' or (${t.niveauAtelier} = 'rien' and ${t.niveauAccueil} = 'rien' and ${t.niveauFacturation} = 'rien' and ${t.niveauPieces} = 'rien' and ${t.niveauVentes} = 'rien' and ${t.niveauFinances} = 'rien' and not ${t.peutEncadrer} and not ${t.peutGererEmployes} and not ${t.estPatron} and not ${t.voitMontants} and not ${t.voitPrixAchat} and not ${t.avoirsPlafonnes})`,
    ),
    // « patron » suppose « employés » (le patron gère les comptes).
    check(
      'utilisateur_patron_gere_employes_chk',
      sql`not ${t.estPatron} or ${t.peutGererEmployes}`,
    ),

    // Sert la vérification du `on delete restrict` de la FK ci-dessus, et la question « quelles
    // bornes sont déclarées sur ce site ? ». Partiel : l'écrasante majorité des comptes sont des
    // personnes, donc `site_id` NULL.
    index('utilisateur_site_idx')
      .on(t.tenantId, t.siteId)
      .where(sql`${t.siteId} is not null`),
  ],
);

export type LigneUtilisateur = typeof utilisateur.$inferSelect;
export type NouvelUtilisateur = typeof utilisateur.$inferInsert;
