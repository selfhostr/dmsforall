import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BandeauAlerteClient } from './BandeauAlerteClient';

describe('BandeauAlerteClient', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it("ne rend rien pour un client sans alerte ni blocage", () => {
    const { container } = render(<BandeauAlerteClient />);
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche « Bloqué – impayés » pour un client bloqué', () => {
    render(<BandeauAlerteClient bloque />);
    expect(screen.getByText('Bloqué – impayés')).toBeInTheDocument();
  });

  it('affiche chaque note d’alerte (texte du client, jamais retraduit)', () => {
    render(
      <BandeauAlerteClient
        alertes={[
          { id: 'n1', texte: 'Paie toujours en retard.' },
          { id: 'n2', texte: 'Exiger un acompte à la restitution.' },
        ]}
      />,
    );
    expect(screen.getByText('Paie toujours en retard.')).toBeInTheDocument();
    expect(screen.getByText('Exiger un acompte à la restitution.')).toBeInTheDocument();
  });

  it('traduit « Bloqué – impayés » en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BandeauAlerteClient bloque />);
    expect(screen.getByText('Gesperrt – Zahlungsrückstände')).toBeInTheDocument();
  });
});
