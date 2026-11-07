import { Inject, Injectable } from '@nestjs/common';
import type {
  Avertissement,
  EntreeCreationClient,
  EntreeCreationRapideOrdreReparation,
  EntreeCreationVehicule,
  ReponseAvecAvertissements,
  ReponseClient,
  ReponseCreationRapideOrdreReparation,
  ReponseVehicule,
} from '@dfa/shared';

import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';
import { ServiceClient } from '../clients/service-client';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';
import type { ContexteTenant } from '../db';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { ServiceVehicule } from '../vehicules/service-vehicule';

import { ServiceOr } from './service-or';

/** Entrée `client.nouveau` -> `EntreeCreationClient` (même contrat que `POST /clients`). Pour une
 *  entreprise, `nom` est la raison sociale. Exportée pour test unitaire pur. */
export function versEntreeCreationClient(
  nouveau: Extract<EntreeCreationRapideOrdreReparation['client'], { nouveau: unknown }>['nouveau'],
): EntreeCreationClient {
  return {
    type: nouveau.type,
    ...(nouveau.type === 'entreprise'
      ? { raisonSociale: nouveau.nom }
      : { nom: nouveau.nom, prenom: nouveau.prenom }),
    email: nouveau.email,
    langueCorrespondance: nouveau.langueCorrespondance,
    telephones: nouveau.telephone ? [{ valeur: nouveau.telephone, principal: true }] : [],
    poObligatoire: false,
  };
}

/**
 * `POST /ordres-reparation/creation-rapide` — contrat : `@dfa/shared`,
 * `atelier/creation-rapide-or.ts`. Une transaction (celle de l'enveloppe d'idempotence) : client,
 * véhicule (détenu par le client de l'OR), OR. Tout refus annule l'ensemble.
 */
@Injectable()
export class ServiceCreationRapideOr {
  constructor(
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly clients: ServiceClient,
    private readonly vehicules: ServiceVehicule,
    private readonly ordres: ServiceOr,
  ) {}

  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeCreationRapideOrdreReparation,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & {
        corps: ReponseAvecAvertissements<ReponseCreationRapideOrdreReparation>;
      }
    >
  > {
    // Droits des créations embarquées, vérifiés AVANT tout effet de bord (la route ne porte que
    // `atelier.or.creer`) : on ne contourne pas `client.creer`/`vehicule.creer` par ce raccourci.
    const requis: Action[] = [];
    if ('nouveau' in entree.client) requis.push('client.creer');
    if ('nouveau' in entree.vehicule) requis.push('vehicule.creer');
    const droits = MATRICE_DROITS[principal.role] ?? [];
    for (const action of requis) {
      if (!droits.includes(action)) {
        throw new ErreurMetier(
          'DROIT_INSUFFISANT',
          `Le rôle "${principal.role}" n'a pas le droit "${action}".`,
        );
      }
    }

    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/ordres-reparation/creation-rapide',
        cle: cleIdempotence,
        corps: entree,
      },
      async (tx) => {
        const avertissements: Avertissement[] = [];

        let client: ReponseClient;
        if ('id' in entree.client) {
          client = await this.clients.parIdTx(tx, ctx, entree.client.id);
        } else {
          const creation = await this.clients.creerTx(
            tx,
            ctx,
            versEntreeCreationClient(entree.client.nouveau),
          );
          client = creation.donnees;
          avertissements.push(...creation.avertissements);
        }

        let vehicule: ReponseVehicule;
        if ('id' in entree.vehicule) {
          vehicule = await this.vehicules.parIdTx(tx, ctx, entree.vehicule.id);
        } else {
          const creation = await this.vehicules.creerDansTransaction(tx, ctx, {
            ...entree.vehicule.nouveau,
            detenteurId: client.id,
          } as EntreeCreationVehicule);
          vehicule = creation.donnees;
          avertissements.push(...creation.avertissements.liste());
        }

        const ordreReparation = await this.ordres.creerTx(tx, ctx, principal, {
          ...entree.or,
          clientId: client.id,
          vehiculeId: vehicule.id,
        });

        return {
          statutHttp: 201,
          corps: { donnees: { client, vehicule, ordreReparation }, avertissements },
        };
      },
    );
  }
}
