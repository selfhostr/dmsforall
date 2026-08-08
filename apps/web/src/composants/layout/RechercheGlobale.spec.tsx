import type { ReponseRecherche } from '@dfa/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { RechercheGlobale } from './RechercheGlobale';

/**
 * Lot A (`docs/plan-refonte-navigation.md` §4) : la recherche montée dans l'en-tête, en
 * surimpression, sans jamais perdre l'état de l'écran sous-jacent. Ces tests verrouillent
 * exactement le test d'acceptation du plan (§3.1, patron d'atelier) : « il tape une plaque ou
 * touche la loupe, voit le résultat en surimpression, ferme d'un Échap sans perdre une ligne de
 * l'OR en cours de saisie ».
 *
 * Même stub cmdk que `PanneauResultatsRecherche.spec.tsx`/`EcranRecherche.spec.tsx` :
 * `scrollIntoView` et `ResizeObserver` sont absents de jsdom, seulement nécessaires une fois le
 * panneau ouvert (Radix Dialog ne monte `Command` que quand `open` est vrai).
 */
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await i18n.changeLanguage('fr');
});

const REPONSE_VEHICULE: ReponseRecherche = {
  plaqueInterchangeable: false,
  resultats: [
    {
      type: 'vehicule',
      id: 'v1',
      score: 0.9,
      correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
      resume: { plaque: 'VD 123456', designation: 'VW Touran 2.0 TDI' },
    },
  ],
};

/** Simule un écran applicatif avec de la saisie en cours (ex. une ligne d'OR) à côté de
 *  `RechercheGlobale`, exactement comme `EnTete` cohabite avec `<Outlet />` dans `AppShell`. */
function EcranSousJacentDeTest() {
  const [valeur, setValeur] = useState('');
  return (
    <div>
      <RechercheGlobale />
      <label htmlFor="ligne-or-test">Ligne OR en cours</label>
      <input id="ligne-or-test" value={valeur} onChange={(e) => setValeur(e.target.value)} />
    </div>
  );
}

function rendre(routeInitiale = '/') {
  return renduAvecRoutes(
    [
      { path: '/', element: <EcranSousJacentDeTest /> },
      { path: '/vehicules/:id', element: <p>Fiche véhicule ouverte</p> },
    ],
    { routeInitiale },
  );
}

describe('RechercheGlobale', () => {
  it('expose un vrai bouton loupe toujours visible, avec un aria-label explicite', () => {
    rendre();

    const bouton = screen.getByRole('button', { name: 'Rechercher' });
    expect(bouton.tagName).toBe('BUTTON');
    // L'icône décorative ne doit jamais porter de nom accessible concurrent.
    expect(bouton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('le bouton loupe ouvre le panneau en surimpression', async () => {
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole('button', { name: 'Rechercher' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('Ctrl+K ouvre le panneau depuis n’importe quel focus de l’écran', async () => {
    const utilisateur = userEvent.setup();
    rendre();

    // Focus posé sur un champ de l'écran « sous-jacent », pas sur la recherche : le raccourci
    // doit rester actif où que soit le focus, condition du Lot A (« depuis n'importe quel écran »).
    await utilisateur.click(screen.getByLabelText('Ligne OR en cours'));
    await utilisateur.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Échap referme le panneau sans perdre la saisie en cours sur l’écran sous-jacent', async () => {
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.type(screen.getByLabelText('Ligne OR en cours'), 'Plaquettes avant');
    await utilisateur.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await utilisateur.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Ligne OR en cours')).toHaveValue('Plaquettes avant');
  });

  it('sélectionner un résultat referme le panneau et navigue vers la fiche', async () => {
    server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_VEHICULE)));
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole('button', { name: 'Rechercher' }));
    await utilisateur.type(screen.getByRole('combobox'), 'VD 123456');

    const resultat = await screen.findByText('VW Touran 2.0 TDI');
    await utilisateur.click(resultat);

    expect(await screen.findByText('Fiche véhicule ouverte')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
