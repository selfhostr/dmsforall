import { describe, expect, it } from 'vitest';

import { schemaLancerExport } from './export';
import { schemaApercuExport } from './export-fiduciaire';

/**
 * Issue #12, appliquée à `schemaLancerExport` (`.strict()`) : un export fiduciaire agrège des
 * montants réels vers Bexio/WinBIZ/Banana — un champ de filtrage mal nommé et silencieusement
 * ignoré (ex. un `site_id` mal casé) exporterait plus
 * de données que voulu sans avertir personne.
 */
describe('schemaLancerExport — champ inconnu REFUSÉ, nommé (issue #12, .strict())', () => {
  const CORPS_VALIDE = {
    cible: 'csv',
    periodeDu: '2026-01-01',
    periodeAu: '2026-01-31',
  };

  it('accepte un corps valide (non-régression)', () => {
    const resultat = schemaLancerExport.safeParse(CORPS_VALIDE);
    expect(resultat.success).toBe(true);
  });

  it('un nom de champ voisin mais faux (site_id, snake_case) est REFUSÉ', () => {
    const resultat = schemaLancerExport.safeParse({
      ...CORPS_VALIDE,
      site_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "site_id"');
  });
});

/**
 * Pas de filtre par site : la numérotation des factures/avoirs est par tenant et par exercice
 * (`compteur_document.site_id` toujours nul), donc la vérification de continuité l'est aussi. Un
 * `siteId` accepté puis ignoré exporterait tous les sites sans le dire : il est REFUSÉ, nommé.
 */
describe('export fiduciaire — pas de filtre par site (continuité de numérotation par tenant)', () => {
  const SITE = '11111111-1111-4111-8111-111111111111';

  it('POST : siteId refusé (unrecognized_keys)', () => {
    const resultat = schemaLancerExport.safeParse({
      cible: 'csv',
      periodeDu: '2026-01-01',
      periodeAu: '2026-01-31',
      siteId: SITE,
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "siteId"');
  });

  it('aperçu : siteId refusé (unrecognized_keys)', () => {
    const resultat = schemaApercuExport.safeParse({
      periodeDu: '2026-01-01',
      periodeAu: '2026-01-31',
      siteId: SITE,
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
  });
});
