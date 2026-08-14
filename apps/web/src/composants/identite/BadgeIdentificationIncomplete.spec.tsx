import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BadgeIdentificationIncomplete } from './BadgeIdentificationIncomplete';

describe('BadgeIdentificationIncomplete', () => {
  it("rend l'icône et le mot quand l'identification est incomplète", () => {
    render(<BadgeIdentificationIncomplete identificationIncomplete />);
    expect(screen.getByText('Numéro de châssis manquant')).toBeInTheDocument();
  });

  it('ne rend rien quand le véhicule est correctement identifié', () => {
    const { container } = render(
      <BadgeIdentificationIncomplete identificationIncomplete={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
