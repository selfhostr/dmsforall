import type {
  MontantsLigneOr,
  ReponseDevisComplementaire,
  ReponseDevisLigne,
  ReponseLigneOr,
  ReponseOrdreReparationDemande,
  RoleUtilisateur,
} from '@dfa/shared';

import type {
  LigneDevisComplementaire,
  LigneDevisComplementaireLigne,
  LigneLigneOr,
  LigneOrdreReparationDemande,
} from '../db/schema';
import { ROLES_SANS_MONTANT } from '../auth/matrice-droits';
import type { ResumeUtilisateur } from './references';

/**
 * Filtrage des montants par rôle (§3.5 règle 4, invariant frontend n°10) — décision
 * d'AUTORISATION appliquée CÔTÉ SERVEUR, jamais laissée au front. `ROLES_SANS_MONTANT` vit dans
 * `auth/matrice-droits.ts` et nulle part ailleurs ; ce module se contente de le consulter.
 */
export function roleVoitLesMontants(role: RoleUtilisateur): boolean {
  return !ROLES_SANS_MONTANT.includes(role);
}

export function mapperLigneOr(ligne: LigneLigneOr, role: RoleUtilisateur): ReponseLigneOr {
  const montants: MontantsLigneOr = {
    montantHtCentimes: ligne.montantHtCentimes,
    montantTvaCentimes: ligne.montantTvaCentimes,
    montantTtcCentimes: ligne.montantTtcCentimes,
  };
  const voitMontants = roleVoitLesMontants(role);

  return {
    id: ligne.id,
    ordreReparationId: ligne.ordreReparationId,
    numeroOrdre: ligne.numeroOrdre,
    type: ligne.type,
    origine: ligne.origine,
    statut: ligne.statut,
    payeur: ligne.payeur,
    // `payeurClientId` (AC-08, MD-62) : colonne `ligne_or.payeur_client_id` (migration 0017).
    payeurClientId: ligne.payeurClientId,
    blocage: ligne.blocage,
    designation: ligne.designation ?? '',
    referenceTexte: ligne.referenceTexte,
    articleId: ligne.articleId,
    quantiteMillieme: ligne.quantiteMillieme ?? 1000,
    tempsBaremeCentiemes: ligne.tempsBaremeCentiemes,
    tempsBaremeConstructeurCentiemes: ligne.tempsBaremeConstructeurCentiemes,
    // Aucune colonne `temps_reel_centiemes` en base au lot 1 (Δ4 pointage absent) — voir
    // `marquer-realisee` : le temps réel saisi n'a nulle part où se poser hors du module
    // pointage. Champ du contrat exposé à `null`, jamais omis (additif, pas de rupture).
    tempsReelCentiemes: null,
    ...(voitMontants
      ? {
          tauxHoraireCentimes: ligne.tauxHoraireCentimes,
          prixUnitaireCentimes: ligne.prixUnitaireCentimes,
        }
      : {}),
    rabaisPourmille: ligne.rabaisPourmille ?? 0,
    tauxTvaPourmille: ligne.tauxTvaPourmille,
    figeLe: ligne.creeLe.toISOString(),
    ...(voitMontants ? { montants } : {}),
    technicienId: ligne.technicienId,
    codeOperation: ligne.codeOperation,
    codeDefaut: ligne.codeDefaut,
    numeroSinistre: ligne.numeroSinistre,
    numeroAccord: ligne.numeroAccord,
    urgence: ligne.urgence,
    securite: ligne.securite,
    fournieParClient: ligne.fourniParClient,
    aRestituer: ligne.aRestituer,
    restituee: ligne.restituee,
    motifAnnulation: ligne.motifAnnulation,
    factureId: ligne.factureId,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

export function mapperDemande(
  ligne: LigneOrdreReparationDemande,
  saisiPar: ResumeUtilisateur | null,
): ReponseOrdreReparationDemande {
  return {
    id: ligne.id,
    ordre: ligne.ordre,
    verbatim: ligne.verbatim,
    saisiLe: ligne.saisiLe.toISOString(),
    saisiPar,
  };
}

export function mapperDevisLigne(ligne: LigneDevisComplementaireLigne): ReponseDevisLigne {
  return { ligneId: ligne.ligneOrId, decision: ligne.decision };
}

/**
 * `devis_complementaire.preuve` (jsonb) est réservée à la preuve d'acceptation en ligne
 * (IP/user-agent, §7 hors lot 1) mais reste PRÉSENTE et INERTE en base — voir
 * `migrations/0008_atelier.sql`. `destinataireContactId` figure dans le schéma d'ENTRÉE
 * (`schemaCreationDevisComplementaire`) sans avoir de colonne dédiée : ce module réutilise
 * `preuve` pour le porter (`{ destinataireContactId }`), plutôt que de le perdre silencieusement.
 * Signalé comme une réutilisation pragmatique d'une colonne inerte, pas une invention de schéma —
 * à confirmer avec expert-database si une colonne dédiée est préférée.
 */
interface PreuveDevis {
  readonly destinataireContactId?: string | null;
}

function destinataireContactIdDepuisPreuve(preuve: unknown): string | null {
  if (typeof preuve !== 'object' || preuve === null) return null;
  const valeur = (preuve as PreuveDevis).destinataireContactId;
  return typeof valeur === 'string' ? valeur : null;
}

export function mapperDevis(
  devis: LigneDevisComplementaire,
  lignes: readonly LigneDevisComplementaireLigne[],
  emetteur: ResumeUtilisateur | null,
  role: RoleUtilisateur,
): ReponseDevisComplementaire {
  const voitMontants = roleVoitLesMontants(role);
  return {
    id: devis.id,
    ordreReparationId: devis.ordreReparationId,
    numeroOrdre: devis.numeroOrdre,
    lignes: lignes.map(mapperDevisLigne),
    ...(voitMontants
      ? {
          montantTtcCentimes: devis.montantTtcCentimes,
          nouveauPlafondCentimes: devis.nouveauPlafondCentimes ?? undefined,
        }
      : {}),
    impactRestitutionLe: devis.impactRestitutionLe ? devis.impactRestitutionLe.toISOString() : null,
    // `canal`/`envoyeLe` ne sont jamais null en pratique une fois le devis créé (posés à la
    // création, voir ServiceDevis.creer) ; repli défensif sur des valeurs sûres si jamais absents.
    canal: devis.canal ?? 'comptoir',
    destinataireContactId: destinataireContactIdDepuisPreuve(devis.preuve),
    envoyeLe: devis.envoyeLe ? devis.envoyeLe.toISOString() : devis.creeLe.toISOString(),
    emetteur,
    interlocuteurNom: devis.interlocuteurNom,
    repondueLe: devis.reponduLe ? devis.reponduLe.toISOString() : null,
    decision: devis.decision,
    retranscription: devis.retranscription,
  };
}
