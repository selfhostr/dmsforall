import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseLigneOr } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { ListeLignesOrdreReparation } from './ListeLignesOrdreReparation';

// Radix Dialog appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même stub que
// `EcranFicheOrdreReparation.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function construireLigne(overrides: Partial<ReponseLigneOr> = {}): ReponseLigneOr {
  return {
    id: 'ligne-1',
    ordreReparationId: 'or-1',
    numeroOrdre: 1,
    type: 'main_oeuvre_bareme',
    origine: 'constatee',
    statut: 'proposee',
    payeur: 'client',
    payeurClientId: null,
    blocage: 'accord',
    designation: 'Remplacement disques avant (constaté au démontage)',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: 60,
    tempsBaremeConstructeurCentiemes: null,
    tempsReelCentiemes: null,
    tauxHoraireCentimes: 12000,
    prixUnitaireCentimes: null,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    figeLe: '2026-08-06T08:00:00.000Z',
    montants: { montantHtCentimes: 7200, montantTvaCentimes: 583, montantTtcCentimes: 7783 },
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: null,
    securite: false,
    fournieParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    creeLe: '2026-08-06T08:00:00.000Z',
    modifieLe: '2026-08-06T08:00:00.000Z',
    ...overrides,
  };
}

function rendre(lignes: readonly ReponseLigneOr[]) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <ListeLignesOrdreReparation orId="or-1" lignes={lignes} lignesTronquees={false} />
    </QueryClientProvider>,
  );
}

describe('ListeLignesOrdreReparation — sélection et actions groupées (valider/refuser/annuler-lignes)', () => {
  it("un chef d'atelier (droit `atelier.ligne.valider`) voit une case à cocher par ligne, et sélectionner en fait apparaître les actions groupées", async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    const utilisateur = userEvent.setup();
    rendre([construireLigne()]);

    const case_ = await screen.findByRole('checkbox', {
      name: 'Sélectionner Remplacement disques avant (constaté au démontage)',
    });
    expect(screen.queryByRole('button', { name: /^Valider/ })).not.toBeInTheDocument();

    await utilisateur.click(case_);

    expect(await screen.findByRole('button', { name: 'Valider (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuser (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler (1)' })).toBeInTheDocument();
  });

  it('un technicien (aucun droit de décision, seulement `atelier.ligne.creer`) ne voit AUCUNE case à cocher', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
        }),
      ),
    );
    rendre([construireLigne()]);

    await screen.findByText('Remplacement disques avant (constaté au démontage)');
    expect(
      screen.queryByRole('checkbox', {
        name: 'Sélectionner Remplacement disques avant (constaté au démontage)',
      }),
    ).not.toBeInTheDocument();
  });

  it('« Valider » ferme le dialogue après un succès serveur et envoie `ligneIds` — dénoue le lien « Résoudre » de facturation, mort faute de sélection avant ce correctif', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    let corpsRequete: unknown;
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/valider-lignes', async ({ request }) => {
        corpsRequete = await request.json();
        return HttpResponse.json({
          donnees: { id: 'or-1', version: 2 },
          avertissements: [],
        });
      }),
    );

    const utilisateur = userEvent.setup();
    rendre([construireLigne()]);

    await utilisateur.click(
      await screen.findByRole('checkbox', {
        name: 'Sélectionner Remplacement disques avant (constaté au démontage)',
      }),
    );
    await utilisateur.click(await screen.findByRole('button', { name: 'Valider (1)' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Confirmer' }));

    expect(corpsRequete).toMatchObject({ ligneIds: ['ligne-1'] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('« Annuler » exige un motif — bloqué localement, jamais envoyé vide au serveur', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    let appele = false;
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/annuler-lignes', () => {
        appele = true;
        return HttpResponse.json({ donnees: { id: 'or-1', version: 2 }, avertissements: [] });
      }),
    );

    const utilisateur = userEvent.setup();
    rendre([construireLigne()]);

    await utilisateur.click(
      await screen.findByRole('checkbox', {
        name: 'Sélectionner Remplacement disques avant (constaté au démontage)',
      }),
    );
    await utilisateur.click(await screen.findByRole('button', { name: 'Annuler (1)' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Confirmer' }));

    expect(await within(dialogue).findByText('Le motif est obligatoire')).toBeInTheDocument();
    expect(appele).toBe(false);
  });
});
