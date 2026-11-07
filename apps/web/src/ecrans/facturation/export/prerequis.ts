import type {
  ElementBloquant,
  LimiteExport,
  PrerequisExport,
  UsageMappingCompte,
} from '@dfa/shared';

/** Codes d'erreur des `409`/`501` qui sont des prérequis ou des limites connues, pas des pannes. */
export const CODES_PREREQUIS = [
  'EXPORT_MAPPING_INCOMPLET',
  'EXPORT_TROU_NUMEROTATION',
  'EXPORT_ECRITURES_DESEQUILIBREES',
  'FONCTION_NON_DISPONIBLE',
] as const;
export type CodePrerequis = (typeof CODES_PREREQUIS)[number];

export function estCodePrerequis(code: string | undefined): code is CodePrerequis {
  return CODES_PREREQUIS.some((c) => c === code);
}

function texte(valeur: unknown): string | undefined {
  return typeof valeur === 'string' ? valeur : undefined;
}
function nombre(valeur: unknown): number | undefined {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : undefined;
}
function references(valeur: unknown): readonly string[] {
  return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Relit les `blocages[].donnees` d'un `409` sous la forme de l'aperçu (`PrerequisExport`) : un seul
 * rendu pour « ce qui empêche l'export » avant (aperçu) et après (refus). Un élément dont les
 * `donnees` ne portent pas ce qu'on attend est ignoré ; si plus rien ne reste, `undefined` et
 * l'appelant retombe sur le message générique du code.
 */
export function prerequisDepuisBlocages(
  code: CodePrerequis,
  blocages: readonly ElementBloquant[],
): PrerequisExport | undefined {
  const donnees = blocages.map((b) => b.donnees ?? {});

  if (code === 'EXPORT_MAPPING_INCOMPLET') {
    const comptes: Extract<PrerequisExport, { code: typeof code }>['comptes'][number][] = [];
    const codesTva: Extract<PrerequisExport, { code: typeof code }>['codesTva'][number][] = [];
    for (const d of donnees) {
      if (d.poste === 'compte' && texte(d.usage) && texte(d.categorie)) {
        comptes.push({
          usage: d.usage as UsageMappingCompte,
          categorie: String(d.categorie),
          references: references(d.references),
        });
      } else if (
        d.poste === 'code_tva' &&
        texte(d.regimeTva) &&
        nombre(d.tauxPourmille) !== undefined
      ) {
        codesTva.push({
          regimeTva: String(d.regimeTva),
          tauxPourmille: Number(d.tauxPourmille),
          references: references(d.references),
        });
      }
    }
    return comptes.length + codesTva.length > 0 ? { code, comptes, codesTva } : undefined;
  }

  if (code === 'EXPORT_TROU_NUMEROTATION') {
    const groupes = new Map<
      string,
      { typeDocument: 'facture' | 'avoir'; exercice: number; numeros: string[] }
    >();
    for (const d of donnees) {
      const numero = texte(d.numero);
      const exercice = nombre(d.exercice);
      if (!numero || exercice === undefined) continue;
      const typeDocument = d.typeDocument === 'avoir' ? 'avoir' : 'facture';
      const cle = `${typeDocument}:${String(exercice)}`;
      const groupe = groupes.get(cle) ?? { typeDocument, exercice, numeros: [] };
      groupe.numeros.push(numero);
      groupes.set(cle, groupe);
    }
    return groupes.size > 0 ? { code, trous: [...groupes.values()] } : undefined;
  }

  if (code === 'EXPORT_ECRITURES_DESEQUILIBREES') {
    const ecritures = donnees.flatMap((d) => {
      const reference = texte(d.reference);
      const debit = nombre(d.totalDebitCentimes);
      const credit = nombre(d.totalCreditCentimes);
      return reference && debit !== undefined && credit !== undefined
        ? [{ reference, totalDebitCentimes: debit, totalCreditCentimes: credit }]
        : [];
    });
    return ecritures.length > 0 ? { code, ecritures } : undefined;
  }

  const limites = blocages.map((b) => b.libelle).filter((l) => l.length > 0);
  // `details` reconstruit depuis les `blocages` d'un 409 (`donnees.limite` = type serveur en minuscules).
  const details: LimiteExport[] = blocages.flatMap((b) => {
    const limite = texte(b.donnees?.limite);
    const code =
      limite === 'compensation_non_supportee'
        ? 'COMPENSATION_NON_SUPPORTEE'
        : limite === 'taux_multiples_non_supporte'
          ? 'TAUX_MULTIPLES_NON_SUPPORTE'
          : undefined;
    return code ? [{ code, donnees: { paiementId: b.donnees?.paiementId, documentId: b.id } }] : [];
  });
  return limites.length > 0 ? { code, limites, details } : undefined;
}
