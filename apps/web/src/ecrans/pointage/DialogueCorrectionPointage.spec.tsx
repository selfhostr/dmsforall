import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { EntreeCorrectionPointage, ReponsePointage } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { DialogueCorrectionPointage } from './DialogueCorrectionPointage';

function construirePointage(overrides: Partial<ReponsePointage> = {}): ReponsePointage {
  return {
    id: 'pointage-1',
    siteId: 'site-1',
    technicienId: 'technicien-1',
    technicienNomAffiche: 'Marco Rossi',
    statut: 'termine',
    nature: 'productif_or',
    ordreReparationId: 'or-1',
    ordreReparationNumero: 'OR-000123',
    ligneOrId: null,
    ligneOrDesignation: null,
    activiteIndirecte: null,
    source: 'saisie',
    appareilId: null,
    debutLe: '2026-08-12T06:00:00.000Z',
    finLe: '2026-08-12T10:00:00.000Z',
    dureeBruteSecondes: 14400,
    dureeArrondieCentiemes: 400,
    clotureAutomatique: false,
    anomalie: null,
    derniereCorrection: null,
    creeLe: '2026-08-12T06:00:00.000Z',
    modifieLe: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

function rendre(pointage: ReponsePointage) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogueCorrectionPointage ouvert pointage={pointage} onOuvertChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe('DialogueCorrectionPointage', () => {
  // Issue #153 : `<input type="datetime-local">` natif affiche/saisit dans le format du
  // NAVIGATEUR (MM/JJ/AAAA + AM/PM constaté en test réel), seul endroit du produit hors du format
  // suisse jj.mm.aaaa attendu partout ailleurs — même défaut, même correctif que l'issue #89
  // (`FormulaireNouvelOrdreReparation.spec.tsx`). Avant le correctif, ce test échoue : aucun champ
  // au placeholder « jj.mm.aaaa HH:MM » n'existe (le champ natif ne porte pas ce texte), et une
  // valeur suisse au format `jj.mm.aaaa HH:MM` ne peut donc jamais être saisie.
  it('affiche les heures de début/fin en format suisse jj.mm.aaaa HH:MM, jamais un champ natif MM/JJ/AAAA', () => {
    rendre(construirePointage());

    const champsSuisses = screen.getAllByPlaceholderText('jj.mm.aaaa HH:MM');
    expect(champsSuisses).toHaveLength(2);

    // La valeur initiale (reprise du pointage, en UTC) doit apparaître convertie en heure SUISSE,
    // jamais en UTC brut ni dans un format américain.
    const champDebut = screen.getByLabelText('Début') as HTMLInputElement;
    expect(champDebut.type).toBe('text');
    expect(champDebut.value).toMatch(/^\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);

    // Aucun `<input type="datetime-local">` ne doit plus subsister dans ce dialogue.
    expect(document.querySelector('input[type="datetime-local"]')).not.toBeInTheDocument();
  });

  it(
    'la correction saisie en format suisse est envoyée au serveur en heure SUISSE correctement ' +
      'convertie (jamais un décalage de fuseau, jamais l’ISO brut du navigateur)',
    async () => {
      const requetes: EntreeCorrectionPointage[] = [];
      server.use(
        http.post('/api/v1/pointages/pointage-1/corriger', async ({ request }) => {
          const entree = (await request.json()) as EntreeCorrectionPointage;
          requetes.push(entree);
          return HttpResponse.json({
            donnees: construirePointage({ debutLe: entree.debutLe }),
            avertissements: [],
          });
        }),
      );

      const utilisateur = userEvent.setup();
      rendre(construirePointage());

      const champDebut = screen.getByLabelText('Début');
      await utilisateur.clear(champDebut);
      // 14 août 2026, 07:30 heure suisse (CEST, UTC+2 en août) — vérifie que la conversion se fait
      // bien vers l'heure de Zurich, jamais l'heure locale « du navigateur » (ici UTC en test).
      await utilisateur.type(champDebut, '14.08.2026 07:30');

      await utilisateur.type(screen.getByLabelText('Motif de la correction'), 'Oubli de pointage');

      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la correction' }));

      await waitFor(() => expect(requetes).toHaveLength(1));
      // 07:30 heure suisse (été, UTC+2) = 05:30 UTC — jamais 07:30Z (ce que produirait une
      // conversion naïve `new Date(...).toISOString()` sur une chaîne interprétée en UTC), ni un
      // format américain mal interprété.
      expect(requetes[0]?.debutLe).toBe('2026-08-14T05:30:00.000Z');
    },
  );
});
