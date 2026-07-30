import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

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
  return render(
    <MemoryRouter initialEntries={[routeInitiale]}>
      <BarreLaterale />
    </MemoryRouter>,
  );
}

function hrefDuLien(nom: RegExp): string | null {
  return screen.getByRole('link', { name: nom }).getAttribute('href');
}

describe('BarreLaterale', () => {
  it('conserve le site courant de l’URL sur les liens Clients et Véhicules', () => {
    rendre('/clients?site=site-secondaire');

    expect(hrefDuLien(/clients/i)).toBe('/clients?site=site-secondaire');
    expect(hrefDuLien(/véhicules/i)).toBe('/vehicules?site=site-secondaire');
  });

  it('n’invente aucun site quand l’URL n’en porte pas', () => {
    rendre('/');

    expect(hrefDuLien(/clients/i)).toBe('/clients');
    expect(hrefDuLien(/véhicules/i)).toBe('/vehicules');
  });

  it('conserve le site de l’URL même quand il diffère de tout défaut plausible de session', () => {
    // Le site de l'URL n'a pas besoin d'exister dans une session pour être respecté : la barre ne
    // doit consulter aucune session pour construire ses liens, uniquement l'URL courante.
    rendre('/vehicules?site=zurich-nord');

    expect(hrefDuLien(/clients/i)).toBe('/clients?site=zurich-nord');
    expect(hrefDuLien(/véhicules/i)).toBe('/vehicules?site=zurich-nord');
  });

  it('expose un lien Facturation vers /factures', () => {
    // Régression : la facturation (étape 2) n'était atteignable qu'en tapant l'URL à la main, sans
    // aucun point d'entrée depuis le menu principal.
    rendre('/');

    expect(hrefDuLien(/facturation/i)).toBe('/factures');
  });
});
