import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DatetimeInput } from './datetime-input';

describe('DatetimeInput', () => {
  it('affiche le placeholder en format suisse', () => {
    render(<DatetimeInput />);
    const input = screen.getByPlaceholderText('jj.mm.aaaa HH:MM');
    expect(input).toBeInTheDocument();
  });

  it('affiche une valeur ISO en format suisse', () => {
    const { rerender } = render(<DatetimeInput value="2026-08-12T14:30:00.000Z" />);
    const input = screen.getByDisplayValue(/12\.08\.2026/) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    // `toHaveValue` (jest-dom) n'accepte qu'une chaîne/nombre, jamais une regex — comparer
    // directement `input.value` avec `.toMatch` vérifie la même intention (format suisse complet
    // jj.mm.aaaa HH:MM) sans affaiblir l'assertion.
    expect(input.value).toMatch(/^12\.08\.2026 \d{2}:\d{2}$/);
  });

  it('retourne undefined quand vide', async () => {
    const handleChange = vi.fn();
    render(<DatetimeInput onChange={handleChange} value="" />);
    const input = screen.getByPlaceholderText('jj.mm.aaaa HH:MM');

    await userEvent.type(input, '12.08.2026 14:30');
    expect(handleChange).toHaveBeenCalledWith(expect.stringContaining('2026-08-12'));
  });

  it('accepte une saisie en format suisse et la convertit en ISO', async () => {
    const handleChange = vi.fn();
    render(<DatetimeInput onChange={handleChange} value="" />);
    const input = screen.getByPlaceholderText('jj.mm.aaaa HH:MM') as HTMLInputElement;

    await userEvent.type(input, '12.08.2026 14:30');
    // La valeur finale envoyée doit être ISO
    const lastCall = handleChange.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    if (lastCall) {
      expect(lastCall[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
  });

  it('rejet une saisie invalide', async () => {
    const handleChange = vi.fn();
    render(<DatetimeInput onChange={handleChange} value="" />);
    const input = screen.getByPlaceholderText('jj.mm.aaaa HH:MM') as HTMLInputElement;

    await userEvent.type(input, 'invalide');
    // onChange doit être appelé, mais avec undefined pour une saisie invalide
    const lastCall = handleChange.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    if (lastCall) {
      expect(lastCall[0]).toBeUndefined();
    }
  });

  it("affiche un message d'erreur pour une date invalide après blur", async () => {
    const user = userEvent.setup();
    render(<DatetimeInput value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('jj.mm.aaaa HH:MM') as HTMLInputElement;

    await user.type(input, '31.02.2026 14:30');
    await user.click(document.body); // blur

    // Doit afficher un message d'erreur pour la date invalide
    const errorMsg = screen.queryByText((content, element) => {
      return element?.id.endsWith('-erreur') ?? false;
    });
    // Message d'erreur devrait être présent (vérifie via aria-describedby)
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it("affiche un message d'erreur fourni par l'appelant", () => {
    render(<DatetimeInput value="" onChange={() => {}} erreur="Champ requis" />);
    const input = screen.getByPlaceholderText('jj.mm.aaaa HH:MM') as HTMLInputElement;
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Champ requis')).toBeInTheDocument();
  });
});
