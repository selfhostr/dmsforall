import { sql } from 'drizzle-orm';
import type { CandidatDoublonClient, CritereDoublonClient } from '@dfa/shared';
import type { TransactionDfa } from '../db';

/**
 * Détection de doublons probables (RM-05, CT-01) : critères EXACTS après normalisation, jamais
 * de similarité floue (`pg_trgm %`). « Sois conservateur » (consigne de tâche) se traduit ici par
 * une égalité stricte sur chaque critère plutôt qu'un rapprochement approximatif — la fusion
 * étant irréversible (RM-06, lot 2), un faux positif coûte plus cher qu'un faux négatif.
 *
 * Quatre critères indépendants (RM-05) : (nom normalisé + NPA de l'adresse principale active),
 * (e-mail, insensible à la casse), (téléphone E.164), (IDE). Un même client peut matcher
 * plusieurs critères ; on ne garde alors que son meilleur score.
 */
export interface CriteresDetectionDoublon {
  /** `raisonSociale`, ou `"nom prenom"` pour un particulier — normalisé par `normaliser_recherche()` côté base. */
  readonly nomComplet?: string;
  /** Toujours utilisé CONJOINTEMENT à `nomComplet` (critère `nom_npa`, jamais seul). */
  readonly npa?: string;
  readonly email?: string;
  readonly telephoneE164?: string;
  readonly ide?: string;
  /** Exclut la fiche en cours d'édition (`GET /doublons-clients?exclureClientId=`). */
  readonly exclureClientId?: string;
}

/** Score fixe par critère — décroissant avec la fiabilité du rapprochement. */
const SCORE_PAR_CRITERE: Readonly<Record<CritereDoublonClient, number>> = {
  ide: 1,
  email: 0.9,
  telephone: 0.8,
  nom_npa: 0.6,
};

/** Nombre de candidats maximum PAR CRITÈRE — la liste globale reste donc bornée à 20. */
const LIMITE_PAR_CRITERE = 5;

type LigneCandidatBrute = {
  readonly client_id: string;
  readonly numero: string;
  readonly nom: string;
  readonly npa: string | null;
};

async function chercher(
  tx: TransactionDfa,
  requete: ReturnType<typeof sql>,
): Promise<readonly LigneCandidatBrute[]> {
  const resultat = await tx.execute<LigneCandidatBrute>(requete);
  return resultat.rows;
}

export async function detecterDoublons(
  tx: TransactionDfa,
  tenantId: string,
  criteres: CriteresDetectionDoublon,
): Promise<readonly CandidatDoublonClient[]> {
  const exclure = criteres.exclureClientId ?? null;
  const parClientId = new Map<string, CandidatDoublonClient>();

  const ajouter = (lignes: readonly LigneCandidatBrute[], critere: CritereDoublonClient): void => {
    const score = SCORE_PAR_CRITERE[critere];
    for (const ligne of lignes) {
      const existant = parClientId.get(ligne.client_id);
      if (existant && existant.score >= score) continue;
      parClientId.set(ligne.client_id, {
        clientId: ligne.client_id,
        numeroClient: ligne.numero,
        nom: ligne.nom,
        npa: ligne.npa,
        critere,
        score,
      });
    }
  };

  if (criteres.nomComplet && criteres.npa) {
    const lignes = await chercher(
      tx,
      sql`
        select c.id as client_id, c.numero as numero,
               coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, '')) as nom,
               a.npa as npa
          from public.client c
          join public.client_adresse a
            on a.tenant_id = c.tenant_id and a.client_id = c.id and a.type = 'principale' and a.actif
         where c.tenant_id = ${tenantId}
           and public.normaliser_recherche(coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, '')))
               = public.normaliser_recherche(${criteres.nomComplet})
           and a.npa = ${criteres.npa}
           and (${exclure}::uuid is null or c.id <> ${exclure}::uuid)
         limit ${LIMITE_PAR_CRITERE}
      `,
    );
    ajouter(lignes, 'nom_npa');
  }

  if (criteres.email) {
    const lignes = await chercher(
      tx,
      sql`
        select c.id as client_id, c.numero as numero,
               coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, '')) as nom,
               null::text as npa
          from public.client c
         where c.tenant_id = ${tenantId}
           and c.email is not null
           and lower(c.email) = lower(${criteres.email})
           and (${exclure}::uuid is null or c.id <> ${exclure}::uuid)
         limit ${LIMITE_PAR_CRITERE}
      `,
    );
    ajouter(lignes, 'email');
  }

  if (criteres.telephoneE164) {
    const lignes = await chercher(
      tx,
      sql`
        select c.id as client_id, c.numero as numero,
               coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, '')) as nom,
               null::text as npa
          from public.client c
         where c.tenant_id = ${tenantId}
           and c.telephone_e164 = ${criteres.telephoneE164}
           and (${exclure}::uuid is null or c.id <> ${exclure}::uuid)
         limit ${LIMITE_PAR_CRITERE}
      `,
    );
    ajouter(lignes, 'telephone');
  }

  if (criteres.ide) {
    const lignes = await chercher(
      tx,
      sql`
        select c.id as client_id, c.numero as numero,
               coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, '')) as nom,
               null::text as npa
          from public.client c
         where c.tenant_id = ${tenantId}
           and c.ide = ${criteres.ide}
           and (${exclure}::uuid is null or c.id <> ${exclure}::uuid)
         limit ${LIMITE_PAR_CRITERE}
      `,
    );
    ajouter(lignes, 'ide');
  }

  return [...parClientId.values()].sort((a, b) => b.score - a.score);
}
