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

  it('construit le chemin des doublons, sans aucun paramètre (RM-05 n’est pas scopé par site)', () => {
    expect(chemins.clients.doublons()).toBe('/clients/doublons');
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

  it('construit le chemin des référentiels (taux horaires, prestations), singleton par tenant', () => {
    expect(chemins.parametrage.referentiels()).toBe('/parametrage/referentiels');
  });

  it('construit le chemin du paramétrage atelier, singleton par tenant', () => {
    expect(chemins.parametrage.atelier()).toBe('/parametrage/atelier');
  });

  it('construit le chemin des sites en conservant le site sélectionné (scopé, à la différence des autres entrées de paramétrage)', () => {
    expect(chemins.parametrage.sites()).toBe('/parametrage/sites');
    expect(chemins.parametrage.sites('site-1')).toBe('/parametrage/sites?site=site-1');
  });
});

describe('chemins.pieces', () => {
  it('construit la recherche comptoir, scopée par site', () => {
    expect(chemins.pieces.rechercheComptoir()).toBe('/pieces/recherche-comptoir');
    expect(chemins.pieces.rechercheComptoir('site-1')).toBe('/pieces/recherche-comptoir?site=site-1');
  });

  it('construit la liste et le détail d’un article', () => {
    expect(chemins.pieces.articles('site-1')).toBe('/pieces/articles?site=site-1');
    expect(chemins.pieces.articleDetail('art-1', 'site-1')).toBe('/pieces/articles/art-1?site=site-1');
    expect(chemins.pieces.articleDetail('art-1')).toBe('/pieces/articles/art-1');
  });

  it('construit les réservations et le réapprovisionnement', () => {
    expect(chemins.pieces.reservations('site-1')).toBe('/pieces/reservations?site=site-1');
    expect(chemins.pieces.reapprovisionnement('site-1')).toBe('/pieces/reapprovisionnement?site=site-1');
  });
});
