import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { ClientResume, VehiculeResume } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  client,
  clientAdresse,
  clientCondition,
  parametreAtelier,
  utilisateur,
  vehicule,
  vehiculeDetention,
  vehiculeKilometrage,
  vehiculePlaque,
  type LigneClient,
  type LigneClientAdresse,
  type LigneClientCondition,
  type LigneParametreAtelier,
  type LigneVehicule,
  type LigneVehiculeKilometrage,
  type LigneVehiculePlaque,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Lectures PARTAGÉES entre les services `atelier` (snapshot RM-50, résumés embarqués dans le
 * document OR). Rescoping explicite sur `tenant_id` en plus du RLS (le RLS est le filet, jamais
 * le mécanisme — doctrine du projet).
 */

/** `nomAffiche` d'un client : raison sociale pour une entreprise, "nom prénom" sinon. */
export function nomAfficheClient(row: Pick<LigneClient, 'type' | 'nom' | 'prenom' | 'raisonSociale'>): string {
  if (row.type === 'entreprise') {
    return row.raisonSociale ?? '';
  }
  return [row.nom, row.prenom].filter((v): v is string => Boolean(v)).join(' ');
}

/** Rendu d'affichage d'un véhicule : `marque modele version`, espaces superflus retirés. */
export function designationVehicule(row: Pick<LigneVehicule, 'marque' | 'modele' | 'version'>): string {
  return [row.marque, row.modele, row.version].filter((v): v is string => Boolean(v)).join(' ');
}

export async function chargerClientLigne(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  clientId: string,
): Promise<LigneClient> {
  const [ligne] = await tx
    .select()
    .from(client)
    .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Client ${clientId} introuvable.`);
  }
  return ligne;
}

export async function chargerVehiculeLigne(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehicule> {
  const [ligne] = await tx
    .select()
    .from(vehicule)
    .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, vehiculeId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Véhicule ${vehiculeId} introuvable.`);
  }
  return ligne;
}

export function versClientResume(ligne: LigneClient): ClientResume {
  return {
    id: ligne.id,
    numeroClient: ligne.numero,
    nomAffiche: nomAfficheClient(ligne),
    type: ligne.type,
    statut: ligne.statut,
    langueCorrespondance: ligne.langue,
    poObligatoire: ligne.poObligatoire,
  };
}

/** Plaque COURANTE d'un véhicule (`au is null`), la plus récemment ouverte s'il y en a plusieurs
 *  (cas normal seulement pour une plaque interchangeable, RM-17/§6.9). */
