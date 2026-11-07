import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ReponseRegleRelance } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { EcranReglagesRelances } from '@/ecrans/relances/EcranReglagesRelances';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';

/**
 * Mesure 7/4 (chantier « refonte navigation ») — écran de réglages des relances, issu de la
 * scission de l'ancien écran unique (`EcranRelances`). Fixtures et patron de rendu repris de
 * `EcranReglagesRelances.spec.tsx` (déjà éprouvé pour cet écran) : même règle `ResizeObserver`
 * (les cases à cocher Radix l'utilisent inconditionnellement au montage), même `rendre()`.
 *
 * Pas de composant portalé ici (`Checkbox` Radix n'ouvre aucun portail, contrairement à
 * `Select`/`Dialog`) : `document.body` repris quand même, convention uniforme avec les autres
 * `mesures.*.spec.tsx` — voir `harnais.ts`.
 */
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
  }
});

const REGLE_FACTURE_ECHUE: ReponseRegleRelance = {
  typeRelance: 'facture_echue',
  actif: true,
  delaisJours: [10, 20, 30],
  canaux: ['email'],
  texteModeleId: null,
  prereglageAppliqueLe: '2026-08-01T08:00:00.000Z',
  creeLe: '2026-07-01T08:00:00.000Z',
  modifieLe: '2026-08-01T08:00:00.000Z',
};

function rendre() {
  return renduAvecQueryClient(
    <MemoryRouter initialEntries={['/parametrage/relances']}>
      <EcranReglagesRelances />
    </MemoryRouter>,
  );
}

async function auditerEtat(nomEtat: string) {
  const audit = await auditerAccessibiliteEcran(
    `Réglages des relances — ${nomEtat}`,
    document.body,
  );
  exigerAucuneViolation(audit);
}

describe('Accessibilité WCAG 2.1 AA — réglages des relances', () => {
  it('état vide, aucune règle configurée (premier usage)', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([])));
    rendre();
    await screen.findByText('Aucune règle configurée');

    await auditerEtat('état vide, premier usage');
  });

  it('règle configurée, en lecture (badge, paliers, canaux)', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));
    rendre();
    await screen.findByText('Active');

    await auditerEtat('règle configurée, lecture');
  });

  it('formulaire de paliers ouvert (libellés associés à chaque champ)', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));
    await screen.findByRole('button', { name: 'Enregistrer' });

    await auditerEtat('formulaire de paliers ouvert');
  });

  it('palier retiré sans remplaçant — erreur annoncée textuellement, pas seulement en rouge', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));
    for (const nom of ['Retirer le palier 3', 'Retirer le palier 2', 'Retirer le palier 1']) {
      await utilisateur.click(screen.getByRole('button', { name: nom }));
    }
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const erreur = await screen.findByText(
      'Ajoutez au moins une étape pour activer les rappels de paiement.',
    );
    // L'assertion ci-dessous prouve que l'état invalide se perçoit par un TEXTE annoncé
    // (`role="alert"`) — jamais par la seule couleur `text-destructive` posée en CSS, qu'aucun test
    // de ce harnais ne peut de toute façon lire (`css: false`, voir `harnais.ts`).
    expect(erreur.closest('[role="alert"]')).not.toBeNull();

    await auditerEtat('palier retiré, erreur de validation affichée');
  });
});
