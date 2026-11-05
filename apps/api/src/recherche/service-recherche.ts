import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  TYPES_RESULTAT_RECHERCHE,
  type ParametresRecherche,
  type ReponseRecherche,
  type ResultatRecherche,
  type SaisonPneu,
  type StatutArticle,
  type StatutDepotPneus,
  type StatutDocumentVente,
  type StatutFournisseur,
  type StatutOrdreReparation,
  type TypeClient,
  type TypeDocumentVente,
  type TypeResultatRecherche,
} from '@dfa/shared';

// Import en LECTURE SEULE de `MATRICE_DROITS` (propriété `apps/api/src/auth/`, hors périmètre
// `apps/api/src/recherche/**`) — même patron déjà établi par `common/droits/garde-droit.ts` pour
// consulter la matrice sans y ajouter d'action. Sert uniquement à RF-116 (voir `chercherDocuments`
// ci-dessous) : aucune action n'est créée, modifiée ni retirée ici.
import { MATRICE_DROITS } from '../auth/matrice-droits';
import { ServiceContexteRequete } from '../common/contexte';
import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  anneeDepuisDate,
  designationVehicule,
  etatAfficheOrdreReparation,
  formaterDateJour,
  motifFragment,
  nomAfficheClient,
} from './utilitaires-recherche';

/**
 * `GET /recherche` — §7.5 du contrat d'API (D-08).
 *
 * Quatre recherches indépendantes (véhicules, clients, ordres de réparation, documents de vente),
 * exécutées dans la MÊME transaction `enTenant` (donc sur la même connexion : `Promise.all` ne les
 * parallélise pas réellement — `pg` les met en pipeline sur la connexion et les résout dans l'ordre
 * — mais ne nuit pas non plus, et garde le code lisible). Chaque recherche rescope explicitement
 * sur `tenant_id` en plus du RLS posé par `enTenant()` (le RLS est le filet, jamais le mécanisme).
 *
 * PÉRIMÈTRE DÉLIBÉRÉMENT RESTREINT par rapport à §7.5 / RM-112, signalé plutôt que deviné :
 *   - la recherche par TÉLÉPHONE (mentionnée par RM-112) N'EST PAS implémentée ici. Elle est
 *     absente de la liste explicite « Ce qui doit marcher » de la tâche (plaque+historique, VIN,
 *     nom client, numéro d'OR), et aucun index d'expression trigram n'existe sur le téléphone
 *     (seul `client_telephone_idx`, un btree exact sur `telephone_e164`, existe) — une recherche
 *     par fragment y forcerait un seq scan. À statuer avec l'équipe base de données avant d'ajouter cette
 *     capacité.
 *   - la recherche par MARQUE/MODÈLE n'est pas non plus incluse : absente de RM-112 (qui ne cite
 *     que « plaque, VIN, nom, téléphone ») et de la liste « Ce qui doit marcher » de la tâche.
 *     `vehicule_marque_modele_idx` (btree, préfixe seulement) existe déjà si besoin futur.
 *   - le CHAMP EMAIL est cherché en EXACT (indexé, `client_email_idx`), pas en fragment — un
 *     fragment d'adresse e-mail n'a pas de sens métier au comptoir (contrairement à un fragment de
 *     plaque ou de nom).
 *
 * INDEX SUR `ordre_reparation.numero` — RÉSOLU (migration 0013) : GIN trigram sur
 * `(tenant_id, normaliser_recherche(numero))`, même famille que plaque/VIN/nom (0006/0007). Vérifié
 * de nouveau ici (`chercherOrdres` matche exactement l'expression indexée), et re-confirmé en
 * exécution le 30.07.2026 : `GET /recherche?q=2026-2&types=ordre_reparation` sur la base semée
 * renvoie l'OR attendu.
 *
 * DOCUMENTS DE VENTE (devis/bon de commande/facture/avoir, numérotation `AAAA-NNNNN`, étape 2) —
 * cherchables par `numero` depuis le 30.07.2026 (`chercherDocuments` ci-dessous), sur le MÊME
 * mécanisme de normalisation que les trois autres natures (`public.normaliser_recherche()` — PAS la
 * colonne générée `numero_normalise` de `document_vente`, qui normalise différemment : voir la
 * mesure ci-dessous). Deux points réglés en le construisant, chacun documenté au plus près du code :
 *
 *   1. CONTRAT GELÉ — `TypeResultatRecherche` (`packages/shared/src/contrats/atelier/enums.ts:520`)
 *      porte désormais `'document_vente'` (posé par le lot propriétaire de `packages/shared/`, pas
 *      ici). Une seule déclaration de la constante dans le dépôt, vérifiée par le lot qui l'a posée.
 *
 *   2. INDEX — TOUJOURS MANQUANT au 30.07.2026, signalé et relayé à le lot propriétaire de
 *      `apps/api/src/db/`, PAS créé ici (`db/` n'est pas mon périmètre). AUCUN index n'exploite
 *      `normaliser_recherche(numero)` sur `document_vente` : le seul index existant,
 *      `document_vente_numero_recherche_idx`, est un btree sur la colonne générée `numero_normalise`
 *      (`upper(regexp_replace(numero, '[^0-9A-Za-z]', '', 'g'))`) — une normalisation DIFFÉRENTE de
 *      `normaliser_recherche()` (celle de tout le reste de ce moteur de recherche). Réutiliser
 *      `numero_normalise` aurait recréé exactement l'incohérence à éviter (deux normalisations pour
 *      une même saisie, `2026-2` ne trouvant pas la même chose selon la nature de résultat) — donc
 *      PAS réutilisé, `normaliser_recherche()` retenu par cohérence, au prix d'un index à poser.
 *      Mesuré le 30.07.2026, volume synthétique 91 254 lignes (5 ans × 50 documents/jour, même
 *      ordre de grandeur que le banc de 0013), transaction annulée (`rollback`) sur `dfa_dev` :
 *        - `numero_normalise LIKE '%...%'` (mécanisme `document_vente` existant, incohérent avec le
 *          reste, PAS RETENU) : Bitmap Heap Scan, 15.5 ms — le btree existant ne sert de toute façon
 *          pas un `LIKE '%fragment%'`, le plan retombe sur `document_vente_client_idx` puis filtre
 *          en tas.
 *        - `normaliser_recherche(numero) LIKE normaliser_recherche('%2026-2%')` (mécanisme RETENU
 *          ci-dessous, sans index dédié aujourd'hui) : 229 ms.
 *        - `normaliser_recherche(numero) = normaliser_recherche('2026-00002')` (numéro complet, sans
 *          index dédié) : 195 ms.
 *        - MÊME requête fragment, avec un index
 *          `create index document_vente_numero_recherche_trgm_idx on document_vente
 *          using gin (tenant_id, normaliser_recherche(numero) gin_trgm_ops)` posé DANS LA MÊME
 *          transaction annulée (donc jamais committé) : Bitmap Index Scan, 2.2 ms fragment / 2.1 ms
 *          exact. Même famille exacte que `ordre_reparation_numero_recherche_idx` (0013).
 *      CONSÉQUENCE ACCEPTÉE EN ATTENDANT : `chercherDocuments` tourne aujourd'hui en Bitmap Heap
 *      Scan (~230 ms au volume mesuré), pas en Bitmap Index Scan — correct fonctionnellement, lent
 *      au grand volume. Pas de solution de repli plus rapide sans réintroduire l'incohérence de
 *      normalisation que la mesure ci-dessus a justement écartée.
 *
 * RF-116 (visibilité des montants) : AUCUNE clé monétaire dans `resume` pour `document_vente`, même
 * posture que les trois autres natures — pas d'arbitrage nécessaire (`ResultatRechercheDto` le
 * documente déjà). Portillon supplémentaire posé sur `facturation.document.lire`
 * (`MATRICE_DROITS`, lu ici en lecture seule) : accordé à TOUS les rôles aujourd'hui donc no-op
 * fonctionnel, posé par cohérence défensive si ce droit venait à se restreindre.
 *
 * ARTICLES / FOURNISSEURS / DÉPÔTS DE PNEUS — ajoutés après coup (réclamés par le magasinier et le
 * hangar à pneus), MÊME mécanique que `document_vente` : `normaliser_recherche()`, portillon de
 * droit supplémentaire ADDITIONNEL à `recherche.executer` (déjà vérifié au niveau route pour les
 * SEPT natures), lu en lecture seule depuis `MATRICE_DROITS` :
 *   - `article`     -> `pieces.article.lire`     (voir `chercherArticles`)
 *   - `fournisseur` -> `pieces.fournisseur.lire`  (voir `chercherFournisseurs`)
 *   - `depot_pneu`  -> `pneus.depot.lire`         (voir `chercherDepotsPneus`)
 * Un rôle sans le droit correspondant ne voit JAMAIS ce type de résultat, même si `types` le
 * demande explicitement dans la requête — même garantie que `document_vente`/`facturation.document.lire`.
 *
 * Aucun index trigram GIN n'existe encore sur `article` (designation/reference_principale),
 * `fournisseur` (nom) ni `depot_pneus` (code_case) : seuls des btree classiques existent. MÊME
 * traitement que `document_vente` ci-dessus — implémenté quand même via `normaliser_recherche()`
 * par cohérence du moteur (Bitmap Heap Scan en attendant), index signalés au plus près du code de
 * chaque fonction, PAS posés ici (`apps/api/src/db/` hors périmètre `recherche/`).
 */

