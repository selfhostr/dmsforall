import { Module } from '@nestjs/common';

import { TableauBordActiviteController } from './activite.controller';
import { TableauBordFinancierController } from './financier.controller';
import { ServiceTableauBordActivite } from './service-tableau-bord-activite';
import { ServiceTableauBordFinancier } from './service-tableau-bord-financier';

/**
 * Module tableau de bord : `GET /tableau-bord/activite` (large, aucun montant) et
 * `GET /tableau-bord/financier` (direction/comptable seuls) — voir `droits-provisoires.ts` pour
 * l'état PROVISOIRE de l'autorisation (actions pas encore posées dans `auth/matrice-droits.ts`,
 * hors du périmètre d'écriture de ce module) et `financier.ts`/`activite.ts`
 * (`packages/shared/src/contrats/tableau-bord/`) pour le détail des indicateurs retenus, ceux
 * écartés (marge : base de coût absente ou non normée à ce jour) et pourquoi.
 *
 * `JETON_DB` est fourni par `DbModule` (`@Global`, voir `app.module.ts`) : non importé ici, même
 * précédent que `ClientsModule`/`PiecesModule`.
 */
@Module({
  controllers: [TableauBordActiviteController, TableauBordFinancierController],
  providers: [ServiceTableauBordActivite, ServiceTableauBordFinancier],
})
export class TableauBordModule {}
