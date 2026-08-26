import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TableComptoir, type ColonneComptoir } from './TableComptoir';

interface LigneTest {
  readonly id: string;
  readonly nom: string;
}

const LIGNES: LigneTest[] = [
  { id: '1', nom: 'Alice' },
  { id: '2', nom: 'Bob' },
];

const COLONNES: ColonneComptoir<LigneTest>[] = [
  { id: 'nom', libelle: 'Nom', triable: true, rendu: (ligne) => ligne.nom },
];

describe('TableComptoir', () => {
  it('rend une ligne par élément et déclenche la navigation au clic', async () => {
    const onOuvrirLigne = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        onOuvrirLigne={onOuvrirLigne}
        libelleLigne={(l) => `Ouvrir ${l.nom}`}
      />,
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();

    await utilisateur.click(screen.getByText('Alice'));
    expect(onOuvrirLigne).toHaveBeenCalledWith(LIGNES[0]);
  });

  it('navigue au clavier avec Entrée sur une ligne focalisée', async () => {
    const onOuvrirLigne = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        onOuvrirLigne={onOuvrirLigne}
        libelleLigne={(l) => `Ouvrir ${l.nom}`}
      />,
    );

    // Le clavier passe par le vrai `<button>` de la colonne identifiante (rendu table), PAS par
    // le `<tr>` — voir JSDoc de `TableComptoir` : poser `role="link"`/`tabIndex` sur le `<tr>`
    // écraserait son rôle `row` implicite (bug e2e mesuré, WCAG 1.3.1, non détecté par axe-core).
    const lignes = screen.getAllByRole('button');
    lignes[1]?.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrirLigne).toHaveBeenCalledWith(LIGNES[1]);
  });

  it('pose un nom accessible sur chaque ligne cliquable via `libelleLigne`', () => {
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        onOuvrirLigne={vi.fn()}
        libelleLigne={(l) => `Ouvrir ${l.nom}`}
      />,
    );

    expect(screen.getByRole('button', { name: 'Ouvrir Alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir Bob' })).toBeInTheDocument();
  });

  it('ne pose ni rôle « link » ni bouton de ligne quand les lignes ne sont pas cliquables', () => {
    render(<TableComptoir colonnes={COLONNES} lignes={LIGNES} cleLigne={(l) => l.id} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('table cliquable : `<tr>` garde son rôle `row` natif, ligne d’en-tête comprise (régression e2e — un `role` réassigné sur le `<tr>` remplace `row` au lieu de s’y ajouter, la table devenait imparcourable en navigation par tableau au lecteur d’écran)', () => {
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        onOuvrirLigne={vi.fn()}
        libelleLigne={(l) => `Ouvrir ${l.nom}`}
      />,
    );

    const table = screen.getByRole('table');
    // 1 ligne d'en-tête + 2 lignes de données — AUCUNE n'est masquée par un `role` réassigné.
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(1);
    expect(within(table).getAllByRole('cell')).toHaveLength(2);
  });

  it('pose aria-sort sur la colonne triée et appelle onTrier au clic sur l’en-tête', async () => {
    const onTrier = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        tri={{ colonneId: 'nom', sens: 'asc' }}
        onTrier={onTrier}
      />,
    );

    const enTete = screen.getByRole('columnheader', { name: /Nom/ });
    expect(enTete).toHaveAttribute('aria-sort', 'ascending');

    await utilisateur.click(screen.getByRole('button', { name: /Nom/ }));
    expect(onTrier).toHaveBeenCalledWith('nom');
  });

  it('rend le contenu vide fourni sans ligne quand la liste est vide', () => {
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={[]}
        cleLigne={(l) => l.id}
        contenuVide={<p>Aucun résultat</p>}
      />,
    );
    expect(screen.getByText('Aucun résultat')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('rend des lignes squelette pendant le chargement, pas de contenu vide', () => {
    const { container } = render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={[]}
        cleLigne={(l) => l.id}
        enChargement
        lignesSquelette={3}
        contenuVide={<p>Aucun résultat</p>}
      />,
    );
    expect(screen.queryByText('Aucun résultat')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });
});

// Issue #92 : au-delà de 60 lignes, `TableComptoir` bascule sur un rendu virtualisé
// (`@tanstack/react-virtual`) pour ne plus geler le fil principal (mesuré ~1.7s/5700 nœuds à 200
// lignes avant correctif). jsdom ne fait aucune mise en page réelle (`clientHeight` vaut 0 par
// défaut) : sans lui donner une hauteur de fenêtre plausible, le virtualiseur ne rendrait aucune
// ligne. `clientHeight` est patché ici (et restauré ensuite) plutôt que dans `test/setup.ts` —
// seul ce fichier exerce la virtualisation.
function genererLignes(n: number): LigneTest[] {
  return Array.from({ length: n }, (_, i) => ({ id: `l${i}`, nom: `Ligne ${i}` }));
}

describe('TableComptoir — virtualisation (issue #92)', () => {
  // `@tanstack/react-virtual` mesure la fenêtre visible via `offsetHeight` (pas `clientHeight`,
  // vérifié dans `@tanstack/virtual-core/dist/esm/index.js`) — les deux sont patchés par sécurité.
  const descripteursOriginaux = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const propriete of ['offsetHeight', 'clientHeight'] as const) {
      descripteursOriginaux.set(
        propriete,
        Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, propriete),
      );
      Object.defineProperty(window.HTMLElement.prototype, propriete, {
        configurable: true,
        value: 600,
      });
    }
  });

  afterEach(() => {
    for (const [propriete, descripteur] of descripteursOriginaux) {
      if (descripteur) {
        Object.defineProperty(window.HTMLElement.prototype, propriete, descripteur);
      }
    }
    descripteursOriginaux.clear();
  });

  it('en-deçà du seuil (60), rend TOUTES les lignes sans conteneur de défilement borné', () => {
    const lignes = genererLignes(60);
    const { container } = render(
      <TableComptoir colonnes={COLONNES} lignes={lignes} cleLigne={(l) => l.id} />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(60);
    expect(container.querySelector('.overflow-auto.max-h-\\[70dvh\\]')).not.toBeInTheDocument();
  });

  it('au-delà du seuil, ne monte PAS les 200 lignes dans le DOM (fenêtre + survol seulement)', () => {
    const lignes = genererLignes(200);
    const { container } = render(
      <TableComptoir colonnes={COLONNES} lignes={lignes} cleLigne={(l) => l.id} />,
    );
    const nbLignesMontees = container.querySelectorAll('tbody tr[data-index]').length;
    expect(nbLignesMontees).toBeGreaterThan(0);
    expect(nbLignesMontees).toBeLessThan(200);
  });

  it('pose aria-rowcount sur la table et aria-rowindex par ligne quand virtualisé', () => {
    const lignes = genererLignes(200);
    const { container } = render(
      <TableComptoir colonnes={COLONNES} lignes={lignes} cleLigne={(l) => l.id} />,
    );
    const table = container.querySelector('table');
    expect(table).toHaveAttribute('aria-rowcount', '201');
    const premiereLigneRendue = container.querySelector('tbody tr[data-index]');
    expect(premiereLigneRendue).toHaveAttribute('aria-rowindex');
  });

  it("repasse en rendu complet (toutes les lignes) pendant l'impression, puis re-virtualise ensuite", async () => {
    const lignes = genererLignes(200);
    const { container } = render(
      <TableComptoir colonnes={COLONNES} lignes={lignes} cleLigne={(l) => l.id} />,
    );
    expect(container.querySelectorAll('tbody tr[data-index]').length).toBeLessThan(200);

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll('tbody tr').length).toBe(200);
    });
    // Pendant l'impression, plus de conteneur borné : le contenu peut s'étaler sur toute la
    // hauteur imprimée plutôt que d'être coupé par `overflow-auto`/`max-h`.
    expect(container.querySelector('.overflow-auto.max-h-\\[70dvh\\]')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll('tbody tr[data-index]').length).toBeLessThan(200);
    });
  });

  it('navigation clavier (Entrée) fonctionne sur une ligne virtualisée rendue', async () => {
    const onOuvrirLigne = vi.fn();
    const lignes = genererLignes(200);
    const utilisateur = userEvent.setup();
    const { container } = render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={lignes}
        cleLigne={(l) => l.id}
        onOuvrirLigne={onOuvrirLigne}
        libelleLigne={(l) => `Ouvrir ${l.nom}`}
      />,
    );
    // Le `<tr>` n'est plus le point d'entrée clavier (voir JSDoc `TableComptoir`) : c'est le vrai
    // `<button>` de la colonne identifiante qui porte le focus/Entrée, y compris en virtualisé.
    const premiereLigneBouton = container.querySelector<HTMLButtonElement>(
      'tbody tr[data-index] button',
    );
    expect(premiereLigneBouton).not.toBeNull();
    premiereLigneBouton?.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrirLigne).toHaveBeenCalledWith(lignes[0]);
  });
});
