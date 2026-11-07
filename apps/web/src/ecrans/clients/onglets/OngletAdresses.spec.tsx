import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { OngletAdresses } from './OngletAdresses';

// jsdom n'implémente pas l'API Pointer Capture (`Element.prototype.hasPointerCapture` est
// absente) : `@radix-ui/react-select` l'appelle sur le déclencheur dès qu'il est monté à
// l'intérieur d'un `Dialog` (deux primitives Radix imbriquées, chacune posant sa propre gestion
// de pointeur) — ce fichier est le premier de la suite à exercer un `<Select>` par CLIC réel
// dans ce contexte précis (champ « Type d'adresse », déjà existant, jamais cliqué avant ce
// correctif ; « Pays », ajouté par lui). Sans ce repli, le clic plante en silence à mi-chemin
// (`TypeError: target.hasPointerCapture is not a function`) et l'option choisie n'est jamais
// appliquée — repli scoped à CE fichier, pas au `setup.ts` global (hors périmètre d'écriture).
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
// Même absence côté jsdom pour `scrollIntoView` (Radix Select scrolle l'option choisie en vue
// dans sa liste, `select.tsx` l'appelle sans garde) — même repli, même portée.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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

const ADRESSE_EXISTANTE = {
  id: 'adresse-1',
  type: 'principale',
  rue: 'Rue du Lac 12',
  complement: null,
  npa: '1000',
  localite: 'Lausanne',
  pays: 'CH',
  actif: true,
};

function rendreAvecUneAdresse() {
  server.use(
    http.get(`/api/v1/clients/${CLIENT_ID}/adresses`, () =>
      HttpResponse.json({ donnees: [ADRESSE_EXISTANTE], curseurSuivant: null, limite: 50 }),
    ),
  );
  return renduAvecQueryClient(<OngletAdresses clientId={CLIENT_ID} />);
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

    expect(
      await screen.findByText(
        'Certaines informations sont incorrectes ou incomplètes. Corrigez les champs signalés, puis réessayez.',
      ),
    ).toBeInTheDocument();
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

    // Avant le correctif : seul « Certaines informations sont incorrectes ou incomplètes. Corrigez les champs signalés, puis réessayez. » apparaissait, le
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
    expect(
      screen.queryByText(
        'Certaines informations sont incorrectes ou incomplètes. Corrigez les champs signalés, puis réessayez.',
      ),
    ).not.toBeInTheDocument();
  });
});

