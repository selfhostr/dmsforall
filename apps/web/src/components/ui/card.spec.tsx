import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card, CardContent, CardFooter, CardHeader } from './card';

/**
 * Refonte visuelle — voir DESIGN.md, « Bordure structurelle uniquement ». Deux promesses à
 * verrouiller :
 *  1. `Card` ne cumule plus `border` et `shadow-sm` (M3 : outline et elevation sont deux
 *     alternatives, jamais cumulées) — seule une surface (`bg-card`) sépare la carte du fond.
 *  2. Le levier de densité compacte (`--espace-carte-compacte`, DESIGN.md « Densité et
 *     espacement ») bascule `CardHeader`/`CardContent`/`CardFooter` de `p-carte` vers
 *     `p-carte-compacte` quand `Card` porte `compact`, par contexte React — sans que ces trois
 *     composants n'aient chacun leur propre prop à répéter.
 */
describe('Card', () => {
  it('ne porte ni border ni shadow — la séparation vient de la surface, pas d’un trait ou d’une ombre', () => {
    render(<Card data-testid="carte">contenu</Card>);
    const carte = screen.getByTestId('carte');
    expect(carte.className).toContain('bg-card');
    expect(carte.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(carte.className).not.toMatch(/shadow-sm/);
  });

  it('CardHeader/CardContent/CardFooter utilisent p-carte par défaut (compact absent)', () => {
    render(
      <Card>
        <CardHeader data-testid="entete">e</CardHeader>
        <CardContent data-testid="contenu">c</CardContent>
        <CardFooter data-testid="pied">p</CardFooter>
      </Card>,
    );
    expect(screen.getByTestId('entete').className).toMatch(/(^|\s)p-carte(\s|$)/);
    expect(screen.getByTestId('entete').className).not.toContain('p-carte-compacte');
    expect(screen.getByTestId('contenu').className).toMatch(/(^|\s)p-carte(\s|$)/);
    expect(screen.getByTestId('contenu').className).not.toContain('p-carte-compacte');
    expect(screen.getByTestId('pied').className).toMatch(/(^|\s)p-carte(\s|$)/);
    expect(screen.getByTestId('pied').className).not.toContain('p-carte-compacte');
  });

  it('bascule vers p-carte-compacte quand Card porte compact, sur les trois sous-composants', () => {
    render(
      <Card compact>
        <CardHeader data-testid="entete">e</CardHeader>
        <CardContent data-testid="contenu">c</CardContent>
        <CardFooter data-testid="pied">p</CardFooter>
      </Card>,
    );
    expect(screen.getByTestId('entete').className).toContain('p-carte-compacte');
    expect(screen.getByTestId('contenu').className).toContain('p-carte-compacte');
    expect(screen.getByTestId('pied').className).toContain('p-carte-compacte');
    // Aucun des trois ne doit garder `p-carte` (sans suffixe) en même temps que le compact —
    // sinon les deux classes Tailwind coexisteraient et l'ordre de génération déciderait laquelle
    // gagne, un résultat non déterministe plutôt qu'un choix explicite.
    expect(screen.getByTestId('entete').className).not.toMatch(/(^|\s)p-carte(\s|$)/);
    expect(screen.getByTestId('contenu').className).not.toMatch(/(^|\s)p-carte(\s|$)/);
    expect(screen.getByTestId('pied').className).not.toMatch(/(^|\s)p-carte(\s|$)/);
  });

  it("un CardHeader hors d'une Card compacte n'est pas affecté par une autre Card compacte du même arbre", () => {
    // Le contexte de densité est posé par CHAQUE `Card`, jamais globalement : deux cartes
    // voisines, l'une compacte et l'autre non, ne doivent pas se contaminer.
    render(
      <div>
        <Card compact>
          <CardContent data-testid="compacte">a</CardContent>
        </Card>
        <Card>
          <CardContent data-testid="normale">b</CardContent>
        </Card>
      </div>,
    );
    expect(screen.getByTestId('compacte').className).toContain('p-carte-compacte');
    expect(screen.getByTestId('normale').className).toMatch(/(^|\s)p-carte(\s|$)/);
    expect(screen.getByTestId('normale').className).not.toContain('p-carte-compacte');
  });
});
