/**
 * Test unitaire de `estAdresseIpValide` — régression du finding 6 (audit sécurité étape 0).
 *
 * L'ancien motif `/^[0-9a-f.:%A-Z]{2,49}(\/\d{1,3})?$/i` était inopérant : le drapeau `i` rend
 * `A-Z` équivalent à TOUTES les lettres, donc `MOTIF_IP.test('zzzzzz')` était vrai. Une valeur
 * qui passait ce filtre mais restait invalide pour Postgres (`::inet`) faisait échouer
 * `amorcage.journaliser_securite` en silence côté appelant — une campagne de force brute
 * pouvait ainsi rester absente du journal de sécurité.
 *
 * Le reste de `ServiceAccesAmorcage` (pool `pg`, fonctions `SECURITY DEFINER`) est couvert par
 * les tests d'intégration (test/integration/, base Postgres réelle) — hors périmètre d'un test
 * unitaire colocalisé.
 */

import { describe, expect, it } from 'vitest';
import { estAdresseIpValide } from './acces-amorcage.service';

describe('estAdresseIpValide', () => {
  it('accepte une adresse IPv4 valide', () => {
    expect(estAdresseIpValide('203.0.113.42')).toBe(true);
  });

  it('accepte une adresse IPv6 valide', () => {
    expect(estAdresseIpValide('2001:db8::1')).toBe(true);
  });

  it("accepte une adresse IPv4-mappée en IPv6 (forme que produit Express derrière certains sockets, ex. ::ffff:127.0.0.1)", () => {
    expect(estAdresseIpValide('::ffff:127.0.0.1')).toBe(true);
  });

  it('refuse une chaîne alphabétique arbitraire (régression : l\'ancien motif regex la laissait passer)', () => {
    expect(estAdresseIpValide('zzzzzz')).toBe(false);
  });

  it('refuse une chaîne vide', () => {
    expect(estAdresseIpValide('')).toBe(false);
  });

  it('refuse une IPv4 avec un octet hors plage', () => {
    expect(estAdresseIpValide('999.999.999.999')).toBe(false);
  });

  it("refuse un en-tête X-Forwarded-For multi-valeurs non séparé (valeur brute forgeable par le client)", () => {
    expect(estAdresseIpValide('203.0.113.42, 10.0.0.1')).toBe(false);
  });

  it('refuse une IPv4 avec un suffixe CIDR (non accepté par le cast Postgres ::inet à ce point du code)', () => {
    expect(estAdresseIpValide('203.0.113.0/24')).toBe(false);
  });
});
