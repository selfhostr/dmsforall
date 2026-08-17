import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PageCurseur, ReponseArticle, ResultatRechercheComptoirArticle } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranRechercheComptoirPieces } from './EcranRechercheComptoirPieces';

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const ARTICLE: ResultatRechercheComptoirArticle = {
  articleId: 'article-1',
  numeroArticle: 'P-000123',
  designation: 'Plaquettes de frein avant',
  referencePrincipale: '1K0698151',
  prixVenteTtcCentimes: 8900,
  quantiteDisponibleMillieme: 3000,
  emplacement: 'B3',
  rayon: null,
  tiroir: null,
  estEchangeStandard: false,
  montantConsigneTtcCentimes: null,
  statutSuivi: 'suivi',
};

function resultats(disponibleMillieme: number): readonly ResultatRechercheComptoirArticle[] {
  return [{ ...ARTICLE, quantiteDisponibleMillieme: disponibleMillieme }];
}

function resultatsAvecCasier(
  champs: Partial<ResultatRechercheComptoirArticle>,
): readonly ResultatRechercheComptoirArticle[] {
  return [{ ...ARTICLE, quantiteDisponibleMillieme: 3000, ...champs }];
}

/**
 * Article de catalogue (`GET /articles`, forme `ReponseArticle`) — matière première du mode
 * PARCOURS, distincte de `ResultatRechercheComptoirArticle` (mode recherche) : c'est
 * `versResultatParcours` (`useRechercheComptoirPieces.ts`) qui fait le pont entre les deux, d'où
 * deux fabriques de fixtures séparées ici plutôt qu'une seule réutilisée pour les deux modes.
 */
function articleCatalogue(
  partiel: Partial<ReponseArticle> & { readonly id: string; readonly designation: string },
): ReponseArticle {
  return {
    numeroArticle: 'P-000000',
    marque: null,
    categorie: 'piece_mecanique',
    statut: 'actif',
    referencePrincipale: '0000000',
    codeBarres: null,
    prixAchatCentimes: null,
    prixVenteTtcCentimes: 5000,
    tauxTvaPourmille: 81,
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
    referenceRemplacementId: null,
    references: [],
    referencesTronquees: false,
    stocksResume: [],
    creeLe: '2026-01-01T08:00:00.000Z',
    modifieLe: '2026-01-01T08:00:00.000Z',
    ...partiel,
  };
}

function pageArticles(donnees: readonly ReponseArticle[]): PageCurseur<ReponseArticle> {
  return { donnees, curseurSuivant: null, limite: 20 };
}

/**
 * Mode PARCOURS (`GET /articles`) sans handler explicite d'un test : catalogue vide par défaut.
 * SANS ce défaut, les six tests historiques (mode recherche pur, ils ne posent jamais de handler
 * `/articles`) échoueraient tous — le premier rendu de l'écran est TOUJOURS en mode parcours
 * (saisie vide), la requête part avant même la première frappe de `rechercher()`, et MSW sans
 * handler la fait échouer réseau -> `enErreur` -> l'écran entier bascule sur `EtatErreur`,
 * recherche comprise.
 *
 * Enregistré en `beforeEach`, PAS dans `rendre()` : MSW donne priorité au handler `use()` le plus
 * RÉCEMMENT ajouté. Un test qui veut son propre catalogue appelle `server.use(...)` avant
 * `rendre()` — si ce défaut était (re)posé à l'intérieur de `rendre()`, il serait ajouté APRÈS et
 * masquerait silencieusement le handler du test (constaté : trois tests parcours retombaient sur
 * « Aucun article. » malgré leur propre mock).
 */
