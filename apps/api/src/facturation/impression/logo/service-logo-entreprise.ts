import { Inject, Injectable } from '@nestjs/common';
import {
  LIMITE_TAILLE_LOGO_OCTETS,
  type ReponseLogoEntreprise,
  type TypeMimeLogo,
} from '@dfa/shared';

import { ErreurMetier } from '../../../common/erreurs';
import type { ContexteTenant } from '../../../db';
import { JETON_STOCKAGE_PDF } from '../impression.jetons';
import type { StockagePdf } from '../stockage-pdf';

import { detecterTypeLogo, TYPES_LOGO_IMPRIMABLES } from './detection-logo';

export interface LogoLu {
  readonly contenu: Buffer;
  readonly typeMime: TypeMimeLogo;
}

/** Clé du logo dans le stockage : UNE par tenant, sans extension — le type se relit par magic bytes.
 *  Sous la racine des PDF : purgé avec elle à la résiliation (`purgerTenant`), et ignoré par la copie
 *  d'export (qui ne prend que les `.pdf`). */
export function cleLogo(tenantId: string): string {
  return `${tenantId}/logo`;
}

/**
 * Logo d'entreprise (`/parametres-entreprise/logo`). Le tenant vient du contexte de session, jamais
 * d'un paramètre. Un SEUL logo par tenant (le dépôt remplace).
 */
@Injectable()
export class ServiceLogoEntreprise {
  constructor(@Inject(JETON_STOCKAGE_PDF) private readonly stockage: StockagePdf) {}

  async remplacer(ctx: ContexteTenant, contenu: Buffer): Promise<ReponseLogoEntreprise> {
    if (contenu.length === 0) {
      throw this.refus('Fichier vide.');
    }
    if (contenu.length > LIMITE_TAILLE_LOGO_OCTETS) {
      throw this.refus('Logo trop volumineux (1 Mo maximum).');
    }
    const typeMime = detecterTypeLogo(contenu);
    if (!typeMime) {
      throw this.refus('Format de logo non reconnu : PNG, JPEG ou SVG sans script attendus.');
    }
    await this.stockage.ecrire(cleLogo(ctx.tenantId), contenu);
    return { typeMime, tailleOctets: contenu.length };
  }

  /** `null` = aucun logo. */
  async lire(ctx: ContexteTenant): Promise<LogoLu | null> {
    let contenu: Buffer;
    try {
      contenu = await this.stockage.lire(cleLogo(ctx.tenantId));
    } catch (erreur) {
      if (estFichierAbsent(erreur)) return null;
      throw erreur;
    }
    // Relu par magic bytes à chaque lecture : un fichier altéré sur disque n'est jamais servi
    // sous un type qu'il n'a pas.
    const typeMime = detecterTypeLogo(contenu);
    return typeMime ? { contenu, typeMime } : null;
  }

  /** Logo utilisable par l'impression PDF (PNG/JPEG — `pdfkit` ne rend pas le SVG). */
  async lirePourImpression(tenantId: string): Promise<Buffer | null> {
    const logo = await this.lire({ tenantId, utilisateurId: null, requeteId: null });
    return logo && TYPES_LOGO_IMPRIMABLES.includes(logo.typeMime) ? logo.contenu : null;
  }

  async supprimer(ctx: ContexteTenant): Promise<void> {
    await this.stockage.supprimer(cleLogo(ctx.tenantId));
  }

  private refus(message: string): ErreurMetier {
    return new ErreurMetier('VALIDATION_ECHOUEE', message, {
      erreurs: [{ champ: 'logo', code: 'logo_invalide', message }],
    });
  }
}

/**
 * Logo prêt à imprimer (PNG/JPEG) lu directement dans le stockage — pour `service-impression-facture.ts`
 * sans lui ajouter de dépendance injectée. `null` = pas de logo (ou SVG, que `pdfkit` ne rend pas) :
 * l'impression se fait alors comme avant, sans logo. Une erreur de stockage autre qu'« absent »
 * remonte (jamais un PDF sans logo servi en silence sur panne disque).
 */
export async function lireLogoImprimable(
  stockage: StockagePdf,
  tenantId: string,
): Promise<Buffer | null> {
  let contenu: Buffer;
  try {
    contenu = await stockage.lire(cleLogo(tenantId));
  } catch (erreur) {
    if (estFichierAbsent(erreur)) return null;
    throw erreur;
  }
  const type = detecterTypeLogo(contenu);
  return type && TYPES_LOGO_IMPRIMABLES.includes(type) ? contenu : null;
}

function estFichierAbsent(erreur: unknown): boolean {
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    'code' in erreur &&
    (erreur as { code?: unknown }).code === 'ENOENT'
  );
}
