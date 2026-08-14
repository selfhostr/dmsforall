import { Module } from '@nestjs/common';

import { AtelierModule } from '../atelier/atelier.module';

import { MotifsRendezVousController } from './motifs-rendez-vous.controller';
import { RendezVousController } from './rendez-vous.controller';
import { RendezVousTransitionsController } from './rendez-vous-transitions.controller';
import { ServiceCapaciteRendezVous } from './service-capacite-rendez-vous';
import { ServiceMotifsRendezVous } from './service-motifs-rendez-vous';
import { ServiceRendezVous } from './service-rendez-vous';

/**
 * Prise de rendez-vous d'atelier (lot RDV-1) — `docs/conception-rendez-vous-metier.md` /
 * `docs/conception-rendez-vous-donnees.md`. Trois contrôleurs sous `rendez-vous`/`motifs-rendez-vous`
 * (découpage ressource/transitions, même organisation que `AtelierModule`).
 *
 * `AtelierModule` importé pour `ServiceOr`/`ServiceTransitions` (tous deux exportés) : l'arrivée
 * du véhicule (`ServiceRendezVous.arrivee`) réutilise le statut `planifie` et la transition
 * `planifie -> ouvert` déjà câblés (T-03) plutôt que d'inventer une seconde machine à états — voir
 * la doc de tête de `ServiceRendezVous.arrivee`. Sens de dépendance à SENS UNIQUE : `AtelierModule`
 * n'importe jamais `RendezVousModule` (vérifié : `atelier.module.ts` ne cite ce module nulle
 * part) — aucun cycle, même précédent que `FacturationModule`/`VehiculesModule`/`PiecesModule`
 * documentés dans `atelier.module.ts`.
 */
@Module({
  imports: [AtelierModule],
  controllers: [MotifsRendezVousController, RendezVousController, RendezVousTransitionsController],
  providers: [ServiceMotifsRendezVous, ServiceCapaciteRendezVous, ServiceRendezVous],
})
export class RendezVousModule {}
