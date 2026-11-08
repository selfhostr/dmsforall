/**
 * Prérequis d'un export fiduciaire — UNE seule source pour l'aperçu (`GET /exports-fiduciaires/
 * apercu`, qui les liste) et pour les `409`/`501` du déclenchement (qui les portent dans
 * `blocages[].donnees`, la convention interdisant au front d'afficher `detail`).
 *
 * Fonctions pures : aucun accès base.
 */

import type {
  CodeTvaManquant,
  CompteManquant,
  EcritureDesequilibree,
  PrerequisExport,
  TrouNumerotation,
  UsageMappingCompte,
} from '@dfa/shared';
import type { ElementBloquant } from '@dfa/shared';

import type { BesoinMappingManquant } from '../ecritures/comptes-resolus';
import {
  decrireLimitePaiement,
  structurerLimitePaiement,
  type LimiteEcriturePaiement,
} from '../ecritures/construction-ecriture-paiement';
import type { ErreurEcritureDesequilibree } from '../ecritures/erreur-desequilibre';
import type { TrouDetecte } from '../continuite/verification-continuite';

/** Plafond d'éléments par `blocages` (contrat §3.5 règle 2) — `donnees.total` porte le compte réel. */
export const MAX_BLOCAGES = 50;
/** Pièces citées par poste manquant. */
const MAX_REFERENCES = 10;

export interface DiagnosticExport {
  readonly trous: readonly TrouDetecte[];
  readonly manquants: readonly BesoinMappingManquant[];
  readonly desequilibres: readonly ErreurEcritureDesequilibree[];
  readonly limites: readonly LimiteEcriturePaiement[];
}

export const DIAGNOSTIC_VIDE: DiagnosticExport = {
  trous: [],
  manquants: [],
  desequilibres: [],
  limites: [],
};

export function regrouperManquants(manquants: readonly BesoinMappingManquant[]): {
  readonly comptes: readonly CompteManquant[];
  readonly codesTva: readonly CodeTvaManquant[];
} {
  const comptes = new Map<
    string,
    { usage: UsageMappingCompte; categorie: string; refs: string[] }
  >();
  const codes = new Map<string, { regimeTva: string; tauxPourmille: number; refs: string[] }>();
  for (const m of manquants) {
    if (m.type === 'compte') {
      const cle = `${m.usage}::${m.categorie}`;
      const e = comptes.get(cle) ?? { usage: m.usage, categorie: m.categorie, refs: [] };
      if (!e.refs.includes(m.documentNumero)) e.refs.push(m.documentNumero);
      comptes.set(cle, e);
    } else {
      const cle = `${m.regimeTva}::${String(m.tauxPourmille)}`;
      const e = codes.get(cle) ?? {
        regimeTva: m.regimeTva,
        tauxPourmille: m.tauxPourmille,
        refs: [],
      };
      if (!e.refs.includes(m.documentNumero)) e.refs.push(m.documentNumero);
      codes.set(cle, e);
    }
  }
  return {
    comptes: [...comptes.values()].map((e) => ({
      usage: e.usage,
      categorie: e.categorie,
      references: e.refs.slice(0, MAX_REFERENCES),
    })),
    codesTva: [...codes.values()].map((e) => ({
      regimeTva: e.regimeTva,
      tauxPourmille: e.tauxPourmille,
      references: e.refs.slice(0, MAX_REFERENCES),
    })),
  };
}

export function versPrerequis(d: DiagnosticExport): readonly PrerequisExport[] {
  const resultat: PrerequisExport[] = [];
  if (d.trous.length > 0) {
    const trous: TrouNumerotation[] = d.trous.map((t) => ({
      typeDocument: t.typeDocument,
      exercice: t.exercice,
      numeros: t.documents.map((x) => x.numero),
    }));
    resultat.push({ code: 'EXPORT_TROU_NUMEROTATION', trous });
  }
  if (d.manquants.length > 0) {
    const { comptes, codesTva } = regrouperManquants(d.manquants);
    resultat.push({ code: 'EXPORT_MAPPING_INCOMPLET', comptes, codesTva });
  }
  if (d.desequilibres.length > 0) {
    const ecritures: EcritureDesequilibree[] = d.desequilibres.map((e) => ({
      reference: e.reference,
      pieces: e.pieces,
      totalDebitCentimes: Number(e.totalDebitCentimes),
      totalCreditCentimes: Number(e.totalCreditCentimes),
    }));
    resultat.push({ code: 'EXPORT_ECRITURES_DESEQUILIBREES', ecritures });
  }
  if (d.limites.length > 0) {
    resultat.push({
      code: 'FONCTION_NON_DISPONIBLE',
      limites: d.limites.map(decrireLimitePaiement),
      details: d.limites.map(structurerLimitePaiement),
    });
  }
  return resultat;
}

/** `blocages` d'un `409` : un élément par poste/numéro/écriture fautif, `donnees` lisible par le front. */
export function blocagesTrous(trous: readonly TrouDetecte[]): readonly ElementBloquant[] {
  const elements = trous.flatMap((t) =>
    t.documents.map((d): ElementBloquant => ({
      type: 'document_vente',
      id: d.id,
      libelle: d.numero,
      donnees: { numero: d.numero, typeDocument: t.typeDocument, exercice: t.exercice },
    })),
  );
  return borner(elements);
}

export function blocagesMapping(
  manquants: readonly BesoinMappingManquant[],
): readonly ElementBloquant[] {
  const { comptes, codesTva } = regrouperManquants(manquants);
  const elements: ElementBloquant[] = [
    ...comptes.map((c): ElementBloquant => ({
      type: 'champ',
      id: `compte:${c.usage}:${c.categorie}`,
      libelle: `Compte manquant (${c.usage}/${c.categorie})`,
      donnees: {
        poste: 'compte',
        usage: c.usage,
        categorie: c.categorie,
        references: c.references,
      },
    })),
    ...codesTva.map((c): ElementBloquant => ({
      type: 'champ',
      id: `code_tva:${c.regimeTva}:${String(c.tauxPourmille)}`,
      libelle: `Code TVA manquant (${c.regimeTva}/${String(c.tauxPourmille)}‰)`,
      donnees: {
        poste: 'code_tva',
        regimeTva: c.regimeTva,
        tauxPourmille: c.tauxPourmille,
        references: c.references,
      },
    })),
  ];
  return borner(elements);
}

export function blocagesDesequilibres(
  desequilibres: readonly ErreurEcritureDesequilibree[],
): readonly ElementBloquant[] {
  return borner(
    desequilibres.map((e): ElementBloquant => ({
      type: e.documentId !== null ? 'document_vente' : 'champ',
      id: e.documentId ?? `paiement:${e.reference}`,
      libelle: e.reference,
      donnees: {
        reference: e.reference,
        pieces: e.pieces,
        totalDebitCentimes: Number(e.totalDebitCentimes),
        totalCreditCentimes: Number(e.totalCreditCentimes),
      },
    })),
  );
}

export function blocagesLimites(
  limites: readonly LimiteEcriturePaiement[],
): readonly ElementBloquant[] {
  return borner(
    limites.map((l): ElementBloquant => ({
      type: 'document_vente',
      id: l.documentId,
      libelle: decrireLimitePaiement(l),
      donnees: { paiementId: l.paiementId, documentNumero: l.documentNumero, limite: l.type },
    })),
  );
}

function borner(elements: readonly ElementBloquant[]): readonly ElementBloquant[] {
  const total = elements.length;
  return elements
    .slice(0, MAX_BLOCAGES)
    .map((e) => ({ ...e, donnees: { ...(e.donnees ?? {}), total } }));
}
