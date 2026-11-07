/**
 * Le piège documenté de ce dépôt (CONTRIBUTING.md) : un namespace i18n peut exister au complet sur
 * disque (FR/DE/IT en parité stricte) sans jamais être chargé par i18next si personne ne l'a
 * enregistré dans `src/i18n/index.ts` (imports, tableau `NAMESPACES`, objet `ressources`).
 * `pnpm i18n:check` vérifie désormais l'enregistrement statique (regex sur `index.ts`), mais ne
 * prouve pas qu'i18next RÉSOUT réellement une clé à l'exécution. Ce test monte le singleton i18n
 * réel (même import que tout composant du produit, `@/i18n`) et résout des clés `ventes:*` dans
 * les trois langues — la seule preuve qui vaille que le namespace est utilisable, pas seulement
 * présent.
 */
import { describe, expect, it, afterEach } from 'vitest';

import i18n from '@/i18n';

describe('Namespace ventes — chargeable à l’exécution', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('résout des clés ventes:* dans les trois langues (fr, de, it)', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('ventes:titre')).toBe('Véhicules à vendre');
    expect(i18n.t('ventes:stock.statuts.disponible')).toBe('Disponible');
    expect(i18n.t('ventes:dossier.statuts.pretALivrer')).toBe('Prêt à livrer');
    expect(i18n.t('ventes:reprise.statuts.confirmee')).toBe('Confirmée');
    expect(i18n.t('ventes:financement.types.leasing')).toBe('Leasing');

    await i18n.changeLanguage('de');
    expect(i18n.t('ventes:titre')).toBe('Fahrzeugverkauf');
    expect(i18n.t('ventes:stock.statuts.disponible')).toBe('Verfügbar');
    expect(i18n.t('ventes:dossier.statuts.pretALivrer')).toBe('Übergabebereit');

    await i18n.changeLanguage('it');
    expect(i18n.t('ventes:titre')).toBe('Veicoli in vendita');
    expect(i18n.t('ventes:stock.statuts.disponible')).toBe('Disponibile');
    expect(i18n.t('ventes:dossier.statuts.pretALivrer')).toBe('Pronto per la consegna');
  });

  it('résout une interpolation ICU plurielle (ventes:stock.joursStock.valeur)', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('ventes:stock.joursStock.valeur', { n: 1 })).toBe('1 jour');
    expect(i18n.t('ventes:stock.joursStock.valeur', { n: 12 })).toBe('12 jours');
  });

  it('n’affiche jamais la clé brute — un namespace non enregistré échouerait ici', () => {
    const rendu = i18n.t('ventes:titre');
    expect(rendu).not.toBe('ventes:titre');
    expect(i18n.exists('ventes:titre')).toBe(true);
  });
});
