import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { SESSION_TEST } from '@/test/msw/handlers';

import { resoudreLibelleSite } from './libelle-site';

describe('resoudreLibelleSite — fonction pure', () => {
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