beforeEach(() => {
  server.use(http.get('/api/v1/articles', () => HttpResponse.json(pageArticles([]))));
});

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'magasinier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/recherche-comptoir?site=site-1']}>
        <Routes>
          <Route path="/pieces/recherche-comptoir" element={<EcranRechercheComptoirPieces />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rechercher(terme = '1K0698151') {
  const champ = screen.getByRole('searchbox');
  await userEvent.type(champ, terme);
  // Anti-rebond de `useRechercheComptoirPieces` (300 ms) + résolution de la requête.
  await screen.findByText('Plaquettes de frein avant', {}, { timeout: 2000 });
}

/**
 * Chantier « titres doublés & espacements » (contrat figé du 17.08.2026, §3) — défaut cité
 * nommément par @laupernoe : « dans Comptoir, c'est écrit "Recherche comptoir" et du coup ça fait un
 * espace horrible ». « Recherche comptoir » (`pieces:rechercheComptoir.titre`) CONTIENT le
 * libellé de l'onglet actif « Comptoir » (`navigation-modele.ts`, `ONGLETS_PIECES`) —
 * `GabaritEcran` doit le masquer par inclusion, jamais le retirer du DOM.
 */
describe('EcranRechercheComptoirPieces — titre de page (doublon avec l’onglet « Comptoir »)', () => {
  it('le titre « Recherche comptoir » reste dans le DOM mais est masqué visuellement', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );
    rendre('magasinier');

    // La détection dépend du rôle en session (`useNavigationActive`) — le `<h1>` existe dès le
    // premier rendu mais ne devient `sr-only` qu'après résolution de la session (re-rendu). Cet
    // écran ne pose ni `sousTitre` ni `actions` sur `GabaritEcran` : la bascule visible -> masqué
    // fait passer par sa branche « anti-trou », qui REMPLACE le nœud `<h1>` (structure JSX
    // différente) au lieu de muter sa classe en place. On RE-INTERROGE le DOM à chaque tentative
    // de `waitFor`, jamais une référence figée avant la résolution de session.
    await screen.findByRole('heading', { level: 1, name: 'Recherche comptoir' });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Recherche comptoir' })).toHaveClass(
        'sr-only',
      );
    });
  });
});

