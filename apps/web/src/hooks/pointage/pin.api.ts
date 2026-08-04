import type { EntreeIdentificationPin, ReponseIdentificationPin } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Transport de l'identification par PIN — mode « borne partagée » du pointage
 * (`docs/specification-pointage-borne.md`, `apps/api/src/pointage/pin.controller.ts`).
 *
 * `POST /pointages/identification` N'OUVRE AUCUNE SESSION : ni cookie ni jeton, la réponse dit
 * seulement « voici qui c'est » (contrat gelé `@dfa/shared`, `pointage/identification.ts`). Le
 * site de la borne est résolu CÔTÉ SERVEUR depuis la session de la borne — ce fichier n'envoie et
 * ne reçoit donc aucun `siteId`.
 *
 * TYPE GÉNÉRÉ INDISPONIBLE au moment d'écrire cet écran : `apps/web/src/api/types.gen.ts` ne
 * contient encore aucune route `/pointages/identification` ni `/pointages/pins*` — l'export
 * OpenAPI n'a pas été régénéré depuis que `PinController` a été committé côté API (vérifié :
 * `grep -c ReponseIdentificationPin apps/web/src/api/types.gen.ts` → 0). En attendant la
 * régénération (`pnpm api:openapi && pnpm web:types`, hors périmètre de cet écran), ce fichier lit
 * le contrat encore gelé de `@dfa/shared` (`EntreeIdentificationPin`/`ReponseIdentificationPin`),
 * qui est déjà la source de vérité partagée pour cette route précise — voir l'en-tête de
 * `apps/api/src/pointage/pin-contrats.ts` côté API : « le SEUL contrat partagé réutilisé ici ». À
 * réviser vers les types générés dès qu'ils existent, mécaniquement (mêmes noms de champs).
 *
 * Le code PIN ne doit JAMAIS apparaître dans une URL ni un journal : il part uniquement dans le
 * corps JSON de cette requête `POST`, jamais en paramètre de requête, jamais loggé ici ni ailleurs
 * dans ce fichier.
 */
export async function identifierParPin(codePin: string): Promise<ReponseIdentificationPin> {
  const entree: EntreeIdentificationPin = { codePin };
  const reponse = await requeteApi<ReponseIdentificationPin>('/pointages/identification', {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /pointages/identification.');
  }
  return reponse;
}
