/**
 * Client HTTP interne vers le conteneur OCR dédié (`moteur-ocr-conteneur/`) — réseau Docker
 * interne, `fetch` global (Node 22, aucune dépendance HTTP supplémentaire). L'image reçue par le
 * contrôleur (`vehicule-ocr.controller.ts`) transite en mémoire jusqu'ici (`Buffer`), jamais sur
 * disque — voir la note de non-persistance en tête de `service-vehicule-ocr.ts`.
 */
import { Inject, Injectable } from '@nestjs/common';

import { JETON_CONFIG } from '../../config/config.jetons';
import type { ConfigOcrPermis } from './config-ocr';

export const CHAMPS_OCR_PERMIS = [
  'plaque',
  'vin',
  'codeTypeCh',
  'premiereMiseEnCirculationLe',
  'detenteurNom',
  'detenteurAdresse',
] as const;
export type ChampOcrPermis = (typeof CHAMPS_OCR_PERMIS)[number];

export interface ChampBrutOcr {
  readonly texte: string;
  readonly confiance: number;
}

export interface ReponseBruteMoteurOcr {
  readonly champs: Readonly<Record<ChampOcrPermis, ChampBrutOcr | null>>;
  readonly avertissements: readonly string[];
  readonly dureeMs: number;
}

export type CodeEchecMoteurOcr =
  'IMAGE_INVALIDE' | 'FORMAT_NON_SUPPORTE' | 'MOTEUR_INDISPONIBLE' | 'ERREUR_INTERNE';

export class ErreurMoteurOcr extends Error {
  readonly code: CodeEchecMoteurOcr;

  constructor(code: CodeEchecMoteurOcr, message: string) {
    super(message);
    this.name = 'ErreurMoteurOcr';
    this.code = code;
  }
}

export const JETON_CLIENT_MOTEUR_OCR = Symbol.for('DFA_CLIENT_MOTEUR_OCR');

/** Interface publique — testable sans réseau via une doublure (voir `service-vehicule-ocr.spec.ts`),
 *  même patron que `ClientRedisPublieurTempsReel` (`temps-reel/service-evenements-temps-reel.ts`). */
export interface ClientMoteurOcr {
  scanner(image: Buffer): Promise<ReponseBruteMoteurOcr>;
}

@Injectable()
export class ClientMoteurOcrHttp implements ClientMoteurOcr {
  constructor(@Inject(JETON_CONFIG) private readonly config: ConfigOcrPermis) {}

  async scanner(image: Buffer): Promise<ReponseBruteMoteurOcr> {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), this.config.OCR_SERVICE_TIMEOUT_MS);

    let reponse: Response;
    try {
      reponse = await fetch(`${this.config.OCR_SERVICE_URL}/scan-permis`, {
        method: 'POST',
        // `Uint8Array` : `Buffer` ne traverse pas toujours `fetch` tel quel selon le runtime — un
        // Buffer EST déjà un Uint8Array, cette conversion est gratuite (pas de copie).
        body: new Uint8Array(image),
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: controleur.signal,
      });
    } catch (cause) {
      throw new ErreurMoteurOcr(
        'MOTEUR_INDISPONIBLE',
        `Service OCR injoignable : ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      clearTimeout(minuteur);
    }

    if (reponse.status === 422) {
      const corps = (await reponse.json().catch(() => ({}))) as { detail?: string };
      throw new ErreurMoteurOcr(
        'FORMAT_NON_SUPPORTE',
        corps.detail ?? 'Format d’image non supporté par le moteur OCR.',
      );
    }
    if (reponse.status === 503) {
      throw new ErreurMoteurOcr('MOTEUR_INDISPONIBLE', 'Service OCR saturé, réessayez.');
    }
    if (!reponse.ok) {
      throw new ErreurMoteurOcr('ERREUR_INTERNE', `Service OCR : réponse HTTP ${reponse.status}.`);
    }

    return (await reponse.json()) as ReponseBruteMoteurOcr;
  }
}
