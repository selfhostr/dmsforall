import { z } from 'zod';

import { schemaDateJour } from '../atelier/primitives';
import type { ReponseAvecAvertissements } from '../atelier/avertissement';
import {
  CIBLES_EXPORT,
  REGIMES_TVA,
  type CibleExport,
  type ModeGranulariteExport,
  type MoyenPaiement,
  type RegimeTva,
} from './enums';

/**
 * Contrat HTTP de l'export fiduciaire (au-delà de `schemaLancerExport`, `./export.ts`) :
 *  - réponse du déclenchement `POST /exports-fiduciaires` ;
 *  - aperçu de période `GET /exports-fiduciaires/apercu` ;
 *  - historique `GET /exports-fiduciaires` et fichier `GET /exports-fiduciaires/{id}/fichier` ;
 *  - mapping comptable `GET|PUT /exports-fiduciaires/mapping`.
 *
 * Montants en centimes (entiers JS, `Number.isSafeInteger`). Dates `aaaa-mm-jj` ou ISO 8601 UTC.
 */

/* ------------------------------------------------------------------ */
/* Réponse du déclenchement                                            */
/* ------------------------------------------------------------------ */

export interface LotExportProduit {
  readonly exportId: string;
  readonly cible: CibleExport;
  readonly nomFichier: string;
  readonly nbEcritures: number;
  readonly nbLignesCsv: number;
  /** Chaîne (bigint) — Σ débit en centimes. */
  readonly totalDebitCentimes: string;
  /** Chaîne (bigint) — Σ crédit en centimes, égale à `totalDebitCentimes`. */
  readonly totalCreditCentimes: string;
  readonly empreinteSha256: string;
  readonly contenuBase64: string;
  readonly avertissements: readonly string[];
}

export interface DocumentExporte {
  readonly id: string;
  readonly numero: string;
  readonly typeDocument: 'facture' | 'avoir';
}

export interface PaiementExporte {
  readonly id: string;
  readonly moyen: MoyenPaiement;
}

export interface ImputationExportee {
  readonly id: string;
  readonly paiementId: string;
  readonly documentId: string;
}

export interface ReponseExportComptable {
  readonly lots: readonly LotExportProduit[];
  readonly documentsExportes: readonly DocumentExporte[];
  readonly paiementsExportes: readonly PaiementExporte[];
  readonly imputationsExportees: readonly ImputationExportee[];
}

/** Corps `201`/`200` de `POST /exports-fiduciaires`. */
export type ExportComptableAvecAvertissements = ReponseAvecAvertissements<ReponseExportComptable>;

/* ------------------------------------------------------------------ */
/* Prérequis (aperçu ET blocages des 409)                              */
/* ------------------------------------------------------------------ */

/** Usage d'un compte du plan comptable du tenant (`usage_mapping_compte`, MD-86). */
export const USAGES_MAPPING_COMPTE = [
  'creances_clients',
  'produit',
  'tva_due',
  'acomptes_recus',
  'financier',
  'arrondi',
  'escompte',
  'perte',
  'ecart_reprise',
] as const;
export type UsageMappingCompte = (typeof USAGES_MAPPING_COMPTE)[number];

export interface CompteManquant {
  readonly usage: UsageMappingCompte;
  /** `defaut`, un type de ligne, un moyen de paiement ou un taux en pour mille selon `usage`. */
  readonly categorie: string;
  /** Pièces (numéro de document ou id de paiement) qui en ont besoin, 10 au plus. */
  readonly references: readonly string[];
}

export interface CodeTvaManquant {
  readonly regimeTva: string;
  readonly tauxPourmille: number;
  readonly references: readonly string[];
}

export interface TrouNumerotation {
  readonly typeDocument: 'facture' | 'avoir';
  readonly exercice: number;
  /** Numéros affichés émis, non exportés et absents du lot. */
  readonly numeros: readonly string[];
}

