import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { GrilleAgendaSemaine } from './GrilleAgendaSemaine';
import type { JourAgenda, RendezVousCarte } from './types';

function construireJour(overrides: Partial<JourAgenda> = {}): JourAgenda {
  return {
    dateIso: '2026-08-13',
    date: new Date(2026, 7, 13),
    nombreRendezVous: 2,
    minutesOccupees: 120,
    capaciteMinutes: 480,
    rendezVous: [],
    ...overrides,
  };
}

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

describe('GrilleAgendaSemaine', () => {
  it('rend sept jours avec un aria-label complet (jamais un chiffre isolé)', () => {
    const jours = Array.from({ length: 7 }, (_, index) =>
      construireJour({ dateIso: `2026-08-1${index}`, date: new Date(2026, 7, 10 + index) }),
    );
    render(
      <GrilleAgendaSemaine jours={jours} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
    );
    const entetes = screen.getAllByRole('button', { name: /occupation 2h00 sur 8h00/ });
    expect(entetes).toHaveLength(7);
  });

  it('affiche les cartes de rendez-vous du jour', () => {
    const jour = construireJour({ rendezVous: [construireRendezVous()] });
    render(
      <GrilleAgendaSemaine jours={[jour]} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
    );
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
  });

  it('ouvre le jour cliqué', async () => {
    const utilisateur = userEvent.setup();
    const onCliquerJour = vi.fn();
    const jour = construireJour();
    render(
      <GrilleAgendaSemaine
        jours={[jour]}
        onCliquerJour={onCliquerJour}
        onOuvrirRendezVous={vi.fn()}
      />,
    );
    await utilisateur.click(screen.getByRole('button', { name: /occupation/ }));
    expect(onCliquerJour).toHaveBeenCalledWith(jour);
  });

  it('ouvre le rendez-vous cliqué', async () => {
    const utilisateur = userEvent.setup();
    const onOuvrirRendezVous = vi.fn();
    const rendezVous = construireRendezVous();
    const jour = construireJour({ rendezVous: [rendezVous] });
    render(
      <GrilleAgendaSemaine
        jours={[jour]}
        onCliquerJour={vi.fn()}
        onOuvrirRendezVous={onOuvrirRendezVous}
      />,
    );
    await utilisateur.click(
      screen.getByRole('button', { name: /Ouvrir le rendez-vous de Jean Dupont/ }),
    );
    expect(onOuvrirRendezVous).toHaveBeenCalledWith(rendezVous);
  });

  it('trie les rendez-vous du jour par moment puis par heure', () => {
    const jour = construireJour({
      rendezVous: [
        construireRendezVous({
          id: 'apres-midi',
          moment: 'apres_midi',
          heureSouhaitee: null,
          clientNom: 'Client B',
        }),
        construireRendezVous({
          id: 'matin',
          moment: 'matin',
          heureSouhaitee: '08:00:00',
          clientNom: 'Client A',
        }),
      ],
    });
    render(
      <GrilleAgendaSemaine jours={[jour]} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
    );
    const noms = screen.getAllByText(/^Client [AB]$/).map((n) => n.textContent);
    expect(noms).toEqual(['Client A', 'Client B']);
  });

  it('déplace le focus entre en-têtes de jour avec les flèches (roving tabindex)', async () => {
    const utilisateur = userEvent.setup();
    const jours = [
      construireJour({ dateIso: '2026-08-10', date: new Date(2026, 7, 10) }),
      construireJour({ dateIso: '2026-08-11', date: new Date(2026, 7, 11) }),
    ];
    render(
      <GrilleAgendaSemaine jours={jours} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
    );
    const entetes = screen.getAllByRole('button', { name: /occupation/ });
    expect(entetes[0]).toHaveAttribute('tabindex', '0');
    expect(entetes[1]).toHaveAttribute('tabindex', '-1');
    entetes[0]?.focus();
    await utilisateur.keyboard('{ArrowRight}');
    expect(entetes[1]).toHaveFocus();
  });

  it('ne dit jamais "disponible"/"complet" dans l’aria-label d’un jour à capacité non définie', () => {
    const jour = construireJour({ capaciteMinutes: null, nombreRendezVous: 3 });
    render(
      <GrilleAgendaSemaine jours={[jour]} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
    );
    expect(
      screen.getByRole('button', { name: /3 rendez-vous, capacité non définie/ }),
    ).toBeInTheDocument();
  });

  // Régression : le badge de capacité (« 0h00 occupée sur 8h00 — encore 8h00 libres ») débordait de
  // sa colonne et se cassait sur cinq lignes une fois enrichi de la marge encore libre — sept
  // pastilles fusionnaient en une bande continue. Vue Semaine (7 jours) -> résumé compact ; vue
  // Jour (1 jour, même grille) -> phrase complète, la colonne unique a la place.
  describe('résumé de capacité selon la densité de la vue', () => {
    it('en vue Semaine (sept jours), n’affiche jamais la phrase complète occupé/capacité', () => {
      const jours = Array.from({ length: 7 }, (_, index) =>
        construireJour({ dateIso: `2026-08-1${index}`, date: new Date(2026, 7, 10 + index) }),
      );
      render(
        <GrilleAgendaSemaine jours={jours} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
      );
      expect(screen.getAllByText(/Disponible/)).toHaveLength(7);
      expect(screen.queryByText('2h00 occupée sur 8h00 — encore 6h00 libres')).toBeNull();
    });

    it('en vue Jour (un seul jour, même composant), affiche la phrase complète occupé/capacité', () => {
      const jour = construireJour();
      render(
        <GrilleAgendaSemaine jours={[jour]} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
      );
      expect(screen.getByText('2h00 occupée sur 8h00 — encore 6h00 libres')).toBeInTheDocument();
    });

    it('n’active la grille dense à sept colonnes qu’en vue Semaine', () => {
      const jours7 = Array.from({ length: 7 }, (_, index) =>
        construireJour({ dateIso: `2026-08-1${index}`, date: new Date(2026, 7, 10 + index) }),
      );
      const { container: conteneurSemaine } = render(
        <GrilleAgendaSemaine jours={jours7} onCliquerJour={vi.fn()} onOuvrirRendezVous={vi.fn()} />,
      );
      expect(conteneurSemaine.querySelector('[role="grid"]')?.className).toContain(
        'min-[1360px]:grid-cols-7',
      );

      const { container: conteneurJour } = render(
        <GrilleAgendaSemaine
          jours={[construireJour()]}
          onCliquerJour={vi.fn()}
          onOuvrirRendezVous={vi.fn()}
        />,
      );
      expect(conteneurJour.querySelector('[role="grid"]')?.className).not.toContain(
        'min-[1360px]:grid-cols-7',
      );
    });
  });
});
