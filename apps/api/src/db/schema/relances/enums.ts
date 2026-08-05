/**
 * Enums Postgres des relances automatiques (`docs/specification-relances-automatiques.md`).
 * Détail : migrations/0045_relances_socle.sql §1.
 *
 * Source unique `@dfa/shared` (`contrats/relances/enums.ts`) — même doctrine que
 * `schema/atelier/enums.ts` (voir l'écart assumé et documenté dans `schema/facturation/enums.ts`
 * pour un exemple de ce que cette doctrine évite : des valeurs dupliquées en dur qui peuvent
 * diverger).
 *
 * `canal_relance` (ci-dessous) est un type PG NOMMÉ PAR CE MODULE (`canal_relance`, pas
 * `canal_message_client`) bien que ses valeurs proviennent de `CANAUX_MESSAGE_CLIENT`
 * (`contrats/connecteurs/enums.ts`) : aucun type PG `canal_message_client` n'existe encore
 * (`ConnecteursModule` ne persiste rien, `SourceActivationsConnecteurAucune` — voir son
 * en-tête), donc rien à réutiliser. Les VALEURS sont la source unique partagée (jamais
 * redéclarées en dur ici), le NOM du type PG reste scopé à ce domaine — si un type
 * `canal_message_client` apparaît un jour côté connecteurs, une migration `ALTER TYPE RENAME`
 * pourra fusionner les deux sans changer une seule valeur.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  CANAUX_MESSAGE_CLIENT,
  OBJETS_TYPE_RELANCE,
  RAISONS_ANNULATION_RELANCE,
  STATUTS_ENVOI_RELANCE,
  STATUTS_RELANCE_PLANIFIEE,
  TYPES_RELANCE,
} from '@dfa/shared';

/** Type PG : `type_relance`. Les 9 rappels retenus (§2) — voir l'en-tête partagé pour le détail
 *  par valeur et l'état d'implémentation (seul `facture_echue` a un service dans ce lot). */
export const typeRelanceEnum = pgEnum('type_relance', TYPES_RELANCE);

/** Type PG : `objet_type_relance`. Polymorphe (§5) — `relance_planifiee.objet_id` n'a pas de FK
 *  unique, cette valeur dit dans quelle table chercher (même patron que `entite_auditee`). */
export const objetTypeRelanceEnum = pgEnum('objet_type_relance', OBJETS_TYPE_RELANCE);

/** Type PG : `statut_relance_planifiee`. Machine à états §8. */
export const statutRelancePlanifieeEnum = pgEnum(
  'statut_relance_planifiee',
  STATUTS_RELANCE_PLANIFIEE,
);

/** Type PG : `raison_annulation_relance`. Obligatoire ⇔ `statut = 'annulee'` (CHECK en base). */
export const raisonAnnulationRelanceEnum = pgEnum(
  'raison_annulation_relance',
  RAISONS_ANNULATION_RELANCE,
);

/** Type PG : `canal_relance`. Voir l'en-tête de ce fichier pour la raison du nom distinct de
 *  `CANAUX_MESSAGE_CLIENT`, dont les valeurs sont réutilisées telles quelles. */
export const canalRelanceEnum = pgEnum('canal_relance', CANAUX_MESSAGE_CLIENT);

/** Type PG : `statut_envoi_relance`. Issue d'UNE tentative tracée dans `relance_envoi`. */
export const statutEnvoiRelanceEnum = pgEnum('statut_envoi_relance', STATUTS_ENVOI_RELANCE);
