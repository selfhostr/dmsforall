/**
 * Chaîne de lecture complète — QR → texte du PDF → OCR en dernier recours (§ « La chaîne de
 * lecture » de la tâche : « ne te jette pas sur l'OCR, il est le dernier recours, pas le premier
 * réflexe »). Assemble `DonneesFactureExtraites` à partir des trois étapes, PRIORITÉ AU PLUS
 * CERTAIN : un champ d'en-tête déjà rempli par le QR n'est JAMAIS écrasé par une valeur ultérieure
 * moins fiable — voir `fusionnerEnTetes` ci-dessous.
 *
 * Aucun accès base, aucun tenant : ce fichier ne fait QUE lire le fichier déposé et produire une
 * structure de données. Le rapprochement (qui décide de l'argent) vit ailleurs
 * (`service-rapprochement.ts`), délibérément découplé — voir `types.ts`.
 */
import { Inject, Injectable } from '@nestjs/common';

import { decoderQrFacturePdf } from './decodeur-qr-facture';
import { extraireLignesFacture } from './extraction-lignes-facture';
import { extraireTextePdf } from './lecteur-pdf';
import {
  ErreurOcrTexteFacture,
  JETON_PORT_OCR_TEXTE_FACTURE,
  type PortOcrTexteFacture,
} from './port-ocr-texte';
import type { DonneesFactureExtraites, EnTeteFactureExtrait, LigneFactureExtraite } from './types';

/** Fusionne deux en-têtes CHAMP PAR CHAMP : `base` gagne toujours quand il a déjà une valeur —
 *  c'est ce qui garantit qu'une donnée QR (certaine) ne peut jamais être écrasée par une donnée
 *  de texte PDF ou d'OCR (moins certaines) trouvée pour le même champ dans une étape suivante. */
function fusionnerEnTetes(
  base: EnTeteFactureExtrait,
  complement: EnTeteFactureExtrait,
): EnTeteFactureExtrait {
  const resultat: { -readonly [K in keyof EnTeteFactureExtrait]?: EnTeteFactureExtrait[K] } = {
    ...base,
  };
  for (const cle of Object.keys(complement) as (keyof EnTeteFactureExtrait)[]) {
    if (resultat[cle] === undefined) {
      // `as never` : TS ne peut pas prouver que `complement[cle]` correspond au type précis de
      // `resultat[cle]` à travers une clé générique — la garde `undefined` ci-dessus suffit à la
      // correction réelle (chaque champ de `EnTeteFactureExtrait` a la même forme `ChampExtrait<T>`).
      resultat[cle] = complement[cle] as never;
    }
  }
  return resultat;
}

export const JETON_ORCHESTRATEUR_LECTURE_FACTURE = Symbol.for('DFA_ORCHESTRATEUR_LECTURE_FACTURE');

export interface OrchestrateurLectureFacture {
  lire(pdf: Buffer): Promise<DonneesFactureExtraites>;
}

@Injectable()
export class ServiceOrchestrateurLectureFacture implements OrchestrateurLectureFacture {
  constructor(@Inject(JETON_PORT_OCR_TEXTE_FACTURE) private readonly ocr: PortOcrTexteFacture) {}

  async lire(pdf: Buffer): Promise<DonneesFactureExtraites> {
    const diagnostics: string[] = [];
    let enTete: EnTeteFactureExtrait = {};
    let lignes: readonly LigneFactureExtraite[] = [];
    let texteIntegral: string | null = null;

    /* Étape 1 — QR-facture : lecture exacte, jamais de reconnaissance de caractères. */
    const resultatQr = await decoderQrFacturePdf(pdf);
    diagnostics.push(...resultatQr.diagnostics);
    if (resultatQr.enTete) enTete = fusionnerEnTetes(enTete, resultatQr.enTete);

    /* Étape 2 — texte déjà présent dans le PDF : cas MAJORITAIRE, aucune reconnaissance non plus. */
    const texte = await extraireTextePdf(pdf);
    if (texte) {
      texteIntegral = texte;
      lignes = extraireLignesFacture(texte, 'texte_pdf');
      if (lignes.length === 0) {
        diagnostics.push(
          'texte_pdf: texte présent mais aucune ligne reconnue par l’heuristique de tableau ' +
            '(à calibrer contre de vraies factures, voir le rapport de livraison).',
        );
      }
    } else {
      diagnostics.push('texte_pdf: aucun texte extractible — PDF probablement scanné (image).');

      /* Étape 3 — OCR, DERNIER recours, uniquement quand le PDF ne porte aucun texte du tout. */
      try {
        const resultatOcr = await this.ocr.reconnaitre(pdf);
        texteIntegral = resultatOcr.texte;
        lignes = extraireLignesFacture(resultatOcr.texte, 'ocr');
        diagnostics.push(
          `ocr: lecture effectuée (confiance moyenne ${resultatOcr.confiance.toFixed(0)}/100) — ` +
            'aucune valeur issue de l’OCR ne doit être traitée comme certaine.',
        );
      } catch (cause) {
        const code = cause instanceof ErreurOcrTexteFacture ? cause.code : 'ERREUR_INTERNE';
        diagnostics.push(`ocr: repli indisponible (${code}) — aucune ligne obtenue par ce moyen.`);
      }
    }

    return { enTete, lignes, diagnostics, texteIntegral };
  }
}
