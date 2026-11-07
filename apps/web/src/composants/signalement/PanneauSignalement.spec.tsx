import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { decoderBase64Url, URL_SIGNALEMENT_PAR_DEFAUT } from '@/diagnostic/rapport';
import { enregistrerAppelEchoue, viderTampon } from '@/diagnostic/tampon';

import { PanneauSignalement } from './PanneauSignalement';

function rendre(mode: 'via_site' | 'copie_seule' = 'via_site', modules?: readonly string[]) {
  return render(
    <PanneauSignalement
      ouvert
      onOuvertChange={() => {}}
      mode={mode}
      nbSites={2}
      modules={modules}
    />,
  );
}

const libelle = (cle: string) => i18n.t(`signalement:${cle}`);

beforeEach(() => {
  viderTampon();
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe('PanneauSignalement', () => {
  it('constat vide : erreur champ par champ, rien ne s’ouvre', async () => {
    rendre();
    await userEvent.click(screen.getByRole('button', { name: libelle('actions.continuer') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(libelle('erreurs.constat'));
    expect(window.open).not.toHaveBeenCalled();
  });

  it('ouvre le site dans un nouvel onglet noopener, avec le texte nettoyé et le diagnostic', async () => {
    enregistrerAppelEchoue({
      methode: 'POST',
      url: '/api/documents-vente/42/emettre?x=VS12345',
      statut: 409,
      code: 'TVA_NUMERO_REQUIS',
    });
    rendre();
    await userEvent.type(
      screen.getByLabelText(new RegExp(libelle('champs.constat'))),
      'Plaque VS 12345 refusée',
    );
    await userEvent.click(screen.getByRole('button', { name: libelle('actions.continuer') }));

    expect(window.open).toHaveBeenCalledTimes(1);
    const [url, cible, options] = vi.mocked(window.open).mock.calls[0] ?? [];
    expect(cible).toBe('_blank');
    expect(options).toBe('noopener');
    expect(String(url).startsWith(`${URL_SIGNALEMENT_PAR_DEFAUT}#r=`)).toBe(true);
    const charge = JSON.parse(decoderBase64Url(String(url).split('#r=')[1] ?? '')) as {
      v: number;
      source: string;
      constat: string;
      diagnostic: { nbSites: number; appelsEchec: { route: string; statut: number }[] } | null;
    };
    expect(charge.v).toBe(1);
    expect(charge.source).toBe('app');
    expect(charge.constat).toBe('Plaque [masqué] refusée');
    expect(charge.diagnostic?.nbSites).toBe(2);
    expect(charge.diagnostic?.appelsEchec).toMatchObject([
      { route: '/api/documents-vente/:id/emettre', statut: 409 },
    ]);
  });

  it('le diagnostic joint les modules actifs du garage', async () => {
    rendre('via_site', ['atelier', 'pieces']);
    await userEvent.type(
      screen.getByLabelText(new RegExp(libelle('champs.constat'))),
      'Un bouton ne fait rien',
    );
    await userEvent.click(screen.getByRole('button', { name: libelle('actions.continuer') }));
    const url = String(vi.mocked(window.open).mock.calls[0]?.[0]);
    const charge = JSON.parse(decoderBase64Url(url.split('#r=')[1] ?? '')) as {
      diagnostic: { modules: string[] } | null;
    };
    expect(charge.diagnostic?.modules).toEqual(['atelier', 'pieces']);
  });

  it('décocher le diagnostic : il n’est pas joint', async () => {
    rendre();
    await userEvent.type(
      screen.getByLabelText(new RegExp(libelle('champs.constat'))),
      'Un bouton ne fait rien',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: libelle('diagnostic.joindre') }));
    await userEvent.click(screen.getByRole('button', { name: libelle('actions.continuer') }));
    const url = String(vi.mocked(window.open).mock.calls[0]?.[0]);
    const charge = JSON.parse(decoderBase64Url(url.split('#r=')[1] ?? '')) as {
      diagnostic: unknown;
    };
    expect(charge.diagnostic).toBeNull();
  });

  it('« Copier seulement » : pas de bouton pour continuer sur le site', () => {
    rendre('copie_seule');
    expect(
      screen.queryByRole('button', { name: libelle('actions.continuer') }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: libelle('actions.copier') })).toBeInTheDocument();
  });
});
