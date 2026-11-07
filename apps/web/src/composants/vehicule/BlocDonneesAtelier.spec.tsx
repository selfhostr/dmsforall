import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BlocDonneesAtelier, type DonneesAtelierVehicule } from './BlocDonneesAtelier';

const TOUT_VIDE: DonneesAtelierVehicule = {
  pneusEte: null,
  pneusHiver: null,
  pressionPneus: null,
  huileType: null,
  huileQuantiteDl: null,
  batterie: null,
  codeRadio: null,
  codeCle: null,
  intervalleEntretienKm: null,
  intervalleEntretienMois: null,
};

describe('BlocDonneesAtelier', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('rend uniquement les champs renseignés, jamais une grille de champs vides', () => {
    render(
      <BlocDonneesAtelier donnees={{ ...TOUT_VIDE, codeRadio: 'AX4471', batterie: '12V 70Ah' }} />,
    );
    expect(screen.getByText('AX4471')).toBeInTheDocument();
    expect(screen.getByText('12V 70Ah')).toBeInTheDocument();
    expect(screen.queryByText('Pneus')).not.toBeInTheDocument();
  });

  it('affiche un état vide dédié quand aucune donnée n’est renseignée', () => {
    render(<BlocDonneesAtelier donnees={TOUT_VIDE} />);
    // Le titre de la carte n'est pas répété dans l'état vide : une seule occurrence.
    expect(screen.getAllByText("Données d'atelier")).toHaveLength(1);
    expect(screen.queryByRole('definition')).not.toBeInTheDocument();
  });

  it('offre un bouton de copie pour le code radio (lu au téléphone au comptoir)', () => {
    render(<BlocDonneesAtelier donnees={{ ...TOUT_VIDE, codeRadio: 'AX4471' }} />);
    expect(screen.getByRole('button', { name: 'Copier' })).toBeInTheDocument();
  });

  it('traduit le libellé du code radio en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BlocDonneesAtelier donnees={{ ...TOUT_VIDE, codeRadio: 'AX4471' }} />);
    expect(screen.getByText('Radiocode')).toBeInTheDocument();
  });
});
