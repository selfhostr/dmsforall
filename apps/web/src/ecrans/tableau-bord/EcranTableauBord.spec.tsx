import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type {
  ClientResume,
  OrdreReparationResume,
  ReponseActiviteTableauBord,
  ReponseFinancierTableauBord,
  ReponseOrdreReparation,
  ReponsePointage,
  VehiculeResume,
} from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranTableauBord } from './EcranTableauBord';

const CHEMIN_ACTIVITE = '/api/v1/tableau-bord/activite';
const CHEMIN_FINANCIER = '/api/v1/tableau-bord/financier';
const CHEMIN_OR = '/api/v1/ordres-reparation';
const CHEMIN_PNEUS = '/api/v1/depots-pneus/a-relancer';
const CHEMIN_POINTAGES = '/api/v1/pointages';
const CHEMIN_REAPPRO = '/api/v1/stock/reapprovisionnement';
const CHEMIN_DOSSIERS_VENTE = '/api/v1/dossiers-vente';

const PERIODE = { du: '2026-08-01', au: '2026-08-31' };
const PAGE_VIDE = { donnees: [], curseurSuivant: null, limite: 50 };

const ACTIVITE_NOMINALE: ReponseActiviteTableauBord = {
  periode: PERIODE,
  siteId: null,
  ordresReparationParStatut: [
    { statut: 'planifie', nombre: 2 },
    { statut: 'ouvert', nombre: 3 },
    { statut: 'en_cours', nombre: 5 },
    { statut: 'controle', nombre: 1 },
    { statut: 'termine', nombre: 6 },
    { statut: 'facture', nombre: 2 },
  ],
  ordresReparationOuvertsPeriode: 12,
  ordresReparationRestituesPeriode: 9,
  delaiMoyenRestitutionMinutes: 200,
  lignesEnAttenteValidation: 4,
  articlesSousSeuilReapprovisionnement: 7,
};

const ACTIVITE_VIDE: ReponseActiviteTableauBord = {
  periode: PERIODE,
  siteId: null,
  ordresReparationParStatut: [
    { statut: 'planifie', nombre: 0 },
    { statut: 'ouvert', nombre: 0 },
    { statut: 'en_cours', nombre: 0 },
    { statut: 'controle', nombre: 0 },
    { statut: 'termine', nombre: 0 },
    { statut: 'facture', nombre: 0 },
  ],
  ordresReparationOuvertsPeriode: 0,
  ordresReparationRestituesPeriode: 0,
  delaiMoyenRestitutionMinutes: null,
  lignesEnAttenteValidation: 0,
  articlesSousSeuilReapprovisionnement: 0,
};

const FINANCIER_NOMINAL: ReponseFinancierTableauBord = {
  periode: PERIODE,
  siteId: null,
  chiffreAffaires: {
    totalHtCentimes: 114300,
    totalTvaCentimes: 9150,
    totalTtcCentimes: 123450,
    nombreDocuments: 6,
  },
  encaissementsCentimes: 98700,
  encoursClientsCentimes: 45600,
};

const CLIENT_TEST: ClientResume = {
  id: 'client-1',
  numeroClient: 'C-1',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 1,
  dernierPassageLe: null,
};

const VEHICULE_TEST: VehiculeResume = {
  id: 'vehicule-1',
  plaque: 'VD 123456',
  canton: 'VD',
  designation: 'VW Golf',
  vin: null,
  premiereMiseEnCirculationLe: null,
  identificationIncomplete: false,
  emplacementLibre: null,
};

/** Fiche OR complète (contrat `ReponseOrdreReparation`) pour le bloc technicien — une seule ligne,
 *  assignée au technicien de `SESSION_TEST` (`utilisateur-1`), statut pointable. */
