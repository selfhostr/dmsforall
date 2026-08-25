import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';

/**
 * Mesure 6/4 (chantier « refonte navigation ») — mode carte de `TableComptoir`, bascule sous 767px
 * (`useModeCarteComptoir`). Pas de composant portalé ici (ni `Sheet` ni `Dialog`) : `document.body`
 * et le `container` de `render()` coïncident, `container` est repris directement — même choix que
 * `TableComptoir.spec.tsx` (composant), cohérent avec le fait que ce fichier teste UN composant
 * isolé, pas un écran assemblé.
 *
 * `matchMedia` simulé à `true` : même patron que `useModeCarteComptoir.spec.ts`, cité en tête de ce
 * fichier comme référence par la mission.
 */
function installerModeCarte() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

interface LigneComptoirTest {
  readonly id: string;
  readonly numero: string;
  readonly client: string;
  readonly statut: string;
  readonly creeLe: string;
}

const LIGNES: LigneComptoirTest[] = [
  {
    id: 'l1',
    numero: 'CMD-000123',
    client: 'Jean Dupont',
    statut: 'En cours',
    creeLe: '01.07.2026',
  },
  { id: 'l2', numero: 'CMD-000124', client: 'Marie Rossi', statut: 'Livrée', creeLe: '02.07.2026' },
  {
    id: 'l3',
    numero: 'CMD-000125',
    client: 'Paul Martin',
    statut: 'Annulée',
    creeLe: '03.07.2026',
  },
];

/** Colonne « actions » avec un vrai bouton — exerce la garde `stopPropagation` (le clic dans la
 *  zone d'actions ne doit pas déclencher l'ouverture de la carte) sans jamais devenir le sujet de
 *  la mesure elle-même. */
function definirColonnes(): ColonneComptoir<LigneComptoirTest>[] {
  return [
    {
      id: 'numero',
      libelle: 'Numéro',
      triable: true,
      importance: 'principale',
      rendu: (ligne) => ligne.numero,
    },
    { id: 'client', libelle: 'Client', triable: true, rendu: (ligne) => ligne.client },
    { id: 'statut', libelle: 'Statut', rendu: (ligne) => ligne.statut },
    { id: 'creeLe', libelle: 'Créé le', importance: 'discrete', rendu: (ligne) => ligne.creeLe },
    {
      id: 'actions',
      libelle: 'Actions',
      actions: true,
      rendu: () => (
        <button type="button" onClick={(evenement) => evenement.stopPropagation()}>
          Voir
        </button>
      ),
    },
  ];
}

function rendreCarte(
  onOuvrirLigne = vi.fn(),
  onTrier = vi.fn(),
  tri: { colonneId: string; sens: 'asc' | 'desc' } | null = null,
) {
  installerModeCarte();
  return render(
    <TableComptoir
      colonnes={definirColonnes()}
      lignes={LIGNES}
      cleLigne={(ligne) => ligne.id}
      onOuvrirLigne={onOuvrirLigne}
      libelleLigne={(ligne) => `Ouvrir la commande ${ligne.numero}`}
      onTrier={onTrier}
      tri={tri}
    />,
  );
}

describe('Accessibilité WCAG 2.1 AA — TableComptoir, mode carte (< 767px)', () => {
  it('cartes remplies, tri actif sur une colonne', async () => {
    rendreCarte(vi.fn(), vi.fn(), { colonneId: 'numero', sens: 'asc' });
    await screen.findByText('CMD-000123');

    const audit = await auditerAccessibiliteEcran(
      'TableComptoir — mode carte, rempli',
      document.body,
    );
    exigerAucuneViolation(audit);
  });
});

describe('TableComptoir mode carte — sémantique de liste, sans résidu de rôles de table', () => {
  it('rend une `role="list"` de cartes, aucun rôle table/row/columnheader résiduel', async () => {
    rendreCarte();
    await screen.findByText('CMD-000123');

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.queryByRole('rowgroup')).not.toBeInTheDocument();
  });
});

