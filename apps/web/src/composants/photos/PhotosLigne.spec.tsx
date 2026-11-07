import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReponsePhotoLigne } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { renduAvecQueryClient } from '@/test/utils';

import { PhotosLigne } from './PhotosLigne';
import { ErreurPreparationPhoto, preparerPhoto } from './preparer-photo';

vi.mock('./preparer-photo', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  preparerPhoto: vi.fn(),
}));

const OR_ID = '44444444-4444-4444-8444-444444444444';
const LIGNE_ID = '55555555-5555-4555-8555-555555555555';
const AUTRE_LIGNE_ID = '66666666-6666-4666-8666-666666666666';

function photo(
  id: string,
  ligneId: string,
  extra: Partial<ReponsePhotoLigne> = {},
): ReponsePhotoLigne {
  return {
    id,
    ordreReparationId: OR_ID,
    ligneId,
    legende: null,
    typeMime: 'image/jpeg',
    tailleOctets: 1234,
    vignetteDisponible: true,
    creeParId: 'utilisateur-1',
    creeLe: '2026-11-07T08:00:00.000Z',
    supprimable: true,
    ...extra,
  };
}

function servirSession(role: string) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function servirPhotos(photos: readonly ReponsePhotoLigne[]) {
  server.use(
    http.get(`/api/v1/ordres-reparation/${OR_ID}/photos`, () =>
      HttpResponse.json({ donnees: photos }),
    ),
  );
}

beforeEach(() => {
  vi.mocked(preparerPhoto).mockReset();
});

describe('PhotosLigne', () => {
  it('affiche le compteur et les vignettes de CETTE ligne seulement', async () => {
    servirSession('technicien');
    servirPhotos([
      photo('a1111111-1111-4111-8111-111111111111', LIGNE_ID),
      photo('a2222222-2222-4222-8222-222222222222', LIGNE_ID),
      photo('a3333333-3333-4333-8333-333333333333', AUTRE_LIGNE_ID),
    ]);
    renduAvecQueryClient(
      <PhotosLigne orId={OR_ID} ligneId={LIGNE_ID} designation="Disque avant" />,
    );

    expect(await screen.findByText('2 photos')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Ouvrir la photo/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Ajouter une photo — Disque avant/ })).toBeVisible();
  });

  it('envoie la photo réduite et sa vignette, puis recharge la liste', async () => {
    servirSession('technicien');
    let envois = 0;
    let champs: string[] = [];
    let liste: ReponsePhotoLigne[] = [];
    server.use(
      http.get(`/api/v1/ordres-reparation/${OR_ID}/photos`, () =>
        HttpResponse.json({ donnees: liste }),
      ),
      http.post(
        `/api/v1/ordres-reparation/${OR_ID}/lignes/${LIGNE_ID}/photos`,
        async ({ request }) => {
          envois += 1;
          const formulaire = await request.formData();
          champs = [...formulaire.keys()];
          const creee = photo('b1111111-1111-4111-8111-111111111111', LIGNE_ID);
          liste = [creee];
          return HttpResponse.json(creee, { status: 201 });
        },
      ),
    );
    vi.mocked(preparerPhoto).mockResolvedValue({
      photo: new Blob(['p'], { type: 'image/jpeg' }),
      vignette: new Blob(['v'], { type: 'image/jpeg' }),
    });
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(<PhotosLigne orId={OR_ID} ligneId={LIGNE_ID} />);
    await screen.findByRole('button', { name: 'Photo' });

    await utilisateur.upload(
      screen.getByTestId('entree-photo'),
      new File(['x'], 'IMG_0001.heic', { type: 'image/heic' }),
    );

    await waitFor(() => expect(envois).toBe(1));
    expect(champs).toEqual(['photo', 'vignette']);
    expect(await screen.findByText('1 photo')).toBeInTheDocument();
  });

  it('une photo illisible affiche un message clair et n’envoie rien', async () => {
    servirSession('technicien');
    servirPhotos([]);
    let envois = 0;
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes/${LIGNE_ID}/photos`, () => {
        envois += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    vi.mocked(preparerPhoto).mockRejectedValue(new ErreurPreparationPhoto('heic'));
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(<PhotosLigne orId={OR_ID} ligneId={LIGNE_ID} />);
    await screen.findByRole('button', { name: 'Photo' });

    await utilisateur.upload(
      screen.getByTestId('entree-photo'),
      new File(['x'], 'a.heic', { type: 'image/heic' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/HEIC/);
    expect(envois).toBe(0);
  });

  it('un rôle sans droit d’ajout (vendeur) voit les vignettes mais pas le bouton', async () => {
    servirSession('vendeur');
    servirPhotos([photo('c1111111-1111-4111-8111-111111111111', LIGNE_ID)]);
    renduAvecQueryClient(<PhotosLigne orId={OR_ID} ligneId={LIGNE_ID} />);

    expect(await screen.findByText('1 photo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Photo' })).not.toBeInTheDocument();
  });

  it('une ligne facturée n’offre plus d’ajout', async () => {
    servirSession('chef_atelier');
    servirPhotos([photo('d1111111-1111-4111-8111-111111111111', LIGNE_ID)]);
    renduAvecQueryClient(<PhotosLigne orId={OR_ID} ligneId={LIGNE_ID} modifiable={false} />);

    expect(await screen.findByText('1 photo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Photo' })).not.toBeInTheDocument();
  });

  it('ouvre la visionneuse avec la légende au clic sur une vignette', async () => {
    servirSession('chef_atelier');
    servirPhotos([
      photo('e1111111-1111-4111-8111-111111111111', LIGNE_ID, { legende: 'Disque rayé' }),
    ]);
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(<PhotosLigne orId={OR_ID} ligneId={LIGNE_ID} />);

    await utilisateur.click(await screen.findByRole('button', { name: /Ouvrir la photo 1 sur 1/ }));

    const dialogue = await screen.findByRole('dialog');
    expect(dialogue).toHaveTextContent('Disque rayé');
    expect(screen.getByRole('button', { name: 'Supprimer la photo' })).toBeVisible();
  });
});