/** Miroir de `vehicules/vehicules.constants.ts::STATUTS_OR_OUVERTS` (module voisin, L1-09, hors
 *  périmètre `apps/api/src/recherche/**`) — même duplication assumée que pour `nomAfficheClient`
 *  et `designationVehicule` (voir `utilitaires-recherche.ts`). Un OR « ouvert » au sens du badge
 *  comptoir n'est ni `restitue`, ni `cloture`, ni `annule`. */
const STATUTS_OR_FERMES: readonly StatutOrdreReparation[] = ['restitue', 'cloture', 'annule'];

const TOUS_LES_TYPES: readonly TypeResultatRecherche[] = TYPES_RESULTAT_RECHERCHE;

// =================================================================================================
// Véhicules — plaque (courante + historique + interchangeable) et VIN
// =================================================================================================

type LigneCorrespondanceVehiculeBrute = {
  readonly vehicule_id: string;
  readonly champ: 'plaque' | 'vin';
  readonly valeur: string;
  readonly au: string | Date | null;
  readonly interchangeable: boolean;
  readonly normalise: string;
  readonly score: number;
};

async function chercherCorrespondancesVehicule(
  tx: TransactionDfa,
  tenantId: string,
  motif: string,
  limiteInterne: number,
): Promise<readonly LigneCorrespondanceVehiculeBrute[]> {
  const resultat = await tx.execute<LigneCorrespondanceVehiculeBrute>(sql`
    (
      select vp.vehicule_id                                          as vehicule_id,
             'plaque'::text                                          as champ,
             vp.valeur                                                as valeur,
             vp.au                                                    as au,
             vp.interchangeable                                       as interchangeable,
             public.normaliser_recherche(vp.valeur)                   as normalise,
             public.similarity(
               public.normaliser_recherche(vp.valeur),
               public.normaliser_recherche(${motif})
             )                                                        as score
        from public.vehicule_plaque vp
       where vp.tenant_id = ${tenantId}
         and public.normaliser_recherche(vp.valeur) like public.normaliser_recherche(${motif})
       order by score desc
       limit ${limiteInterne}
    )
    union all
    (
      select v.id                                                     as vehicule_id,
             'vin'::text                                               as champ,
             v.vin                                                     as valeur,
             null::date                                                as au,
             false                                                     as interchangeable,
             public.normaliser_recherche(coalesce(v.vin, ''))          as normalise,
             public.similarity(
               public.normaliser_recherche(coalesce(v.vin, '')),
               public.normaliser_recherche(${motif})
             )                                                         as score
        from public.vehicule v
       where v.tenant_id = ${tenantId}
         and v.vin is not null
         and public.normaliser_recherche(coalesce(v.vin, '')) like public.normaliser_recherche(${motif})
       order by score desc
       limit ${limiteInterne}
    )
  `);
  return resultat.rows;
}

