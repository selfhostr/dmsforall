import { Module } from '@nestjs/common';

import { TableauBordActiviteController } from './activite.controller';
import { TableauBordFinancierController } from './financier.controller';
import { ServiceTableauBordActivite } from './service-tableau-bord-activite';
import { ServiceTableauBordFinancier } from './service-tableau-bord-financier';

/**
 * Module tableau de bord : `GET /tableau-bord/activite` (large, aucun montant,
 * `tableau_bord.activite.lire`) et `GET /tableau-bord/financier` (direction/comptable seuls,
 * `tableau_bord.financier.lire`, RF-115 — CA, encaissements, encours, marge véhicules, stock
 * pièces valorisé) — autorisation portée par `@ExigerDroit(...)` + `GardeDroit` sur chaque
 * contrôleur, actions définies dans `auth/matrice-droits.ts`. Voir `financier.ts`/`activite.ts`
 * (`packages/shared/src/contrats/tableau-bord/`) pour le détail des indicateurs retenus, ceux
 * rendus explicitement indisponibles (marge pièces/main-d'œuvre : base de coût absente ou non
 * normée à ce jour) et pourquoi.
 *
 * `JETON_DB` est fourni par `DbModule` (`@Global`, voir `app.module.ts`) : non importé ici, même
 * précédent que `ClientsModule`/`PiecesModule`.
 */
@Module({
  controllers: [TableauBordActiviteController, TableauBordFinancierController],
  providers: [ServiceTableauBordActivite, ServiceTableauBordFinancier],
})
export class TableauBordModule {}