export interface EcritureDesequilibree {
  readonly reference: string;
  readonly totalDebitCentimes: number;
  readonly totalCreditCentimes: number;
}

/**
 * Un prérequis non satisfait. `code` reprend le code d'erreur du `409` que le déclenchement
 * renverrait ; les 409 portent les MÊMES éléments dans `blocages[].donnees` (voir
 * `blocagesDepuisPrerequis` côté API) pour que le front les affiche sans lire `detail`.
 */
export type PrerequisExport =
  | {
      readonly code: 'EXPORT_MAPPING_INCOMPLET';
      readonly comptes: readonly CompteManquant[];
      readonly codesTva: readonly CodeTvaManquant[];
    }
  | { readonly code: 'EXPORT_TROU_NUMEROTATION'; readonly trous: readonly TrouNumerotation[] }
  | {
      readonly code: 'EXPORT_ECRITURES_DESEQUILIBREES';
      readonly ecritures: readonly EcritureDesequilibree[];
    }
  | {
      /** Imputation `compensation`, escompte/perte multi-taux : non construits (501 au déclenchement). */
      readonly code: 'FONCTION_NON_DISPONIBLE';
      readonly limites: readonly string[];
    };

/* ------------------------------------------------------------------ */
/* Aperçu                                                              */
/* ------------------------------------------------------------------ */

export const schemaApercuExport = z
  .object({
    cible: z.enum(CIBLES_EXPORT).default('winbiz'),
    periodeDu: schemaDateJour,
    periodeAu: schemaDateJour,
  })
  .strict();
export type EntreeApercuExport = z.infer<typeof schemaApercuExport>;

export interface ApercuExport {
  readonly cible: CibleExport;
  readonly periodeDu: string;
  readonly periodeAu: string;
  readonly documents: {
    readonly nbFactures: number;
    readonly nbAvoirs: number;
    /** Émis, non exportés (= nbFactures + nbAvoirs). */
    readonly aExporter: number;
    /** Émis sur la période et déjà partis dans un lot antérieur. */
    readonly dejaExportes: number;
  };
  readonly encaissements: {
    /** Paiements dont le cash n'est jamais parti. */
    readonly aExporter: number;
    readonly dejaExportes: number;
    /** Imputations (lettrages) non exportées sur la période. */
    readonly imputationsAExporter: number;
  };
  /** Totaux des documents à exporter (avoirs en négatif, MD-46). */
  readonly totaux: {
    readonly htCentimes: number;
    readonly tvaCentimes: number;
    readonly ttcCentimes: number;
  };
  /** Numéros de la première et dernière facture / de l'avoir à exporter, `null` si aucun. */
  readonly plageNumeros: {
    readonly factures: PlageNumeros | null;
    readonly avoirs: PlageNumeros | null;
  };
  readonly prerequis: readonly PrerequisExport[];
  /** Il y a quelque chose à exporter. */
  readonly aQuelqueChoseAExporter: boolean;
  /** `aQuelqueChoseAExporter` ET aucun prérequis non satisfait. */
  readonly exportable: boolean;
}

export interface PlageNumeros {
  readonly premier: string;
  readonly dernier: string;
}

/* ------------------------------------------------------------------ */
/* Historique et fichier                                               */
/* ------------------------------------------------------------------ */

export const TRIS_EXPORTS_FIDUCIAIRES = ['genereLe:desc'] as const;

export const schemaListeExports = z
  .object({
    limite: z.coerce.number().int().min(1).max(200).default(50),
    curseur: z.string().max(512).optional(),
    cible: z.enum(CIBLES_EXPORT).optional(),
  })
  .strict();
export type ParametresListeExports = z.infer<typeof schemaListeExports>;

