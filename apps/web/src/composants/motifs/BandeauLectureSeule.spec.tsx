import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BandeauLectureSeule } from './BandeauLectureSeule';

describe('BandeauLectureSeule', () => {
  it('affiche le motif transmis par l’écran appelant', () => {
    render(<BandeauLectureSeule motif="Un OR facturé ne peut pas être réouvert directement." />);
    expect(screen.getByText('Un OR facturé ne peut pas être réouvert directement.')).toBeInTheDocument();
  });
});
