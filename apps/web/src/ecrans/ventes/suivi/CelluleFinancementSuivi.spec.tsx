import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SuiviFinancement } from '@dfa/shared';

import '@/i18n';

import { CelluleFinancementSuivi } from './CelluleFinancementSuivi';

const FINANCEMENT_CONFIRME: SuiviFinancement = {
  id: 'financement-1',
  type: 'leasing',
  statutConfirmation: 'confirme',
  organisme: { id: 'organisme-1', nomAffiche: 'AUDIT-Leasing SA' },
  confirmeLe: '2026-08-04T15:43:25.877Z',
  dureeMois: 48,
  echeanceLe: '2030-08-04',
};

describe('CelluleFinancementSuivi', () => {
  it('aucun financement sur le dossier : tiret, pas d’erreur', () => {
    render(<CelluleFinancementSuivi financement={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('financement confirmé, rôle avec droit financier : affiche la date d’échéance réelle', () => {
    render(<CelluleFinancementSuivi financement={FINANCEMENT_CONFIRME} />);
    // Comparaison par motif (pas d'égalité stricte) — même prudence que `formats.spec.ts` pour une
    // chaîne date-only convertie via `new Date(...)` : le jour affiché peut varier d'un fuseau à
    // l'autre selon l'implémentation, seul le format jj.mm.aaaa et l'année comptent ici.
    expect(screen.getByText(/\d{2}\.\d{2}\.2030/)).toBeInTheDocument();
    expect(screen.queryByText('Non communiqué')).not.toBeInTheDocument();
  });

  it("échéance absente (financement pas encore confirmé) : jamais estimée, texte explicite plutôt qu'une date inventée", () => {
    // `confirmeLe`/`dureeMois` absents ET `echeanceLe: null` — exactement ce que renvoie le
    // serveur pour un financement `en_attente`/`refuse` (voir `contrats/ventes/suivi.ts`) : les
    // clés sont PRÉSENTES (rôle avec droit financier) mais valent `null`, pas omises.
    const financementNonConfirme: SuiviFinancement = {
      id: 'financement-2',
      type: 'credit',
      statutConfirmation: 'en_attente',
      organisme: { id: 'organisme-2', nomAffiche: 'AUDIT-Banque SA' },
      confirmeLe: null,
      dureeMois: null,
      echeanceLe: null,
    };
    render(<CelluleFinancementSuivi financement={financementNonConfirme} />);
    expect(
      screen.getByText('En attente de confirmation — échéance non estimée'),
    ).toBeInTheDocument();
    // Aucune date n'apparaît nulle part dans cette cellule.
    expect(screen.queryByText(/\d{2}\.\d{2}\.\d{4}/)).not.toBeInTheDocument();
  });

  it('rôle sans droit financier (RF-116) : `dureeMois`/`echeanceLe` OMISES du corps serveur — masquage affiché, jamais une date, jamais une case vide', () => {
    // Reproduit EXACTEMENT ce que produit `JSON.parse` d'une réponse serveur où le mapper a omis
    // ces deux clés (voir `service-suivi-vente.ts`/`contrats/ventes/suivi.ts`) — le type et le
    // statut restent visibles (pas des données financières), seule l'échéance est masquée.
    const financementMasque: SuiviFinancement = {
      id: 'financement-3',
      type: 'leasing',
      statutConfirmation: 'confirme',
      organisme: { id: 'organisme-3', nomAffiche: 'AUDIT-Leasing SA' },
      confirmeLe: '2026-08-04T15:43:25.877Z',
      // `dureeMois` et `echeanceLe` volontairement absents de l'objet, pas mis à `null`.
    };

    render(<CelluleFinancementSuivi financement={financementMasque} />);

    expect(screen.getByText('Non communiqué')).toBeInTheDocument();
    expect(screen.getByText('Leasing')).toBeInTheDocument();
    expect(screen.getByText('AUDIT-Leasing SA')).toBeInTheDocument();
    expect(screen.queryByText(/\d{2}\.\d{2}\.\d{4}/)).not.toBeInTheDocument();
  });
});
