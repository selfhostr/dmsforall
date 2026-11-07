import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ClientResume,
  OrdreReparationResume,
  ReponseActiviteTableauBord,
  ReponseDocumentVente,
  ReponseFinancierTableauBord,
  ReponseOrdreReparation,
  ReponsePointage,
  ReponseRendezVous,
  VehiculeResume,
} from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranTableauBord } from './EcranTableauBord';

// La liste de démarrage a ses propres requêtes et sa propre spec (`ChecklistDemarrage.spec.tsx`).
vi.mock('@/ecrans/accueil/composants/ChecklistDemarrage', () => ({
  ChecklistDemarrage: () => null,
}));

// Radix Select (`@radix-ui/react-select`, sous `SelecteurSiteTableauBord`) appelle
// `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même stub local que
// `composants/comptoir/SelecteurTri.spec.tsx` et
// `composants/recherche/PanneauResultatsRecherche.spec.tsx` (cmdk), posé ici pour le seul
// describe de ce fichier qui ouvre réellement le sélecteur (« synchronisation de la préférence de
// site »), sans affecter les specs qui se contentent de lire sa valeur affichée.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CHEMIN_ACTIVITE = '/api/v1/tableau-bord/activite';
const CHEMIN_FINANCIER = '/api/v1/tableau-bord/financier';
const CHEMIN_OR = '/api/v1/ordres-reparation';
const CHEMIN_PNEUS = '/api/v1/depots-pneus/a-relancer';
const CHEMIN_POINTAGES = '/api/v1/pointages';
const CHEMIN_REAPPRO = '/api/v1/stock/reapprovisionnement';
const CHEMIN_DOSSIERS_VENTE = '/api/v1/dossiers-vente';
const CHEMIN_RENDEZ_VOUS = '/api/v1/rendez-vous';
const CHEMIN_DOCUMENTS_VENTE = '/api/v1/documents-vente';

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
  marges: {
    vehicules: { margeCentimes: 250000, nombreVehiculesFactures: 1 },
    pieces: { disponible: false, raisonCle: 'piecesCoutNonFiable' },
    mainOeuvre: { disponible: false, raisonCle: 'mainOeuvreCoutAbsent' },
  },
  stockPieces: { totalCentimes: 987500, articlesValeurInconnueNombre: 3 },
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

/** OR de démo dont la restitution est promise aujourd'hui ET en retard (`enRetard`, calculé
 *  serveur, `OrdreReparationResume.enRetard`) — fixture dédiée pour ne pas modifier `OR_RESUME_TEST`
 *  (réutilisé tel quel par Direction/Chef d'atelier, sans ce champ). */
const OR_RESUME_EN_RETARD: OrdreReparationResume = {
  ...OR_RESUME_TEST,
  id: 'or-2',
  numero: 'OR-2026-000456',
  enRetard: true,
  // Client DISTINCT de `CLIENT_TEST` (repris par `RENDEZ_VOUS_TEST`) : les deux blocs cohabitent
  // dans le même test « site choisi », un nom partagé rendrait `getByText` ambigu.
  client: { ...CLIENT_TEST, id: 'client-2', nomAffiche: 'Urs Meier' },
};

const MOTIF_SERVICE_TEST = {
  id: 'motif-1',
  code: 'SERVICE',
  libelleFr: 'Entretien / service courant',
  libelleDe: 'Service / Wartung',
  libelleIt: 'Tagliando / manutenzione',
  dureeDefautMinutes: 60,
  heuresAtelierDefautCentiemes: null,
  actif: true,
};

/** Rendez-vous confirmé du jour (site `site-1`, seul site de `SESSION_TEST`) — fixture du bloc
 *  `CarteRendezVousJour`. */
