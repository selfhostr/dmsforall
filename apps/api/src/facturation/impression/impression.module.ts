import { Module } from '@nestjs/common';

import { FacturationModule } from '../facturation.module';

import { ImpressionFactureController } from './impression-facture.controller';
import { JETON_STOCKAGE_PDF } from './impression.jetons';
import { ServiceImpressionFacture } from './service-impression-facture';
import { StockagePdfDisqueLocal } from './stockage-pdf';

/**
 * Façade HTTP de l'impression de facture (`GET /documents-vente/{id}/pdf`).
 *
 * `'facturation.document.imprimer'` (`auth/matrice-droits.ts`) existe désormais, accordée à
 * `direction`, `comptable`, `vendeur`, `receptionnaire`, `chef_atelier`, `magasinier` — PAS
 * `technicien`, PAS `admin` (`RF-115`, `RF-116`).
 *
 * **Correction d'une affirmation fausse d'une version précédente de ce commentaire**, signalée par
 * l'agent des droits : ce n'est PAS « le même ensemble de rôles que `EMISSION_FACTURE` ».
 * `EMISSION_FACTURE` n'a que QUATRE rôles (direction, comptable, vendeur, réceptionnaire) — ni
 * `chef_atelier` ni `magasinier`. La règle réelle, et la seule exacte, est `roleVoitLesMontants()`
 * (`facturation/documents/mappeurs.ts`) : `chef_atelier` et `magasinier` VOIENT les montants d'une
 * facture (ils lisent `GET /documents-vente/{id}` avec `qr`/totaux non masqués) sans avoir le droit
 * d'ÉMETTRE une facture — consulter n'est pas engager, ce sont deux gestes de gouvernance
 * distincts. Imprimer est un geste de CONSULTATION (même filtre que voir les montants), pas
 * d'ENGAGEMENT (filtre plus étroit, réservé à l'émission) — d'où deux ensembles de rôles
 * différents pour deux droits différents. `matrice-droits.spec.ts` vérifie cette égalité
 * STRUCTURELLEMENT, rôle par rôle, en comparant `MATRICE_DROITS[role].includes(
 * 'facturation.document.imprimer')` à `roleVoitLesMontants(role)` — jamais contre une liste
 * recopiée (ici ou ailleurs) qui pourrait diverger sans qu'aucun test ne rougisse.
 *
 * `imports: [FacturationModule]` — PAS l'inverse : `ServiceDocumentsVente` (nécessaire à
 * `ServiceImpressionFacture`) est un provider direct de `FacturationModule`, exporté par lui
 * (`facturation.module.ts`, `exports: [ServiceDocumentsVente, ...]`). Si `FacturationModule`
 * importait `ImpressionModule` (comme il le fait pour `PaiementsModule`/`ExportModule`), on
 * créerait une dépendance circulaire de modules ; importer `FacturationModule` DEPUIS
 * `ImpressionModule` — sans que `FacturationModule` importe jamais `ImpressionModule` en retour —
 * l'évite proprement. `FacturationModule` n'est ici que LU (référencé), jamais modifié : conforme
 * au périmètre d'écriture de cette tâche, qui l'exclut toujours.
 *
 * Câblé dans `apps/api/src/app.module.ts` (`imports: []`, aux côtés de `FacturationModule`) —
 * périmètre d'écriture étendu explicitement à ce fichier par le coordinateur. C'est le « piège du
 * dépôt » vérifié explicitement : un module avec tout son domaine mais `controllers: []`, ou jamais
 * importé par un module racine, compile et passe ses tests sans exposer la moindre route.
 *
 * `JETON_STOCKAGE_PDF` → `StockagePdfDisqueLocal` : adaptateur disque local, suffisant pour le
 * développement et un premier pilote mono-instance (voir `stockage-pdf.ts`). Un adaptateur de
 * production (S3-compatible) remplacerait cette seule ligne, décision `expert-devops` hors du
 * périmètre de cette tâche.
 */
@Module({
  imports: [FacturationModule],
  controllers: [ImpressionFactureController],
  providers: [
    ServiceImpressionFacture,
    { provide: JETON_STOCKAGE_PDF, useClass: StockagePdfDisqueLocal },
  ],
  exports: [ServiceImpressionFacture],
})
export class ImpressionModule {}