describe('TableComptoir mode carte — cartes cliquables', () => {
  it('chaque carte est un `role="link"` nommé (numéro de commande), opérable au clavier', async () => {
    const onOuvrirLigne = vi.fn();
    const utilisateur = userEvent.setup();
    rendreCarte(onOuvrirLigne);
    await screen.findByText('CMD-000123');

    const carte = screen.getByRole('link', { name: 'Ouvrir la commande CMD-000123' });
    expect(carte).toBeInTheDocument();

    carte.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrirLigne).toHaveBeenCalledWith(LIGNES[0]);
  });

  it('le clic dans la zone d’actions n’ouvre pas la carte (stopPropagation vérifié en exécution)', async () => {
    const onOuvrirLigne = vi.fn();
    const utilisateur = userEvent.setup();
    rendreCarte(onOuvrirLigne);
    await screen.findByText('CMD-000123');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Voir' })[0]!);
    expect(onOuvrirLigne).not.toHaveBeenCalled();
  });
});

describe('TableComptoir mode carte — rangée de puces de tri (remplace les en-têtes disparus)', () => {
  it('la rangée porte `role="group"` nommé, une puce par colonne triable', async () => {
    rendreCarte();
    await screen.findByText('CMD-000123');

    const groupe = screen.getByRole('group', { name: 'Trier par' });
    expect(groupe).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Numéro/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Client/ })).toBeInTheDocument();
    // « Statut » et « Créé le » ne sont pas `triable: true` : pas de puce pour elles.
    expect(screen.queryByRole('button', { name: /^Statut$/ })).not.toBeInTheDocument();
  });

  it('cliquer une puce appelle `onTrier` avec l’id de colonne, et `aria-pressed` reflète le tri courant', async () => {
    const onTrier = vi.fn();
    const utilisateur = userEvent.setup();
    const { rerender } = rendreCarte(vi.fn(), onTrier, { colonneId: 'numero', sens: 'asc' });
    await screen.findByText('CMD-000123');

    const puceNumero = screen.getByRole('button', { name: /Numéro/ });
    const puceClient = screen.getByRole('button', { name: /Client/ });
    expect(puceNumero).toHaveAttribute('aria-pressed', 'true');
    expect(puceClient).toHaveAttribute('aria-pressed', 'false');

    await utilisateur.click(puceClient);
    expect(onTrier).toHaveBeenCalledWith('client');

    // Réaction au changement de tri piloté par l'appelant (le composant ne gère pas son propre
    // état de tri) : reproduit ce que ferait l'écran réel après le callback ci-dessus.
    rerender(
      <TableComptoir
        colonnes={definirColonnes()}
        lignes={LIGNES}
        cleLigne={(ligne) => ligne.id}
        onOuvrirLigne={vi.fn()}
        libelleLigne={(ligne) => `Ouvrir la commande ${ligne.numero}`}
        onTrier={onTrier}
        tri={{ colonneId: 'client', sens: 'asc' }}
      />,
    );
    expect(screen.getByRole('button', { name: /Client/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Numéro/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('chaque puce porte `min-h-11` (44px) — plancher de cible tactile posé dans le code, pas mesuré en pixels', async () => {
    // LIMITE ASSUMÉE, comme pour la barre d'onglets basse : jsdom ne fait aucune mise en page
    // réelle. Cette assertion vérifie que la classe qui POSE le plancher est bien présente sur
    // l'élément rendu (donc qu'aucune régression ne l'a retirée), pas la taille effective à
    // l'écran — un rendu navigateur (Playwright) serait nécessaire pour ça.
    rendreCarte();
    await screen.findByText('CMD-000123');
    const puce = screen.getByRole('button', { name: /Numéro/ });
    expect(puce.className).toContain('min-h-11');
  });
});