describe('OngletAdresses — issue #119 (NPA à 3 ou 5 chiffres accepté)', () => {
  it('bloque un NPA suisse de 3 chiffres, sans aucune requête réseau', async () => {
    let requeteEnvoyee = false;
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/adresses`, () => {
        requeteEnvoyee = true;
        return HttpResponse.json(
          { donnees: ADRESSE_EXISTANTE, avertissements: [] },
          { status: 201 },
        );
      }),
    );
    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une adresse' }));
    await utilisateur.type(screen.getByLabelText(/^Rue et numéro\s*\*$/), 'Rue du Lac 12');
    await utilisateur.type(screen.getByLabelText(/^NPA\s*\*$/), '123');
    await utilisateur.type(screen.getByLabelText(/^Localité\s*\*$/), 'Lausanne');

    expect(
      await screen.findByText('Le NPA suisse comporte exactement 4 chiffres (ex. 1950).'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(requeteEnvoyee).toBe(false);
  });

  it('bloque un NPA suisse de 5 chiffres (ex. 75001), même symptôme', async () => {
    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une adresse' }));
    await utilisateur.type(screen.getByLabelText(/^NPA\s*\*$/), '75001');

    expect(
      await screen.findByText('Le NPA suisse comporte exactement 4 chiffres (ex. 1950).'),
    ).toBeInTheDocument();
  });

  it('un NPA suisse à 4 chiffres reste accepté (pas de régression)', async () => {
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);

    expect(
      screen.queryByText('Le NPA suisse comporte exactement 4 chiffres (ex. 1950).'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).not.toBeDisabled();
  });
});

describe('OngletAdresses — issue #130 (aucun champ Pays)', () => {
  it("propose un champ Pays et l'envoie dans la requête de création", async () => {
    let corpsEnvoye: Record<string, unknown> | undefined;
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/adresses`, async ({ request }) => {
        corpsEnvoye = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { donnees: { ...ADRESSE_EXISTANTE, pays: 'FR' }, avertissements: [] },
          { status: 201 },
        );
      }),
    );
    rendre();
    const utilisateur = userEvent.setup();

    await ouvrirEtRemplirFormulaire(utilisateur);
    await utilisateur.click(screen.getByRole('combobox', { name: 'Pays' }));
    await utilisateur.click(screen.getByRole('option', { name: 'France' }));
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() => expect(corpsEnvoye?.pays).toBe('FR'));
  });

  it("un NPA à 5 chiffres n'est plus bloqué localement une fois le pays changé pour la France (RM cohérente avec le serveur)", async () => {
    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une adresse' }));
    await utilisateur.type(screen.getByLabelText(/^NPA\s*\*$/), '75001');
    expect(
      await screen.findByText('Le NPA suisse comporte exactement 4 chiffres (ex. 1950).'),
    ).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('combobox', { name: 'Pays' }));
    await utilisateur.click(screen.getByRole('option', { name: 'France' }));

    expect(
      screen.queryByText('Le NPA suisse comporte exactement 4 chiffres (ex. 1950).'),
    ).not.toBeInTheDocument();
  });
});

describe('OngletAdresses — issue #131 (impossible de modifier une adresse existante)', () => {
  it("affiche un bouton « Modifier l'adresse » sur chaque carte, absent avant ce correctif", async () => {
    rendreAvecUneAdresse();
    expect(
      await screen.findByRole('button', { name: "Modifier l'adresse Principale" }),
    ).toBeInTheDocument();
  });

  it('ouvre un dialogue prérempli et envoie un PATCH avec les valeurs modifiées', async () => {
    let corpsEnvoye: Record<string, unknown> | undefined;
    server.use(
      http.patch(
        `/api/v1/clients/${CLIENT_ID}/adresses/${ADRESSE_EXISTANTE.id}`,
        async ({ request }) => {
          corpsEnvoye = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            { donnees: { ...ADRESSE_EXISTANTE, rue: 'Rue du Lac 14' }, avertissements: [] },
            { status: 200 },
          );
        },
      ),
    );
    rendreAvecUneAdresse();
    const utilisateur = userEvent.setup();

    await utilisateur.click(
      await screen.findByRole('button', { name: "Modifier l'adresse Principale" }),
    );
    const champRue = await screen.findByLabelText(/^Rue et numéro\s*\*$/);
    expect(champRue).toHaveValue('Rue du Lac 12');

    await utilisateur.clear(champRue);
    await utilisateur.type(champRue, 'Rue du Lac 14');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corpsEnvoye?.rue).toBe('Rue du Lac 14'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument(),
    );
  });
});

describe('OngletAdresses — issue #132 (message d’erreur qui reste affiché après correction)', () => {
  it('corriger le champ « type » fait disparaître le message serveur avant toute nouvelle soumission', async () => {
    server.use(
      http.post(`/api/v1/clients/${CLIENT_ID}/adresses`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-adresse-doublon-2',
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
    expect(
      await screen.findByText('Une adresse « principale » active existe déjà.'),
    ).toBeInTheDocument();

    // Avant le correctif : ce message restait affiché tel quel après la correction — seule une
    // NOUVELLE soumission le faisait disparaître, y compris quand elle échouait à nouveau.
    await utilisateur.click(screen.getByRole('combobox', { name: "Type d'adresse" }));
    await utilisateur.click(screen.getByRole('option', { name: 'Facturation' }));

    expect(
      screen.queryByText('Une adresse « principale » active existe déjà.'),
    ).not.toBeInTheDocument();
  });
});
