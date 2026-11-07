/**
 * Plan comptable de l'export fiduciaire : lecture de l'état (`GET /exports-fiduciaires/mapping`)
 * et réglage (`PUT`), sur les tables existantes `mapping_compte` (versionné par dates, RF-112 :
 * une ligne n'est jamais réécrite, seulement close) et `mapping_code_tva` (configuration, modifiable
 * en place).
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type {
  CibleExport,
  EntreeMettreAJourMapping,
  EtatMappingExport,
  PosteCodeTvaMapping,
  PosteCompteMapping,
  RegimeTva,
  UsageMappingCompte,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import { mappingCodeTva, mappingCompte } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';
import { Horloge } from '../../common/horloge';

import { codeTvaParDefaut, POSTES_CODES_TVA, POSTES_COMPTES } from './mapping/catalogue-mapping';

/** Date d'effet d'un poste réglé pour la première fois : valable pour toute période passée à exporter. */
const DEBUT_DES_TEMPS = '1970-01-01';

@Injectable()
export class ServiceMappingExport {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  consulter(ctx: ContexteTenant, cible: CibleExport): Promise<EtatMappingExport> {
    return this.acces.enTenant(ctx, (tx) => this.etat(tx, ctx, cible));
  }

  async mettreAJour(
    ctx: ContexteTenant,
    entree: EntreeMettreAJourMapping,
  ): Promise<EtatMappingExport> {
    const aujourdhui = this.aujourdhui();
    return this.acces.enTenant(ctx, async (tx) => {
      for (const c of entree.comptes) {
        await this.regler(tx, ctx, c, aujourdhui);
      }
      for (const code of entree.codesTva) {
        const [existant] = await tx
          .select({ id: mappingCodeTva.id, codeExterne: mappingCodeTva.codeExterne })
          .from(mappingCodeTva)
          .where(
            and(
              eq(mappingCodeTva.tenantId, ctx.tenantId),
              eq(mappingCodeTva.cible, entree.cible),
              eq(mappingCodeTva.regimeTva, code.regimeTva),
              eq(mappingCodeTva.tauxPourmille, code.tauxPourmille),
            ),
          );
        if (!existant) {
          await tx.insert(mappingCodeTva).values({
            tenantId: ctx.tenantId,
            cible: entree.cible,
            regimeTva: code.regimeTva,
            tauxPourmille: code.tauxPourmille,
            codeExterne: code.codeExterne,
          });
        } else if (existant.codeExterne !== code.codeExterne) {
          await tx
            .update(mappingCodeTva)
            .set({ codeExterne: code.codeExterne })
            .where(
              and(eq(mappingCodeTva.tenantId, ctx.tenantId), eq(mappingCodeTva.id, existant.id)),
            );
        }
      }
      return this.etat(tx, ctx, entree.cible);
    });
  }

  private aujourdhui(): string {
    return this.horloge.maintenant().toISOString().slice(0, 10);
  }

  /** RF-112 : clôt la ligne active (`actif_au`) puis en ouvre une nouvelle — jamais de réécriture. */
  private async regler(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    c: EntreeMettreAJourMapping['comptes'][number],
    aujourdhui: string,
  ): Promise<void> {
    const lignes = await tx
      .select({
        id: mappingCompte.id,
        compte: mappingCompte.compte,
        actifDu: mappingCompte.actifDu,
        actifAu: mappingCompte.actifAu,
      })
      .from(mappingCompte)
      .where(
        and(
          eq(mappingCompte.tenantId, ctx.tenantId),
          eq(mappingCompte.usage, c.usage),
          eq(mappingCompte.categorie, c.categorie),
        ),
      )
      .orderBy(asc(mappingCompte.actifDu));

    const jamaisRegle = lignes.length === 0;
    const date = c.actifDu ?? (jamaisRegle ? DEBUT_DES_TEMPS : aujourdhui);
    const active = lignes.find(
      (l) => l.actifDu <= date && (l.actifAu === null || l.actifAu > date),
    );

    if (active?.compte === c.compte) return; // déjà réglé ainsi à cette date
    const posterieur = lignes.find((l) => l.actifDu > date);
    if (posterieur || (active && active.actifDu >= date)) {
      throw new ErreurMetier(
        'CONFLIT',
        `Le compte ${c.usage}/${c.categorie} a déjà une version à cette date ou plus tard — choisir une date d'effet plus récente.`,
        {
          detail: `mapping_compte ${c.usage}/${c.categorie} : version existante le ${(posterieur ?? active)?.actifDu ?? ''}.`,
          blocages: [
            {
              type: 'champ',
              id: `compte:${c.usage}:${c.categorie}`,
              libelle: `Compte ${c.usage}/${c.categorie}`,
              donnees: { usage: c.usage, categorie: c.categorie, actifDu: date },
            },
          ],
        },
      );
    }

    if (active) {
      await tx
        .update(mappingCompte)
        .set({ actifAu: date })
        .where(and(eq(mappingCompte.tenantId, ctx.tenantId), eq(mappingCompte.id, active.id)));
    }
    await tx.insert(mappingCompte).values({
      tenantId: ctx.tenantId,
      usage: c.usage,
      categorie: c.categorie,
      compte: c.compte,
      actifDu: date,
    });
  }

