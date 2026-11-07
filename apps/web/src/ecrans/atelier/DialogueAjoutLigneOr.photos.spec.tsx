import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { preparerPhoto } from '@/composants/photos/preparer-photo';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { DialogueAjoutLigneOr } from './DialogueAjoutLigneOr';

vi.mock('@/composants/photos/preparer-photo', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  preparerPhoto: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:apercu');
  URL.revokeObjectURL = vi.fn();
});

const OR_ID = '44444444-4444-4444-8444-444444444444';
const LIGNE_ID = '55555555-5555-4555-8555-555555555555';

async function saisirTravailAvecPhoto(utilisateur: ReturnType<typeof userEvent.setup>) {
  vi.mocked(preparerPhoto).mockResolvedValue({
    photo: new Blob(['p'], { type: 'image/jpeg' }),
    vignette: new Blob(['v'], { type: 'image/jpeg' }),
  });
  const onAjoutee = vi.fn();
  renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} siteId="site-1" onAjoutee={onAjoutee} />);
  await utilisateur.click(screen.getByRole('button', { name: i18n.t('or:lignes.ajouter') }));
  await screen.findByRole('dialog');
  await utilisateur.type(screen.getByLabelText(/Désignation/), 'Disques de frein avant');
  await utilisateur.upload(
    screen.getByTestId('entree-photo'),
    new File(['x'], 'IMG.jpg', { type: 'image/jpeg' }),
  );
  expect(await screen.findByText('1 photo')).toBeInTheDocument();
  return onAjoutee;
}

describe('DialogueAjoutLigneOr — photo du travail constaté', () => {
  it('crée la ligne PUIS envoie la photo sur la ligne créée, et ferme', async () => {
    const ordre: string[] = [];
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, () => {
        ordre.push('ligne');
        return HttpResponse.json(
          { donnees: { id: LIGNE_ID }, avertissements: [] },
          { status: 201 },
        );
      }),
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes/${LIGNE_ID}/photos`, () => {
        ordre.push('photo');
        return HttpResponse.json({ id: 'p1' }, { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    const onAjoutee = await saisirTravailAvecPhoto(utilisateur);

    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(onAjoutee).toHaveBeenCalledTimes(1));
    expect(ordre).toEqual(['ligne', 'photo']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('photo refusée par le serveur : la ligne reste créée, le dialogue propose de réessayer ou de continuer sans — jamais une seconde ligne', async () => {
    let lignes = 0;
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, () => {
        lignes += 1;
        return HttpResponse.json(
          { donnees: { id: LIGNE_ID }, avertissements: [] },
          { status: 201 },
        );
      }),
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes/${LIGNE_ID}/photos`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'r1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    const onAjoutee = await saisirTravailAvecPhoto(utilisateur);

    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText(/Le travail est enregistré, mais 1 photo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
    expect(onAjoutee).not.toHaveBeenCalled();
    expect(lignes).toBe(1);

    await utilisateur.click(screen.getByRole('button', { name: 'Continuer sans la photo' }));
    expect(onAjoutee).toHaveBeenCalledTimes(1);
    expect(lignes).toBe(1);
  });
});
