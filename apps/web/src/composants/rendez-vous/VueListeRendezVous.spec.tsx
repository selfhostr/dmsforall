import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { VueListeRendezVous } from './VueListeRendezVous';
import type { RendezVousCarte } from './types';

function construireRendezVous(overrides: Partial<RendezVousCarte> = {}): RendezVousCarte {
  return {
    id: 'rdv-1',
    dateLe: '2026-08-13',
    moment: 'matin',
    heureSouhaitee: '09:00:00',
    dureeEstimeeMinutes: 30,
    clientNom: 'Jean Dupont',
    vehiculePlaque: 'VS 123456',
    vehiculeCanton: 'VS',
    vehiculeDesignation: 'VW Golf',
    motifLibelle: 'Entretien / service courant',
    statut: 'confirme',
    ...overrides,
  };
}

describe('VueListeRendezVous', () => {
  it('affiche une ligne par rendez-vous, accessible au clavier', async () => {
    const utilisateur = userEvent.setup();
    const onOuvrir = vi.fn();
    const rendezVous = construireRendezVous();
    render(<VueListeRendezVous rendezVous={[rendezVous]} onOuvrirRendezVous={onOuvrir} />);
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText('Entretien / service courant')).toBeInTheDocument();
    expect(screen.getByText('Confirmé')).toBeInTheDocument();
    // `role: 'button'`, pas `'link'` : correctif e2e `TableComptoir` (WCAG 1.3.1) — poser
    // `role="link"` sur le `<tr>` de la ligne remplaçait son rôle `row` implicite au lieu de s'y
    // ajouter, rendant la table imparcourable en navigation par tableau au lecteur d'écran (non
    // détecté par axe-core). Le clavier/nom accessible vivent maintenant sur un vrai `<button>`
    // dans la colonne identifiante (« heure »), le `<tr>` garde son rôle `row` natif intact.
    const ligne = screen.getByRole('button');
    ligne.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrir).toHaveBeenCalledWith(rendezVous);
  });

  it('affiche le moment quand aucune heure souhaitée n’est connue', () => {
    render(
      <VueListeRendezVous
        rendezVous={[construireRendezVous({ heureSouhaitee: null, moment: 'apres_midi' })]}
        onOuvrirRendezVous={vi.fn()}
      />,
    );
    expect(screen.getByText(/Après-midi/)).toBeInTheDocument();
  });

  it('rend le contenu vide fourni quand aucun rendez-vous', () => {
    render(
      <VueListeRendezVous
        rendezVous={[]}
        onOuvrirRendezVous={vi.fn()}
        contenuVide={<p>Rien ici</p>}
      />,
    );
    expect(screen.getByText('Rien ici')).toBeInTheDocument();
  });

  it('affiche le téléphone du client en lien tel: sans ouvrir la ligne', async () => {
    const utilisateur = userEvent.setup();
    const onOuvrir = vi.fn();
    render(
      <VueListeRendezVous
        rendezVous={[
          construireRendezVous({ clientTelephone: '079 123 45 67' }),
          construireRendezVous({ id: 'rdv-2', clientNom: 'Anne Roux', clientTelephone: null }),
        ]}
        onOuvrirRendezVous={onOuvrir}
      />,
    );
    const lien = screen.getByRole('link', { name: '079 123 45 67' });
    expect(lien).toHaveAttribute('href', 'tel:0791234567');
    expect(screen.getByText('Pas de téléphone')).toBeInTheDocument();
    await utilisateur.click(lien);
    expect(onOuvrir).not.toHaveBeenCalled();
  });
});
