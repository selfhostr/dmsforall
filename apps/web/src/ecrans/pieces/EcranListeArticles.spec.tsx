import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { PageCurseur, ReponseArticle } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
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
    { id: 'site-1', code: 'PRINCIPAL', nom: 'Site principal', actif: true },
    { id: 'site-2', code: 'SECONDAIRE', nom: 'Site secondaire', actif: true },
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

/** `FournisseurSiteCourant` monté explicitement — sans lui, `useSiteCourant()` dégrade vers
 *  « aucune préférence », ce que certains des tests ci-dessous veulent justement exercer (pas
 *  d'omission par accident : c'est le comportement par défaut hors fournisseur, testé aussi). */
function rendre(routeInitiale: string) {
  const queryClient = creerQueryClientTest();
  const ecran = (
    <MemoryRouter initialEntries={[routeInitiale]}>
      <Routes>
        <Route path="/pieces/articles" element={<EcranListeArticles />} />
      </Routes>
    </MemoryRouter>
  );
  // `FournisseurSiteCourant` DOIT être À L'INTÉRIEUR de `QueryClientProvider` : il lit
  // `useSession()`, qui exige un client React Query dans son arbre d'ancêtres.
  return render(
    <QueryClientProvider client={queryClient}>
      <FournisseurSiteCourant>{ecran}</FournisseurSiteCourant>
    </QueryClientProvider>,
  );
}

/**
 * DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut n°5) : la colonne « Disponible » affichait
 * « — » (inconnu) tant qu'AUCUN site n'était choisi dans le filtre LOCAL de cette liste — même
 * quand le sélecteur de site en haut de page (`?site=` de l'URL, ou la préférence mémorisée du
 * poste, `useSiteCourant`) portait déjà un site valide. Piège maison : absence de donnée ≠ valeur
 * — ces trois tests prouvent les TROIS rendus distincts (inconnue / zéro / valeur réelle), pilotés
 * par la PROPAGATION du site déjà choisi, jamais par le rendu du tiret lui-même.
 */
describe('EcranListeArticles — propagation du site déjà choisi vers la colonne « Disponible »', () => {
  it('quantité INCONNUE (« — ») : aucun site résolu nulle part (ni ?site= ni préférence), plusieurs sites actifs — jamais une valeur devinée', async () => {
    connecterSession(SESSION_DEUX_SITES);
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          pageArticles([
            article({
              stocksResume: [
                {
                  siteId: 'site-1',
                  quantitePhysiqueMillieme: 3000,
                  quantiteDisponibleMillieme: 3000,
                  emplacement: null,
                  rayon: null,
                  tiroir: null,
                },
              ],
            }),
          ]),
        ),
      ),
    );

    rendre('/pieces/articles');

    await screen.findByText('Plaquettes de frein avant');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('pieces:rechercheComptoir.resultat.disponible', { n: '3' })),
    ).not.toBeInTheDocument();
  });

  it('quantité ZÉRO (badge « Rupture », jamais « — ») : site déjà choisi via `?site=` de l’URL, stock disponible à 0 sur ce site', async () => {
    connecterSession(SESSION_DEUX_SITES);
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          pageArticles([
            article({
              stocksResume: [
                {
                  siteId: 'site-1',
                  quantitePhysiqueMillieme: 0,
                  quantiteDisponibleMillieme: 0,
                  emplacement: null,
                  rayon: null,
                  tiroir: null,
                },
              ],
            }),
          ]),
        ),
      ),
    );

    rendre('/pieces/articles?site=site-1');

    await screen.findByText('Plaquettes de frein avant');
    expect(
      screen.getByText(i18n.t('pieces:rechercheComptoir.resultat.rupture')),
    ).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('quantité RÉELLE (> 0) : AUCUN `?site=` dans l’URL, mais une préférence de site mémorisée du poste (`useSiteCourant`) — même résolution que l’en-tête (`EnTete.tsx`)', async () => {
    connecterSession(SESSION_DEUX_SITES);
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          pageArticles([
            article({
              stocksResume: [
                {
                  siteId: 'site-2',
                  quantitePhysiqueMillieme: 5000,
                  quantiteDisponibleMillieme: 5000,
                  emplacement: null,
                  rayon: null,
                  tiroir: null,
                },
              ],
            }),
          ]),
        ),
      ),
    );
    window.localStorage.setItem(`dfa.site-courant.${SESSION_DEUX_SITES.tenant.id}`, 'site-2');

    rendre('/pieces/articles');

    await screen.findByText('Plaquettes de frein avant');
    expect(
      await screen.findByText(i18n.t('pieces:rechercheComptoir.resultat.disponible', { n: '5' })),
    ).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();

    window.localStorage.clear();
  });

  it('un `siteId` de préférence qui ne correspond à AUCUN site de la session est traité comme une ABSENCE, jamais comme une valeur brute (même doctrine que `EnTete.tsx`)', async () => {
    connecterSession(SESSION_DEUX_SITES);
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          pageArticles([
            article({
              stocksResume: [
                {
                  siteId: 'site-1',
                  quantitePhysiqueMillieme: 3000,
                  quantiteDisponibleMillieme: 3000,
                  emplacement: null,
                  rayon: null,
                  tiroir: null,
                },
              ],
            }),
          ]),
        ),
      ),
    );
    window.localStorage.setItem(`dfa.site-courant.${SESSION_DEUX_SITES.tenant.id}`, 'site-fantome');

    rendre('/pieces/articles');

    await screen.findByText('Plaquettes de frein avant');
    expect(screen.getByText('—')).toBeInTheDocument();

    window.localStorage.clear();
  });
});