export interface ExportHistorique {
  readonly id: string;
  /** ISO 8601 UTC. */
  readonly genereLe: string;
  readonly periodeDu: string;
  readonly periodeAu: string;
  readonly cible: CibleExport;
  readonly granularite: ModeGranulariteExport;
  readonly statut: string;
  readonly nbEcritures: number;
  readonly totalDebitCentimes: number;
  readonly totalCreditCentimes: number;
  /** `null` pour un lot antérieur à la migration 0084. */
  readonly nbFactures: number | null;
  readonly nbAvoirs: number | null;
  readonly nbEncaissements: number | null;
  readonly totalHtCentimes: number | null;
  readonly totalTvaCentimes: number | null;
  readonly totalTtcCentimes: number | null;
  readonly plageNumeros: {
    readonly factures: PlageNumeros | null;
    readonly avoirs: PlageNumeros | null;
  };
  readonly genereParId: string | null;
  /** Prénom et nom de l'auteur, `null` si l'utilisateur n'existe plus. */
  readonly genereParNom: string | null;
  readonly empreinteSha256: string;
  readonly nomFichier: string | null;
  /** `false` pour un lot antérieur à la migration 0084 : le fichier n'a pas été conservé. */
  readonly fichierDisponible: boolean;
}

/* ------------------------------------------------------------------ */
/* Mapping comptable                                                   */
/* ------------------------------------------------------------------ */

const schemaNumeroCompte = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[0-9A-Za-z][0-9A-Za-z.\-_]*$/);

export const schemaConsulterMapping = z
  .object({ cible: z.enum(CIBLES_EXPORT).default('winbiz') })
  .strict();
export type EntreeConsulterMapping = z.infer<typeof schemaConsulterMapping>;

export interface PosteCompteMapping {
  readonly usage: UsageMappingCompte;
  readonly categorie: string;
  /** Libellé FR stable (support) — le front rend le poste depuis `usage` + `categorie`. */
  readonly libelle: string;
  /** Compte actif aujourd'hui, `null` si non réglé. */
  readonly compte: string | null;
  /** Date d'effet du compte actif. */
  readonly actifDu: string | null;
  /** Suggestion du plan comptable PME suisse, `null` si aucune n'est sûre. À valider avec la fiduciaire. */
  readonly compteParDefaut: string | null;
  /** `false` : poste réglé mais non nécessaire à un export standard. */
  readonly requis: boolean;
}

export interface PosteCodeTvaMapping {
  readonly regimeTva: RegimeTva;
  readonly tauxPourmille: number;
  readonly libelle: string;
  readonly codeExterne: string | null;
  readonly codeParDefaut: string | null;
  readonly requis: boolean;
}

export interface EtatMappingExport {
  readonly cible: CibleExport;
  /** Tous les postes `requis` sont réglés (comptes ET codes TVA de la cible). */
  readonly complet: boolean;
  readonly nbPostesManquants: number;
  readonly comptes: readonly PosteCompteMapping[];
  readonly codesTva: readonly PosteCodeTvaMapping[];
}

export const schemaMettreAJourMapping = z
  .object({
    cible: z.enum(CIBLES_EXPORT),
    comptes: z
      .array(
        z
          .object({
            usage: z.enum(USAGES_MAPPING_COMPTE),
            categorie: z.string().trim().min(1).max(64),
            compte: schemaNumeroCompte,
            /** Date d'effet. Défaut : `1970-01-01` pour un poste neuf (valable pour les périodes
             *  passées à exporter), aujourd'hui pour le changement d'un compte déjà réglé. */
            actifDu: schemaDateJour.optional(),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    codesTva: z
      .array(
        z
          .object({
            regimeTva: z.enum(REGIMES_TVA),
            tauxPourmille: z.number().int().min(0).max(1000),
            codeExterne: z.string().trim().min(1).max(64),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
  .refine((v) => v.comptes.length + v.codesTva.length > 0, {
    message: 'Au moins un compte ou un code TVA à régler.',
  });
export type EntreeMettreAJourMapping = z.infer<typeof schemaMettreAJourMapping>;
