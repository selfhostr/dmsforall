import { creerSessionTest } from '@/test/session';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  CibleReprisePointage,
  ClientResume,
  EntreeDemarragePointage,
  PageCurseur,
  ReponseIdentificationPin,
  ReponseOrdreReparation,
  ReponsePointage,
  SessionCourante,
  VehiculeResume,
} from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranBornePointage } from './EcranBornePointage';

/**
 * `SESSION_TEST` (`@/test/msw/handlers`) porte le rôle `chef_atelier` — inadapté ici : la borne
 * n'est atteignable qu'en session `poste_atelier` (compte de service, exactement UN site via
 * `sites[0]`, voir l'en-tête d'`EcranBornePointage.tsx`). Fixture dédiée, propre à ce fichier.
 */
const SESSION_BORNE: SessionCourante = creerSessionTest('poste_atelier', {
  utilisateur: {
    id: 'borne-atelier-1',
    email: 'borne-atelier-1@garage.ch',
    prenom: 'Borne',
    nom: 'Atelier',
    role: 'poste_atelier',
    langue: 'fr',
  },
  tenant: {
    id: 'tenant-1',
    slug: 'garage-test',
    raisonSociale: 'Garage Test SA',
    langueDefaut: 'fr',
    modeSignalement: 'via_site',
    assujettiTva: true,
  },
  sites: [
    { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
  ],
  siteRattachementId: 'site-1',
  sitePrincipalId: null,
  expireLe: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
});

const IDENTIFICATION_MARCO: ReponseIdentificationPin = {
  technicienId: 'technicien-marco',
  prenom: 'Marco',
  nom: 'Rossi',
  siteId: 'site-1',
};

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function pageOrdres(
  donnees: readonly ReponseOrdreReparation[],
): PageCurseur<ReponseOrdreReparation> {
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

/** Document complet minimal — même convention que `construireOrDetail` d'
 *  `EcranPointageTechnicien.spec.tsx` (endpoint `/ordres-reparation` réel : document complet, pas
 *  la projection `OrdreReparationResume`). */
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
    creeLe: '2026-08-03T06:00:00.000Z',
    modifieLe: '2026-08-03T06:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function construirePointageEnCours(overrides: Partial<ReponsePointage> = {}): ReponsePointage {
  return {
    id: 'pointage-1',
    siteId: 'site-1',
    technicienId: IDENTIFICATION_MARCO.technicienId,
    technicienNomAffiche: `${IDENTIFICATION_MARCO.prenom} ${IDENTIFICATION_MARCO.nom}`,
    statut: 'en_cours',
    nature: 'productif_or',
    ordreReparationId: 'or-1',
    ordreReparationNumero: 'OR-000123',
    ligneOrId: null,
    ligneOrDesignation: null,
    activiteIndirecte: null,
    source: 'badge',
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
    ...overrides,
  };
}

/** Handlers de base, communs à tous les scénarios : session borne + « rien en cours, aucun OR »
 *  pour le technicien identifié, une fois l'identification réussie. */
function poserHandlersSession() {
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_BORNE)),
    http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
    http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
  );
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage/borne']}>
        <Routes>
          <Route path="/pointage/borne" element={<EcranBornePointage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Tape un code à 4 chiffres via le pavé tactile — même parcours qu'un technicien ganté : uniquement
 *  des clics sur les boutons `Chiffre N`, jamais de saisie clavier ici (couverte séparément si besoin). */
async function taperCode(utilisateur: ReturnType<typeof userEvent.setup>, code: string) {
  for (const chiffre of code) {
    // eslint-disable-next-line no-await-in-loop -- saisie séquentielle, un chiffre à la fois, comme au doigt.
    await utilisateur.click(await screen.findByRole('button', { name: `Chiffre ${chiffre}` }));
  }
}

describe('EcranBornePointage', () => {
  // Repli par défaut, RÉINSTALLÉ AVANT CHAQUE TEST : « aucune cible de reprise connue du serveur »
  // — le cas normal pour la quasi-totalité des scénarios de ce fichier, sans rapport avec la
  // mémoire de reprise. Priorité MSW la plus basse : un `server.use()` posé dans le corps d'un test
  // gagne toujours sur celui-ci (voir `EcranPointageTechnicien.spec.tsx`, même patron).
  beforeEach(() => {
    server.use(
      http.get('/api/v1/pointages/dernier-du-jour', () => HttpResponse.json({ cible: null })),
    );
  });

  it('compte personnel (non-borne) : aucun champ PIN, renvoi vers « Mon travail » où l’on pointe sans code', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre();

    expect(await screen.findByRole('link', { name: 'Mon travail' })).toHaveAttribute(
      'href',
      '/pointage',
    );
    expect(screen.queryByRole('button', { name: 'Chiffre 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });

  it('affiche le pavé numérique neutre, sans aucun code en clair, tant que personne ne s’est identifié', async () => {
    poserHandlersSession();
    rendre();

    // La session résout de façon asynchrone (skeleton `EtatChargement` d'abord — qui porte lui
    // aussi un `<h1>` « Qui êtes-vous ? » VISIBLE, voir l'en-tête du composant — cohérent avec le
    // pavé neutre, l'en-tête ne saute jamais entre deux états) : on attend le pavé lui-même
    // (`findByRole`, qui réinterroge le DOM jusqu'à son apparition) plutôt que le titre, dont une
    // occurrence existe déjà pendant le chargement.
    expect(await screen.findByRole('button', { name: 'Chiffre 1' })).toBeInTheDocument();
    expect(screen.getByText('Qui êtes-vous ?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
    // Le bouton Valider reste désactivé tant que les 4 chiffres n'ont pas été saisis.
    expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled();
  });

  it('identifie le technicien après 4 chiffres et affiche son accueil nominatif', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () => HttpResponse.json(IDENTIFICATION_MARCO)),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '4071');

    expect(await screen.findByText('Bonjour Marco')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminé' })).toBeInTheDocument();
    // Panneau du technicien identifié : aucun pointage en cours, aucun OR assigné -> repli
    // EXPLICITE (#148), plus le texte muet d'avant ce correctif.
    expect(
      await screen.findByText("Aucun OR ne vous est assigné pour l'instant.", { exact: false }),
    ).toBeInTheDocument();
  });

  it(
    'correctif #148 : sur la borne aussi, un technicien identifié sans OR assigné peut démarrer ' +
      'un pointage via « Toutes les OR ouvertes » (repli automatique, dépliée sans action requise)',
    async () => {
      const orOuvertNonAssigne = construireOrDetail({ id: 'or-9', numero: 'OR-000999' });
      const appelsDemarrer: EntreeDemarragePointage[] = [];

      poserHandlersSession();
      server.use(
        http.post('/api/v1/pointages/identification', () =>
          HttpResponse.json(IDENTIFICATION_MARCO),
        ),
        // « Mes OR » (technicienId=) reste vide ; « Toutes les OR ouvertes » (sans technicienId)
        // propose l'OR non assigné — même discriminateur qu'`EcranPointageTechnicien.spec.tsx`.
        http.get('/api/v1/ordres-reparation', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.has('technicienId')) {
            return HttpResponse.json(pageOrdres([]));
          }
          return HttpResponse.json(pageOrdres([orOuvertNonAssigne]));
        }),
        http.get('/api/v1/ordres-reparation/or-9', () => HttpResponse.json(orOuvertNonAssigne)),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          return HttpResponse.json(
            {
              donnees: construirePointageEnCours({
                id: entree.id,
                ordreReparationId: orOuvertNonAssigne.id,
                ordreReparationNumero: orOuvertNonAssigne.numero,
              }),
              avertissements: [],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await taperCode(utilisateur, '4071');
      await screen.findByText("Aucun OR ne vous est assigné pour l'instant.");

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

  // Issue #152, volet CURE (borne) : deux techniciens qui cliquent au même instant sur une borne
  // PARTAGÉE est le cas NORMAL, pas un cas rare. Avant ce correctif, `demarrerEtSuivre` relançait
  // l'erreur APRÈS l'avoir déjà affichée via `setErreurAction`, alors que ses appelants
  // (`handleChoisirLigne`/`handleChoisirOrEntier`/`handleDemarrerActiviteIndirecte`) l'invoquent en
  // `void demarrerEtSuivre(...)` — la promesse rejetée n'était jamais observée -> rejet de promesse
  // non rattrapé, constaté en test navigateur réel comme un écran de sélection cassé.
  it(
    'issue #152 : un refus serveur (409) au démarrage sur la borne ne casse jamais l’écran — ' +
      'aucun rejet de promesse non rattrapé, le message d’erreur s’affiche',
    async () => {
      const orOuvertNonAssigne = construireOrDetail({ id: 'or-9', numero: 'OR-000999' });

      poserHandlersSession();
      server.use(
        http.post('/api/v1/pointages/identification', () =>
          HttpResponse.json(IDENTIFICATION_MARCO),
        ),
        http.get('/api/v1/ordres-reparation', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.has('technicienId')) {
            return HttpResponse.json(pageOrdres([]));
          }
          return HttpResponse.json(pageOrdres([orOuvertNonAssigne]));
        }),
        http.get('/api/v1/ordres-reparation/or-9', () => HttpResponse.json(orOuvertNonAssigne)),
        http.post('/api/v1/pointages', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/POINTAGE_OR_NON_MODIFIABLE',
              title: 'OR non modifiable',
              status: 409,
              code: 'POINTAGE_OR_NON_MODIFIABLE',
              instance: 'req-1',
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );

      // Voir `EcranPointageTechnicien.spec.tsx` pour la même vérification, même justification :
      // le code React tourne directement dans le processus de test, `process.on
      // ('unhandledRejection')` est ce qui observerait un rejet non rattrapé — jamais
      // `window.onunhandledrejection`, propre aux scripts exécutés PAR jsdom.
      const rejetsNonRattrapes: unknown[] = [];
      const surRejetNonRattrape = (raison: unknown) => {
        rejetsNonRattrapes.push(raison);
      };
      process.on('unhandledRejection', surRejetNonRattrape);

      try {
        const utilisateur = userEvent.setup();
        rendre();

        await taperCode(utilisateur, '4071');
        expect(await screen.findByText('OR-000999')).toBeInTheDocument();
        await utilisateur.click(screen.getByText('OR-000999'));
        await utilisateur.click(await screen.findByRole('button', { name: 'Pointer sur cet OR' }));

        // L'écran redevient utilisable : toujours le pavé/panneau normal, jamais vide ni figé.
        expect(await screen.findByText('Bonjour Marco')).toBeInTheDocument();

        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.off('unhandledRejection', surRejetNonRattrape);
      }

      expect(rejetsNonRattrapes).toEqual([]);
    },
  );

  it(
    'correctif #117 : « Changer » de cible pendant un pointage en cours (borne) envoie UN SEUL ' +
      'appel `POST /pointages`, aucun `arreter` explicite, et affiche l’avertissement renvoyé',
    async () => {
      const pointageEnCours = construirePointageEnCours();
      const orCible = construireOrDetail({ id: 'or-2', numero: 'OR-000456' });
      const appelsDemarrer: EntreeDemarragePointage[] = [];
      const appelsArreter: string[] = [];

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_BORNE)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([pointageEnCours]))),
        http.post('/api/v1/pointages/identification', () =>
          HttpResponse.json(IDENTIFICATION_MARCO),
        ),
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
            donnees: { ...pointageEnCours, statut: 'termine' },
            avertissements: [],
          });
        }),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          return HttpResponse.json(
            {
              donnees: construirePointageEnCours({
                id: entree.id,
                ordreReparationId: orCible.id,
                ordreReparationNumero: orCible.numero,
              }),
              avertissements: [
                {
                  code: 'POINTAGE_CLOTURE_AUTOMATIQUE',
                  message: 'Le pointage précédent de ce technicien a été clôturé automatiquement.',
                  donnees: { pointageId: pointageEnCours.id },
                },
              ],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await taperCode(utilisateur, '4071');
      await utilisateur.click(await screen.findByRole('button', { name: 'Changer' }));
      await utilisateur.click(await screen.findByText('OR-000456'));
      await utilisateur.click(await screen.findByRole('button', { name: 'Pointer sur cet OR' }));

      await waitFor(() => expect(appelsDemarrer).toHaveLength(1));
      expect(appelsArreter).toHaveLength(0);
      expect(
        await screen.findByText('Votre pointage précédent a été clôturé automatiquement.'),
      ).toBeInTheDocument();
    },
  );

  it(
    'non-régression (borne) : « Mettre en pause » continue d’enchaîner arrêter PUIS démarrer ' +
      '(deux appels distincts), à la différence de « Changer »',
    async () => {
      const pointageEnCours = construirePointageEnCours();
      const appelsDemarrer: EntreeDemarragePointage[] = [];
      const appelsArreter: string[] = [];

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_BORNE)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([pointageEnCours]))),
        http.post('/api/v1/pointages/identification', () =>
          HttpResponse.json(IDENTIFICATION_MARCO),
        ),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
        http.get('/api/v1/ordres-reparation/or-1', () => HttpResponse.json(construireOrDetail())),
        http.post('/api/v1/pointages/:id/arreter', ({ params }) => {
          appelsArreter.push(String(params.id));
          return HttpResponse.json({
            donnees: { ...pointageEnCours, statut: 'termine', finLe: new Date().toISOString() },
            avertissements: [],
          });
        }),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          return HttpResponse.json(
            {
              donnees: construirePointageEnCours({
                id: entree.id,
                nature: 'indirect',
                activiteIndirecte: 'pause',
                ordreReparationId: null,
                ordreReparationNumero: null,
              }),
              avertissements: [],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await taperCode(utilisateur, '4071');
      await utilisateur.click(await screen.findByRole('button', { name: 'Mettre en pause' }));

      await waitFor(() => expect(appelsArreter).toHaveLength(1));
      await waitFor(() => expect(appelsDemarrer).toHaveLength(1));
      expect(appelsDemarrer[0]).toMatchObject({ nature: 'indirect', activiteIndirecte: 'pause' });
    },
  );

  it('refuse un PIN inconnu sans ouvrir de session ni afficher le code, et laisse le pavé actif', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/POINTAGE_PIN_INVALIDE',
            title: 'Code PIN non reconnu',
            status: 401,
            code: 'POINTAGE_PIN_INVALIDE',
            instance: 'req-1',
          },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '9999');

    expect(
      await screen.findByText('Code PIN non reconnu. Vérifiez le code et réessayez.'),
    ).toBeInTheDocument();
    // Jamais d'accueil nominatif après un refus : l'écran reste sur le pavé de saisie.
    expect(screen.queryByText(/^Bonjour /)).not.toBeInTheDocument();
    // Le pavé reste utilisable — un PIN refusé n'est pas un verrouillage (RM-129 : seul le
    // 423 verrouille, jamais la tentative fautive elle-même).
    expect(screen.getByRole('button', { name: 'Chiffre 1' })).toBeEnabled();
  });

  it('traite explicitement le 423 (verrouillage anti-balayage) : message clair et pavé désactivé', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/POINTAGE_PIN_VERROUILLE',
            title: 'Sélecteur de code PIN temporairement verrouillé',
            status: 423,
            code: 'POINTAGE_PIN_VERROUILLE',
            instance: 'req-1',
          },
          {
            status: 423,
            headers: { 'content-type': 'application/problem+json', 'Retry-After': '30' },
          },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '0000');

    expect(
      await screen.findByText(
        "Code PIN bloqué après trop d'essais. Demandez à un responsable de le débloquer.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nouvel essai possible dans 30 s.', { exact: false }),
    ).toBeInTheDocument();
    // Verrouillage RÉEL : contrairement au PIN simplement refusé, le pavé est désactivé — un
    // balayage ne peut pas continuer à essayer pendant le palier annoncé par `Retry-After`.
    expect(screen.getByRole('button', { name: 'Chiffre 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeDisabled();
  });

  it('« Terminé » referme le panneau du technicien et revient au pavé neutre — borne PARTAGÉE', async () => {
    poserHandlersSession();
    server.use(
      http.post('/api/v1/pointages/identification', () => HttpResponse.json(IDENTIFICATION_MARCO)),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await taperCode(utilisateur, '4071');
    expect(await screen.findByText('Bonjour Marco')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Terminé' }));

    expect(await screen.findByText('Qui êtes-vous ?')).toBeInTheDocument();
    expect(screen.queryByText('Bonjour Marco')).not.toBeInTheDocument();
  });

  it(
    'décision @laupernoe du 14.08.2026 : le site de la borne vient du `siteId` rendu par l’identification ' +
      'PIN, jamais de la session ni d’un sélecteur — aucun sélecteur de site n’est rendu',
    async () => {
      // Site DÉLIBÉRÉMENT différent de `SESSION_BORNE.sites[0].id` ('site-1') : si le code lisait
      // encore le site depuis la session plutôt que depuis l'identification, ce test échouerait sur
      // l'assertion `siteId` ci-dessous — preuve directe, pas une simple absence de régression.
      const identificationAutreSite = { ...IDENTIFICATION_MARCO, siteId: 'site-9' };
      const appelsDemarrer: EntreeDemarragePointage[] = [];

      poserHandlersSession();
      server.use(
        http.post('/api/v1/pointages/identification', () =>
          HttpResponse.json(identificationAutreSite),
        ),
        http.post('/api/v1/pointages', async ({ request }) => {
          const entree = (await request.json()) as EntreeDemarragePointage;
          appelsDemarrer.push(entree);
          return HttpResponse.json(
            {
              donnees: construirePointageEnCours({
                id: entree.id,
                siteId: 'site-9',
                nature: 'indirect',
                activiteIndirecte: 'nettoyage',
                ordreReparationId: null,
                ordreReparationNumero: null,
              }),
              avertissements: [],
            },
            { status: 201 },
          );
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await taperCode(utilisateur, '4071');
      await screen.findByText('Bonjour Marco');

      // Aucun sélecteur de site nulle part sur le panneau identifié.
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

      // Démarre une activité indirecte : le `siteId` envoyé au serveur doit être celui de
      // L'IDENTIFICATION ('site-9'), jamais celui de la session de la borne ('site-1').
      await utilisateur.click(await screen.findByRole('button', { name: 'Nettoyage' }));

      await waitFor(() => expect(appelsDemarrer).toHaveLength(1));
      expect(appelsDemarrer[0]).toMatchObject({ siteId: 'site-9' });
    },
  );

  it(
    'point 5 (bandeau de reprise), même correctif que `EcranPointageTechnicien` : apparaît sur la ' +
      'BORNE aussi pendant une activité indirecte AUTRE que la pause (« Nettoyage »), avec ' +
      '`pourAutrui: true` (P-34) — pas seulement sur l’écran personnel',
    async () => {
      const pointageIndirect = construirePointageEnCours({
        nature: 'indirect',
        activiteIndirecte: 'nettoyage',
        ordreReparationId: null,
        ordreReparationNumero: null,
      });
      const cibleServeur: CibleReprisePointage = {
        type: 'or',
        ordreReparationId: 'or-1',
        numeroOr: 'OR-000123',
        ligneOrId: null,
        libelle: 'OR-000123 — OR entier',
        siteId: 'site-1',
        interrompuLe: pointageIndirect.debutLe,
        cumulSecondesDuJour: 120,
      };

      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_BORNE)),
        http.post('/api/v1/pointages/identification', () =>
          HttpResponse.json(IDENTIFICATION_MARCO),
        ),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([pointageIndirect]))),
        http.get('/api/v1/ordres-reparation', () => HttpResponse.json(pageOrdres([]))),
        http.get('/api/v1/pointages/dernier-du-jour', () =>
          HttpResponse.json({ cible: cibleServeur }),
        ),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await taperCode(utilisateur, '4071');

      expect(
        await screen.findByRole('button', {
          name: 'Reprendre le pointage sur OR-000123 — OR entier',
        }),
      ).toBeInTheDocument();
    },
  );

  // Issue #159 : la borne restait bloquée, PIN oublié, sur une carte d'erreur statique quand la
  // session devenait absente PENDANT que l'écran était déjà monté (déconnexion, TTL expiré) — sans
  // bouton ni redirection. `RouteProtegee` (hors de ce fichier, testé séparément) couvre déjà le cas
  // « navigation directe vers /pointage/borne sans session » ; celui-ci couvre le second, propre à
  // CET écran : sa PROPRE requête `useSession()` (nécessaire à son spinner anti-flash) peut se
  // résoudre à `null` avant que `RouteProtegee` n'ait démonté l'arbre. Reproduit ici SANS
  // `RouteProtegee` (comme tous les autres tests de ce fichier), avec un `/login` voisin pour
  // constater la redirection réelle plutôt que sa seule intention.
  it(
    'la session devient absente (null) pendant que l’écran est monté : redirige vers /login, ' +
      'jamais un message figé sans action',
    async () => {
      let connecte = true;
      server.use(
        http.get('/api/v1/auth/moi', () =>
          connecte
            ? HttpResponse.json(SESSION_BORNE)
            : HttpResponse.json(
                {
                  type: 'https://docs.dmsforall.example/erreurs/AUTH_SESSION_ABSENTE',
                  title: 'Session absente',
                  status: 401,
                  code: 'AUTH_SESSION_ABSENTE',
                  instance: 'req-1',
                },
                { status: 401, headers: { 'content-type': 'application/problem+json' } },
              ),
        ),
      );

      const queryClient = creerQueryClientTest();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/pointage/borne']}>
            <Routes>
              <Route path="/pointage/borne" element={<EcranBornePointage />} />
              <Route path="/login" element={<div>Ecran de connexion</div>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );

      // Pavé neutre affiché normalement, session valide au premier chargement.
      await screen.findByText('Saisissez le code PIN');

      // La session expire côté serveur — le prochain refetch (focus, action, invalidation) le
      // découvre, comme un vrai retour de fenêtre ou une action déclencherait un refetch réel.
      connecte = false;
      await waitFor(() => expect(queryClient.getQueryState(['auth', 'me'])).toBeDefined());
      await queryClient.refetchQueries({ queryKey: ['auth', 'me'] });

      expect(await screen.findByText('Ecran de connexion')).toBeInTheDocument();
      expect(screen.queryByText('Saisissez le code PIN')).not.toBeInTheDocument();
      // Jamais l'ancienne carte d'erreur statique, sans bouton ni redirection.
      expect(screen.queryByText(/session/i)).not.toBeInTheDocument();
    },
  );
});
