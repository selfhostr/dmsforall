import { z } from 'zod';

/**
 * Identité fiscale du garage (`GET|PATCH /parametres-entreprise`).
 *
 * N° d'identification des entreprises (IDE) suisse avec mention TVA : `CHE-123.456.789 TVA`
 * (`MWST` en allemand, `IVA` en italien). Le dernier chiffre est une clé de contrôle modulo 11
 * (pondération 5-4-3-2-7-6-5-4) : une faute de frappe est rejetée ici plutôt qu'imprimée sur une
 * facture.
 */

const MOTIF_IDE = /^CHE-(\d{3})\.(\d{3})\.(\d{3}) (TVA|MWST|IVA)$/;
const PONDERATIONS_IDE = [5, 4, 3, 2, 7, 6, 5, 4] as const;

/** `true` si la clé de contrôle (9e chiffre) de l'IDE est juste. */
export function cleIdeValide(chiffres: string): boolean {
  if (!/^\d{9}$/.test(chiffres)) return false;
  const somme = PONDERATIONS_IDE.reduce((s, p, i) => s + p * Number(chiffres[i]), 0);
  const reste = somme % 11;
  const cle = reste === 0 ? 0 : 11 - reste;
  return cle !== 10 && cle === Number(chiffres[8]);
}

export const schemaNumeroTva = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => MOTIF_IDE.test(v), {
    message: 'Format attendu : CHE-123.456.789 TVA (ou MWST / IVA).',
  })
  .refine(
    (v) => {
      const m = MOTIF_IDE.exec(v);
      return m ? cleIdeValide(`${m[1]}${m[2]}${m[3]}`) : true;
    },
    { message: 'Numéro IDE invalide : la clé de contrôle ne correspond pas.' },
  );

/** `null` efface le numéro (garage non assujetti à la TVA). */
export const schemaModificationParametresEntreprise = z.object({
  numeroTva: schemaNumeroTva.nullable().optional(),
});

export interface ReponseParametresEntreprise {
  readonly raisonSociale: string;
  /** `null` : garage non assujetti à la TVA, ou numéro pas encore saisi. */
  readonly numeroTva: string | null;
}

export type EntreeModificationParametresEntreprise = z.infer<
  typeof schemaModificationParametresEntreprise
>;
