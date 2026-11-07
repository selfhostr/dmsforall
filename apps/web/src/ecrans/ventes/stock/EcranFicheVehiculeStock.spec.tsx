import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseVehiculeStock } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { enregistrerTraductionsTestVentes } from './_composants/traductions-test';
import { EcranFicheVehiculeStock } from './EcranFicheVehiculeStock';

beforeAll(() => {
  enregistrerTraductionsTestVentes();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const VEHICULE_STOCK: ReponseVehiculeStock = {
  id: 'veh-1',
  siteId: 'site-1',
  vehicule: {
    id: 'veh-1',
    plaque: 'VD 123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    vin: 'WVWZZZ1KZAW123456',
    premiereMiseEnCirculationLe: '2018-04-01',
    identificationIncomplete: false,
    emplacementLibre: null,
  },
  provenance: 'neuf_constructeur',
  dateEntreeStock: '2026-01-15',
  prixAchatCentimes: 3_200_000,
  fraisRemiseEtatCumulesCentimes: 0,
  prixVenteAfficheCentimes: null,
  statutCommercial: 'en_commande',
  typeVehicule: 'vn',
  vendeurPrecedentAssujetti: null,
  origineRepriseDossierVenteId: null,
  joursStock: 3,
  receptionneLe: null,
  reserveLe: null,
  venduLe: null,
  livreLe: null,
  actionsDisponibles: ['mettre_a_jour', 'receptionner'],
  version: 1,
  creeLe: '2026-01-15T08:00:00.000Z',
  modifieLe: '2026-01-15T08:00:00.000Z',
  modifiePar: null,
};

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'direction') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
    http.get('/api/v1/vehicules/veh-1/stock', () => HttpResponse.json(VEHICULE_STOCK)),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/stock/veh-1']}>
        <Routes>
          <Route path="/ventes/stock/:id" element={<EcranFicheVehiculeStock />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFicheVehiculeStock', () => {
  it('affiche la fiche avec le véhicule, le statut et le prix non fixé', async () => {
    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('En commande')).toBeInTheDocument();
    expect(screen.getByText('Non fixé')).toBeInTheDocument();

    // Prix d'achat masqué par défaut (constat testeur : juxtaposé au prix de vente, il révèle la
    // marge si le vendeur tourne l'écran vers le client) — la valeur brute n'apparaît qu'après un
    // clic explicite sur le bouton de révélation.
    expect(screen.queryByText("32'000.00")).not.toBeInTheDocument();
    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole('button', { name: "Voir Prix d'achat" }));
    expect(await screen.findByText("32'000.00")).toBeInTheDocument();
  });

  it('plus de basculement client : prix d’achat et actions internes restent ceux de la vue vendeur', async () => {
    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Vue client' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Voir Prix d'achat" })).toBeInTheDocument();
    expect(screen.getByText('Données commerciales')).toBeInTheDocument();
  });

  it('un rôle sans droit d’écriture ne voit aucune action (ni primaire ni menu de débordement)', async () => {
    rendre('technicien');

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réceptionner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mettre à jour' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Autres actions' })).not.toBeInTheDocument();
  });

  /**
   * Lot C (`docs/plan-refonte-navigation.md`) — `receptionner` est la seule transition
   * d'avancement disponible en `en_commande` (`ACTIONS_VEHICULE_STOCK`) : elle doit apparaître
   * comme l'action PRIMAIRE (bouton coloré direct, pas un menu à ouvrir d'abord), sur le même
   * patron que `EnTeteOrdreReparation`/`EnTeteDossierVente`.
   */
  it('la direction peut réceptionner le véhicule via l’action primaire', async () => {
    let appele = false;
    rendre('direction');
    server.use(
      http.post('/api/v1/vehicules/veh-1/stock/receptionner', () => {
        appele = true;
        return HttpResponse.json({
          donnees: {
            ...VEHICULE_STOCK,
            statutCommercial: 'disponible',
            actionsDisponibles: ['mettre_a_jour'],
          },
          avertissements: [],
        });
      }),
    );

    const utilisateur = userEvent.setup();
    // `mettre_a_jour` (« Mettre à jour ») reste disponible en même temps que `receptionner` — la
    // primaire promeut `receptionner`, `mettre_a_jour` bascule dans le menu de débordement : les
    // deux coexistent sans ambiguïté de nom accessible.
    expect(screen.queryByRole('button', { name: 'Mettre à jour' })).not.toBeInTheDocument();
    await utilisateur.click(await screen.findByRole('button', { name: 'Réceptionner' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Réceptionner' }));

    expect(await screen.findByText('Disponible')).toBeInTheDocument();
    expect(appele).toBe(true);
  });

  it('« Mettre à jour » reste accessible depuis le menu de débordement', async () => {
    rendre('direction');

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Autres actions' }));
    await utilisateur.click(await screen.findByRole('menuitem', { name: 'Mettre à jour' }));

    // `FormulaireVehiculeStock` s'est bien ouvert (son titre de dialogue réutilise le même libellé
    // que le déclencheur, « Mettre à jour » — non distinctif ; le champ « Date d'entrée en stock »,
    // lui, n'existe que dans ce formulaire).
    expect(await screen.findByLabelText("Date d'entrée en stock")).toBeInTheDocument();
  });

  /**
   * Défaut corrigé : l'erreur de la mutation « réceptionner » s'affichait HORS du contenu du
   * dialogue — donc sous l'overlay qui assombrit la page tant que la modale reste ouverte,
   * invisible pour le garagiste. Même doctrine que `DialogueActionAvecMotif` (déjà correct dans
   * ce même écran) : l'erreur doit apparaître DANS la modale, `within(dialogue)` le prouve.
   */
  it('affiche l’erreur de « réceptionner » DANS la modale, pas hors de son contenu', async () => {
    rendre('direction');
    server.use(
      http.post('/api/v1/vehicules/veh-1/stock/receptionner', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Réceptionner' }));

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Réceptionner' }));

    // L'erreur est bien À L'INTÉRIEUR du dialogue (rôle `alert` posé sur le paragraphe d'erreur
    // dans `DialogContent`) — la modale reste ouverte, le message n'est pas perdu sous l'overlay.
    expect(await within(dialogue).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  /**
   * Issue #142 : le champ `emplacementLibre` existe en base depuis la migration `0044` mais
   * aucune fiche du module ventes ne permettait de le renseigner. Preuve bout en bout : bouton →
   * saisie → `PATCH /vehicules/{id}` → valeur reflétée, sans quitter la fiche stock.
   */
  it("renseigne l'emplacement du véhicule depuis la fiche stock (#142)", async () => {
    let corpsRecu: Record<string, unknown> | null = null;
    rendre('direction');
    server.use(
      http.patch('/api/v1/vehicules/veh-1', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          donnees: { ...VEHICULE_STOCK.vehicule, emplacementLibre: 'Devant, place 3' },
          avertissements: [],
        });
      }),
    );

    const utilisateur = userEvent.setup();
    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('Emplacement :')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Modifier' }));
    const champ = screen.getByLabelText('Emplacement');
    await utilisateur.type(champ, 'Devant, place 3');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(corpsRecu).toEqual({ emplacementLibre: 'Devant, place 3' }));
    expect(await screen.findByText('Devant, place 3')).toBeInTheDocument();
  });

  /**
   * Issue #141 : `CelluleGarantieSuivi` affichait systématiquement « — » faute d'un endroit où
   * saisir la garantie. Preuve bout en bout depuis la fiche stock : dialogue « Garantie » → saisie
   * des trois champs → `PATCH /vehicules/{id}` avec exactement ces trois champs, rien de plus
   * (aucune valeur devinée).
   */
  it('renseigne la garantie du véhicule depuis la fiche stock (#141)', async () => {
    let corpsRecu: Record<string, unknown> | null = null;
    rendre('direction');
    server.use(
      http.patch('/api/v1/vehicules/veh-1', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ donnees: VEHICULE_STOCK.vehicule, avertissements: [] });
      }),
    );

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Garantie' }));

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(within(dialogue).getByLabelText('Début de la garantie'), '04.08.2026');
    await utilisateur.type(within(dialogue).getByLabelText('Durée (mois)'), '24');
    await utilisateur.type(within(dialogue).getByLabelText('Plafond kilométrique'), '100000');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(corpsRecu).toEqual({
        garantieDebutLe: '2026-08-04',
        garantieMois: 24,
        garantieKm: 100000,
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * `vehicule.modifier` (emplacement, garantie) est un droit DISTINCT de
   * `ventes.vehicule_stock.modifier` (prix, statut) — un `vendeur` a le second mais PAS le
   * premier (exclu côté API, `droits.ts::peutModifierVehiculeAssocie`). Ce test échoue si les deux
   * droits sont confondus par erreur.
   */
  it('un vendeur (droit vehicule_stock, pas vehicule.modifier) ne voit ni le crayon d’emplacement ni le bouton Garantie', async () => {
    rendre('vendeur');

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Garantie' })).not.toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules/veh-1/stock', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const queryClient = creerQueryClientTest();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ventes/stock/veh-1']}>
          <Routes>
            <Route path="/ventes/stock/:id" element={<EcranFicheVehiculeStock />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Impossible d'afficher cette fiche")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
