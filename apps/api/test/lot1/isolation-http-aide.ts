/**
 * Petite aide HTTP partagée par les specs `isolation-*.spec.ts` de ce répertoire, qui pilotent
 * l'API en clair (preuve IDOR par les VRAIS contrôleurs, pas seulement par SQL direct). Évite de
 * dupliquer trois fois la même mécanique « email/mot de passe -> cookie de session », déjà
 * présente sous une forme quasi identique dans `test/integration/isolation-api.spec.ts` (fichier
 * hors périmètre de cette tâche, pas touché).
 *
 * Ne dépend que de `AppTest` (déjà câblé par `test/setup/app-test.ts`) et de l'endpoint
 * `/api/v1/auth/connexion` de l'étape 0 — aucun couplage avec les modules en cours d'écriture
 * (clients, atelier).
 */
import type { AppTest } from '../setup/app-test';
import { extraireValeurCookie } from '../setup/app-test';

export async function cookieDeSessionPour(ctx: AppTest, email: string, motDePasse: string): Promise<string> {
  const reponse = await ctx.requete
    .post('/api/v1/auth/connexion')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .send({ email, motDePasse });
  if (reponse.status !== 200) {
    throw new Error(`connexion de test échouée (${reponse.status}) : ${JSON.stringify(reponse.body)}`);
  }
  const token = extraireValeurCookie(reponse, ctx.config.SESSION_COOKIE_NOM);
  return `${ctx.config.SESSION_COOKIE_NOM}=${token}`;
}
