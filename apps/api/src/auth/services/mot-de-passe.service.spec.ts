import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/config.types';
import { ServiceMotDePasseArgon2id } from './mot-de-passe.service';

/**
 * Sous-ensemble minimal de `Config` réellement lu par `ServiceMotDePasseArgon2id`. Les valeurs
 * reprennent les minimums du schéma (`ARGON2_MEMOIRE_KIB` >= 19456) : un hash de test doit rester
 * représentatif du coût réel, pas artificiellement allégé au point de fausser le test de leurre.
 */
function configTest(): Config {
  return {
    ARGON2_MEMOIRE_KIB: 19_456,
    ARGON2_ITERATIONS: 2,
    ARGON2_PARALLELISME: 1,
  } as Config;
}

describe('ServiceMotDePasseArgon2id', () => {
  it('hache puis vérifie correctement un mot de passe correct', async () => {
    const service = new ServiceMotDePasseArgon2id(configTest());
    const hash = await service.hacher('un-mot-de-passe-correct');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verifier(hash, 'un-mot-de-passe-correct')).resolves.toBe(true);
  });

  it('rejette un mot de passe incorrect', async () => {
    const service = new ServiceMotDePasseArgon2id(configTest());
    const hash = await service.hacher('le-bon-mot-de-passe');

    await expect(service.verifier(hash, 'un-autre-mot-de-passe')).resolves.toBe(false);
  });

  it('ne lève pas sur un hash malformé, rend simplement false', async () => {
    const service = new ServiceMotDePasseArgon2id(configTest());

    await expect(service.verifier('pas-un-hash-argon2', 'peu-importe')).resolves.toBe(false);
  });

  it('verifierLeurre() se résout sans jamais lever, même en boucle', async () => {
    const service = new ServiceMotDePasseArgon2id(configTest());

    await expect(service.verifierLeurre()).resolves.toBeUndefined();
    await expect(service.verifierLeurre()).resolves.toBeUndefined();
  });

  it("verifierLeurre() a un coût CPU du même ordre de grandeur qu'un verifier() réel", async () => {
    const service = new ServiceMotDePasseArgon2id(configTest());
    const hash = await service.hacher('mot-de-passe-de-reference');
    // Échauffement : le premier verify() paie l'allocation mémoire argon2 à froid (≈1 s sous charge
    // de la suite complète), ce qui faussait la comparaison sans rien dire du coût réel.
    await service.verifier(hash, 'echauffement');

    const debutVerifier = performance.now();
    await service.verifier(hash, 'mauvaise-tentative');
    const dureeVerifier = performance.now() - debutVerifier;

    const debutLeurre = performance.now();
    await service.verifierLeurre();
    const dureeLeurre = performance.now() - debutLeurre;

    // Tolérance large (x4) : l'objectif n'est pas une égalité stricte impossible à garantir sur
    // une machine de CI partagée, mais d'exclure un raccourci du type « retourne immédiatement »
    // qui romprait l'égalisation de temps de réponse anti-énumération.
    expect(dureeLeurre).toBeGreaterThan(dureeVerifier / 4);
  });

  it('doitEtreRehache() est false pour un hash produit avec les paramètres courants', async () => {
    const service = new ServiceMotDePasseArgon2id(configTest());
    const hash = await service.hacher('mot-de-passe');

    expect(service.doitEtreRehache(hash)).toBe(false);
  });

  it('doitEtreRehache() est true quand les paramètres Argon2 ont changé (montée de coût)', async () => {
    const ancienneConfig = configTest();
    const serviceAncien = new ServiceMotDePasseArgon2id(ancienneConfig);
    const hash = await serviceAncien.hacher('mot-de-passe');

    const nouvelleConfig: Config = { ...ancienneConfig, ARGON2_ITERATIONS: 3 } as Config;
    const serviceNouveau = new ServiceMotDePasseArgon2id(nouvelleConfig);

    expect(serviceNouveau.doitEtreRehache(hash)).toBe(true);
  });

  it('doitEtreRehache() ne lève pas sur un hash illisible, le signale comme à rehacher', () => {
    const service = new ServiceMotDePasseArgon2id(configTest());

    expect(service.doitEtreRehache('pas-un-hash-argon2')).toBe(true);
  });
});
