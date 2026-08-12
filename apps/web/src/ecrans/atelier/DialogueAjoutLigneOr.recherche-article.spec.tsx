import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseArticle, ResultatRechercheComptoirArticle } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { DialogueAjoutLigneOr } from './DialogueAjoutLigneOr';

/**
 * Correctif terrain (`DialogueAjoutLigneOr`, ligne « pièce ») : reprendre un article du magasin
 * au lieu de tout retaper — référence/désignation/prix HT préremplis, disponibilité en trois états
 * (`statutSuivi`, `@dfa/shared`) visible AU MOMENT DU CHOIX, jamais de perte de la saisie manuelle.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const OR_ID = '44444444-4444-4444-8444-444444444444';
const SITE_ID = '55555555-5555-5555-8555-555555555555';
const ARTICLE_ID = '66666666-6666-6666-8666-666666666666';

function resultatRecherche(
  statutSuivi: ResultatRechercheComptoirArticle['statutSuivi'],
  quantiteDisponibleMillieme = 0,
): ResultatRechercheComptoirArticle {
  return {
    articleId: ARTICLE_ID,
    numeroArticle: 'A-0042',
    designation: 'Plaquettes de frein avant',
    referencePrincipale: 'REF-4242',
    prixVenteTtcCentimes: 6850,
    quantiteDisponibleMillieme,
    statutSuivi,
    emplacement: 'A-12',
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
  };
}

function articleComplet(): ReponseArticle {
  return {
    id: ARTICLE_ID,
    numeroArticle: 'A-0042',
    designation: 'Plaquettes de frein avant',
    marque: null,
    categorie: 'piece_mecanique',
    statut: 'actif',
    referencePrincipale: 'REF-4242',
    codeBarres: null,
    prixAchatCentimes: null,
    prixVenteTtcCentimes: 6850,
    tauxTvaPourmille: 81,
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
    referenceRemplacementId: null,
    references: [],
    referencesTronquees: false,
    stocksResume: [],
    creeLe: '2026-01-01T00:00:00.000Z',
    modifieLe: '2026-01-01T00:00:00.000Z',
  };
}

function mockRecherche(resultat: ResultatRechercheComptoirArticle) {
  server.use(
    http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json([resultat])),
    http.get(`/api/v1/articles/${ARTICLE_ID}`, () => HttpResponse.json(articleComplet())),
  );
}

async function ouvrirEnTypePiece(utilisateur: ReturnType<typeof userEvent.setup>) {
  renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} siteId={SITE_ID} />);
  await utilisateur.click(screen.getByRole('button', { name: i18n.t('or:lignes.ajouter') }));
  await screen.findByRole('dialog');

  await utilisateur.click(screen.getByRole('combobox', { name: 'Type' }));
  await utilisateur.click(
    await screen.findByRole('option', { name: i18n.t('or:lignes.types.piece') }),
  );
}

async function choisirLaPiece(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.type(
    screen.getByRole('combobox', { name: 'Chercher une pièce au magasin' }),
    'plaquettes',
  );
  await utilisateur.click(await screen.findByRole('option', { name: /Plaquettes de frein avant/ }));
}

describe('DialogueAjoutLigneOr — reprendre une pièce du magasin au lieu de tout retaper', () => {
  it('choisir un article préremplit référence/désignation et le prix HT converti depuis le TTC catalogue', async () => {
    mockRecherche(resultatRecherche('suivi', 3000));
    const utilisateur = userEvent.setup();
    await ouvrirEnTypePiece(utilisateur);
    await choisirLaPiece(utilisateur);

    expect(screen.getByLabelText(/Désignation/)).toHaveValue('Plaquettes de frein avant');
    expect(screen.getByLabelText('Référence')).toHaveValue('REF-4242');

    // Disponibilité visible IMMÉDIATEMENT (`statutSuivi` déjà porté par le résultat de recherche,
    // aucune requête supplémentaire nécessaire pour ce chiffre).
    expect(await screen.findByText('3 disponible(s) à ce site.')).toBeInTheDocument();

    // 6850 * 1000 / 1081 = 6336.72... -> 6337 centimes -> "63.37" — jamais une copie brute du TTC.
    await waitFor(() => {
      expect(screen.getByLabelText(/Prix unitaire HT/)).toHaveValue('63.37');
    });
  });

  it('« aucune » (suivi ici, épuisé) se distingue clairement de « suivi nulle part »', async () => {
    mockRecherche(resultatRecherche('suivi', 0));
    const utilisateur = userEvent.setup();
    await ouvrirEnTypePiece(utilisateur);
    await choisirLaPiece(utilisateur);

    expect(
      await screen.findByText('Aucune actuellement disponible à ce site.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/jamais reçue en stock/)).not.toBeInTheDocument();
    expect(screen.queryByText(/suivie ailleurs/)).not.toBeInTheDocument();
  });

  it('« suivi nulle part » (jamais reçu au magasin) se distingue clairement de « aucune »', async () => {
    mockRecherche(resultatRecherche('nonSuiviNullePart', 0));
    const utilisateur = userEvent.setup();
    await ouvrirEnTypePiece(utilisateur);
    await choisirLaPiece(utilisateur);

    expect(
      await screen.findByText(
        "Cette pièce n'est suivie dans aucun site du magasin — jamais reçue en stock.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Aucune actuellement disponible à ce site.')).not.toBeInTheDocument();
  });

  it('« suivi ailleurs, pas sur ce site » se distingue des deux autres refus', async () => {
    mockRecherche(resultatRecherche('nonSuiviSurCeSite', 0));
    const utilisateur = userEvent.setup();
    await ouvrirEnTypePiece(utilisateur);
    await choisirLaPiece(utilisateur);

    expect(
      await screen.findByText(
        'Ce site ne suit pas cette pièce en stock — elle est suivie ailleurs.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/jamais reçue en stock/)).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune actuellement disponible à ce site.')).not.toBeInTheDocument();
  });

  it('la saisie manuelle reste intacte et éditable : corriger le prix prérempli ne se refait pas écraser', async () => {
    mockRecherche(resultatRecherche('suivi', 3000));
    const utilisateur = userEvent.setup();
    await ouvrirEnTypePiece(utilisateur);
    await choisirLaPiece(utilisateur);

    const champPrix = await screen.findByLabelText(/Prix unitaire HT/);
    await waitFor(() => expect(champPrix).toHaveValue('63.37'));

    await utilisateur.clear(champPrix);
    await utilisateur.type(champPrix, '50.00');

    expect(champPrix).toHaveValue('50.00');
  });

  it("« Chercher une autre pièce » dissocie l'article sans vider les champs déjà repris", async () => {
    mockRecherche(resultatRecherche('suivi', 3000));
    const utilisateur = userEvent.setup();
    await ouvrirEnTypePiece(utilisateur);
    await choisirLaPiece(utilisateur);

    await screen.findByText('3 disponible(s) à ce site.');
    await utilisateur.click(screen.getByRole('button', { name: 'Chercher une autre pièce' }));

    expect(screen.queryByText('3 disponible(s) à ce site.')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Désignation/)).toHaveValue('Plaquettes de frein avant');
    expect(screen.getByLabelText('Référence')).toHaveValue('REF-4242');
  });

  it('envoie `articleId` au serveur pour une ligne pièce choisie au magasin', async () => {
    mockRecherche(resultatRecherche('suivi', 3000));

    let corpsRecu: unknown;
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(
          { donnees: { id: 'ligne-1' }, avertissements: [] },
          { status: 201 },
        );
      }),
    );

    const utilisateur = userEvent.setup();
    await ouvrirEnTypePiece(utilisateur);
    await choisirLaPiece(utilisateur);
    await waitFor(() => expect(screen.getByLabelText(/Prix unitaire HT/)).toHaveValue('63.37'));

    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => {
      expect(corpsRecu).toMatchObject({ articleId: ARTICLE_ID, type: 'piece' });
    });
  });

  it("le bouton Confirmer indique qu'il travaille pendant l'envoi, sans jamais changer de libellé", async () => {
    server.use(
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(
          { donnees: { id: 'ligne-1' }, avertissements: [] },
          { status: 201 },
        );
      }),
    );
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(<DialogueAjoutLigneOr orId={OR_ID} siteId={SITE_ID} />);
    await utilisateur.click(screen.getByRole('button', { name: i18n.t('or:lignes.ajouter') }));
    await screen.findByRole('dialog');
    await utilisateur.type(screen.getByLabelText(/Désignation/), 'Diagnostic électrique');

    const boutonConfirmer = screen.getByRole('button', { name: 'Confirmer' });
    await utilisateur.click(boutonConfirmer);

    expect(boutonConfirmer).toHaveAttribute('aria-busy', 'true');
    expect(boutonConfirmer).toBeDisabled();
    expect(boutonConfirmer).toHaveTextContent('Confirmer');
  });
});
