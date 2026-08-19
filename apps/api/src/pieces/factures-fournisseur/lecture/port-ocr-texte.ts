/**
 * Étape 3 (DERNIER recours) : OCR d'un PDF scanné (aucun texte exploitable en étape 2, voir
 * `orchestrateur-lecture.ts`). Même patron de PORT que `vehicules/ocr/client-moteur-ocr.ts`
 * (`ClientMoteurOcr`/`ClientMoteurOcrHttp`, module voisin lu en référence, jamais importé — cette
 * lecture reste un module DISTINCT, voir `config-ocr-facture.ts` pour pourquoi) : interface +
 * implémentation HTTP, testable sans réseau via une doublure qui implémente `PortOcrTexteFacture`.
 *
 * DÉCISION DE CONTRAT : le PORT envoie le PDF ORIGINAL tel quel (pas une image déjà rastérisée)
 * — la rasterisation pleine page exige `canvas` ou un binaire externe (poppler…), un choix
 * d'infrastructure qui appartient au conteneur OCR lui-même (même liberté que
 * `vehicules/ocr/moteur-ocr-conteneur/`, isolé du workspace pnpm principal, `sharp` + `tesseract.js`
 * en dépendances propres) — pas à ce module, qui ne doit pas décider à sa place COMMENT rastériser.
 *
 * ⚠️ AUCUN SERVICE N'IMPLÉMENTE ENCORE CE CONTRAT — voir `config-ocr-facture.ts`. Ce fichier fixe
 * PRÉCISÉMENT ce qu'un futur conteneur OCR généraliste devra exposer : `POST {url}/ocr-texte`,
 * corps = octets bruts du PDF (`Content-Type: application/pdf`), réponse JSON
 * `{ texte, confiance, dureeMs }`.
 */
import { Injectable } from '@nestjs/common';

import { lireConfigOcrTexteFacture } from './config-ocr-facture';

export interface ResultatOcrTexteFacture {
  readonly texte: string;
  /** 0-100, confiance moyenne rendue par le moteur — jamais interprétée comme une certitude
   *  (`origine: 'ocr'` reste toujours la moins fiable des trois, quelle que soit la valeur ici). */
  readonly confiance: number;
  readonly dureeMs: number;
}

export type CodeEchecOcrTexteFacture =
  'MOTEUR_INDISPONIBLE' | 'MOTEUR_NON_CONFIGURE' | 'ERREUR_INTERNE';

export class ErreurOcrTexteFacture extends Error {
  readonly code: CodeEchecOcrTexteFacture;
  constructor(code: CodeEchecOcrTexteFacture, message: string) {
    super(message);
    this.name = 'ErreurOcrTexteFacture';
    this.code = code;
  }
}

export const JETON_PORT_OCR_TEXTE_FACTURE = Symbol.for('DFA_PORT_OCR_TEXTE_FACTURE');

export interface PortOcrTexteFacture {
  reconnaitre(pdf: Buffer): Promise<ResultatOcrTexteFacture>;
}

@Injectable()
export class ClientOcrTexteFactureHttp implements PortOcrTexteFacture {
  async reconnaitre(pdf: Buffer): Promise<ResultatOcrTexteFacture> {
    const config = lireConfigOcrTexteFacture();
    if (!config.FACTURES_FOURNISSEUR_OCR_SERVICE_URL) {
      throw new ErreurOcrTexteFacture(
        'MOTEUR_NON_CONFIGURE',
        'FACTURES_FOURNISSEUR_OCR_SERVICE_URL non configurée : aucun service OCR généraliste ' +
          "n'est encore provisionné pour ce lot (voir config-ocr-facture.ts).",
      );
    }

    const controleur = new AbortController();
    const minuteur = setTimeout(
      () => controleur.abort(),
      config.FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS,
    );

    let reponse: Response;
    try {
      reponse = await fetch(`${config.FACTURES_FOURNISSEUR_OCR_SERVICE_URL}/ocr-texte`, {
        method: 'POST',
        body: new Uint8Array(pdf),
        headers: { 'Content-Type': 'application/pdf' },
        signal: controleur.signal,
      });
    } catch (cause) {
      throw new ErreurOcrTexteFacture(
        'MOTEUR_INDISPONIBLE',
        `Service OCR de repli injoignable : ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      clearTimeout(minuteur);
    }

    if (!reponse.ok) {
      throw new ErreurOcrTexteFacture(
        'ERREUR_INTERNE',
        `Service OCR de repli : réponse HTTP ${reponse.status}.`,
      );
    }

    return (await reponse.json()) as ResultatOcrTexteFacture;
  }
}
