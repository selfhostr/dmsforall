import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DetailCollisionPlaqueVehicule, ReponseVehicule } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import {
  client,
  clientNote,
  ordreReparation,
  vehicule,
  vehiculeCampagne,
  vehiculeDetention,
  vehiculeExpertise,
  vehiculeKilometrage,
  vehiculePlaque,
  vehiculeTravailReporte,
  type LigneClient,
  type LigneClientNote,
  type LigneOrdreReparation,
  type LigneVehicule,
  type LigneVehiculeCampagne,
  type LigneVehiculeDetention,
  type LigneVehiculeExpertise,
  type LigneVehiculeKilometrage,
  type LigneVehiculePlaque,
  type LigneVehiculeTravailReporte,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import { calculerGarantie, versReponseVehicule } from './vehicule.mappers';
import { STATUTS_OR_OUVERTS } from './vehicules.constants';

/**
 * Charge la ligne `vehicule` brute, rescopée sur `tenant_id`. `404 RESSOURCE_INTROUVABLE`,
 * jamais `403` — un véhicule d'un autre tenant ne doit même pas laisser deviner qu'il existe.
 * RÉUTILISÉE par tous les sous-services (plaques, détentions, kilométrages, expertises,
 * campagnes, travaux reportés, contexte-atelier).
 */
export async function chargerLigneVehicule(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehicule> {
  const lignes = await tx
    .select()
    .from(vehicule)
    .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, vehiculeId)))
    .limit(1);
  const ligne = lignes[0];
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Véhicule introuvable.');
  }
  return ligne;
}

