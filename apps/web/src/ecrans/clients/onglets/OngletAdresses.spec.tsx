import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { OngletAdresses } from './OngletAdresses';

const CLIENT_ID = 'client-1';

function rendre() {
  server.use(
    http.get(`/api/v1/clients/${CLIENT_ID}/adresses`, () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
    ),
  );
  return renduAvecQueryClient(<OngletAdresses clientId={CLIENT_ID} />);
}

async function ouvrirEtRemplirFormulaire(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une adresse' }));
  await utilisateur.type(screen.getByLabelText(/^Rue et numéro\s*\*$/), 'Rue du Lac 12');
  await utilisateur.type(screen.getByLabelText(/^NPA\s*\*$/), '1000');
  await utilisateur.type(screen.getByLabelText(/^Localité\s*\*$/), 'Lausanne');
}

describe('OngletAdresses — erreur de création (RM-03)', () => {
  it('affiche le message serveur et laisse le dialogue ouvert quand la création échoue (409)', async () => {
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/adresses`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 409,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-1',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText('Certaines informations sont incorrectes.')).toBeInTheDocument();
    // Le dialogue reste ouvert : le champ saisi avant l'échec est toujours visible et non perdu.
    // (S'il s'était refermé, `getByLabelText` échouerait — le champ serait démonté.)
    expect(screen.getByLabelText(/^Rue et numéro\s*\*$/)).toHaveValue('Rue du Lac 12');
  });

  it("affiche le message serveur SUR le champ « type » pour un doublon d'adresse active (défaut 3), sans perdre le bandeau générique", async () => {
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/adresses`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-adresse-doublon',
            erreurs: [
              {
                champ: 'type',
                code: 'adresse_active_unique',
                message: 'Une adresse « principale » active existe déjà.',
              },
            ],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));

    // Avant le correctif : seul « Certaines informations sont incorrectes. » apparaissait, le
    // message serveur précis (« Une adresse « principale » active existe déjà. ») était perdu.
    expect(
      await screen.findByText('Une adresse « principale » active existe déjà.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Type d'adresse")).toHaveAttribute('aria-invalid', 'true');
  });

  it("réinitialise le dialogue à la réouverture — une adresse abandonnée ne s'insère pas dans la suivante (défaut 1, garde de non-régression)", async () => {
    // Preuve la plus stricte de ce défaut (fermeture/réouverture SANS démontage, exactement le
    // mécanisme réel constaté en navigateur) : voir `FormulaireNouveauClient.spec.tsx`, dont le
    // harnais garde volontairement le formulaire monté entre les deux. Ici, `DialogContent`
    // (Radix) démonte réellement au changement d'état dans ce moteur de test — cette assertion
    // documente donc surtout que `changerOuvert(true)` appelle bien `reinitialiser()`, non
    // seulement `creerAdresse.reset()`, et resterait verte si ce second appel disparaissait par
    // erreur (`reinitialiser` retiré, ou appelé à la mauvaise condition).
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);
    expect(screen.getByLabelText(/^Rue et numéro\s*\*$/)).toHaveValue('Rue du Lac 12');

    // Fermeture (Échap, gérée par Radix) puis réouverture — sans jamais soumettre.
    await utilisateur.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Rue et numéro')).not.toBeInTheDocument());
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une adresse' }));

    expect(screen.getByLabelText(/^Rue et numéro\s*\*$/)).toHaveValue('');
    expect(screen.getByLabelText(/^NPA\s*\*$/)).toHaveValue('');
    expect(screen.getByLabelText(/^Localité\s*\*$/)).toHaveValue('');
  });

  it('crée normalement quand le serveur accepte (pas de régression)', async () => {
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/adresses`, () =>
        HttpResponse.json(
          {
            donnees: {
              id: 'adresse-1',
              type: 'principale',
              rue: 'Rue du Lac 12',
              complement: null,
              npa: '1000',
              localite: 'Lausanne',
              pays: 'CH',
              actif: true,
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

    // Dialogue refermé sur succès (comportement déjà correct, non régressé par le correctif) : le
    // champ « Rue » n'est plus dans le DOM (Radix démonte `DialogContent` quand `open` devient
    // faux), et aucun message d'erreur ne s'affiche.
    await waitFor(() => expect(screen.queryByLabelText('Rue et numéro')).not.toBeInTheDocument());
    expect(screen.queryByText('Certaines informations sont incorrectes.')).not.toBeInTheDocument();
  });
});
