import { describe, expect, it } from 'vitest';

import { gabaritRoute, gabaritUrl } from './gabarit';

describe('gabaritRoute', () => {
  it.each([
    ['/atelier/or/3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f', '/atelier/or/:id'],
    ['/clients/12345/vehicules', '/clients/:id/vehicules'],
    ['/atelier/or/3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f?onglet=2#haut', '/atelier/or/:id'],
    [
      '/api/documents-vente/3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f/emettre',
      '/api/documents-vente/:id/emettre',
    ],
    ['/api/v1/clients', '/api/v1/clients'],
    ['/vehicules/VS12345', '/vehicules/:id'],
    ['/', '/'],
    ['', '/'],
    ['/reglages?site=abc', '/reglages'],
  ])('%s -> %s', (entree, attendu) => {
    expect(gabaritRoute(entree)).toBe(attendu);
  });
});

describe('gabaritUrl', () => {
  it('utilise le chemin seul, sans query', () => {
    expect(gabaritUrl('https://garage.ch/api/clients/42?nom=Dupont')).toBe('/api/clients/:id');
  });
  it('accepte un chemin relatif', () => {
    expect(gabaritUrl('/api/or/7/cloturer')).toBe('/api/or/:id/cloturer');
  });
});
