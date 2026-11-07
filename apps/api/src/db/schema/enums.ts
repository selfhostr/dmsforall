/**
 * Énumérations Postgres du socle.
 *
 * Les valeurs proviennent de `@dfa/shared` (contrat §2.1) : une énumération est déclarée une
 * seule fois, et le type PG comme le type TypeScript en dérivent. Impossible d'ajouter une
 * valeur côté front sans que la base la connaisse — ou l'inverse.
 *
 * Pourquoi des enums PG et pas du `text` + CHECK : la base refuse la valeur inconnue à
 * l'écriture, le stockage est compact (4 octets), et le catalogue documente le domaine pour
 * quiconque ouvre la base avec un client SQL. Contrepartie assumée : ajouter une valeur
 * demande une migration `ALTER TYPE ... ADD VALUE` (non transactionnelle avant PG 12, sans
 * problème depuis) et en retirer une demande un cycle expand/contract complet.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  LANGUES,
  MODES_SIGNALEMENT,
  ROLES_UTILISATEUR,
  STATUTS_TENANT,
  STATUTS_UTILISATEUR,
  TYPES_EVENEMENT_SECURITE,
} from '@dfa/shared';

/** Langues de travail de l'application et des documents clients. Type PG : `langue`. */
export const langueEnum = pgEnum('langue', LANGUES);

/** Comportement du bouton « Signaler un problème ». Type PG : `mode_signalement`. */
export const modeSignalementEnum = pgEnum('mode_signalement', MODES_SIGNALEMENT);

/** Cycle de vie commercial d'un tenant. Type PG : `statut_tenant`. */
export const statutTenantEnum = pgEnum('statut_tenant', STATUTS_TENANT);

/** Cycle de vie d'un compte utilisateur. Type PG : `statut_utilisateur`. */
export const statutUtilisateurEnum = pgEnum('statut_utilisateur', STATUTS_UTILISATEUR);

/** Rôle métier, unique par utilisateur à l'étape 0. Type PG : `role_utilisateur`. */
export const roleUtilisateurEnum = pgEnum('role_utilisateur', ROLES_UTILISATEUR);

/** Nature d'un événement du journal de sécurité. Type PG : `type_evenement_securite`. */
export const typeEvenementSecuriteEnum = pgEnum(
  'type_evenement_securite',
  TYPES_EVENEMENT_SECURITE,
);
