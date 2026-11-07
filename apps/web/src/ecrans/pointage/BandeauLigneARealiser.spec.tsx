import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { BandeauLigneARealiser } from './BandeauLigneARealiser';

function afficher(surcharge: Partial<Parameters<typeof BandeauLigneARealiser>[0]> = {}) {
  const onMarquer = vi.fn();
  const onPlusTard = vi.fn();
  render(
    <BandeauLigneARealiser
      libelle="OR-2026-4 — Vidange"
      fait={false}
      enCours={false}
      messageErreur={undefined}
      onMarquer={onMarquer}
      onPlusTard={onPlusTard}
      {...surcharge}
    />,
  );
  return { onMarquer, onPlusTard };
}

describe('BandeauLigneARealiser', () => {
  it('propose de marquer la ligne réalisée en un geste, ou de ne pas le faire', async () => {
    const { onMarquer, onPlusTard } = afficher();
    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole('button', { name: 'Marquer cette ligne réalisée' }));
    expect(onMarquer).toHaveBeenCalledTimes(1);
    await utilisateur.click(screen.getByRole('button', { name: 'Pas maintenant' }));
    expect(onPlusTard).toHaveBeenCalledTimes(1);
  });

  it('une fois fait, ne garde que la confirmation', () => {
    afficher({ fait: true });
    expect(screen.getByText('Ligne marquée réalisée.')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('affiche l’erreur sans masquer les boutons', () => {
    afficher({ messageErreur: 'Refusé' });
    expect(screen.getByText('Refusé')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
