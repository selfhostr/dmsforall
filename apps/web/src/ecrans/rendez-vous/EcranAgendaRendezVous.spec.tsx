import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import type { JourAgenda } from '@/composants/rendez-vous/types';
import { creerQueryClientTest } from '@/test/utils';

import { EcranAgendaRendezVous, type VueAgendaEcran } from './EcranAgendaRendezVous';

/**
 * `EcranAgendaRendezVous` passe désormais par `GabaritEcran` (chantier « titres doublés &
 * espacements », 17.08.2026), qui lit la session (`useSession`) et l'URL (`useNavigationActive`)
 * pour détecter un titre en double avec la navigation — même wrapping de test que
 * `GabaritEcran.spec.tsx`/`EcranListeOrdresReparation.spec.tsx` : `QueryClientProvider` (session)
 * + `MemoryRouter` (URL), désormais requis même pour ce composant de présentation pure.
 */
function rendre(ui: ReactElement) {
  const queryClient = creerQueryClientTest();
  const resultat = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/rendez-vous']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...resultat,
    // `rerender` seul remplacerait la racine ENTIÈRE (perdrait `QueryClientProvider`/
    // `MemoryRouter`, désormais requis par `GabaritEcran`) : ce wrapper les repose autour du
    // nouvel élément, même `queryClient` conservé.
    rerenderUi: (nouvelUi: ReactElement) =>
      resultat.rerender(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/rendez-vous']}>{nouvelUi}</MemoryRouter>
        </QueryClientProvider>,
      ),
  };
}

function construireJour(overrides: Partial<JourAgenda> = {}): JourAgenda {
  return {
    dateIso: '2026-08-13',
    date: new Date(2026, 7, 13),
    nombreRendezVous: 0,
    minutesOccupees: 0,
    capaciteMinutes: 480,
    rendezVous: [],
    ...overrides,
  };
}

const PROPS_BASE = {
  site: { id: 's-1', nom: 'Garage Martin — Sion' },
  vue: 'semaine' as VueAgendaEcran,
  onChangerVue: vi.fn(),
  periodeLabel: '10 – 16 août 2026',
  onPrecedent: vi.fn(),
  onSuivant: vi.fn(),
  onAujourdhui: vi.fn(),
  recherche: '',
  onChangerRecherche: vi.fn(),
  onNouveauRendezVous: vi.fn(),
  onReessayer: vi.fn(),
  jours: [construireJour()],
  onCliquerJour: vi.fn(),
  onOuvrirRendezVous: vi.fn(),
};

describe('EcranAgendaRendezVous', () => {
  it('affiche l’état dédié "choisissez un site" quand aucun site n’est sélectionné', () => {
    rendre(<EcranAgendaRendezVous {...PROPS_BASE} site={undefined} etat="contenu" />);
    expect(screen.getByText('Choisissez un site')).toBeInTheDocument();
  });

  it('affiche des squelettes pendant le chargement', () => {
    const { container } = rendre(<EcranAgendaRendezVous {...PROPS_BASE} etat="chargement" />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('affiche une erreur actionnable (réessayer) en cas d’échec réseau', async () => {
    const utilisateur = userEvent.setup();
    const onReessayer = vi.fn();
    rendre(
      <EcranAgendaRendezVous
        {...PROPS_BASE}
        etat="erreur"
        messageErreur="Panne réseau."
        onReessayer={onReessayer}
      />,
    );
    expect(screen.getByText('Panne réseau.')).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onReessayer).toHaveBeenCalled();
  });

  it('distingue "aucun rendez-vous" de "aucun résultat de recherche" — jamais le même message', () => {
    const { rerenderUi } = rendre(<EcranAgendaRendezVous {...PROPS_BASE} etat="contenu" />);
    expect(screen.getByText('Aucun rendez-vous prévu cette semaine')).toBeInTheDocument();

    rerenderUi(<EcranAgendaRendezVous {...PROPS_BASE} etat="contenu" recherche="Dupont" />);
    expect(screen.getByText('Aucun résultat')).toBeInTheDocument();
    expect(screen.queryByText('Aucun rendez-vous prévu cette semaine')).not.toBeInTheDocument();
  });

  it('le bouton "Nouveau rendez-vous" est toujours accessible, y compris sur l’état vide', async () => {
    const utilisateur = userEvent.setup();
    const onNouveau = vi.fn();
    rendre(
      <EcranAgendaRendezVous {...PROPS_BASE} etat="contenu" onNouveauRendezVous={onNouveau} />,
    );
    const boutons = screen.getAllByRole('button', { name: 'Nouveau rendez-vous' });
    await utilisateur.click(boutons[0]!);
    expect(onNouveau).toHaveBeenCalled();
  });

  it('bascule de vue Semaine à Liste via les onglets', async () => {
    const utilisateur = userEvent.setup();
    const onChangerVue = vi.fn();
    rendre(<EcranAgendaRendezVous {...PROPS_BASE} etat="contenu" onChangerVue={onChangerVue} />);
    await utilisateur.click(screen.getByRole('tab', { name: 'Liste' }));
    expect(onChangerVue).toHaveBeenCalledWith('liste');
  });

  it('« choisissez un site » ne renvoie plus « en haut à gauche » et propose les sites', async () => {
    const utilisateur = userEvent.setup();
    const onChangerSite = vi.fn();
    rendre(
      <EcranAgendaRendezVous
        {...PROPS_BASE}
        site={undefined}
        etat="contenu"
        sitesChoisissables={[
          { id: 's-1', nom: 'Sion' },
          { id: 's-2', nom: 'Martigny' },
        ]}
        onChangerSite={onChangerSite}
      />,
    );
    expect(screen.queryByText(/en haut à gauche/)).not.toBeInTheDocument();
    expect(screen.getByText(/en haut à droite/)).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Martigny' }));
    expect(onChangerSite).toHaveBeenCalledWith('s-2');
  });

  it('indique le site affiché et les rendez-vous des autres sites, avec un lien pour y aller', async () => {
    const utilisateur = userEvent.setup();
    const onChangerSite = vi.fn();
    rendre(
      <EcranAgendaRendezVous
        {...PROPS_BASE}
        etat="contenu"
        autresSites={[{ siteId: 's-2', nom: 'Martigny', total: 2 }]}
        onChangerSite={onChangerSite}
      />,
    );
    expect(screen.getByText('Site affiché : Garage Martin — Sion')).toBeInTheDocument();
    expect(screen.getByText('2 rendez-vous à Martigny cette semaine')).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Voir l’agenda de Martigny' }));
    expect(onChangerSite).toHaveBeenCalledWith('s-2');
  });

  it('propose un « ? » d’aide en vocabulaire de garagiste et un bouton « Demain »', async () => {
    const utilisateur = userEvent.setup();
    const onDemain = vi.fn();
    rendre(<EcranAgendaRendezVous {...PROPS_BASE} etat="contenu" onDemain={onDemain} />);
    await utilisateur.click(screen.getByRole('button', { name: 'Aide : le planning' }));
    expect(
      screen.getByText(/Cet agenda montre les rendez-vous d’un seul site/),
    ).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Demain' }));
    expect(onDemain).toHaveBeenCalled();
  });
});
