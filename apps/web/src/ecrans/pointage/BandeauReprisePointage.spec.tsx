import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { BandeauReprisePointage } from './BandeauReprisePointage';

describe('BandeauReprisePointage', () => {
  it('affiche le titre « Reprendre : {cible} » et le sous-texte « Interrompu il y a… »', () => {
    render(
      <BandeauReprisePointage
        cibleLibelle="OR-000123 — OR entier"
        interrompuDepuisLe={new Date(Date.now() - 12 * 60 * 1000).toISOString()}
        cumulAujourdhuiSecondes={undefined}
        onReprendre={vi.fn()}
        enTraitement={false}
      />,
    );

    expect(screen.getByText('Reprendre : OR-000123 — OR entier')).toBeInTheDocument();
    expect(screen.getByText(/Interrompu il y a/)).toBeInTheDocument();
  });

  it('n’affiche PAS le sous-texte de cumul quand `cumulAujourdhuiSecondes` est nul/absent', () => {
    render(
      <BandeauReprisePointage
        cibleLibelle="OR-000123 — OR entier"
        interrompuDepuisLe={new Date().toISOString()}
        cumulAujourdhuiSecondes={0}
        onReprendre={vi.fn()}
        enTraitement={false}
      />,
    );

    expect(screen.queryByText(/déjà pointées aujourd'hui/)).not.toBeInTheDocument();
  });

  it('affiche le cumul du jour dès qu’il est non nul, en complément du texte d’interruption', () => {
    render(
      <BandeauReprisePointage
        cibleLibelle="OR-000123 — OR entier"
        interrompuDepuisLe={new Date().toISOString()}
        cumulAujourdhuiSecondes={2880}
        onReprendre={vi.fn()}
        enTraitement={false}
      />,
    );

    expect(screen.getByText(/48 min déjà pointées aujourd'hui/)).toBeInTheDocument();
  });

  it('un seul appui déclenche `onReprendre` — pas de modale, pas de question intermédiaire', async () => {
    const onReprendre = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <BandeauReprisePointage
        cibleLibelle="OR-000123 — OR entier"
        interrompuDepuisLe={new Date().toISOString()}
        cumulAujourdhuiSecondes={undefined}
        onReprendre={onReprendre}
        enTraitement={false}
      />,
    );

    await utilisateur.click(
      screen.getByRole('button', { name: 'Reprendre le pointage sur OR-000123 — OR entier' }),
    );

    expect(onReprendre).toHaveBeenCalledTimes(1);
  });

  it('se désactive pendant un traitement en cours', () => {
    render(
      <BandeauReprisePointage
        cibleLibelle="OR-000123 — OR entier"
        interrompuDepuisLe={new Date().toISOString()}
        cumulAujourdhuiSecondes={undefined}
        onReprendre={vi.fn()}
        enTraitement
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Reprendre le pointage sur OR-000123 — OR entier' }),
    ).toBeDisabled();
  });
});