interface CorrespondanceVehiculeChoisie {
  readonly champ: 'plaque' | 'vin';
  readonly valeur: string;
  readonly historique: boolean;
  readonly porteeJusquLe: string | undefined;
  readonly score: number;
}

/** Un véhicule ne peut apparaître qu'UNE fois : on garde la correspondance de plus haut score. */
function choisirMeilleureCorrespondanceVehicule(
  lignes: readonly LigneCorrespondanceVehiculeBrute[],
): Map<string, CorrespondanceVehiculeChoisie> {
  const parVehicule = new Map<string, CorrespondanceVehiculeChoisie>();
  for (const ligne of lignes) {
    const historique = ligne.au !== null;
    const candidate: CorrespondanceVehiculeChoisie = {
      champ: ligne.champ,
      valeur: ligne.valeur,
      historique,
      porteeJusquLe: ligne.au !== null ? formaterDateJour(ligne.au) : undefined,
      score: ligne.score,
    };
    const existante = parVehicule.get(ligne.vehicule_id);
    if (!existante || candidate.score > existante.score) {
      parVehicule.set(ligne.vehicule_id, candidate);
    }
  }
  return parVehicule;
}

/**
 * RM-18/§6.9 : une plaque COURANTE (`au is null`) marquée `interchangeable`, portée à la fois par
 * deux véhicules distincts, déclenche `plaqueInterchangeable: true` — et les DEUX véhicules
 * doivent rester dans la réponse, jamais un seul choisi à la place de l'utilisateur.
 */
function detecterPlaqueInterchangeable(lignes: readonly LigneCorrespondanceVehiculeBrute[]): {
  readonly interchangeable: boolean;
  readonly vehiculeIds: ReadonlySet<string>;
} {
  const groupes = new Map<string, { vehiculeIds: Set<string>; interchangeable: boolean }>();
  for (const ligne of lignes) {
    if (ligne.champ !== 'plaque' || ligne.au !== null) continue;
    const groupe = groupes.get(ligne.normalise) ?? {
      vehiculeIds: new Set<string>(),
      interchangeable: false,
    };
    groupe.vehiculeIds.add(ligne.vehicule_id);
    groupe.interchangeable = groupe.interchangeable || ligne.interchangeable;
    groupes.set(ligne.normalise, groupe);
  }
  for (const groupe of groupes.values()) {
    if (groupe.interchangeable && groupe.vehiculeIds.size >= 2) {
      return { interchangeable: true, vehiculeIds: groupe.vehiculeIds };
    }
  }
  return { interchangeable: false, vehiculeIds: new Set<string>() };
}

type LigneVehiculeEnrichieBrute = {
  readonly vehicule_id: string;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  readonly date_1re_circulation: string | Date | null;
  readonly plaque_courante: string | null;
  readonly plaque_professionnelle: boolean | null;
  readonly detenteur_type: TypeClient | null;
  readonly detenteur_nom: string | null;
  readonly detenteur_prenom: string | null;
  readonly detenteur_raison_sociale: string | null;
  readonly or_id: string | null;
  readonly or_numero: string | null;
};

/**
 * Enrichit un lot de véhicules déjà appariés : désignation, plaque COURANTE (affichée même quand
 * la correspondance vient du VIN ou d'une plaque historique), détenteur courant, OR ouvert le plus
 * récent. Une seule requête (jointures `LATERAL … LIMIT 1`, chacune sur un index déjà posé :
 * `vehicule_plaque_courante_idx`, `vehicule_detention_courante_idx`, `ordre_reparation_vehicule_idx`)
 * plutôt que N+1 requêtes par véhicule.
 *
 * `v.statut = 'actif'` : un véhicule archivé (RM-31 : doublon, exporté, détruit…) n'a pas sa place
 * dans la recherche comptoir — interprétation, non explicitement tranchée par le contrat, signalée
 * ici plutôt que silencieuse.
 */
async function enrichirVehicules(
  tx: TransactionDfa,
  tenantId: string,
  vehiculeIds: readonly string[],
): Promise<readonly LigneVehiculeEnrichieBrute[]> {
  if (vehiculeIds.length === 0) return [];

  const resultat = await tx.execute<LigneVehiculeEnrichieBrute>(sql`
    select
      v.id                        as vehicule_id,
      v.marque                    as marque,
      v.modele                    as modele,
      v.version                   as version,
      v.date_1re_circulation      as date_1re_circulation,
      vp.valeur                   as plaque_courante,
      vp.professionnelle          as plaque_professionnelle,
      cl.type                     as detenteur_type,
      cl.nom                      as detenteur_nom,
      cl.prenom                   as detenteur_prenom,
      cl.raison_sociale           as detenteur_raison_sociale,
      orx.id                      as or_id,
      orx.numero                  as or_numero
      from public.vehicule v
      left join lateral (
        select valeur, professionnelle
          from public.vehicule_plaque
         where tenant_id = v.tenant_id and vehicule_id = v.id and au is null
         limit 1
      ) vp on true
      left join lateral (
        select c.type, c.nom, c.prenom, c.raison_sociale
          from public.vehicule_detention vd
          join public.client c on c.tenant_id = vd.tenant_id and c.id = vd.client_id
         where vd.tenant_id = v.tenant_id and vd.vehicule_id = v.id and vd.au is null
         limit 1
      ) cl on true
      left join lateral (
        select id, numero
          from public.ordre_reparation
         where tenant_id = v.tenant_id and vehicule_id = v.id
           and statut not in (${sql.join(
             STATUTS_OR_FERMES.map((statut) => sql`${statut}`),
             sql`, `,
           )})
         order by ouvert_le desc nulls last, cree_le desc
         limit 1
      ) orx on true
     where v.tenant_id = ${tenantId}
       and v.id = any(${sql.param(vehiculeIds)}::uuid[])
       and v.statut = 'actif'
  `);
  return resultat.rows;
}

