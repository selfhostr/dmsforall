import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { OrdreReparationResume, PageCurseur, ReponsePointage } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranPointageTechnicien } from './EcranPointageTechnicien';

// Radix Select (SelecteurSitePointage) appelle des API absentes de jsdom — même stub que les
// autres écrans qui composent un `<Select>` (ex. `EcranListeFournisseurs.spec.tsx`).
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function pageOrdres(donnees: readonly OrdreReparationResume[]): PageCurseur<OrdreReparationResume> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

const OR_ASSIGNE: OrdreReparationResume = {
  id: 'or-1',
  numero: 'OR-000123',
  statut: 'ouvert',
  etatAffiche: 'ouvert',
  type: 'reparation',
  localisation: 'atelier',
  ouvertLe: '2026-08-03T06:00:00.000Z',
  restitutionPromiseLe: null,
  vehicule: {
    id: 'veh-1',
    plaque: '123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    vin: null,
    premiereMiseEnCirculationLe: null,
    identificationIncomplete: false,
  },
  client: {
    id: 'cl-1',
    numeroClient: 'CL-000123',
    nomAffiche: 'Jean Dupont',
    type: 'particulier',
    statut: 'actif',
    langueCorrespondance: 'fr',
    poObligatoire: false,
    telephone: null,
    localite: 'Lausanne',
    nombreVehicules: 1,
    dernierPassageLe: null,
  },
  nombreLignes: 2,
};

const POINTAGE_EN_COURS: ReponsePointage = {
  id: 'pointage-1',
  siteId: 'site-1',
  technicienId: SESSION_TEST.utilisateur.id,
  statut: 'en_cours',
  nature: 'productif_or',
  ordreReparationId: 'or-1',
  ligneOrId: null,
  activiteIndirecte: null,
  source: 'ecran_atelier',
  appareilId: null,
  debutLe: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  finLe: null,
  dureeBruteSecondes: null,
  dureeArrondieCentiemes: null,
  clotureAutomatique: false,
  anomalie: null,
  derniereCorrection: null,
  creeLe: new Date().toISOString(),
  modifieLe: new Date().toISOString(),
};

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage']}>
        <Routes>
          <Route path="/pointage" element={<EcranPointageTechnicien />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranPointageTechnicien', () => {
  it('affiche « Mes OR du jour » et les activités indirectes quand aucun pointage n’est en cours', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([OR_ASSIGNE]))),
    );

    rendre();

    expect(await screen.findByText('OR-000123')).toBeInTheDocument();
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
    // Activité indirecte, tuile toujours proposée (RM-87 : trois cibles, à tout instant).
    expect(screen.getByRole('button', { name: 'Nettoyage' })).toBeInTheDocument();
  });

  it('état vide : invite honnête quand aucun OR n’est assigné au technicien', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
    );

    rendre();

    expect(await screen.findByText("Aucun OR à pointer pour vous aujourd'hui.")).toBeInTheDocument();
  });

  it('affiche le chrono et le bouton Arrêter quand un pointage est en cours', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE_EN_COURS]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
    );

    rendre();

    expect(await screen.findByRole('button', { name: 'Arrêter' })).toBeInTheDocument();
    // Un pointage `productif_or` propose une pause, pas de reprise (aucune cible mémorisée après
    // un rendu à froid, voir le commentaire de tête d'`EcranPointageTechnicien.tsx`).
    expect(screen.getByRole('button', { name: 'Mettre en pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprendre' })).not.toBeInTheDocument();
  });

  it("affiche une erreur actionnable si le serveur échoue à lire le pointage en cours", async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: '',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
    );

    rendre();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument());
  });
});
