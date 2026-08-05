import type { ReponseRecherche, ResultatRecherche } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { PanneauResultatsRecherche } from './PanneauResultatsRecherche';

// cmdk (navigation clavier de CommandList) appelle `Element.scrollIntoView` — absent de jsdom —
// et `CommandList` observe sa hauteur via `ResizeObserver` — également absent de jsdom. Stubs
// locaux à ce fichier, aucune autre suite n'utilise `Command` pour l'instant.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const VEHICULE_A: ResultatRecherche = {
  type: 'vehicule',
  id: 'va',
  score: 0.9,
  correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
  resume: { plaque: 'VD 123456', designation: 'VW Touran 2.0 TDI' },
};

const VEHICULE_B: ResultatRecherche = {
  type: 'vehicule',
  id: 'vb',
  score: 0.6,
  correspondance: {
    champ: 'plaque',
    valeur: 'VD 123456',
    historique: true,
    porteeJusquLe: '2025-02-01',
  },
  resume: { plaque: 'FR 4711', designation: 'Opel Corsa 1.2', detenteurNom: 'Rossi Maria' },
};

const CLIENT_A: ResultatRecherche = {
  type: 'client',
  id: 'ca',
  score: 0.5,
  correspondance: { champ: 'nom', valeur: 'Meier', historique: false },
  resume: { nom: 'Meier Hans', numeroClient: 'CL-042' },
};

function panneau(reponse: ReponseRecherche | null, surcharges: Record<string, unknown> = {}) {
  return (
    <PanneauResultatsRecherche
      valeur=""
      onValeurChange={vi.fn()}
      reponse={reponse}
      onSelectionner={vi.fn()}
      {...surcharges}
    />
  );
}

describe('PanneauResultatsRecherche', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('parcourt les résultats au clavier de bout en bout, sans souris', async () => {
    const onSelectionner = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      panneau(
        { resultats: [VEHICULE_A, CLIENT_A], plaqueInterchangeable: false },
        { onSelectionner },
      ),
    );

    const champ = screen.getByRole('combobox');
    champ.focus();
    // Premier élément auto-sélectionné par cmdk au montage (VEHICULE_A) ; une flèche bas passe
    // au groupe suivant (CLIENT_A), Entrée confirme.
    await utilisateur.keyboard('{ArrowDown}{Enter}');

    expect(onSelectionner).toHaveBeenCalledTimes(1);
    expect(onSelectionner).toHaveBeenCalledWith(CLIENT_A);
  });

  it('Échap déclenche onEchap', async () => {
    const onEchap = vi.fn();
    const utilisateur = userEvent.setup();
    render(panneau({ resultats: [VEHICULE_A], plaqueInterchangeable: false }, { onEchap }));
    screen.getByRole('combobox').focus();
    await utilisateur.keyboard('{Escape}');
    expect(onEchap).toHaveBeenCalledTimes(1);
  });

  it('distingue un résultat historique par un rôle "note" dédié', () => {
    render(panneau({ resultats: [VEHICULE_A, VEHICULE_B], plaqueInterchangeable: false }));
    expect(screen.getByRole('note')).toHaveTextContent(/Rossi Maria/);
  });

  it('plaqueInterchangeable : affiche les DEUX véhicules et ne présélectionne rien (RM-18)', () => {
    render(panneau({ resultats: [VEHICULE_A, VEHICULE_B], plaqueInterchangeable: true }));

    expect(screen.getByText(/VW Touran 2\.0 TDI/)).toBeInTheDocument();
    expect(screen.getByText(/Opel Corsa 1\.2/)).toBeInTheDocument();

    // Rendus comme choix explicites (boutons), pas comme options `cmdk` avec présélection.
    const choix = screen.getAllByRole('button');
    expect(choix).toHaveLength(2);
    for (const bouton of choix) {
      expect(bouton).not.toHaveAttribute('aria-selected', 'true');
    }
    // Aucun `option` cmdk pour les véhicules eux-mêmes dans ce mode.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('état de chargement : montre le message dédié', () => {
    render(panneau(null, { enChargement: true }));
    // `{ ignore: ... }` exclut la région `aria-live` (annonce lecteur d'écran, même texte que le
    // message visible `CommandEmpty` par construction) : sans lui, deux nœuds portent "Recherche…"
    // et `getByText` échouerait sur un match ambigu.
    expect(screen.getByText('Recherche…', { ignore: '[aria-live]' })).toBeInTheDocument();
  });

  it('état vide : la variante recherche dédiée, jamais un tableau vide silencieux', () => {
    render(panneau({ resultats: [], plaqueInterchangeable: false }));
    expect(screen.getByText('Aucun résultat', { ignore: '[aria-live]' })).toBeInTheDocument();
  });

  it('annonce le nombre de résultats à chaque changement pour un lecteur d’écran (aria-live)', () => {
    const { rerender } = render(panneau(null));
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(panneau({ resultats: [VEHICULE_A, CLIENT_A], plaqueInterchangeable: false }));
    expect(screen.getByRole('status')).toHaveTextContent('2 résultats trouvés');

    rerender(panneau({ resultats: [], plaqueInterchangeable: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Aucun résultat');

    rerender(panneau(null, { enChargement: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Recherche…');
  });

  it('traduit le libellé du groupe véhicules en allemand', async () => {
    await i18n.changeLanguage('de');
    render(panneau({ resultats: [VEHICULE_A], plaqueInterchangeable: false }));
    expect(screen.getByText('1 Fahrzeug')).toBeInTheDocument();
  });
});
