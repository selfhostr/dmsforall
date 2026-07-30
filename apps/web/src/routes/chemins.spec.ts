import { describe, expect, it } from 'vitest';

import { chemins } from './chemins';

describe('chemins.clients', () => {
  it('construit la liste sans site', () => {
    expect(chemins.clients.liste()).toBe('/clients');
  });

  it('conserve le site sélectionné en paramètre de requête', () => {
    expect(chemins.clients.liste('site-lausanne')).toBe('/clients?site=site-lausanne');
  });

  it('construit le chemin de création', () => {
    expect(chemins.clients.nouveau('site-1')).toBe('/clients/nouveau?site=site-1');
  });

  it('construit le chemin de détail avec id', () => {
    expect(chemins.clients.detail('abc-123', 'site-1')).toBe('/clients/abc-123?site=site-1');
  });

  it('construit le chemin de fusion', () => {
    expect(chemins.clients.fusion('abc-123', 'site-1')).toBe('/clients/abc-123/fusion?site=site-1');
  });
});

describe('chemins.vehicules', () => {
  it('construit la liste, la création et le détail', () => {
    expect(chemins.vehicules.liste('site-1')).toBe('/vehicules?site=site-1');
    expect(chemins.vehicules.nouveau('site-1')).toBe('/vehicules/nouveau?site=site-1');
    expect(chemins.vehicules.detail('veh-1', 'site-1')).toBe('/vehicules/veh-1?site=site-1');
  });

  it('omet le paramètre de requête quand aucun site n’est fourni', () => {
    expect(chemins.vehicules.detail('veh-1')).toBe('/vehicules/veh-1');
  });
});

describe('chemins.parametrage', () => {
  it('construit le chemin du bloc créancier, singleton par tenant — jamais de `?site=`', () => {
    expect(chemins.parametrage.facturation()).toBe('/parametrage/facturation');
  });
});
