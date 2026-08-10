import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlocPaiementQrFige, ReponseDocumentVente } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFicheFacture } from './EcranFicheFacture';

/**
 * Preuve de deux gestes ajoutés à la fiche facture (voir les ÉCARTS SIGNALÉS en tête de
 * `EcranFicheFacture.tsx`) :
 *  1. l'action « Imprimer / télécharger le PDF » n'apparaît QUE quand `document_.qr !== null` —
 *     même mécanisme que `totalTtcCentimes`, jamais une lecture directe du rôle courant ;
 *  2. `qr === null` (devis, bon de commande, avoir, brouillon, ou rôle sans droit aux montants)
 *     ne laisse aucune zone vide inexpliquée : `CarteBulletinVersement` s'efface simplement, comme
 *     `RecapitulatifTVA` le fait déjà pour `totalTtcCentimes === undefined`.
 */

const CREANCIER = {
  iban: 'CH9300762011623852957',
  estQrIban: false,
  nom: 'Garage Martin SA',
  adresse: { rue: 'Route de Berne', numero: '12', npa: '1010', localite: 'Lausanne', pays: 'CH' },
};

// Facture de démo `2026-00002` citée dans la consigne : `debiteur = null` (RF-59, adresse
// incomplète à l'émission) sur une facture ÉMISE qui porte néanmoins un QR valide.
const QR_SANS_DEBITEUR: BlocPaiementQrFige = {
  qrPayload: 'SPC\r\n0200\r\n1',
  qrPayloadSha256: 'a'.repeat(64),
  typeReferenceQr: 'qrr',
  qrReference: '210000000003139471430009017',
  qrMontantCentimes: 12345,
  qrDevise: 'CHF',
  qrLangue: 'fr',
  creancier: CREANCIER,
  debiteur: null,
};

