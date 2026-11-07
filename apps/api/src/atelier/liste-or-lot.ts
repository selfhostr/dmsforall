import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { ClientResume, ClientResumeListe, VehiculeResumeListe } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  client,
  devisComplementaire,
  devisComplementaireLigne,
  ligneOr,
  orControleQualite,
  ordreReparationDemande,
  pointage,
  vehicule,
  vehiculePlaque,
  type LigneDevisComplementaire,
  type LigneDevisComplementaireLigne,
  type LigneLigneOr,
  type LigneOrControleQualite,
  type LigneOrdreReparation,
  type LigneOrdreReparationDemande,
  type LigneVehicule,
  type LigneVehiculePlaque,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { calculerNomAffiche } from '../common/identite-client';

import {
  chargerResumesUtilisateurs,
  designationVehicule,
  nomAfficheClient,
  type ResumeUtilisateur,
} from './references';

/**
 * Chargement PAR LOT de tout ce qu'il faut pour assembler une PAGE d'ordres de réparation
 * (`ServiceOr.lister`). Remplace l'ancien `assemblerDocument` appelé pour chaque ligne de la page :
 * ~12-13 requêtes par OR, en série sur la connexion de la transaction (un `Promise.all` sur un même
 * `tx` ne parallélise rien), soit ~650 requêtes pour 50 OR. Ici : UNE requête par table pour toute
 * la page (`= any(...)`), quelle que soit sa taille, puis appariement en mémoire par `Map`.
 *
 * Chaque requête re-scope explicitement sur `tenant_id` (le RLS est le filet, jamais le mécanisme).
 * Les lectures qui existent aussi en version unitaire (`or-requetes.ts`, `references.ts`) gardent
 * le MÊME ordre de tri, pour que les deux chemins rendent des listes identiques.
 */

export interface LotListeOr {
  readonly clients: ReadonlyMap<string, ClientResume>;
  readonly vehicules: ReadonlyMap<string, LigneVehicule>;
  readonly plaques: ReadonlyMap<string, LigneVehiculePlaque>;
  readonly demandes: ReadonlyMap<string, readonly LigneOrdreReparationDemande[]>;
  readonly lignes: ReadonlyMap<string, readonly LigneLigneOr[]>;
  readonly devis: ReadonlyMap<string, readonly LigneDevisComplementaire[]>;
  readonly lignesDevis: ReadonlyMap<string, readonly LigneDevisComplementaireLigne[]>;
  readonly controles: ReadonlyMap<string, LigneOrControleQualite>;
  readonly pointagesOuverts: ReadonlyMap<string, number>;
  readonly utilisateurs: ReadonlyMap<string, ResumeUtilisateur>;
  /** Destinataires des groupes payeur TIERS (`ligne_or.payeur_client_id`), par id de client. */
  readonly destinatairesPayeurs: ReadonlyMap<string, { clientId: string; nomAffiche: string }>;
}

/**
 * Références à la ligne `client` EXTERNE depuis les sous-sélections ci-dessous. Volontairement
 * écrites en SQL brut qualifié : dans un `select` mono-table, Drizzle rend une colonne sans son
 * préfixe de table (`"id"`), que la sous-sélection résoudrait alors vers SA PROPRE table
 * (`vehicule_detention.id`) — comparaison silencieusement fausse (mesuré : `nombreVehicules` à 0).
 */
const CLIENT_ID = sql.raw('"client"."id"');
const CLIENT_TENANT_ID = sql.raw('"client"."tenant_id"');

function grouper<T>(elements: readonly T[], cle: (e: T) => string): Map<string, T[]> {
  const parCle = new Map<string, T[]>();
  for (const e of elements) {
    const k = cle(e);
    const groupe = parCle.get(k);
    if (groupe) groupe.push(e);
    else parCle.set(k, [e]);
  }
  return parCle;
}

const unique = (ids: readonly (string | null)[]): string[] => [
  ...new Set(ids.filter((id): id is string => id !== null)),
];

