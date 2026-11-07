import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import type { BlocCreancier } from '@/hooks/parametrage/bloc-creancier.api';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranParametresFacturation } from './EcranParametresFacturation';

const CHEMIN = '/api/v1/parametres-facturation/creancier';

// Radix Select (pays) appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même stub
// que `ecrans/vehicules/EcranFicheVehicule.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

/** Bloc VIDE — l'état réel d'un tenant qui n'a jamais rien saisi (§ contrat de l'API : `200`,
 *  jamais un `404`). */
const BLOC_VIDE: BlocCreancier = {
  nom: null,
  rue: null,
  numero: null,
  npa: null,
  localite: null,
  pays: 'CH',
  iban: null,
  qrIban: null,
  version: 0,
};

/** Bloc COMPLET — mêmes valeurs d'exemple que `ReponseBlocCreancierDto`
 *  (`apps/api/src/parametrage/dto/reponse-bloc-creancier.dto.ts`), donc des IBAN dont la clé de
 *  contrôle modulo 97 est réellement correcte — consigne de la tâche : ne jamais inventer un IBAN
 *  de démonstration. */
const BLOC_COMPLET: BlocCreancier = {
  nom: 'Garage Martin SA',
  rue: 'Rue de la Gare',
  numero: '12',
  npa: '1000',
  localite: 'Lausanne',
  pays: 'CH',
  iban: 'CH9300762011623852957',
  qrIban: 'CH4431999123000889012',
  version: 1_700_000_000_000,
};

function rendre() {
  server.use(
    http.get('/api/v1/parametres-entreprise', () =>
      HttpResponse.json({ raisonSociale: 'Garage Martin SA', numeroTva: null }),
    ),
  );
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcranParametresFacturation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranParametresFacturation — état vide (jamais configuré)', () => {
  it('affiche le formulaire prêt à saisir, avec le bandeau « non configuré » et la checklist de complétude', async () => {
    server.use(http.get(CHEMIN, () => HttpResponse.json(BLOC_VIDE)));
    rendre();

    expect(screen.getByRole('heading', { name: i18n.t('parametrage:titre') })).toBeInTheDocument();
    // Le `h1` est rendu immédiatement (hors du branchement chargement/erreur/données) — l'attente
    // réelle porte sur la fin du chargement, ici via le bandeau qui ne s'affiche qu'une fois les
    // données arrivées.
    expect(
      await screen.findByText(i18n.t('parametrage:creancier.nonConfigure')),
    ).toBeInTheDocument();
    // Champ vide, jamais bloqué à la saisie (numero pas requis) — formulaire directement éditable.
    expect(screen.getByLabelText(i18n.t('parametrage:creancier.identite.nom'))).toHaveValue('');
    // Checklist : rien n'est encore complet.
    expect(
      screen.queryByText(i18n.t('parametrage:creancier.completude.complet')),
    ).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t('parametrage:creancier.completude.nom'))).toBeInTheDocument();
  });
});

describe('EcranParametresFacturation — données réelles déjà saisies', () => {
  it('affiche les coordonnées existantes et la checklist complète', async () => {
    server.use(http.get(CHEMIN, () => HttpResponse.json(BLOC_COMPLET)));
    rendre();

    expect(await screen.findByLabelText(i18n.t('parametrage:creancier.identite.nom'))).toHaveValue(
      'Garage Martin SA',
    );
    expect(screen.getByLabelText(i18n.t('parametrage:creancier.comptes.iban'))).toHaveValue(
      BLOC_COMPLET.iban,
    );
    expect(screen.getByLabelText(i18n.t('parametrage:creancier.comptes.qrIban'))).toHaveValue(
      BLOC_COMPLET.qrIban,
    );
    expect(
      screen.getByText(i18n.t('parametrage:creancier.completude.complet')),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('parametrage:creancier.nonConfigure')),
    ).not.toBeInTheDocument();
  });

  it('enregistre une modification et affiche la confirmation', async () => {
    let corpsRecu: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BLOC_COMPLET)),
      http.patch(CHEMIN, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          ...BLOC_COMPLET,
          nom: 'Garage Martin & Fils SA',
          version: BLOC_COMPLET.version + 1,
        });
      }),
    );
    rendre();

    const champNom = await screen.findByLabelText(i18n.t('parametrage:creancier.identite.nom'));
    const utilisateur = userEvent.setup();
    await utilisateur.clear(champNom);
    await utilisateur.type(champNom, 'Garage Martin & Fils SA');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('parametrage:creancier.actions.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:creancier.enregistrementReussi')),
    ).toBeInTheDocument();
    expect(corpsRecu).toMatchObject({
      nom: 'Garage Martin & Fils SA',
      iban: BLOC_COMPLET.iban,
      qrIban: BLOC_COMPLET.qrIban,
    });
  });

  it('affiche une clé de contrôle IBAN refusée SOUS LE CHAMP IBAN, jamais dans un bandeau global', async () => {
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BLOC_COMPLET)),
      http.patch(CHEMIN, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-1',
            erreurs: [
              {
                champ: 'iban',
                code: 'IBAN_INVALIDE',
                message:
                  "Clé de contrôle IBAN (ISO 7064 mod 97-10) fausse — l'IBAN a été mal saisi.",
              },
            ],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    await screen.findByLabelText(i18n.t('parametrage:creancier.identite.nom'));
    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('parametrage:creancier.actions.enregistrer') }),
    );

    expect(await screen.findByText(i18n.t('erreurs:codes.IBAN_INVALIDE'))).toBeInTheDocument();
    // Jamais le message brut du serveur (règle du dépôt : le `code` pilote seul le message).
    expect(screen.queryByText(/mod 97-10/)).not.toBeInTheDocument();
    // Et jamais de bandeau générique en double.
    expect(screen.queryByText(i18n.t('erreurs:inattendue.titre'))).not.toBeInTheDocument();
  });
});

describe('EcranParametresFacturation — erreurs de chargement', () => {
  it('affiche un état d’erreur générique avec bouton « réessayer » sur une panne serveur', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(
      await screen.findByText(i18n.t('parametrage:creancier.erreur.titre')),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    ).toBeInTheDocument();
  });

  it('affiche un état de refus compréhensible — sans bouton réessayer — pour un rôle sans droit (admin, RF-115)', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
            title: 'Droit insuffisant',
            status: 403,
            code: 'DROIT_INSUFFISANT',
            instance: 'req-1',
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(
      await screen.findByText(i18n.t('parametrage:creancier.refus.titre')),
    ).toBeInTheDocument();
    expect(screen.getByText(i18n.t('parametrage:creancier.refus.description'))).toBeInTheDocument();
    // Pas le message technique générique, pas de bouton « réessayer » (retenter ne change rien
    // au rôle de l'appelant).
    expect(screen.queryByText(i18n.t('erreurs:codes.DROIT_INSUFFISANT'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: i18n.t('parametrage:creancier.refus.retourAccueil') }),
    ).toBeInTheDocument();
  });
});

describe('EcranParametresFacturation — chargement', () => {
  it('affiche un squelette pendant la requête initiale', async () => {
    server.use(
      http.get(CHEMIN, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(BLOC_VIDE);
      }),
    );
    rendre();

    expect(screen.getByText(i18n.t('commun:chargement.enCours'))).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByLabelText(i18n.t('parametrage:creancier.identite.nom')),
      ).toBeInTheDocument(),
    );
  });
});