function construireResultatVehicule(
  vehiculeId: string,
  correspondance: CorrespondanceVehiculeChoisie,
  enrichissement: LigneVehiculeEnrichieBrute,
): ResultatRecherche {
  const resume: Record<string, unknown> = {
    designation: designationVehicule({
      marque: enrichissement.marque,
      modele: enrichissement.modele,
      version: enrichissement.version,
    }),
  };

  const annee = anneeDepuisDate(enrichissement.date_1re_circulation);
  if (annee !== null) resume.annee = annee;
  if (enrichissement.plaque_courante !== null) resume.plaque = enrichissement.plaque_courante;
  if (enrichissement.plaque_professionnelle === true) resume.plaqueProfessionnelle = true;

  if (enrichissement.detenteur_type !== null) {
    const detenteurNom = nomAfficheClient({
      type: enrichissement.detenteur_type,
      nom: enrichissement.detenteur_nom,
      prenom: enrichissement.detenteur_prenom,
      raisonSociale: enrichissement.detenteur_raison_sociale,
    });
    if (detenteurNom) resume.detenteurNom = detenteurNom;
  }

  if (enrichissement.or_id !== null && enrichissement.or_numero !== null) {
    resume.ordreReparationOuvert = { id: enrichissement.or_id, numero: enrichissement.or_numero };
  }

  return {
    type: 'vehicule',
    id: vehiculeId,
    score: correspondance.score,
    correspondance: {
      champ: correspondance.champ,
      valeur: correspondance.valeur,
      historique: correspondance.historique,
      ...(correspondance.porteeJusquLe !== undefined
        ? { porteeJusquLe: correspondance.porteeJusquLe }
        : {}),
    },
    resume,
  };
}

interface ResultatVehicules {
  readonly resultats: readonly ResultatRecherche[];
  readonly plaqueInterchangeable: boolean;
  /** Identifiants à garantir dans la réponse finale même si `limite` est très bas (RM-18). */
  readonly vehiculeIdsGarantis: ReadonlySet<string>;
}

async function chercherVehicules(
  tx: TransactionDfa,
  tenantId: string,
  motif: string,
  limiteInterne: number,
): Promise<ResultatVehicules> {
  const correspondances = await chercherCorrespondancesVehicule(tx, tenantId, motif, limiteInterne);
  if (correspondances.length === 0) {
    return { resultats: [], plaqueInterchangeable: false, vehiculeIdsGarantis: new Set<string>() };
  }

  const meilleures = choisirMeilleureCorrespondanceVehicule(correspondances);
  const { interchangeable, vehiculeIds: vehiculeIdsGarantis } =
    detecterPlaqueInterchangeable(correspondances);

  const enrichissements = await enrichirVehicules(tx, tenantId, [...meilleures.keys()]);
  const parVehicule = new Map(enrichissements.map((e) => [e.vehicule_id, e]));

  const resultats: ResultatRecherche[] = [];
  for (const [vehiculeId, correspondance] of meilleures) {
    const enrichissement = parVehicule.get(vehiculeId);
    // Absent de l'enrichissement = véhicule archivé (filtre `statut = 'actif'` ci-dessus) : on
    // ignore la correspondance plutôt que de renvoyer un résultat sans désignation.
    if (!enrichissement) continue;
    resultats.push(construireResultatVehicule(vehiculeId, correspondance, enrichissement));
  }

  return { resultats, plaqueInterchangeable: interchangeable, vehiculeIdsGarantis };
}

// =================================================================================================
// Clients — nom / raison sociale (fragment) et e-mail (exact)
// =================================================================================================

type LigneClientMatchBrute = {
  readonly id: string;
  readonly type: TypeClient;
  readonly numero: string;
  readonly nom: string | null;
  readonly prenom: string | null;
  readonly raison_sociale: string | null;
  readonly telephone: string | null;
  readonly localite: string | null;
  readonly champ: 'nom' | 'email';
  readonly valeur_matchee: string;
  readonly score: number;
};

async function chercherClients(
  tx: TransactionDfa,
  tenantId: string,
  q: string,
  motif: string,
  limiteInterne: number,
): Promise<readonly ResultatRecherche[]> {
  const resultat = await tx.execute<LigneClientMatchBrute>(sql`
    select
      c.id             as id,
      c.type           as type,
      c.numero         as numero,
      c.nom            as nom,
      c.prenom         as prenom,
      c.raison_sociale as raison_sociale,
      c.telephone      as telephone,
      (
        select a.localite
          from public.client_adresse a
         where a.tenant_id = c.tenant_id and a.client_id = c.id and a.type = 'principale' and a.actif
         order by a.cree_le desc
         limit 1
      )                as localite,
      case
        when public.normaliser_recherche(coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''), ''))
             like public.normaliser_recherche(${motif})
        then 'nom' else 'email'
      end              as champ,
      case
        when public.normaliser_recherche(coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''), ''))
             like public.normaliser_recherche(${motif})
        then coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''))
        else c.email
      end              as valeur_matchee,
      case
        when public.normaliser_recherche(coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''), ''))
             like public.normaliser_recherche(${motif})
        then public.similarity(
               public.normaliser_recherche(coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''), '')),
               public.normaliser_recherche(${motif})
             )
        else 1.0
      end              as score
      from public.client c
     where c.tenant_id = ${tenantId}
       and c.statut <> 'inactif'
       and (
         public.normaliser_recherche(coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''), ''))
           like public.normaliser_recherche(${motif})
         or (c.email is not null and lower(c.email) = lower(${q}))
       )
     order by score desc
     limit ${limiteInterne}
  `);

  return resultat.rows.map((ligne) => {
    const resume: Record<string, unknown> = {
      nom: nomAfficheClient({
        type: ligne.type,
        nom: ligne.nom,
        prenom: ligne.prenom,
        raisonSociale: ligne.raison_sociale,
      }),
      numeroClient: ligne.numero,
    };
    if (ligne.telephone) resume.telephone = ligne.telephone;
    if (ligne.localite) resume.localite = ligne.localite;

    return {
      type: 'client',
      id: ligne.id,
      score: ligne.score,
      correspondance: { champ: ligne.champ, valeur: ligne.valeur_matchee, historique: false },
      resume,
    } satisfies ResultatRecherche;
  });
}

