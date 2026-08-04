import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  TYPES_RESULTAT_RECHERCHE,
  type ParametresRecherche,
  type ReponseRecherche,
  type ResultatRecherche,
  type StatutDocumentVente,
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
 *     par fragment y forcerait un seq scan. À statuer avec expert-database avant d'ajouter cette
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
 *      porte désormais `'document_vente'` (posé par l'agent propriétaire de `packages/shared/`, pas
 *      ici). Une seule déclaration de la constante dans le dépôt, vérifiée par l'agent qui l'a posée.
 *
 *   2. INDEX — TOUJOURS MANQUANT au 30.07.2026, signalé et relayé à l'agent propriétaire de
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
    // `GardeDroit` au niveau route, pour les QUATRE natures de résultat) — un rôle qui n'a pas
    // `facturation.document.lire` ne voit AUCUN résultat `document_vente`, pas seulement leurs
    // montants (qui n'apparaissent de toute façon jamais dans `resume`, voir `chercherDocuments`).
    // `MATRICE_DROITS` est lue ici, jamais modifiée (`apps/api/src/auth/` hors périmètre).
    const role = this.contexte.exigerPrincipal().role;
    const peutVoirDocuments = (MATRICE_DROITS[role] ?? []).includes('facturation.document.lire');

    return this.acces.enTenant(ctx, async (tx) => {
      const [vehicules, clients, ordres, documents] = await Promise.all([
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
      ].sort((a, b) => b.score - a.score);

      const limiteEffective = Math.max(limite, garantis.length);
      const resultats = [...garantis, ...reste].slice(0, limiteEffective);

      return { resultats, plaqueInterchangeable: vehicules.plaqueInterchangeable };
    });
  }
}
