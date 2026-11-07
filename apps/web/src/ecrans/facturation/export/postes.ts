import type { TFunction } from 'i18next';

import { formaterPourmille } from '@/lib/formats';

/** Nom lisible d'un poste de compte : l'usage (« Produits ») et sa catégorie quand elle précise. */
export function nomPosteCompte(t: TFunction, usage: string, categorie: string): string {
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