// =================================================================================================
// Ordres de réparation — numéro
// =================================================================================================

type LigneOrdreMatchBrute = {
  readonly id: string;
  readonly numero: string;
  readonly statut: StatutOrdreReparation;
  readonly attente_accord: boolean;
  readonly attente_pieces: boolean;
  readonly attente_externe: boolean;
  readonly plaque_figee: string | null;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  readonly score: number;
};

async function chercherOrdres(
  tx: TransactionDfa,
  tenantId: string,
  q: string,
  motif: string,
  limiteInterne: number,
): Promise<readonly ResultatRecherche[]> {
  const resultat = await tx.execute<LigneOrdreMatchBrute>(sql`
    select
      o.id             as id,
      o.numero         as numero,
      o.statut         as statut,
      o.attente_accord as attente_accord,
      o.attente_pieces as attente_pieces,
      o.attente_externe as attente_externe,
      o.plaque_figee   as plaque_figee,
      v.marque         as marque,
      v.modele         as modele,
      v.version        as version,
      case
        when public.normaliser_recherche(o.numero) = public.normaliser_recherche(${q}) then 1.0
        when public.normaliser_recherche(o.numero) like public.normaliser_recherche(${q}) || '%' then 0.85
        else 0.6
      end              as score
      from public.ordre_reparation o
      join public.vehicule v on v.tenant_id = o.tenant_id and v.id = o.vehicule_id
     where o.tenant_id = ${tenantId}
       and public.normaliser_recherche(o.numero) like public.normaliser_recherche(${motif})
     order by score desc
     limit ${limiteInterne}
  `);

  return resultat.rows.map((ligne): ResultatRecherche => ({
    type: 'ordre_reparation',
    id: ligne.id,
    score: ligne.score,
    correspondance: { champ: 'numero', valeur: ligne.numero, historique: false },
    resume: {
      numero: ligne.numero,
      statut: etatAfficheOrdreReparation(
        ligne.statut,
        ligne.attente_accord,
        ligne.attente_pieces,
        ligne.attente_externe,
      ),
      ...(ligne.plaque_figee !== null ? { plaque: ligne.plaque_figee } : {}),
      designationVehicule: designationVehicule({
        marque: ligne.marque,
        modele: ligne.modele,
        version: ligne.version,
      }),
    },
  }));
}

// =================================================================================================
// Documents de vente — numéro (devis, bon de commande, facture, avoir)
// =================================================================================================

type LigneDocumentMatchBrute = {
  readonly id: string;
  readonly numero: string;
  readonly type_document: TypeDocumentVente;
  readonly statut: StatutDocumentVente;
  /** Figée sur le document lui-même (MD-24) — pas de jointure sur `client` nécessaire, et le nom
   *  affiché reste celui du moment de l'émission même si le client a changé de raison sociale
   *  depuis (cohérent avec l'immuabilité documentaire, RF-1→RF-19). */
  readonly client_designation_figee: string;
  readonly date_document: string | Date | null;
  readonly score: number;
};

/**
 * Même patron que `chercherOrdres` ci-dessus : normalisation par `public.normaliser_recherche()`
 * (cohérence du moteur — voir la note de tête de fichier pour la mesure qui a écarté
 * `numero_normalise`), score par paliers (exact > préfixe > fragment), tenant scopé explicitement
 * EN PLUS du RLS (`document_vente_isolation_tenant`, migration 0010).
 *
 * `d.numero is not null` : filtre défensif, PAS structurellement nécessaire — un brouillon a
 * `numero is null` (contrainte `document_vente_numero_brouillon_chk`) et
 * `normaliser_recherche(null)` vaut déjà `null`, qu'aucun `like` ne matche. Explicite plutôt
 * qu'implicite : un brouillon n'a pas vocation à sortir d'une recherche comptoir par numéro.
 *
 * RF-116 : AUCUNE clé monétaire dans `resume` (voir note de tête de fichier) — ni ici, ni dans la
 * requête SQL elle-même (aucune colonne `*_centimes` sélectionnée).
 */
async function chercherDocuments(
  tx: TransactionDfa,
  tenantId: string,
  q: string,
  motif: string,
  limiteInterne: number,
): Promise<readonly ResultatRecherche[]> {
  const resultat = await tx.execute<LigneDocumentMatchBrute>(sql`
    select
      d.id                       as id,
      d.numero                   as numero,
      d.type_document            as type_document,
      d.statut                   as statut,
      d.client_designation_figee as client_designation_figee,
      d.date_document            as date_document,
      case
        when public.normaliser_recherche(d.numero) = public.normaliser_recherche(${q}) then 1.0
        when public.normaliser_recherche(d.numero) like public.normaliser_recherche(${q}) || '%' then 0.85
        else 0.6
      end                        as score
      from public.document_vente d
     where d.tenant_id = ${tenantId}
       and d.numero is not null
       and public.normaliser_recherche(d.numero) like public.normaliser_recherche(${motif})
     order by score desc
     limit ${limiteInterne}
  `);

  return resultat.rows.map((ligne): ResultatRecherche => ({
    type: 'document_vente',
    id: ligne.id,
    score: ligne.score,
    correspondance: { champ: 'numero', valeur: ligne.numero, historique: false },
    resume: {
      numero: ligne.numero,
      typeDocument: ligne.type_document,
      statut: ligne.statut,
      clientNom: ligne.client_designation_figee,
      ...(ligne.date_document !== null
        ? { dateDocument: formaterDateJour(ligne.date_document) }
        : {}),
    },
  }));
}

// =================================================================================================
// Articles — désignation et référence principale (catalogue pièces)
// =================================================================================================

type LigneArticleMatchBrute = {
  readonly id: string;
  readonly designation: string;
  readonly reference_principale: string;
  readonly numero_article: string | null;
  readonly statut: StatutArticle;
  readonly champ: 'designation' | 'reference';
  readonly valeur_matchee: string;
  readonly score: number;
};