export async function chargerLotListeOr(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  ors: readonly LigneOrdreReparation[],
  voitMontants: boolean,
): Promise<LotListeOr> {
  const orIds = ors.map((o) => o.id);
  const clientIds = unique(ors.map((o) => o.clientId));
  const vehiculeIds = unique(ors.map((o) => o.vehiculeId));
  const t = ctx.tenantId;

  // Phase 1 — tout ce qui ne dépend que des OR de la page.
  const [clientsLignes, vehiculesLignes, plaquesLignes, demandesLignes, lignesLignes, devisLignes] =
    await Promise.all([
      // Client + les trois champs de désambiguïsation de `ClientResume` (localité de l'adresse
      // principale active, nombre de véhicules détenus, dernier passage), en SOUS-SÉLECTIONS
      // scalaires : une seule requête au lieu de quatre. Mêmes critères que
      // `references.ts::versClientResume`. `dernier passage` : tri `ouvert_le desc` brut (donc
      // `NULL` en tête, comme avant) — un OR sans date d'ouverture rend `null`, jamais la date
      // d'un autre.
      tx
        .select({
          ligne: client,
          localite: sql<string | null>`(
            select ca.localite from public.client_adresse ca
             where ca.tenant_id = ${CLIENT_TENANT_ID} and ca.client_id = ${CLIENT_ID}
               and ca.type = 'principale' and ca.actif = true
             limit 1)`,
          nombreVehicules: sql<number>`(
            select count(*)::int from public.vehicule_detention vd
             where vd.tenant_id = ${CLIENT_TENANT_ID} and vd.client_id = ${CLIENT_ID}
               and vd.au is null)`,
          dernierPassage: sql<Date | string | null>`(
            select o.ouvert_le from public.ordre_reparation o
             where o.tenant_id = ${CLIENT_TENANT_ID} and o.client_id = ${CLIENT_ID}
             order by o.ouvert_le desc limit 1)`,
        })
        .from(client)
        .where(and(eq(client.tenantId, t), inArray(client.id, clientIds))),
      vehiculeIds.length === 0
        ? Promise.resolve<LigneVehicule[]>([])
        : tx
            .select()
            .from(vehicule)
            .where(and(eq(vehicule.tenantId, t), inArray(vehicule.id, vehiculeIds))),
      vehiculeIds.length === 0
        ? Promise.resolve<LigneVehiculePlaque[]>([])
        : tx
            .select()
            .from(vehiculePlaque)
            .where(
              and(
                eq(vehiculePlaque.tenantId, t),
                inArray(vehiculePlaque.vehiculeId, vehiculeIds),
                isNull(vehiculePlaque.au),
              ),
            )
            // Même règle que `chargerPlaqueCourante` : la plus récemment ouverte d'abord.
            .orderBy(sql`${vehiculePlaque.du} desc`),
      tx
        .select()
        .from(ordreReparationDemande)
        .where(
          and(
            eq(ordreReparationDemande.tenantId, t),
            inArray(ordreReparationDemande.ordreReparationId, orIds),
          ),
        )
        .orderBy(asc(ordreReparationDemande.ordre)),
      tx
        .select()
        .from(ligneOr)
        .where(and(eq(ligneOr.tenantId, t), inArray(ligneOr.ordreReparationId, orIds)))
        .orderBy(asc(ligneOr.numeroOrdre)),
      tx
        .select()
        .from(devisComplementaire)
        .where(
          and(
            eq(devisComplementaire.tenantId, t),
            inArray(devisComplementaire.ordreReparationId, orIds),
          ),
        )
        .orderBy(asc(devisComplementaire.numeroOrdre)),
    ]);

  const [controlesLignes, pointagesLignes] = await Promise.all([
    tx
      .select()
      .from(orControleQualite)
      .where(
        and(eq(orControleQualite.tenantId, t), inArray(orControleQualite.ordreReparationId, orIds)),
      ),
    // `cumulsPointage.pointagesOuverts` : compte des pointages `en_cours` par OR. Le port
    // `LecturePointage` n'expose que la lecture UNITAIRE (`pointagesOuvertsPourOr`, une requête par
    // OR) ; on lit donc la table directement, par lot — même critère (`statut = 'en_cours'` sur
    // l'OR). Voir le rapport : le bon endroit à terme est une méthode de lot sur le port.
    tx
      .select({
        ordreReparationId: pointage.ordreReparationId,
        nombre: sql<number>`count(*)::int`,
      })
      .from(pointage)
      .where(
        and(
          eq(pointage.tenantId, t),
          inArray(pointage.ordreReparationId, orIds),
          eq(pointage.statut, 'en_cours'),
        ),
      )
      .groupBy(pointage.ordreReparationId),
  ]);

  const lignesParOr = grouper(lignesLignes, (l) => l.ordreReparationId);
  const demandesParOr = grouper(demandesLignes, (d) => d.ordreReparationId);
  const devisParOr = grouper(devisLignes, (d) => d.ordreReparationId);

  // Phase 2 — dépend de la phase 1 (devis, payeurs tiers, auteurs).
  const devisIds = devisLignes.map((d) => d.id);
  const clientIdsConnus = new Set(clientsLignes.map((c) => c.ligne.id));
  const payeurIds = voitMontants
    ? unique(lignesLignes.map((l) => l.payeurClientId)).filter((id) => !clientIdsConnus.has(id))
    : [];

  const [lignesDevisLignes, payeursLignes, utilisateurs] = await Promise.all([
    devisIds.length === 0
      ? Promise.resolve<LigneDevisComplementaireLigne[]>([])
      : tx
          .select()
          .from(devisComplementaireLigne)
          .where(
            and(
              eq(devisComplementaireLigne.tenantId, t),
              inArray(devisComplementaireLigne.devisComplementaireId, devisIds),
            ),
          ),
    payeurIds.length === 0
      ? Promise.resolve<
          {
            id: string;
            type: typeof client.$inferSelect.type;
            nom: string | null;
            prenom: string | null;
            raisonSociale: string | null;
          }[]
        >([])
      : tx
          .select({
            id: client.id,
            type: client.type,
            nom: client.nom,
            prenom: client.prenom,
            raisonSociale: client.raisonSociale,
          })
          .from(client)
          .where(and(eq(client.tenantId, t), inArray(client.id, payeurIds))),
    // Auteurs des demandes + émetteurs des devis. Le journal d'audit n'est pas lu en liste
    // (`modifiePar` = `null`, voir `assemblerDocument`).
    chargerResumesUtilisateurs(tx, ctx, [
      ...demandesLignes.map((d) => d.saisiParId),
      ...devisLignes.map((d) => d.emetteurId),
    ]),
  ]);

  const clients = new Map<string, ClientResume>(
    clientsLignes.map((c) => [
      c.ligne.id,
      {
        id: c.ligne.id,
        numeroClient: c.ligne.numero,
        nomAffiche: nomAfficheClient(c.ligne),
        type: c.ligne.type,
        statut: c.ligne.statut,
        langueCorrespondance: c.ligne.langue,
        poObligatoire: c.ligne.poObligatoire,
        telephone: c.ligne.telephone,
        localite: c.localite ?? null,
        nombreVehicules: c.nombreVehicules,
        dernierPassageLe: c.dernierPassage ? new Date(c.dernierPassage).toISOString() : null,
      },
    ]),
  );

  const destinatairesPayeurs = new Map<string, { clientId: string; nomAffiche: string }>();
  for (const c of clientsLignes) {
    destinatairesPayeurs.set(c.ligne.id, {
      clientId: c.ligne.id,
      nomAffiche: calculerNomAffiche(c.ligne),
    });
  }
  for (const c of payeursLignes) {
    destinatairesPayeurs.set(c.id, { clientId: c.id, nomAffiche: calculerNomAffiche(c) });
  }

  const plaques = new Map<string, LigneVehiculePlaque>();
  for (const p of plaquesLignes) if (!plaques.has(p.vehiculeId)) plaques.set(p.vehiculeId, p);

  const controles = new Map<string, LigneOrControleQualite>();
  for (const c of controlesLignes) controles.set(c.ordreReparationId, c);

  return {
    clients,
    vehicules: new Map(vehiculesLignes.map((v) => [v.id, v])),
    plaques,
    demandes: demandesParOr,
    lignes: lignesParOr,
    devis: devisParOr,
    lignesDevis: grouper(lignesDevisLignes, (l) => l.devisComplementaireId),
    controles,
    pointagesOuverts: new Map(
      pointagesLignes.flatMap((p) =>
        p.ordreReparationId === null ? [] : [[p.ordreReparationId, p.nombre] as const],
      ),
    ),
    utilisateurs,
    destinatairesPayeurs,
  };
}