  private async etat(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    cible: CibleExport,
  ): Promise<EtatMappingExport> {
    const aujourdhui = this.aujourdhui();
    const [comptesActifs, codes] = await Promise.all([
      tx
        .select({
          usage: mappingCompte.usage,
          categorie: mappingCompte.categorie,
          compte: mappingCompte.compte,
          actifDu: mappingCompte.actifDu,
        })
        .from(mappingCompte)
        .where(
          and(
            eq(mappingCompte.tenantId, ctx.tenantId),
            lte(mappingCompte.actifDu, aujourdhui),
            or(isNull(mappingCompte.actifAu), gt(mappingCompte.actifAu, aujourdhui)),
          ),
        ),
      tx
        .select({
          regimeTva: mappingCodeTva.regimeTva,
          tauxPourmille: mappingCodeTva.tauxPourmille,
          codeExterne: mappingCodeTva.codeExterne,
        })
        .from(mappingCodeTva)
        .where(and(eq(mappingCodeTva.tenantId, ctx.tenantId), eq(mappingCodeTva.cible, cible))),
    ]);

    const actifParCle = new Map(comptesActifs.map((l) => [`${l.usage}::${l.categorie}`, l]));
    const connus = new Set<string>();
    const comptes: PosteCompteMapping[] = POSTES_COMPTES.map((p) => {
      const cle = `${p.usage}::${p.categorie}`;
      connus.add(cle);
      const actif = actifParCle.get(cle);
      return {
        usage: p.usage,
        categorie: p.categorie,
        libelle: p.libelle,
        compte: actif?.compte ?? null,
        actifDu: actif?.actifDu ?? null,
        compteParDefaut: p.defaut,
        requis: p.requis,
      };
    });
    // Postes réglés hors catalogue (ex. catégorie comptable personnalisée d'une ligne) : montrés,
    // jamais masqués, non requis.
    for (const l of comptesActifs) {
      if (connus.has(`${l.usage}::${l.categorie}`)) continue;
      comptes.push({
        usage: l.usage as UsageMappingCompte,
        categorie: l.categorie,
        libelle: `${l.usage} / ${l.categorie}`,
        compte: l.compte,
        actifDu: l.actifDu,
        compteParDefaut: null,
        requis: false,
      });
    }

    const codeParCle = new Map(codes.map((c) => [`${c.regimeTva}::${String(c.tauxPourmille)}`, c]));
    const codesTva: PosteCodeTvaMapping[] = POSTES_CODES_TVA.map((p) => ({
      regimeTva: p.regimeTva,
      tauxPourmille: p.tauxPourmille,
      libelle: p.libelle,
      codeExterne:
        codeParCle.get(`${p.regimeTva}::${String(p.tauxPourmille)}`)?.codeExterne ?? null,
      codeParDefaut: codeTvaParDefaut(cible, p),
      requis: p.requis,
    }));
    for (const c of codes) {
      if (
        POSTES_CODES_TVA.some(
          (p) => p.regimeTva === c.regimeTva && p.tauxPourmille === c.tauxPourmille,
        )
      ) {
        continue;
      }
      codesTva.push({
        regimeTva: c.regimeTva as RegimeTva,
        tauxPourmille: c.tauxPourmille,
        libelle: `${c.regimeTva} ${String(c.tauxPourmille / 10)} %`,
        codeExterne: c.codeExterne,
        codeParDefaut: null,
        requis: false,
      });
    }

    const nbPostesManquants =
      comptes.filter((p) => p.requis && p.compte === null).length +
      codesTva.filter((p) => p.requis && p.codeExterne === null).length;
    return { cible, complet: nbPostesManquants === 0, nbPostesManquants, comptes, codesTva };
  }
}