/**
 * Réclamé par le magasinier — cherche sur `designation` OU `reference_principale`, par fragment
 * (même patron de CASE que `chercherClients` pour choisir entre deux champs candidats : le
 * premier qui matche donne `champ`/`valeur_matchee`/`score`).
 *
 * AUCUNE clé monétaire dans `resume` (ni `prix_achat_centimes` ni `prix_vente_ttc_centimes`,
 * `article.ts:62-63`) — même posture RF-116 que `chercherDocuments`.
 *
 * INDEX MANQUANT, signalé — PAS posé ici (`apps/api/src/db/` hors périmètre) : aucun index
 * trigram GIN n'exploite `normaliser_recherche(designation)` ni
 * `normaliser_recherche(reference_principale)` sur `article` (seuls `article_designation_idx` et
 * `article_reference_principale_idx`, deux btree classiques, existent — migration 0022). Même
 * situation que `document_vente` avant l'ajout de sa recherche par numéro (voir la note de tête de
 * fichier) : implémenté quand même par cohérence du moteur, au prix d'un Bitmap Heap Scan en
 * attendant l'index. Index proposés :
 *   `create index article_recherche_designation_trgm_idx on public.article
 *      using gin (tenant_id, normaliser_recherche(designation) gin_trgm_ops)`
 *   `create index article_recherche_reference_trgm_idx on public.article
 *      using gin (tenant_id, normaliser_recherche(reference_principale) gin_trgm_ops)`
 *
 * `a.statut <> 'desactive'` : un article désactivé est retiré du catalogue délibérément.
 * `obsolete` reste cherchable (encore potentiellement en stock, légitimement recherché au
 * comptoir) — INTERPRÉTATION signalée, pas une exigence explicite du contrat.
 */
async function chercherArticles(
  tx: TransactionDfa,
  tenantId: string,
  q: string,
  motif: string,
  limiteInterne: number,
): Promise<readonly ResultatRecherche[]> {
  const resultat = await tx.execute<LigneArticleMatchBrute>(sql`
    select
      a.id                   as id,
      a.designation          as designation,
      a.reference_principale as reference_principale,
      a.numero_article       as numero_article,
      a.statut               as statut,
      case
        when public.normaliser_recherche(a.designation) like public.normaliser_recherche(${motif})
        then 'designation' else 'reference'
      end                    as champ,
      case
        when public.normaliser_recherche(a.designation) like public.normaliser_recherche(${motif})
        then a.designation else a.reference_principale
      end                    as valeur_matchee,
      case
        when public.normaliser_recherche(a.designation) like public.normaliser_recherche(${motif})
        then public.similarity(
               public.normaliser_recherche(a.designation),
               public.normaliser_recherche(${q})
             )
        else public.similarity(
               public.normaliser_recherche(a.reference_principale),
               public.normaliser_recherche(${q})
             )
      end                    as score
      from public.article a
     where a.tenant_id = ${tenantId}
       and a.statut <> 'desactive'
       and (
         public.normaliser_recherche(a.designation) like public.normaliser_recherche(${motif})
         or public.normaliser_recherche(a.reference_principale) like public.normaliser_recherche(${motif})
       )
     order by score desc
     limit ${limiteInterne}
  `);

  return resultat.rows.map((ligne): ResultatRecherche => {
    const resume: Record<string, unknown> = {
      designation: ligne.designation,
      referencePrincipale: ligne.reference_principale,
      statut: ligne.statut,
    };
    if (ligne.numero_article !== null) resume.numeroArticle = ligne.numero_article;

    return {
      type: 'article',
      id: ligne.id,
      score: ligne.score,
      correspondance: { champ: ligne.champ, valeur: ligne.valeur_matchee, historique: false },
      resume,
    };
  });
}

// =================================================================================================
// Fournisseurs — nom
// =================================================================================================

type LigneFournisseurMatchBrute = {
  readonly id: string;
  readonly nom: string;
  readonly statut: StatutFournisseur;
  readonly score: number;
};

/**
 * Réclamé par le magasinier — cherche sur `nom` par fragment.
 *
 * INDEX MANQUANT, signalé — PAS posé ici : aucun trigram GIN sur `fournisseur.nom` (seul
 * `fournisseur_nom_idx`, btree classique, existe — migration 0022). Index proposé :
 *   `create index fournisseur_recherche_trgm_idx on public.fournisseur
 *      using gin (tenant_id, normaliser_recherche(nom) gin_trgm_ops)`
 *
 * `f.statut <> 'inactif'` : un fournisseur désactivé n'a plus vocation à apparaître dans une
 * recherche comptoir active — même doctrine que `article`/`client` ci-dessus.
 */
async function chercherFournisseurs(
  tx: TransactionDfa,
  tenantId: string,
  q: string,
  motif: string,
  limiteInterne: number,
): Promise<readonly ResultatRecherche[]> {
  const resultat = await tx.execute<LigneFournisseurMatchBrute>(sql`
    select
      f.id     as id,
      f.nom    as nom,
      f.statut as statut,
      public.similarity(
        public.normaliser_recherche(f.nom),
        public.normaliser_recherche(${q})
      )        as score
      from public.fournisseur f
     where f.tenant_id = ${tenantId}
       and f.statut <> 'inactif'
       and public.normaliser_recherche(f.nom) like public.normaliser_recherche(${motif})
     order by score desc
     limit ${limiteInterne}
  `);

  return resultat.rows.map((ligne): ResultatRecherche => ({
    type: 'fournisseur',
    id: ligne.id,
    score: ligne.score,
    correspondance: { champ: 'nom', valeur: ligne.nom, historique: false },
    resume: { nom: ligne.nom, statut: ligne.statut },
  }));
}

// =================================================================================================
// Dépôts de pneus — plaque courante du véhicule, nom du détenteur courant, repère de rangement
// =================================================================================================

type LigneDepotPneusMatchBrute = {
  readonly id: string;
  readonly saison: SaisonPneu;
  readonly statut: StatutDepotPneus;
  readonly code_case: string | null;
  readonly dimension: string | null;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  readonly plaque_courante: string | null;
  readonly detenteur_type: TypeClient | null;
  readonly detenteur_nom: string | null;
  readonly detenteur_prenom: string | null;
  readonly detenteur_raison_sociale: string | null;
  readonly champ: 'plaque' | 'nom' | 'code_case';
  readonly valeur_matchee: string;
  readonly score: number;
};

