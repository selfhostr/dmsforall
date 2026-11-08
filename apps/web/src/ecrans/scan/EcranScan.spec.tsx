import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvenementTempsReel } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest, renduAvecRoutes } from '@/test/utils';

import type { DonneesPermisScanne, ReponseScanPermisCirculation } from './contrat-ocr.temporaire';
import { EcranScan } from './EcranScan';

/**
 * Faux `EventSource` — MÊME patron que `hooks/temps-reel/useEvenementsTempsReel.spec.tsx` (jsdom
 * n'implémente pas cette API). Dupliqué ici plutôt qu'importé : `hooks/temps-reel/` est hors du
 * périmètre d'écriture de ce lot, et ce fichier de test n'a pas vocation à devenir un point de
 * couplage entre les deux périmètres.
 */
class FauxEventSource {
  static instances: FauxEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  fermee = false;

  constructor() {
    FauxEventSource.instances.push(this);
  }

  close(): void {
    this.fermee = true;
  }
}

/**
 * Suite d'intégration de l'écran de scan — machine à états (capture -> controleQualite ->
 * [refus ->] preparation -> analyse -> formulaire | résultat | erreur), voir la doc de tête
 * d'`EcranScan.tsx`. Quatre soucis techniques de test à connaître avant de lire les stubs
 * ci-dessous :
 *
 *  1. jsdom (`environnementJsdomFetch.ts`) ne décode pas réellement une image ni n'implémente
 *     `HTMLCanvasElement.getContext` — la réduction d'image (`reduireImage.ts`) ET le contrôle
 *     qualité (`analyserQualitePhoto.ts`) sont donc simulés ici comme dans `reduireImage.spec.ts`
 *     / `analyserQualitePhoto.spec.ts` (même patron de stub `Image`/`canvas`, `getImageData`
 *     compris — c'est SA donnée renvoyée qui pilote le verdict qualité dans ces tests, pas un vrai
 *     rendu canevas).
 *  2. `<input type="file">` ne peut pas recevoir de fichier par un vrai clic utilisateur sous
 *     jsdom : on cible directement l'`<input>` caché (`sr-only`) via son `aria-label` et on
 *     déclenche `userEvent.upload`, qui simule fidèlement l'événement `change` du navigateur.
 *  3. `rendre()` (plus bas) pré-remplit le cache de `useSession()` avec `SESSION_TEST`
 *     (`role: 'chef_atelier'`, dans `ROLES_SCAN`) AVANT le premier rendu — nécessaire depuis que
 *     l'écran distingue explicitement session en cours/absente/en erreur (voir la doc de tête
 *     d'`EcranScan.tsx`, § SESSION) : sans ce pré-remplissage, chaque test devrait attendre la
 *     résolution asynchrone de la session avant de voir l'étape de capture. `useModeScanMobile`
 *     reste malgré tout inactif dans cette suite : `window.matchMedia` n'est pas polyfillé sous
 *     jsdom ici (voir sa propre doc de tête, repli sur `false`), ce qui suffit à neutraliser la
 *     restriction indépendamment du rôle — cohérent avec ces tests, qui portent sur le PARCOURS de
 *     scan lui-même, pas sur la restriction mobile (couverte à part par
 *     `composants/layout/useModeScanMobile.spec.ts`). La gestion de session elle-même a sa PROPRE
 *     suite dédiée, tout en bas de ce fichier (`describe('session', ...)`).
 *  4. Les dimensions par défaut de la photo factice (3000x2000) sont volontairement AU-DESSUS du
 *     seuil de résolution (`RESOLUTION_MIN_PX` dans `analyserQualitePhoto.ts`) : les tests qui ne
 *     portent pas sur le contrôle qualité lui-même passent le contrôle sans y penser (`qualite`
 *     par défaut `'ok'`, damier net et contrasté — voir `donneesPixelsPour`).
 */

type ComportementQualite = 'ok' | 'documentTropPetit' | 'photoFloue' | 'resolutionInsuffisante';

