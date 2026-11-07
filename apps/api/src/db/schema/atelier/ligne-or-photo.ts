/**
 * `ligne_or_photo` — photos jointes à une ligne d'OR (migration 0085_ligne_or_photo.sql). Le
 * binaire vit sur disque (`cleFichier`/`cleVignette` : chemins relatifs opaques du stockage),
 * jamais en base. Pas de colonne `modifie_le` : une photo est ajoutée ou supprimée, pas modifiée.
 */

import { foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonneId } from '../colonnes-communes';
import { utilisateur } from '../utilisateur';
import { ligneOr, ordreReparation } from './ordre-reparation';

export const ligneOrPhoto = pgTable(
  'ligne_or_photo',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id').notNull(),
    ligneOrId: uuid('ligne_or_id').notNull(),
    legende: text('legende'),
    cleFichier: text('cle_fichier').notNull(),
    cleVignette: text('cle_vignette'),
    typeMime: text('type_mime').notNull(),
    tailleOctets: integer('taille_octets').notNull(),
    creeParId: uuid('cree_par_id'),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('ligne_or_photo_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'ligne_or_photo_fk_or',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }),
    foreignKey({
      name: 'ligne_or_photo_fk_ligne',
      columns: [t.tenantId, t.ligneOrId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }),
    foreignKey({
      name: 'ligne_or_photo_fk_cree_par',
      columns: [t.tenantId, t.creeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }),
    index('ligne_or_photo_ligne_idx').on(t.tenantId, t.ligneOrId, t.creeLe, t.id),
    index('ligne_or_photo_or_idx').on(t.tenantId, t.ordreReparationId, t.creeLe, t.id),
  ],
);

export type LigneLigneOrPhoto = typeof ligneOrPhoto.$inferSelect;
