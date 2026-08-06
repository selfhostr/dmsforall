import {
  schemaUpsertRegleRelance,
  type EntreeUpsertRegleRelance,
  type ReponseEnvoiRelances,
  type ReponsePlanificationRelances,
  type ReponseRegleRelance,
  type TypeRelance,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport des relances automatiques (lot 1 — facturation, rappel #2,
 * `docs/specification-relances-automatiques.md`). Même convention que
 * `hooks/pneus/depot-pneus.api.ts` : les types consommés sont ceux de `@dfa/shared`
 * (`packages/shared/src/contrats/relances/`), jamais `api/types.gen.ts`.
 *
 * ÉCART SIGNALÉ (même nature que `hooks/pneus/depot-pneus.api.ts`) : `apps/web/src/api/types.gen.ts`
 * n'a PAS été régénéré depuis l'OpenAPI pour inclure le module `relances` — vérifié le 05.08.2026,
 * aucune occurrence de `Relance`/`relances/regles` dans ce fichier généré. Les QUATRE routes
 * existent et sont prouvées côté API (`apps/api/src/relances/relances.controller.ts`) ; ce fichier
 * s'aligne sur leurs DTO, qui implémentent eux-mêmes les types `@dfa/shared` importés ci-dessus
 * (voir `apps/api/src/relances/dto/relances.dto.ts`). À réconcilier à la prochaine régénération
 * (`pnpm api:openapi && pnpm web:types`) — non exécutée ici (périmètre `apps/web` uniquement).
 *
 * LISTING ABSENT CÔTÉ API : aucune route ne liste `relance_planifiee` ni `relance_envoi`
 * (l'`index.ts` du contrat le dit explicitement — DTO de listing « laissés aux lots qui exposent
 * un écran »). L'écran affiche donc les bilans d'exécution (`planifier`/`envoyer`) mais pas le
 * journal détaillé par client, qui requiert ces routes — signalé au coordinateur.
 */

/** `GET /relances/regles` — au plus 9 lignes (une par `TypeRelance`), aucune pagination. */
export async function listerReglesRelance(): Promise<readonly ReponseRegleRelance[]> {
  const reponse = await requeteApi<readonly ReponseRegleRelance[]>('/relances/regles', {
    method: 'GET',
  });
  return reponse ?? [];
}

/** `PUT /relances/regles/{typeRelance}` — upsert idempotent d'une règle. Le corps est validé par
 *  `schemaUpsertRegleRelance` (contrat partagé) AVANT l'appel : même geste que
 *  `useModifierParametresPieces` — l'écran pré-valide déjà, ceci est le dernier filet. */
export async function upserterRegleRelance(
  typeRelance: TypeRelance,
  entree: EntreeUpsertRegleRelance,
): Promise<ReponseRegleRelance> {
  const corps = schemaUpsertRegleRelance.parse(entree);
  const reponse = await requeteApi<ReponseRegleRelance>(`/relances/regles/${typeRelance}`, {
    method: 'PUT',
    body: JSON.stringify(corps),
  });
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : PUT /relances/regles/${typeRelance}.`);
  }
  return reponse;
}

/** `POST /relances/facturation/planifier` — idempotent, rejouable sans dommage (RA-05). */
export async function planifierRelancesFacture(): Promise<ReponsePlanificationRelances> {
  const reponse = await requeteApi<ReponsePlanificationRelances>('/relances/facturation/planifier', {
    method: 'POST',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /relances/facturation/planifier.');
  }
  return reponse;
}

/** `POST /relances/facturation/envoyer` — envoie les rappels `prete`, un lot borné par appel. */
export async function envoyerRelancesFacture(): Promise<ReponseEnvoiRelances> {
  const reponse = await requeteApi<ReponseEnvoiRelances>('/relances/facturation/envoyer', {
    method: 'POST',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /relances/facturation/envoyer.');
  }
  return reponse;
}
