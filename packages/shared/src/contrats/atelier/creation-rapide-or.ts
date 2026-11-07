import { z } from 'zod';

import type { ReponseClient } from './client';
import { schemaCreationClient } from './client';
import type { ReponseOrdreReparation } from './ordre-reparation';
import { schemaCreationOrdreReparation } from './ordre-reparation';
import { schemaIdentifiant } from './primitives';
import type { ReponseVehicule } from './vehicule';
import { schemaCreationVehicule } from './vehicule';

/**
 * `POST /ordres-reparation/creation-rapide` — l'accueil comptoir en un appel : (créer le client)
 * + (créer le véhicule) + créer l'OR, dans UNE transaction. `Idempotency-Key` obligatoire. Tout ou
 * rien : un refus de l'OR (client bloqué non confirmé, OR déjà ouvert…) ou de la plaque en
 * collision annule aussi la création du client et du véhicule.
 *
 * Client : `{ id }` (existant) ou `{ nouveau }`. `nouveau.nom` est le nom du particulier, ou la
 * raison sociale pour `type = 'entreprise'`. Un doublon probable n'est JAMAIS bloquant : il revient
 * dans `avertissements` (`CLIENT_DOUBLON_PROBABLE`, même charge que `POST /clients`).
 *
 * Véhicule : `{ id }` ou `{ nouveau }` (mêmes champs que `POST /vehicules`, `plaque` obligatoire,
 * sans `detenteurId` : le détenteur est le client de l'OR).
 *
 * OR : les champs de `POST /ordres-reparation` sans `clientId` ni `vehiculeId`. `confirmations`
 * se met dans `or.confirmations` et entre dans l'empreinte d'idempotence.
 */
const schemaClientNouveauRapide = z
  .object({
    type: schemaCreationClient.shape.type,
    nom: z.string().trim().min(1).max(200),
    prenom: schemaCreationClient.shape.prenom,
    telephone: z.string().trim().min(4).max(30).optional(),
    email: schemaCreationClient.shape.email,
    langueCorrespondance: schemaCreationClient.shape.langueCorrespondance.default('fr'),
  })
  .strict();

export const schemaCreationRapideOrdreReparation = z
  .object({
    client: z.union([
      z.object({ id: schemaIdentifiant }).strict(),
      z.object({ nouveau: schemaClientNouveauRapide }).strict(),
    ]),
    vehicule: z.union([
      z.object({ id: schemaIdentifiant }).strict(),
      z
        .object({
          nouveau: schemaCreationVehicule
            .omit({ detenteurId: true, plaque: true })
            .extend({ plaque: z.string().trim().min(2).max(20) })
            .strict(),
        })
        .strict(),
    ]),
    or: schemaCreationOrdreReparation.omit({ clientId: true, vehiculeId: true }).strict(),
  })
  .strict();
export type EntreeCreationRapideOrdreReparation = z.infer<
  typeof schemaCreationRapideOrdreReparation
>;

export interface ReponseCreationRapideOrdreReparation {
  readonly client: ReponseClient;
  readonly vehicule: ReponseVehicule;
  readonly ordreReparation: ReponseOrdreReparation;
}