/** `RESSOURCE_INTROUVABLE` identique à `chargerClientLigne`/`chargerVehiculeLigne` : une
 *  référence d'OR sans ligne ne peut venir que d'une FK contournée — jamais silencieusement vide. */
export function exigerClient(lot: LotListeOr, clientId: string): ClientResume {
  const c = lot.clients.get(clientId);
  if (!c) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Client ${clientId} introuvable.`);
  return c;
}

export function exigerVehicule(lot: LotListeOr, vehiculeId: string): LigneVehicule {
  const v = lot.vehicules.get(vehiculeId);
  if (!v) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Véhicule ${vehiculeId} introuvable.`);
  return v;
}

// -------------------------------------------------------------------------------------------
// Forme `resume` (`GET /ordres-reparation?forme=resume`) : 3 à 4 requêtes pour toute la page, au
// lieu des ~11 du document complet. Rien n'est lu au-delà de ce que la liste affiche.
// -------------------------------------------------------------------------------------------

/** Mêmes statuts que `totaux-payeur.ts::STATUTS_EXCLUS_DES_TOTAUX` (une ligne annulée n'a jamais
 *  eu lieu, une refusée n'a jamais été faite) — écrits en SQL pour l'agrégat ; le test d'identité
 *  d'intégration compare au document complet pour garantir qu'ils ne divergent pas. */
