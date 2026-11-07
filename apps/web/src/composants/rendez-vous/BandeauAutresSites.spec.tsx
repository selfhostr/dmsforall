import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { BandeauAutresSites } from './BandeauAutresSites';

describe('BandeauAutresSites', () => {
  const SITES = [
    { id: 's', nom: 'Sion' },
    { id: 'm', nom: 'Martigny' },
  ];

  it('un seul site : ne rend rien', () => {
    const { container } = render(
      <BandeauAutresSites
        siteId="s"
        sites={[{ id: 's', nom: 'Sion' }]}
        autresSites={[]}
        onChangerSite={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('plusieurs sites : sélecteur compact avec aria-label, sans libellé visible', () => {
    render(
      <BandeauAutresSites siteId="s" sites={SITES} autresSites={[]} onChangerSite={vi.fn()} />,
    );
    expect(screen.getByRole('combobox', { name: 'Site' })).toHaveTextContent('Sion');
    expect(screen.queryByText(/Site affiché/)).not.toBeInTheDocument();
  });

  it('compte les rendez-vous des autres sites et permet de changer de site', async () => {
    const utilisateur = userEvent.setup();
    const onChangerSite = vi.fn();
    render(
      <BandeauAutresSites
        siteId="s"
        sites={SITES}
        portee="jour"
        autresSites={[{ siteId: 'm', nom: 'Martigny', total: 2 }]}
        onChangerSite={onChangerSite}
      />,
    );
    expect(screen.getByText('2 rendez-vous à Martigny ce jour-là')).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Voir l’agenda de Martigny' }));
    expect(onChangerSite).toHaveBeenCalledWith('m');
  });

  it("n'affiche rien pour un site sans rendez-vous", () => {
    render(
      <BandeauAutresSites
        siteId="s"
        sites={SITES}
        autresSites={[{ siteId: 'm', nom: 'Martigny', total: 0 }]}
        onChangerSite={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Martigny/)).not.toBeInTheDocument();
  });
});
