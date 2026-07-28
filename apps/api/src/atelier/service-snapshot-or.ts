import { Injectable } from '@nestjs/common';

import type { ContexteTenant, TransactionDfa } from '../db';
import { Horloge } from '../common/horloge/horloge';
import {
  chargerAdresseFacturation,
  chargerClientLigne,
  chargerConditionsEnVigueur,
  chargerDetenteurCourantId,
  chargerVehiculeLigne,
  chargerVehiculeResume,
  nomAfficheClient,
} from './references';

/**
 * Valeurs FIGÉES à l'ouverture de l'OR (RM-50), écrites UNE SEULE FOIS — jamais recalculées après
 * création. Le trigger `ordre_reparation_verrouiller_figes` (migrations/0008_atelier.sql) interdit
 * ensuite toute modification de ces colonnes à quiconque d'autre, y compris ce service lui-même :
 * `ServiceSnapshotOr` n'est appelé qu'à la création (`ServiceOr.creer`), jamais au `PATCH`.
 */
export interface ValeursSnapshotOr {
  readonly clientDesignationFigee: string;
  readonly adresseFacturationFigee: Record<string, unknown>;
  readonly conditionsFigees: Record<string, unknown> | null;
  readonly plaqueFigee: string | null;
  readonly detenteurFigeClientId: string | null;
}

@Injectable()
export class ServiceSnapshotOr {
  constructor(private readonly horloge: Horloge) {}

  /**
   * Capture les valeurs figées au moment de la création de l'OR. `le` (par défaut l'horloge
   * injectée) sert de date de référence pour les conditions commerciales EN VIGUEUR (RM-07) — un
   * OR imprimé six mois plus tard doit porter les conditions de l'époque, pas celles d'aujourd'hui.
   */
  async capturer(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    clientId: string,
    vehiculeId: string,
    le: Date = this.horloge.maintenant(),
  ): Promise<ValeursSnapshotOr> {
    const client = await chargerClientLigne(tx, ctx, clientId);
    // Vérifie l'existence du véhicule dans la même passe (lève RESSOURCE_INTROUVABLE sinon) ;
    // la valeur elle-même n'est pas nécessaire ici, seule la plaque courante l'est (ci-dessous).
    await chargerVehiculeLigne(tx, ctx, vehiculeId);

    const [adresse, conditions, detenteurId, vehiculeResume] = await Promise.all([
      chargerAdresseFacturation(tx, ctx, clientId),
      chargerConditionsEnVigueur(tx, ctx, clientId, le),
      chargerDetenteurCourantId(tx, ctx, vehiculeId),
      chargerVehiculeResume(tx, ctx, vehiculeId),
    ]);

    return {
      clientDesignationFigee: nomAfficheClient(client),
      adresseFacturationFigee: adresse
        ? {
            type: adresse.type,
            rue: adresse.rue,
            complement: adresse.complement,
            npa: adresse.npa,
            localite: adresse.localite,
            pays: adresse.pays,
          }
        : {},
      conditionsFigees: conditions
        ? {
            rabaisMoPourmille: conditions.rabaisMoPourmille,
            rabaisPiecesPourmille: conditions.rabaisPiecesPourmille,
            rabaisPneusPourmille: conditions.rabaisPneusPourmille,
            tauxHoraireCode: conditions.tauxHoraireCode,
            delaiPaiementJours: conditions.delaiPaiementJours,
            modePaiement: conditions.modePaiement,
            plafondCentimes: conditions.plafondCentimes,
          }
        : null,
      plaqueFigee: vehiculeResume.plaque,
      detenteurFigeClientId: detenteurId,
    };
  }
}
