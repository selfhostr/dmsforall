import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { formaterNomClient, type ClientResume, type VehiculeResume } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  article,
  client,
  clientAdresse,
  clientCondition,
  ordreReparation,
  parametreAtelier,
  rendezVous,
  utilisateur,
  vehicule,
  vehiculeDetention,
  vehiculeKilometrage,
  vehiculePlaque,
  type LigneArticle,
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

/** `nomAffiche` d'un client : raison sociale pour une entreprise, "Prénom Nom" sinon. */
export function nomAfficheClient(
  row: Pick<LigneClient, 'type' | 'nom' | 'prenom' | 'raisonSociale'>,
): string {
  return formaterNomClient(row);
}

/** Rendu d'affichage d'un véhicule : `marque modele version`, espaces superflus retirés. */
export function designationVehicule(
  row: Pick<LigneVehicule, 'marque' | 'modele' | 'version'>,
): string {
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

/**
 * `ligne_or.article_id` (RP-19, étape 3) — même doctrine que `chargerClientLigne` : la FK
 * (`ligne_or_fk_article`, migration 0029) garantirait de toute façon l'appartenance au tenant,
 * mais un rejet lisible AVANT l'écriture (`RESSOURCE_INTROUVABLE`) vaut mieux qu'une violation de
 * contrainte traduite après coup. Le RLS est le filet, jamais le mécanisme — d'où le rescoping
 * explicite sur `tenant_id` ici comme partout ailleurs dans ce fichier.
 */
export async function chargerArticleLigne(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  articleId: string,
): Promise<LigneArticle> {
  const [ligne] = await tx
    .select()
    .from(article)
    .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Article ${articleId} introuvable.`);
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

/**
 * `ClientResume.telephone/localite/nombreVehicules/dernierPassageLe` (§ champs de désambiguïsation
 * comptoir) ÉCART DE CONTRAT SIGNALÉ : `packages/shared` a étendu `ClientResume` avec ces quatre
 * champs pendant l'écriture de ce module (voir `clients/mappers.ts`, doctrine identique côté
 * `clients/`) — aucun ne se déduit de `LigneClient` seule. Copie locale de la même doctrine, PAS
 * un appel à `clients/mappers.ts` (pas de dépendance de compilation entre modules d'experts
 * parallèles). Un seul appel par assemblage de document OR (un seul client par OR), jamais dans
 * une boucle de liste — le coût de ces requêtes supplémentaires est borné.
 */
export async function versClientResume(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  ligne: LigneClient,
): Promise<ClientResume> {
  const [adressePrincipale] = await tx
    .select({ localite: clientAdresse.localite })
    .from(clientAdresse)
    .where(
      and(
        eq(clientAdresse.tenantId, ctx.tenantId),
        eq(clientAdresse.clientId, ligne.id),
        eq(clientAdresse.type, 'principale'),
        eq(clientAdresse.actif, true),
      ),
    )
    .limit(1);

  const vehiculesDetenus = await tx
    .select({ id: vehiculeDetention.id })
    .from(vehiculeDetention)
    .where(
      and(
        eq(vehiculeDetention.tenantId, ctx.tenantId),
        eq(vehiculeDetention.clientId, ligne.id),
        isNull(vehiculeDetention.au),
      ),
    );

  const [dernierOrOuvert] = await tx
    .select({ ouvertLe: ordreReparation.ouvertLe })
    .from(ordreReparation)
    .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.clientId, ligne.id)))
    .orderBy(desc(ordreReparation.ouvertLe))
    .limit(1);

  return {
    id: ligne.id,
    numeroClient: ligne.numero,
    nomAffiche: nomAfficheClient(ligne),
    type: ligne.type,
    statut: ligne.statut,
    langueCorrespondance: ligne.langue,
    poObligatoire: ligne.poObligatoire,
    telephone: ligne.telephone,
    email: ligne.email,
    localite: adressePrincipale?.localite ?? null,
    nombreVehicules: vehiculesDetenus.length,
    dernierPassageLe: dernierOrOuvert?.ouvertLe ? dernierOrOuvert.ouvertLe.toISOString() : null,
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
    .where(
      and(
        eq(vehiculePlaque.tenantId, ctx.tenantId),
        eq(vehiculePlaque.vehiculeId, vehiculeId),
        isNull(vehiculePlaque.au),
      ),
    )
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

export function construireVehiculeResume(
  ligne: LigneVehicule,
  plaque: LigneVehiculePlaque | null,
): VehiculeResume {
  return {
    id: ligne.id,
    plaque: plaque?.valeur ?? null,
    canton: plaque?.canton ?? null,
    designation: designationVehicule(ligne),
    vin: ligne.vin,
    premiereMiseEnCirculationLe: ligne.date1reCirculation,
    identificationIncomplete: ligne.identificationIncomplete,
    emplacementLibre: ligne.emplacementLibre,
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
    .where(
      and(
        eq(vehiculeKilometrage.tenantId, ctx.tenantId),
        eq(vehiculeKilometrage.vehiculeId, vehiculeId),
      ),
    )
    .orderBy(desc(vehiculeKilometrage.releveLe))
    .limit(1);
  return ligne ?? null;
}

/**
 * Relevé « réception » écrit à l'ouverture directe d'un OR (statut initial `ouvert`) avec un
 * kilométrage d'entrée : sans lui, la fiche véhicule afficherait « Aucun kilométrage relevé »
 * alors que l'OR porte 84'500 km. Le chemin planifié -> ouvert l'écrit déjà (`receptionner`).
 * Idempotent (un relevé « réception » existe déjà pour cet OR : rien) et jamais bloquant : un
 * kilométrage inférieur au dernier relevé n'est pas inscrit, la correction passe par la
 * saisie dédiée (motif + droit fort, RM-24).
 */
export async function enregistrerReleveReception(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  params: {
    readonly vehiculeId: string;
    readonly orId: string;
    readonly valeur: number;
    readonly unite: LigneVehiculeKilometrage['unite'];
    readonly valeurKm: number;
    readonly releveLe: Date;
    readonly saisiParId: string;
  },
): Promise<boolean> {
  const [existant] = await tx
    .select({ id: vehiculeKilometrage.id })
    .from(vehiculeKilometrage)
    .where(
      and(
        eq(vehiculeKilometrage.tenantId, ctx.tenantId),
        eq(vehiculeKilometrage.ordreReparationId, params.orId),
        eq(vehiculeKilometrage.source, 'reception'),
      ),
    )
    .limit(1);
  if (existant) return false;
  const dernier = await chargerDernierKilometrage(tx, ctx, params.vehiculeId);
  if (dernier?.valeurKm != null && params.valeurKm < dernier.valeurKm) return false;
  await tx.insert(vehiculeKilometrage).values({
    tenantId: ctx.tenantId,
    vehiculeId: params.vehiculeId,
    valeur: params.valeur,
    unite: params.unite,
    releveLe: params.releveLe,
    source: 'reception',
    motifRegression: null,
    ordreReparationId: params.orId,
    saisiParId: params.saisiParId,
  });
  return true;
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
    .where(
      and(
        eq(vehiculeDetention.tenantId, ctx.tenantId),
        eq(vehiculeDetention.vehiculeId, vehiculeId),
        isNull(vehiculeDetention.au),
      ),
    )
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
  return (
    lignes.find((l) => l.type === 'facturation') ??
    lignes.find((l) => l.type === 'principale') ??
    null
  );
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
  /**
   * Borne haute EXCLUSIVE — alignée sur la contrainte `EXCLUDE ... daterange(valide_du, valide_au,
   * '[)')` de `client_condition` (migration 0006_clients.sql). Même défaut que
   * `service-ligne-or.ts::resoudreTauxHoraireCentimes` (RM-65) : une lecture inclusive de
   * `valideAu` désaccorde le code de la base sur une bascule de conditions saisie « ancien jusqu'au
   * 10 inclus, nouveau dès le 10 ». Tri décroissant sur `valideDu` avant le `.find()` : ceinture et
   * bretelles, l'EXCLUDE garantit qu'au plus une période n'est en vigueur à une date donnée, mais un
   * `.find()` sur un résultat potentiellement ambigu ne doit jamais dépendre d'un ordre non garanti
   * — la période la plus récemment valide est celle qui a un sens métier en cas d'ambiguïté.
   */
  return (
    [...lignes]
      .sort((a, b) => b.valideDu.localeCompare(a.valideDu))
      .find((l) => l.valideDu <= dateJour && (l.valideAu === null || l.valideAu > dateJour)) ?? null
  );
}

/**
 * Réglages d'atelier du tenant (`parametre_atelier`, une ligne par tenant) — table de
 * configuration ordinaire du schéma Drizzle partagé, lue directement plutôt que par jeton (voir
 * la note en tête de `atelier.jetons.ts`). Valeurs de repli = celles de la migration
 * `0005_parametrage.sql`, pour le cas défensif où la ligne n'existerait pas encore (tenant créé
 * hors du chemin normal, ex. fixture de test).
 */
const PARAMETRES_ATELIER_PAR_DEFAUT: Omit<
  LigneParametreAtelier,
  'tenantId' | 'creeLe' | 'modifieLe'
> = {
  orPrefixe: null,
  orPorteeNumerotation: 'tenant',
  orResetAnnuel: true,
  uniteTemps: 'heures_decimales',
  plafondDefautCentimes: null,
  plafondAvoirReceptionnaireCentimes: null,
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

/**
 * Lecture MINIMALE du rendez-vous lié (`ordre_reparation.rendez_vous_id`) — sert uniquement à
 * amorcer `restitution_promise_le` à la réception (`service-transitions.ts::receptionner`, le
 * cœur du chantier RDV). Volontairement PAS un import du service `rendezvous/` (sens unique de
 * dépendance déjà établi dans ce dépôt : `atelier` ne dépend jamais d'un module qui dépend
 * lui-même d'`atelier`, même précédent que `FacturationModule`/`VehiculesModule`/`PiecesModule`
 * ci-dessus) — lecture directe du schéma Drizzle partagé, comme tout le reste de ce fichier.
 */
export interface DonneesRendezVousPourAmorcage {
  readonly date: string;
  readonly moment: 'matin' | 'apres_midi' | 'toute_journee';
  readonly heureSouhaitee: string | null;
  readonly dureeEstimeeMinutes: number;
}

export async function chargerRendezVousPourAmorcage(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  rendezVousId: string,
): Promise<DonneesRendezVousPourAmorcage | null> {
  const [ligne] = await tx
    .select({
      date: rendezVous.date,
      moment: rendezVous.moment,
      heureSouhaitee: rendezVous.heureSouhaitee,
      dureeEstimeeMinutes: rendezVous.dureeEstimeeMinutes,
    })
    .from(rendezVous)
    .where(and(eq(rendezVous.tenantId, ctx.tenantId), eq(rendezVous.id, rendezVousId)))
    .limit(1);
  return ligne ?? null;
}

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

/**
 * Version PAR LOT de `chargerResumeUtilisateur` ci-dessus — UNE requête `IN (...)` pour tous les
 * identifiants distincts d'une liste, plutôt qu'une requête par élément (N+1 mesuré à l'audit sur
 * trois listes d'`atelier/` : devis complémentaires, demandes client, journal d'un OR). Même
 * doctrine de lot que `enrichirVehicules` (`recherche/service-recherche.ts`) et que
 * `ServiceOr.calculerTotauxAvecDestinataires` (résolveur `client` par lot, ce fichier) : Set pour
 * dédoublonner avant de partir en base — un même utilisateur peut apparaître pour plusieurs lignes
 * (ex. plusieurs demandes saisies par la même personne) — puis Map pour l'appariement en mémoire.
 *
 * `null` dans `utilisateurIds` est filtré avant la requête (un `saisiParId`/`emetteurId`/
 * `utilisateurId` optionnel n'a jamais de résumé à résoudre). Un identifiant SANS ligne
 * correspondante (utilisateur supprimé, ou d'un autre tenant si le scope tenant échouait) est
 * simplement absent du Map rendu — c'est à l'appelant de retomber sur `null`, jamais une valeur
 * inventée (`resumes.get(id) ?? null`, jamais `resumes.get(id)!`) : même règle « une absence n'est
 * pas une valeur » que `chargerResumeUtilisateur`, dont le comportement reste inchangé — cette
 * fonction ne le remplace pas, elle sert les appelants qui itéraient dessus.
 */
export async function chargerResumesUtilisateurs(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  utilisateurIds: readonly (string | null)[],
): Promise<ReadonlyMap<string, ResumeUtilisateur>> {
  const ids = [...new Set(utilisateurIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const lignes = await tx
    .select({ id: utilisateur.id, prenom: utilisateur.prenom, nom: utilisateur.nom })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), inArray(utilisateur.id, ids)));
  return new Map(
    lignes.map((l) => [l.id, { utilisateurId: l.id, nomAffiche: `${l.prenom} ${l.nom}` }]),
  );
}
