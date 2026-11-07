import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { OrDuJour } from '@/hooks/pointage/useMesOrdresAssignes';

import '@/i18n';

import { CarteOrDuJour } from './CarteOrDuJour';

function orDe(surcharge: Partial<OrDuJour> = {}): OrDuJour {
  return {
    id: 'or-1',
    numero: 'OR-2026-2',
    siteId: 'site-sion',
    restitutionPromiseLe: '2026-11-07T15:30:00.000Z',
    enRetard: false,
    vehicule: {
      id: 'v1',
      plaque: '55512',
      canton: 'VS',
      designation: 'VW Golf 1.4',
      vin: null,
      premiereMiseEnCirculationLe: null,
      identificationIncomplete: false,
      emplacementLibre: null,
    },
    client: {
      id: 'c1',
      numeroClient: 'CL-000123',
      nomAffiche: 'Jean Dupont',
      type: 'particulier',
      statut: 'actif',
      langueCorrespondance: 'fr',
      poObligatoire: false,
      telephone: null,
      localite: 'Sion',
      nombreVehicules: 1,
      dernierPassageLe: null,
    },
    lignesAssignees: 1,
    ...surcharge,
  } as unknown as OrDuJour;
}

function afficher(props: Partial<Parameters<typeof CarteOrDuJour>[0]> = {}) {
  const onChoisir = vi.fn();
  render(<CarteOrDuJour or={orDe()} onChoisir={onChoisir} desactive={false} {...props} />);
  return onChoisir;
}

describe('CarteOrDuJour', () => {
  it('affiche la restitution promise (date et heure) sans alarme tant qu’elle n’est pas dépassée', () => {
    afficher();
    const echeance = screen.getByText(/Retour promis 07\.11\.2026/);
    expect(echeance.className).not.toContain('text-destructive');
    expect(screen.queryByText(/En retard/)).toBeNull();
  });

  it('passe l’échéance en rouge avec le mot « En retard » quand le serveur la dit dépassée', () => {
    afficher({ or: orDe({ enRetard: true }) });
    const echeance = screen.getByText(/En retard, promis 07\.11\.2026/);
    expect(echeance.className).toContain('text-destructive');
  });

  it('n’affiche rien d’échéance quand aucune restitution n’est promise (≠ retard)', () => {
    afficher({ or: orDe({ restitutionPromiseLe: null }) });
    expect(screen.queryByText(/Retour promis|En retard/)).toBeNull();
  });

  it('étiquette le site quand il est fourni', () => {
    afficher({ siteNom: 'Martigny' });
    expect(screen.getByText('Martigny')).toBeInTheDocument();
  });

  it('un OR d’un autre site est désactivé et dit où pointer, avec le nom du site', async () => {
    const onChoisir = afficher({ horsSite: true, siteNom: 'Martigny' });
    const bouton = screen.getByRole('button');
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Site Martigny : pointez depuis la borne de ce site')).toBeVisible();
    await userEvent
      .setup()
      .click(bouton)
      .catch(() => undefined);
    expect(onChoisir).not.toHaveBeenCalled();
  });

  it('un OR d’un autre site sans nom connu reste explicite', () => {
    afficher({ horsSite: true });
    expect(screen.getByText('Autre site : pointez depuis la borne de ce site')).toBeVisible();
  });

  it('borne (`grand`) : numéro d’OR, désignation et échéance à 24 px (text-2xl), plaque au palier xl', () => {
    afficher({ grand: true });
    expect(screen.getByText('OR-2026-2').className).toContain('text-2xl');
    expect(screen.getByText('VW Golf 1.4').className).toContain('text-2xl');
    expect(screen.getByText(/Retour promis/).className).toContain('text-2xl');
    expect(screen.getByText('55512').closest('span.texte-donnee-proeminente')).not.toBeNull();
  });

  it('hors borne, le numéro d’OR garde la taille courante', () => {
    afficher();
    expect(screen.getByText('OR-2026-2').className).not.toContain('text-2xl');
  });
});