const OR_COMPLET_TEST: ReponseOrdreReparation = {
  id: 'or-1',
  numero: 'OR-2026-000123',
  siteId: 'site-1',
  type: 'reparation',
  statut: 'ouvert',
  client: CLIENT_TEST,
  vehicule: VEHICULE_TEST,
  figees: {
    clientDesignation: 'Jean Dupont',
    adresseFacturation: null,
    plaque: 'VD 123456',
    detenteurClientId: 'client-1',
  },
  conducteurPresentNom: null,
  kilometrageEntree: null,
  kilometrageSortie: null,
  restitutionPromiseLe: null,
  restitutionInitialeLe: null,
  localisation: 'atelier',
  sousTraitantNom: null,
  ordreReparationParentId: null,
  motifLien: null,
  rendezVousId: null,
  numeroCommandeInterne: null,
  receptionnaireId: null,
  retentionInvoqueeLe: null,
  litigeOuvertLe: null,
  ouvertLe: '2026-08-10T08:00:00.000Z',
  termineLe: null,
  factureLe: null,
  restitueLe: null,
  clotureLe: null,
  annuleLe: null,
  motifAnnulation: null,
  demandes: [],
  lignes: [],
  nombreLignes: 0,
  lignesTronquees: false,
  devisComplementaires: [],
  controleQualite: null,
  signatures: [],
  pret: null,
  cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
  attentes: { accord: false, pieces: false, externe: false },
  etatAffiche: 'ouvert',
  actionsDisponibles: [],
  version: 1,
  creeLe: '2026-08-10T08:00:00.000Z',
  modifieLe: '2026-08-10T08:00:00.000Z',
  modifiePar: null,
};

const OR_RESUME_TEST: OrdreReparationResume = {
  id: 'or-1',
  numero: 'OR-2026-000123',
  statut: 'ouvert',
  etatAffiche: 'ouvert',
  type: 'reparation',
  localisation: 'atelier',
  ouvertLe: '2026-08-10T08:00:00.000Z',
  restitutionPromiseLe: new Date().toISOString(),
  vehicule: VEHICULE_TEST,
  client: CLIENT_TEST,
  nombreLignes: 1,
};

const POINTAGE_EN_COURS: ReponsePointage = {
  id: 'pointage-1',
  siteId: 'site-1',
  technicienId: 'technicien-1',
  technicienNomAffiche: 'Marc Rossi',
  statut: 'en_cours',
  nature: 'productif_ligne',
  ordreReparationId: 'or-1',
  ligneOrId: 'ligne-1',
  ordreReparationNumero: 'OR-2026-000123',
  ligneOrDesignation: 'Révision',
  activiteIndirecte: null,
  source: 'saisie',
  appareilId: null,
  debutLe: '2026-08-10T08:00:00.000Z',
  finLe: null,
  dureeBruteSecondes: null,
  dureeArrondieCentiemes: null,
  clotureAutomatique: false,
  anomalie: null,
  derniereCorrection: null,
  creeLe: '2026-08-10T08:00:00.000Z',
  modifieLe: '2026-08-10T08:00:00.000Z',
};

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role']) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tableau-bord']}>
        <Routes>
          <Route path="/tableau-bord" element={<EcranTableauBord />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranTableauBord — Direction', () => {
  it('affiche les 4 blocs attendus : encours, CA, OR ouverts aujourd’hui, sorties du soir', async () => {
    connecterSession('direction');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      http.get(CHEMIN_OR, () => HttpResponse.json({ ...PAGE_VIDE, donnees: [OR_RESUME_TEST] })),
    );
    rendre();

    expect(await screen.findByText("CHF 1'234.50")).toBeInTheDocument(); // CA TTC
    expect(screen.getByText('CHF 456.00')).toBeInTheDocument(); // encours clients
    expect(screen.getByText('12')).toBeInTheDocument(); // OR ouverts aujourd'hui
    expect(
      screen.getByText(i18n.t('tableauBord:direction.sortiesDuSoir.titre')),
    ).toBeInTheDocument();
    // Répartition par statut et « lignes en attente » sont le geste du chef d'atelier, écartés ici.
    expect(
      screen.queryByText(i18n.t('tableauBord:activite.repartitionStatuts.titre')),
    ).not.toBeInTheDocument();
  });
});

describe('EcranTableauBord — Comptable', () => {
  it('affiche encours, encaissements, et un LIEN « à relancer » honnête (jamais un compte inventé)', async () => {
    connecterSession('comptable');
    server.use(http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)));
    rendre();

    expect(await screen.findByText('CHF 456.00')).toBeInTheDocument(); // encours
    expect(screen.getByText('CHF 987.00')).toBeInTheDocument(); // encaissements
    // Le CA facturé n'est pas son geste (écarté, §3.2 du design).
    expect(screen.queryByText("CHF 1'234.50")).not.toBeInTheDocument();

    const lien = screen.getByRole('link', { name: i18n.t('tableauBord:comptable.aRelancer.lien') });
    expect(lien).toHaveAttribute('href', '/factures');
  });
});