export async function exigerVehiculeExiste(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<void> {
  await chargerLigneVehicule(tx, ctx, vehiculeId);
}

/**
 * Construit la projection `ReponseVehicule` complète — la MÊME fonction que consomment
 * `ServiceVehicule` (CRUD) et `ServiceVehiculeDetention.changerDetenteur` (qui rend le véhicule à
 * jour dans la même transaction que le changement de détenteur), pour qu'il n'existe qu'un seul
 * endroit qui sait assembler un `ReponseVehicule`.
 */
export async function construireReponseVehicule(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
  maintenant: Date,
): Promise<ReponseVehicule> {
  const ligne = await chargerLigneVehicule(tx, ctx, vehiculeId);
  const [plaqueCourante, dernierKm] = await Promise.all([
    lirePlaqueCourante(tx, ctx, vehiculeId),
    lireDernierKilometrage(tx, ctx, vehiculeId),
  ]);
  const garantieConstructeur = calculerGarantie(
    ligne.garantieDebut,
    ligne.garantieMois,
    ligne.garantieKm,
    dernierKm?.valeurKm ?? null,
    maintenant,
  );
  return versReponseVehicule(
    ligne,
    plaqueCourante ? { valeur: plaqueCourante.valeur, canton: plaqueCourante.canton } : null,
    garantieConstructeur,
  );
}

/**
 * Requêtes de lecture PARTAGÉES entre les endpoints unitaires (L1-09) et l'agrégat
 * `contexte-atelier` (L1-10) — c'est ce qui garantit la règle « aucun champ n'existe uniquement
 * dans l'agrégat » : chaque section de `GET .../contexte-atelier` appelle EXACTEMENT la même
 * fonction que la ressource accessible seule, jamais une requête parallèle qui pourrait diverger.
 *
 * Toutes rescoping explicitement sur `tenant_id` en plus du RLS (le RLS est le filet, jamais le
 * mécanisme).
 */

async function lirePlaqueCourante(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehiculePlaque | null> {
  const lignes = await tx
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
  return lignes[0] ?? null;
}

export async function listerPlaques(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly LigneVehiculePlaque[]> {
  return tx
    .select()
    .from(vehiculePlaque)
    .where(
      and(eq(vehiculePlaque.tenantId, ctx.tenantId), eq(vehiculePlaque.vehiculeId, vehiculeId)),
    )
    .orderBy(desc(vehiculePlaque.du));
}

type LigneCollisionPlaqueBrute = {
  readonly vehicule_id: string;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  readonly valeur: string;
  readonly canton: string | null;
  readonly du: string;
  readonly au: string | null;
};

/**
 * Dette technique n°6 : après l'échec d'un INSERT sur `vehicule_plaque_collision_excl` (RM-18,
 * CT-06 — `409 VEHICULE_PLAQUE_COLLISION`), la ligne fautive n'est PAS dans l'exception (c'est une
 * contrainte d'EXCLUSION, pas une clé unique) — il faut donc aller la chercher pour nommer le
 * véhicule qui porte déjà la plaque. Reproduit EXACTEMENT le prédicat de l'EXCLUDE
 * (migrations/0007_vehicules.sql `vehicule_plaque_collision_excl`) : `tenant_id`,
 * `normaliser_recherche(valeur)`, chevauchement de `daterange(du, au, '[)')`, restreint aux
 * plaques CH ni interchangeables ni professionnelles (seules concernées par la contrainte —
 * l'INSERT qui vient d'échouer les satisfaisait forcément lui-même, sinon l'EXCLUDE ne se serait
 * pas déclenchée).
 *
 * Rescopée `tenant_id` EXPLICITEMENT en plus du RLS (RLS = filet, jamais le mécanisme). N'appeler
 * QUE dans la branche d'erreur, jamais sur le chemin nominal — c'est une relecture de secours, pas
 * une requête de validation.
 *
 * CAS DE COURSE (obligatoire à traiter) : la ligne en conflit au moment de l'INSERT peut avoir
 * disparu au moment de cette relecture (clôturée par une autre requête entre-temps) — rend alors
 * `null`, jamais une exception, jamais un identifiant inventé.
 */
export async function trouverVehiculeCollisionPlaque(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  plaque: { readonly valeur: string; readonly debutLe: string },
): Promise<DetailCollisionPlaqueVehicule | null> {
  const resultat = await tx.execute<LigneCollisionPlaqueBrute>(sql`
    select v.id      as vehicule_id,
           v.marque  as marque,
           v.modele  as modele,
           v.version as version,
           vp.valeur as valeur,
           vp.canton as canton,
           vp.du::text as du,
           vp.au::text as au
      from public.vehicule_plaque vp
      join public.vehicule v
        on v.tenant_id = vp.tenant_id and v.id = vp.vehicule_id
     where vp.tenant_id = ${ctx.tenantId}
       and vp.pays = 'CH'
       and not vp.interchangeable
       and not vp.professionnelle
       and public.normaliser_recherche(vp.valeur) = public.normaliser_recherche(${plaque.valeur})
       and daterange(vp.du, vp.au, '[)') && daterange(${plaque.debutLe}::date, null::date, '[)')
     limit 1
  `);
  const ligne = resultat.rows[0];
  if (!ligne) {
    return null;
  }
  return {
    vehiculeId: ligne.vehicule_id,
    marque: ligne.marque,
    modele: ligne.modele,
    version: ligne.version,
    plaque: ligne.valeur,
    canton: ligne.canton,
    debutLe: ligne.du,
    finLe: ligne.au,
  };
}

export async function lireDernierKilometrage(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehiculeKilometrage | null> {
  const lignes = await tx
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
  return lignes[0] ?? null;
}

export async function listerKilometrages(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly LigneVehiculeKilometrage[]> {
  return tx
    .select()
    .from(vehiculeKilometrage)
    .where(
      and(
        eq(vehiculeKilometrage.tenantId, ctx.tenantId),
        eq(vehiculeKilometrage.vehiculeId, vehiculeId),
      ),
    )
    .orderBy(desc(vehiculeKilometrage.releveLe));
}

export interface DetentionAvecClient {
  readonly detention: LigneVehiculeDetention;
  readonly client: LigneClient;
}

export async function lireDetentionCouranteAvecClient(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<DetentionAvecClient | null> {
  const lignes = await tx
    .select({ detention: vehiculeDetention, client })
    .from(vehiculeDetention)
    .innerJoin(
      client,
      and(
        eq(client.tenantId, vehiculeDetention.tenantId),
        eq(client.id, vehiculeDetention.clientId),
      ),
    )
    .where(
      and(
        eq(vehiculeDetention.tenantId, ctx.tenantId),
        eq(vehiculeDetention.vehiculeId, vehiculeId),
        isNull(vehiculeDetention.au),
      ),
    )
    .orderBy(desc(vehiculeDetention.du))
    .limit(1);
  return lignes[0] ?? null;
}

export async function listerDetentions(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly DetentionAvecClient[]> {
  return tx
    .select({ detention: vehiculeDetention, client })
    .from(vehiculeDetention)
    .innerJoin(
      client,
      and(
        eq(client.tenantId, vehiculeDetention.tenantId),
        eq(client.id, vehiculeDetention.clientId),
      ),
    )
    .where(
      and(
        eq(vehiculeDetention.tenantId, ctx.tenantId),
        eq(vehiculeDetention.vehiculeId, vehiculeId),
      ),
    )
    .orderBy(desc(vehiculeDetention.du));
}

/**
 * Expertise la plus récente porteuse d'une prochaine échéance connue — AMBIGUÏTÉ DE CONTRAT
 * SIGNALÉE : la table `vehicule_expertise` (migrations/0007) n'a pas de `PATCH`, et chaque ligne
 * exige un `resultat` (colonne `NOT NULL`). RM-28 décrit pourtant deux façons de fixer la
 * prochaine échéance (calcul automatique, ou saisie depuis une convocation cantonale reçue
 * séparément), sans qu'aucun endpoint dédié à la seule mise à jour de l'échéance n'existe au lot 1.
 * Interprétation retenue ici, la plus conservatrice : la ligne la PLUS RÉCEMMENT CRÉÉE
 * (`creeLe desc`) porteuse d'une `prochaineEcheance` non nulle fait foi — qu'elle vienne d'un
 * contrôle effectif ou d'une ligne de correction ultérieure. À confirmer avec expert-metier avant
 * l'écran de relance (RM-29).
 */
export async function lireExpertiseReference(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehiculeExpertise | null> {
  const lignes = await tx
    .select()
    .from(vehiculeExpertise)
    .where(
      and(
        eq(vehiculeExpertise.tenantId, ctx.tenantId),
        eq(vehiculeExpertise.vehiculeId, vehiculeId),
      ),
    )
    .orderBy(desc(vehiculeExpertise.creeLe))
    .limit(1);
  return lignes[0] ?? null;
}

export async function listerExpertises(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly LigneVehiculeExpertise[]> {
  return tx
    .select()
    .from(vehiculeExpertise)
    .where(
      and(
        eq(vehiculeExpertise.tenantId, ctx.tenantId),
        eq(vehiculeExpertise.vehiculeId, vehiculeId),
      ),
    )
    .orderBy(desc(vehiculeExpertise.dateExpertise));
}

export async function listerCampagnesOuvertes(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly LigneVehiculeCampagne[]> {
  return tx
    .select()
    .from(vehiculeCampagne)
    .where(
      and(
        eq(vehiculeCampagne.tenantId, ctx.tenantId),
        eq(vehiculeCampagne.vehiculeId, vehiculeId),
        eq(vehiculeCampagne.statut, 'ouverte'),
      ),
    )
    .orderBy(desc(vehiculeCampagne.creeLe));
}

export async function listerCampagnes(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly LigneVehiculeCampagne[]> {
  return tx
    .select()
    .from(vehiculeCampagne)
    .where(
      and(eq(vehiculeCampagne.tenantId, ctx.tenantId), eq(vehiculeCampagne.vehiculeId, vehiculeId)),
    )
    .orderBy(desc(vehiculeCampagne.creeLe));
}

export async function listerTravauxReportes(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly LigneVehiculeTravailReporte[]> {
  return tx
    .select()
    .from(vehiculeTravailReporte)
    .where(
      and(
        eq(vehiculeTravailReporte.tenantId, ctx.tenantId),
        eq(vehiculeTravailReporte.vehiculeId, vehiculeId),
      ),
    )
    .orderBy(desc(vehiculeTravailReporte.dateConstat));
}

export async function compterTravauxReportesOuverts(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<number> {
  const lignes = await tx
    .select({ id: vehiculeTravailReporte.id })
    .from(vehiculeTravailReporte)
    .where(
      and(
        eq(vehiculeTravailReporte.tenantId, ctx.tenantId),
        eq(vehiculeTravailReporte.vehiculeId, vehiculeId),
        eq(vehiculeTravailReporte.statut, 'ouvert'),
      ),
    );
  return lignes.length;
}

export async function listerTravauxReportesOuverts(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
  limite: number,
): Promise<readonly LigneVehiculeTravailReporte[]> {
  return tx
    .select()
    .from(vehiculeTravailReporte)
    .where(
      and(
        eq(vehiculeTravailReporte.tenantId, ctx.tenantId),
        eq(vehiculeTravailReporte.vehiculeId, vehiculeId),
        eq(vehiculeTravailReporte.statut, 'ouvert'),
      ),
    )
    .orderBy(desc(vehiculeTravailReporte.dateConstat))
    .limit(limite);
}

export async function listerOrOuverts(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<readonly LigneOrdreReparation[]> {
  return tx
    .select()
    .from(ordreReparation)
    .where(
      and(
        eq(ordreReparation.tenantId, ctx.tenantId),
        eq(ordreReparation.vehiculeId, vehiculeId),
        inArray(ordreReparation.statut, STATUTS_OR_OUVERTS),
      ),
    )
    .orderBy(desc(ordreReparation.creeLe));
}

export async function listerAlertesClient(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  clientId: string,
): Promise<readonly LigneClientNote[]> {
  return tx
    .select()
    .from(clientNote)
    .where(
      and(
        eq(clientNote.tenantId, ctx.tenantId),
        eq(clientNote.clientId, clientId),
        eq(clientNote.nature, 'alerte'),
      ),
    )
    .orderBy(desc(clientNote.creeLe));
}
