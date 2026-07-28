import type { PayeurLigneOr, TotauxPayeurOr } from '@dfa/shared';
import type { LigneLigneOr } from '../db/schema';

/**
 * `GET /ordres-reparation/{orId}` → `totauxParPayeur` (§8.3) : regroupement par payeur, TVA
 * calculée PAR LIGNE (déjà figée en base à la création — RM-65) puis agrégée (RM-107). Les lignes
 * `annulee`/`refusee` n'entrent dans AUCUN total : une ligne annulée n'a jamais existé pour le
 * client, une ligne refusée alimente les travaux reportés (RM-73), pas la facturation à venir.
 */
const STATUTS_EXCLUS_DES_TOTAUX: ReadonlySet<LigneLigneOr['statut']> = new Set(['annulee', 'refusee']);

export function calculerTotauxParPayeur(lignes: readonly LigneLigneOr[]): readonly TotauxPayeurOr[] {
  const parPayeur = new Map<PayeurLigneOr, LigneLigneOr[]>();
  for (const ligne of lignes) {
    if (STATUTS_EXCLUS_DES_TOTAUX.has(ligne.statut)) continue;
    const liste = parPayeur.get(ligne.payeur) ?? [];
    liste.push(ligne);
    parPayeur.set(ligne.payeur, liste);
  }

  const resultat: TotauxPayeurOr[] = [];
  for (const [payeur, lignesDuPayeur] of parPayeur) {
    const parTaux = new Map<number, { baseHtCentimes: number; montantCentimes: number }>();
    let totalHt = 0;
    let totalTva = 0;
    let totalTtc = 0;

    for (const ligne of lignesDuPayeur) {
      totalHt += ligne.montantHtCentimes;
      totalTva += ligne.montantTvaCentimes;
      totalTtc += ligne.montantTtcCentimes;

      const cumulTaux = parTaux.get(ligne.tauxTvaPourmille) ?? { baseHtCentimes: 0, montantCentimes: 0 };
      cumulTaux.baseHtCentimes += ligne.montantHtCentimes;
      cumulTaux.montantCentimes += ligne.montantTvaCentimes;
      parTaux.set(ligne.tauxTvaPourmille, cumulTaux);
    }

    resultat.push({
      payeur,
      montantHtCentimes: totalHt,
      montantTvaCentimes: totalTva,
      montantTtcCentimes: totalTtc,
      tva: [...parTaux.entries()]
        .sort(([a], [b]) => a - b)
        .map(([tauxPourmille, v]) => ({ tauxPourmille, ...v })),
    });
  }

  return resultat.sort((a, b) => a.payeur.localeCompare(b.payeur));
}