const RENDEZ_VOUS_TEST: ReponseRendezVous = {
  id: 'rdv-1',
  siteId: 'site-1',
  client: CLIENT_TEST,
  vehicule: VEHICULE_TEST,
  type: 'service',
  motif: MOTIF_SERVICE_TEST,
  commentaire: null,
  dateLe: '2026-08-12',
  moment: 'matin',
  heureSouhaitee: '08:30:00',
  dureeEstimeeMinutes: 60,
  statut: 'confirme',
  motifAnnulation: null,
  origine: 'reservation',
  confirmeLe: '2026-08-10T09:00:00.000Z',
  honoreLe: null,
  absentConstateLe: null,
  annuleLe: null,
  ordreReparationId: null,
  creeParId: null,
  creeLe: '2026-08-10T09:00:00.000Z',
  modifieLe: '2026-08-10T09:00:00.000Z',
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

/** `GET /documents-vente` rend des `ReponseDocumentVente` COMPLETS, jamais la projection
 *  `DocumentVenteResume` (voir l'ÉCART SIGNALÉ dans `documents-vente.api.ts`) — fixture fidèle à
 *  cette forme réelle, pas à celle du contrat, pour la carte « à relancer » du tableau de bord. */
function construireFactureARelancer(id: string): ReponseDocumentVente {
  return {
    id,
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: `2026-${id}`,
    numeroSequence: 1,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: 'partiel',
    siteId: 'site-1',
    clientId: 'cl-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Client Test',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      conditionsPaiement: null,
      plaque: null,
    },
    dateDocument: '2026-07-01',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 10_000,
    totalTvaCentimes: 810,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 10_810,
    ventilationTva: [],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 10_810,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: null,
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [],
    nombreLignes: 1,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-07-01T08:00:00.000Z',
    emisPar: { utilisateurId: 'u1', nomAffiche: 'Isabelle Bonvin' },
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T08:00:00.000Z',
    modifiePar: null,
  };
}

/** Le champ de recherche de l'accueil (cmdk) est lui aussi un `combobox` : le sélecteur de site se
 *  désigne par son nom. */
const NOM_SELECTEUR_SITE = 'Tous les sites';

const DEUX_SITES = [
  ...SESSION_TEST.sites,
  { id: 'site-2', code: 'SECOND', nom: 'Second site', actif: true },
];

/** `sites` : un seul site (défaut) masque le sélecteur de site (site implicite). */
function connecterSession(
  role: (typeof SESSION_TEST)['utilisateur']['role'],
  sites: typeof SESSION_TEST.sites = SESSION_TEST.sites,
) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({
        ...SESSION_TEST,
        sites,
        utilisateur: { ...SESSION_TEST.utilisateur, role },
      }),
    ),
    // Blocs « à faire » de l'accueil (factures échues) et recherche : vides par défaut, un test
    // qui s'intéresse à ces données les surcharge avec son propre `server.use`.
    http.get(CHEMIN_DOCUMENTS_VENTE, () => HttpResponse.json(PAGE_VIDE)),
    http.get(CHEMIN_RENDEZ_VOUS, () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/recherche', () =>
      HttpResponse.json({ resultats: [], plaqueInterchangeable: false }),
    ),
  );
}

function rendre(cheminInitial = '/tableau-bord') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[cheminInitial]}>
        <Routes>
          <Route path="/tableau-bord" element={<EcranTableauBord />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranTableauBord — Direction', () => {
  it('affiche les 6 blocs attendus : encours, CA, OR en atelier, marge véhicules, marge indisponible, stock, sorties du soir', async () => {
    connecterSession('direction');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      http.get(CHEMIN_OR, () => HttpResponse.json({ ...PAGE_VIDE, donnees: [OR_RESUME_TEST] })),
    );
    rendre();

    expect(await screen.findByText("CHF 1'234.50")).toBeInTheDocument(); // CA TTC
    expect(screen.getByText('CHF 456.00')).toBeInTheDocument(); // encours clients
    // « OR actuellement en atelier » (défaut corrigé du 14.08.2026) : SOMME des 6 statuts de
    // ACTIVITE_NOMINALE (2+3+5+1+6+2 = 19), PAS `ordresReparationOuvertsPeriode` (12, valeur
    // délibérément différente dans la fixture pour prouver que la carte lit le bon champ).
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    // Marge véhicules : CHF 2'500.00 (250000 centimes), calculable même si elle vaut 0 ailleurs.
    expect(screen.getByText("CHF 2'500.00")).toBeInTheDocument();
    // Marge pièces/main-d'œuvre : jamais un montant, un mot distinct.
    expect(
      screen.getByText(i18n.t('tableauBord:financier.marges.indisponible.libelle')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('tableauBord:financier.marges.indisponible.piecesCoutNonFiable')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('tableauBord:financier.marges.indisponible.mainOeuvreCoutAbsent')),
    ).toBeInTheDocument();
    // Stock pièces valorisé : CHF 9'875.00 (987500 centimes), avec les 3 articles à valeur
    // inconnue signalés explicitement — jamais absorbés silencieusement dans le total.
    expect(screen.getByText("CHF 9'875.00")).toBeInTheDocument();
    expect(
      screen.getByText(
        i18n.t('tableauBord:financier.stockPieces.articlesValeurInconnue', { count: 3 }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('tableauBord:direction.sortiesDuSoir.titre')),
    ).toBeInTheDocument();
    // Répartition par statut et « lignes en attente » sont le geste du chef d'atelier, écartés ici.
    expect(
      screen.queryByText(i18n.t('tableauBord:activite.repartitionStatuts.titre')),
    ).not.toBeInTheDocument();
    // Le sélecteur de période dit explicitement qu'il s'applique tout seul (défaut #3, 14.08.2026).
    expect(
      screen.getByText(i18n.t('tableauBord:periode.appliqueeAutomatiquement')),
    ).toBeInTheDocument();
  });
});