describe('EcranRechercheComptoirPieces — actions de comptoir', () => {
  it('masque entièrement les actions « Vendre » et « Retour client » sans le droit pieces.mouvement.creer', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );
    // chef_atelier n'a PAS pieces.mouvement.creer (magasinier seul, §11).
    rendre('chef_atelier');
    await rechercher();

    expect(screen.queryByRole('button', { name: 'Vendre sans facture' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retour client' })).not.toBeInTheDocument();
  });

  it('un magasinier voit les actions et peut vendre une pièce au comptoir', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );
    rendre('magasinier');
    await rechercher();

    expect(screen.getByRole('button', { name: 'Vendre sans facture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retour client' })).toBeInTheDocument();
  });

  it('la vente sort la pièce (Idempotency-Key posée), le dialogue se ferme et la disponibilité affichée se rafraîchit', async () => {
    let requetesRecherche = 0;
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => {
        requetesRecherche += 1;
        // Premier appel (recherche initiale) : 3 en stock. Tout appel SUIVANT (déclenché par
        // l'invalidation après la vente) : 2 en stock — preuve que l'écran se rafraîchit sans
        // action manuelle du magasinier.
        return HttpResponse.json(resultats(requetesRecherche === 1 ? 3000 : 2000));
      }),
    );
    let cleRecue: string | null = null;
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', async ({ request }) => {
        cleRecue = request.headers.get('Idempotency-Key');
        return HttpResponse.json(
          {
            id: 'mvt-1',
            articleId: 'article-1',
            type: 'sortie_comptoir',
            quantiteMillieme: -1000,
            siteId: 'site-1',
            siteSourceId: null,
            siteDestinationId: null,
            prixAchatReelCentimes: null,
            auteurId: 'utilisateur-1',
            motif: null,
            ligneOrId: null,
            documentVenteLigneId: null,
            commandeFournisseurLigneId: null,
            inventaireReferenceId: null,
            reservationId: null,
            creeLe: '2026-08-05T09:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Vendre sans facture' }));
    expect(await screen.findByText('Sortie comptoir — sans facture')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sortir la pièce' }));

    await waitFor(() =>
      expect(screen.queryByText('Sortie comptoir — sans facture')).not.toBeInTheDocument(),
    );
    expect(cleRecue).not.toBeNull();
    await waitFor(() => expect(screen.getByText('2 en stock')).toBeInTheDocument());
  });

  /**
   * Défaut corrigé (rapport de test du 06.08.2026, n°3) : le montant affiché dans « Vendre sans
   * facture » restait figé au PRIX UNITAIRE (CHF 89.00 pour `ARTICLE`) quel que soit le nombre de
   * pièces saisi — un magasinier pressé pouvait croire qu'il vendait 2 pièces pour le prix d'une.
   * Le total DOIT suivre la quantité, et le prix unitaire doit rester lisible séparément.
   */
  it('« Vendre sans facture » : le total TTC suit la quantité saisie, le prix unitaire reste affiché à part', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Vendre sans facture' }));
    await screen.findByText('Sortie comptoir — sans facture');

    // Quantité par défaut (1) : prix unitaire et total TTC coïncident.
    expect(screen.getByText('Prix unitaire TTC')).toBeInTheDocument();
    expect(screen.getByText('Total TTC')).toBeInTheDocument();
    // `*` : champ obligatoire (`schemaQuantiteMillieme`) — `<Label requis>` ajoute l'étoile au
    // texte accessible du label (`getTextContent` ne filtre pas `aria-hidden`).
    const champQuantite = screen.getByLabelText('Quantité*');
    expect(champQuantite).toHaveValue('1');
    const zonePrixUnitaire = screen.getByText('Prix unitaire TTC').closest('div')!;
    const zoneTotal = screen.getByText('Total TTC').closest('div')!;
    expect(zonePrixUnitaire).toHaveTextContent('89.00');
    expect(zoneTotal).toHaveTextContent('89.00');

    // Quantité à 2 : le total se recalcule (178.00), le prix unitaire ne bouge pas (89.00).
    await userEvent.clear(champQuantite);
    await userEvent.type(champQuantite, '2');
    await waitFor(() => expect(zoneTotal).toHaveTextContent('178.00'));
    expect(zonePrixUnitaire).toHaveTextContent('89.00');
  });

  it('un refus pour stock insuffisant affiche combien il reste, pas « erreur 409 »', async () => {
    let requetesRecherche = 0;
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => {
        requetesRecherche += 1;
        // La recherche initiale annonçait 3 — le refus serveur simule une concurrence entre la
        // recherche et la confirmation ; le refetch après le refus révèle qu'il n'en reste qu'1.
        return HttpResponse.json(resultats(requetesRecherche === 1 ? 3000 : 1000));
      }),
    );
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/STOCK_INSUFFISANT',
            title: 'Stock insuffisant',
            status: 409,
            code: 'STOCK_INSUFFISANT',
            instance: 'req-1',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Vendre sans facture' }));
    await screen.findByText('Sortie comptoir — sans facture');
    await userEvent.click(screen.getByRole('button', { name: 'Sortir la pièce' }));

    // Le message métier dédié apparaît (jamais le texte générique d'erreur), et se corrige tout
    // seul dès que le rafraîchissement automatique révèle la quantité réelle.
    expect(await screen.findByText('Stock insuffisant : il reste 1 en stock.')).toBeInTheDocument();
    expect(screen.queryByText(/erreur/i, { selector: '[role="alert"]' })).not.toBeInTheDocument();
    // Le dialogue reste ouvert (le refus n'est pas traité comme un succès).
    expect(screen.getByText('Sortie comptoir — sans facture')).toBeInTheDocument();
  });

  it('un magasinier peut enregistrer un retour client', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );
    let corpsRecu: unknown;
    server.use(
      http.post('/api/v1/articles/:id/mouvements/retour-client', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(
          {
            id: 'mvt-retour-1',
            articleId: 'article-1',
            type: 'retour_client',
            quantiteMillieme: 1000,
            siteId: 'site-1',
            siteSourceId: null,
            siteDestinationId: null,
            prixAchatReelCentimes: null,
            auteurId: 'utilisateur-1',
            motif: 'Pièce non montée',
            ligneOrId: null,
            documentVenteLigneId: null,
            commandeFournisseurLigneId: null,
            inventaireReferenceId: null,
            reservationId: null,
            creeLe: '2026-08-05T09:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    rendre('magasinier');
    await rechercher();

    await userEvent.click(screen.getByRole('button', { name: 'Retour client' }));
    expect(await screen.findByRole('heading', { name: 'Retour client' })).toBeInTheDocument();

    // `*` : champ obligatoire (`schemaMotif`, `schemaCreationMouvementRetourClient`) —
    // `<Label requis>` ajoute l'étoile au texte accessible du label.
    const champMotif = screen.getByLabelText('Motif du retour*');
    await userEvent.type(champMotif, 'Pièce non montée');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le retour' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Retour client' })).not.toBeInTheDocument(),
    );
    expect(corpsRecu).toEqual({
      siteId: 'site-1',
      quantiteMillieme: 1000,
      motif: 'Pièce non montée',
    });
  });
});

