import type { TFunction } from 'i18next';

import { formaterPourmille } from '@/lib/formats';

/** Nom lisible d'un poste de compte : l'usage (« Produits ») et sa catégorie quand elle précise. */
export function nomPosteCompte(t: TFunction, usage: string, categorie: string): string {
  // Libellé complet du garagiste quand le poste est connu (« Paiements QR-facture (compte
  // bancaire) ») ; sinon on retombe sur « usage (catégorie) », jamais sur une clé technique nue.
  const inconnu = '\u0000';
  const complet = t(`export:mapping.poste.${usage}.${categorie}`, { defaultValue: inconnu });
  if (complet !== inconnu) return complet;
  const usageLibelle = t(`export:mapping.usage.${usage}`, { defaultValue: usage });
  if (categorie === 'defaut') return usageLibelle;
  const precision = /^\d+$/.test(categorie)
    ? formaterPourmille(Number(categorie))
    : t(`export:mapping.categorie.${categorie}`, {
        defaultValue: categorie.replaceAll('_', ' '),
      });
  return `${usageLibelle} (${precision})`;
}

export function nomCodeTva(t: TFunction, regimeTva: string, tauxPourmille: number): string {
  const regime = t(`export:mapping.regime.${regimeTva}`, { defaultValue: regimeTva });
  return `${regime}, ${formaterPourmille(tauxPourmille)}`;
}
