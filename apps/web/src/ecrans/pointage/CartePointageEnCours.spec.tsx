import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReponsePointage, VehiculeResume } from '@dfa/shared';

import '@/i18n';

import { CartePointageEnCours } from './CartePointageEnCours';

const POINTAGE: ReponsePointage = {
  id: 'pointage-1',
  siteId: 'site-1',
  technicienId: 'technicien-1',
  technicienNomAffiche: 'Jean Dupont',
  statut: 'en_cours',
  nature: 'productif_or',
  ordreReparationId: 'or-1',
  ordreReparationNumero: 'OR-000123',
  ligneOrId: null,
  ligneOrDesignation: null,
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

describe('CartePointageEnCours', () => {
  it(
    'correctif #117 : le bouton « Changer » n’apparaît que si `onChanger` est fourni, et ' +
      'déclenche exactement ce callback (jamais `onArreter`/`onPause`)',
    async () => {
      const onChanger = vi.fn();
      const onArreter = vi.fn();
      const onPause = vi.fn();

      const utilisateur = userEvent.setup();
      render(
        <CartePointageEnCours
          pointage={POINTAGE}
          libelleCible="OR-000123 — OR entier"
          onArreter={onArreter}
          onPause={onPause}
          onReprendre={undefined}
          onChanger={onChanger}
          enTraitement={false}
          messageErreur={undefined}
          avertissement={undefined}
          cumulAujourdhuiSecondes={undefined}
        />,
      );

      const bouton = screen.getByRole('button', { name: 'Changer' });
      await utilisateur.click(bouton);

      expect(onChanger).toHaveBeenCalledTimes(1);
      expect(onArreter).not.toHaveBeenCalled();
      expect(onPause).not.toHaveBeenCalled();
    },
  );

  it('n’affiche aucun bouton « Changer » quand `onChanger` est `undefined`', () => {
    render(
      <CartePointageEnCours
        pointage={POINTAGE}
        libelleCible="OR-000123 — OR entier"
        onArreter={vi.fn()}
        onPause={undefined}
        onReprendre={undefined}
        onChanger={undefined}
        enTraitement={false}
        messageErreur={undefined}
        avertissement={undefined}
        cumulAujourdhuiSecondes={undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Changer' })).not.toBeInTheDocument();
  });

  it(
    'affiche l’avertissement de clôture automatique (variante non destructive), distinct du ' +
      'message d’erreur — les deux peuvent coexister sans se confondre',
    () => {
      render(
        <CartePointageEnCours
          pointage={POINTAGE}
          libelleCible="OR-000123 — OR entier"
          onArreter={vi.fn()}
          onPause={undefined}
          onReprendre={undefined}
          onChanger={vi.fn()}
          enTraitement={false}
          messageErreur={undefined}
          avertissement="Ce pointage a été clôturé automatiquement à la fermeture."
          cumulAujourdhuiSecondes={undefined}
        />,
      );

      expect(
        screen.getByText('Ce pointage a été clôturé automatiquement à la fermeture.'),
      ).toBeInTheDocument();
    },
  );

  it('désactive tous les boutons, y compris « Changer », pendant un traitement en cours', () => {
    render(
      <CartePointageEnCours
        pointage={POINTAGE}
        libelleCible="OR-000123 — OR entier"
        onArreter={vi.fn()}
        onPause={vi.fn()}
        onReprendre={undefined}
        onChanger={vi.fn()}
        enTraitement
        messageErreur={undefined}
        avertissement={undefined}
        cumulAujourdhuiSecondes={undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Changer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mettre en pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Arrêter' })).toBeDisabled();
  });

  it(
    'point 6 (« deux nombres ») : n’affiche AUCUN cumul quand `cumulAujourdhuiSecondes` est nul ' +
      'ou absent — première visite du jour sur cette cible, le chrono seul suffit',
    () => {
      render(
        <CartePointageEnCours
          pointage={POINTAGE}
          libelleCible="OR-000123 — OR entier"
          onArreter={vi.fn()}
          onPause={vi.fn()}
          onReprendre={undefined}
          onChanger={undefined}
          enTraitement={false}
          messageErreur={undefined}
          avertissement={undefined}
          cumulAujourdhuiSecondes={0}
        />,
      );

      expect(screen.queryByText(/Aujourd'hui sur cette cible/)).not.toBeInTheDocument();
    },
  );

  it('point 6 (« deux nombres ») : affiche le cumul du jour à côté du chrono dès qu’il est non nul', () => {
    render(
      <CartePointageEnCours
        pointage={POINTAGE}
        libelleCible="OR-000123 — OR entier"
        onArreter={vi.fn()}
        onPause={vi.fn()}
        onReprendre={undefined}
        onChanger={undefined}
        enTraitement={false}
        messageErreur={undefined}
        avertissement={undefined}
        cumulAujourdhuiSecondes={2880}
      />,
    );

    expect(screen.getByText("Aujourd'hui sur cette cible : 48 min")).toBeInTheDocument();
  });

  it('l’arrêt n’est plus une action « destructive » (rouge) — geste répété, pas dangereux', () => {
    render(
      <CartePointageEnCours
        pointage={POINTAGE}
        libelleCible="OR-000123 — OR entier"
        onArreter={vi.fn()}
        onPause={vi.fn()}
        onReprendre={undefined}
        onChanger={undefined}
        enTraitement={false}
        messageErreur={undefined}
        avertissement={undefined}
        cumulAujourdhuiSecondes={undefined}
      />,
    );

    const boutonArreter = screen.getByRole('button', { name: 'Arrêter' });
    expect(boutonArreter.className).not.toContain('destructive');
  });

  it('borne (`grand`) : état, cible et désignation du véhicule à 24 px, plaque au palier xl', () => {
    render(
      <CartePointageEnCours
        pointage={POINTAGE}
        libelleCible="OR-000123 — OR entier"
        onArreter={vi.fn()}
        onPause={undefined}
        onReprendre={undefined}
        onChanger={undefined}
        enTraitement={false}
        messageErreur={undefined}
        avertissement={undefined}
        cumulAujourdhuiSecondes={undefined}
        grand
        vehicule={
          {
            id: 'v1',
            canton: 'VS',
            plaque: '55512',
            designation: 'VW Golf 1.4',
            premiereMiseEnCirculationLe: null,
          } as unknown as VehiculeResume
        }
      />,
    );
    expect(screen.getByText('En cours').className).toContain('text-2xl');
    expect(screen.getByText('OR-000123 — OR entier').className).toContain('text-2xl');
    expect(screen.getByText('VW Golf 1.4').className).toContain('text-2xl');
    expect(screen.getByText(/^Depuis /).className).toContain('text-2xl');
    expect(screen.getByText('55512').closest('span.texte-donnee-proeminente')).not.toBeNull();
  });

  it('écran personnel (sans `grand`) : ni état « En cours » ni véhicule, tailles inchangées', () => {
    render(
      <CartePointageEnCours
        pointage={POINTAGE}
        libelleCible="OR-000123 — OR entier"
        onArreter={vi.fn()}
        onPause={undefined}
        onReprendre={undefined}
        onChanger={undefined}
        enTraitement={false}
        messageErreur={undefined}
        avertissement={undefined}
        cumulAujourdhuiSecondes={undefined}
      />,
    );
    expect(screen.queryByText('En cours')).toBeNull();
    expect(screen.getByText('OR-000123 — OR entier').className).not.toContain('text-2xl');
  });
});
