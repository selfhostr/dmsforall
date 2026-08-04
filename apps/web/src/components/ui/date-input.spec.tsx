import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { DateInput } from './date-input';

describe('DateInput', () => {
  it('ne rend qu’un seul élément <input> (pas de champ caché)', () => {
    const { container } = render(<DateInput aria-label="Date" value={null} onChange={vi.fn()} />);
    expect(container.querySelectorAll('input')).toHaveLength(1);
  });

  it('affiche une valeur ISO en prop au format suisse', () => {
    render(
      <DateInput id="date-affichage" aria-label="Date" value="2026-08-04" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('04.08.2026');
  });

  it('taper une date suisse valide appelle onChange avec l’ISO correspondant', async () => {
    const onChange = vi.fn();
    const utilisateur = userEvent.setup();
    render(<DateInput id="date-saisie" aria-label="Date" value={null} onChange={onChange} />);

    await utilisateur.type(screen.getByLabelText('Date'), '04.08.2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-08-04');
  });

  it('coller/saisir directement une chaîne ISO dans le champ texte est accepté', async () => {
    const onChange = vi.fn();
    const utilisateur = userEvent.setup();
    render(<DateInput id="date-iso" aria-label="Date" value={null} onChange={onChange} />);

    await utilisateur.type(screen.getByLabelText('Date'), '2026-08-04');
    expect(onChange).toHaveBeenLastCalledWith('2026-08-04');
  });

  it('une saisie non vide invalide n’émet jamais d’ISO, et devient visible comme invalide après blur', async () => {
    const onChange = vi.fn();
    const utilisateur = userEvent.setup();
    render(<DateInput id="date-invalide" aria-label="Date" value={null} onChange={onChange} />);

    const champ = screen.getByLabelText('Date');
    await utilisateur.type(champ, '31.02.2026');
    expect(onChange).toHaveBeenLastCalledWith(undefined);

    // Pas encore signalé invalide avant la perte de focus (pas de cri pendant la frappe).
    expect(champ).not.toHaveAttribute('aria-invalid', 'true');

    await utilisateur.tab();
    expect(champ).toHaveAttribute('aria-invalid', 'true');
    const messageErreur = document.getElementById('date-invalide-erreur');
    expect(messageErreur).not.toBeNull();
    expect(messageErreur?.textContent).toBeTruthy();
  });

  it('un texte non interprétable ("abc") est traité de la même façon qu’une date inexistante', async () => {
    const onChange = vi.fn();
    const utilisateur = userEvent.setup();
    render(<DateInput id="date-abc" aria-label="Date" value={null} onChange={onChange} />);

    const champ = screen.getByLabelText('Date');
    await utilisateur.type(champ, 'abc');
    await utilisateur.tab();

    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(champ).toHaveAttribute('aria-invalid', 'true');
  });

  it('resynchronise l’affichage quand la prop value change depuis l’extérieur', () => {
    const { rerender } = render(
      <DateInput id="date-resync" aria-label="Date" value="2026-08-04" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('04.08.2026');

    rerender(
      <DateInput id="date-resync" aria-label="Date" value="2026-01-01" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('01.01.2026');
  });

  it('la prop erreur externe est affichée et prioritaire sur le message interne', async () => {
    const utilisateur = userEvent.setup();
    render(
      <DateInput
        id="date-erreur-externe"
        aria-label="Date"
        value={null}
        onChange={vi.fn()}
        erreur="Ce champ est obligatoire."
      />,
    );

    const champ = screen.getByLabelText('Date');
    await utilisateur.type(champ, 'abc');
    await utilisateur.tab();

    expect(screen.getByText('Ce champ est obligatoire.')).toBeInTheDocument();
    // Un seul message affiché — pas de doublon avec le message interne « format invalide ».
    const messageErreur = document.getElementById('date-erreur-externe-erreur');
    expect(messageErreur?.textContent).toBe('Ce champ est obligatoire.');
  });
});
