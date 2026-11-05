import { Module } from '@nestjs/common';

import { DocumentVenteController } from './documents/document-vente.controller';
import { DocumentVenteTransitionsController } from './documents/document-vente-transitions.controller';
import { ServiceAvoir } from './documents/service-avoir';
import { ServiceCorrectionFacture } from './documents/service-correction';
import { ServiceDocumentsVente } from './documents/service-documents';
import { ServiceEmissionDocument } from './documents/service-emission';
import { ExportModule } from './export/export.module';
import { PaiementsModule } from './paiements/paiements.module';
import { PiecesModule } from '../pieces/pieces.module';
import { VentesModule } from '../ventes/ventes.module';

/**
 * Façade HTTP de la facturation (étape 2) — chaîne devis → bon de commande → facture → avoir
 * (`documents/`, lot précédent), encaissement/lettrage (`paiements/`, câblé via
 * `PaiementsModule`) ET export fiduciaire (`export/`, câblé via `ExportModule` — `POST
 * /exports-fiduciaires`). `qr/` (encodage QR-facture) n'expose pas de contrôleur propre : câblé
 * en interne via `documents/qr-emission.ts`, appelé par `ServiceEmissionDocument.emettre()` (voir
 * plus bas — ce paragraphe corrige une note devenue fausse).
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
 *  - `pieces/` : câblé (`imports: [PiecesModule]`), AUCUN contrôleur importé (`PiecesModule`
 *    déclare les siens) — même patron que `ventes/` ci-dessus. Seul `ServiceMouvement` (exporté par
 *    `PiecesModule`) est injecté dans `ServiceDocumentsVente` ET `ServiceAvoir`, pour le pont
 *    vente comptoir (`RP-43`/`RP-46`, voir la note d'intégration de `contrats/pieces/mouvement.ts`) :
 *    `sortieComptoirPourLigneTx`/`retourClientPourLigneTx`/`trouverMouvementParLigneDocumentTx` sont
 *    appelées avec le `tx` DÉJÀ OUVERT de l'écriture facturation (contrairement au pont `ventes/`
 *    ci-dessus, qui n'a PAS cette atomicité réelle) — même patron que `AtelierModule` injectant
 *    `ServiceReservation`/`ServiceConsigne`. Pas de dépendance inverse : `PiecesModule` n'importe
 *    aucun autre module (`imports` absent de son `@Module`, vérifié), aucun cycle possible.
 *  - `qr/` : CÂBLÉ, contrairement à ce qu'affirmait une version antérieure de ce commentaire.
 *    `ServiceEmissionDocument.emettre()` (`documents/service-emission.ts`) appelle
 *    `construireBlocQrPourEmission`/`resoudreBlocCreancierPourEmission` (`documents/qr-emission.ts`,
 *    lui-même bâti sur les primitives de `qr/`) après l'allocation du numéro, en lisant
 *    `tenant_bloc_creancier` (table de paramétrage désormais posée par `parametrage/bloc-creancier/`)
 *    et l'adresse du débiteur déjà figée. `ReponseDocumentVente.qr` n'est `null` que pour un
 *    document qui n'est pas une facture émise (`documents/mappeurs.ts::construireBlocQrFige`) — pas
 *    par indisponibilité de la fonctionnalité.
 *
 * `JETON_COMPTEURS` (numérotation) n'est pas fourni ici : `CompteursModule` (`@Global`, importé
 * depuis `ParametrageModule`) le rend disponible partout — même doctrine que `AtelierModule`.
 * `JETON_DB`/`JETON_IDEMPOTENCE`/`JETON_EVENEMENTS`/`JETON_AUDIT` : fournis par `DbModule`/
 * `CommonModule`, tous deux `@Global`, importés une fois depuis `AppModule`.
 */
@Module({
  imports: [PaiementsModule, ExportModule, VentesModule, PiecesModule],
  controllers: [DocumentVenteController, DocumentVenteTransitionsController],
  providers: [
    ServiceDocumentsVente,
    ServiceEmissionDocument,
    ServiceAvoir,
    ServiceCorrectionFacture,
  ],
  exports: [ServiceDocumentsVente, ServiceEmissionDocument, ServiceAvoir, ServiceCorrectionFacture],
})
export class FacturationModule {}
