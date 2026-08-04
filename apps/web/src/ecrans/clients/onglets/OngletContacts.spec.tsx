import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { OngletContacts } from './OngletContacts';

// jsdom n'implémente PAS `ResizeObserver` — un vrai navigateur si. `@radix-ui/react-checkbox`
// (le rôle « Conducteur » ci-dessous) l'utilise inconditionnellement dès le montage
// (`CheckboxBubbleInput`, `useSize(control)`). Même stub, même patron que
// `ecrans/vehicules/EcranNouveauVehicule.spec.tsx`.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
  }
});

const CLIENT_ID = 'client-1';

function rendre() {
  server.use(
    http.get(`/api/v1/clients/${CLIENT_ID}/contacts`, () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
    ),
  );
  return renduAvecQueryClient(<OngletContacts clientId={CLIENT_ID} />);
}

async function ouvrirEtRemplirFormulaire(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.click(screen.getByRole('button', { name: 'Ajouter un contact' }));
  await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
  await utilisateur.click(screen.getByRole('checkbox', { name: 'Conducteur' }));
}

describe('OngletContacts — erreurs de création (RM-04)', () => {
  it('affiche le message serveur SUR le champ « e-mail » (défaut 3), sans jamais le message anglais brut de zod', async () => {
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/contacts`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-contact-email',
            erreurs: [{ champ: 'email', code: 'invalid_format', message: 'Invalid email address' }],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);
    // Aucune validation cliente sur ce champ dans cet onglet (`type="email"` seul) : une saisie
    // syntaxiquement absurde part bien vers le serveur, qui la refuse.
    await utilisateur.type(screen.getByLabelText('E-mail'), 'pas-un-email');
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText("Cette adresse e-mail n'est pas valide.")).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/Invalid email address/)).not.toBeInTheDocument();
  });

  it("réinitialise le dialogue à la réouverture — un contact abandonné ne s'insère pas dans le suivant (défaut 1, garde de non-régression)", async () => {
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);
    expect(screen.getByLabelText('Nom')).toHaveValue('Rossi');

    await utilisateur.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument());
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter un contact' }));

    expect(screen.getByLabelText('Nom')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Conducteur' })).not.toBeChecked();
  });

  it('crée normalement quand le serveur accepte (pas de régression)', async () => {
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/contacts`, () =>
        HttpResponse.json(
          {
            donnees: {
              id: 'contact-1',
              nom: 'Rossi',
              prenom: null,
              fonction: null,
              telephone: null,
              email: null,
              langue: null,
              roles: ['conducteur'],
            },
            avertissements: [],
          },
          { status: 201 },
        ),
      ),
    );
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument());
    expect(screen.queryByText('Certaines informations sont incorrectes.')).not.toBeInTheDocument();
  });
});