function construireDocument(overrides: Partial<ReponseDocumentVente> = {}): ReponseDocumentVente {
  return {
    id: 'facture-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: '2026-00002',
    numeroSequence: 2,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: 'non_regle',
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
      clientDesignation: 'Jean Dupont',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      conditionsPaiement: null,
      plaque: null,
    },
    dateDocument: '2026-07-20',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 11430,
    totalTvaCentimes: 915,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 12345,
    ventilationTva: [
      { regimeTva: 'normal', tauxTvaPourmille: 81, baseCentimes: 11430, tvaCentimes: 915 },
    ],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 12345,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: QR_SANS_DEBITEUR,
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [],
    nombreLignes: 0,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-07-20T09:00:00.000Z',
    emisPar: { utilisateurId: 'u1', nomAffiche: 'Alice' },
    creeLe: '2026-07-20T08:00:00.000Z',
    modifieLe: '2026-07-20T09:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

/** Reproduit le masquage serveur d'un rôle sans droit aux montants (`RF-114` → `RF-116`,
 *  `mapperDocument`) : `qr` et tous les champs montant/TVA sont ABSENTS, jamais substitués par
 *  `null`/`0` — exactement ce que `roleVoitLesMontants(role) === false` produit. */
function construireDocumentSansMontants(
  overrides: Partial<ReponseDocumentVente> = {},
): ReponseDocumentVente {
  const complet = construireDocument(overrides);
  const {
    statutReglement: _statutReglement,
    totalHtCentimes: _totalHtCentimes,
    totalTvaCentimes: _totalTvaCentimes,
    ecartRepriseCentimes: _ecartRepriseCentimes,
    totalTtcCentimes: _totalTtcCentimes,
    ventilationTva: _ventilationTva,
    montantRegleCentimes: _montantRegleCentimes,
    soldeCentimes: _soldeCentimes,
    // Même masquage (RF-114 → RF-116) pour le bloc échéance/retard — `dateEcheance`/`enRetard`/
    // `joursRetard` sont une donnée financière au même titre qu'un montant (`document.ts`).
    dateEcheance: _dateEcheance,
    enRetard: _enRetard,
    joursRetard: _joursRetard,
    ...sansMontants
  } = complet;
  return { ...sansMontants, qr: null };
}

function installerHandlerDocument(document_: ReponseDocumentVente) {
  server.use(
    http.get(`/api/v1/documents-vente/${document_.id}`, () => HttpResponse.json(document_)),
  );
}

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role']) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre(id = 'facture-1') {
  const queryClient = creerQueryClientTest();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/factures/${id}`]}>
          <Routes>
            <Route path="/factures/:id" element={<EcranFicheFacture />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('EcranFicheFacture — action Imprimer / télécharger le PDF', () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('apparaît sur une facture émise pour un rôle qui voit les montants', async () => {
    installerHandlerDocument(construireDocument());
    const utilisateur = userEvent.setup();
    rendre();

    const boutonAutresActions = await screen.findByRole('button', { name: 'Autres actions' });
    await utilisateur.click(boutonAutresActions);

    const lienImprimer = await screen.findByRole('menuitem', {
      name: 'Imprimer / télécharger le PDF',
    });
    expect(lienImprimer).toHaveAttribute('href', '/api/v1/documents-vente/facture-1/pdf');
    expect(lienImprimer).toHaveAttribute('target', '_blank');
  });

  it("n'apparaît pas sur un avoir (il crédite le client, il ne se paie pas — qr toujours null)", async () => {
    installerHandlerDocument(
      construireDocument({
        id: 'avoir-1',
        typeDocument: 'avoir',
        natureFacture: null,
        numero: '2026-AV-00001',
        factureAnnuleeId: 'facture-1',
        motifAvoir: 'geste_commercial',
        qr: null,
      }),
    );
    rendre('avoir-1');

    // Le document est bien chargé (le reste de l'écran s'affiche) — seule l'option d'impression
    // est absente, pas l'écran entier.
    await screen.findByText('Jean Dupont');
    expect(screen.queryByText('Imprimer / télécharger le PDF')).not.toBeInTheDocument();
  });

  it("n'apparaît pas sur un brouillon (qr n'existe qu'à l'émission)", async () => {
    installerHandlerDocument(
      construireDocument({
        statut: 'brouillon',
        numero: null,
        numeroSequence: null,
        emisLe: null,
        emisPar: null,
        qr: null,
        pdfCle: null,
      }),
    );
    rendre();

    await screen.findByText('Jean Dupont');
    // Ni le menu « Autres actions » (aucun autre item ne s'applique à un brouillon), ni l'item.
    expect(screen.queryByRole('button', { name: 'Autres actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Imprimer / télécharger le PDF')).not.toBeInTheDocument();
  });

  it(
    "n'apparaît pas pour un rôle sans droit aux montants, même si la facture est émise — le menu " +
      'reste disponible pour Corriger/Créer un avoir, qui eux ne dépendent pas des montants',
    async () => {
      installerHandlerDocument(construireDocumentSansMontants());
      const utilisateur = userEvent.setup();
      rendre();

      const boutonAutresActions = await screen.findByRole('button', { name: 'Autres actions' });
      await utilisateur.click(boutonAutresActions);

      expect(
        await screen.findByRole('menuitem', { name: 'Corriger cette facture' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: 'Imprimer / télécharger le PDF' }),
      ).not.toBeInTheDocument();
    },
  );

  it(
    'reste disponible sur une facture annulée par un avoir — elle a bien été émise, son PDF est ' +
      'figé et immuable comme le reste du document (impression-facture.controller.ts ne teste que ' +
      'typeDocument/qr, jamais statut)',
    async () => {
      installerHandlerDocument(
        construireDocument({ statut: 'annule_par_avoir', annuleParAvoirId: 'avoir-2' }),
      );
      const utilisateur = userEvent.setup();
      rendre();

      const boutonAutresActions = await screen.findByRole('button', { name: 'Autres actions' });
      await utilisateur.click(boutonAutresActions);

      expect(
        await screen.findByRole('menuitem', { name: 'Imprimer / télécharger le PDF' }),
      ).toBeInTheDocument();
      // « Corriger »/« Créer un avoir » n'ont en revanche plus de sens sur une facture déjà annulée.
      expect(
        screen.queryByRole('menuitem', { name: 'Corriger cette facture' }),
      ).not.toBeInTheDocument();
    },
  );
});

describe('EcranFicheFacture — bulletin de versement (qr)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('qr === null (devis, bon de commande, avoir, brouillon, rôle sans droit) ne laisse aucune zone vide ni erreur', async () => {
    installerHandlerDocument(
      construireDocument({ statut: 'brouillon', numero: null, numeroSequence: null, qr: null }),
    );
    rendre();

    // L'écran se charge et affiche son contenu normalement — pas d'exception, pas de zone
    // fantôme laissée par un rendu qui aurait planté sur `qr === null`.
    await screen.findByText('Jean Dupont');
    expect(screen.getAllByText('Total TTC').length).toBeGreaterThan(0);
    // Aucune trace du titre du bulletin : la carte est absente en bloc, pas vide-et-expliquée.
    expect(screen.queryByText('Bulletin de versement')).not.toBeInTheDocument();
  });

  it('ne plante pas et respecte le même effacement pour un rôle sans droit aux montants (qr masqué à null par le serveur)', async () => {
    installerHandlerDocument(construireDocumentSansMontants());
    rendre();

    await screen.findByText('Jean Dupont');
    await waitFor(() =>
      expect(screen.queryByText('Bulletin de versement')).not.toBeInTheDocument(),
    );
  });
});

describe('EcranFicheFacture — échéance / retard (IndicateurRetard, en-tête)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche l\'alarme "en retard de N jours" pour une facture en retard', async () => {
    installerHandlerDocument(
      construireDocument({ dateEcheance: '2026-07-15', enRetard: true, joursRetard: 20 }),
    );
    rendre();

    await screen.findByText('Jean Dupont');
    expect(await screen.findByText('en retard de 20 jours')).toBeInTheDocument();
  });

  it("affiche l'échéance SANS alarme pour une facture à venir (enRetard: false)", async () => {
    installerHandlerDocument(
      construireDocument({ dateEcheance: '2026-09-01', enRetard: false, joursRetard: null }),
    );
    rendre();

    await screen.findByText('Jean Dupont');
    expect(await screen.findByText('Échéance : 01.09.2026')).toBeInTheDocument();
    expect(screen.queryByText(/en retard/)).not.toBeInTheDocument();
  });

  it('affiche un état neutre "Échéance inconnue" quand dateEcheance est null (facture antérieure au champ, ou client sans délai paramétré)', async () => {
    installerHandlerDocument(
      construireDocument({ dateEcheance: null, enRetard: false, joursRetard: null }),
    );
    rendre();

    await screen.findByText('Jean Dupont');
    expect(await screen.findByText('Échéance inconnue')).toBeInTheDocument();
    expect(screen.queryByText(/en retard/)).not.toBeInTheDocument();
  });

  it("ne laisse aucune zone vide inexpliquée pour un rôle sans droit aux montants — l'indicateur disparaît naturellement (dateEcheance absente)", async () => {
    installerHandlerDocument(
      construireDocumentSansMontants({
        dateEcheance: '2026-07-15',
        enRetard: true,
        joursRetard: 20,
      }),
    );
    rendre();

    await screen.findByText('Jean Dupont');
    expect(screen.queryByText(/en retard/)).not.toBeInTheDocument();
    expect(screen.queryByText('Échéance inconnue')).not.toBeInTheDocument();
  });

  it("n'affiche rien pour un devis/bon de commande/avoir (dateEcheance toujours null par construction, jamais un « Échéance inconnue » trompeur sur un document qui n'est structurellement jamais échu)", async () => {
    installerHandlerDocument(
      construireDocument({
        id: 'avoir-echeance',
        typeDocument: 'avoir',
        natureFacture: null,
        numero: '2026-AV-00002',
        factureAnnuleeId: 'facture-1',
        motifAvoir: 'geste_commercial',
        qr: null,
        dateEcheance: null,
        enRetard: undefined,
        joursRetard: null,
      }),
    );
    rendre('avoir-echeance');

    await screen.findByText('Jean Dupont');
    expect(screen.queryByText('Échéance inconnue')).not.toBeInTheDocument();
  });
});

describe('EcranFicheFacture — remise globale : ne perd pas la saisie en cours', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it(
    "un refetch de la facture pendant l'édition (ex. la fenêtre reprend le focus, " +
      '`refetchOnWindowFocus` par défaut de TanStack Query v5) ne réinitialise PAS la remise ' +
      'saisie et non encore enregistrée — seul un changement de facture (id) doit recharger le champ',
    async () => {
      installerHandlerDocument(
        construireDocument({
          statut: 'brouillon',
          numero: null,
          numeroSequence: null,
          emisLe: null,
          emisPar: null,
          qr: null,
          remiseGlobaleSaisieCentimes: 1000,
        }),
      );
      const utilisateur = userEvent.setup();
      const { queryClient } = rendre();

      const champRemise = await screen.findByLabelText('Montant');
      expect(champRemise).toHaveValue('10.00');

      // L'utilisateur tape une nouvelle remise, PAS ENCORE enregistrée (« Enregistrer » n'a pas
      // été cliqué).
      await utilisateur.clear(champRemise);
      await utilisateur.type(champRemise, '25.00');
      expect(champRemise).toHaveValue('25.00');

      // Un refetch arrive (le serveur renvoie EXACTEMENT le même document, y compris la remise
      // d'origine 1000 centimes — la saisie de l'utilisateur n'a jamais été persistée). C'est le
      // même mécanisme que `refetchOnWindowFocus` : la query reste active (même id), une nouvelle
      // référence de `requete.data` arrive avec un contenu inchangé côté serveur.
      await queryClient.refetchQueries();

      // La saisie non enregistrée doit survivre au refetch — c'est le défaut corrigé : l'ancien
      // `useEffect(() => setRemiseCentimes(...), [requete.data])` écrasait silencieusement la
      // saisie ici.
      await waitFor(() => expect(champRemise).toHaveValue('25.00'));
    },
  );

  it("navigue vers une AUTRE facture (changement d'id, MÊME instance de composant) recharge bien la remise depuis le nouveau document", async () => {
    installerHandlerDocument(
      construireDocument({
        statut: 'brouillon',
        numero: null,
        numeroSequence: null,
        emisLe: null,
        emisPar: null,
        qr: null,
        remiseGlobaleSaisieCentimes: 1000,
      }),
    );
    installerHandlerDocument(
      construireDocument({
        id: 'facture-2',
        statut: 'brouillon',
        numero: null,
        numeroSequence: null,
        emisLe: null,
        emisPar: null,
        qr: null,
        remiseGlobaleSaisieCentimes: 5000,
        figees: {
          clientDesignation: 'Marie Rossi',
          clientIde: null,
          clientLangue: 'fr',
          adresseFacturation: null,
          conditionsPaiement: null,
          plaque: null,
        },
      }),
    );
    const utilisateur = userEvent.setup();
    const queryClient = creerQueryClientTest();

    function EnveloppeAvecNavigation() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate('/factures/facture-2')}>
            Aller à la facture 2
          </button>
          <Routes>
            <Route path="/factures/:id" element={<EcranFicheFacture />} />
          </Routes>
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/factures/facture-1']}>
          <EnveloppeAvecNavigation />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Facture 1 chargée, l'utilisateur tape une remise non enregistrée.
    const champRemise = await screen.findByLabelText('Montant');
    expect(champRemise).toHaveValue('10.00');
    await utilisateur.clear(champRemise);
    await utilisateur.type(champRemise, '25.00');
    expect(champRemise).toHaveValue('25.00');

    // Navigation vers une AUTRE facture, dans la MÊME instance du composant (le comportement à
    // préserver, contrairement au cas « même id, refetch » ci-dessus) : l'id change, le champ DOIT
    // se recharger depuis le nouveau document — 5000 centimes, pas la saisie non enregistrée ni
    // l'ancienne remise de la facture 1.
    await utilisateur.click(screen.getByRole('button', { name: 'Aller à la facture 2' }));

    await screen.findByText('Marie Rossi');
    const nouveauChampRemise = await screen.findByLabelText('Montant');
    await waitFor(() => expect(nouveauChampRemise).toHaveValue('50.00'));
  });
});

/**
 * Défaut corrigé (le plus grave de l'audit, récidive d'une famille déjà corrigée deux fois) :
 * `estBrouillon`/`peutGererFacture` ne dépendaient que de l'ÉTAT du document, jamais du RÔLE. Un
 * rôle sans le droit serveur correspondant (`apps/api/src/auth/matrice-droits.ts`) voyait quand
 * même le bouton. Doctrine du dépôt : un rôle sans droit ne voit pas un bouton grisé, il ne voit
 * pas de bouton — vérifié ici par `getByRole`/`queryByRole`, jamais par une classe CSS.
 */
describe('EcranFicheFacture — droits par geste (émettre / encaisser / créer un avoir)', () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  function documentBrouillon() {
    return construireDocument({
      statut: 'brouillon',
      numero: null,
      numeroSequence: null,
      emisLe: null,
      emisPar: null,
      qr: null,
    });
  }

  it(
    '« Émettre » : absent pour chef_atelier (aucun droit `facturation.document.emettre_facture` ' +
      'côté serveur), présent pour vendeur (autorisé)',
    async () => {
      installerHandlerDocument(documentBrouillon());
      connecterSession('chef_atelier');
      const rendu1 = rendre();
      await screen.findByText('Jean Dupont');
      expect(screen.queryByRole('button', { name: 'Émettre' })).not.toBeInTheDocument();
      rendu1.unmount();

      installerHandlerDocument(documentBrouillon());
      connecterSession('vendeur');
      rendre();
      expect(await screen.findByRole('button', { name: 'Émettre' })).toBeInTheDocument();
    },
  );

  it(
    '« Encaisser » : absent pour admin (RF-115, aucun droit financier), présent pour magasinier ' +
      '(autorisé)',
    async () => {
      installerHandlerDocument(construireDocument());
      connecterSession('admin');
      const rendu1 = rendre();
      await screen.findByText('Jean Dupont');
      expect(screen.queryByRole('button', { name: 'Encaisser' })).not.toBeInTheDocument();
      rendu1.unmount();

      installerHandlerDocument(construireDocument());
      connecterSession('magasinier');
      rendre();
      expect(await screen.findByRole('button', { name: 'Encaisser' })).toBeInTheDocument();
    },
  );

  it(
    '« Créer un avoir » (menu ⋯) : absent pour vendeur (pas de droit `emettre_avoir`), présent ' +
      'pour réceptionnaire (autorisé)',
    async () => {
      installerHandlerDocument(construireDocument());
      connecterSession('vendeur');
      const utilisateur = userEvent.setup();
      const rendu1 = rendre();
      const boutonAutresActionsVendeur = await screen.findByRole('button', {
        name: 'Autres actions',
      });
      await utilisateur.click(boutonAutresActionsVendeur);
      expect(screen.queryByRole('menuitem', { name: 'Créer un avoir' })).not.toBeInTheDocument();
      rendu1.unmount();

      installerHandlerDocument(construireDocument());
      connecterSession('receptionnaire');
      rendre();
      const boutonAutresActionsReceptionnaire = await screen.findByRole('button', {
        name: 'Autres actions',
      });
      await utilisateur.click(boutonAutresActionsReceptionnaire);
      expect(await screen.findByRole('menuitem', { name: 'Créer un avoir' })).toBeInTheDocument();
    },
  );
});

/**
 * Défaut corrigé : depuis une facture, aucun chemin ne menait au client (le seul lien, « Compléter
 * la fiche », n'apparaissait que si l'adresse était incomplète). Le nom du destinataire est
 * désormais un vrai bouton de navigation, sur le même patron que le lien vers l'OR (`issueDeOr`,
 * déjà câblé plus haut dans ce fichier) — vérifié ici en navigation RÉELLE (un `<Route
 * path="/clients/:id">` de test rend un marqueur reconnaissable), pas seulement par la présence
 * d'un `role="button"` : un test qui se contenterait de `getByRole('button')` passerait même si
 * `onClick` ne faisait rien.
 */
describe('EcranFicheFacture — navigation vers la fiche client', () => {
  function rendreAvecRouteClient(id = 'facture-1') {
    const queryClient = creerQueryClientTest();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/factures/${id}`]}>
          <Routes>
            <Route path="/factures/:id" element={<EcranFicheFacture />} />
            <Route path="/clients/:clientId" element={<p>Marqueur fiche client atteinte</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('navigue vers la fiche client au clic sur le nom du destinataire, sur une facture émise', async () => {
    installerHandlerDocument(construireDocument());
    const utilisateur = userEvent.setup();
    rendreAvecRouteClient();

    const boutonDestinataire = await screen.findByRole('button', { name: 'Jean Dupont' });
    await utilisateur.click(boutonDestinataire);

    expect(await screen.findByText('Marqueur fiche client atteinte')).toBeInTheDocument();
  });

  it('navigue vers la fiche client au clic sur le nom du destinataire, sur un brouillon', async () => {
    installerHandlerDocument(
      construireDocument({
        statut: 'brouillon',
        numero: null,
        numeroSequence: null,
        emisLe: null,
        emisPar: null,
        qr: null,
      }),
    );
    const utilisateur = userEvent.setup();
    rendreAvecRouteClient();

    const boutonDestinataire = await screen.findByRole('button', { name: 'Jean Dupont' });
    await utilisateur.click(boutonDestinataire);

    expect(await screen.findByText('Marqueur fiche client atteinte')).toBeInTheDocument();
  });

  it('le bouton de navigation reste distinct du popover « verrouillé » — le clic ne déclenche pas les deux', async () => {
    // Facture émise avec adresse complète : le bloc adresse est enveloppé par `ChampVerrouille`
    // (popover « corriger par un avoir »). Le nom, lui, ne doit PAS ouvrir ce popover — seulement
    // naviguer. Preuve que les deux affordances ne sont plus imbriquées l'une dans l'autre.
    installerHandlerDocument(
      construireDocument({
        figees: {
          clientDesignation: 'Jean Dupont',
          clientIde: null,
          clientLangue: 'fr',
          adresseFacturation: {
            rue: 'Rue du Lac',
            numero: '4',
            npa: '1000',
            localite: 'Lausanne',
            pays: 'CH',
          },
          conditionsPaiement: null,
          plaque: null,
        },
      }),
    );
    const utilisateur = userEvent.setup();
    rendreAvecRouteClient();

    const boutonDestinataire = await screen.findByRole('button', { name: 'Jean Dupont' });
    await utilisateur.click(boutonDestinataire);

    expect(await screen.findByText('Marqueur fiche client atteinte')).toBeInTheDocument();
    // Le popover « verrouillé » (texte fixe `facturation:verrouille.message`) ne doit pas être
    // apparu suite à ce clic.
    expect(
      screen.queryByText('Cette facture est émise et ne peut plus être modifiée.'),
    ).not.toBeInTheDocument();
  });
});
