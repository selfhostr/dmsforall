import { describe, expect, it } from 'vitest';

import { creerSessionTest } from '@/test/session';

import {
  peutVoirTousLesSites,
  resoudreChoixFiltre,
  resoudreSitePrincipal,
  TOUS_LES_SITES,
} from './sites';

const MART = { id: 'mart' };
const SION = { id: 'sion' };
const DEUX = [MART, SION];

function entree(surcharge: Partial<Parameters<typeof resoudreChoixFiltre>[0]> = {}) {
  return {
    sitesActifs: DEUX,
    tousSitesConnus: DEUX,
    sitePrincipalId: 'sion',
    tousAutorise: false,
    siteUrl: undefined,
    memorise: undefined,
    ...surcharge,
  };
}

describe('resoudreChoixFiltre', () => {
  it('par défaut : le site principal', () => {
    expect(resoudreChoixFiltre(entree())).toBe('sion');
  });

  it('un seul site actif : ce site, quoi qu’on ait mémorisé', () => {
    expect(
      resoudreChoixFiltre(entree({ sitesActifs: [MART], memorise: 'sion', siteUrl: 'sion' })),
    ).toBe('mart');
  });

  it('aucun site actif : aucun filtre', () => {
    expect(resoudreChoixFiltre(entree({ sitesActifs: [] }))).toBeUndefined();
  });

  it('choix mémorisé valide : prioritaire sur le site principal', () => {
    expect(resoudreChoixFiltre(entree({ memorise: 'mart' }))).toBe('mart');
  });

  it('choix mémorisé périmé : ignoré, retour au site principal', () => {
    expect(resoudreChoixFiltre(entree({ memorise: 'ferme' }))).toBe('sion');
  });

  it('« Tous » mémorisé : honoré seulement si les droits le permettent', () => {
    expect(resoudreChoixFiltre(entree({ memorise: TOUS_LES_SITES, tousAutorise: true }))).toBe(
      undefined,
    );
    expect(resoudreChoixFiltre(entree({ memorise: TOUS_LES_SITES, tousAutorise: false }))).toBe(
      'sion',
    );
  });

  it('lien profond ?site= : prioritaire, même vers un site désactivé connu de la session', () => {
    expect(resoudreChoixFiltre(entree({ siteUrl: 'mart', memorise: 'sion' }))).toBe('mart');
    expect(
      resoudreChoixFiltre(
        entree({ siteUrl: 'ferme', tousSitesConnus: [...DEUX, { id: 'ferme' }] }),
      ),
    ).toBe('ferme');
  });

  it('lien profond vers un site inconnu : ignoré (jamais une valeur brute)', () => {
    expect(resoudreChoixFiltre(entree({ siteUrl: 'inconnu' }))).toBe('sion');
  });

  it('sans site principal : « Tous » si permis, sinon le premier site actif', () => {
    expect(resoudreChoixFiltre(entree({ sitePrincipalId: undefined, tousAutorise: true }))).toBe(
      undefined,
    );
    expect(resoudreChoixFiltre(entree({ sitePrincipalId: undefined }))).toBe('mart');
  });
});

describe('peutVoirTousLesSites', () => {
  it('direction et comptable : oui', () => {
    expect(peutVoirTousLesSites(creerSessionTest('direction'))).toBe(true);
    expect(peutVoirTousLesSites(creerSessionTest('comptable'))).toBe(true);
  });

  it('magasinier, réceptionnaire, technicien : non', () => {
    expect(peutVoirTousLesSites(creerSessionTest('magasinier'))).toBe(false);
    expect(peutVoirTousLesSites(creerSessionTest('receptionnaire'))).toBe(false);
    expect(peutVoirTousLesSites(creerSessionTest('technicien'))).toBe(false);
  });

  it('pas de session : non', () => {
    expect(peutVoirTousLesSites(undefined)).toBe(false);
  });
});

describe('resoudreSitePrincipal', () => {
  const sites = [
    { id: 'mart', actif: true },
    { id: 'sion', actif: true },
    { id: 'ferme', actif: false },
  ];

  it('site principal actif : lui', () => {
    expect(resoudreSitePrincipal({ sites, sitePrincipalId: 'sion' } as never)).toBe('sion');
  });

  it('site principal désactivé ou absent avec plusieurs sites : rien (jamais un site inventé)', () => {
    expect(resoudreSitePrincipal({ sites, sitePrincipalId: 'ferme' } as never)).toBeUndefined();
    expect(resoudreSitePrincipal({ sites, sitePrincipalId: null } as never)).toBeUndefined();
  });

  it('garage à un seul site actif : ce site', () => {
    expect(
      resoudreSitePrincipal({
        sites: [{ id: 'mart', actif: true }],
        sitePrincipalId: null,
      } as never),
    ).toBe('mart');
  });
});
