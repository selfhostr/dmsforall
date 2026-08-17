import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvenementTempsReel } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import type { DonneesPermisScanne, ReponseScanPermisCirculation } from './contrat-ocr.temporaire';
import { EcranScan } from './EcranScan';

/**
 * Faux `EventSource` — MÊME patron que `hooks/temps-reel/useEvenementsTempsReel.spec.tsx` (jsdom
 * n'implémente pas cette API). Dupliqué ici plutôt qu'importé : `hooks/temps-reel/` est hors du
 * périmètre d'écriture de cet agent, et ce fichier de test n'a pas vocation à devenir un point de
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
 * Suite d'intégration de l'écran de scan — machine à états (capture -> préparation -> analyse ->
 * formulaire | résultat | erreur), voir la doc de tête d'`EcranScan.tsx`. Trois soucis techniques
 * de test à connaître avant de lire les stubs ci-dessous :
 *
 *  1. jsdom (`environnementJsdomFetch.ts`) ne décode pas réellement une image ni n'implémente
 *     `HTMLCanvasElement.getContext` — la réduction d'image (`reduireImage.ts`) est donc simulée
 *     ici comme dans `reduireImage.spec.ts` (même patron de stub `Image`/`canvas`).
 *  2. `<input type="file">` ne peut pas recevoir de fichier par un vrai clic utilisateur sous
 *     jsdom : on cible directement l'`<input>` caché (`sr-only`) via son `aria-label` et on
 *     déclenche `userEvent.upload`, qui simule fidèlement l'événement `change` du navigateur.
 *  3. `useSession()` (mode scan mobile) répond `401` par défaut (`src/test/msw/handlers.ts`) :
 *     aucun rôle résolu, donc `useModeScanMobile` reste inactif — cohérent avec ces tests, qui
 *     portent sur le PARCOURS de scan lui-même, pas sur la restriction mobile (couverte à part par
 *     `composants/layout/useModeScanMobile.spec.ts`).
 */

function installerImageEtCanvasFactices(comportement: 'succes' | 'echec'): void {
  class ImageFactice {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_valeur: string) {
      queueMicrotask(() => {
        if (comportement === 'succes') {
          this.naturalWidth = 1200;
          this.naturalHeight = 800;
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
  return renduAvecRoutes([{ path: '/scan', element: <EcranScan /> }], { routeInitiale: '/scan' });
}

async function photographier(
  utilisateur: ReturnType<typeof userEvent.setup>,
  nomFichier = 'permis.jpg',
) {
  const entree = screen.getByLabelText('Prendre la photo', { selector: 'input' });
  const fausseImage = new File(['contenu-factice'], nomFichier, { type: 'image/jpeg' });
  await utilisateur.upload(entree, fausseImage);
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('affiche la consigne de capture au premier rendu, sans appel réseau', () => {
    rendre();
    expect(screen.getByText('Photographiez le permis de circulation')).toBeInTheDocument();
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
});
