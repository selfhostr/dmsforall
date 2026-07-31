import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BarreLaterale } from './BarreLaterale';

/**
 * Régression : la barre latérale calculait autrefois le site des liens depuis la session
 * (`session.sites.find(actif) ?? sites[0]`), en ignorant totalement le `?site=` déjà présent dans
 * l'URL. Un utilisateur naviguant vers un site différent du défaut de sa session et cliquant
 * « Clients » ou « Véhicules » retombait silencieusement sur le site par défaut. Ces tests
 * verrouillent le mécanisme corrigé : l'URL est la source, jamais la session, et rien n'est
 * inventé quand `?site=` est absent (sinon un affichage « tous sites » deviendrait un filtre
 * implicite).
 */
function rendre(routeInitiale: string) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <BarreLaterale />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function hrefDuLien(nom: RegExp): string | null {
  return screen.getByRole('link', { name: nom }).getAttribute('href');
}

describe('BarreLaterale', () => {
  // `/^clients$/i` (correspondance exacte), PAS `/clients/i` : depuis l'ajout du lien « Doublons
  // clients » (lot 2), la regex large matcherait DEUX liens et ferait échouer `getByRole` (résultat
  // ambigu) — voir la description dédiée « expose un lien Doublons clients » plus bas.
  it('conserve le site courant de l’URL sur les liens Clients et Véhicules', () => {
    rendre('/clients?site=site-secondaire');

    expect(hrefDuLien(/^clients$/i)).toBe('/clients?site=site-secondaire');
    expect(hrefDuLien(/véhicules/i)).toBe('/vehicules?site=site-secondaire');
  });

  it('n’invente aucun site quand l’URL n’en porte pas', () => {
    rendre('/');

    expect(hrefDuLien(/^clients$/i)).toBe('/clients');
    expect(hrefDuLien(/véhicules/i)).toBe('/vehicules');
  });

  it('conserve le site de l’URL même quand il diffère de tout défaut plausible de session', () => {
    // Le site de l'URL n'a pas besoin d'exister dans une session pour être respecté : la barre ne
    // doit consulter aucune session pour construire ces liens-là, uniquement l'URL courante.
    rendre('/vehicules?site=zurich-nord');

    expect(hrefDuLien(/^clients$/i)).toBe('/clients?site=zurich-nord');
    expect(hrefDuLien(/véhicules/i)).toBe('/vehicules?site=zurich-nord');
  });

  it('expose un lien Facturation vers /factures', () => {
    // Régression : la facturation (étape 2) n'était atteignable qu'en tapant l'URL à la main, sans
    // aucun point d'entrée depuis le menu principal.
    rendre('/');

    expect(hrefDuLien(/facturation/i)).toBe('/factures');
  });

  it('expose un lien Doublons clients vers /clients/doublons, sans restriction de rôle (RM-05, `client.lire` est ouvert à tous)', () => {
    rendre('/');

    expect(hrefDuLien(/doublons/i)).toBe('/clients/doublons');
  });

  it('expose un lien Référentiels (tarifs & prestations) vers /parametrage/referentiels, SANS restriction de rôle — arbitrage du coordinateur : c’est un outil de comptoir, le réceptionniste le consulte le plus', () => {
    rendre('/');

    expect(hrefDuLien(/tarifs/i)).toBe('/parametrage/referentiels');
  });
});

/**
 * Groupe « Paramétrage » (lot 2, réarbitré) : DEUX entrées seulement — « Paramétrage atelier » et
 * « Sites » (`ROLES_MENU_PARAMETRAGE_ATELIER`), « Coordonnées bancaires » (`ROLES_MENU_FINANCIER`).
 * « Référentiels » n'en fait PLUS partie (voir le describe ci-dessus : lien inconditionnel, testé
 * séparément) — la consigne initiale qui le classait ici s'est révélée cassée pour le métier
 * (voir droits-routes.ts) et a été corrigée par le coordinateur. Masquer ici reste un confort
 * d'ergonomie, jumeau du verrou posé côté route dans `routeur.spec.tsx` (qui prouve, lui, la
 * lecture ouverte à tous — pas une restriction).
 */
describe('BarreLaterale — groupe Paramétrage (masquage par rôle, ergonomie)', () => {
  it('sans session (401 sur /auth/moi, handler par défaut) : aucune entrée de paramétrage gouvernée, mais Référentiels reste visible', async () => {
    rendre('/');

    await waitFor(() => {
      expect(screen.queryByText('Paramétrage')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /paramètres atelier/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /coordonnées bancaires/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /tarifs/i })).toBeInTheDocument();
  });

  it('technicien : ne voit ni Paramétrage atelier/Sites ni Coordonnées bancaires, mais voit Référentiels (outil de comptoir, pas de gouvernance)', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' } })));
    rendre('/');

    expect(await screen.findByRole('link', { name: /tarifs/i })).toBeInTheDocument();
    expect(screen.queryByText('Paramétrage')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /paramètres atelier/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^sites$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /coordonnées bancaires/i })).not.toBeInTheDocument();
  });

  it('réceptionniste : voit Référentiels (son outil de comptoir), mais PAS Paramétrage atelier/Sites ni Coordonnées bancaires', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role: 'receptionnaire' } })));
    rendre('/');

    expect(await screen.findByRole('link', { name: /tarifs/i })).toHaveAttribute('href', '/parametrage/referentiels');
    expect(screen.queryByRole('link', { name: /paramètres atelier/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /coordonnées bancaires/i })).not.toBeInTheDocument();
  });

  it('chef d’atelier : voit Référentiels, Paramétrage atelier et Sites, PAS les coordonnées bancaires (palier financier réservé direction/comptable)', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre('/');

    // On attend un lien GOUVERNÉ (« Paramétrage atelier »), pas « Tarifs » : ce dernier est
    // désormais inconditionnel (présent dès le tout premier rendu, avant même que la session ait
    // répondu) — l'attendre ne prouverait pas que la session est chargée, et les assertions
    // synchrones suivantes s'exécuteraient parfois AVANT résolution (flake observé en pratique).
    expect(await screen.findByRole('link', { name: /paramètres atelier/i })).toHaveAttribute('href', '/parametrage/atelier');
    expect(screen.getByRole('link', { name: /tarifs/i })).toHaveAttribute('href', '/parametrage/referentiels');
    expect(screen.getByRole('link', { name: /^sites$/i })).toHaveAttribute('href', '/parametrage/sites');
    expect(screen.queryByRole('link', { name: /coordonnées bancaires/i })).not.toBeInTheDocument();
  });

  it('admin : voit Référentiels, Paramétrage atelier et Sites, mais PAS les coordonnées bancaires (RF-115 : aucun droit financier)', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role: 'admin' } })));
    rendre('/');

    expect(await screen.findByRole('link', { name: /paramètres atelier/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /tarifs/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /coordonnées bancaires/i })).not.toBeInTheDocument();
  });

  it('comptable : voit Référentiels (ouvert à tous) et Coordonnées bancaires, PAS Paramétrage atelier/Sites (gouvernance atelier réservée chef d’atelier/direction/admin)', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role: 'comptable' } })));
    rendre('/');

    expect(await screen.findByRole('link', { name: /coordonnées bancaires/i })).toHaveAttribute('href', '/parametrage/facturation');
    expect(screen.getByRole('link', { name: /tarifs/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /paramètres atelier/i })).not.toBeInTheDocument();
  });
});
