import type { VehiculeResume } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { CarteVehicule } from './CarteVehicule';

const VEHICULE: VehiculeResume = {
  id: 'v1',
  // Forme réelle envoyée par le serveur (`VehiculeResume.plaque`) : le canton y est déjà inclus en
  // préfixe (voir `composants/identite/Plaque.tsx`) — un fixture sans préfixe ne reproduit jamais
  // le doublon "VD VD 123456" que ce test doit surveiller.
  plaque: 'VD 123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
  emplacementLibre: null,
};

describe('CarteVehicule', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it("compose l'identité véhicule (invariant n°1) et le VIN copiable", () => {
    render(<CarteVehicule vehicule={VEHICULE} />);
    expect(screen.getByText('VD')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('WVGZZZ1TZ8W123456')).toBeInTheDocument();
  });

  it("n'est pas cliquable sans onOuvrir", () => {
    // Un seul bouton attendu : le VIN copiable (`BoutonCopier`) est TOUJOURS un vrai `<button>`,
    // avec ou sans `onOuvrir` — `queryByRole('button')` seul serait donc ambigu ici.
    render(<CarteVehicule vehicule={VEHICULE} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('appelle onOuvrir au clic, à Entrée et à Espace quand fourni (rôle button, pas link : les deux touches sont valides)', async () => {
    const onOuvrir = vi.fn();
    const utilisateur = userEvent.setup();
    render(<CarteVehicule vehicule={VEHICULE} onOuvrir={onOuvrir} />);
    // Nom accessible filtré sur la désignation : `getByRole('button')` seul serait ambigu, le VIN
    // copiable (`BoutonCopier`) étant lui aussi un vrai bouton dans l'arbre.
    const carte = screen.getByRole('button', { name: /VW Touran/i });
    await utilisateur.click(carte);
    expect(onOuvrir).toHaveBeenCalledTimes(1);
    carte.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrir).toHaveBeenCalledTimes(2);
    await utilisateur.keyboard(' ');
    expect(onOuvrir).toHaveBeenCalledTimes(3);
  });

  it('le clic sur le bouton copier du VIN ne déclenche pas onOuvrir (stopPropagation)', async () => {
    const onOuvrir = vi.fn();
    const utilisateur = userEvent.setup();
    render(<CarteVehicule vehicule={VEHICULE} onOuvrir={onOuvrir} />);
    const boutonCopier = screen.getByRole('button', { name: /copier/i });
    await utilisateur.click(boutonCopier);
    expect(onOuvrir).not.toHaveBeenCalled();
  });

  it('affiche le badge identification incomplète (RM-16), traduit en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<CarteVehicule vehicule={{ ...VEHICULE, identificationIncomplete: true }} />);
    expect(screen.getByText('Identifikation unvollständig')).toBeInTheDocument();
  });
});
