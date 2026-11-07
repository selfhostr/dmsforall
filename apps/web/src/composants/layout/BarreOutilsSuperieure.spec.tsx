import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BarreOutilsSuperieure, resoudreLibelleSite } from './BarreOutilsSuperieure';

/**
 * Lot « cadre applicatif » (19.08.2026) — ce bandeau remplace `EnTete.tsx` pour tout poste QUI A
 * une barre latérale. Lot « bandeau haut » (26.08.2026) — le SÉLECTEUR DE SITE et la BASCULE DE
 * THÈME le rejoignent (déménagés depuis `BarreLaterale.tsx`, voir sa doc de tête § justification
 * mesurée). Le pied compte (identité, Réglages, déconnexion) NE bouge PAS, il reste testé dans
 * `BarreLaterale.spec.tsx`.
 */
function rendre(cheminInitial = '/') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[cheminInitial]}>
        <Sheet>
          <BarreOutilsSuperieure />
          <SheetContent side="left">
            <SheetTitle>Navigation</SheetTitle>
          </SheetContent>
        </Sheet>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function connecte(sites: (typeof SESSION_TEST)['sites'] = SESSION_TEST.sites): void {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json({ ...SESSION_TEST, sites })));
}

describe('BarreOutilsSuperieure', () => {
  it('sans session résolue : déclencheur du tiroir + recherche + thème, ni site ni pied compte', () => {
    rendre();

    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rechercher/i })).toBeInTheDocument();
    // Bascule de thème : indépendante de la session (réglage purement local), reste utilisable
    // avant même que la session ne soit résolue.
    expect(screen.getByRole('button', { name: /passer en thème/i })).toBeInTheDocument();
    // Ancien contenu de `EnTete.tsx`, resté dans `BarreLaterale.tsx` — absent d’ici.
    expect(screen.queryByRole('button', { name: /se déconnecter/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/garage/i)).not.toBeInTheDocument();
    // Site : attend `session.sites`, absent tant qu’elle n’est pas résolue (même doctrine que
    // le reste du chrome — rien n’est affirmé de faux pendant le chargement). Quatre boutons
    // seulement (hamburger, recherche, densité, thème) : pas un de plus pour un site non résolu.
    expect(screen.getByRole('button', { name: /densité d.affichage/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('session résolue, site unique : le sélecteur de site (compact) et la bascule de thème sont tous deux présents', async () => {
    connecte();
    rendre('/?site=site-1');

    expect(await screen.findByText('Site principal')).toBeInTheDocument();
    expect(screen.getByText('PRINCIPAL')).toBeInTheDocument(); // code court, rendu compact
    expect(screen.getByRole('button', { name: /passer en thème/i })).toBeInTheDocument();
  });

  it('le déclencheur du tiroir ouvre le `Sheet` englobant', async () => {
    rendre();

    const declencheur = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(declencheur).toHaveAttribute('aria-haspopup', 'dialog');
    expect(declencheur).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * DÉFAUT MESURÉ n°2 (collision de libellé), intégration bout en bout : sans `?site=` NI
   * préférence mémorisée, le bandeau affiche désormais « Tous les sites » — plus « Aucun site
   * choisi » — pour ce même état `undefined`. Un `?site=` qui NE correspond à AUCUN site connu,
   * lui, reste une vraie anomalie et garde l’ancien libellé.
   */
  describe('libellé affiché — distinction à la source (défaut mesuré n°2)', () => {
    it('aucun `?site=`, aucune préférence : « Tous les sites », jamais « Aucun site choisi »', async () => {
      connecte();
      rendre('/');

      expect(await screen.findByText('Tous les sites')).toBeInTheDocument();
      expect(screen.queryByText('Aucun site choisi')).not.toBeInTheDocument();
    });

    it('`?site=` présent mais inconnu de la session : « Aucun site choisi », jamais « Tous les sites »', async () => {
      connecte();
      rendre('/?site=site-supprime');

      expect(await screen.findByText('Aucun site choisi')).toBeInTheDocument();
      expect(screen.queryByText('Tous les sites')).not.toBeInTheDocument();
    });
  });
});

describe('resoudreLibelleSite — fonction pure, testée isolément', () => {
  const sites = SESSION_TEST.sites;

  it('sites non résolus : chaîne vide (rien n’est affirmé de faux avant la session)', () => {
    expect(resoudreLibelleSite(undefined, 'site-1', i18n.t)).toBe('');
  });

  it('site défini et connu : son nom', () => {
    expect(resoudreLibelleSite(sites, 'site-1', i18n.t)).toBe('Site principal');
  });

  it('site absent (`undefined`) : « Tous les sites » — état légitime, pas une anomalie', () => {
    expect(resoudreLibelleSite(sites, undefined, i18n.t)).toBe(
      i18n.t('navigation:entete.tousLesSites'),
    );
  });

  it('site défini mais inconnu de la session : « Aucun site choisi » — seule vraie anomalie', () => {
    expect(resoudreLibelleSite(sites, 'site-fantome', i18n.t)).toBe(
      i18n.t('navigation:entete.siteNonChoisi'),
    );
  });
});