/**
 * Réclamé par le hangar à pneus — cherche sur la plaque COURANTE du véhicule, OU le nom/raison
 * sociale du détenteur COURANT, OU le repère de rangement (`code_case`), par fragment. Priorité
 * plaque > nom > code_case dans le CASE (même idiome que `chercherClients`/`chercherArticles` :
 * le premier candidat qui matche donne `champ`/`valeur_matchee`/`score`) — arbitraire mais stable,
 * aucune hiérarchie n'étant imposée par le contrat.
 *
 * RPP-01 : `depot_pneus` ne porte AUCUN `client_id` direct — le détenteur courant se lit via
 * `vehicule` -> `vehicule_detention` (`au is null`) -> `client`, EXACTEMENT la même jointure
 * LATERAL que `enrichirVehicules` ci-dessus (réutilisée à l'identique, pas réinventée). La plaque
 * courante se lit de la même façon via `vehicule_plaque` (`au is null`).
 *
 * INDEX MANQUANT, signalé — PAS posé ici : aucun trigram GIN sur `depot_pneus.code_case` (texte
 * libre, RPP-07, aucun index aujourd'hui). La plaque et le nom du détenteur profitent déjà des
 * index trigram posés pour `chercherVehicules`/`chercherClients` (migrations 0006/0007), traversés
 * ici par jointure plutôt que dupliqués. Index proposé pour `code_case` :
 *   `create index depot_pneus_recherche_code_case_trgm_idx on public.depot_pneus
 *      using gin (tenant_id, normaliser_recherche(code_case) gin_trgm_ops)`
 *
 * `d.statut <> 'sorti'` — INTERPRÉTATION SIGNALÉE, pas une exigence explicite du contrat : un jeu
 * `sorti` (rendu au client, vendu, mis au rebut — RPP-05, statut terminal) n'a plus vocation à
 * apparaître dans une recherche comptoir active. Même doctrine que `v.statut = 'actif'` pour les
 * véhicules (`enrichirVehicules` ci-dessus).
 */
async function chercherDepotsPneus(
  tx: TransactionDfa,
  tenantId: string,
  q: string,
  motif: string,
  limiteInterne: number,
): Promise<readonly ResultatRecherche[]> {
  const resultat = await tx.execute<LigneDepotPneusMatchBrute>(sql`
    select
      d.id              as id,
      d.saison          as saison,
      d.statut          as statut,
      d.code_case       as code_case,
      d.dimension       as dimension,
      v.marque          as marque,
      v.modele          as modele,
      v.version         as version,
      vp.valeur         as plaque_courante,
      cl.type           as detenteur_type,
      cl.nom            as detenteur_nom,
      cl.prenom         as detenteur_prenom,
      cl.raison_sociale as detenteur_raison_sociale,
      case
        when vp.valeur is not null
             and public.normaliser_recherche(vp.valeur) like public.normaliser_recherche(${motif})
        then 'plaque'
        when cl.id is not null
             and public.normaliser_recherche(
                   coalesce(cl.raison_sociale, cl.nom || ' ' || coalesce(cl.prenom, ''), '')
                 ) like public.normaliser_recherche(${motif})
        then 'nom'
        else 'code_case'
      end               as champ,
      case
        when vp.valeur is not null
             and public.normaliser_recherche(vp.valeur) like public.normaliser_recherche(${motif})
        then vp.valeur
        when cl.id is not null
             and public.normaliser_recherche(
                   coalesce(cl.raison_sociale, cl.nom || ' ' || coalesce(cl.prenom, ''), '')
                 ) like public.normaliser_recherche(${motif})
        then coalesce(cl.raison_sociale, cl.nom || ' ' || coalesce(cl.prenom, ''))
        else d.code_case
      end               as valeur_matchee,
      case
        when vp.valeur is not null
             and public.normaliser_recherche(vp.valeur) like public.normaliser_recherche(${motif})
        then public.similarity(public.normaliser_recherche(vp.valeur), public.normaliser_recherche(${q}))
        when cl.id is not null
             and public.normaliser_recherche(
                   coalesce(cl.raison_sociale, cl.nom || ' ' || coalesce(cl.prenom, ''), '')
                 ) like public.normaliser_recherche(${motif})
        then public.similarity(
               public.normaliser_recherche(
                 coalesce(cl.raison_sociale, cl.nom || ' ' || coalesce(cl.prenom, ''), '')
               ),
               public.normaliser_recherche(${q})
             )
        else public.similarity(
               public.normaliser_recherche(coalesce(d.code_case, '')),
               public.normaliser_recherche(${q})
             )
      end               as score
      from public.depot_pneus d
      join public.vehicule v on v.tenant_id = d.tenant_id and v.id = d.vehicule_id
      left join lateral (
        select valeur
          from public.vehicule_plaque
         where tenant_id = d.tenant_id and vehicule_id = d.vehicule_id and au is null
         limit 1
      ) vp on true
      left join lateral (
        select c.id, c.type, c.nom, c.prenom, c.raison_sociale
          from public.vehicule_detention vd
          join public.client c on c.tenant_id = vd.tenant_id and c.id = vd.client_id
         where vd.tenant_id = d.tenant_id and vd.vehicule_id = d.vehicule_id and vd.au is null
         limit 1
      ) cl on true
     where d.tenant_id = ${tenantId}
       and d.statut <> 'sorti'
       and (
         (vp.valeur is not null
           and public.normaliser_recherche(vp.valeur) like public.normaliser_recherche(${motif}))
         or (cl.id is not null
           and public.normaliser_recherche(
                 coalesce(cl.raison_sociale, cl.nom || ' ' || coalesce(cl.prenom, ''), '')
               ) like public.normaliser_recherche(${motif}))
         or (d.code_case is not null
           and public.normaliser_recherche(d.code_case) like public.normaliser_recherche(${motif}))
       )
     order by score desc
     limit ${limiteInterne}
  `);

  return resultat.rows.map((ligne): ResultatRecherche => {
    const resume: Record<string, unknown> = {
      saison: ligne.saison,
      statut: ligne.statut,
      designationVehicule: designationVehicule({
        marque: ligne.marque,
        modele: ligne.modele,
        version: ligne.version,
      }),
    };
    if (ligne.dimension !== null) resume.dimension = ligne.dimension;
    if (ligne.code_case !== null) resume.codeCase = ligne.code_case;
    if (ligne.plaque_courante !== null) resume.plaque = ligne.plaque_courante;
    if (ligne.detenteur_type !== null) {
      const detenteurNom = nomAfficheClient({
        type: ligne.detenteur_type,
        nom: ligne.detenteur_nom,
        prenom: ligne.detenteur_prenom,
        raisonSociale: ligne.detenteur_raison_sociale,
      });
      if (detenteurNom) resume.detenteurNom = detenteurNom;
    }

    return {
      type: 'depot_pneu',
      id: ligne.id,
      score: ligne.score,
      correspondance: { champ: ligne.champ, valeur: ligne.valeur_matchee, historique: false },
      resume,
    };
  });
}

