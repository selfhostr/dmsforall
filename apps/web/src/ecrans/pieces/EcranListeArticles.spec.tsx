import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { PageCurseur, ReponseArticle } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeArticles } from './EcranListeArticles';

const CHEMIN = '/api/v1/articles';

/** Session à DEUX sites actifs — le raccourci « un seul site actif -> auto-sélection » ne doit
 *  JAMAIS être ce qui explique un rendu correct dans ces tests : il isole la résolution
 *  URL/préférence (défaut n°5) de ce raccourci pré-existant (site unique). */
const SESSION_DEUX_SITES = {
  ...SESSION_TEST,
  sites: [
    { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
    { id: 'site-2', code: 'SECONDAIRE', codeCourt: 'SECON', nom: 'Site secondaire', actif: true },
  ],
};

function article(
  champs: Partial<ReponseArticle> & { readonly stocksResume: ReponseArticle['stocksResume'] },
): ReponseArticle {
  return {
    id: 'article-1',
    numeroArticle: 'P-000123',
    designation: 'Plaquettes de frein avant',
    marque: null,
    categorie: 'piece_mecanique',
    statut: 'actif',
    referencePrincipale: '1K0698151',
    codeBarres: null,
    prixAchatCentimes: null,
    prixVenteTtcCentimes: 8900,
    tauxTvaPourmille: 81,
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
    referenceRemplacementId: null,
    references: [],
    referencesTronquees: false,
    creeLe: '2026-01-01T08:00:00.000Z',
    modifieLe: '2026-01-01T08:00:00.000Z',
    ...champs,
  };
}

function pageArticles(donnees: readonly ReponseArticle[]): PageCurseur<ReponseArticle> {
  return { donnees, curseurSuivant: null, limite: 20 };
}

function connecterSession(session: typeof SESSION_TEST = SESSION_TEST) {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(session)));
}

function rendre(routeInitiale: string) {
  const queryClient = creerQueryClientTest();
  const ecran = (
    <MemoryRouter initialEntries={[routeInitiale]}>
      <Routes>
        <Route path="/pieces/articles" element={<EcranListeArticles />} />
      </Routes>
    </MemoryRouter>
  );
  return render(<QueryClientProvider client={queryClient}>{ecran}</QueryClientProvider>);
}

/**
 * DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut n°5) : la colonne « Disponible » affichait
 * « — » (inconnu) tant qu'AUCUN site n'était choisi dans le filtre LOCAL de cette liste — même
 * quand le sélecteur de site en haut de page (`?site=` de l'URL, ou la préférence mémorisée du
 * poste, `useSiteCourant`) portait déjà un site valide. Piège maison : absence de donnée ≠ valeur
 * — ces trois tests prouvent les TROIS rendus distincts (inconnue / zéro / valeur réelle), pilotés
 * par la PROPAGATION du site déjà choisi, jamais par le rendu du tiret lui-même.
 */
/**
 * Chantier « titres doublés & espacements » (contrat figé du 17.08.2026, §3) — « Articles »
 * (`pieces:articles.liste.titre`) est un doublon STRICT de l'onglet actif « Articles »
 * (`navigation-modele.ts`, `ONGLETS_PIECES`) et de sa vue « Tous » : `GabaritEcran` doit le
 * masquer visuellement (`sr-only`) sans le retirer du DOM — jamais une assertion affaiblie en
 * « le titre a disparu ».
 */
describe('EcranListeArticles — titre de page (doublon avec l’onglet « Articles »)', () => {
  it('le titre « Articles » reste dans le DOM mais est masqué visuellement (doublon avec l’onglet actif)', async () => {
    connecterSession(SESSION_TEST);
    server.use(http.get(CHEMIN, () => HttpResponse.json(pageArticles([]))));

    rendre('/pieces/articles');

    // La détection dépend du rôle en session (`useNavigationActive`, `role = session?.utilisateur.role`) —
    // le `<h1>` existe dès le premier rendu mais ne devient `sr-only` qu'après résolution de la
    // session (re-rendu). Ce screen ne pose ni `sousTitre` ni `actions` : `GabaritEcran` bascule
    // alors sur sa branche « anti-trou » quand le titre passe visible -> masqué, ce qui REMPLACE
    // le nœud `<h1>` (structure JSX différente) plutôt que de muter sa classe en place — une
    // référence DOM capturée avant ce basculement devient obsolète. On RE-INTERROGE le DOM à
    // chaque tentative de `waitFor`, jamais une référence figée avant la résolution de session.
    expect(
      screen.getByRole('heading', { level: 1, name: i18n.t('pieces:articles.liste.titre') }),
    ).toBeInTheDocument();
    // Décision produit (retour de recette) : un écran de liste affiche son titre, même s'il
    // répète l'onglet actif — jamais masqué.
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: i18n.t('pieces:articles.liste.titre') }),
      ).not.toHaveClass('sr-only');
    });
  });
});

function stock(siteId: string, quantiteMillieme: number) {
  return {
    siteId,
    quantitePhysiqueMillieme: quantiteMillieme,
    quantiteDisponibleMillieme: quantiteMillieme,
    emplacement: null,
    rayon: null,
    tiroir: null,
  };
}

