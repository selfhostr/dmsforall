import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ClientResume,
  PageCurseur,
  ReponseLigneOr,
  ReponseOrdreReparation,
  ReponsePointage,
  VehiculeResume,
} from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranPointageTechnicien } from './EcranPointageTechnicien';

// Le bug corrigé ici (voir apps/web/src/lib/uuid.ts) : `construireEntreeDemarrage` peut lever
// (génération d'identifiant), et cette construction doit rester DANS le `try` de
// `demarrerEtMemoriser` pour que l'erreur s'affiche au lieu de disparaître en promesse rejetée non
// observée (les appelants invoquent `void demarrerEtMemoriser(...)`). On force ce cas en mockant
// le module `@/lib/uuid` pour qu'il lève systématiquement, sans dépendre d'un environnement réseau
// particulier.
vi.mock('@/lib/uuid', () => ({
  genererUuid: () => {
    throw new TypeError('crypto.randomUUID is not a function');
  },
}));

// Radix Select (SelecteurSitePointage) appelle des API absentes de jsdom — même stub que les
// autres écrans qui composent un `<Select>` (ex. `EcranListeFournisseurs.spec.tsx`).
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function pageOrdres(
  donnees: readonly ReponseOrdreReparation[],
): PageCurseur<ReponseOrdreReparation> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

const VEHICULE_TEST: VehiculeResume = {
  id: 'veh-1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: null,
  premiereMiseEnCirculationLe: null,
  identificationIncomplete: false,
};

const CLIENT_TEST: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: 'Lausanne',
  nombreVehicules: 1,
  dernierPassageLe: null,
};

const POINTAGE_EN_COURS: ReponsePointage = {
  id: 'pointage-1',
  siteId: 'site-1',
  technicienId: SESSION_TEST.utilisateur.id,
  technicienNomAffiche: `${SESSION_TEST.utilisateur.prenom} ${SESSION_TEST.utilisateur.nom}`,
  statut: 'en_cours',
  nature: 'productif_or',
  ordreReparationId: 'or-1',
  ligneOrId: null,
  activiteIndirecte: null,
  source: 'ecran_atelier',
  appareilId: null,
  debutLe: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  finLe: null,
  dureeBruteSecondes: null,
  dureeArrondieCentiemes: null,
  clotureAutomatique: false,
  anomalie: null,
  derniereCorrection: null,
  creeLe: new Date().toISOString(),
  modifieLe: new Date().toISOString(),
};

/** Réponse complète, utilisée à la fois pour `GET /ordres-reparation` (« Mes OR du jour », voir
 *  `OR_ASSIGNE` ci-dessous) et `GET /ordres-reparation/:id` (`DialogueChoixCiblePointage`) : les
 *  deux endpoints renvoient RÉELLEMENT le même document complet côté serveur (`ServiceOr.lister`
 *  délègue à `assemblerDocument`, voir le commentaire de `mes-ordres-assignes.api.ts`) — avant le
 *  correctif du bug carte/détail (OR-2026-15), ce fichier typait à tort la liste en
 *  `OrdreReparationResume` (projection sans `lignes`), ce qui masquait que le compteur de la carte
 *  ne pouvait pas filtrer par technicien. Champs alignés sur `construireOr` d'
 *  `EcranFicheOrdreReparation.spec.tsx` pour rester cohérent avec la convention de fixture déjà en
 *  usage dans le dépôt. */
function construireOrDetail(
  overrides: Partial<ReponseOrdreReparation> = {},
): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-000123',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'ouvert',
    client: CLIENT_TEST,
    vehicule: VEHICULE_TEST,
    figees: {
      clientDesignation: 'Jean Dupont',
      adresseFacturation: null,
      plaque: '123456',
      detenteurClientId: 'cl-1',
    },
    conducteurPresentNom: null,
    kilometrageEntree: 90000,
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
    ouvertLe: '2026-08-03T06:00:00.000Z',
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    demandes: [],
    lignes: [],
    nombreLignes: 2,
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
    creeLe: '2026-08-03T06:00:00.000Z',
    modifieLe: '2026-08-03T06:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

/** `OR_ASSIGNE` = ce que renvoie `GET /ordres-reparation` pour « Mes OR du jour » : le document
 *  complet (voir le commentaire de `construireOrDetail` ci-dessus), avec `nombreLignes: 2` mais
 *  `lignes: []` par défaut — les tests qui n'ont pas besoin de vérifier le compteur de lignes
 *  assignées passent leurs propres `lignes` via `construireOrDetail({ lignes: [...] })`. */
const OR_ASSIGNE: ReponseOrdreReparation = construireOrDetail();

