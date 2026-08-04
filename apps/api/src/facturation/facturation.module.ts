import { Module } from '@nestjs/common';

import { DocumentVenteController } from './documents/document-vente.controller';
import { DocumentVenteTransitionsController } from './documents/document-vente-transitions.controller';
import { ServiceAvoir } from './documents/service-avoir';
import { ServiceDocumentsVente } from './documents/service-documents';
import { ServiceEmissionDocument } from './documents/service-emission';
import { ExportModule } from './export/export.module';
import { PaiementsModule } from './paiements/paiements.module';
import { VentesModule } from '../ventes/ventes.module';

/**
 * Façade HTTP de la facturation (étape 2) — chaîne devis → bon de commande → facture → avoir
 * (`documents/`, lot précédent), encaissement/lettrage (`paiements/`, câblé via
 * `PaiementsModule`) ET export fiduciaire (`export/`, câblé via `ExportModule` — `POST
 * /exports-fiduciaires`). `qr/` (encodage QR-facture) n'expose PAS encore de contrôleur : non
 * enregistré ici.
 *
 * PIÈGE DU DÉPÔT, vérifié explicitement pour ce module (consigne de la tâche) : un module déjà
 * livré avec tout son domaine mais `controllers: []`, ou jamais importé — vérifié ici que
 * `DocumentVenteController` ET `DocumentVenteTransitionsController` sont bien dans `controllers`,
 * que `PaiementsModule` (qui déclare `PaiementController` dans ses propres `controllers`) et
 * `ExportModule` (qui déclare `ExportComptableController` dans les siens, DEPUIS CE LOT) sont bien
 * dans `imports`, et que `AppModule` importe `FacturationModule` (voir `app.module.ts`).
 *
 * COORDINATION AVEC `paiements/` ET `export/` (à la demande explicite de la tâche) :
 *  - `paiements/` : câblé (`imports: [PaiementsModule]`). Ce lot pose déjà les colonnes dérivées
 *    consommées en LECTURE par `ReponseDocumentVente` (`statutReglement`, `montantRegleCentimes`,
 *    `soldeCentimes`, `document_vente.montant_regle_centimes`/`solde_centimes`) — ce module ne les
 *    écrit JAMAIS, il les lit telles quelles (0 par défaut tant qu'aucun paiement n'existe). Le
 *    contrat `imputation_paiement` (`MD-50`/`MD-51`) doit rester la SEULE écriture de ces deux
 *    colonnes. `PaiementsModule` ne dépend que de `JETON_DB`/`JETON_IDEMPOTENCE`, tous deux
 *    fournis par des modules `@Global` déjà importés par `AppModule` : rien à fournir ici.
 *  - `export/` : câblé (`imports: [ExportModule]`), route comprise. `ExportComptableController`
 *    expose `POST /exports-fiduciaires`, gardé par `@ExigerDroit('facturation.export.creer')` —
 *    action ajoutée à `TOUTES_ACTIONS`/`MATRICE_DROITS` par le propriétaire d'`auth/` PENDANT ce
 *    lot (`direction`/`comptable` seulement, `admin: []`, RF-115), après qu'un premier passage de
 *    cet agent eut délibérément laissé `ExportModule.controllers: []` plutôt que de contourner le
 *    typage strict d'`Action` par une assertion. `ExportModule` ne dépend que de jetons `@Global`
 *    déjà fournis par `AppModule` : rien à fournir ici non plus.
 *  - `ventes/` : câblé (`imports: [VentesModule]`), AUCUN contrôleur importé (`VentesModule`
 *    déclare les siens). Seul `ServiceVehiculeStock` (exporté par `VentesModule`) est injecté dans
 *    `ServiceEmissionDocument`, pour marquer `vendu` le véhicule d'un dossier de vente à l'émission
 *    d'une facture rattachée (RV-37/MD-70, voir la docstring de
 *    `ServiceEmissionDocument.marquerVehiculeVenduSiApplicable` pour la limite d'atomicité connue
 *    et documentée). Pas de dépendance inverse : `VentesModule` n'importe jamais
 *    `FacturationModule` (vérifié dans `ventes/ventes.module.ts`), aucun cycle de modules.
 *  - `qr/` : `ReponseDocumentVente.qr` est rendu `null` par ce lot (voir `documents/mappeurs.ts`).
 *    Câbler `qr/encodeur.ts` dans `ServiceEmissionDocument.emettre()` (§4-5, entre le recalcul des
 *    lignes et l'écriture du numéro) exige au minimum : le bloc créancier (IBAN + adresse du
 *    tenant — AUCUNE table de paramétrage IBAN/créancier n'existe dans le schéma exploré pour ce
 *    lot) et l'adresse structurée du débiteur (voir l'écart signalé dans `documents/references.ts`
 *    : `numero` de rue toujours `null`, faute de colonne dédiée sur `client_adresse`). Ni l'un ni
 *    l'autre n'est résolu ici — À ARBITRER PAR L'ORCHESTRATEUR avant de câbler `qr/` dans ce
 *    service.
 *
 * `JETON_COMPTEURS` (numérotation) n'est pas fourni ici : `CompteursModule` (`@Global`, importé
 * depuis `ParametrageModule`) le rend disponible partout — même doctrine que `AtelierModule`.
 * `JETON_DB`/`JETON_IDEMPOTENCE`/`JETON_EVENEMENTS`/`JETON_AUDIT` : fournis par `DbModule`/
 * `CommonModule`, tous deux `@Global`, importés une fois depuis `AppModule`.
 */
@Module({
  imports: [PaiementsModule, ExportModule, VentesModule],
  controllers: [DocumentVenteController, DocumentVenteTransitionsController],
  providers: [ServiceDocumentsVente, ServiceEmissionDocument, ServiceAvoir],
  exports: [ServiceDocumentsVente, ServiceEmissionDocument, ServiceAvoir],
})
export class FacturationModule {}