function servirArticle(stocksResume: ReturnType<typeof stock>[]) {
  server.use(http.get(CHEMIN, () => HttpResponse.json(pageArticles([article({ stocksResume })]))));
}

function cleMemoire(session: typeof SESSION_DEUX_SITES) {
  return `dfa.filtre-site.${session.tenant.id}.${session.utilisateur.id}.pieces.articles`;
}

describe('EcranListeArticles — filtre de site local et colonne « Disponible »', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('quantité INCONNUE (« — ») : aucun site actif résolu — jamais une valeur devinée', async () => {
    connecterSession({
      ...SESSION_TEST,
      sites: SESSION_TEST.sites.map((site) => ({ ...site, actif: false })),
    });
    servirArticle([stock('site-1', 3000)]);

    rendre('/pieces/articles');

    await screen.findByText('Plaquettes de frein avant');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('pieces:rechercheComptoir.resultat.disponible', { n: '3' })),
    ).not.toBeInTheDocument();
  });

  it('quantité ZÉRO (badge « Rupture », jamais « — ») : site de l’URL, stock disponible à 0 sur ce site', async () => {
    connecterSession(SESSION_DEUX_SITES);
    servirArticle([stock('site-1', 0)]);

    rendre('/pieces/articles?site=site-1');

    await screen.findByText('Plaquettes de frein avant');
    expect(
      screen.getByText(i18n.t('pieces:rechercheComptoir.resultat.rupture')),
    ).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('par défaut : le SITE PRINCIPAL de la personne, sans rien choisir ni `?site=`', async () => {
    connecterSession({ ...SESSION_DEUX_SITES, sitePrincipalId: 'site-2' });
    servirArticle([stock('site-1', 3000), stock('site-2', 5000)]);

    rendre('/pieces/articles');

    await screen.findByText('Plaquettes de frein avant');
    expect(
      await screen.findByText(i18n.t('pieces:rechercheComptoir.resultat.disponible', { n: '5' })),
    ).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('le choix mémorisé pour cet écran l’emporte sur le site principal', async () => {
    const session = { ...SESSION_DEUX_SITES, sitePrincipalId: 'site-1' };
    connecterSession(session);
    servirArticle([stock('site-1', 3000), stock('site-2', 5000)]);
    window.localStorage.setItem(cleMemoire(session), 'site-2');

    rendre('/pieces/articles');

    expect(
      await screen.findByText(i18n.t('pieces:rechercheComptoir.resultat.disponible', { n: '5' })),
    ).toBeInTheDocument();
  });

  it('un site mémorisé qui n’existe plus est ignoré : retour au site principal, jamais une valeur brute', async () => {
    const session = { ...SESSION_DEUX_SITES, sitePrincipalId: 'site-1' };
    connecterSession(session);
    servirArticle([stock('site-1', 3000)]);
    window.localStorage.setItem(cleMemoire(session), 'site-fantome');

    rendre('/pieces/articles');

    expect(
      await screen.findByText(i18n.t('pieces:rechercheComptoir.resultat.disponible', { n: '3' })),
    ).toBeInTheDocument();
  });

  it('garage à deux sites : le filtre de site compact affiche les codes courts, sans « Tous » pour un rôle non autorisé', async () => {
    connecterSession({ ...SESSION_DEUX_SITES, sitePrincipalId: 'site-1' });
    servirArticle([stock('site-1', 3000)]);

    rendre('/pieces/articles');

    await screen.findByText('Plaquettes de frein avant');
    const filtre = await screen.findByRole('tablist', {
      name: i18n.t('commun:filtreSite.libelle'),
    });
    expect(within(filtre).getByRole('tab', { name: 'Site principal' })).toBeInTheDocument();
    expect(within(filtre).getByText('PRINC')).toBeInTheDocument();
    expect(within(filtre).getByText('SECON')).toBeInTheDocument();
    expect(within(filtre).queryByText(i18n.t('commun:filtreSite.tous'))).not.toBeInTheDocument();
  });

  it('direction : « Tous » est proposé et la colonne « Disponible » somme tous les sites', async () => {
    const session = {
      ...SESSION_DEUX_SITES,
      sitePrincipalId: 'site-1',
      utilisateur: { ...SESSION_DEUX_SITES.utilisateur, role: 'direction' as const },
    };
    connecterSession(session);
    servirArticle([stock('site-1', 3000), stock('site-2', 5000)]);
    window.localStorage.setItem(cleMemoire(session), 'tous');

    rendre('/pieces/articles');

    expect(
      await screen.findByText(i18n.t('pieces:rechercheComptoir.resultat.disponible', { n: '8' })),
    ).toBeInTheDocument();
    const filtre = await screen.findByRole('tablist', {
      name: i18n.t('commun:filtreSite.libelle'),
    });
    expect(within(filtre).getByText(i18n.t('commun:filtreSite.tous'))).toBeInTheDocument();
  });

  it('garage à un seul site : aucun filtre de site à l’écran', async () => {
    connecterSession(SESSION_TEST);
    servirArticle([stock('site-1', 3000)]);

    rendre('/pieces/articles');

    await screen.findByText('Plaquettes de frein avant');
    expect(screen.queryByTestId('filtre-site')).not.toBeInTheDocument();
  });
});
