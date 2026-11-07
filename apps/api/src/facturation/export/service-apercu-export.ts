/**
 * Aperçu d'une période AVANT export (`GET /exports-fiduciaires/apercu`) : ce qui partirait, pour
 * combien, et ce qui l'empêcherait — sans rien écrire ni marquer. Même sélection et même
 * construction d'écritures que le déclenchement (`ServiceExportComptable.preparer`) : l'aperçu ne
 * peut pas annoncer « prêt » quand le déclenchement répondrait `409`.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, between, count, eq, inArray, isNotNull } from 'drizzle-orm';
import type { ApercuExport, EntreeApercuExport, PlageNumeros, PrerequisExport } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import { documentVente, paiement } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';

import { versPrerequis } from './prerequis/prerequis-export';
import { ServiceExportComptable, syntheseDocuments } from './service-export-comptable';

const CIBLES_CABLEES: readonly string[] = ['winbiz', 'csv'];

function plage(premier: string | null, dernier: string | null): PlageNumeros | null {
  return premier !== null && dernier !== null ? { premier, dernier } : null;
}

@Injectable()
export class ServiceApercuExport {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly exportComptable: ServiceExportComptable,
  ) {}

  async apercu(ctx: ContexteTenant, entree: EntreeApercuExport): Promise<ApercuExport> {
    if (entree.periodeAu < entree.periodeDu) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'La fin de période précède son début.', {
        erreurs: [
          {
            champ: 'periodeAu',
            code: 'periode_inversee',
            message: 'La fin de période précède son début.',
          },
        ],
      });
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const prep = await this.exportComptable.preparer(tx, ctx, entree);
      const synthese = syntheseDocuments(prep.candidats);

      const conditionsDocs = [
        eq(documentVente.tenantId, ctx.tenantId),
        inArray(documentVente.typeDocument, ['facture', 'avoir']),
        inArray(documentVente.statut, ['emis', 'annule_par_avoir']),
        isNotNull(documentVente.exporteLe),
        between(documentVente.dateDocument, entree.periodeDu, entree.periodeAu),
        eq(documentVente.devise, 'CHF'),
      ];
      const conditionsPaiements = [
        eq(paiement.tenantId, ctx.tenantId),
        isNotNull(paiement.exporteLe),
        between(paiement.dateValeur, entree.periodeDu, entree.periodeAu),
        eq(paiement.devise, 'CHF'),
      ];

      const [[docsDeja], [paiementsDeja]] = await Promise.all([
        tx
          .select({ n: count() })
          .from(documentVente)
          .where(and(...conditionsDocs)),
        tx
          .select({ n: count() })
          .from(paiement)
          .where(and(...conditionsPaiements)),
      ]);

      const prerequis: PrerequisExport[] = [...versPrerequis(prep.diagnostic)];
      if (!CIBLES_CABLEES.includes(entree.cible)) {
        prerequis.push({
          code: 'FONCTION_NON_DISPONIBLE',
          limites: [`Aucun adaptateur d'export n'est câblé pour la cible « ${entree.cible} ».`],
        });
      }

      const aQuelqueChoseAExporter =
        prep.candidats.length > 0 ||
        prep.imputations.length > 0 ||
        prep.paiementsFinancierNouveau.length > 0;

      return {
        cible: entree.cible,
        periodeDu: entree.periodeDu,
        periodeAu: entree.periodeAu,
        documents: {
          nbFactures: synthese.nbFactures,
          nbAvoirs: synthese.nbAvoirs,
          aExporter: prep.candidats.length,
          dejaExportes: docsDeja?.n ?? 0,
        },
        encaissements: {
          aExporter: prep.paiementsFinancierNouveau.length,
          dejaExportes: paiementsDeja?.n ?? 0,
          imputationsAExporter: prep.imputations.length,
        },
        totaux: {
          htCentimes: Number(synthese.totalHtCentimes),
          tvaCentimes: Number(synthese.totalTvaCentimes),
          ttcCentimes: Number(synthese.totalTtcCentimes),
        },
        plageNumeros: {
          factures: plage(synthese.facturePremier, synthese.factureDernier),
          avoirs: plage(synthese.avoirPremier, synthese.avoirDernier),
        },
        prerequis,
        aQuelqueChoseAExporter,
        exportable: aQuelqueChoseAExporter && prerequis.length === 0,
      };
    });
  }
}