// =================================================================================================
// Service
// =================================================================================================

@Injectable()
export class ServiceRecherche {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  async rechercher(ctx: ContexteTenant, params: ParametresRecherche): Promise<ReponseRecherche> {
    const q = params.q.trim();

    // Garde-fou, PAS une seconde normalisation : si `q` ne contient aucune lettre ni chiffre (par
    // exemple une suite de tirets/espaces), `normaliser_recherche(q)` rendrait une chaîne vide et
    // `like '%%'` matcherait TOUT le tenant. On ne devine jamais ce que `normaliser_recherche` va
    // produire — on refuse seulement le cas où ça ne peut structurellement rien produire d'utile.
    if (!/[\p{L}\p{N}]/u.test(q)) {
      return { resultats: [], plaqueInterchangeable: false };
    }

    const typesDemandes = new Set<TypeResultatRecherche>(
      params.types && params.types.length > 0 ? params.types : TOUS_LES_TYPES,
    );
    const limite = params.limite;
    const motif = motifFragment(q);

    // RF-116 : portillon supplémentaire, indépendant de `recherche.executer` (déjà vérifié par
    // `GardeDroit` au niveau route, pour les SEPT natures de résultat) — un rôle qui n'a pas
    // `facturation.document.lire` ne voit AUCUN résultat `document_vente`, pas seulement leurs
    // montants (qui n'apparaissent de toute façon jamais dans `resume`, voir `chercherDocuments`).
    // Même patron pour `article`/`fournisseur`/`depot_pneu` : chacun a son propre portillon,
    // indépendant des deux autres et de `recherche.executer` (voir la note de tête de fichier).
    // `MATRICE_DROITS` est lue ici, jamais modifiée (`apps/api/src/auth/` hors périmètre).
    const role = this.contexte.exigerPrincipal().role;
    const droitsRole = MATRICE_DROITS[role] ?? [];
    const peutVoirDocuments = droitsRole.includes('facturation.document.lire');
    const peutVoirArticles = droitsRole.includes('pieces.article.lire');
    const peutVoirFournisseurs = droitsRole.includes('pieces.fournisseur.lire');
    const peutVoirDepotsPneus = droitsRole.includes('pneus.depot.lire');

    return this.acces.enTenant(ctx, async (tx) => {
      const [vehicules, clients, ordres, documents, articles, fournisseurs, depotsPneus] =
        await Promise.all([
          typesDemandes.has('vehicule')
            ? chercherVehicules(tx, ctx.tenantId, motif, limite)
            : Promise.resolve<ResultatVehicules>({
                resultats: [],
                plaqueInterchangeable: false,
                vehiculeIdsGarantis: new Set<string>(),
              }),
          typesDemandes.has('client')
            ? chercherClients(tx, ctx.tenantId, q, motif, limite)
            : Promise.resolve<readonly ResultatRecherche[]>([]),
          typesDemandes.has('ordre_reparation')
            ? chercherOrdres(tx, ctx.tenantId, q, motif, limite)
            : Promise.resolve<readonly ResultatRecherche[]>([]),
          typesDemandes.has('document_vente') && peutVoirDocuments
            ? chercherDocuments(tx, ctx.tenantId, q, motif, limite)
            : Promise.resolve<readonly ResultatRecherche[]>([]),
          typesDemandes.has('article') && peutVoirArticles
            ? chercherArticles(tx, ctx.tenantId, q, motif, limite)
            : Promise.resolve<readonly ResultatRecherche[]>([]),
          typesDemandes.has('fournisseur') && peutVoirFournisseurs
            ? chercherFournisseurs(tx, ctx.tenantId, q, motif, limite)
            : Promise.resolve<readonly ResultatRecherche[]>([]),
          typesDemandes.has('depot_pneu') && peutVoirDepotsPneus
            ? chercherDepotsPneus(tx, ctx.tenantId, q, motif, limite)
            : Promise.resolve<readonly ResultatRecherche[]>([]),
        ]);

      // RM-18 : la paire interchangeable ne doit JAMAIS être tronquée par `limite`, y compris
      // `limite=1`. On la réserve donc en tête, puis on complète avec le reste trié par score
      // jusqu'à `limite` — au prix, dans ce seul cas pathologique, de dépasser `limite` de 1
      // élément (2 véhicules garantis contre une limite de 1). Documenté, pas silencieux.
      const garantis = vehicules.resultats.filter((r) => vehicules.vehiculeIdsGarantis.has(r.id));
      const reste = [
        ...vehicules.resultats.filter((r) => !vehicules.vehiculeIdsGarantis.has(r.id)),
        ...clients,
        ...ordres,
        ...documents,
        ...articles,
        ...fournisseurs,
        ...depotsPneus,
      ].sort((a, b) => b.score - a.score);

      const limiteEffective = Math.max(limite, garantis.length);
      const resultats = [...garantis, ...reste].slice(0, limiteEffective);

      return { resultats, plaqueInterchangeable: vehicules.plaqueInterchangeable };
    });
  }
}
