import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseDocumentVente, ReponseLigneDocumentVente } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { DialogueLigneDocumentVente } from './DialogueLigneDocumentVente';

/**
 * Issue #125 — preuves ciblées sur LE COMPOSANT (préremplissage en mode modification, validation
 * requise, particularité du type `texte` sans prix) : le scénario d'AJOUT bout-en-bout (corps
 * envoyé exact, disparition du dialogue, ligne affichée) est déjà prouvé par
 * `EcranFicheFacture.spec.tsx` — pas dupliqué ici.
 */
beforeAll(() => {
  // Même stub que `DialogueAjoutLigneOr.spec.tsx` : Radix Select appelle des API absentes de jsdom.
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function documentFige(): ReponseDocumentVente {
  return {
    id: 'facture-1',
    modifieLe: '2026-08-13T08:00:00.000Z',
  } as ReponseDocumentVente;
}

function ligneFixture(
  overrides: Partial<ReponseLigneDocumentVente> = {},
): ReponseLigneDocumentVente {
  return {
    id: 'ligne-1',
    documentId: 'facture-1',
    numeroOrdre: 1,
    type: 'piece',
    ligneOrId: null,
    documentAcompteId: null,
    designation: 'Filtre à huile',
    referenceTexte: 'REF-42',
    articleId: null,
    quantiteMillieme: 2000,
    prixUnitaireTtcCentimes: 3500,
    modeCalculTva: 'ttc',
    regimeTva: 'reduit',
    tauxTvaPourmille: 26,
    datePrestation: '2026-08-10',
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    montants: {
      montantHtCentimes: 6816,
      montantTvaCentimes: 184,
      montantTtcCentimes: 7000,
      montantFacturableCentimes: 7000,
      montantValoriseCentimes: 7000,
    },
    creeLe: '2026-08-10T08:00:00.000Z',
    modifieLe: '2026-08-10T08:00:00.000Z',
    ...overrides,
  };
}

describe('DialogueLigneDocumentVente — mode modification : préremplissage exact', () => {
  it('reprend désignation, référence, quantité, prix et le préréglage de taux correspondant (reduit/26 -> « Réduit »)', async () => {
    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <DialogueLigneDocumentVente
        documentId="facture-1"
        ligne={ligneFixture()}
        enfantDeclencheur={<button type="button">Modifier</button>}
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    const dialogue = await screen.findByRole('dialog');

    expect(screen.getByLabelText(/^Désignation/)).toHaveValue('Filtre à huile');
    expect(screen.getByLabelText(/^Référence/)).toHaveValue('REF-42');
    expect(screen.getByLabelText(/^Quantité/)).toHaveValue('2');
    expect(screen.getByLabelText(/^Prix unitaire TTC/)).toHaveValue('35.00');
    expect(screen.getByLabelText(/^Date de prestation/)).toHaveValue('2026-08-10');
    expect(dialogue).toHaveTextContent('Réduit — 2.6%');
    // Bouton de soumission « Enregistrer » (mode modification), jamais « Confirmer » (mode ajout).
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
  });

  it('envoie un corps entièrement repeuplé sur PATCH — jamais un diff partiel', async () => {
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/documents-vente/facture-1/lignes/ligne-1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          donnees: { ...documentFige(), lignes: [] },
          avertissements: [],
        });
      }),
    );

    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <DialogueLigneDocumentVente
        documentId="facture-1"
        ligne={ligneFixture()}
        enfantDeclencheur={<button type="button">Modifier</button>}
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    await screen.findByRole('dialog');
    await utilisateur.clear(screen.getByLabelText(/^Prix unitaire TTC/));
    await utilisateur.type(screen.getByLabelText(/^Prix unitaire TTC/), '40.00');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      type: 'piece',
      designation: 'Filtre à huile',
      referenceTexte: 'REF-42',
      quantiteMillieme: 2000,
      prixUnitaireTtcCentimes: 4000,
      regimeTva: 'reduit',
      tauxTvaPourmille: 26,
      datePrestation: '2026-08-10',
    });
  });
});

describe('DialogueLigneDocumentVente — validation avant envoi', () => {
  it('désignation vide : bloque la soumission, aucune requête envoyée', async () => {
    let appele = false;
    server.use(
      http.post('/api/v1/documents-vente/facture-1/lignes', () => {
        appele = true;
        return HttpResponse.json({ donnees: documentFige(), avertissements: [] }, { status: 201 });
      }),
    );

    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <DialogueLigneDocumentVente
        documentId="facture-1"
        enfantDeclencheur={<button type="button">Ajouter</button>}
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));
    await screen.findByRole('dialog');
    await utilisateur.type(screen.getByLabelText(/^Prix unitaire TTC/), '10.00');
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText('Ce champ est obligatoire.')).toBeInTheDocument();
    expect(appele).toBe(false);
  });

  it("type « texte » : le prix se désactive et n'est jamais exigé — la ligne part avec prixUnitaireTtcCentimes: null", async () => {
    let corpsRecu: unknown;
    server.use(
      http.post('/api/v1/documents-vente/facture-1/lignes', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ donnees: documentFige(), avertissements: [] }, { status: 201 });
      }),
    );

    const utilisateur = userEvent.setup();
    renduAvecQueryClient(
      <DialogueLigneDocumentVente
        documentId="facture-1"
        enfantDeclencheur={<button type="button">Ajouter</button>}
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('combobox', { name: 'Type' }));
    await utilisateur.click(await screen.findByRole('option', { name: 'Texte (note libre)' }));

    expect(screen.getByLabelText(/^Prix unitaire TTC/)).toBeDisabled();

    await utilisateur.type(screen.getByLabelText(/^Désignation/), 'Note de service');
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      type: 'texte',
      designation: 'Note de service',
      prixUnitaireTtcCentimes: null,
    });
  });
});
