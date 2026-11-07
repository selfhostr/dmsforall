import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { PanneauDetailRendezVous } from './PanneauDetailRendezVous';
import type { RendezVousDetail } from './types';

function construireDetail(overrides: Partial<RendezVousDetail> = {}): RendezVousDetail {
  return {
    id: 'rdv-1',
    dateLe: '2026-08-20',
    moment: 'matin',
    heureSouhaitee: '09:00:00',
    dureeEstimeeMinutes: 30,
    clientNom: 'Jean Dupont',
    vehiculePlaque: 'VS 123456',
    vehiculeCanton: 'VS',
    vehiculeDesignation: 'VW Golf',
    motifLibelle: 'Entretien / service courant',
    statut: 'confirme',
    siteNom: 'Garage Martin — Sion',
    remarque: null,
    motifAnnulation: null,
    historique: [],
    ordreReparationId: null,
    ...overrides,
  };
}

function rendre(props: Partial<ComponentProps<typeof PanneauDetailRendezVous>> = {}) {
  return render(
    <MemoryRouter>
      <PanneauDetailRendezVous
        ouvert
        onOpenChange={vi.fn()}
        rendezVous={construireDetail()}
        estJourJOuApres={false}
        delaiGracePasse={false}
        peutAgir
        onVehiculeArrive={vi.fn()}
        onSignalerAbsence={vi.fn()}
        onAnnuler={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('PanneauDetailRendezVous', () => {
  it('avant le jour J : aucune action primaire, seulement Annuler', () => {
    rendre();
    expect(screen.queryByRole('button', { name: /Le client est arrivé/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler le rendez-vous' })).toBeInTheDocument();
  });

  it('le jour J : "Le véhicule est arrivé" devient disponible', () => {
    rendre({ estJourJOuApres: true });
    expect(screen.getByRole('button', { name: /Le client est arrivé/ })).toBeInTheDocument();
  });

  it('masque TOUTES les actions pour un rôle sans droit (technicien) — jamais désactivées, masquées', () => {
    rendre({ estJourJOuApres: true, peutAgir: false });
    expect(screen.queryByRole('button', { name: /Le client est arrivé/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Annuler le rendez-vous' }),
    ).not.toBeInTheDocument();
  });

  it('n’affiche "Signaler l’absence" qu’après le délai de grâce', () => {
    const { rerender } = rendre({ estJourJOuApres: true, delaiGracePasse: false });
    expect(
      screen.queryByRole('button', { name: 'Signaler l’absence du client' }),
    ).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <PanneauDetailRendezVous
          ouvert
          onOpenChange={vi.fn()}
          rendezVous={construireDetail()}
          estJourJOuApres
          delaiGracePasse
          peutAgir
          onVehiculeArrive={vi.fn()}
          onSignalerAbsence={vi.fn()}
          onAnnuler={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: 'Signaler l’absence du client' }),
    ).toBeInTheDocument();
  });

  it('un client absent peut redevenir "arrivé" — le bouton primaire redevient disponible', () => {
    rendre({ rendezVous: construireDetail({ statut: 'absent' }), estJourJOuApres: false });
    expect(screen.getByRole('button', { name: /Le client est arrivé/ })).toBeInTheDocument();
  });

  it('dit la réversibilité AVANT confirmation et exige un motif pour annuler', async () => {
    const utilisateur = userEvent.setup();
    const onAnnuler = vi.fn();
    rendre({ onAnnuler });
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler le rendez-vous' }));
    expect(
      screen.getByText(/n’apparaîtra plus dans l’agenda, mais reste visible/),
    ).toBeInTheDocument();
    const confirmer = screen.getAllByRole('button', { name: 'Annuler le rendez-vous' })[1]!;
    await utilisateur.click(confirmer);
    expect(onAnnuler).not.toHaveBeenCalled();
    expect(screen.getByText('Le motif est obligatoire.')).toBeInTheDocument();
    await utilisateur.type(
      screen.getByLabelText('Motif de l’annulation'),
      'Client ne se présente plus',
    );
    await utilisateur.click(confirmer);
    expect(onAnnuler).toHaveBeenCalledWith('Client ne se présente plus');
  });

  it('statut annulé : lecture seule totale, aucun bouton d’action', () => {
    rendre({ rendezVous: construireDetail({ statut: 'annule' }) });
    expect(screen.getByText('Ce rendez-vous est annulé — lecture seule.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Annuler le rendez-vous' }),
    ).not.toBeInTheDocument();
  });

  it('statut arrivé (honoré) : aucune action ici, lien direct vers l’ordre de réparation', () => {
    rendre({
      rendezVous: construireDetail({ statut: 'honore', ordreReparationId: 'or-9' }),
    });
    expect(screen.getByRole('link', { name: 'Voir l’ordre de réparation' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Annuler le rendez-vous' }),
    ).not.toBeInTheDocument();
  });

  it('téléphone cliquable (tel:), e-mail, durée et véhicule sont affichés', () => {
    rendre({
      rendezVous: construireDetail({
        clientTelephone: '079 123 45 67',
        clientEmail: 'jean@example.ch',
      }),
    });
    expect(screen.getByRole('link', { name: '079 123 45 67' })).toHaveAttribute(
      'href',
      'tel:0791234567',
    );
    expect(screen.getByRole('link', { name: 'jean@example.ch' })).toHaveAttribute(
      'href',
      'mailto:jean@example.ch',
    );
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText('VS 123456 · VW Golf')).toBeInTheDocument();
  });

  it('sans téléphone : le dit en toutes lettres', () => {
    rendre({ rendezVous: construireDetail({ clientTelephone: null }) });
    expect(screen.getByText('Pas de téléphone enregistré')).toBeInTheDocument();
  });

  it('« Déplacer » apparaît pour un rendez-vous confirmé quand fourni', async () => {
    const utilisateur = userEvent.setup();
    const onDeplacer = vi.fn();
    rendre({ onDeplacer });
    await utilisateur.click(screen.getByRole('button', { name: 'Déplacer' }));
    expect(onDeplacer).toHaveBeenCalledOnce();
  });

  it('le bouton d’arrivée dit ce qu’il fait : ouvrir l’ordre de réparation', () => {
    rendre({ estJourJOuApres: true });
    expect(
      screen.getByRole('button', {
        name: 'Le client est arrivé : ouvrir l’ordre de réparation',
      }),
    ).toBeInTheDocument();
  });
});