const STATUTS_EXCLUS_SQL = sql`${ligneOr.statut} not in ('annulee', 'refusee')`;

/** Aperçu des désignations : mêmes bornes que `service-or.ts::SEUIL_DESIGNATIONS_APERCU`. */
const NOMBRE_DESIGNATIONS_APERCU = 3;

export interface AgregatLignesOr {
  readonly nombreLignes: number;
  readonly totalTtcCentimes: number;
  readonly designationsApercu: readonly string[];
  /** Technicien de la première ligne assignée (par `numero_ordre`), hors annulée/refusée. */
  readonly technicienId: string | null;
}

export interface LotResumeListeOr {
  readonly clients: ReadonlyMap<string, ClientResumeListe>;
  readonly vehicules: ReadonlyMap<string, VehiculeResumeListe>;
  readonly agregats: ReadonlyMap<string, AgregatLignesOr>;
  readonly techniciens: ReadonlyMap<string, ResumeUtilisateur>;
}

const VEHICULE_ID = sql.raw('"vehicule"."id"');
const VEHICULE_TENANT_ID = sql.raw('"vehicule"."tenant_id"');

export async function chargerLotResumeListeOr(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  ors: readonly LigneOrdreReparation[],
  voitMontants: boolean,
): Promise<LotResumeListeOr> {
  const t = ctx.tenantId;
  const orIds = ors.map((o) => o.id);
  const clientIds = unique(ors.map((o) => o.clientId));
  const vehiculeIds = unique(ors.map((o) => o.vehiculeId));

  const [clientsLignes, vehiculesLignes, agregatsLignes] = await Promise.all([
    tx
      .select({
        id: client.id,
        numero: client.numero,
        type: client.type,
        statut: client.statut,
        nom: client.nom,
        prenom: client.prenom,
        raisonSociale: client.raisonSociale,
      })
      .from(client)
      .where(and(eq(client.tenantId, t), inArray(client.id, clientIds))),
    // Plaque COURANTE (`au is null`, la plus récemment ouverte) en sous-sélections scalaires : même
    // règle que `chargerPlaqueCourante`, sans seconde requête.
    tx
      .select({
        id: vehicule.id,
        marque: vehicule.marque,
        modele: vehicule.modele,
        version: vehicule.version,
        date1reCirculation: vehicule.date1reCirculation,
        identificationIncomplete: vehicule.identificationIncomplete,
        plaque: sql<string | null>`(
          select vp.valeur from public.vehicule_plaque vp
           where vp.tenant_id = ${VEHICULE_TENANT_ID} and vp.vehicule_id = ${VEHICULE_ID}
             and vp.au is null
           order by vp.du desc limit 1)`,
        canton: sql<string | null>`(
          select vp.canton from public.vehicule_plaque vp
           where vp.tenant_id = ${VEHICULE_TENANT_ID} and vp.vehicule_id = ${VEHICULE_ID}
             and vp.au is null
           order by vp.du desc limit 1)`,
      })
      .from(vehicule)
      .where(and(eq(vehicule.tenantId, t), inArray(vehicule.id, vehiculeIds))),
    tx
      .select({
        ordreReparationId: ligneOr.ordreReparationId,
        nombre: sql<number>`count(*)::int`,
        totalTtc: voitMontants
          ? sql<number>`coalesce(sum(${ligneOr.montantTtcCentimes}) filter (where ${STATUTS_EXCLUS_SQL}), 0)::int`
          : sql<number>`0`,
        designations: sql<
          string[] | null
        >`(array_agg(btrim(${ligneOr.designation}, E' \t\r\n') order by ${ligneOr.numeroOrdre}) filter (where ${STATUTS_EXCLUS_SQL} and btrim(coalesce(${ligneOr.designation}, ''), E' \t\r\n') <> ''))[1:${sql.raw(String(NOMBRE_DESIGNATIONS_APERCU))}]`,
        technicienId: sql<
          string | null
        >`(array_agg(${ligneOr.technicienId} order by ${ligneOr.numeroOrdre}) filter (where ${ligneOr.technicienId} is not null and ${STATUTS_EXCLUS_SQL}))[1]`,
      })
      .from(ligneOr)
      .where(and(eq(ligneOr.tenantId, t), inArray(ligneOr.ordreReparationId, orIds)))
      .groupBy(ligneOr.ordreReparationId),
  ]);

  const agregats = new Map<string, AgregatLignesOr>(
    agregatsLignes.map((a) => [
      a.ordreReparationId,
      {
        nombreLignes: a.nombre,
        totalTtcCentimes: a.totalTtc,
        designationsApercu: a.designations ?? [],
        technicienId: a.technicienId,
      },
    ]),
  );
  const techniciens = await chargerResumesUtilisateurs(
    tx,
    ctx,
    [...agregats.values()].map((a) => a.technicienId),
  );

  return {
    clients: new Map(
      clientsLignes.map((c) => [
        c.id,
        {
          id: c.id,
          numeroClient: c.numero,
          nomAffiche: nomAfficheClient(c),
          type: c.type,
          statut: c.statut,
        },
      ]),
    ),
    vehicules: new Map(
      vehiculesLignes.map((v) => [
        v.id,
        {
          id: v.id,
          plaque: v.plaque,
          canton: v.canton,
          designation: designationVehicule(v),
          premiereMiseEnCirculationLe: v.date1reCirculation,
          identificationIncomplete: v.identificationIncomplete,
        },
      ]),
    ),
    agregats,
    techniciens,
  };
}

export function exigerClientListe(lot: LotResumeListeOr, clientId: string): ClientResumeListe {
  const c = lot.clients.get(clientId);
  if (!c) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Client ${clientId} introuvable.`);
  return c;
}

export function exigerVehiculeListe(
  lot: LotResumeListeOr,
  vehiculeId: string,
): VehiculeResumeListe {
  const v = lot.vehicules.get(vehiculeId);
  if (!v) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Véhicule ${vehiculeId} introuvable.`);
  return v;
}
