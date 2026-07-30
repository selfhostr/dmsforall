import type { PayeurLigneOr, TotauxPayeurOr } from '@dfa/shared';
import type { LigneLigneOr } from '../db/schema';

/**
 * `GET /ordres-reparation/{orId}` → `totauxParPayeur` (§8.3) : regroupement par
 * `(payeur, payeurClientId)` (`MD-62`), TVA calculée PAR LIGNE (déjà figée en base à la création —
 * RM-65) puis agrégée (RM-107). Les lignes `annulee`/`refusee` n'entrent dans AUCUN total : une
 * ligne annulée n'a jamais existé pour le client, une ligne refusée alimente les travaux reportés
 * (RM-73), pas la facturation à venir.
 *
 * `ligne_or.payeur_client_id` existe désormais en base (migration `0017`) : deux lignes
 * `payeur = 'assurance'` avec deux `payeurClientId` distincts produisent DEUX groupes — c'était le
 * bug historique (deux assureurs fusionnés en un seul groupe, donc une facture envoyée au mauvais
 * assureur), corrigé ici. Voir `totaux-payeur.spec.ts` pour la preuve rouge → verte.
 *
 * `payeur = 'garage'` (`RM-70`, `RF-92`) n'apparaît JAMAIS comme groupe séparé : ses lignes
 * rejoignent automatiquement le groupe `'client'` — valorisées à 0.00 en amont (RM-70), leur
 * contribution aux totaux est nulle, mais leur CLÉ de regroupement doit être celle du client, pas
 * `'garage'`, pour que `TotauxPayeurOr.payeur` ne rende jamais `'garage'` (contrat, voir
 * `packages/shared/.../ordre-reparation.ts::TotauxPayeurOr.payeur`).
 */
const STATUTS_EXCLUS_DES_TOTAUX: ReadonlySet<LigneLigneOr['statut']> = new Set(['annulee', 'refusee']);

/** Destinataire d'un groupe payeur — même forme que `TotauxPayeurOr['destinataire']` sans le
 *  `null`, pour que l'appelant n'ait pas à re-null-check ce qu'il vient de résoudre lui-même. */
export interface DestinataireGroupePayeur {
  readonly clientId: string;
  readonly nomAffiche: string;
}

/**
 * Résolveur SYNCHRONE d'un destinataire tiers par `payeurClientId`. Le fetch base (batch, un seul
 * aller-retour sur la table `client` pour tous les `payeurClientId` distincts de l'OR) reste à la
 * charge de l'appelant (`service-or.ts::assemblerDocument`) — cette fonction reste pure et
 * testable sans base, même doctrine que `etat-affiche.ts`.
 */
export type ResolveurDestinataireTiers = (payeurClientId: string) => DestinataireGroupePayeur | undefined;

interface CleGroupe {
  readonly payeur: PayeurLigneOr;
  readonly payeurClientId: string | null;
}

function cleTexte(g: CleGroupe): string {
  return `${g.payeur}:${g.payeurClientId ?? ''}`;
}

/** `RM-70`/`RF-92` : une ligne `payeur = 'garage'` n'a jamais de groupe séparé, elle rejoint la
 *  clé `('client', null)`. Pour tout autre payeur, la clé est la paire telle quelle (`MD-62`). */
function cleEffective(ligne: LigneLigneOr): CleGroupe {
  if (ligne.payeur === 'garage') return { payeur: 'client', payeurClientId: null };
  return { payeur: ligne.payeur, payeurClientId: ligne.payeurClientId };
}

export function calculerTotauxParPayeur(
  lignes: readonly LigneLigneOr[],
  /** Destinataire du groupe `'client'` — l'OR lui-même n'a pas de nom, c'est son client qui en
   *  tient lieu (contrat : `null` UNIQUEMENT pour `'garage'`, qui ne peut plus apparaître ici).
   *  Optionnel pour ne pas casser les appelants qui n'ont pas encore ce contexte sous la main
   *  (aucun groupe `'client'` ne peut alors résoudre son destinataire, `null` par repli). */
  destinataireClientOr?: DestinataireGroupePayeur,
  resoudreDestinataireTiers: ResolveurDestinataireTiers = () => undefined,
): readonly TotauxPayeurOr[] {
  const parGroupe = new Map<string, { cle: CleGroupe; lignes: LigneLigneOr[] }>();
  for (const ligne of lignes) {
    if (STATUTS_EXCLUS_DES_TOTAUX.has(ligne.statut)) continue;
    const cle = cleEffective(ligne);
    const texte = cleTexte(cle);
    const entree = parGroupe.get(texte) ?? { cle, lignes: [] };
    entree.lignes.push(ligne);
    parGroupe.set(texte, entree);
  }

  const resultat: TotauxPayeurOr[] = [];
  for (const { cle, lignes: lignesDuGroupe } of parGroupe.values()) {
    const parTaux = new Map<number, { baseHtCentimes: number; montantCentimes: number }>();
    let totalHt = 0;
    let totalTva = 0;
    let totalTtc = 0;

    for (const ligne of lignesDuGroupe) {
      totalHt += ligne.montantHtCentimes;
      totalTva += ligne.montantTvaCentimes;
      totalTtc += ligne.montantTtcCentimes;

      const cumulTaux = parTaux.get(ligne.tauxTvaPourmille) ?? { baseHtCentimes: 0, montantCentimes: 0 };
      cumulTaux.baseHtCentimes += ligne.montantHtCentimes;
      cumulTaux.montantCentimes += ligne.montantTvaCentimes;
      parTaux.set(ligne.tauxTvaPourmille, cumulTaux);
    }

    const destinataire: DestinataireGroupePayeur | null =
      cle.payeur === 'client' ? (destinataireClientOr ?? null) : cle.payeurClientId ? (resoudreDestinataireTiers(cle.payeurClientId) ?? null) : null;

    resultat.push({
      payeur: cle.payeur,
      payeurClientId: cle.payeurClientId,
      destinataire,
      montantHtCentimes: totalHt,
      montantTvaCentimes: totalTva,
      montantTtcCentimes: totalTtc,
      tva: [...parTaux.entries()]
        .sort(([a], [b]) => a - b)
        .map(([tauxPourmille, v]) => ({ tauxPourmille, ...v })),
    });
  }

  return resultat.sort((a, b) => {
    if (a.payeur !== b.payeur) return a.payeur.localeCompare(b.payeur);
    return (a.payeurClientId ?? '').localeCompare(b.payeurClientId ?? '');
  });
}
