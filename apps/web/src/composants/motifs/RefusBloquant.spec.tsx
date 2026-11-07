import type { ActionProposee, ElementBloquant } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { RefusBloquant } from './RefusBloquant';

vi.mock('@/observabilite/sentry', () => ({
  signalerErreur: vi.fn().mockResolvedValue(undefined),
}));

// Fixtures normatives I-08 et I-09, reprises telles quelles de docs/contrats-api-etape-1.md §3.4.
const BLOCAGES_I08: readonly ElementBloquant[] = [
  {
    type: 'ligne_or',
    id: '8f2c-a91',
    libelle: 'Disques de frein avant (jeu)',
    donnees: { numeroLigne: 4, totalTtcCentimes: 62000, origine: 'constatee' },
  },
  {
    type: 'ligne_or',
    id: 'b17d-4e0',
    libelle: 'Plaquettes avant',
    donnees: { numeroLigne: 5, totalTtcCentimes: 32000, origine: 'constatee' },
  },
];
const ACTIONS_I08: readonly ActionProposee[] = [
  {
    code: 'CREER_DEVIS_COMPLEMENTAIRE',
    methode: 'POST',
    chemin: '/api/v1/ordres-reparation/3a1f-c22/devis-complementaires',
    parametres: { ligneIds: ['8f2c-a91', 'b17d-4e0'], nouveauPlafondSuggereCentimes: 174000 },
  },
  { code: 'VALIDER_LIGNES' },
];

const BLOCAGES_I09: readonly ElementBloquant[] = [
  {
    type: 'pointage',
    id: 'c4e1-77a',
    libelle: 'Rui Almeida — depuis 09:12',
    donnees: {
      technicienId: 'd09a-113',
      technicienPrenom: 'Rui',
      debutLe: '2026-07-27T07:12:00.000Z',
      ligneOrId: '8f2c-a91',
    },
  },
  {
    type: 'pointage',
    id: 'e88b-2f5',
    libelle: 'Sarah Berger — depuis 10:04',
    donnees: {
      technicienId: '77c2-908',
      technicienPrenom: 'Sarah',
      debutLe: '2026-07-27T08:04:00.000Z',
      ligneOrId: null,
    },
  },
];
const ACTIONS_I09: readonly ActionProposee[] = [{ code: 'ARRETER_POINTAGES' }];

describe('RefusBloquant', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('fr');
  });

  it('I-08 : rend deux lignes cliquables et le bouton « Créer un devis complémentaire »', async () => {
    render(
      <RefusBloquant
        code="OR_LIGNES_A_VALIDER"
        blocages={BLOCAGES_I08}
        actionsProposees={ACTIONS_I08}
      />,
    );

    const lignes = screen.getAllByRole('button', { name: /ligne à valider/i });
    expect(lignes).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Créer un devis complémentaire' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "Enregistrer l'accord du client" }),
    ).toBeInTheDocument();
  });

  it('I-09 : rend deux techniciens et le bouton « Arrêter les pointages »', () => {
    render(
      <RefusBloquant
        code="OR_POINTAGE_OUVERT"
        blocages={BLOCAGES_I09}
        actionsProposees={ACTIONS_I09}
      />,
    );

    expect(screen.getByText(/Rui/)).toBeInTheDocument();
    expect(screen.getByText(/Sarah/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /pointage en cours/i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Arrêter les pointages' })).toBeInTheDocument();
  });

  it('le `libelle` serveur (I-08 ET I-09) n’apparaît jamais dans le DOM', () => {
    const { container: c8 } = render(
      <RefusBloquant
        code="OR_LIGNES_A_VALIDER"
        blocages={BLOCAGES_I08}
        actionsProposees={ACTIONS_I08}
      />,
    );
    for (const element of BLOCAGES_I08) {
      expect(c8.textContent).not.toContain(element.libelle);
    }

    const { container: c9 } = render(
      <RefusBloquant
        code="OR_POINTAGE_OUVERT"
        blocages={BLOCAGES_I09}
        actionsProposees={ACTIONS_I09}
      />,
    );
    for (const element of BLOCAGES_I09) {
      expect(c9.textContent).not.toContain(element.libelle);
    }
  });

  it('un clic sur un élément bloquant transmet l’élément à l’appelant', async () => {
    const utilisateur = userEvent.setup();
    const onElementBloquantClic = vi.fn();
    render(
      <RefusBloquant
        code="OR_LIGNES_A_VALIDER"
        blocages={BLOCAGES_I08}
        actionsProposees={ACTIONS_I08}
        onElementBloquantClic={onElementBloquantClic}
      />,
    );

    await utilisateur.click(screen.getAllByRole('button', { name: /ligne à valider/i })[0]!);
    expect(onElementBloquantClic).toHaveBeenCalledWith(BLOCAGES_I08[0]);
  });

  it('actionsProposees vide hors contexte terminal : encart de repli explicite + signalement observabilité', async () => {
    const { signalerErreur } = await import('@/observabilite/sentry');
    render(<RefusBloquant code="OR_ANNULATION_IMPOSSIBLE" blocages={[]} actionsProposees={[]} />);

    expect(
      screen.getByText(
        "L'opération n'a pas abouti. Réessayez ; si cela revient, prévenez le support.",
      ),
    ).toBeInTheDocument();
    expect(signalerErreur).toHaveBeenCalledTimes(1);
  });

  it('actionsProposees vide MAIS contexte terminal (`estTerminal`) : pas de repli, pas de signalement', async () => {
    const { signalerErreur } = await import('@/observabilite/sentry');
    render(
      <RefusBloquant
        code="OR_ANNULATION_IMPOSSIBLE"
        blocages={[]}
        actionsProposees={[]}
        estTerminal
      />,
    );

    expect(
      screen.queryByText(
        "L'opération n'a pas abouti. Réessayez ; si cela revient, prévenez le support.",
      ),
    ).not.toBeInTheDocument();
    expect(signalerErreur).not.toHaveBeenCalled();
  });

  it('rend le message via erreurs:codes.<CODE>, traduit en allemand', async () => {
    await i18n.changeLanguage('de');
    render(
      <RefusBloquant code="OR_LIGNES_A_VALIDER" blocages={[]} actionsProposees={[]} estTerminal />,
    );
    expect(
      screen.getByText(
        'Einige Positionen erwarten eine Kundenfreigabe. Sie sind unten aufgelistet.',
      ),
    ).toBeInTheDocument();
  });
});
