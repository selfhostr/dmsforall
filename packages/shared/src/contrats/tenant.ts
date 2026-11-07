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
/** Longueur maximale de la raison sociale (la colonne `tenant.raison_sociale` est un `text` : la
 *  borne est applicative ; 200 couvre largement une raison sociale inscrite au RC). */
export const LONGUEUR_MAX_RAISON_SOCIALE = 200;

export const schemaModificationParametresEntreprise = z.object({
  /** Raison sociale du garage (`tenant.raison_sociale`), ni vide ni blanche. Absente = inchangée.
   *  Le slug du garage ne suit JAMAIS ce champ. */
  raisonSociale: z.string().trim().min(1).max(LONGUEUR_MAX_RAISON_SOCIALE).optional(),
  numeroTva: schemaNumeroTva.nullable().optional(),
  /** Le garage est-il assujetti à la TVA ? Absent = inchangé. `false` : le n° TVA est vidé (un
   *  non-assujetti n'en a pas) et les documents émis n'ont aucune TVA ; fournir `numeroTva` non nul
   *  avec `assujettiTva: false` est refusé. `true` : le n° TVA peut être saisi plus tard, mais
   *  l'émission d'une facture l'exige. */
  assujettiTva: z.boolean().optional(),
  /** Délai de paiement par défaut (jours) des factures d'un client sans condition de paiement
   *  propre (`tenant.delai_paiement_jours_defaut`). Entier 0–365 ; absent = inchangé. */
  delaiPaiementJoursDefaut: z.number().int().min(0).max(365).optional(),
});

export interface ReponseParametresEntreprise {
  readonly raisonSociale: string;
  /** Le garage est-il assujetti à la TVA ? (`true` tant que le garage n'a rien répondu : c'est le
   *  comportement historique, la TVA est facturée.) */
  readonly assujettiTva: boolean;
  /** `null` : numéro pas encore saisi, ou garage non assujetti (alors toujours `null`). */
  readonly numeroTva: string | null;
  /** Délai de paiement par défaut, en jours (30 tant que le garage n'a rien choisi). */
  readonly delaiPaiementJoursDefaut: number;
}

/** Taille maximale du logo d'entreprise (`PUT /parametres-entreprise/logo`) : 1 Mo. */
export const LIMITE_TAILLE_LOGO_OCTETS = 1_048_576;
/** Types acceptés, vérifiés par les premiers octets du fichier (jamais par l'extension ni le MIME déclaré). */
export const TYPES_MIME_LOGO = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
export type TypeMimeLogo = (typeof TYPES_MIME_LOGO)[number];

/** Réponse de `PUT /parametres-entreprise/logo`. */
export interface ReponseLogoEntreprise {
  readonly typeMime: TypeMimeLogo;
  readonly tailleOctets: number;
}

export type EntreeModificationParametresEntreprise = z.infer<
  typeof schemaModificationParametresEntreprise
>;