describe('EcranRechercheComptoirPieces — emplacement complet (0056), trois rendus distincts', () => {
  it('aucun rayon, aucun tiroir, aucun texte libre : rien n’est affiché (jamais un tiret muet)', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(resultatsAvecCasier({ emplacement: null, rayon: null, tiroir: null })),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(screen.queryByText(/rayon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tiroir/i)).not.toBeInTheDocument();
  });

  it('texte libre seul (rayon et tiroir absents) : le texte libre est affiché tel quel', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(
          resultatsAvecCasier({ emplacement: 'étagère du fond', rayon: null, tiroir: null }),
        ),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(await screen.findByText('étagère du fond')).toBeInTheDocument();
  });

  it('casier structuré (rayon + tiroir), sans texte libre : « Rayon B3, tiroir 2 »', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(resultatsAvecCasier({ emplacement: null, rayon: 'B3', tiroir: '2' })),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(await screen.findByText('Rayon B3, tiroir 2')).toBeInTheDocument();
  });

  it('casier structuré ET texte libre en plus : les deux coexistent dans le même rendu', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () =>
        HttpResponse.json(
          resultatsAvecCasier({ emplacement: 'accès par le fond', rayon: 'B3', tiroir: '2' }),
        ),
      ),
    );
    rendre('magasinier');
    await rechercher();

    expect(await screen.findByText('Rayon B3, tiroir 2 — accès par le fond')).toBeInTheDocument();
  });
});

