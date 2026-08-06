import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseDocumentVente, ReponseLigneDocumentVente } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranAvoir } from './EcranAvoir';

/**
 * Défaut corrigé : `EcranAvoir.soumettre()` faisait `if (!resultat.success) return;` sans
 * afficher d'erreur — cas déclencheur, un motif « Autre » dont le texte dépasse 4000 caractères
 * (`schemaTexteLong`, @dfa/shared, aucune borne n'existait auparavant ni sur le champ ni dans la
 * validation locale `motifValide`). Le bouton restait actif, le clic ne faisait rien. Corrigé en
 * bornant le champ (`maxLength`) ET en intégrant la longueur dans `motifValide`, qui gouverne
 * `peutEmettre` : le bouton « Émettre l'avoir » doit rester DÉSACTIVÉ, avec un message explicite,
 * plutôt que de laisser l'utilisateur cliquer dans le vide.
 */

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function construireLigne(
  overrides: Partial<ReponseLigneDocumentVente> = {},
): ReponseLigneDocumentVente {
  return {
    id: 'ligne-1',
    documentId: 'facture-1',
    numeroOrdre: 1,
    type: 'forfait',
    ligneOrId: null,
    documentAcompteId: null,
    designation: 'Révision complète',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    prixUnitaireTtcCentimes: 12345,
    modeCalculTva: 'ttc',
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-07-20',
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    montants: {
      montantHtCentimes: 11430,
      montantTvaCentimes: 915,
      montantTtcCentimes: 12345,
      montantFacturableCentimes: 12345,
      montantValoriseCentimes: 12345,
    },
    creeLe: '2026-07-20T08:00:00.000Z',
    modifieLe: '2026-07-20T08:00:00.000Z',
    ...overrides,
  };
}

function construireFacture(overrides: Partial<ReponseDocumentVente> = {}): ReponseDocumentVente {
  return {
    id: 'facture-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: '2026-00002',
    numeroSequence: 2,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: 'non_regle',
    siteId: 'site-1',
    clientId: 'cl-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Jean Dupont',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      conditionsPaiement: null,
      plaque: null,
    },
    dateDocument: '2026-07-20',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 11430,
    totalTvaCentimes: 915,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 12345,
    ventilationTva: [
      { regimeTva: 'normal', tauxTvaPourmille: 81, baseCentimes: 11430, tvaCentimes: 915 },
    ],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 12345,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: null,
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [construireLigne()],
    nombreLignes: 1,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-07-20T09:00:00.000Z',
    emisPar: { utilisateurId: 'u1', nomAffiche: 'Alice' },
    creeLe: '2026-07-20T08:00:00.000Z',
    modifieLe: '2026-07-20T09:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function installerHandlerDocument(document_: ReponseDocumentVente) {
  server.use(
    http.get(`/api/v1/documents-vente/${document_.id}`, () => HttpResponse.json(document_)),
  );
}

function rendre(id = 'facture-1') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/factures/${id}/avoir`]}>
        <Routes>
          <Route path="/factures/:id/avoir" element={<EcranAvoir />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranAvoir — motif « Autre », borne de longueur (défaut corrigé)', () => {
  it('borne le champ à 4000 caractères (`maxLength`, `schemaTexteLong`)', async () => {
    installerHandlerDocument(construireFacture());
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('combobox', { name: 'Motif' }));
    await utilisateur.click(await screen.findByRole('option', { name: 'Autre' }));

    const champMotifAutre = await screen.findByLabelText('Autre');
    expect(champMotifAutre).toHaveAttribute('maxLength', '4000');
  });

  it(
    "un texte de plus de 4000 caractères désactive « Émettre l'avoir » et affiche un message " +
      '— plus jamais un clic qui ne fait rien',
    async () => {
      installerHandlerDocument(construireFacture());
      const utilisateur = userEvent.setup();
      rendre();

      // Sélectionne au moins une ligne (condition indépendante requise par `peutEmettre`).
      await utilisateur.click(await screen.findByRole('checkbox', { name: 'Révision complète' }));

      await utilisateur.click(screen.getByRole('combobox', { name: 'Motif' }));
      await utilisateur.click(await screen.findByRole('option', { name: 'Autre' }));

      const champMotifAutre = await screen.findByLabelText('Autre');
      // `fireEvent.change` pose la valeur directement (contourne la frappe touche par touche que
      // `maxLength` borne déjà nativement) : prouve que la validation elle-même — pas seulement
      // l'attribut HTML — refuse un texte trop long, quelle que soit la façon dont il est arrivé
      // dans le champ (collage, saisie automatisée, etc.).
      fireEvent.change(champMotifAutre, { target: { value: 'a'.repeat(4001) } });

      expect(
        await screen.findByText('Le texte du motif « Autre » ne doit pas dépasser 4000 caractères'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: "Émettre l'avoir" })).toBeDisabled();
    },
  );

  it("un texte valide (≤ 4000 caractères) active normalement « Émettre l'avoir »", async () => {
    installerHandlerDocument(construireFacture());
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('checkbox', { name: 'Révision complète' }));
    await utilisateur.click(screen.getByRole('combobox', { name: 'Motif' }));
    await utilisateur.click(await screen.findByRole('option', { name: 'Autre' }));

    const champMotifAutre = await screen.findByLabelText('Autre');
    fireEvent.change(champMotifAutre, { target: { value: 'Client mécontent, geste commercial' } });

    expect(screen.getByRole('button', { name: "Émettre l'avoir" })).toBeEnabled();
    expect(
      screen.queryByText('Le texte du motif « Autre » ne doit pas dépasser 4000 caractères'),
    ).not.toBeInTheDocument();
  });
});
