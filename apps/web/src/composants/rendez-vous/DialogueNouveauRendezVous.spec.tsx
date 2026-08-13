import type { ClientResume, ReponseMotifRendezVous, VehiculeResume } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { DialogueNouveauRendezVous } from './DialogueNouveauRendezVous';

// Radix Select (`@radix-ui/react-select`) appelle `hasPointerCapture`/`scrollIntoView`, absents de
// jsdom — même stub que `composants/comptoir/SelecteurTri.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CLIENT: ClientResume = {
  id: '11111111-1111-4111-8111-111111111111',
  numeroClient: 'C-000001',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 1,
  dernierPassageLe: null,
};

const VEHICULE: VehiculeResume = {
  id: '22222222-2222-4222-8222-222222222222',
  plaque: 'VS 123456',
  canton: 'VS',
  designation: 'VW Golf',
  vin: null,
  premiereMiseEnCirculationLe: null,
  identificationIncomplete: false,
  emplacementLibre: null,
};

const SITE = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'SION',
  nom: 'Garage Martin — Sion',
  actif: true,
};

const MOTIFS: ReponseMotifRendezVous[] = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    code: 'SERVICE',
    libelleFr: 'Entretien / service courant',
    libelleDe: 'Service / Wartung',
    libelleIt: 'Tagliando / manutenzione',
    dureeDefautMinutes: 60,
    heuresAtelierDefautCentiemes: null,
    actif: true,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    code: 'A-DETERMINER',
    libelleFr: 'À déterminer — diagnostic au comptoir',
    libelleDe: null,
    libelleIt: null,
    dureeDefautMinutes: 30,
    heuresAtelierDefautCentiemes: null,
    actif: true,
  },
];

describe('DialogueNouveauRendezVous', () => {
  it('affiche le sujet déjà connu SANS sélecteur, avec un lien "Changer" (points d’entrée 2/3)', () => {
    render(
      <DialogueNouveauRendezVous
        ouvert
        onOpenChange={vi.fn()}
        client={CLIENT}
        vehicule={VEHICULE}
        onChangerClient={vi.fn()}
        onChangerVehicule={vi.fn()}
        site={SITE}
        motifsDisponibles={MOTIFS}
        onConfirmer={vi.fn()}
      />,
    );
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Changer' })).toHaveLength(2);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('propose « À déterminer — diagnostic au comptoir » comme un motif réel de la liste', async () => {
    const utilisateur = userEvent.setup();
    render(
      <DialogueNouveauRendezVous
        ouvert
        onOpenChange={vi.fn()}
        client={CLIENT}
        vehicule={VEHICULE}
        site={SITE}
        dateInitiale="2026-08-20"
        motifsDisponibles={MOTIFS}
        onConfirmer={vi.fn()}
      />,
    );
    await utilisateur.click(screen.getByRole('combobox', { name: 'Motif du rendez-vous' }));
    expect(screen.getByText('À déterminer — diagnostic au comptoir')).toBeInTheDocument();
  });

  it('refuse la confirmation sans motif ni moment choisis (obligatoires)', async () => {
    const utilisateur = userEvent.setup();
    const onConfirmer = vi.fn();
    render(
      <DialogueNouveauRendezVous
        ouvert
        onOpenChange={vi.fn()}
        client={CLIENT}
        vehicule={VEHICULE}
        site={SITE}
        dateInitiale="2026-08-20"
        motifsDisponibles={MOTIFS}
        onConfirmer={onConfirmer}
      />,
    );
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer le rendez-vous' }));
    expect(onConfirmer).not.toHaveBeenCalled();
    expect(screen.getAllByText('Ce champ est obligatoire.').length).toBeGreaterThan(0);
  });

  it('confirme un rendez-vous valide et préremplit la durée depuis le motif choisi', async () => {
    const utilisateur = userEvent.setup();
    const onConfirmer = vi.fn();
    render(
      <DialogueNouveauRendezVous
        ouvert
        onOpenChange={vi.fn()}
        client={CLIENT}
        vehicule={VEHICULE}
        site={SITE}
        dateInitiale="2026-08-20"
        motifsDisponibles={MOTIFS}
        onConfirmer={onConfirmer}
      />,
    );
    await utilisateur.click(screen.getByRole('combobox', { name: 'Moment' }));
    await utilisateur.click(screen.getByText('Matin'));
    await utilisateur.click(screen.getByRole('combobox', { name: 'Motif du rendez-vous' }));
    await utilisateur.click(screen.getByText('Entretien / service courant'));
    expect(screen.getByLabelText('Durée estimée (min)')).toHaveValue(60);
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer le rendez-vous' }));
    expect(onConfirmer).toHaveBeenCalledWith(
      expect.objectContaining({
        motifId: '44444444-4444-4444-8444-444444444444',
        moment: 'matin',
        dureeEstimeeMinutes: 60,
      }),
    );
  });

  it('conserve la saisie et affiche le message d’échec au lieu de vider le formulaire', () => {
    render(
      <DialogueNouveauRendezVous
        ouvert
        onOpenChange={vi.fn()}
        client={CLIENT}
        vehicule={VEHICULE}
        site={SITE}
        dateInitiale="2026-08-20"
        motifsDisponibles={MOTIFS}
        onConfirmer={vi.fn()}
        erreur="Le rendez-vous n’a pas pu être enregistré. Vos informations sont conservées, corrigez et réessayez."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('conservées');
    expect(screen.getByLabelText('Date du rendez-vous')).toHaveValue('20.08.2026');
  });

  it('ferme sans confirmation supplémentaire au clic sur Annuler', async () => {
    const utilisateur = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <DialogueNouveauRendezVous
        ouvert
        onOpenChange={onOpenChange}
        client={CLIENT}
        vehicule={VEHICULE}
        site={SITE}
        motifsDisponibles={MOTIFS}
        onConfirmer={vi.fn()}
      />,
    );
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
