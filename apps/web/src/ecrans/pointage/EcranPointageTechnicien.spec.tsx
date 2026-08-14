import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ClientResume,
  EntreeDemarragePointage,
  PageCurseur,
  ReponseLigneOr,
  ReponseOrdreReparation,
  ReponsePointage,
  VehiculeResume,
} from '@dfa/shared';

import '@/i18n';

import { genererUuid } from '@/lib/uuid';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranPointageTechnicien } from './EcranPointageTechnicien';

// Mock CONTRÔLABLE (pas une fonction qui lève systématiquement) : les correctifs #148/#117
// ajoutés à ce fichier exercent RÉELLEMENT `demarrerEtMemoriser` de bout en bout (un vrai
// `POST /pointages` doit partir), ce qui exige un `entree.id` valide à chaque appel — un mock qui
// lève TOUJOURS empêcherait ces scénarios de jamais atteindre le réseau. Par défaut, un identifiant
// stable suffisant pour ces tests (aucune assertion ne porte sur son unicité). Le SEUL test qui a
// encore besoin du comportement historique (lever) l'active explicitement via
// `mockImplementationOnce`, pour ce seul appel — voir plus bas.
vi.mock('@/lib/uuid', () => ({
  genererUuid: vi.fn(() => 'uuid-mock-test'),
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
  emplacementLibre: null,
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
  ordreReparationNumero: 'OR-000123',
  ligneOrId: null,
  ligneOrDesignation: null,
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

  it(
    'état vide (#148) : invite EXPLICITE quand aucun OR n’est assigné, jamais le texte muet ' +
      "d'avant ce correctif — la Direction/l'encadrement, qui n'a normalement aucune ligne " +
      "assignée, doit comprendre POURQUOI la liste est vide et qu'un autre chemin existe",
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
      );

      rendre();

      expect(
        await screen.findByText("Aucun OR ne vous est assigné pour l'instant."),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Vous pouvez tout de même choisir n'importe quelle OR ouverte ci-dessous pour démarrer un pointage.",
        ),
      ).toBeInTheDocument();
    },
  );

  it(
    'correctif #148 : rôle chef_atelier/direction sans aucun OR assigné peut quand même démarrer ' +
      'un pointage sur N’IMPORTE QUELLE OR ouverte via « Toutes les OR ouvertes » (dépliée ' +
      'automatiquement puisque « Mes OR du jour » est vide) — même chemin de démarrage que « Mes ' +
      'OR du jour » (`orSelectionneId` -> `DialogueChoixCiblePointage` -> `handleChoisirOrEntier`)',
    async () => {
      const orNonAssigne = construireOrDetail({ id: 'or-9', numero: 'OR-000999' });
      const appelsDemarrer: EntreeDemarragePointage[] = [];

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
        // Deux appelants DIFFÉRENTS frappent ce même endpoint : « Mes OR du jour »
        // (`useMesOrdresAssignes`, TOUJOURS `technicienId=`) et « Toutes les OR ouvertes »
        // (`SelecteurOrOuvert`, JAMAIS `technicienId=`) — seul ce paramètre les distingue,
        // voir `mes-ordres-assignes.api.ts` vs `hooks/atelier/ordres-reparation.api.ts`.
        http.get('/api/v1/ordres-reparation', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.has('technicienId')) {
            return HttpResponse.json(pageOrdres([]));
          }
          return HttpResponse.json(pageOrdres([orNonAssigne]));
        }),
        http.get('/api/v1/ordres-reparation/or-9', () => HttpResponse.json(orNonAssigne)),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          return HttpResponse.json(
            {
              donnees: {
                ...POINTAGE_EN_COURS,
                id: entree.id,
                ordreReparationId: orNonAssigne.id,
                ordreReparationNumero: orNonAssigne.numero,
                nature: 'productif_or',
                ligneOrId: null,
                ligneOrDesignation: null,
              },
              avertissements: [],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await screen.findByText("Aucun OR ne vous est assigné pour l'instant.");
      // Repli automatique : la liste élargie est déjà visible, aucun clic « Afficher » requis.
      expect(await screen.findByText('OR-000999')).toBeInTheDocument();

      await utilisateur.click(screen.getByText('OR-000999'));
      await utilisateur.click(await screen.findByRole('button', { name: 'Pointer sur cet OR' }));

      await waitFor(() => expect(appelsDemarrer).toHaveLength(1));
      expect(appelsDemarrer[0]).toMatchObject({
        nature: 'productif_or',
        ordreReparationId: 'or-9',
      });
      expect(await screen.findByRole('button', { name: 'Arrêter' })).toBeInTheDocument();
    },
  );

  it(
    'correctif #117 : « Changer » de cible pendant un pointage en cours envoie UN SEUL appel ' +
      '`POST /pointages` (aucun `arreter` explicite côté client — le serveur referme l’ancien ' +
      'pointage en cascade, RM-89/90) et affiche l’avertissement de clôture automatique renvoyé',
    async () => {
      const orCible = construireOrDetail({ id: 'or-2', numero: 'OR-000456' });
      const appelsDemarrer: EntreeDemarragePointage[] = [];
      const appelsArreter: string[] = [];

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE_EN_COURS]))),
        http.get('/api/v1/ordres-reparation', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.has('technicienId')) {
            return HttpResponse.json(pageOrdres([orCible]));
          }
          return HttpResponse.json(pageOrdres([]));
        }),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(construireOrDetail())),
        http.get('/api/v1/ordres-reparation/or-2', () => HttpResponse.json(orCible)),
        http.post('/api/v1/pointages/:id/arreter', ({ params }) => {
          appelsArreter.push(String(params.id));
          return HttpResponse.json({
            donnees: { ...POINTAGE_EN_COURS, statut: 'termine' },
            avertissements: [],
          });
        }),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          return HttpResponse.json(
            {
              donnees: {
                ...POINTAGE_EN_COURS,
                id: entree.id,
                ordreReparationId: orCible.id,
                ordreReparationNumero: orCible.numero,
                nature: 'productif_or',
                ligneOrId: null,
                ligneOrDesignation: null,
              },
              avertissements: [
                {
                  code: 'POINTAGE_CLOTURE_AUTOMATIQUE',
                  message: 'Le pointage précédent de ce technicien a été clôturé automatiquement.',
                  donnees: { pointageId: POINTAGE_EN_COURS.id },
                },
              ],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await utilisateur.click(await screen.findByRole('button', { name: 'Changer' }));
      await utilisateur.click(await screen.findByText('OR-000456'));
      await utilisateur.click(await screen.findByRole('button', { name: 'Pointer sur cet OR' }));

      await waitFor(() => expect(appelsDemarrer).toHaveLength(1));
      expect(appelsArreter).toHaveLength(0);
      expect(
        await screen.findByText('Ce pointage a été clôturé automatiquement à la fermeture.'),
      ).toBeInTheDocument();
    },
  );

  it(
    'non-régression : « Mettre en pause » continue d’enchaîner arrêter PUIS démarrer (deux appels ' +
      'distincts), à la différence de « Changer » (un seul appel) — le mécanisme pause/reprise ' +
      "n'est pas touché par le correctif #117",
    async () => {
      const appelsDemarrer: EntreeDemarragePointage[] = [];
      const appelsArreter: string[] = [];

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE_EN_COURS]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(construireOrDetail())),
        http.post('/api/v1/pointages/:id/arreter', ({ params }) => {
          appelsArreter.push(String(params.id));
          return HttpResponse.json({
            donnees: {
              ...POINTAGE_EN_COURS,
              statut: 'termine',
              finLe: new Date().toISOString(),
            },
            avertissements: [],
          });
        }),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          return HttpResponse.json(
            {
              donnees: {
                ...POINTAGE_EN_COURS,
                id: entree.id,
                nature: 'indirect',
                activiteIndirecte: 'pause',
                ordreReparationId: null,
                ordreReparationNumero: null,
                ligneOrId: null,
                ligneOrDesignation: null,
              },
              avertissements: [],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await utilisateur.click(await screen.findByRole('button', { name: 'Mettre en pause' }));

      await waitFor(() => expect(appelsArreter).toHaveLength(1));
      await waitFor(() => expect(appelsDemarrer).toHaveLength(1));
      expect(appelsDemarrer[0]).toMatchObject({ nature: 'indirect', activiteIndirecte: 'pause' });
    },
  );

  it(
    'point 5 (bandeau de reprise) : apparaît pendant N’IMPORTE QUELLE activité indirecte — pas ' +
      'seulement la pause —, disparaît une fois la reprise effectuée, et un SEUL appui démarre ' +
      'directement le pointage sur la cible mémorisée (aucune modale, aucune question)',
    async () => {
      const appelsDemarrer: EntreeDemarragePointage[] = [];
      const appelsArreter: string[] = [];

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([OR_ASSIGNE]))),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(construireOrDetail())),
        http.post('/api/v1/pointages/:id/arreter', ({ params }) => {
          appelsArreter.push(String(params.id));
          return HttpResponse.json({
            donnees: { ...POINTAGE_EN_COURS, statut: 'termine', finLe: new Date().toISOString() },
            avertissements: [],
          });
        }),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          const base = {
            ...POINTAGE_EN_COURS,
            id: entree.id,
            nature: entree.nature,
            ordreReparationId: 'ordreReparationId' in entree ? entree.ordreReparationId : null,
            ordreReparationNumero: 'ordreReparationId' in entree ? 'OR-000123' : null,
            ligneOrId: null,
            ligneOrDesignation: null,
            activiteIndirecte: 'activiteIndirecte' in entree ? entree.activiteIndirecte : null,
          };
          return HttpResponse.json({ donnees: base, avertissements: [] }, { status: 201 });
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      // Démarre un pointage productif normal (« Mes OR du jour ») — ceci mémorise `dernierCible`.
      await utilisateur.click(await screen.findByText('OR-000123'));
      await utilisateur.click(await screen.findByRole('button', { name: 'Pointer sur cet OR' }));
      await screen.findByRole('button', { name: 'Arrêter' });

      // Pendant un pointage PRODUCTIF, aucun bandeau (rien à reprendre).
      expect(
        screen.queryByRole('button', {
          name: 'Reprendre le pointage sur OR-000123 — OR entier',
        }),
      ).not.toBeInTheDocument();

      // « Changer » vers une activité indirecte AUTRE que la pause (« Nettoyage ») — la cible
      // productive mémorisée survit (voir `demarrerEtMemoriser`, une activité indirecte ne
      // remplace jamais `dernierCible`).
      await utilisateur.click(await screen.findByRole('button', { name: 'Changer' }));
      await utilisateur.click(await screen.findByRole('button', { name: 'Nettoyage' }));

      // Le bandeau apparaît désormais — étendue de la reprise à TOUTE activité indirecte.
      const boutonBandeau = await screen.findByRole('button', {
        name: 'Reprendre le pointage sur OR-000123 — OR entier',
      });
      expect(screen.getByText('Reprendre : OR-000123 — OR entier')).toBeInTheDocument();

      // Un SEUL appui démarre directement le pointage sur la cible mémorisée.
      await utilisateur.click(boutonBandeau);

      await waitFor(() => expect(appelsDemarrer).toHaveLength(3));
      expect(appelsDemarrer[2]).toMatchObject({
        nature: 'productif_or',
        ordreReparationId: 'or-1',
      });
      // « Changer » (étape précédente) n'appelle JAMAIS `arreter` explicitement (cascade serveur,
      // correctif #117) ; seule la reprise passe par le couple arrêter+démarrer (RM-116).
      expect(appelsArreter).toHaveLength(1);

      // Le bandeau disparaît une fois la reprise effectuée (retour à un pointage productif).
      await waitFor(() =>
        expect(
          screen.queryByRole('button', {
            name: 'Reprendre le pointage sur OR-000123 — OR entier',
          }),
        ).not.toBeInTheDocument(),
      );
      expect(await screen.findByRole('button', { name: 'Arrêter' })).toBeInTheDocument();
    },
  );

  it('affiche le chrono et le bouton Arrêter quand un pointage est en cours', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE_EN_COURS]))),
      http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
      // Défaut 2 : l'écran résout maintenant la cible EN COURS depuis le document OR
      // (`useOrdreReparation(pointageOuvert.data.ordreReparationId)`), pas seulement depuis la
      // mémoire locale — cet endpoint est donc appelé même sans avoir démarré le pointage
      // depuis cet écran.
      http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(construireOrDetail())),
    );

    rendre();

    expect(await screen.findByRole('button', { name: 'Arrêter' })).toBeInTheDocument();
    // Un pointage `productif_or` propose une pause, pas de reprise (aucune cible mémorisée après
    // un rendu à froid, voir le commentaire de tête d'`EcranPointageTechnicien.tsx`).
    expect(screen.getByRole('button', { name: 'Mettre en pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprendre' })).not.toBeInTheDocument();
  });

  it(
    'régression défaut 2 : après un rendu « à froid » (aucune mémoire locale, comme après un F5) ' +
      "pendant un pointage productif_or en cours, affiche le NUMÉRO D'OR réel dérivé de la " +
      'réponse API — jamais le texte générique « OR (sans ligne précise) »',
    async () => {
      const orAvecNumeroReel = construireOrDetail({ id: 'or-1', numero: 'OR-2026-12' });
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE_EN_COURS]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(orAvecNumeroReel)),
      );

      rendre();

      expect(await screen.findByText('OR-2026-12 — OR entier')).toBeInTheDocument();
      expect(screen.queryByText('OR (sans ligne précise)')).not.toBeInTheDocument();
    },
  );

  it(
    'régression défaut 2 : même repli, pour un pointage productif_ligne — affiche le numéro d’OR ' +
      "et la désignation de la ligne réelle, jamais « Ligne d'OR » générique",
    async () => {
      const ligneCiblee = construireLigne({ id: 'ligne-cible', designation: 'Vidange moteur' });
      const pointageSurLigne: ReponsePointage = {
        ...POINTAGE_EN_COURS,
        nature: 'productif_ligne',
        ligneOrId: 'ligne-cible',
      };
      const orAvecLigne = construireOrDetail({
        id: 'or-1',
        numero: 'OR-2026-13',
        lignes: [ligneCiblee],
      });
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([pointageSurLigne]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(orAvecLigne)),
      );

      rendre();

      expect(await screen.findByText('OR-2026-13 — Vidange moteur')).toBeInTheDocument();
      expect(screen.queryByText("Ligne d'OR")).not.toBeInTheDocument();
    },
  );

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

        // `genererUuid` (mocké en tête de fichier, contrôlable — voir sa déclaration) lève
        // UNE SEULE FOIS, pour CE clic précis : `construireEntreeDemarrage` lève avec lui. Avant
        // le correctif, cette erreur était HORS du `try` de `demarrerEtMemoriser` et disparaissait
        // sans jamais appeler `setErreurAction` — aucune requête réseau, aucun message, la boîte
        // de dialogue se refermait et plus rien ne se passait. Après le correctif, elle est
        // capturée et traduite comme n'importe quelle autre panne d'action.
        vi.mocked(genererUuid).mockImplementationOnce(() => {
          throw new TypeError('crypto.randomUUID is not a function');
        });
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
    'régression OR-2026-15, ADAPTÉE à l’arbitrage @laupernoe du 14.08.2026 (voir hooks/pointage/' +
      'lignes-assignees.ts) : la carte « Mes OR du jour » compte toujours SPÉCIFIQUEMENT les ' +
      'lignes assignées à ce technicien (repère organisationnel, inchangé) — mais le détail ' +
      '« Que pointez-vous ? » ne filtre PLUS par assignation : des lignes non assignées à ' +
      'personne (`technicienId: null`) restent pointables et doivent apparaître comme boutons, ' +
      'jamais comme « aucune ligne » (l’assignation n’est plus une condition pour pointer).',
    async () => {
      const ligneNonAssignee1 = construireLigne({
        id: 'ligne-1',
        technicienId: null,
        designation: 'Vidange moteur',
      });
      const ligneNonAssignee2 = construireLigne({
        id: 'ligne-2',
        technicienId: null,
        designation: 'Contrôle freins',
      });
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

      // La carte : repère organisationnel inchangé — aucune des deux lignes ne m'est assignée.
      expect(await screen.findByText('0 ligne qui vous est assignée')).toBeInTheDocument();
      expect(screen.queryByText(/lignes qui vous sont assignées/)).not.toBeInTheDocument();

      // Le détail : les deux lignes, NON assignées, restent proposées au pointage — jamais
      // masquées, jamais annoncées comme absentes.
      await utilisateur.click(screen.getByText('OR-000123'));
      expect(await screen.findByRole('button', { name: 'Vidange moteur' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Contrôle freins' })).toBeInTheDocument();
      expect(
        screen.queryByText(
          "Aucune ligne ne vous est assignée sur cet OR — vous pouvez pointer sur l'OR entier.",
        ),
      ).not.toBeInTheDocument();
    },
  );

  it(
    'arbitrage @laupernoe du 14.08.2026 : la carte continue de compter UNIQUEMENT les lignes assignées ' +
      'au technicien courant (repère organisationnel), mais le détail « Que pointez-vous ? » ' +
      'propose TOUTES les lignes pointables de l’OR, y compris celles assignées à un collègue — ' +
      'annoncées comme une information, jamais cachées ni bloquées',
    async () => {
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
      // 2 lignes m'appartiennent, 1 appartient à un collègue : le compteur DE LA CARTE doit
      // valoir 2, pas `nombreLignes` (3, le total de l'OR) — inchangé par l'arbitrage.
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
      // « Pneus » (assignée à un collègue) reste PROPOSÉE — l'apprenti qui prête main-forte au
      // compagnon peut la choisir sans détour par le bureau (arbitrage @laupernoe, NE PAS ROUVRIR).
      // Nom accessible complet (bouton + info d'assignation) : `getByText` cible juste le
      // libellé visible de la ligne, `closest('button')` retrouve le bouton qui la porte.
      const boutonPneus = screen.getByText('Pneus').closest('button');
      expect(boutonPneus).toBeInTheDocument();
      expect(boutonPneus).toBeEnabled();
      expect(
        within(boutonPneus as HTMLElement).getByText('Assignée à un autre technicien.'),
      ).toBeInTheDocument();
    },
  );
});