describe('EcranTableauBord — Chef d’atelier', () => {
  it('affiche sorties du jour, lignes en attente, équipe en cours et répartition par statut — aucun bloc financier', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_OR, () => HttpResponse.json({ ...PAGE_VIDE, donnees: [OR_RESUME_TEST] })),
      http.get(CHEMIN_POINTAGES, () =>
        HttpResponse.json({ ...PAGE_VIDE, donnees: [POINTAGE_EN_COURS] }),
      ),
    );
    rendre();

    expect(
      await screen.findByText(i18n.t('tableauBord:chefAtelier.sortiesDuJour.titre')),
    ).toBeInTheDocument();
    expect(await screen.findByText('4')).toBeInTheDocument(); // lignes en attente de validation
    expect(await screen.findByText('Marc Rossi')).toBeInTheDocument(); // équipe en cours
    expect(
      screen.getByText(i18n.t('tableauBord:activite.repartitionStatuts.titre')),
    ).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('tableauBord:financier.titre'))).not.toBeInTheDocument();
  });
});

describe('EcranTableauBord — Réceptionnaire', () => {
  it('reprend le calendrier de la semaine et les échéances pneus, plus les lignes en attente', async () => {
    connecterSession('receptionnaire');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
      http.get(CHEMIN_PNEUS, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre();

    expect(await screen.findByText(i18n.t('accueil:calendrier.titre'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('accueil:echeances.titre'))).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('tableauBord:activite.lignesEnAttenteValidation.libelle')),
    ).toBeInTheDocument();
  });
});

describe('EcranTableauBord — Magasinier', () => {
  it('propose un accès rapide aux réservations (lien, pas un compte), la liste de réapprovisionnement et les pneus à relancer', async () => {
    connecterSession('magasinier');
    server.use(
      http.get(CHEMIN_REAPPRO, () => HttpResponse.json(PAGE_VIDE)),
      http.get(CHEMIN_PNEUS, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre();

    const lien = await screen.findByRole('link', {
      name: i18n.t('tableauBord:magasinier.reservations.lien'),
    });
    expect(lien).toHaveAttribute('href', expect.stringContaining('/pieces/reservations'));
    expect(
      screen.getByText(i18n.t('tableauBord:activite.articlesSousSeuil.libelle')),
    ).toBeInTheDocument();
    expect(screen.getByText(i18n.t('accueil:echeances.titre'))).toBeInTheDocument();
  });
});

describe('EcranTableauBord — Technicien', () => {
  it('affiche 1 seul bloc, « mes OR assignés » — sous le plancher de 3, assumé (écran de travail réel = Pointage)', async () => {
    connecterSession('technicien');
    server.use(
      http.get(CHEMIN_OR, () => HttpResponse.json({ ...PAGE_VIDE, donnees: [OR_COMPLET_TEST] })),
    );
    rendre();

    expect(await screen.findByText(i18n.t('tableauBord:technicien.titre'))).toBeInTheDocument();
    expect(await screen.findByText('OR-2026-000123')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('tableauBord:financier.titre'))).not.toBeInTheDocument();
  });
});

describe('EcranTableauBord — Vendeur (tableau de bord non construit, gap signalé)', () => {
  it('affiche un message honnête et ne déclenche AUCUNE requête vers /dossiers-vente', async () => {
    connecterSession('vendeur');
    let appelsDossiersVente = 0;
    server.use(
      http.get(CHEMIN_DOSSIERS_VENTE, () => {
        appelsDossiersVente += 1;
        return HttpResponse.json(PAGE_VIDE);
      }),
    );
    rendre();

    expect(
      await screen.findByText(i18n.t('tableauBord:vendeur.indisponible.titre')),
    ).toBeInTheDocument();
    const lien = screen.getByRole('link', {
      name: i18n.t('tableauBord:vendeur.indisponible.lien'),
    });
    expect(lien).toHaveAttribute('href', expect.stringContaining('/ventes/dossiers'));

    // Laisse le temps à une éventuelle requête fautive de partir avant d'affirmer zéro appel.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(appelsDossiersVente).toBe(0);
  });
});

/**
 * RF-115, test de non-fuite F8 (`docs/design-tableau-bord-par-role.md` §3.9) — LE test le plus
 * important de ce fichier : `admin` est un rôle TECHNIQUE sans droit financier, son tableau de bord
 * ne doit JAMAIS laisser deviner qu'un bloc financier existe ailleurs (pas de carte grisée
 * « Financier », pas de titre de section vide, pas de montant CHF, et surtout AUCUNE requête vers
 * `/tableau-bord/financier`).
 */
describe('EcranTableauBord — Admin (RF-115, non-fuite financière)', () => {
  it('affiche exactement 3 blocs (OR ouverts, articles sous seuil, raccourcis), aucun montant, aucune requête financière', async () => {
    connecterSession('admin');
    let appelsFinancier = 0;
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_FINANCIER, () => {
        appelsFinancier += 1;
        return HttpResponse.json(FINANCIER_NOMINAL);
      }),
    );
    rendre();

    expect(await screen.findByText('12')).toBeInTheDocument(); // OR ouverts aujourd'hui
    expect(screen.getByText('7')).toBeInTheDocument(); // articles sous seuil
    expect(screen.getByText(i18n.t('tableauBord:admin.raccourcis.titre'))).toBeInTheDocument();

    // Non-fuite : aucun titre, libellé ou montant du bloc financier n'apparaît nulle part.
    expect(screen.queryByText(i18n.t('tableauBord:financier.titre'))).not.toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('tableauBord:financier.encoursClients.libelle')),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/CHF/)).not.toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(appelsFinancier).toBe(0);
  });
});