describe('EcranRechercheComptoirPieces — mode parcours (saisie vide)', () => {
  it("sans saisie, liste le catalogue actif du site trié par désignation — pas une case vide en attente d'une référence connue d'avance", async () => {
    let parametresRecus: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/articles', ({ request }) => {
        parametresRecus = new URL(request.url).searchParams;
        return HttpResponse.json(
          pageArticles([
            articleCatalogue({
              id: 'article-parcours-1',
              designation: 'Filtre à huile',
              referencePrincipale: 'OC90',
              stocksResume: [
                {
                  siteId: 'site-1',
                  quantitePhysiqueMillieme: 3500,
                  quantiteDisponibleMillieme: 3500,
                  emplacement: null,
                  rayon: null,
                  tiroir: null,
                },
              ],
            }),
            articleCatalogue({
              id: 'article-parcours-2',
              designation: "Bougie d'allumage",
              referencePrincipale: 'BOUG-4',
              // Jamais mouvementé sur ce site : absent de `stocksResume`, PAS une entrée à zéro —
              // `versResultatParcours` (useRechercheComptoirPieces.ts) doit quand même compter 0.
              stocksResume: [],
            }),
          ]),
        );
      }),
    );

    rendre('magasinier');

    expect(await screen.findByText('Filtre à huile')).toBeInTheDocument();
    expect(screen.getByText("Bougie d'allumage")).toBeInTheDocument();

    // Mêmes filtres que `rechercheComptoir` côté serveur (statut actif, tri désignation) — voir
    // l'en-tête d'`useRechercheComptoirPieces` : le mode parcours n'est pas une liste au hasard.
    expect(parametresRecus?.get('statut')).toBe('actif');
    expect(parametresRecus?.get('tri')).toBe('designation:asc');

    // Quantité convertie millièmes -> unités, jamais le brut (3500 -> "3.5 en stock").
    expect(screen.getByText('3.5 en stock')).toBeInTheDocument();
    // Stock jamais mouvementé sur ce site : rupture, exactement le même texte et la même
    // signification que "stock explicitement à 0" — doctrine partagée avec la colonne
    // « disponible » d'`EcranListeArticles` (rien à sortir aujourd'hui sur ce site).
    expect(screen.getByText('Rupture de stock')).toBeInTheDocument();
    // `emplacement`/`rayon`/`tiroir` (0056) SONT portés par `StockResumeArticle` depuis ce lot,
    // mais cette fixture ne les renseigne pas (`null`) : rien à afficher, jamais deviné.
    expect(screen.queryByText(/Rayon|Tiroir|Emplacement/)).not.toBeInTheDocument();
  });

  it('bascule en mode recherche dès la première frappe, puis revient au catalogue une fois le champ vidé', async () => {
    let appelsCatalogue = 0;
    server.use(
      http.get('/api/v1/articles', () => {
        appelsCatalogue += 1;
        return HttpResponse.json(
          pageArticles([
            articleCatalogue({ id: 'article-parcours-1', designation: 'Filtre à huile' }),
          ]),
        );
      }),
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats(3000))),
    );

    rendre('magasinier');
    expect(await screen.findByText('Filtre à huile')).toBeInTheDocument();
    const appelsAvantSaisie = appelsCatalogue;

    await rechercher();

    // Le résultat de recherche a remplacé la liste parcourue — jamais les deux mélangés.
    expect(screen.queryByText('Filtre à huile')).not.toBeInTheDocument();
    expect(screen.getByText('Plaquettes de frein avant')).toBeInTheDocument();
    // La frappe ne relance pas le catalogue : `charger` est désenclenché dès que le mode bascule
    // (`useRechercheComptoirPieces.ts`, `enParcours && siteId !== undefined ? … : undefined`).
    expect(appelsCatalogue).toBe(appelsAvantSaisie);

    await userEvent.clear(screen.getByRole('searchbox'));

    // Anti-rebond (300 ms) avant que `enParcours` ne redevienne vrai et que le catalogue reparaisse.
    await waitFor(() => expect(screen.getByText('Filtre à huile')).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.queryByText('Plaquettes de frein avant')).not.toBeInTheDocument();
  });

  it('distingue « catalogue vide » (mode parcours) de « aucun résultat pour cette recherche » (mode recherche) — jamais le même message pour les deux', async () => {
    server.use(
      http.get('/api/v1/articles', () => HttpResponse.json(pageArticles([]))),
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json([])),
    );

    rendre('magasinier');

    // Cas NOMINAL « le catalogue actif de ce site est vide » — pas une erreur, pas le message de
    // recherche sans résultat.
    expect(await screen.findByText('Aucun article au catalogue')).toBeInTheDocument();
    expect(
      screen.queryByText('Aucun article ne correspond à cette recherche sur ce site.'),
    ).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox'), 'référence introuvable');

    // Cas NOMINAL « rien ne correspond à cette recherche » — message dédié, distinct du précédent
    // (règle du dépôt : « on ne sait pas », « aucun » et « zéro » ne partagent jamais le même rendu).
    await waitFor(
      () =>
        expect(
          screen.getByText('Aucun article ne correspond à cette recherche sur ce site.'),
        ).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.queryByText('Aucun article au catalogue')).not.toBeInTheDocument();
  });

  it('« Charger plus » charge la page suivante du catalogue par curseur, en accumulant sur la première page', async () => {
    server.use(
      http.get('/api/v1/articles', ({ request }) => {
        const curseur = new URL(request.url).searchParams.get('curseur');
        if (!curseur) {
          return HttpResponse.json({
            donnees: [articleCatalogue({ id: 'article-page-1', designation: 'Filtre à huile' })],
            curseurSuivant: 'curseur-page-2',
            limite: 20,
          });
        }
        return HttpResponse.json(
          pageArticles([articleCatalogue({ id: 'article-page-2', designation: 'Filtre à air' })]),
        );
      }),
    );

    rendre('magasinier');
    expect(await screen.findByText('Filtre à huile')).toBeInTheDocument();
    expect(screen.queryByText('Filtre à air')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Charger plus' }));

    expect(await screen.findByText('Filtre à air')).toBeInTheDocument();
    // Accumulation, pas remplacement (même contrat que `useListeCurseur` partout ailleurs).
    expect(screen.getByText('Filtre à huile')).toBeInTheDocument();
  });
});