function construireLigne(overrides: Partial<ReponseLigneOr> = {}): ReponseLigneOr {
  return {
    id: 'ligne-1',
    ordreReparationId: 'or-1',
    numeroOrdre: 1,
    type: 'fourniture',
    origine: 'constatee',
    statut: 'en_cours',
    payeur: 'client',
    payeurClientId: null,
    blocage: 'aucun',
    designation: 'Plaquettes de frein avant',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: null,
    tempsBaremeConstructeurCentiemes: null,
    tempsReelCentiemes: null,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    figeLe: null,
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: null,
    securite: false,
    fournieParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    creeLe: '2026-08-03T06:00:00.000Z',
    modifieLe: '2026-08-03T06:00:00.000Z',
    ...overrides,
  };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage']}>
        <Routes>
          <Route path="/pointage" element={<EcranPointageTechnicien />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranPointageTechnicien', () => {
  it('affiche « Mes OR du jour » et les activités indirectes quand aucun pointage n’est en cours', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([OR_ASSIGNE]))),
    );

    rendre();

    expect(await screen.findByText('OR-000123')).toBeInTheDocument();
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
    // Activité indirecte, tuile toujours proposée (RM-87 : trois cibles, à tout instant).
    expect(screen.getByRole('button', { name: 'Nettoyage' })).toBeInTheDocument();
  });

  it('état vide : invite honnête quand aucun OR n’est assigné au technicien', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
    );

    rendre();

    expect(
      await screen.findByText("Aucun OR à pointer pour vous aujourd'hui."),
    ).toBeInTheDocument();
  });

  it('affiche le chrono et le bouton Arrêter quand un pointage est en cours', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE_EN_COURS]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
    );

    rendre();

    expect(await screen.findByRole('button', { name: 'Arrêter' })).toBeInTheDocument();
    // Un pointage `productif_or` propose une pause, pas de reprise (aucune cible mémorisée après
    // un rendu à froid, voir le commentaire de tête d'`EcranPointageTechnicien.tsx`).
    expect(screen.getByRole('button', { name: 'Mettre en pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprendre' })).not.toBeInTheDocument();
  });

  it('affiche une erreur actionnable si le serveur échoue à lire le pointage en cours', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: '',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
    );

    rendre();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument(),
    );
  });

  it('affiche correctement un bouton de ligne avec une désignation très longue', async () => {
    const ligneLongue = construireLigne({
      id: 'ligne-longue',
      designation: 'Kit plaquettes + disques de frein arrière (sur commande fournisseur)',
      technicienId: SESSION_TEST.utilisateur.id,
    });

    const orDetailAvecLignesLongues = construireOrDetail({ lignes: [ligneLongue] });

    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([OR_ASSIGNE]))),
      http.get('/api/v1/ordres-reparation/or-1', () =>
        HttpResponse.json(orDetailAvecLignesLongues),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    // Ouvre le dialogue en cliquant sur l'OR.
    await utilisateur.click(await screen.findByText('OR-000123'));

    // Vérifie que la ligne avec la désignation longue est affichée et cliquable.
    const boutonLigneLongue = await screen.findByRole('button', {
      name: 'Kit plaquettes + disques de frein arrière (sur commande fournisseur)',
    });
    expect(boutonLigneLongue).toBeInTheDocument();
    expect(boutonLigneLongue).toBeEnabled();
  });

  it(
    "affiche une erreur à l'utilisateur (au lieu de rien) quand la construction de l'entrée de " +
      'démarrage échoue — régression du bug crypto.randomUUID hors contexte sécurisé, voir @/lib/uuid',
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([OR_ASSIGNE]))),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(construireOrDetail())),
      );

      // `handleChoisirOrEntier` appelle `demarrerEtMemoriser` via `void` (comme
      // `handleChoisirLigne`/`handleDemarrerActiviteIndirecte`), sans l'attendre ni rattraper son
      // rethrow — seuls `handlePause`/`handleReprendre` le rattrapent, dans LEUR PROPRE
      // try/catch (voir le commentaire de tête de `demarrerEtMemoriser`, préservé tel quel par
      // consigne). Le message d'erreur utilisateur est bien affiché AVANT ce rethrow
      // (`setErreurAction`, ce que ce test vérifie), mais la promesse reste techniquement « non
      // gérée » à l'échelle du moteur JS — un comportement PRÉEXISTANT, identique pour une vraie
      // panne réseau, hors périmètre de ce correctif. On désarme le rapporteur d'erreurs non
      // gérées de Vitest pour la durée de CE test précis (et on le restaure juste après), plutôt
      // que de contourner le scénario réel — la trace du bug signalé passe exactement par ce
      // chemin : `onClick` -> `handleChoisirOrEntier`.
      const rapporteursOriginaux = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      // IMPORTANT : Node considère qu'une rejection non gérée sans AUCUN listener `unhandledRejection`
      // doit faire planter le process (comportement par défaut depuis Node 15) — il faut donc bien
      // reposer un listener bénin, pas simplement retirer ceux de Vitest, sous peine de transformer
      // la rejection ignorée en exception non rattrapée qui ferait échouer la suite quand même.
      process.on('unhandledRejection', () => {});
      try {
        const utilisateur = userEvent.setup();
        rendre();

        // Ouvre « Que pointez-vous ? » en tapant l'OR assigné.
        await utilisateur.click(await screen.findByText('OR-000123'));
        const boutonOrEntier = await screen.findByRole('button', { name: 'Pointer sur cet OR' });

        // `genererUuid` (mocké en tête de fichier) lève : `construireEntreeDemarrage` lève avec
        // lui. Avant le correctif, cette erreur était HORS du `try` de `demarrerEtMemoriser` et
        // disparaissait sans jamais appeler `setErreurAction` — aucune requête réseau, aucun
        // message, la boîte de dialogue se refermait et plus rien ne se passait. Après le
        // correctif, elle est capturée et traduite comme n'importe quelle autre panne d'action.
        await utilisateur.click(boutonOrEntier);

        expect(
          await screen.findByText("L'opération n'a pas pu être effectuée. Réessayez."),
        ).toBeInTheDocument();

        // Laisse Node achever son cycle de détection des rejections non gérées PENDANT que le
        // listener bénin est encore en place, avant de restaurer celui de Vitest juste après.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.removeAllListeners('unhandledRejection');
        for (const rapporteur of rapporteursOriginaux) {
          process.on('unhandledRejection', rapporteur as NodeJS.UnhandledRejectionListener);
        }
      }
    },
  );

  it(
    'carte et détail affichent le même nombre — régression OR-2026-15 : lignes non assignées à ' +
      'ce technicien (`technicienId: null`), la carte affichait « 2 lignes qui vous sont ' +
      'assignées » quand le détail affichait « Aucune ligne assignée »',
    async () => {
      const ligneNonAssignee1 = construireLigne({ id: 'ligne-1', technicienId: null });
      const ligneNonAssignee2 = construireLigne({ id: 'ligne-2', technicienId: null });
      // `nombreLignes: 2` (le total serveur, non filtré) délibérément conservé égal au nombre de
      // lignes : c'est exactement ce total que le bug utilisait à tort comme compteur affiché.
      const orNonAssigne = construireOrDetail({
        lignes: [ligneNonAssignee1, ligneNonAssignee2],
        nombreLignes: 2,
      });

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([orNonAssigne]))),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(orNonAssigne)),
      );

      const utilisateur = userEvent.setup();
      rendre();

      // La carte : aucune des deux lignes n'est assignée à CE technicien — le compteur doit
      // afficher 0, jamais `nombreLignes` (2, le total serveur non filtré).
      expect(await screen.findByText('0 ligne qui vous est assignée')).toBeInTheDocument();
      expect(screen.queryByText(/lignes qui vous sont assignées/)).not.toBeInTheDocument();

      // Le détail doit annoncer EXACTEMENT la même chose : aucune ligne assignée.
      await utilisateur.click(screen.getByText('OR-000123'));
      expect(
        await screen.findByText(
          "Aucune ligne ne vous est assignée sur cet OR — vous pouvez pointer sur l'OR entier.",
        ),
      ).toBeInTheDocument();
    },
  );

  it('carte : compte uniquement les lignes assignées au technicien courant, pas le total de l’OR', async () => {
    const idTechnicien = SESSION_TEST.utilisateur.id;
    const ligneAMoi1 = construireLigne({
      id: 'ligne-a',
      technicienId: idTechnicien,
      designation: 'Vidange',
    });
    const ligneAMoi2 = construireLigne({
      id: 'ligne-b',
      technicienId: idTechnicien,
      designation: 'Contrôle freins',
    });
    const ligneAutreTechnicien = construireLigne({
      id: 'ligne-c',
      technicienId: 'un-autre-technicien',
      designation: 'Pneus',
    });
    // 2 lignes m'appartiennent, 1 appartient à un collègue : le compteur doit valoir 2, pas
    // `nombreLignes` (3, le total de l'OR).
    const or = construireOrDetail({
      lignes: [ligneAMoi1, ligneAMoi2, ligneAutreTechnicien],
      nombreLignes: 3,
    });

    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([or]))),
      http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(or)),
    );

    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('2 lignes qui vous sont assignées')).toBeInTheDocument();

    await utilisateur.click(screen.getByText('OR-000123'));
    expect(await screen.findByRole('button', { name: 'Vidange' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contrôle freins' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pneus' })).not.toBeInTheDocument();
  });
});
