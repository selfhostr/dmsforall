import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseArticle, ResultatRechercheComptoirArticle } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { DialogueAjoutLigneOr } from './DialogueAjoutLigneOr';

/**
 * Correctif terrain (`DialogueAjoutLigneOr`, ligne « pièce ») : reprendre un article du magasin
 * au lieu de tout retaper — référence/désignation/prix HT préremplis, disponibilité en trois états
 * (`statutSuivi`, `@dfa/shared`) visible AU MOMENT DU CHOIX, jamais de perte de la saisie manuelle.
 */
beforeAll(() => {
  // Radix Select appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom.
  // (`ResizeObserver`, requis par `SelectTrigger` via `useSize`, est stubé globalement dans
  // `test/setup.ts` — plus besoin de copie locale ici.)
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
    // Casier structuré (0056) : cette fixture ne pose pas de rayon/tiroir, donc `null` — jamais
    // une valeur inventée qui ferait passer pour testé un rendu de casier structuré qui ne l'est
    // pas (« absence de donnée ≠ valeur »).
    rayon: null,
    tiroir: null,
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
    // Issue #71 : le raccourci catalogue (`SelecteurArticlePiece`) n'est proposé qu'à un rôle qui
    // lit effectivement le catalogue pièces (`peutRechercherArticlePiece`, `ecrans/atelier/droits.ts`)
    // — sans session authentifiée ici, le handler par défaut (401 sur `/auth/moi`) le masquerait
    // pour tous ces scénarios. `chef_atelier` (`SESSION_TEST`) fait partie de `ROLES_PIECES`.
    http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
    http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json([resultat])),
    http.get(`/api/v1/articles/${ARTICLE_ID}`, () => HttpResponse.json(articleComplet())),
    // Mode PARCOURS du sélecteur (`SelecteurArticlePiece`, `GET /articles`, saisie vide au
    // montage) : catalogue vide par défaut, sans incidence sur ces tests qui tapent une saisie
    // immédiatement via `choisirLaPiece` — mais nécessaire pour que ce mode n'échoue jamais en
    // réseau (sinon un bouton « Réessayer » parasite apparaîtrait avant la frappe).
    http.get('/api/v1/articles', () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 }),
    ),
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
  // `findByRole` (pas `getByRole`) : le champ de recherche ne s'affiche qu'une fois la session
  // résolue (`useSession`, issue #71 — le raccourci catalogue est masqué à un rôle qui ne lit pas
  // le catalogue pièces) — dans ce test isolé, sans le parent qui la préchargerait déjà, la
  // première frappe possible n'est jamais synchrone.
  await utilisateur.type(
    await screen.findByRole('combobox', { name: 'Chercher une pièce au magasin' }),
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

describe("DialogueAjoutLigneOr — issue #71 : un rôle qui ne lit pas le catalogue pièces (`admin`) n'a jamais le raccourci", () => {
  it('admin ne voit pas le champ de recherche magasin, mais crée quand même une ligne pièce à la main', async () => {
    let corpsRecu: unknown;
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'admin' },
        }),
      ),
      http.post(`/api/v1/ordres-reparation/${OR_ID}/lignes`, async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(
          { donnees: { id: 'ligne-1' }, avertissements: [] },
          { status: 201 },
        );
      }),
    );

    const utilisateur = userEvent.setup();
    const { queryClient } = renduAvecQueryClient(
      <DialogueAjoutLigneOr orId={OR_ID} siteId={SITE_ID} />,
    );
    await utilisateur.click(screen.getByRole('button', { name: i18n.t('or:lignes.ajouter') }));
    await screen.findByRole('dialog');
    await utilisateur.click(screen.getByRole('combobox', { name: 'Type' }));
    await utilisateur.click(
      await screen.findByRole('option', { name: i18n.t('or:lignes.types.piece') }),
    );

    // Attend que `useSession` soit RÉELLEMENT résolue (pas seulement « pas encore montée ») avant
    // de constater l'absence — sinon ce test réussirait aussi bien si le raccourci apparaissait
    // simplement en retard (défaut différent, jamais celui qu'on veut prouver ici).
    await waitFor(() => {
      expect(queryClient.getQueryState(clesQuery.session())?.status).toBe('success');
    });
    expect(
      screen.queryByRole('combobox', { name: 'Chercher une pièce au magasin' }),
    ).not.toBeInTheDocument();

    // La saisie manuelle — seul chemin qui reste pour ce rôle — fonctionne intégralement.
    await utilisateur.type(screen.getByLabelText(/Désignation/), 'Ampoule feu de croisement');
    await utilisateur.type(screen.getByLabelText('Référence'), 'REF-9000');
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => {
      expect(corpsRecu).toMatchObject({
        type: 'piece',
        designation: 'Ampoule feu de croisement',
        referenceTexte: 'REF-9000',
      });
    });
    // Pas de lien catalogue : `articleId` est absent du corps JSON envoyé (jamais deviné, jamais
    // celui d'un précédent choix qu'un rôle sans accès au raccourci n'a jamais pu faire).
    expect(corpsRecu).not.toHaveProperty('articleId');
  });
});
