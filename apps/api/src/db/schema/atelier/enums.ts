/**
 * Énumérations Postgres du lot 1 (étape 1 — atelier + clients).
 *
 * Dérivées de `@dfa/shared` (`contrats/atelier/enums.ts`, `contrats/atelier/evenement.ts`),
 * SOURCE UNIQUE — même doctrine que `schema/enums.ts` (socle). Les types PG sont créés dans
 * `migrations/0003_prealables_etape1.sql` (`entite_auditee`, `action_auditee`,
 * `statut_ordre_reparation`, `statut_ligne_or`), `0004_transverse.sql`
 * (`type_evenement_metier`) et `0005_parametrage.sql` (tous les autres, y compris ceux des
 * modules absents du lot 1 — Δ5 du plan d'exécution).
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ACTIONS_AUDITEES,
  ARRONDIS_POINTAGE,
  BLOCAGES_LIGNE_OR,
  CANAUX_DEVIS,
  DECISIONS_DEVIS,
  ENTITES_AUDITEES,
  ETATS_VEHICULE_COURTOISIE,
  LOCALISATIONS_VEHICULE,
  MODES_ATTENTE_RDV,
  MOTIFS_ARCHIVAGE_VEHICULE,
  MOTIFS_FIN_DETENTION,
  MOTIFS_KILOMETRAGE_REGRESSIF,
  MOTIFS_LIEN_OR,
  NATURES_ACTIVITE_POINTAGE,
  NATURES_NOTE,
  ORIGINES_LIGNE_OR,
  ORIGINES_RENDEZ_VOUS,
  PAYEURS_LIGNE_OR,
  POLITIQUES_CONTROLE_QUALITE,
  POLITIQUES_DEMONTAGE_REFUSE,
  POLITIQUES_DEUX_OR_MEME_VEHICULE,
  POLITIQUES_LANGUE_DOCUMENT,
  POLITIQUES_MENTION_SECURITE,
  POLITIQUES_SIGNATURE_RECEPTION,
  PORTEES_NUMEROTATION,
  RESULTATS_EXPERTISE,
  ROLES_CONTACT,
  SOURCES_ECHEANCE_EXPERTISE,
  SOURCES_KILOMETRAGE,
  SOURCES_POINTAGE,
  STATUTS_CAMPAGNE,
  STATUTS_CLIENT,
  STATUTS_LIGNE_OR,
  STATUTS_ORDRE_REPARATION,
  STATUTS_PERIODE_POINTAGE,
  STATUTS_POINTAGE,
  STATUTS_PRET_COURTOISIE,
  STATUTS_RENDEZ_VOUS,
  STATUTS_TRAVAIL_REPORTE,
  STATUTS_VEHICULE,
  TYPES_ADRESSE,
  TYPES_CLIENT,
  TYPES_CONSENTEMENT,
  TYPES_EVENEMENT_METIER,
  TYPES_LIGNE_OR,
  TYPES_ORDRE_REPARATION,
  TYPES_RESSOURCE_PLANNING,
  UNITES_DISTANCE,
  UNITES_TEMPS,
  URGENCES_TRAVAIL,
  VISIBILITES_HISTORIQUE_VEHICULE,
} from '@dfa/shared';

// --- 0003 (préalables) — repris ici pour que les tables du lot 1 les référencent depuis un seul
// module `schema/atelier`. Les `pgEnum` de Drizzle sont des déclarations idempotentes côté
// TypeScript ; le `create type` réel n'a lieu qu'une fois, dans 0003.
export const entiteAuditeeEnum = pgEnum('entite_auditee', ENTITES_AUDITEES);
export const actionAuditeeEnum = pgEnum('action_auditee', ACTIONS_AUDITEES);
export const statutOrdreReparationEnum = pgEnum('statut_ordre_reparation', STATUTS_ORDRE_REPARATION);
export const statutLigneOrEnum = pgEnum('statut_ligne_or', STATUTS_LIGNE_OR);

// --- 0004 (transverse)
export const typeEvenementMetierEnum = pgEnum('type_evenement_metier', TYPES_EVENEMENT_METIER);

// --- 0005 (parametrage + tous les autres enums du lot 1)
export const typeClientEnum = pgEnum('type_client', TYPES_CLIENT);
export const statutClientEnum = pgEnum('statut_client', STATUTS_CLIENT);
export const typeAdresseEnum = pgEnum('type_adresse', TYPES_ADRESSE);
export const roleContactEnum = pgEnum('role_contact', ROLES_CONTACT);
export const typeConsentementEnum = pgEnum('type_consentement', TYPES_CONSENTEMENT);
export const natureNoteEnum = pgEnum('nature_note', NATURES_NOTE);

export const uniteDistanceEnum = pgEnum('unite_distance', UNITES_DISTANCE);
export const sourceKilometrageEnum = pgEnum('source_kilometrage', SOURCES_KILOMETRAGE);
export const motifKilometrageRegressifEnum = pgEnum(
  'motif_kilometrage_regressif',
  MOTIFS_KILOMETRAGE_REGRESSIF,
);
export const motifFinDetentionEnum = pgEnum('motif_fin_detention', MOTIFS_FIN_DETENTION);
export const resultatExpertiseEnum = pgEnum('resultat_expertise', RESULTATS_EXPERTISE);
export const sourceEcheanceExpertiseEnum = pgEnum(
  'source_echeance_expertise',
  SOURCES_ECHEANCE_EXPERTISE,
);
export const statutCampagneEnum = pgEnum('statut_campagne', STATUTS_CAMPAGNE);
export const statutVehiculeEnum = pgEnum('statut_vehicule', STATUTS_VEHICULE);
export const motifArchivageVehiculeEnum = pgEnum('motif_archivage_vehicule', MOTIFS_ARCHIVAGE_VEHICULE);
export const urgenceTravailEnum = pgEnum('urgence_travail', URGENCES_TRAVAIL);
export const statutTravailReporteEnum = pgEnum('statut_travail_reporte', STATUTS_TRAVAIL_REPORTE);

export const typeOrdreReparationEnum = pgEnum('type_ordre_reparation', TYPES_ORDRE_REPARATION);
export const localisationVehiculeEnum = pgEnum('localisation_vehicule', LOCALISATIONS_VEHICULE);
export const motifLienOrEnum = pgEnum('motif_lien_or', MOTIFS_LIEN_OR);

export const typeLigneOrEnum = pgEnum('type_ligne_or', TYPES_LIGNE_OR);
export const origineLigneOrEnum = pgEnum('origine_ligne_or', ORIGINES_LIGNE_OR);
export const payeurLigneOrEnum = pgEnum('payeur_ligne_or', PAYEURS_LIGNE_OR);
export const blocageLigneOrEnum = pgEnum('blocage_ligne_or', BLOCAGES_LIGNE_OR);

export const canalDevisEnum = pgEnum('canal_devis', CANAUX_DEVIS);
export const decisionDevisEnum = pgEnum('decision_devis', DECISIONS_DEVIS);

export const statutRendezVousEnum = pgEnum('statut_rendez_vous', STATUTS_RENDEZ_VOUS);
export const modeAttenteRdvEnum = pgEnum('mode_attente_rdv', MODES_ATTENTE_RDV);
export const origineRendezVousEnum = pgEnum('origine_rendez_vous', ORIGINES_RENDEZ_VOUS);
export const typeRessourcePlanningEnum = pgEnum('type_ressource_planning', TYPES_RESSOURCE_PLANNING);

export const statutPointageEnum = pgEnum('statut_pointage', STATUTS_POINTAGE);
export const sourcePointageEnum = pgEnum('source_pointage', SOURCES_POINTAGE);
export const natureActivitePointageEnum = pgEnum('nature_activite_pointage', NATURES_ACTIVITE_POINTAGE);
export const statutPeriodePointageEnum = pgEnum('statut_periode_pointage', STATUTS_PERIODE_POINTAGE);

export const etatVehiculeCourtoisieEnum = pgEnum('etat_vehicule_courtoisie', ETATS_VEHICULE_COURTOISIE);
export const statutPretCourtoisieEnum = pgEnum('statut_pret_courtoisie', STATUTS_PRET_COURTOISIE);

export const porteeNumerotationEnum = pgEnum('portee_numerotation', PORTEES_NUMEROTATION);
export const uniteTempsEnum = pgEnum('unite_temps', UNITES_TEMPS);
export const politiqueControleQualiteEnum = pgEnum('politique_controle_qualite', POLITIQUES_CONTROLE_QUALITE);
export const politiqueSignatureReceptionEnum = pgEnum(
  'politique_signature_reception',
  POLITIQUES_SIGNATURE_RECEPTION,
);
export const arrondiPointageEnum = pgEnum('arrondi_pointage', ARRONDIS_POINTAGE);
export const politiqueLangueDocumentEnum = pgEnum('politique_langue_document', POLITIQUES_LANGUE_DOCUMENT);
export const politiqueDemontageRefuseEnum = pgEnum('politique_demontage_refuse', POLITIQUES_DEMONTAGE_REFUSE);
export const visibiliteHistoriqueVehiculeEnum = pgEnum(
  'visibilite_historique_vehicule',
  VISIBILITES_HISTORIQUE_VEHICULE,
);
export const politiqueMentionSecuriteEnum = pgEnum('politique_mention_securite', POLITIQUES_MENTION_SECURITE);
export const politiqueDeuxOrMemeVehiculeEnum = pgEnum(
  'politique_deux_or_meme_vehicule',
  POLITIQUES_DEUX_OR_MEME_VEHICULE,
);

// --- 0036 (pointage — mode borne PIN) ---------------------------------------------------------
//
// DÉVIATION ASSUMÉE de la doctrine « source unique @dfa/shared » de ce fichier (voir l'en-tête :
// chaque `pgEnum(...)` ci-dessus est normalement un miroir d'une constante exportée par
// `@dfa/shared`). Le périmètre EXCLUSIF de la tâche qui introduit cet enum est limité à
// `apps/api/src/db/migrations/0036_*.sql` et `apps/api/src/db/schema/` — `packages/shared` en
// est explicitement exclu. Le tableau de valeurs est donc posé EN DUR ici plutôt qu'importé.
//
// À RÉSORBER dès qu'un agent peut toucher `packages/shared` : ajouter
// `MODES_IDENTIFICATION_POINTAGE = ['session_personnelle', 'borne_partagee'] as const` dans
// `contrats/pointage/enums.ts` (même convention que `ACTIVITES_INDIRECTES`/
// `MOTIFS_ANOMALIE_POINTAGE` du même fichier), l'exporter depuis `@dfa/shared`, puis remplacer le
// tableau littéral ci-dessous par cet import — sans toucher au nom Postgres ni à la migration
// 0036, déjà appliquée et immuable.
/** RM-124 (`docs/specification-pointage-borne.md`) : mode d'identification du pointage, par site. */
export const modeIdentificationPointageEnum = pgEnum('mode_identification_pointage', [
  'session_personnelle',
  'borne_partagee',
] as const);