// Dimensions de l'échantillon d'analyse — MÊME valeur que la constante privée
// `LARGEUR_ECHANTILLON`/hauteur dérivée de `RATIO_CADRE` dans `analyserQualitePhoto.ts` (non
// exportées, détail d'implémentation) : `getImageData` doit renvoyer un tableau de CETTE taille
// pour que `nuancesDeGris`/`varianceLaplacien` (appelés avec les dimensions RÉELLES calculées côté
// production) retombent juste. Voir `analyserQualitePhoto.spec.ts` pour le même patron.
const LARGEUR_ECHANTILLON_TEST = 240;
const HAUTEUR_ECHANTILLON_TEST = Math.round(240 / 1.42);

function donneesPixelsPour(qualite: ComportementQualite): { data: Uint8ClampedArray } {
  const total = LARGEUR_ECHANTILLON_TEST * HAUTEUR_ECHANTILLON_TEST;
  const data = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i += 1) {
    const x = i % LARGEUR_ECHANTILLON_TEST;
    const y = Math.floor(i / LARGEUR_ECHANTILLON_TEST);
    const valeur =
      qualite === 'documentTropPetit'
        ? 180 // zone quasi uniforme — aucun contenu détecté
        : qualite === 'photoFloue'
          ? Math.round((x / (LARGEUR_ECHANTILLON_TEST - 1)) * 255) // rampe : contrastée mais floue
          : (x + y) % 2 === 0
            ? 20
            : 235; // damier : contrasté ET net
    const base = i * 4;
    data[base] = valeur;
    data[base + 1] = valeur;
    data[base + 2] = valeur;
    data[base + 3] = 255;
  }
  return { data };
}

function installerImageEtCanvasFactices(
  comportement: 'succes' | 'echec',
  qualite: ComportementQualite = 'ok',
): void {
  const dimensions =
    qualite === 'resolutionInsuffisante'
      ? { largeur: 800, hauteur: 600 }
      : { largeur: 3000, hauteur: 2000 };
  class ImageFactice {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_valeur: string) {
      queueMicrotask(() => {
        if (comportement === 'succes') {
          this.naturalWidth = dimensions.largeur;
          this.naturalHeight = dimensions.hauteur;
          this.onload?.();
        } else {
          this.onerror?.();
        }
      });
    }
  }
  vi.stubGlobal('Image', ImageFactice as unknown as typeof Image);
  if (comportement === 'succes') {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => donneesPixelsPour(qualite)),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(['jpeg-factice'], { type: 'image/jpeg' }));
    });
  }
}

const CHAMP_ABSENT = { valeur: null, confiance: 'absente' as const };

const DONNEES_FACTICES: DonneesPermisScanne = {
  vehicule: {
    marque: { valeur: 'Volkswagen', confiance: 'sure' },
    modele: { valeur: 'Golf', confiance: 'sure' },
    vin: { valeur: 'WVWZZZ1KZAW123456', confiance: 'douteuse' },
    plaque: { valeur: '123456', confiance: 'douteuse' },
    canton: { valeur: 'VD', confiance: 'sure' },
    premiereMiseEnCirculationLe: CHAMP_ABSENT,
  },
  detenteur: {
    estEntreprise: { valeur: false, confiance: 'sure' },
    nom: { valeur: 'Rossier', confiance: 'sure' },
    prenom: { valeur: 'Jean', confiance: 'douteuse' },
    raisonSociale: CHAMP_ABSENT,
    rue: { valeur: 'Rue du Lac 1', confiance: 'sure' },
    npa: { valeur: '1000', confiance: 'sure' },
    localite: { valeur: 'Lausanne', confiance: 'sure' },
  },
};

function reponseScan(correspondances: ReponseScanPermisCirculation['correspondances'] = {}) {
  return { donnees: DONNEES_FACTICES, correspondances } satisfies ReponseScanPermisCirculation;
}

function rendre() {
  // Session déjà résolue AVANT le premier rendu (voir le point 3 ci-dessus) — sinon toute cette
  // suite devrait attendre `screen.findBy...` au lieu de `screen.getBy...` pour la toute première
  // assertion de chaque test, ce qui n'a rien à voir avec ce qu'elle vérifie (le parcours de scan).
  const queryClient = creerQueryClientTest();
  queryClient.setQueryData(clesQuery.session(), SESSION_TEST);
  return renduAvecRoutes([{ path: '/scan', element: <EcranScan /> }], {
    routeInitiale: '/scan',
    queryClient,
  });
}

