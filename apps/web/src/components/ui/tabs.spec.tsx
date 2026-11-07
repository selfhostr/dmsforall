import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Segments } from '@/composants/commun/Segments';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

describe('Tabs (composant unique d’onglets et de segments)', () => {
  it('onglets soulignés : cible de 44 px (jeton --cible-tactile), jamais h-9', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Fiche">
          <TabsTrigger value="a">Résumé</TabsTrigger>
          <TabsTrigger value="b">Historique</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A</TabsContent>
      </Tabs>,
    );
    for (const onglet of screen.getAllByRole('tab')) {
      expect(onglet.className).toContain('h-[var(--cible-tactile,2.75rem)]');
      expect(onglet.className).not.toMatch(/\bh-(8|9|10)\b/);
    }
  });

  it('segments : cible de 44 px, rôle tab, flèche droite déplace le focus, Entrée active', async () => {
    const utilisateur = userEvent.setup();
    function Exemple() {
      const [valeur, setValeur] = useState<'liste' | 'plan'>('liste');
      return (
        <Segments
          valeur={valeur}
          onChange={setValeur}
          ariaLabel="Affichage"
          options={[
            { valeur: 'liste', libelle: 'Liste' },
            { valeur: 'plan', libelle: 'Plan' },
          ]}
        />
      );
    }
    render(<Exemple />);

    const tabs = screen.getAllByRole('tab');
    expect(screen.getByRole('tablist', { name: 'Affichage' })).toBeInTheDocument();
    for (const segment of tabs) {
      expect(segment.className).toContain('h-[var(--cible-tactile,2.75rem)]');
    }
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    tabs[0]?.focus();
    await utilisateur.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveFocus();
    await utilisateur.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
  });
});