export async function chargerPlaqueCourante(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehiculePlaque | null> {
  const [ligne] = await tx
    .select()
    .from(vehiculePlaque)
    .where(and(eq(vehiculePlaque.tenantId, ctx.tenantId), eq(vehiculePlaque.vehiculeId, vehiculeId), isNull(vehiculePlaque.au)))
    .orderBy(desc(vehiculePlaque.du))
    .limit(1);
  return ligne ?? null;
}

export async function chargerVehiculeResume(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<VehiculeResume> {
  const ligne = await chargerVehiculeLigne(tx, ctx, vehiculeId);
  return construireVehiculeResume(ligne, await chargerPlaqueCourante(tx, ctx, vehiculeId));
}

export function construireVehiculeResume(ligne: LigneVehicule, plaque: LigneVehiculePlaque | null): VehiculeResume {
  return {
    id: ligne.id,
    plaque: plaque?.valeur ?? null,
    canton: plaque?.canton ?? null,
    designation: designationVehicule(ligne),
    vin: ligne.vin,
    premiereMiseEnCirculationLe: ligne.date1reCirculation,
    identificationIncomplete: ligne.identificationIncomplete,
  };
}

/** Dernier relevé kilométrique connu (RM-23) — sert la garde `VEHICULE_KILOMETRAGE_REGRESSIF`
 *  à la réception (CT-08 : la comparaison se fait toujours en km, jamais dans l'unité saisie). */
export async function chargerDernierKilometrage(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehiculeKilometrage | null> {
  const [ligne] = await tx
    .select()
    .from(vehiculeKilometrage)
    .where(and(eq(vehiculeKilometrage.tenantId, ctx.tenantId), eq(vehiculeKilometrage.vehiculeId, vehiculeId)))
    .orderBy(desc(vehiculeKilometrage.releveLe))
    .limit(1);
  return ligne ?? null;
}

/** Détenteur courant d'un véhicule (`au is null`), `null` si aucun (véhicule jamais rattaché). */
export async function chargerDetenteurCourantId(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<string | null> {
  const [ligne] = await tx
    .select({ clientId: vehiculeDetention.clientId })
    .from(vehiculeDetention)
    .where(and(eq(vehiculeDetention.tenantId, ctx.tenantId), eq(vehiculeDetention.vehiculeId, vehiculeId), isNull(vehiculeDetention.au)))
    .limit(1);
  return ligne?.clientId ?? null;
}

/** Adresse de facturation figée à l'ouverture de l'OR (RM-50) : `facturation` active si elle
 *  existe, sinon repli sur `principale` (tout client en a une, RM-03). */
export async function chargerAdresseFacturation(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  clientId: string,
): Promise<LigneClientAdresse | null> {
  const lignes = await tx
    .select()
    .from(clientAdresse)
    .where(
      and(
        eq(clientAdresse.tenantId, ctx.tenantId),
        eq(clientAdresse.clientId, clientId),
        eq(clientAdresse.actif, true),
        or(eq(clientAdresse.type, 'facturation'), eq(clientAdresse.type, 'principale')),
      ),
    );
  return lignes.find((l) => l.type === 'facturation') ?? lignes.find((l) => l.type === 'principale') ?? null;
}

/** Conditions commerciales en vigueur à la date `le` (RM-07, RM-50) — au plus une ligne, garanti
 *  par la contrainte d'exclusion en base sur `client_condition`. */
export async function chargerConditionsEnVigueur(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  clientId: string,
  le: Date,
): Promise<LigneClientCondition | null> {
  const dateJour = le.toISOString().slice(0, 10);
  const lignes = await tx
    .select()
    .from(clientCondition)
    .where(and(eq(clientCondition.tenantId, ctx.tenantId), eq(clientCondition.clientId, clientId)));
  return lignes.find((l) => l.valideDu <= dateJour && (l.valideAu === null || l.valideAu >= dateJour)) ?? null;
}

/**
 * Réglages d'atelier du tenant (`parametre_atelier`, une ligne par tenant) — table de
 * configuration ordinaire du schéma Drizzle partagé, lue directement plutôt que par jeton (voir
 * la note en tête de `atelier.jetons.ts`). Valeurs de repli = celles de la migration
 * `0005_parametrage.sql`, pour le cas défensif où la ligne n'existerait pas encore (tenant créé
 * hors du chemin normal, ex. fixture de test).
 */
const PARAMETRES_ATELIER_PAR_DEFAUT: Omit<LigneParametreAtelier, 'tenantId' | 'creeLe' | 'modifieLe'> = {
  orPrefixe: null,
  orPorteeNumerotation: 'tenant',
  orResetAnnuel: true,
  uniteTemps: 'heures_decimales',
  plafondDefautCentimes: null,
  chevauchementPointageAutorise: false,
  pointageObligatoirePourTerminer: false,
  controleQualite: 'jamais',
  signatureReception: 'recommandee',
  kmEntreeObligatoire: true,
  kmSortieObligatoire: false,
  restitutionAvantPaiement: true,
  multiPayeursAutorise: false,
  arrondiPointage: 'quart',
  orSansRdvAutorise: true,
  rdvRetroactifAuto: false,
  etatPlanifieActif: false,
  langueDocuments: 'client',
  politiqueDemontageRefuse: 'offrir',
  visibiliteHistoriqueNouveauDetenteur: 'technique',
  attentePiecesLongueDefaut: 'A',
  mentionSecurite: 'obligatoire',
  deuxOrMemeVehicule: 'avertir',
  expertiseAlerteMois: 2,
  noShowSeuilAlerte: 2,
  blocageJoursAlerte: 3,
  pointageDureeMaxHeures: 12,
  tamponPretMinutes: 30,
  produitsAtelier: {},
  rabaisMaxParRole: {},
  periodicitesExpertise: {},
  relanceNonRetire: {},
};

export async function chargerParametresAtelier(
  tx: TransactionDfa,
  ctx: ContexteTenant,
): Promise<Omit<LigneParametreAtelier, 'tenantId' | 'creeLe' | 'modifieLe'>> {
  const [ligne] = await tx
    .select()
    .from(parametreAtelier)
    .where(eq(parametreAtelier.tenantId, ctx.tenantId))
    .limit(1);
  return ligne ?? PARAMETRES_ATELIER_PAR_DEFAUT;
}

export interface ResumeUtilisateur {
  readonly utilisateurId: string;
  readonly nomAffiche: string;
}

export async function chargerResumeUtilisateur(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  utilisateurId: string | null,
): Promise<ResumeUtilisateur | null> {
  if (!utilisateurId) return null;
  const [ligne] = await tx
    .select({ id: utilisateur.id, prenom: utilisateur.prenom, nom: utilisateur.nom })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)))
    .limit(1);
  if (!ligne) return null;
  return { utilisateurId: ligne.id, nomAffiche: `${ligne.prenom} ${ligne.nom}` };
}