describe('EcranTableauBord — Comptable', () => {
  it('affiche encours, encaissements, et un COMPTE « à relancer » réel — jamais un compte inventé', async () => {
    connecterSession('comptable');
    server.use(
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      // Sous la limite de comptage (`LIMITE_COMPTAGE_A_RELANCER` = 50, `TableauBordComptable.tsx`) :
      // la longueur de la première page EST le compte exact, pas un chiffre plafonné.
      http.get(CHEMIN_DOCUMENTS_VENTE, () =>
        HttpResponse.json({
          donnees: [
            construireFactureARelancer('f1'),
            construireFactureARelancer('f2'),
            construireFactureARelancer('f3'),
          ],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );
    rendre();

    expect(await screen.findByText('CHF 456.00')).toBeInTheDocument(); // encours
    expect(screen.getByText('CHF 987.00')).toBeInTheDocument(); // encaissements
    // Le CA facturé n'est pas son geste (écarté, §3.2 du design).
    expect(screen.queryByText("CHF 1'234.50")).not.toBeInTheDocument();

    // Le compte réel (3), pas un texte générique et pas une valeur devinée.
    expect(await screen.findByText('3')).toBeInTheDocument();

    const lien = screen.getByRole('link', { name: i18n.t('tableauBord:comptable.aRelancer.lien') });
    expect(lien).toHaveAttribute('href', '/factures');
  });

  it('« à relancer » au-delà de la limite : annonce honnêtement « 50+ », jamais un chiffre exact non fondé', async () => {
    connecterSession('comptable');
    server.use(
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      // Page pleine (50, la `LIMITE_PAGE` de `useListeDocumentsVente`) + `curseurSuivant` non nul :
      // il existe une suite, la carte ne doit donc PAS afficher « 50 » comme s'il s'agissait du
      // total exact — c'est tout le sens du plafond honnête (`docs`/commentaire `TableauBordComptable.tsx`).
      http.get(CHEMIN_DOCUMENTS_VENTE, () =>
        HttpResponse.json({
          donnees: Array.from({ length: 50 }, (_, index) =>
            construireFactureARelancer(`f${index}`),
          ),
          curseurSuivant: 'curseur-page-2',
          limite: 50,
        }),
      ),
    );
    rendre();

    expect(await screen.findByText('50+')).toBeInTheDocument();
    expect(screen.queryByText('50')).not.toBeInTheDocument();

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
  it('sans site choisi (garage à plusieurs sites) : invite à en choisir un pour les rendez-vous, garde les autres blocs réels', async () => {
    connecterSession('receptionnaire', DEUX_SITES);
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_OR, () => HttpResponse.json({ ...PAGE_VIDE, donnees: [OR_RESUME_TEST] })),
    );
    rendre();

    expect(
      await screen.findByText(i18n.t('tableauBord:receptionnaire.rendezVousJour.siteRequis')),
    ).toBeInTheDocument();
    // Répartition par statut : reste un bloc de comptes agrégés « tous sites », pas de site requis.
    expect(
      screen.getByText(i18n.t('tableauBord:activite.repartitionStatuts.titre')),
    ).toBeInTheDocument();
    // Restitutions du jour : ne dépend pas non plus d'un site choisi (agrège tous les sites).
    expect(
      await screen.findByText(i18n.t('tableauBord:receptionnaire.restitutionsJour.titre')),
    ).toBeInTheDocument();
  });

  it('site choisi : affiche les rendez-vous du jour, les restitutions (avec retard signalé) et la répartition par statut', async () => {
    connecterSession('receptionnaire');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_RENDEZ_VOUS, () =>
        HttpResponse.json({ ...PAGE_VIDE, donnees: [RENDEZ_VOUS_TEST] }),
      ),
      http.get(CHEMIN_OR, () =>
        HttpResponse.json({ ...PAGE_VIDE, donnees: [OR_RESUME_EN_RETARD] }),
      ),
    );
    rendre('/tableau-bord?site=site-1');

    // Rendez-vous du jour : heure, client, motif.
    expect(await screen.findByText('08:30')).toBeInTheDocument();
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText('Entretien / service courant')).toBeInTheDocument();

    // Restitutions du jour : le retard réel (serveur) est signalé, jamais rederivé côté client.
    // TROIS occurrences depuis l'issue #112 (`CarteOrEnRetard.tsx`) : le même mock `CHEMIN_OR`
    // alimente à la fois « Restitutions du jour » (badge « En retard » sur `OR_RESUME_EN_RETARD`,
    // vérifié ici) ET la nouvelle carte dédiée — son titre (« En retard », même texte que le
    // badge, clé i18n distincte `enRetardCarte.titre`) PLUS son propre badge sur la même ligne
    // (les deux cartes lisent la même donnée serveur, jamais deux calculs distincts).
    expect(await screen.findAllByText(i18n.t('tableauBord:activite.enRetard'))).toHaveLength(3);

    // Répartition par statut : vrais comptes, plus le zéro incertain « lignes en attente ».
    expect(
      await screen.findByText(i18n.t('tableauBord:activite.repartitionStatuts.titre')),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('tableauBord:activite.lignesEnAttenteValidation.libelle')),
    ).not.toBeInTheDocument();
  });

  it('aucun rendez-vous aujourd’hui : état vide rassurant, distinct d’une erreur', async () => {
    connecterSession('receptionnaire');
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_RENDEZ_VOUS, () => HttpResponse.json(PAGE_VIDE)),
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre('/tableau-bord?site=site-1');

    expect(
      await screen.findByText(i18n.t('tableauBord:receptionnaire.rendezVousJour.vide.titre')),
    ).toBeInTheDocument();
  });

  it('erreur serveur sur /rendez-vous : état d’erreur actionnable, le réessai redéclenche la requête', async () => {
    connecterSession('receptionnaire');
    let compteurAppels = 0;
    server.use(
      http.get(CHEMIN_ACTIVITE, () => HttpResponse.json(ACTIVITE_NOMINALE)),
      http.get(CHEMIN_RENDEZ_VOUS, () => {
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
        return HttpResponse.json({ ...PAGE_VIDE, donnees: [RENDEZ_VOUS_TEST] });
      }),
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre('/tableau-bord?site=site-1');

    expect(
      await screen.findByText(i18n.t('tableauBord:receptionnaire.rendezVousJour.erreur.titre')),
    ).toBeInTheDocument();

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.reessayer') }),
    );

    await waitFor(() => expect(compteurAppels).toBe(2));
    expect(await screen.findByText('08:30')).toBeInTheDocument();
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
  it('affiche exactement 3 blocs (OR en atelier, articles sous seuil, raccourcis), aucun montant, aucune requête financière', async () => {
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

    // « OR actuellement en atelier » : même défaut corrigé que Direction, même somme (19), jamais
    // `ordresReparationOuvertsPeriode` (12).
    expect(await screen.findByText('19')).toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
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
  it('direction : les compteurs à zéro restent affichés, jamais masqués — y compris la marge véhicules et le stock, DISTINCTS de la marge indisponible', async () => {
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
          marges: {
            vehicules: { margeCentimes: 0, nombreVehiculesFactures: 0 },
            pieces: { disponible: false, raisonCle: 'piecesCoutNonFiable' },
            mainOeuvre: { disponible: false, raisonCle: 'mainOeuvreCoutAbsent' },
          },
          stockPieces: { totalCentimes: 0, articlesValeurInconnueNombre: 0 },
        }),
      ),
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre();

    // Zéro DIGNE : CA, encours, marge véhicules et stock à zéro s'affichent tous comme "CHF 0.00"
    // — au moins 4 occurrences (une par carte à zéro), jamais masquées.
    expect((await screen.findAllByText('CHF 0.00')).length).toBeGreaterThanOrEqual(4);
    // « OR actuellement en atelier » : ACTIVITE_VIDE n'a aucun OR actif, 0 est la vraie donnée.
    expect(screen.getByText('0')).toBeInTheDocument();
    // La marge pièces/main-d'œuvre reste « Indisponible » (un mot, jamais un montant à 0) même
    // quand tout le reste de la réponse est à zéro — distinction structurelle préservée.
    expect(
      screen.getByText(i18n.t('tableauBord:financier.marges.indisponible.libelle')),
    ).toBeInTheDocument();
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
    connecterSession('comptable', DEUX_SITES);
    server.use(
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      // Rôle comptable : la carte « à relancer » interroge aussi `documents-vente` (voir le
      // describe dédié plus haut) — sans handler ici, MSW logue une requête non interceptée.
      http.get(CHEMIN_DOCUMENTS_VENTE, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre();

    await screen.findByText('CHF 456.00');
    expect(
      within(document.body).getByText(i18n.t('navigation:entete.tousLesSites')),
    ).toBeInTheDocument();
  });

  it('garage à un seul site : aucun sélecteur (le site est implicite)', async () => {
    connecterSession('comptable');
    server.use(
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      http.get(CHEMIN_DOCUMENTS_VENTE, () => HttpResponse.json(PAGE_VIDE)),
    );
    rendre();

    await screen.findByText('CHF 456.00');
    expect(screen.queryByRole('combobox', { name: NOM_SELECTEUR_SITE })).not.toBeInTheDocument();
  });
});

/**
 * DÉFAUT MESURÉ n°1, corrigé au lot « bandeau haut » (26.08.2026) : avant ce lot, AUCUN choix fait
 * dans ce sélecteur — site précis ou « Tous les sites » — ne synchronisait
 * `ContexteSiteCourant.tsx`, seul mécanisme lu par le CHROME (`BarreOutilsSuperieure.tsx`,
 * `BarreLaterale.tsx`) pour résoudre le site de la navigation suivante. Conséquence : un clic de
 * menu APRÈS un passage par « Tous les sites » ici pouvait ramener sur un site jamais choisi dans
 * cette session, sans le moindre signal. `rendreAvecPreferenceSite` monte `FournisseurSiteCourant`
 * (absent de `rendre()` ci-dessus, comme en usage réel hors d'`AppShell.tsx`) — seul moyen
 * d'observer cette synchronisation.
 */
describe('EcranTableauBord — synchronisation de la préférence de site (défaut mesuré n°1)', () => {
  function rendreAvecPreferenceSite(cheminInitial = '/tableau-bord'): void {
    const queryClient = creerQueryClientTest();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[cheminInitial]}>
          <FournisseurSiteCourant>
            <Routes>
              <Route path="/tableau-bord" element={<EcranTableauBord />} />
            </Routes>
          </FournisseurSiteCourant>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  afterEach(() => {
    window.localStorage.clear();
  });

  it('choisir un site PRÉCIS mémorise ce site comme préférence globale', async () => {
    connecterSession('comptable', DEUX_SITES);
    server.use(
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      http.get(CHEMIN_DOCUMENTS_VENTE, () => HttpResponse.json(PAGE_VIDE)),
    );
    const utilisateur = userEvent.setup();
    rendreAvecPreferenceSite();

    await screen.findByText('CHF 456.00');
    await utilisateur.click(screen.getByRole('combobox', { name: NOM_SELECTEUR_SITE }));
    await utilisateur.click(await screen.findByText('Site principal'));

    expect(window.localStorage.getItem('dfa.site-courant.tenant-1')).toBe('site-1');
  });

  it('« Tous les sites » NE touche PAS la préférence mémorisée — le dernier site réel reste le défaut', async () => {
    window.localStorage.setItem('dfa.site-courant.tenant-1', 'site-1');
    connecterSession('comptable', DEUX_SITES);
    server.use(
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_NOMINAL)),
      http.get(CHEMIN_DOCUMENTS_VENTE, () => HttpResponse.json(PAGE_VIDE)),
    );
    const utilisateur = userEvent.setup();
    // Départ sur `?site=site-1` (le trigger affiche donc « Site principal », jamais « Tous les
    // sites » comme celui de l'autre test ci-dessus) : ce texte cible SANS AMBIGUÏTÉ l'option
    // « Tous les sites » du menu déroulant, qui ne duplique alors le libellé d'aucun autre élément
    // déjà visible à l'écran.
    rendreAvecPreferenceSite('/tableau-bord?site=site-1');

    await screen.findByText('CHF 456.00');
    await utilisateur.click(screen.getByRole('combobox', { name: NOM_SELECTEUR_SITE }));
    await utilisateur.click(await screen.findByText(i18n.t('navigation:entete.tousLesSites')));

    expect(window.localStorage.getItem('dfa.site-courant.tenant-1')).toBe('site-1');
  });
});
