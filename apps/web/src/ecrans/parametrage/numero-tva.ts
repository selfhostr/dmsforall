import { cleIdeValide, schemaNumeroTva } from '@dfa/shared';

export type ResultatNumeroTva =
  | { readonly ok: true; readonly valeur: string | null }
  | { readonly ok: false; readonly raison: 'format' | 'cle' };

const MOTIF_FORME = /^CHE-(\d{3})\.(\d{3})\.(\d{3}) (TVA|MWST|IVA)$/;

/**
 * Validation locale du n° TVA avant l'appel API : même règle que le contrat partagé
 * (`schemaNumeroTva`), mais la raison est rendue sous forme de code pour que l'écran affiche
 * un message traduit. Champ vide = `null` (garage non assujetti ou numéro pas encore connu).
 */
export function validerNumeroTva(saisie: string): ResultatNumeroTva {
  const nettoye = saisie.trim().toUpperCase();
  if (nettoye === '') return { ok: true, valeur: null };
  const forme = MOTIF_FORME.exec(nettoye);
  if (!forme) return { ok: false, raison: 'format' };
  if (!cleIdeValide(`${forme[1]}${forme[2]}${forme[3]}`)) return { ok: false, raison: 'cle' };
  const resultat = schemaNumeroTva.safeParse(nettoye);
  return resultat.success ? { ok: true, valeur: resultat.data } : { ok: false, raison: 'format' };
}