describe('EcranTableauBord — période sans aucune activité (zéro digne, jamais un état vide)', () => {
  it('direction : les compteurs à zéro restent affichés, jamais masqués', async () => {
    connecterSession('direction');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_VIDE)),
      http.get(CHEMIN_FINANCIER, () =>
        HttpResponse.json({
          ...FINANCIER_NOMINAL,
          encoursClientsCentimes: 0,
          chiffreAffaires: {
            totalHtCentimes: 0,
            totalTvaCentimes: 0,
            totalTtcCentimes: 0,
            nombreDocuments: 0,
          },
        }),
      ),
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre();

    expect((await screen.findAllByText('CHF 0.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('0')).toBeInTheDocument(); // OR ouverts aujourd'hui
  });
});

describe('EcranTableauBord — erreur serveur sur /tableau-bord/activite (chef d’atelier)', () => {
  it('affiche un état d’erreur actionnable sur le bloc « lignes en attente », le réessai redéclenche la requête', async () => {
    connecterSession('chef_atelier');
    let compteurAppels = 0;
    server.use(
      http.get(CHEMIN_ACTIVITE, () => {
        compteurAppels += 1;
        if (compteurAppels === 1) {
          return HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
              title: 'Erreur interne',
              status: 500,
              code: 'ERREUR_INTERNE',
              instance: 'req-1',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json(ACTIVITE_NOMINALE);
      }),
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
      http.get(CHEMIN_POINTAGES, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre();

    // Les DEUX cartes adossées à `useActiviteTableauBord` (lignes en attente, répartition par
    // statut) partagent le même résultat de requête (§ commentaire de tête de
    // `TableauBordChefAtelier`) : l'erreur s'affiche donc deux fois, une fois par carte.
    expect((await screen.findAllByText(i18n.t('tableauBord:activite.erreur.titre'))).length).toBe(
      2,
    );

    const utilisateur = userEvent.setup();
    const boutons = screen.getAllByRole('button', { name: i18n.t('commun:actions.reessayer') });
    await utilisateur.click(boutons[0] as HTMLElement);

    await waitFor(() => expect(compteurAppels).toBe(2));
    expect(await screen.findByText('4')).toBeInTheDocument();
  });
});

describe('EcranTableauBord — sélecteur de site commun', () => {
  it('reste présent quel que soit le rôle (en-tête partagée)', async () => {
    connecterSession('comptable');
    server.use(http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)));
    rendre();

    await screen.findByText('CHF 456.00');
    expect(
      within(document.body).getByText(i18n.t('navigation:entete.tousLesSites')),
    ).toBeInTheDocument();
  });
});
