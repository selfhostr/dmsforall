import { LIMITE_GARAGES_CONSOLE_MAX, type ReponseSantePlateforme } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du palier 1 (vue plateforme). `GET /exploitation/sante-plateforme` — le
 * contrôleur réel (`apps/api/src/exploitation/sante-plateforme.controller.ts`) monte
 * `@Controller({ path: 'exploitation', version: '1' })` + `@Get('sante-plateforme')` ; le préfixe
 * `v1` est déjà porté par `VITE_API_URL` (`/api/v1`, voir `.env.example`), donc il ne se répète
 * jamais dans le chemin ici — même convention que tous les autres `*.api.ts` du dépôt
 * (`hooks/relances/relances.api.ts`, `hooks/pointage/pointage.api.ts`…).
 *
 * Cet endpoint rend en un seul appel `resume` (rangée d'indicateurs plateforme) ET `garages` (la
 * table), décrivant le MÊME instant (`resume.observeLe`) — jamais deux appels séparés qui
 * pourraient désynchroniser les deux. Il pagine réellement (`curseurSuivant`, `limite`), mais la
 * conception fixe le volume à « une dizaine de garages » (§2) : cet écran ne construit PAS de
 * pagination, il demande la limite maximale (`LIMITE_GARAGES_CONSOLE_MAX` = 200, largement
 * suffisante pour ce volume) en un seul appel. Si la plateforme dépasse un jour 200 garages,
 * `curseurSuivant` cessera d'être `null` et une vraie pagination deviendra nécessaire — signalé
 * plutôt que construit par anticipation.
 */
export async function recupererSantePlateformeConsole(): Promise<ReponseSantePlateforme> {
  const parametres = new URLSearchParams({ limite: String(LIMITE_GARAGES_CONSOLE_MAX) });
  const reponse = await requeteApi<ReponseSantePlateforme>(
    `/exploitation/sante-plateforme?${parametres.toString()}`,
    { method: 'GET' },
  );
  if (!reponse) {
    throw new Error('Réponse santé plateforme inattendue : corps vide.');
  }
  return reponse;
}
