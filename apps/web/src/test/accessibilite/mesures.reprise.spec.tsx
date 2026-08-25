import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it } from 'vitest';

import type { PageDossierReprise, ReponseDossierReprise, ReponsePlanReprise } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranReprise } from '@/ecrans/reprise/EcranReprise';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';

/**
 * Mesure — écran de reprise de données (dépôt d'archive + validation de plan), les deux étapes qui
 * portent des contrôles interactifs NOUVEAUX au produit (zone de dépôt glisser-déposer, cases à
 * cocher de plan). Même patron que `mesures.borne-pointage.spec.tsx`/`mesures.liste-ordres-
 * reparation.spec.tsx` : rendu réel + `axe-core` (WCAG 2.1 AA, hors contraste — voir la limite
 * documentée dans `harnais.ts`, mesuré séparément par `contraste-jetons.spec.ts`).
 */
function rendre(entree = '/reprise-donnees') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entree]}>
        <Routes>
          <Route path="/reprise-donnees" element={<EcranReprise />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pageDossiers(donnees: readonly ReponseDossierReprise[]): PageDossierReprise {
  return { donnees, curseurSuivant: null, limite: 1 };
}

describe('Accessibilité — EcranReprise, étape Dépôt (aucun dossier)', () => {
  it('aucune violation WCAG 2.1 AA détectée par axe-core', async () => {
    server.use(http.get('/api/v1/reprise/dossiers', () => HttpResponse.json(pageDossiers([]))));
    const { findByText } = rendre();
    await findByText(/glissez votre fichier ici/i);

    const resultat = await auditerAccessibiliteEcran('EcranReprise (dépôt)', document.body);
    exigerAucuneViolation(resultat);
  });
});

describe('Accessibilité — EcranReprise, étape Validation du plan', () => {
  it('aucune violation WCAG 2.1 AA détectée par axe-core', async () => {
    const dossier: ReponseDossierReprise = {
      id: 'dossier-1',
      statut: 'plan_propose',
      archive: {
        tailleOctetsAnnoncee: 1000,
        octetsRecus: 1000,
        dernierNumeroTrancheRecuContigu: 0,
        empreinteSha256Annoncee: 'a'.repeat(64),
        empreinteSha256Verifiee: 'a'.repeat(64),
        integriteValidee: true,
      },
      analyseId: 'analyse-1',
      planId: 'plan-1',
      importId: null,
      creeLe: '2026-08-24T08:00:00.000Z',
      modifieLe: '2026-08-24T08:00:00.000Z',
    };
    const plan: ReponsePlanReprise = {
      id: 'plan-1',
      dossierRepriseId: 'dossier-1',
      analyseId: 'analyse-1',
      statut: 'propose',
      elements: [
        {
          id: 'elt-clients',
          domaine: 'clients',
          tableDetecteeId: 'table-1',
          perimetre: 'detail_24_mois_glissants_et_ouverts',
          volumeAttenduLignes: 120,
          inclus: true,
          ajustable: true,
        },
      ],
      exclusions: [{ tableDetecteeId: 'table-3', motif: 'referentiel_constructeur_jamais_repris' }],
      proposeLe: '2026-08-24T08:00:00.000Z',
      valideLe: null,
      valideParUtilisateurId: null,
    };

    server.use(
      http.get('/api/v1/reprise/dossiers', () => HttpResponse.json(pageDossiers([dossier]))),
      http.get('/api/v1/reprise/dossiers/dossier-1/plan', () => HttpResponse.json(plan)),
    );
    const { findByText } = rendre();
    await findByText(/vos clients/i);

    const resultat = await auditerAccessibiliteEcran('EcranReprise (validation)', document.body);
    exigerAucuneViolation(resultat);
  });
});
