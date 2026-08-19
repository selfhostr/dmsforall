import { Module } from '@nestjs/common';

import { FactureFournisseurController } from './facture-fournisseur.controller';
import { ClientOcrTexteFactureHttp, JETON_PORT_OCR_TEXTE_FACTURE } from './lecture/port-ocr-texte';
import { ServiceOrchestrateurLectureFacture } from './lecture/orchestrateur-lecture';
import { ServiceFactureFournisseur } from './service-facture-fournisseur';

/**
 * Lecture automatique des factures fournisseurs — dépôt (`POST /factures-fournisseur`), chaîne
 * QR → texte PDF → OCR, rapprochement à la commande fournisseur, validation/rejet. Voir le
 * rapport de livraison pour le détail de la chaîne et ce qui reste à calibrer avec de vraies
 * factures.
 *
 * Importé par `PiecesModule` (même patron que les autres sous-domaines de `pieces/`) — PAS un
 * module Nest séparé au sommet de l'application : reste un sous-domaine du même périmètre métier
 * (référentiel article/fournisseur/commande fournisseur), et a besoin des tables `article`,
 * `fournisseur`, `commande_fournisseur*` déjà connues du même schéma.
 */
@Module({
  controllers: [FactureFournisseurController],
  providers: [
    ServiceFactureFournisseur,
    ServiceOrchestrateurLectureFacture,
    { provide: JETON_PORT_OCR_TEXTE_FACTURE, useClass: ClientOcrTexteFactureHttp },
  ],
  exports: [ServiceFactureFournisseur],
})
export class FactureFournisseurModule {}
