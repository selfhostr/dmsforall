import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Plaque } from './Plaque';

describe('Plaque', () => {
  it('compose canton et numéro', () => {
    render(<Plaque canton="VD" numero="123456" />);
    expect(screen.getByText('VD')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
  });

  it('rend le numéro seul quand le canton est inconnu (plaque étrangère)', () => {
    render(<Plaque canton={null} numero="AB123CD" />);
    expect(screen.getByText('AB123CD')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('rend un tiret neutre quand le véhicule ne porte aucune plaque', () => {
    render(<Plaque canton={null} numero={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
