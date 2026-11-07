/**
 * Photos de lignes d'OR — upload, lecture, suppression, plafonds et isolation tenant, sur vraie
 * Postgres éphémère et vrai disque (répertoire `uploads/photos-or/<tenant>` nettoyé en fin de test).
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRE_MAX_PHOTOS_PAR_LIGNE } from '@dfa/shared';

import {
  demarrerBaseEphemere,
  requeteSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import {
  creerLignePourTest,
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import { construireCookiePour } from '../relances/fixtures-relances';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let cookiePour: ReturnType<typeof construireCookiePour>;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
  for (const t of [garage?.tenantA, garage?.tenantB]) {
    if (t)
      await rm(join(process.cwd(), 'uploads', 'photos-or', t.tenant.id), {
        recursive: true,
        force: true,
      });
  }
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(500, 1),
]);

function appel(methode: 'get' | 'post' | 'delete', chemin: string, cookie: string) {
  return ctx.requete[methode](`/api/v1${chemin}`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie);
}

async function preparerLigne(tenant: 'A' | 'B') {
  const t = tenant === 'A' ? garage.tenantA : garage.tenantB;
  const or = await creerOrPourTest(
    bdd,
    t.tenant,
    t.tenant.sites[0]!.id,
    t.clients[0]!,
    t.vehicules[0]!,
  );
  const ligne = await creerLignePourTest(bdd, t.tenant, or.id);
  return {
    t,
    orId: or.id,
    ligneId: ligne.id,
    base: `/ordres-reparation/${or.id}/lignes/${ligne.id}/photos`,
  };
}

describe('photos de ligne d’OR', () => {
  it('cycle complet : envoi avec vignette, liste, binaire, vignette, suppression par l’auteur', async () => {
    const { t, orId, ligneId, base } = await preparerLigne('A');
    const cookieTech = await cookiePour(t, 'technicien');

    const envoi = await appel('post', base, cookieTech)
      .field('legende', '  Disque rayé  ')
      .attach('photo', JPEG, { filename: '../../evil.php', contentType: 'image/jpeg' })
      .attach('vignette', JPEG.subarray(0, 300), { filename: 'v.jpg', contentType: 'image/jpeg' });
    expect(envoi.status).toBe(201);
    expect(envoi.body).toMatchObject({
      ordreReparationId: orId,
      ligneId,
      legende: 'Disque rayé',
      typeMime: 'image/jpeg',
      tailleOctets: JPEG.length,
      vignetteDisponible: true,
      supprimable: true,
    });
    const photoId = envoi.body.id as string;

    const liste = await appel('get', base, cookieTech);
    expect(liste.status).toBe(200);
    expect(liste.body.donnees.map((p: { id: string }) => p.id)).toEqual([photoId]);
    const listeOr = await appel('get', `/ordres-reparation/${orId}/photos`, cookieTech);
    expect(listeOr.body.donnees).toHaveLength(1);

    const binaire = await appel('get', `/photos/${photoId}`, cookieTech).buffer(true);
    expect(binaire.status).toBe(200);
    expect(binaire.headers['content-type']).toBe('image/jpeg');
    expect(binaire.headers['cache-control']).toBe('private, max-age=3600');
    expect(binaire.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(binaire.body as Buffer, JPEG)).toBe(0);

    const vignette = await appel('get', `/photos/${photoId}/vignette`, cookieTech).buffer(true);
    expect(vignette.status).toBe(200);
    expect((vignette.body as Buffer).length).toBe(300);

    // Le nom client n'est jamais repris : clé = tenant/or/<uuid>.jpg
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      t.tenant.id,
      'select cle_fichier from ligne_or_photo where id = $1',
      [photoId],
    );
    expect((lignes[0] as { cle_fichier: string }).cle_fichier).toBe(
      `${t.tenant.id}/or/${orId}/${photoId}.jpg`,
    );

    // Audit : un geste tracé sur la ligne.
    const audit = await requeteSousTenant(
      bdd.poolApp,
      t.tenant.id,
      "select count(*)::int as n from audit_atelier where entite = 'ligne_or' and entite_id = $1 and champ = 'photo'",
      [ligneId],
    );
    expect((audit[0] as { n: number }).n).toBe(1);

    expect((await appel('delete', `/photos/${photoId}`, cookieTech)).status).toBe(204);
    expect((await appel('get', `/photos/${photoId}`, cookieTech)).status).toBe(404);
  });

  it('refuse HEIC, HTML déguisé et photo absente ; accepte PNG sans vignette (vignette = photo)', async () => {
    const { t, base } = await preparerLigne('A');
    const cookie = await cookiePour(t, 'technicien');
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(16),
    ]);

    const rHeic = await appel('post', base, cookie).attach('photo', heic, {
      filename: 'a.heic',
      contentType: 'image/heic',
    });
    expect(rHeic.status).toBe(400);
    expect(rHeic.body.detail ?? rHeic.body.title).toBeDefined();

    const rHtml = await appel('post', base, cookie).attach(
      'photo',
      Buffer.from('<script>1</script>'),
      {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      },
    );
    expect(rHtml.status).toBe(400);

    expect((await appel('post', base, cookie).field('legende', 'x')).status).toBe(400);

    const rPng = await appel('post', base, cookie).attach('photo', PNG, {
      filename: 'a.png',
      contentType: 'image/png',
    });
    expect(rPng.status).toBe(201);
    expect(rPng.body).toMatchObject({ typeMime: 'image/png', vignetteDisponible: false });
    const vignette = await appel('get', `/photos/${rPng.body.id}/vignette`, cookie).buffer(true);
    expect(vignette.headers['content-type']).toBe('image/png');
  });

  it('413 au-delà de 8 Mo ; 409 à la 21e photo', async () => {
    const { t, base } = await preparerLigne('A');
    const cookie = await cookiePour(t, 'technicien');

    const gros = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8 * 1024 * 1024)]);
    const r413 = await appel('post', base, cookie).attach('photo', gros, {
      filename: 'gros.jpg',
      contentType: 'image/jpeg',
    });
    expect(r413.status).toBe(413);

    for (let i = 0; i < NOMBRE_MAX_PHOTOS_PAR_LIGNE; i += 1) {
      const r = await appel('post', base, cookie).attach('photo', JPEG, {
        filename: `p${i}.jpg`,
        contentType: 'image/jpeg',
      });
      expect(r.status).toBe(201);
    }
    const r21 = await appel('post', base, cookie).attach('photo', JPEG, {
      filename: 'trop.jpg',
      contentType: 'image/jpeg',
    });
    expect(r21.status).toBe(409);
  }, 60_000);

  it('droits : vendeur lit sans pouvoir envoyer ; un technicien ne supprime pas la photo d’un autre, la direction oui', async () => {
    const { t, base } = await preparerLigne('A');
    const cookieChef = await cookiePour(t, 'chef_atelier');
    const cookieTech = await cookiePour(t, 'technicien');
    const cookieVendeur = await cookiePour(t, 'vendeur');
    const cookieDirection = await cookiePour(t, 'direction');

    const posee = await appel('post', base, cookieChef).attach('photo', JPEG, {
      filename: 'a.jpg',
      contentType: 'image/jpeg',
    });
    expect(posee.status).toBe(201);
    const photoId = posee.body.id as string;

    expect(
      (
        await appel('post', base, cookieVendeur).attach('photo', JPEG, {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
      ).status,
    ).toBe(403);
    expect((await appel('get', base, cookieVendeur)).status).toBe(200);
    expect((await appel('delete', `/photos/${photoId}`, cookieVendeur)).status).toBe(403);

    const vueTech = await appel('get', base, cookieTech);
    expect(vueTech.body.donnees[0].supprimable).toBe(false);
    expect((await appel('delete', `/photos/${photoId}`, cookieTech)).status).toBe(403);
    expect((await appel('delete', `/photos/${photoId}`, cookieDirection)).status).toBe(204);
  });

  it('isolation : le tenant B ne voit, ne lit, ne supprime ni ne dépose rien sur les photos et lignes du tenant A', async () => {
    const { t, orId, ligneId, base } = await preparerLigne('A');
    const cookieA = await cookiePour(t, 'direction');
    const cookieB = await cookiePour(garage.tenantB, 'direction');

    const posee = await appel('post', base, cookieA).attach('photo', JPEG, {
      filename: 'a.jpg',
      contentType: 'image/jpeg',
    });
    const photoId = posee.body.id as string;

    expect((await appel('get', `/photos/${photoId}`, cookieB)).status).toBe(404);
    expect((await appel('get', `/photos/${photoId}/vignette`, cookieB)).status).toBe(404);
    expect((await appel('delete', `/photos/${photoId}`, cookieB)).status).toBe(404);
    expect((await appel('get', base, cookieB)).status).toBe(404);
    expect((await appel('get', `/ordres-reparation/${orId}/photos`, cookieB)).status).toBe(404);
    expect(
      (
        await appel('post', `/ordres-reparation/${orId}/lignes/${ligneId}/photos`, cookieB).attach(
          'photo',
          JPEG,
          { filename: 'x.jpg', contentType: 'image/jpeg' },
        )
      ).status,
    ).toBe(404);

    // RLS : lecture directe sous B, id exact connu -> rien.
    const sousB = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select id from ligne_or_photo where id = $1',
      [photoId],
    );
    expect(sousB).toEqual([]);
    // Et la photo existe toujours pour A.
    expect((await appel('get', `/photos/${photoId}`, cookieA)).status).toBe(200);
  });
});
