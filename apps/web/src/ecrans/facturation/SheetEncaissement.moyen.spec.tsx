import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { construireDocumentBrut } from './document.fixture';
import { SheetEncaissement } from './SheetEncaissement';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function rendre(soldeCentimes: number) {
  server.use(
    http.get('/api/v1/documents-vente', () =>
      HttpResponse.json({
        donnees: [construireDocumentBrut({ soldeCentimes, totalTtcCentimes: soldeCentimes })],
        curseurSuivant: null,
        limite: 100,
      }),
    ),
  );
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <SheetEncaissement
        ouvert
        onOuvertChange={() => {}}
        siteId="site-1"
        clientId="cl-1"
        destinataireNom="Jean Dupont"
        factureIdPreselectionnee="doc-emis-1"
      />
    </QueryClientProvider>,
  );
}

async function ajouterLigne(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.click(
    await screen.findByRole('button', { name: 'Ajouter un moyen de paiement' }),
  );
}

async function choisirMoyen(utilisateur: ReturnType<typeof userEvent.setup>, nom: string) {
  await utilisateur.click(screen.getByRole('combobox', { name: 'Moyen' }));
  await utilisateur.click(await screen.findByRole('option', { name: nom }));
}

describe('SheetEncaissement — le montant suit le moyen de paiement', () => {
  it('Espèces -> TWINT : 109.45 redevient 109.44, plus d’arrondi ni d’excédent ; retour en Espèces : 109.45', async () => {
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre(10944);
    await ajouterLigne(utilisateur);

    const montant = screen.getByRole('textbox', { name: /Montant/ });
    expect(montant).toHaveValue('109.45');
    expect(screen.getByText(/arrondi \+0\.01/)).toBeInTheDocument();

    await choisirMoyen(utilisateur, 'TWINT');
    expect(screen.getByRole('textbox', { name: /Montant/ })).toHaveValue('109.44');
    expect(screen.queryByText(/arrondi/)).not.toBeInTheDocument();
    expect(screen.queryByText(/avance client/)).not.toBeInTheDocument();

    await choisirMoyen(utilisateur, 'Espèces');
    expect(screen.getByRole('textbox', { name: /Montant/ })).toHaveValue('109.45');
  });

  it('ne réécrit JAMAIS un montant tapé à la main quand on change de moyen', async () => {
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre(10944);
    await ajouterLigne(utilisateur);

    const champ = screen.getByRole('textbox', { name: /Montant/ });
    await utilisateur.clear(champ);
    await utilisateur.type(champ, '50.00');
    await choisirMoyen(utilisateur, 'Carte');
    expect(screen.getByRole('textbox', { name: /Montant/ })).toHaveValue('50.00');
  });

  it('dit « paiement partiel » avec le reste dû quand le montant est inférieur au solde', async () => {
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre(10944);
    await ajouterLigne(utilisateur);

    const champ = screen.getByRole('textbox', { name: /Montant/ });
    await utilisateur.clear(champ);
    await utilisateur.type(champ, '50.00');
    expect(await screen.findByText(/Paiement partiel : il restera .*59\.44/)).toBeInTheDocument();
  });

  it('dit combien dépasse le solde (excédent volontaire = avance client)', async () => {
    const utilisateur = userEvent.setup({ pointerEventsCheck: 0 });
    rendre(10944);
    await ajouterLigne(utilisateur);

    const champ = screen.getByRole('textbox', { name: /Montant/ });
    await utilisateur.clear(champ);
    await utilisateur.type(champ, '120.00');
    expect(
      await screen.findByText(/encaissez .*10\.56 de plus que le solde de .*109\.44/),
    ).toBeInTheDocument();
  });
});
