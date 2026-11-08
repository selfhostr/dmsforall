import {
  schemaMettreAJourMapping,
  type CibleExport,
  type EntreeMettreAJourMapping,
  type EtatMappingExport,
  type PosteCodeTvaMapping,
  type PosteCompteMapping,
} from '@dfa/shared';

/**
 * Suggestions : celles de l'API seule (elle connaît les codes de chaque logiciel). Aucun repli
 * côté écran. Les codes TVA WinBIZ des taux 2.6 % et 3.8 % ne sont pas proposés tant qu'une
 * fiduciaire ne les a pas confirmés (comme le compte d'arrondi 3809 et le code N81).
 */
export function compteSuggere(_cible: CibleExport, c: PosteCompteMapping): string | null {
  return c.compteParDefaut ?? null;
}

export function codeTvaSuggere(_cible: CibleExport, c: PosteCodeTvaMapping): string | null {
  return c.codeParDefaut ?? null;
}

/** Brouillon de saisie : clé de poste -> texte saisi. Jamais perdu tant que la boîte est ouverte. */
export type BrouillonMapping = Readonly<Record<string, string>>;

export const cleCompte = (usage: string, categorie: string) => `compte:${usage}:${categorie}`;
export const cleCodeTva = (regimeTva: string, tauxPourmille: number) =>
  `tva:${regimeTva}:${String(tauxPourmille)}`;

/** Valeurs déjà enregistrées par le serveur : point de départ du brouillon. */
export function brouillonInitial(etat: EtatMappingExport): BrouillonMapping {
  const brouillon: Record<string, string> = {};
  for (const c of etat.comptes) brouillon[cleCompte(c.usage, c.categorie)] = c.compte ?? '';
  for (const c of etat.codesTva) {
    brouillon[cleCodeTva(c.regimeTva, c.tauxPourmille)] = c.codeExterne ?? '';
  }
  return brouillon;
}

/**
 * « Utiliser les valeurs proposées » : remplit les postes VIDES avec la suggestion du plan
 * comptable PME. Ne touche jamais à ce que l'utilisateur a saisi ou à un compte déjà réglé.
 */
export function appliquerValeursProposees(
  etat: EtatMappingExport,
  brouillon: BrouillonMapping,
): BrouillonMapping {
  const suite: Record<string, string> = { ...brouillon };
  for (const c of etat.comptes) {
    const cle = cleCompte(c.usage, c.categorie);
    const propose = compteSuggere(etat.cible, c);
    if ((suite[cle] ?? '').trim() === '' && propose) suite[cle] = propose;
  }
  for (const c of etat.codesTva) {
    const cle = cleCodeTva(c.regimeTva, c.tauxPourmille);
    const propose = codeTvaSuggere(etat.cible, c);
    if ((suite[cle] ?? '').trim() === '' && propose) suite[cle] = propose;
  }
  return suite;
}

/** Combien de postes ont une suggestion et n'ont encore rien. */
export function nbValeursProposables(etat: EtatMappingExport, brouillon: BrouillonMapping): number {
  return (
    etat.comptes.filter(
      (c) =>
        compteSuggere(etat.cible, c) &&
        (brouillon[cleCompte(c.usage, c.categorie)] ?? '').trim() === '',
    ).length +
    etat.codesTva.filter(
      (c) =>
        codeTvaSuggere(etat.cible, c) &&
        (brouillon[cleCodeTva(c.regimeTva, c.tauxPourmille)] ?? '').trim() === '',
    ).length
  );
}

export type ErreursMapping = Readonly<Record<string, true>>;

export type ResultatConstruction =
  | { readonly ok: true; readonly entree: EntreeMettreAJourMapping }
  | { readonly ok: false; readonly erreurs: ErreursMapping; readonly rien: boolean };

/**
 * Ne propose à l'enregistrement que ce qui a changé par rapport au serveur ; valide avec le
 * schéma PARTAGÉ avec l'API (`schemaMettreAJourMapping`) et rend les postes fautifs.
 */
export function construireMiseAJour(
  cible: CibleExport,
  etat: EtatMappingExport,
  brouillon: BrouillonMapping,
): ResultatConstruction {
  const comptes = etat.comptes.flatMap((c) => {
    const saisi = (brouillon[cleCompte(c.usage, c.categorie)] ?? '').trim();
    return saisi !== '' && saisi !== c.compte
      ? [{ usage: c.usage, categorie: c.categorie, compte: saisi }]
      : [];
  });
  const codesTva = etat.codesTva.flatMap((c) => {
    const saisi = (brouillon[cleCodeTva(c.regimeTva, c.tauxPourmille)] ?? '').trim();
    return saisi !== '' && saisi !== c.codeExterne
      ? [{ regimeTva: c.regimeTva, tauxPourmille: c.tauxPourmille, codeExterne: saisi }]
      : [];
  });
  if (comptes.length + codesTva.length === 0) return { ok: false, erreurs: {}, rien: true };

  const analyse = schemaMettreAJourMapping.safeParse({ cible, comptes, codesTva });
  if (analyse.success) return { ok: true, entree: analyse.data };

  const erreurs: Record<string, true> = {};
  for (const probleme of analyse.error.issues) {
    const [liste, index] = probleme.path;
    if (liste === 'comptes' && typeof index === 'number') {
      const c = comptes[index];
      if (c) erreurs[cleCompte(c.usage, c.categorie)] = true;
    } else if (liste === 'codesTva' && typeof index === 'number') {
      const c = codesTva[index];
      if (c) erreurs[cleCodeTva(c.regimeTva, c.tauxPourmille)] = true;
    }
  }
  return { ok: false, erreurs, rien: false };
}
