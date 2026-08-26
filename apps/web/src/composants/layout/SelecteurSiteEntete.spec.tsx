import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import type { SessionCourante } from '@dfa/shared';

import { SelecteurSiteEntete } from './SelecteurSiteEntete';

/**
 * Lot « bandeau haut » (26.08.2026) — ce fichier existait en référence dans la doc de tête de
 * `BarreLaterale.spec.tsx` (« le multi-site est déjà couvert par `SelecteurSiteEntete.spec.tsx` »)
 * sans jamais avoir été écrit : dette de documentation comblée ICI, à l'occasion du déménagement du
 * composant vers `BarreOutilsSuperieure.tsx` et de la correction de son défaut mesuré n°2 (collision
 * de libellé « Aucun site choisi » / « Tous les sites » pour le même état `siteIdActif undefined`).
 *
 * `useSiteCourant` est MOCKÉ (pas de `FournisseurSiteCourant`/session réelle) : ce composant ne
 * lit que `definirPreferenceSite`, jamais `preferenceSiteId` — un test isolé, sans réseau, suffit à
 * prouver qu'il est appelé avec le bon site au clic.
 */
const { definirPreferenceSiteMock } = vi.hoisted(() => ({ definirPreferenceSiteMock: vi.fn() }));
vi.mock('@/hooks/site/ContexteSiteCourant', () => ({
  useSiteCourant: () => ({
    preferenceSiteId: undefined,
    definirPreferenceSite: definirPreferenceSiteMock,
  }),
}));

function site(
  id: string,
  code: string,
  nom: string,
  actif = true,
): SessionCourante['sites'][number] {
  return { id, code, nom, actif };
}

const SITE_UNIQUE = [site('site-1', 'PRINCIPAL', 'Site principal')];
const DEUX_SITES = [site('site-1', 'MTG', 'Garage Martigny'), site('site-2', 'SIO', 'Garage Sion')];

function rendre(props: {
  sites: SessionCourante['sites'];
  siteIdActif: string | undefined;
  libelle: string;
  compact?: boolean;
}) {
  return render(
    <MemoryRouter initialEntries={['/clients']}>
      <SelecteurSiteEntete {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  definirPreferenceSiteMock.mockClear();
});

/**
 * DÉFAUT MESURÉ n°2, corrigé ICI : `siteIdActif === undefined` (« tous les sites », état légitime,
 * le même que celui du filtre local du tableau de bord) NE doit PLUS recevoir la même mise en
 * avant visuelle qu'une VRAIE anomalie (un identifiant présent mais qui ne correspond à aucun site
 * connu — lien obsolète, site renommé/supprimé). Un seul site actif : rendu non interactif (`<p>`),
 * seul cas où la distinction est observable sans dérouler un menu.
 */
describe('SelecteurSiteEntete — distinction « tous les sites » / site inconnu (site unique)', () => {
  it('site résolu et connu : rendu discret (couleur atténuée du chrome)', () => {
    rendre({ sites: SITE_UNIQUE, siteIdActif: 'site-1', libelle: 'Site principal' });

    const paragraphe = screen.getByText('Site principal').closest('p');
    expect(paragraphe?.className).toContain('text-muted-foreground');
    expect(paragraphe?.className).not.toContain('text-foreground');
  });

  it('« tous les sites » (siteIdActif undefined) : reste discret, ce n’est PAS une anomalie', () => {
    rendre({ sites: SITE_UNIQUE, siteIdActif: undefined, libelle: 'Tous les sites' });

    const paragraphe = screen.getByText('Tous les sites').closest('p');
    expect(paragraphe?.className).toContain('text-muted-foreground');
    expect(paragraphe?.className).not.toContain('font-medium text-foreground');
  });

  it('site inconnu (identifiant présent, absent de la session) : seul ce cas reste mis en avant', () => {
    rendre({ sites: SITE_UNIQUE, siteIdActif: 'site-supprime', libelle: 'Aucun site choisi' });

    const paragraphe = screen.getByText('Aucun site choisi').closest('p');
    expect(paragraphe?.className).toContain('font-medium');
    expect(paragraphe?.className).toContain('text-foreground');
  });

  it('compact : code court affiché pour un site connu, em-dash pour « tous »/inconnu, libellé complet en sr-only', () => {
    const { rerender } = rendre({
      sites: SITE_UNIQUE,
      siteIdActif: 'site-1',
      libelle: 'Site principal',
      compact: true,
    });
    expect(screen.getByText('PRINCIPAL')).toBeInTheDocument();
    expect(screen.getByText('Site principal')).toHaveClass('sr-only');

    rerender(
      <MemoryRouter initialEntries={['/clients']}>
        <SelecteurSiteEntete
          sites={SITE_UNIQUE}
          siteIdActif={undefined}
          libelle="Tous les sites"
          compact
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Tous les sites')).toHaveClass('sr-only');
  });
});

/**
 * MULTI-SITE — dropdown de changement de site. Comportement PRÉ-EXISTANT (non touché par ce lot),
 * revérifié ici pour combler l'absence de couverture directe de ce composant.
 */
describe('SelecteurSiteEntete — dropdown multi-site', () => {
  it('liste les sites ACTIFS différents du site courant, mémorise le choix au clic', async () => {
    const utilisateur = userEvent.setup();
    rendre({ sites: DEUX_SITES, siteIdActif: 'site-1', libelle: 'Garage Martigny' });

    await utilisateur.click(screen.getByRole('button', { name: /garage martigny/i }));
    const optionSion = await screen.findByRole('menuitem', { name: /garage sion/i });
    expect(screen.queryByRole('menuitem', { name: /garage martigny/i })).not.toBeInTheDocument();

    await utilisateur.click(optionSion);
    expect(definirPreferenceSiteMock).toHaveBeenCalledExactlyOnceWith('site-2');
  });

  it('un seul site ACTIF (le second est inactif) : aucun menu, rendu texte simple', () => {
    rendre({
      sites: [
        site('site-1', 'MTG', 'Garage Martigny'),
        site('site-2', 'SIO', 'Garage Sion', false),
      ],
      siteIdActif: 'site-1',
      libelle: 'Garage Martigny',
    });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Garage Martigny')).toBeInTheDocument();
  });
});
