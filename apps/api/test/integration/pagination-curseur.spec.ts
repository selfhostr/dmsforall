/**
 * Couverture d'intégration du mécanisme de pagination par curseur (B6, rapport QA étape 0) —
 * le seul chemin de lecture de TOUTES les listes du produit (OR, clients, véhicules, pièces,
 * factures). `GET /api/v1/sites` est le premier endpoint qui l'exerce ; ce fichier vaut pour
 * tout futur endpoint qui réutilisera `ServiceSite`-like + `decoderCurseur`/`encoderCurseur`.
 *
 * Deux garanties du contrat §2.3, vérifiées ici de bout en bout (HTTP compris, pas seulement au
 * niveau des fonctions pures — voir aussi `src/common/pagination/curseur.spec.ts` pour la
 * couverture exhaustive des cas d'erreur au niveau unitaire) :
 *
 *   1. un curseur illisible rend TOUJOURS `400 VALIDATION_ECHOUEE`, jamais un `500` — le curseur
 *      est une entrée cliente arbitraire, potentiellement forgée à la main ;
 *   2. quand plusieurs lignes partagent EXACTEMENT le même `cree_le` (cas réel : un seed ou un
 *      import qui insère plusieurs lignes dans la même transaction — le seed de démo crée ainsi
 *      ses 2 sites par tenant), la pagination ne saute ni ne duplique aucune ligne. C'est le
 *      départage par `id DESC` en cas d'égalité de `cree_le` qui est ici mis à l'épreuve : sans
 *      lui (tri sur `cree_le` seul), l'ordre des ex-aequo ne serait pas garanti stable d'une page
 *      à l'autre, ce qui duplique ou saute des lignes en frontière de page.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemo, type GarageDemoFixture } from '../fixtures/garage-demo';
import { creerAppTest, demarrerRedisEphemere, extraireValeurCookie, type AppTest, type RedisEphemere } from '../setup/app-test';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let demo: GarageDemoFixture;

async function cookieDeSessionPour(email: string, motDePasse: string): Promise<string> {
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

/** Insère `n` sites pour un tenant, tous au MÊME `cree_le` (une seule instruction, valeurs
 *  littérales — jamais `default now()` répété, qui donnerait des instants distincts même
 *  exécutés dans la même milliseconde). Reproduit fidèlement le cas réel décrit au rapport QA :
 *  plusieurs lignes insérées dans la même transaction de seed/import. `poolSuperutilisateur` est
 *  requis : `site` est sous FORCE ROW LEVEL SECURITY (voir postgres-ephemere.ts). */
async function semerSitesMemeInstant(
  bddCourante: BaseEphemere,
  tenantId: string,
  n: number,
  creeLe: Date,
): Promise<string[]> {
  const ids: string[] = [];
  const lignesValeurs: string[] = [];
  const parametres: unknown[] = [];
  for (let index = 0; index < n; index += 1) {
    const id = randomUUID();
    ids.push(id);
    const code = `EXQ${String(index).padStart(2, '0')}`;
    const base = parametres.length;
    lignesValeurs.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 'CH', true, $${base + 5}, $${base + 5})`);
    parametres.push(id, tenantId, code, `Site ex-aequo ${String(index)}`, creeLe);
  }
  await bddCourante.poolSuperutilisateur.query(
    `insert into site (id, tenant_id, code, nom, pays, actif, cree_le, modifie_le) values ${lignesValeurs.join(', ')}`,
    parametres,
  );
  return ids;
}

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('GET /api/v1/sites — curseur illisible', () => {
  it.each([
    ['charabia qui ne décode même pas vers du JSON', 'ceci-n-est-pas-un-curseur-valide-!!!'],
    ['JSON valide mais objet vide (champs c et i absents)', Buffer.from('{}', 'utf8').toString('base64url')],
    ['JSON valide, uuid malformé', Buffer.from(JSON.stringify({ c: '2025-01-01T00:00:00.000Z', i: 'pas-un-uuid' }), 'utf8').toString('base64url')],
  ])('%s → 400 VALIDATION_ECHOUEE, jamais 500', async (_description, curseurInvalide) => {
    const utilisateurA = demo.tenantA.utilisateurs[0]!;
    const cookie = await cookieDeSessionPour(utilisateurA.email, utilisateurA.motDePasseClair);

    const reponse = await ctx.requete.get('/api/v1/sites').query({ curseur: curseurInvalide }).set('Cookie', cookie);

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('VALIDATION_ECHOUEE');
  });
});

describe('GET /api/v1/sites — pagination sur des lignes de même cree_le (la microseconde près)', () => {
  it('3 pages de limite=3, sans aucune ligne dupliquée ni sautée, y compris sur les 7 lignes ex-aequo', async () => {
    const utilisateurA = demo.tenantA.utilisateurs[0]!;
    const cookie = await cookieDeSessionPour(utilisateurA.email, utilisateurA.motDePasseClair);

    // Instant unique, largement postérieur à celui des 2 sites déjà semés par semerGarageDemo :
    // les 7 nouvelles lignes forment un bloc contigu en tête de tri (cree_le desc), ce qui rend
    // le test du départage par id observable sur les 2 premières pages complètes.
    const instantExAequo = new Date('2030-01-01T00:00:00.000Z');
    const idsExAequo = await semerSitesMemeInstant(bdd, demo.tenantA.id, 7, instantExAequo);

    // Total tenant A = 2 (fixture) + 7 (ex-aequo) = 9 ; limite=3 → exactement 3 pages pleines,
    // curseurSuivant = null seulement après la 3e. Si ce n'était pas le cas, soit la pagination
    // saute une ligne (moins de 3 pages), soit elle en duplique une (page 4 non vide).
    const idsCollectes: string[] = [];
    let curseur: string | undefined;
    let page = 0;
    let curseurSuivant: string | null = null;

    do {
      page += 1;
      const reponse = await ctx.requete
        .get('/api/v1/sites')
        .query(curseur ? { limite: 3, curseur } : { limite: 3 })
        .set('Cookie', cookie);
      expect(reponse.status, `page ${String(page)}`).toBe(200);

      const donnees = reponse.body.donnees as Array<{ id: string }>;
      idsCollectes.push(...donnees.map((d) => d.id));
      curseurSuivant = reponse.body.curseurSuivant as string | null;
      curseur = curseurSuivant ?? undefined;

      // Garde-fou anti-boucle infinie si le mécanisme régresse gravement (curseurSuivant qui ne
      // progresse jamais) : on n'attend jamais plus de 5 pages pour 9 lignes à limite=3.
      expect(page, 'trop de pages : la pagination ne progresse plus').toBeLessThanOrEqual(5);
    } while (curseurSuivant !== null);

    expect(page).toBe(3);
    expect(idsCollectes).toHaveLength(9);

    // Aucun doublon.
    expect(new Set(idsCollectes).size).toBe(9);

    // Aucune ligne sautée : les 7 ex-aequo ET les 2 sites de la fixture sont tous présents.
    const idsFixtureA = demo.tenantA.sites.map((s) => s.id);
    for (const id of [...idsExAequo, ...idsFixtureA]) {
      expect(idsCollectes, `id ${id} manquant de la pagination`).toContain(id);
    }
  });
});
