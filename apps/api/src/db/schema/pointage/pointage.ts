/**
 * `pointage` — RM-87 → RM-99, RM-113 → RM-123 (`docs/specification-pointage.md`). Détail des
 * triggers, du référentiel de transitions et des index : `migrations/0030_pointage.sql`.
 *
 * DEUX QUESTIONS TRANCHÉES ICI, remontées comme telles (voir la consigne de cette tâche) :
 *
 * 1. RM-87 — trois cibles possibles (ligne d'OR précise / OR sans ligne précise / activité
 *    indirecte), portées par UN SEUL type de ligne plutôt que trois tables : `nature` est le
 *    discriminant déjà posé au lot 1 (`NatureActivitePointage`), `ordreReparationId`/`ligneOrId`/
 *    `activiteIndirecte` sont TOUS nullables sur la même ligne, et `pointage_cible_coherente_chk`
 *    (migration) garantit qu'EXACTEMENT le couple attendu par `nature` est renseigné — jamais un
 *    champ de trop, jamais un manquant. C'est la même construction que `schemaDemarragePointage`
 *    (union discriminée) côté contrat, traduite en CHECK côté base.
 *
 * 2. Plusieurs techniciens sur la même ligne/le même OR en même temps : **NON TRANCHÉ ICI, à
 *    dessein.** Aucune contrainte n'empêche deux pointages `nature = 'productif_ligne'` avec le
 *    même `ligneOrId` d'être simultanément `statut = 'en_cours'` (un technicien par ligne, comme
 *    par OR, n'est PAS imposé). Question remontée à @laupernoe : réversible dans un seul sens (interdire
 *    plus tard casse un usage existant si le terrain pointe déjà à plusieurs sur une même ligne ;
 *    ouvrir plus tard est sans risque). En attendant l'arbitrage, rien n'est bloqué en base.
 *
 * CE QUI **EST** CONTRAINT, à distinguer du point 2 ci-dessus : RM-89 (chevauchement) impose
 * qu'un MÊME TECHNICIEN n'ait jamais deux pointages `en_cours` simultanés (il ne peut pas être à
 * deux endroits à la fois) — `pointage_technicien_un_seul_en_cours_uk`, index unique PARTIEL posé
 * en SQL brut (migration), non modélisable via `unique()` de pg-core (pas de clause WHERE), même
 * limite que `article_reference_tenant_reference_uk`-like cases (`pieces/article.ts`). Le service
 * doit donc, dans LA MÊME transaction que le démarrage d'un nouveau pointage : arrêter l'éventuel
 * pointage `en_cours` du technicien (RM-89, clôture automatique) PUIS insérer le nouveau — jamais
 * l'inverse, sous peine de violer cette contrainte.
 *
 * IDEMPOTENCE HORS LIGNE (consigne de cette tâche, RM-87/RM-omission du plan frontend §4.3) :
 * `id` est fourni PAR LE CLIENT (uuid v4, `schemaDemarragePointage`), PAS par `gen_random_uuid()`
 * — DÉVIATION assumée de `colonneId()` (voir son commentaire dans `colonnes-communes.ts`, qui ne
 * vaut que pour les identifiants attribués par le serveur). La PK `(id)`, doublée de la contrainte
 * `unique (tenant_id, id)` par convention du dépôt, EST la clé qui garantit qu'un pointage rejoué
 * depuis une tablette déconnectée ne se dédouble jamais : un second INSERT portant le même `id`
 * échoue avec une violation de contrainte (23505), que le service traduit soit en succès
 * idempotent (même payload : c'est le même geste rejoué), soit en `409 CONFLIT` (payload
 * différent : collision réelle sur un `id` déjà pris par un AUTRE pointage — cas documenté par le
 * contrat). Même rôle que `paiement.identifiantTransactionBanque`
 * (`facturation/paiement.ts:58`), mécanisme différent : là un identifiant EXTERNE porte une
 * contrainte UNIQUE dédiée ; ici l'identifiant CLIENT EST la clé primaire elle-même — inutile de
 * dupliquer la garantie dans une seconde contrainte.
 *
 * GENERATED NON MODÉLISÉ ICI (même doctrine que `facturation/document-vente.ts`, en-tête) :
 * `duree_brute_secondes` (RM-97 : « brut conservé à la seconde », jamais recalculé après coup) est
 * une colonne `generated always as (extract(epoch from (fin_le - debut_le))::integer) stored`
 * posée en SQL brut (migration) — non exprimable via `drizzle-kit` pg-core. `LignePointage` (le
 * type inféré ci-dessous) NE PORTE DONC PAS ce champ ; un service qui en a besoin le sélectionne
 * explicitement en SQL. `duree_arrondie_centiemes`, à l'inverse, EST une colonne ordinaire : son
 * calcul dépend du paramètre tenant `parametre_atelier.arrondi_pointage` (P-19), une donnée
 * extérieure à la ligne qu'aucune colonne GENERATED ne peut lire — c'est le SERVICE qui l'écrit,
 * une fois, au moment de l'arrêt.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage } from '../colonnes-communes';
import { site } from '../site';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';
import {
  natureActivitePointageEnum,
  sourcePointageEnum,
  statutPointageEnum,
} from '../atelier/enums';
import { ligneOr, ordreReparation } from '../atelier/ordre-reparation';
import { activiteIndirectePointageEnum, motifAnomaliePointageEnum } from './enums';

export const pointage = pgTable(
  'pointage',
  {
    // Client-supplied — voir le commentaire d'en-tête (idempotence hors ligne). PAS colonneId().
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    siteId: uuid('site_id').notNull(),
    technicienId: uuid('technicien_id').notNull(),

    statut: statutPointageEnum('statut').notNull().default('en_cours'),
    nature: natureActivitePointageEnum('nature').notNull(),

    // --- Les trois cibles de RM-87 (exactement une renseignée, voir pointage_cible_coherente_chk) ---
    ordreReparationId: uuid('ordre_reparation_id'),
    ligneOrId: uuid('ligne_or_id'),
    activiteIndirecte: activiteIndirectePointageEnum('activite_indirecte'),

    source: sourcePointageEnum('source').notNull().default('ecran_atelier'),
    /** Corrélation forensique uniquement (litige de paie) — jamais un identifiant d'auth. */
    appareilId: text('appareil_id'),

    debutLe: timestamp('debut_le', { withTimezone: true, mode: 'date' }).notNull(),
    /** `null` tant que `statut = 'en_cours'` — voir `pointage_fin_coherente_chk`. */
    finLe: timestamp('fin_le', { withTimezone: true, mode: 'date' }),

    // dureeBruteSecondes : GENERATED, non modélisé — voir l'en-tête.

    /** Arrondie selon P-19 (`parametre_atelier.arrondi_pointage`), écrite UNE FOIS par le service. */
    dureeArrondieCentiemes: integer('duree_arrondie_centiemes'),

    /** Décalage d'horloge déclaré par le client à chaque écriture (RM-119) — traçabilité, pas un
     *  champ de `ReponsePointage`. */
    decalageHorlogeMsDebut: integer('decalage_horloge_ms_debut'),
    decalageHorlogeMsFin: integer('decalage_horloge_ms_fin'),

    /** `true` si CE pointage a été refermé automatiquement (RM-89 chevauchement, ou clôture de
     *  fin de journée RM-91/RM-119) — jamais par un arrêt saisi par le technicien lui-même. */
    clotureAutomatique: boolean('cloture_automatique').notNull().default(false),

    // --- Anomalie (RM-91, RM-96, RM-123) ---
    anomalieMotif: motifAnomaliePointageEnum('anomalie_motif'),
    anomalieDetecteeLe: timestamp('anomalie_detectee_le', { withTimezone: true, mode: 'date' }),
    /** `null` tant que personne n'a traité l'anomalie (`POST /pointages/{id}/corriger` réussi). */
    anomalieTraiteeLe: timestamp('anomalie_traitee_le', { withTimezone: true, mode: 'date' }),

    // --- Dernière correction (RM-94) : QUE la dernière — l'historique complet vit dans audit_atelier ---
    derniereCorrectionMotif: text('derniere_correction_motif'),
    derniereCorrectionParUtilisateurId: uuid('derniere_correction_par_utilisateur_id'),
    derniereCorrectionLe: timestamp('derniere_correction_le', { withTimezone: true, mode: 'date' }),
    debutLeOrigine: timestamp('debut_le_origine', { withTimezone: true, mode: 'date' }),
    /** Indépendant des trois colonnes ci-dessus : une correction peut avoir porté sur un pointage
     *  encore `en_cours` au moment de la correction (donc sans `finLeOrigine`). */
    finLeOrigine: timestamp('fin_le_origine', { withTimezone: true, mode: 'date' }),

    ...colonnesHorodatage(),
  },
  (t) => [
    // Cible des futures FK composites (aucune à ce jour) — convention du dépôt.
    // `pointage_tenant_id_uk` n'est PAS posée en plus de la PK : `id` est déjà unique à lui seul
    // (PK), et aucune table ne référence encore `(tenant_id, pointage_id)` — la poser par
    // anticipation sans consommateur serait une contrainte morte. À ajouter le jour où un
    // consommateur composite apparaît (voir migration §1 pour la même remarque côté SQL).

    foreignKey({
      name: 'pointage_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pointage_fk_technicien',
      columns: [t.tenantId, t.technicienId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pointage_fk_ordre_reparation',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pointage_fk_ligne_or',
      columns: [t.tenantId, t.ligneOrId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pointage_fk_derniere_correction_par',
      columns: [t.tenantId, t.derniereCorrectionParUtilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),

    // RM-87 : exactement la cible attendue par `nature`, jamais un champ de trop ni manquant.
    check(
      'pointage_cible_coherente_chk',
      sql`(${t.nature} = 'productif_ligne' and ${t.ordreReparationId} is not null and ${t.ligneOrId} is not null and ${t.activiteIndirecte} is null)
       or (${t.nature} = 'productif_or' and ${t.ordreReparationId} is not null and ${t.ligneOrId} is null and ${t.activiteIndirecte} is null)
       or (${t.nature} = 'indirect' and ${t.ordreReparationId} is null and ${t.ligneOrId} is null and ${t.activiteIndirecte} is not null)`,
    ),

    check('pointage_fin_coherente_chk', sql`(${t.statut} = 'en_cours') = (${t.finLe} is null)`),
    check('pointage_periode_coherente_chk', sql`${t.finLe} is null or ${t.finLe} >= ${t.debutLe}`),
    check(
      'pointage_appareil_id_non_vide_chk',
      sql`${t.appareilId} is null or length(btrim(${t.appareilId})) between 1 and 100`,
    ),

    check(
      'pointage_anomalie_coherente_chk',
      sql`(${t.anomalieMotif} is null) = (${t.anomalieDetecteeLe} is null)`,
    ),
    check(
      'pointage_anomalie_traitee_chk',
      sql`${t.anomalieTraiteeLe} is null or ${t.anomalieMotif} is not null`,
    ),

    check(
      'pointage_derniere_correction_coherente_chk',
      sql`(${t.derniereCorrectionMotif} is null) = (${t.derniereCorrectionLe} is null)
       and (${t.derniereCorrectionLe} is null) = (${t.derniereCorrectionParUtilisateurId} is null)
       and (${t.derniereCorrectionParUtilisateurId} is null) = (${t.debutLeOrigine} is null)`,
    ),

    // pointage_technicien_un_seul_en_cours_uk (index unique PARTIEL, where statut = 'en_cours',
    // RM-89) : non modélisable via `unique()` de pg-core (pas de clause WHERE) — posé en SQL brut,
    // même limite que `article_reference_remplacement_idx`. Voir l'en-tête pour la portée exacte
    // (un seul technicien à la fois, PAS une seule personne par ligne — question 2 non tranchée).

    index('pointage_or_idx')
      .on(t.tenantId, t.ordreReparationId)
      .where(sql`${t.ordreReparationId} is not null`),
    index('pointage_ligne_or_idx')
      .on(t.tenantId, t.ligneOrId)
      .where(sql`${t.ligneOrId} is not null`),
    index('pointage_site_statut_idx').on(t.tenantId, t.siteId, t.statut),
    index('pointage_technicien_idx').on(t.tenantId, t.technicienId, t.debutLe.desc()),
    // GET /pointages, tri debutLe:asc|desc (schema/pointage.ts `TRIS_POINTAGES`).
    index('pointage_pagination_idx').on(t.tenantId, t.debutLe.desc(), t.id.desc()),
    // Corbeille d'anomalies non traitées (RM-96, `?anomalie=true`).
    index('pointage_anomalie_ouverte_idx')
      .on(t.tenantId, t.siteId)
      .where(sql`${t.anomalieMotif} is not null and ${t.anomalieTraiteeLe} is null`),
  ],
);

export type LignePointage = typeof pointage.$inferSelect;
export type NouveauPointage = typeof pointage.$inferInsert;
