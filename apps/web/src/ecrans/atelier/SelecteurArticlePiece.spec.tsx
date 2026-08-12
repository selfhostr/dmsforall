import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseArticle, ResultatRechercheComptoirArticle } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { SelecteurArticlePiece } from './SelecteurArticlePiece';

const SITE_ID = '33333333-3333-3333-8333-333333333333';

const PLAQUETTES: ResultatRechercheComptoirArticle = {
  articleId: 'article-plaquettes',
  numeroArticle: 'A-0001',
  designation: 'Plaquettes avant',
  referencePrincipale: 'REF-PLAQ-1',
  prixVenteTtcCentimes: 6850,
  quantiteDisponibleMillieme: 3000,
  statutSuivi: 'suivi',
  emplacement: 'A-12',
  estEchangeStandard: false,
  montantConsigneTtcCentimes: null,
};

function mockRechercheComptoir(resultats: readonly ResultatRechercheComptoirArticle[]) {
  server.use(http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(resultats)));
}

function articleCatalogue(
  partiel: Partial<ReponseArticle> & { readonly id: string },
): ReponseArticle {
  return {
    numeroArticle: 'P-000000',
    designation: 'Article catalogue',
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

/** Mode PARCOURS (`GET /articles`) : catalogue vide par défaut tant qu'un test ne mocke pas
 *  explicitement autre chose — même raison que `useRechercheComptoirPieces.spec.tsx` (saisie vide
 *  dès le premier rendu, avant toute frappe). `server.use()` donne priorité au handler le plus
 *  récemment enregistré, donc ce défaut doit être posé AVANT le `server.use()` propre à chaque
 *  test pour ne jamais le masquer. */
beforeEach(() => {
  server.use(http.get('/api/v1/articles', () => HttpResponse.json(pageArticles([]))));
});

describe('SelecteurArticlePiece', () => {
  it('parcours du catalogue avant toute recherche — jamais "aucun résultat" pour un catalogue non vide', async () => {
    server.use(
      http.get('/api/v1/articles', () =>
        HttpResponse.json(pageArticles([articleCatalogue({ id: 'art-catalogue' })])),
      ),
    );
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <SelecteurArticlePiece id="a" siteId={SITE_ID} onSelectionArticle={vi.fn()} />,
    );

    await utilisateur.click(
      screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' }),
    );

    const popover = within(await screen.findByRole('dialog'));
    // Légende du mode parcours, via sa clé i18n (résout le changement de vocabulaire).
    const texteAideParcours = i18n.t('or:lignes.selecteurArticle.parcours.aide');
    expect(
      await popover.findByText(
        new RegExp(texteAideParcours.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ),
    ).toBeInTheDocument();
    // Le catalogue est bien affiché : au moins une option visible.
    expect(await popover.findByRole('option', { name: /Article catalogue/ })).toBeInTheDocument();
    expect(popover.queryByText(/Aucun article ne correspond/)).not.toBeInTheDocument();
  });

  it('catalogue vide sur ce site : invite explicitement à saisir la pièce à la main', async () => {
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <SelecteurArticlePiece id="a" siteId={SITE_ID} onSelectionArticle={vi.fn()} />,
    );

    await utilisateur.click(
      screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' }),
    );

    const popover = within(await screen.findByRole('dialog'));
    const texteVideParcours = i18n.t('or:lignes.selecteurArticle.parcours.vide');
    expect(
      await popover.findByText(
        new RegExp(texteVideParcours.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ),
    ).toBeInTheDocument();
    expect(popover.queryByText(/Aucun article ne correspond/)).not.toBeInTheDocument();
  });

  it('affiche les suggestions du magasin et permet de choisir au clic — reprend référence/désignation/prix', async () => {
    mockRechercheComptoir([PLAQUETTES]);
    const utilisateur = userEvent.setup();
    const onSelectionArticle = vi.fn();
    renduAvecQueryClient(
      <SelecteurArticlePiece id="a" siteId={SITE_ID} onSelectionArticle={onSelectionArticle} />,
    );

    const champ = screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' });
    await utilisateur.type(champ, 'plaq');

    const option = await screen.findByRole('option', { name: /Plaquettes avant/ });
    expect(within(option).getByText('REF-PLAQ-1')).toBeInTheDocument();
    expect(within(option).getByText(/68.50/)).toBeInTheDocument();
    // Disponibilité visible AU MOMENT DU CHOIX, directement dans la suggestion — pas seulement
    // après sélection (constat terrain).
    expect(within(option).getByText('3 disponible(s) à ce site.')).toBeInTheDocument();

    await utilisateur.click(option);

    expect(onSelectionArticle).toHaveBeenCalledWith(PLAQUETTES);
    // La recherche se vide après sélection — un raccourci PONCTUEL, jamais un champ qui reste
    // « occupé » par le dernier choix.
    expect(champ).toHaveValue('');
  });

  it('navigation clavier complète : Flèche bas puis Entrée sélectionne la suggestion active', async () => {
    mockRechercheComptoir([PLAQUETTES]);
    const utilisateur = userEvent.setup();
    const onSelectionArticle = vi.fn();
    renduAvecQueryClient(
      <SelecteurArticlePiece id="a" siteId={SITE_ID} onSelectionArticle={onSelectionArticle} />,
    );

    const champ = screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' });
    await utilisateur.type(champ, 'plaq');
    await screen.findByRole('option', { name: /Plaquettes avant/ });

    await utilisateur.keyboard('{ArrowDown}');
    await utilisateur.keyboard('{Enter}');

    expect(onSelectionArticle).toHaveBeenCalledWith(PLAQUETTES);
  });

  it('distingue "suivi nulle part" de "aucune" DANS la suggestion — jamais le même texte pour les deux', async () => {
    const JAMAIS_SUIVI: ResultatRechercheComptoirArticle = {
      ...PLAQUETTES,
      articleId: 'article-jamais-suivi',
      quantiteDisponibleMillieme: 0,
      statutSuivi: 'nonSuiviNullePart',
    };
    mockRechercheComptoir([JAMAIS_SUIVI]);
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <SelecteurArticlePiece id="a" siteId={SITE_ID} onSelectionArticle={vi.fn()} />,
    );

    await utilisateur.type(
      screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' }),
      'plaq',
    );

    const option = await screen.findByRole('option', { name: /Plaquettes avant/ });
    expect(
      within(option).getByText(
        "Cette pièce n'est suivie dans aucun site du magasin — jamais reçue en stock.",
      ),
    ).toBeInTheDocument();
    expect(
      within(option).queryByText('Aucune actuellement disponible à ce site.'),
    ).not.toBeInTheDocument();
  });

  it('aucun résultat : invite explicitement à saisir la pièce à la main, jamais un blocage', async () => {
    mockRechercheComptoir([]);
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <SelecteurArticlePiece id="a" siteId={SITE_ID} onSelectionArticle={vi.fn()} />,
    );

    await utilisateur.type(
      screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' }),
      'introuvable',
    );

    const popover = within(await screen.findByRole('dialog'));
    const texteAucunResultat = i18n.t('or:lignes.selecteurArticle.aucunResultat');
    expect(
      await popover.findByText(
        new RegExp(texteAucunResultat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ),
    ).toBeInTheDocument();
  });

  it('panne réseau : message actionnable avec un Réessayer qui relance réellement la requête', async () => {
    // Mode PARCOURS toujours en succès dans ce test — seule la recherche assistée est en panne.
    // Sans ce mock, le mode parcours (actif au montage, saisie vide) échouerait lui aussi et
    // afficherait SON propre bouton « Réessayer » (jamais lié à `recherche-comptoir`), rendant le
    // test ambigu sur lequel des deux boutons il attrape.
    server.use(
      http.get('/api/v1/articles', () =>
        HttpResponse.json(pageArticles([articleCatalogue({ id: 'art-parcours-ok' })])),
      ),
    );
    let appels = 0;
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => {
        appels += 1;
        if (appels === 1) return HttpResponse.error();
        return HttpResponse.json([PLAQUETTES]);
      }),
    );
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <SelecteurArticlePiece id="a" siteId={SITE_ID} onSelectionArticle={vi.fn()} />,
    );

    await utilisateur.type(
      screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' }),
      'plaq',
    );

    const bouton = await screen.findByRole('button', { name: 'Réessayer' });
    // Un seul bouton « Réessayer » à cet instant (mode recherche, en erreur) — le mode parcours,
    // mocké en succès ci-dessus, n'en affiche aucun.
    expect(screen.getAllByRole('button', { name: 'Réessayer' })).toHaveLength(1);
    await utilisateur.click(bouton);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Plaquettes avant/ })).toBeInTheDocument();
    });
  });
});
