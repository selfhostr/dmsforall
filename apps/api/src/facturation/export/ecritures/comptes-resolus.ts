/**
 * Vue résolue du plan comptable du tenant (`mapping_compte`, `mapping_code_tva` — MD-86) pour UNE
 * date comptable donnée. Pure structure de lookup, sans accès base : le chargement (`../mapping/
 * chargement-mapping.ts`) reste côté service, cette classe ne fait qu'exposer une API de
 * résolution testable sans transaction.
 *
 * `UsageMappingCompte` reprend ICI, en dur, la TOTALITÉ de `usage_mapping_compte`
 * (`apps/api/src/db/schema/facturation/enums.ts`, migration 0010 §1) — les neuf valeurs. Élargi
 * depuis le sous-ensemble DOCUMENT (`creances_clients`/`produit`/`tva_due`/`acomptes_recus`/
 * `ecart_reprise`) pour couvrir aussi les écritures de PAIEMENT (`financier`/`arrondi`/`escompte`/
 * `perte`, MD-84 §6.2 lignes « Encaissement »/« Escompte »/« Perte ») — explicitement laissées hors
 * périmètre par l'agent précédent (voir `construction-ecriture.ts` : « hors périmètre de ce lot »)
 * et prises en charge par `construction-ecriture-paiement.ts`. Toujours pas de contrat partagé
 * `UsageMappingCompte` dans `@dfa/shared` à ce jour — même écart assumé que `db/schema/
 * facturation/enums.ts`, et toujours hors de portée d'écriture de cet agent (`packages/shared`
 * n'est pas dans le périmètre exclusif `apps/api/src/facturation/export/`).
 */

/** Les neuf valeurs de `usage_mapping_compte` (migration 0010 §1) — DOCUMENT et PAIEMENT confondus. */
export type UsageMappingCompte =
  | 'creances_clients'
  | 'produit'
  | 'tva_due'
  | 'acomptes_recus'
  | 'financier'
  | 'arrondi'
  | 'escompte'
  | 'perte'
  | 'ecart_reprise';

/** Alias conservé pour compatibilité de lecture avec `construction-ecriture.ts` (sous-ensemble
 *  DOCUMENT) — les deux types sont désormais identiques ; distinguer les deux noms au point d'appel
 *  documente l'intention (construction DOCUMENT vs PAIEMENT) sans dupliquer la liste de valeurs. */
export type UsageMappingCompteDocument = UsageMappingCompte;

/** Ce qui manque pour construire une écriture — nommé pour `EXPORT_MAPPING_INCOMPLET` (RF-112,
 *  MD-86 : « nomme ce qui manque, à remplir avec la fiduciaire »), jamais une résolution silencieuse.
 *  `documentNumero` porte le numéro affiché pour une écriture DOCUMENT ou l'identifiant du paiement
 *  pour une écriture PAIEMENT (même convention que `EcritureExport.reference`, MD-90). */
export type BesoinMappingManquant =
  | {
      readonly type: 'compte';
      readonly usage: UsageMappingCompte;
      readonly categorie: string;
      readonly documentNumero: string;
    }
  | {
      readonly type: 'code_tva';
      readonly regimeTva: string;
      readonly tauxPourmille: number;
      readonly documentNumero: string;
    };

export function decrireBesoinManquant(b: BesoinMappingManquant): string {
  if (b.type === 'compte') {
    return `mapping_compte manquant (usage=${b.usage}, categorie=${b.categorie}) pour le document ${b.documentNumero}`;
  }
  return `mapping_code_tva manquant (régime=${b.regimeTva}, taux=${b.tauxPourmille}‰) pour le document ${b.documentNumero}`;
}

const cleCompte = (usage: UsageMappingCompteDocument, categorie: string): string =>
  `${usage}::${categorie}`;
const cleCodeTva = (regimeTva: string, tauxPourmille: number): string =>
  `${regimeTva}::${String(tauxPourmille)}`;

/**
 * Vue résolue pour UNE date comptable (`mapping_compte` est versionné par dates, `RF-112` — deux
 * documents d'un même export peuvent légitimement résoudre des comptes différents si le
 * paramétrage a changé entre les deux). `ChargementMapping` (service) construit une instance par
 * date distincte rencontrée dans le lot, jamais une instance partagée pour tout le lot.
 */
export class ComptesResolusADate {
  private readonly comptes: ReadonlyMap<string, string>;
  private readonly codesTva: ReadonlyMap<string, string>;

  constructor(comptes: ReadonlyMap<string, string>, codesTva: ReadonlyMap<string, string>) {
    this.comptes = comptes;
    this.codesTva = codesTva;
  }

  resoudreCompte(usage: UsageMappingCompteDocument, categorie: string): string | undefined {
    return this.comptes.get(cleCompte(usage, categorie));
  }

  resoudreCodeTva(regimeTva: string, tauxPourmille: number): string | undefined {
    return this.codesTva.get(cleCodeTva(regimeTva, tauxPourmille));
  }
}

/** Construit la map de lookup `mapping_compte` à partir des lignes brutes chargées pour une date
 *  (une ligne par (usage, categorie) actif à cette date — le chargement garantit l'unicité, portée
 *  par l'EXCLUDE GiST `mapping_compte_periode_excl`, migration 0010 §13.3). */
export function indexerComptes(
  lignes: readonly { usage: string; categorie: string; compte: string }[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const l of lignes)
    index.set(cleCompte(l.usage as UsageMappingCompteDocument, l.categorie), l.compte);
  return index;
}

/** Construit la map de lookup `mapping_code_tva` (non versionné par date — une seule ligne par
 *  (tenant, cible, régime, taux), `mapping_code_tva_tenant_uk`). */
export function indexerCodesTva(
  lignes: readonly { regimeTva: string; tauxPourmille: number; codeExterne: string }[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const l of lignes) index.set(cleCodeTva(l.regimeTva, l.tauxPourmille), l.codeExterne);
  return index;
}