async function photographier(
  utilisateur: ReturnType<typeof userEvent.setup>,
  nomFichier = 'permis.jpg',
) {
  const entree = screen.getByLabelText('Prendre la photo', { selector: 'input' });
  const fausseImage = new File(['contenu-factice'], nomFichier, { type: 'image/jpeg' });
  await utilisateur.upload(entree, fausseImage);
}

/**
 * Aperçu des panneaux refus/cadrage : `ApercuPhotoFichier` décode via `createImageBitmap` (absent de
 * jsdom). Renvoie le `close` espionné du bitmap factice, pour vérifier la libération au démontage.
 */
function installerBitmapFactice(): ReturnType<typeof vi.fn> {
  const fermer = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 100, height: 100, close: fermer })),
  );
  return fermer;
}

describe('EcranScan', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:objet-1'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    FauxEventSource.instances = [];
    vi.stubGlobal('EventSource', FauxEventSource);
    installerBitmapFactice();
    // Filet de sécurité au cas où quelque chose déclencherait un refetch de la session (le cache
    // pré-rempli par `rendre()` suffit normalement) : jamais un 401 par défaut ici, contrairement
    // au reste du dépôt — cette suite porte sur le parcours de scan, pas sur la session.
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('affiche l’objectif de la capture au premier rendu, sans appel réseau', () => {
    rendre();
    expect(screen.getByText('Photographiez le permis de circulation')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Le véhicule et le client seront pré-remplis automatiquement — il ne restera qu'à vérifier.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prendre la photo' })).toBeInTheDocument();
  });

  it('la capture native cible l’appareil photo (pas de flux vidéo maison) et accepte une image', () => {
    rendre();
    const entree = screen.getByLabelText('Prendre la photo', { selector: 'input' });
    expect(entree).toHaveAttribute('type', 'file');
    expect(entree).toHaveAttribute('accept', 'image/*');
    expect(entree).toHaveAttribute('capture', 'environment');
  });

  it('une photo au format HEIC illisible sur cet appareil affiche le message HEIC dédié, pas le message générique', async () => {
    installerImageEtCanvasFactices('echec');
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur, 'IMG_0001.HEIC');

    expect(
      await screen.findByText(/n'est pas pris en charge sur cet appareil/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprendre une photo' })).toBeInTheDocument();
  });

  it('une photo illisible pour une autre raison affiche le message générique, jamais le message HEIC', async () => {
    installerImageEtCanvasFactices('echec');
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur, 'photo.jpg');

    expect(
      await screen.findByText(
        /Cette photo n'a pas pu être ouverte\. Reprenez-la avec l'appareil photo/,
      ),
    ).toBeInTheDocument();
  });

  it('« Reprendre une photo » après une erreur ramène à l’étape de capture (aucun piège)', async () => {
    installerImageEtCanvasFactices('echec');
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByRole('button', { name: 'Reprendre une photo' });

    await utilisateur.click(screen.getByRole('button', { name: 'Reprendre une photo' }));

    expect(screen.getByRole('button', { name: 'Prendre la photo' })).toBeInTheDocument();
  });

  it('rien n’existe (aucune correspondance) : le formulaire propose de créer le client ET le véhicule', async () => {
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () => HttpResponse.json(reponseScan())),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur);

    expect(
      await screen.findByRole('button', { name: 'Valider et enregistrer' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nom')).toHaveValue('Rossier');
    expect(screen.getByLabelText('Marque')).toHaveValue('Volkswagen');
  });

  it('une photo sans document détectable dans le cadre est REFUSÉE avant tout appel réseau, avec le motif en français simple', async () => {
    installerImageEtCanvasFactices('succes', 'documentTropPetit');
    let appelOcrRecu = false;
    server.use(
      http.post('/api/v1/scan/permis-circulation', () => {
        appelOcrRecu = true;
        return HttpResponse.json(reponseScan());
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur);

    expect(await screen.findByText('Cette photo ne convient pas')).toBeInTheDocument();
    expect(
      screen.getByText('Le permis est trop petit dans le cadre. Rapprochez-vous.'),
    ).toBeInTheDocument();
    // Refus AVANT envoi — aucune requête OCR n'a été déclenchée pour une photo refusée.
    expect(appelOcrRecu).toBe(false);
  });

  it('« Reprendre une photo » depuis un refus ramène à l’étape de capture et libère l’aperçu (aucun piège)', async () => {
    const fermer = installerBitmapFactice();
    installerImageEtCanvasFactices('succes', 'photoFloue');
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByText('La photo est floue. Reprenez-la bien stable.');

    await utilisateur.click(screen.getByRole('button', { name: 'Reprendre une photo' }));

    expect(screen.getByRole('button', { name: 'Prendre la photo' })).toBeInTheDocument();
    expect(fermer).toHaveBeenCalled();
  });

  it('« Envoyer quand même » depuis un refus poursuit normalement jusqu’au formulaire (le contournement n’est jamais un blocage)', async () => {
    installerImageEtCanvasFactices('succes', 'resolutionInsuffisante');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () => HttpResponse.json(reponseScan())),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByText('Cette photo ne convient pas');
    expect(
      screen.getByText(
        'Sans reprendre la photo, la lecture automatique sera probablement incomplète.',
      ),
    ).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Envoyer quand même' }));

    expect(
      await screen.findByRole('button', { name: 'Valider et enregistrer' }),
    ).toBeInTheDocument();
  });

  it('le client existe déjà, pas le véhicule : le bloc détenteur n’est plus un formulaire, seul le véhicule reste à vérifier', async () => {
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () =>
        HttpResponse.json(reponseScan({ client: { id: 'client-1', nomAffiche: 'Rossier Jean' } })),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur);

    expect(await screen.findByText('Rossier Jean')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Marque')).toBeInTheDocument();
  });

  it('les deux existent déjà : rien n’est envoyé au serveur, l’écran le dit clairement avec les deux fiches', async () => {
    installerImageEtCanvasFactices('succes');
    let appelCreationRecu = false;
    server.use(
      http.post('/api/v1/scan/permis-circulation', () =>
        HttpResponse.json(
          reponseScan({
            client: { id: 'client-1', nomAffiche: 'Rossier Jean' },
            vehicule: { id: 'veh-1', libelle: 'Volkswagen Golf' },
          }),
        ),
      ),
      http.post('/api/v1/clients', () => {
        appelCreationRecu = true;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.post('/api/v1/vehicules', () => {
        appelCreationRecu = true;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur);

    expect(await screen.findByText('Rien à créer')).toBeInTheDocument();
    expect(screen.getByText('Rossier Jean')).toBeInTheDocument();
    expect(screen.getByText('Volkswagen Golf')).toBeInTheDocument();
    // Jamais de faux succès : aucune création n'a été tentée pour une issue « rien à créer ».
    expect(appelCreationRecu).toBe(false);
  });

  it('poste fixe averti : en attente puis confirmé dès que l’événement matching arrive sur le canal', async () => {
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () =>
        HttpResponse.json(
          reponseScan({
            client: { id: 'client-1', nomAffiche: 'Rossier Jean' },
            vehicule: { id: 'veh-1', libelle: 'Volkswagen Golf' },
          }),
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByText('Rien à créer');

    expect(screen.getByText('Information du poste fixe en cours…')).toBeInTheDocument();
    const source = FauxEventSource.instances[0]!;

    // Un événement pour un AUTRE client (canal partagé par tout le tenant) ne confirme rien ici.
    const evenementAutreClient: EvenementTempsReel = {
      type: 'vehicule.correspondance_scan_permis',
      emisLe: '2026-08-17T09:00:00.000Z',
      donnees: { clientId: 'client-autre' },
    };
    act(() => source.onmessage?.({ data: JSON.stringify(evenementAutreClient) }));
    expect(screen.getByText('Information du poste fixe en cours…')).toBeInTheDocument();

    const evenementCeClient: EvenementTempsReel = {
      type: 'vehicule.correspondance_scan_permis',
      emisLe: '2026-08-17T09:00:01.000Z',
      donnees: { clientId: 'client-1' },
    };
    act(() => source.onmessage?.({ data: JSON.stringify(evenementCeClient) }));

    expect(screen.getByText('Le poste fixe a été informé.')).toBeInTheDocument();
  });

  it('poste fixe averti : l’ordre n’importe pas — un événement reçu AVANT que le panneau ne s’affiche produit quand même « confirmé »', async () => {
    // C'était le cas qui échouait avant le déplacement de l'abonnement : l'événement arrivait
    // pendant le round-trip OCR, avant que `PanneauRienACreer` (qui écoutait alors lui-même) ne
    // soit monté. L'abonnement vit maintenant dans `EcranScan`, ouvert dès son montage — avant
    // même la photo — donc plus jamais devancé par l'événement.
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () =>
        HttpResponse.json(
          reponseScan({
            client: { id: 'client-1', nomAffiche: 'Rossier Jean' },
            vehicule: { id: 'veh-1', libelle: 'Volkswagen Golf' },
          }),
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    // L'abonnement existe déjà à ce stade (étape « capture », aucune photo prise) — l'événement
    // arrive avant même que l'utilisateur ne déclenche le scan.
    expect(FauxEventSource.instances).toHaveLength(1);
    const source = FauxEventSource.instances[0]!;
    const evenementPrecoce: EvenementTempsReel = {
      type: 'vehicule.correspondance_scan_permis',
      emisLe: '2026-08-17T08:59:00.000Z',
      donnees: { clientId: 'client-1' },
    };
    act(() => source.onmessage?.({ data: JSON.stringify(evenementPrecoce) }));

    await photographier(utilisateur);
    await screen.findByText('Rien à créer');

    // Confirmé DÈS L'AFFICHAGE du panneau, sans qu'aucun nouvel événement n'arrive après coup.
    expect(screen.getByText('Le poste fixe a été informé.')).toBeInTheDocument();
    expect(screen.queryByText('Information du poste fixe en cours…')).not.toBeInTheDocument();
    // Toujours la MÊME connexion — l'événement précoce n'a provoqué ni reconnexion ni nouvelle
    // instance.
    expect(FauxEventSource.instances).toHaveLength(1);
  });

  it('le canal se ferme proprement au démontage de l’écran, et un aller-retour rapide n’ouvre jamais deux flux à la fois', () => {
    const { unmount } = rendre();

    expect(FauxEventSource.instances).toHaveLength(1);
    const premiere = FauxEventSource.instances[0]!;
    expect(premiere.fermee).toBe(false);

    unmount();
    expect(premiere.fermee).toBe(true);

    // Remontage (retour rapide sur l'écran) : une SECONDE instance est ouverte, mais seulement
    // après la fermeture de la première — jamais deux flux simultanément ouverts.
    const second = rendre();
    expect(FauxEventSource.instances).toHaveLength(2);
    const deuxieme = FauxEventSource.instances[1]!;
    expect(deuxieme.fermee).toBe(false);
    expect(premiere.fermee).toBe(true);

    second.unmount();
    expect(deuxieme.fermee).toBe(true);
  });

  it('poste fixe averti : un canal indisponible affiche une dégradation honnête SANS bloquer le panneau', async () => {
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () =>
        HttpResponse.json(
          reponseScan({
            client: { id: 'client-1', nomAffiche: 'Rossier Jean' },
            vehicule: { id: 'veh-1', libelle: 'Volkswagen Golf' },
          }),
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByText('Rien à créer');

    const source = FauxEventSource.instances[0]!;
    act(() => source.onerror?.());

    expect(screen.getByText(/Confirmation indisponible pour le moment/)).toBeInTheDocument();
    // Le panneau reste pleinement utilisable : les liens de fiche et l'action de sortie
    // fonctionnent toujours, rien n'est bloqué par l'indisponibilité du canal.
    expect(screen.getByRole('link', { name: 'Rossier Jean' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scanner un autre permis' })).toBeEnabled();
  });

  it('annuler pendant l’analyse OCR revient à l’étape de capture sans afficher de résultat', async () => {
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post(
        '/api/v1/scan/permis-circulation',
        async () => new Promise(() => undefined), // ne répond jamais dans ce test
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);

    const boutonAnnuler = await screen.findByRole('button', { name: 'Annuler' });
    await utilisateur.click(boutonAnnuler);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Prendre la photo' })).toBeInTheDocument(),
    );
  });

  // La session peut s'éteindre ENTRE la prise de la photo et le retour du serveur : un cas
  // DISTINCT de la suite `describe('session', ...)` tout en bas (qui porte sur la requête
  // `useSession()` de cet écran) — ici, c'est l'appel réseau du scan lui-même qui échoue en 401
  // `AUTH_SESSION_EXPIREE`. Voir la doc de tête d'`EcranScan.tsx`, § SESSION PERDUE PENDANT
  // L'APPEL OCR.
  it('la session expire pendant l’envoi de la photo au serveur : propose de se reconnecter, jamais de reprendre une photo qui échouerait à l’identique', async () => {
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/AUTH_SESSION_EXPIREE',
            title: 'Session expirée',
            status: 401,
            code: 'AUTH_SESSION_EXPIREE',
            instance: 'req-1',
          },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur);

    expect(
      await screen.findByText('Votre session a expiré. Reconnectez-vous pour continuer.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Se reconnecter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprendre une photo' })).not.toBeInTheDocument();
  });

  it('service de lecture indisponible (503) : message dédié et saisie manuelle proposée', async () => {
    installerImageEtCanvasFactices('succes');
    server.use(
      http.post('/api/v1/scan/permis-circulation', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/SERVICE_LECTURE_INDISPONIBLE',
            title: 'Service de lecture indisponible',
            status: 503,
            code: 'SERVICE_LECTURE_INDISPONIBLE',
            instance: 'req-2',
          },
          { status: 503, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur);

    expect(
      await screen.findByText(/Le service de lecture des permis ne répond pas/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Saisir le véhicule à la main' })).toBeInTheDocument();
  });
});

/**
 * CADRAGE AUTOMATIQUE — chantier du 18.08.2026 (détection réelle des bords, voir
 * `detecterBordsDocument.ts`). `installerImageEtCanvasFactices` (ci-dessus) ne peut pas servir ici :
 * son unique mock `getContext` renvoie la MÊME donnée quelle que soit la taille de canevas demandée,
 * ce qui fait que `detecterBordsDocument.ts` (canevas ~320px) ne reçoit jamais un tampon de la
 * bonne taille pour SA donnée de test et se dégrade silencieusement (comportement voulu — voir la
 * doc de tête de `detecterBordsDepuisPixels`) : c'est justement ce qui garde TOUTE la suite
 * ci-dessus verte sans la modifier, la détection y reste toujours « non confiante » (repli sur le
 * cadre fixe, comportement inchangé). Pour exercer le chemin où la détection RÉUSSIT, ce mock lit
 * la taille RÉELLEMENT demandée (`this.width`/`this.height`, posés par le code de production AVANT
 * `getContext`) et sert une image synthétique adaptée à CHAQUE canevas : un rectangle sombre net
 * sur fond clair pour le canevas de détection (~320px), un damier contrasté pour le canevas
 * d'échantillonnage qualité (240px, `LARGEUR_ECHANTILLON` dans `analyserQualitePhoto.ts`).
 */
describe('cadrage automatique détecté', () => {
  function installerImageEtCanvasPourCadrageDetecte(): void {
    const dimensions = { largeur: 3000, hauteur: 2000 };
    class ImageFactice {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_valeur: string) {
        queueMicrotask(() => {
          this.naturalWidth = dimensions.largeur;
          this.naturalHeight = dimensions.hauteur;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal('Image', ImageFactice as unknown as typeof Image);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      const largeur = this.width;
      const hauteur = this.height;
      return {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => {
          const data = new Uint8ClampedArray(largeur * hauteur * 4);
          for (let y = 0; y < hauteur; y += 1) {
            for (let x = 0; x < largeur; x += 1) {
              const base = (y * largeur + x) * 4;
              const estCanevasQualite = largeur === 240; // LARGEUR_ECHANTILLON, analyserQualitePhoto.ts
              const valeur = estCanevasQualite
                ? (x + y) % 2 === 0
                  ? 20
                  : 235 // damier net et contrasté — même patron que l'« ok » de la suite ci-dessus
                : x > largeur * 0.2 && x < largeur * 0.8 && y > hauteur * 0.2 && y < hauteur * 0.8
                  ? 20 // rectangle plein, net, occupant 36 % de l'aire — détecté avec confiance
                  : 220; // fond uniforme
              data[base] = valeur;
              data[base + 1] = valeur;
              data[base + 2] = valeur;
              data[base + 3] = 255;
            }
          }
          return { data };
        }),
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(['jpeg-factice'], { type: 'image/jpeg' }));
    });
  }

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:objet-1'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    FauxEventSource.instances = [];
    vi.stubGlobal('EventSource', FauxEventSource);
    installerBitmapFactice();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('une détection confiante affiche la confirmation de cadrage AVANT tout envoi réseau', async () => {
    installerImageEtCanvasPourCadrageDetecte();
    let appelOcrRecu = false;
    server.use(
      http.post('/api/v1/scan/permis-circulation', () => {
        appelOcrRecu = true;
        return HttpResponse.json(reponseScan());
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await photographier(utilisateur);

    expect(await screen.findByText('Cadrage automatique détecté')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Utiliser la photo entière' })).toBeInTheDocument();
    expect(appelOcrRecu).toBe(false);
  });

  it('« Continuer » accepte le cadrage détecté et poursuit normalement jusqu’au formulaire', async () => {
    installerImageEtCanvasPourCadrageDetecte();
    server.use(
      http.post('/api/v1/scan/permis-circulation', () => HttpResponse.json(reponseScan())),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByText('Cadrage automatique détecté');

    await utilisateur.click(screen.getByRole('button', { name: 'Continuer' }));

    expect(
      await screen.findByRole('button', { name: 'Valider et enregistrer' }),
    ).toBeInTheDocument();
  });

  it('« Utiliser la photo entière » annule le cadrage détecté et poursuit quand même (l’annulation n’est jamais un blocage)', async () => {
    installerImageEtCanvasPourCadrageDetecte();
    server.use(
      http.post('/api/v1/scan/permis-circulation', () => HttpResponse.json(reponseScan())),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByText('Cadrage automatique détecté');

    await utilisateur.click(screen.getByRole('button', { name: 'Utiliser la photo entière' }));

    expect(
      await screen.findByRole('button', { name: 'Valider et enregistrer' }),
    ).toBeInTheDocument();
  });

  it('quitter la confirmation de cadrage libère l’aperçu (aucune fuite d’URL, même patron que le panneau de refus)', async () => {
    const fermer = installerBitmapFactice();
    installerImageEtCanvasPourCadrageDetecte();
    server.use(
      http.post('/api/v1/scan/permis-circulation', () => HttpResponse.json(reponseScan())),
    );
    const utilisateur = userEvent.setup();
    rendre();
    await photographier(utilisateur);
    await screen.findByText('Cadrage automatique détecté');

    await utilisateur.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByRole('button', { name: 'Valider et enregistrer' });

    expect(fermer).toHaveBeenCalled();
  });
});

/**
 * SESSION — trois situations que la requête `useSession()` de CET écran doit distinguer (voir la
 * doc de tête d'`EcranScan.tsx`, § SESSION, pour le raisonnement complet et pourquoi il diffère de
 * la borne d'atelier). Ces tests utilisent SCIEMMENT `renduAvecRoutes` directement (pas la
 * fonction `rendre()` du haut de ce fichier, qui pré-remplit le cache pour éviter cette
 * vérification dans le reste de la suite) : ici, c'est précisément la résolution de la session
 * qui est sous test.
 */
describe('session', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:objet-1'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    FauxEventSource.instances = [];
    vi.stubGlobal('EventSource', FauxEventSource);
    installerBitmapFactice();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function reponseSessionAbsente() {
    return HttpResponse.json(
      {
        type: 'https://docs.dmsforall.example/erreurs/AUTH_SESSION_ABSENTE',
        title: 'Session absente',
        status: 401,
        code: 'AUTH_SESSION_ABSENTE',
        instance: 'req-1',
      },
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  it('session en cours de vérification : squelette de chargement, jamais l’écran de capture affiché avant résolution', async () => {
    let laisserPasser: (() => void) | undefined;
    server.use(
      http.get('/api/v1/auth/moi', async () => {
        await new Promise<void>((resolve) => {
          laisserPasser = resolve;
        });
        return HttpResponse.json(SESSION_TEST);
      }),
    );

    renduAvecRoutes([{ path: '/scan', element: <EcranScan /> }], { routeInitiale: '/scan' });

    expect(screen.queryByRole('button', { name: 'Prendre la photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // La requête doit avoir effectivement démarré (le handler MSW exécuté au moins jusqu'à sa
    // promesse en attente) avant de la laisser passer — sinon `laisserPasser` peut encore valoir
    // `undefined` à ce stade (le `fetch` n'a pas eu le temps d'atteindre le handler dans le même
    // tick que ce rendu synchrone).
    await waitFor(() => expect(laisserPasser).toBeDefined());
    laisserPasser?.();

    expect(await screen.findByRole('button', { name: 'Prendre la photo' })).toBeInTheDocument();
  });

  it('session absente (401) à l’étape neutre : redirige directement vers la connexion, rien n’étant engagé', async () => {
    server.use(http.get('/api/v1/auth/moi', () => reponseSessionAbsente()));

    renduAvecRoutes(
      [
        { path: '/scan', element: <EcranScan /> },
        { path: '/login', element: <div>Ecran de connexion</div> },
      ],
      { routeInitiale: '/scan' },
    );

    expect(await screen.findByText('Ecran de connexion')).toBeInTheDocument();
  });

  it('service de session injoignable à l’étape neutre : message actionnable avec réessai, jamais l’écran de connexion', async () => {
    let compteurAppels = 0;
    server.use(
      http.get('/api/v1/auth/moi', () => {
        compteurAppels += 1;
        return compteurAppels === 1
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.json(SESSION_TEST);
      }),
    );
    const utilisateur = userEvent.setup();

    renduAvecRoutes([{ path: '/scan', element: <EcranScan /> }], { routeInitiale: '/scan' });

    const boutonReessayer = await screen.findByRole('button', { name: 'Réessayer' });
    expect(screen.queryByRole('button', { name: 'Prendre la photo' })).not.toBeInTheDocument();

    await utilisateur.click(boutonReessayer);

    expect(await screen.findByRole('button', { name: 'Prendre la photo' })).toBeInTheDocument();
  });

  it(
    'la session devient absente pendant qu’une photo est déjà engagée (formulaire à corriger) : ' +
      'le travail reste affiché, une bannière explicite propose de se reconnecter, aucun redirect silencieux',
    async () => {
      installerImageEtCanvasFactices('succes');
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.post('/api/v1/scan/permis-circulation', () => HttpResponse.json(reponseScan())),
      );
      const utilisateur = userEvent.setup();
      const queryClient = creerQueryClientTest();
      queryClient.setQueryData(clesQuery.session(), SESSION_TEST);
      renduAvecRoutes([{ path: '/scan', element: <EcranScan /> }], {
        routeInitiale: '/scan',
        queryClient,
      });

      await photographier(utilisateur);
      expect(await screen.findByLabelText('Nom')).toHaveValue('Rossier');

      // La session s'éteint (déconnexion serveur, TTL dépassé) — reproduit ici par un refetch
      // explicite, comme un vrai retour de fenêtre ou une action déclencherait en pratique.
      server.use(http.get('/api/v1/auth/moi', () => reponseSessionAbsente()));
      await queryClient.refetchQueries({ queryKey: clesQuery.session() });

      // Le formulaire déjà rempli par l'OCR reste affiché tel quel — rien n'a disparu.
      expect(await screen.findByLabelText('Nom')).toHaveValue('Rossier');
      // La déconnexion est dite EN CLAIR, jamais un silence.
      expect(screen.getByText('Connexion perdue')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Se reconnecter' })).toBeInTheDocument();
    },
  );
});
