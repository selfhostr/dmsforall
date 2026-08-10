import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Plaque } from './Plaque';

describe('Plaque', () => {
  it('distingue visuellement le canton déjà présent dans le numéro, sans le doubler', () => {
    // `numero` reflète la forme réelle envoyée par le serveur (`VehiculeResume.plaque` /
    // `ReponseVehiculePlaque.valeur`) : le canton y figure déjà en préfixe.
    render(<Plaque canton="VD" numero="VD 123456" />);
    expect(screen.getByText('VD')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.queryByText('VD 123456')).not.toBeInTheDocument();
    expect(screen.queryByText('VD VD 123456')).not.toBeInTheDocument();
  });

  it('ne double jamais le canton (régression) : "VS 123456" reste "VS 123456"', () => {
    render(<Plaque canton="VS" numero="VS 123456" />);
    expect(screen.queryByText('VS VS 123456')).not.toBeInTheDocument();
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    // Reconstitue le texte affiché à partir des deux fragments stylés séparément.
    const conteneur = screen.getByText('123456').parentElement;
    expect(conteneur?.textContent).toBe('VS123456');
  });

  it('rend le numéro seul quand le canton est inconnu (plaque étrangère)', () => {
    render(<Plaque canton={null} numero="AB123CD" />);
    expect(screen.getByText('AB123CD')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('rend le numéro tel quel si le canton fourni ne préfixe pas la valeur (défensif)', () => {
    render(<Plaque canton="VD" numero="AB123CD" />);
    expect(screen.getByText('AB123CD')).toBeInTheDocument();
    expect(screen.queryByText('VD')).not.toBeInTheDocument();
  });

  it('rend un tiret neutre quand le véhicule ne porte aucune plaque', () => {
    render(<Plaque canton={null} numero={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
