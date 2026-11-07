import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BlocPaiementQrFige,
  ReponseDocumentVente,
  ReponseLigneDocumentVente,
} from '@dfa/shared';

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

describe('EcranFicheFacture — date affichée en en-tête (issue #60, testeur novice)', () => {
  it(
    'affiche `dateDocument` (date légale/métier), jamais `emisLe` (horodatage serveur) — DÉFAUT ' +
      'CORRIGÉ : la fiche affichait `emisLe` sous le libellé « émise le », en désaccord avec la ' +
      'liste des factures et la feuille d’encaissement, qui affichent TOUTES DEUX `dateDocument` ' +
      "sous ce même libellé (trois dates différentes pour un même document selon l'écran). " +
      '`document.ts` : « les deux champs ne sont PAS interchangeables et ne doivent pas partager ' +
      'le même libellé côté écran »',
    async () => {
      installerHandlerDocument(
        construireDocument({ dateDocument: '2026-01-15', emisLe: '2026-08-11T08:25:14.996Z' }),
      );

      rendre();

      expect(await screen.findByText('émise le 15.01.2026')).toBeInTheDocument();
      expect(screen.queryByText('émise le 11.08.2026')).not.toBeInTheDocument();
    },
  );
});

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

  // « Imprimer » a QUITTÉ le menu « Autres actions » (chantier d'unification inter-écrans,
  // 25.08.2026) — bouton AUTONOME (`BoutonImprimerDocument`, `composants/motifs/`), au même titre
  // qu'en atelier (`BoutonImprimerOr`) : `peutImprimer` est un droit de CONSULTATION, décorrélé de
  // `peutGererFacture` (voir la note de tête de `EcranFicheFacture.tsx`), il n'a plus sa place
  // derrière un « … » qui ne gouverne plus que Corriger/Créer un avoir. `getByRole('link', …)`
  // remplace `getByRole('menuitem', …)` : c'est maintenant un lien, plus un item de menu.
  it('apparaît sur une facture émise pour un rôle qui voit les montants', async () => {
    installerHandlerDocument(construireDocument());
    rendre();

    const lienImprimer = await screen.findByRole('link', {
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
    // est absente, pas l'écran entier. `findAllByText` (partout dans ce fichier, chantier
    // « un seul patron » 24.08.2026) plutôt que `findByText` — le fil d'Ariane (`FilAriane`,
    // nouvellement monté) répète désormais le nom du destinataire en ancêtre cliquable, un second
    // nœud de texte légitime que ce simple garde d'attente n'a pas besoin de distinguer du premier.
    await screen.findAllByText('Jean Dupont');
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

    await screen.findAllByText('Jean Dupont');
    // Ni le menu « Autres actions » (aucun autre item ne s'applique à un brouillon), ni l'item.
    expect(screen.queryByRole('button', { name: 'Autres actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Imprimer / télécharger le PDF')).not.toBeInTheDocument();
  });

  it(
    "n'apparaît pas pour un rôle sans droit aux montants, même si la facture est émise — le menu " +
      'reste disponible pour Corriger, qui ne dépend pas des montants (mais du rôle — voir ' +
      "`peutCorrigerFacture`, `comptable` connecté ici pour isoler l'axe montants de l'axe rôle)",
    async () => {
      installerHandlerDocument(construireDocumentSansMontants());
      connecterSession('comptable');
      const utilisateur = userEvent.setup();
      rendre();

      const boutonAutresActions = await screen.findByRole('button', { name: 'Autres actions' });
      // Imprimer ne dépend plus du menu « Autres actions » (bouton autonome depuis le chantier
      // d'unification inter-écrans, 25.08.2026) — absent directement, plus seulement absent une
      // fois le menu ouvert.
      expect(
        screen.queryByRole('link', { name: 'Imprimer / télécharger le PDF' }),
      ).not.toBeInTheDocument();

      await utilisateur.click(boutonAutresActions);
      expect(
        await screen.findByRole('menuitem', { name: 'Corriger cette facture' }),
      ).toBeInTheDocument();
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
      rendre();

      expect(
        await screen.findByRole('link', { name: 'Imprimer / télécharger le PDF' }),
      ).toBeInTheDocument();
      // « Corriger »/« Créer un avoir » n'ont en revanche plus de sens sur une facture déjà
      // annulée : le menu « Autres actions » lui-même n'a donc plus rien à y proposer et
      // disparaît entièrement (Imprimer, désormais autonome, ne le maintenait plus en vie qu'à
      // lui seul — voir la note ci-dessus).
      expect(screen.queryByRole('button', { name: 'Autres actions' })).not.toBeInTheDocument();
    },
  );
});

/**
 * DÉFAUT CORRIGÉ (relevé au test manuel du 14.08.2026, quatre comptes) : « Corriger cette facture »
 * (menu ⋯) ET le lien « Corriger par un avoir → » sous les lignes restaient cliquables pour
 * `chef_atelier` et pour le compte technique `admin` — le dialogue s'ouvrait, son bouton de
 * validation était actif. `proposeCorriger` ne dépendait que de l'état du document
 * (`peutGererFacture`), jamais du rôle. Matrice exigée : `direction`/`comptable` autorisés,
 * `chef_atelier`/`vendeur`/`receptionnaire`/`technicien`/`magasinier`/`admin`/`poste_atelier`
 * refusés — voir `peutCorrigerFacture` (`./droits.ts`) pour le détail et l'état réel du serveur
 * aujourd'hui (l'endpoint `POST .../corriger` n'existe pas encore, voir
 * `apps/api/src/facturation/documents/document-vente-corriger-absent.spec.ts`).
 *
 * Les DEUX points d'entrée sont couverts par CE SEUL mécanisme (`proposeCorriger`) — pas de
 * contrôle dupliqué : le test le prouve en vérifiant les deux dans le même cas de figure.
 */
describe('EcranFicheFacture — « Corriger cette facture » / « Corriger par un avoir → » (défaut corrigé, test manuel du 14.08.2026)', () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it.each(['direction', 'comptable'] as const)(
    '%s : autorisé — « Corriger cette facture » présent au menu ET « Corriger par un avoir → » cliquable sous les lignes',
    async (role) => {
      installerHandlerDocument(construireDocument());
      connecterSession(role);
      const utilisateur = userEvent.setup();
      rendre();

      await screen.findAllByText('Jean Dupont');

      // Lien sous les lignes — un vrai bouton cliquable, pas seulement le texte informatif.
      expect(
        screen.getByRole('button', {
          name: 'Cette facture est émise et ne peut plus être modifiée. Corriger par un avoir →',
        }),
      ).toBeInTheDocument();

      // Menu ⋯.
      const boutonAutresActions = await screen.findByRole('button', { name: 'Autres actions' });
      await utilisateur.click(boutonAutresActions);
      expect(
        await screen.findByRole('menuitem', { name: 'Corriger cette facture' }),
      ).toBeInTheDocument();
    },
  );

  it.each([
    'chef_atelier',
    'vendeur',
    'receptionnaire',
    'technicien',
    'magasinier',
    'admin',
    'poste_atelier',
  ] as const)(
    '%s : refusé — ni « Corriger cette facture » au menu, ni le lien « Corriger par un avoir → » cliquable sous les lignes (message informatif seul, non actionnable)',
    async (role) => {
      installerHandlerDocument(construireDocument());
      connecterSession(role);
      const utilisateur = userEvent.setup();
      rendre();

      await screen.findAllByText('Jean Dupont');

      // Le message reste visible (pourquoi c'est verrouillé) — jamais un bouton menant au dialogue.
      expect(
        screen.getByText('Cette facture est émise et ne peut plus être modifiée.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Corriger par un avoir/ }),
      ).not.toBeInTheDocument();

      // Le menu « Autres actions » ne gouverne plus que Corriger/Créer un avoir (Imprimer en est
      // sorti, chantier d'unification inter-écrans du 25.08.2026) : pour un rôle refusé sur les
      // DEUX (ex. `chef_atelier`), le menu peut être totalement absent, pas seulement vide une
      // fois ouvert — seul `receptionnaire` (autorisé pour créer un avoir, refusé pour corriger)
      // garde ici un menu à ouvrir.
      const boutonAutresActions = screen.queryByRole('button', { name: 'Autres actions' });
      if (boutonAutresActions) {
        await utilisateur.click(boutonAutresActions);
      }
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
    await screen.findAllByText('Jean Dupont');
    expect(screen.getAllByText('Total TTC').length).toBeGreaterThan(0);
    // Aucune trace du titre du bulletin : la carte est absente en bloc, pas vide-et-expliquée.
    expect(screen.queryByText('Bulletin de versement')).not.toBeInTheDocument();
  });

  it('ne plante pas et respecte le même effacement pour un rôle sans droit aux montants (qr masqué à null par le serveur)', async () => {
    installerHandlerDocument(construireDocumentSansMontants());
    rendre();

    await screen.findAllByText('Jean Dupont');
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

    await screen.findAllByText('Jean Dupont');
    expect(await screen.findByText('en retard de 20 jours')).toBeInTheDocument();
    // Défaut corrigé (issue #134) : l'échéance doit rester VISIBLE (pas seulement dans un
    // attribut `title`, invisible au clavier/lecteur d'écran/tablette) même quand la facture
    // est en retard — un client au téléphone demande précisément cette date.
    expect(await screen.findByText('Échéance : 15.07.2026')).toBeInTheDocument();
  });

  it("affiche l'échéance SANS alarme pour une facture à venir (enRetard: false)", async () => {
    installerHandlerDocument(
      construireDocument({ dateEcheance: '2026-09-01', enRetard: false, joursRetard: null }),
    );
    rendre();

    await screen.findAllByText('Jean Dupont');
    expect(await screen.findByText('Échéance : 01.09.2026')).toBeInTheDocument();
    expect(screen.queryByText(/en retard/)).not.toBeInTheDocument();
  });

  it('affiche un état neutre "Échéance inconnue" quand dateEcheance est null (facture antérieure au champ, ou client sans délai paramétré)', async () => {
    installerHandlerDocument(
      construireDocument({ dateEcheance: null, enRetard: false, joursRetard: null }),
    );
    rendre();

    await screen.findAllByText('Jean Dupont');
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

    await screen.findAllByText('Jean Dupont');
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

    await screen.findAllByText('Jean Dupont');
    expect(screen.queryByText('Échéance inconnue')).not.toBeInTheDocument();
  });
});

describe('EcranFicheFacture — vocabulaire du badge de règlement sur un avoir (issue #129)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('un avoir émis et non encore imputé affiche « Non imputé », jamais « Non réglée » (un avoir ne se paie pas, il crédite le client)', async () => {
    installerHandlerDocument(
      construireDocument({
        id: 'avoir-vocabulaire',
        typeDocument: 'avoir',
        natureFacture: null,
        numero: '2026-AV-00003',
        factureAnnuleeId: 'facture-1',
        motifAvoir: 'geste_commercial',
        qr: null,
        dateEcheance: null,
        enRetard: undefined,
        joursRetard: null,
        statutReglement: 'non_regle',
      }),
    );
    rendre('avoir-vocabulaire');

    await screen.findAllByText('Jean Dupont');
    expect(await screen.findByText('Pas encore utilisé')).toBeInTheDocument();
    expect(screen.queryByText('Non réglée')).not.toBeInTheDocument();
  });

  it("une facture émise non réglée conserve « Non réglée » (vocabulaire inchangé, seul l'avoir change de mot)", async () => {
    installerHandlerDocument(construireDocument({ statutReglement: 'non_regle' }));
    rendre();

    await screen.findAllByText('Jean Dupont');
    expect(await screen.findByText('Non réglée')).toBeInTheDocument();
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

    await screen.findAllByText('Marie Rossi');
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
      await screen.findAllByText('Jean Dupont');
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
      await screen.findAllByText('Jean Dupont');
      expect(screen.queryByRole('button', { name: 'Encaisser' })).not.toBeInTheDocument();
      rendu1.unmount();

      installerHandlerDocument(construireDocument());
      connecterSession('magasinier');
      rendre();
      expect(await screen.findByRole('button', { name: 'Encaisser' })).toBeInTheDocument();
    },
  );

  it(
    'DÉFAUT CORRIGÉ (issues #80/#94, testeur novice — « je n’ai pas osé cliquer, j’allais ' +
      'enregistrer une avance sur le compte d’un client qui a déjà payé ») : « Encaisser » ' +
      'disparaît sur une facture émise dont le solde est nul (`statutReglement: regle`), MÊME pour ' +
      'un rôle autorisé à encaisser — et le badge « Réglée » apparaît à côté de « Émise » plutôt ' +
      'que de laisser la fiche taire l’état du règlement',
    async () => {
      installerHandlerDocument(
        construireDocument({
          statutReglement: 'regle',
          soldeCentimes: 0,
          montantRegleCentimes: 12345,
        }),
      );
      connecterSession('magasinier');
      rendre();

      await screen.findAllByText('Jean Dupont');
      expect(screen.getByText('Émise')).toBeInTheDocument();
      expect(screen.getByText('Réglée')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Encaisser' })).not.toBeInTheDocument();
    },
  );

  it(
    '« Créer un avoir » (menu ⋯) : absent pour magasinier (pas de droit `emettre_avoir`), présent ' +
      'pour réceptionnaire (autorisé)',
    async () => {
      installerHandlerDocument(construireDocument());
      connecterSession('magasinier');
      const utilisateur = userEvent.setup();
      const rendu1 = rendre();
      // magasinier n'a ni `peutCorrigerFacture` ni `peutEmettreAvoir` : aucune action secondaire,
      // donc le menu « Autres actions » lui-même ne s'affiche plus (Imprimer, qui le maintenait en
      // vie à lui seul avant le chantier d'unification inter-écrans du 25.08.2026, est désormais un
      // bouton autonome) — seul le bouton primaire « Encaisser » (droit distinct, voir
      // `peutEncaisser`, qui inclut `magasinier`) reste visible.
      await screen.findByRole('button', { name: 'Encaisser' });
      expect(screen.queryByRole('button', { name: 'Autres actions' })).not.toBeInTheDocument();
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

function construireLigne(
  overrides: Partial<ReponseLigneDocumentVente> = {},
): ReponseLigneDocumentVente {
  return {
    id: 'ligne-1',
    documentId: 'facture-1',
    numeroOrdre: 1,
    type: 'forfait',
    ligneOrId: null,
    documentAcompteId: null,
    designation: 'Forfait révision',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    prixUnitaireTtcCentimes: 10_000,
    modeCalculTva: 'ttc',
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-13',
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    montants: {
      montantHtCentimes: 9251,
      montantTvaCentimes: 749,
      montantTtcCentimes: 10_000,
      montantFacturableCentimes: 10_000,
      montantValoriseCentimes: 10_000,
    },
    creeLe: '2026-08-13T08:00:00.000Z',
    modifieLe: '2026-08-13T08:00:00.000Z',
    ...overrides,
  };
}

/**
 * Défaut corrigé (testeur du 14.08.2026) : une facture émise depuis un dossier de vente
 * (`dossierVenteId`/`vehiculeId` renseignés par `mappeurs.ts`) affichait « Aucun document lié »
 * dans la carte « Documents liés » — le composant ne testait que `ordreReparationId`/
 * `factureAnnuleeId`/`annuleParAvoirId`, jamais ces deux champs, ni côté liens ni côté condition
 * de vide. Même patron de navigation réelle que `navigation vers la fiche client` ci-dessus (une
 * `<Route>` de test rend un marqueur), pas seulement `getByRole('button')`.
 */
describe('EcranFicheFacture — carte « Documents liés » (dossier de vente / véhicule)', () => {
  function rendreAvecRoutesLiees(id = 'facture-1') {
    const queryClient = creerQueryClientTest();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/factures/${id}`]}>
          <Routes>
            <Route path="/factures/:id" element={<EcranFicheFacture />} />
            <Route
              path="/ventes/dossiers/:idDossier"
              element={<p>Marqueur fiche dossier de vente atteinte</p>}
            />
            <Route
              path="/vehicules/:idVehicule"
              element={<p>Marqueur fiche véhicule atteinte</p>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it(
    'une facture avec dossierVenteId et vehiculeId affiche les deux liens et navigue vers les ' +
      'bonnes fiches',
    async () => {
      installerHandlerDocument(
        construireDocument({ dossierVenteId: 'dossier-1', vehiculeId: 'vehicule-1' }),
      );
      const utilisateur = userEvent.setup();
      rendreAvecRoutesLiees();

      const lienDossier = await screen.findByRole('button', {
        name: 'Vente liée →',
      });
      expect(lienDossier).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Véhicule lié →' })).toBeInTheDocument();

      await utilisateur.click(lienDossier);
      expect(
        await screen.findByText('Marqueur fiche dossier de vente atteinte'),
      ).toBeInTheDocument();
    },
  );

  it('le lien véhicule navigue vers la fiche véhicule', async () => {
    installerHandlerDocument(
      construireDocument({ dossierVenteId: 'dossier-1', vehiculeId: 'vehicule-1' }),
    );
    const utilisateur = userEvent.setup();
    rendreAvecRoutesLiees();

    const lienVehicule = await screen.findByRole('button', { name: 'Véhicule lié →' });
    await utilisateur.click(lienVehicule);

    expect(await screen.findByText('Marqueur fiche véhicule atteinte')).toBeInTheDocument();
  });

  it(
    "n'affiche aucun lien mort et conserve l'état vide correct quand dossierVenteId et " +
      "vehiculeId sont null (facture d'atelier ordinaire, sans OR ni avoir)",
    async () => {
      installerHandlerDocument(
        construireDocument({ dossierVenteId: null, vehiculeId: null, ordreReparationId: null }),
      );
      rendreAvecRoutesLiees();

      await screen.findAllByText('Jean Dupont');
      expect(screen.queryByRole('button', { name: 'Vente liée →' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Véhicule lié →' })).not.toBeInTheDocument();
      expect(await screen.findByText('Aucun document lié.')).toBeInTheDocument();
    },
  );

  it(
    "le couple avoir ↔ facture d'origine continue de s'afficher sans régression (dossierVenteId/" +
      'vehiculeId absents sur ce cas)',
    async () => {
      installerHandlerDocument(
        construireDocument({
          id: 'avoir-documents-lies',
          typeDocument: 'avoir',
          natureFacture: null,
          numero: '2026-AV-00004',
          factureAnnuleeId: 'facture-1',
          motifAvoir: 'geste_commercial',
          qr: null,
          dossierVenteId: null,
          vehiculeId: null,
        }),
      );
      rendreAvecRoutesLiees('avoir-documents-lies');

      expect(
        await screen.findByRole('button', { name: "Facture d'origine →" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Vente liée →' })).not.toBeInTheDocument();
      expect(screen.queryByText('Aucun document lié.')).not.toBeInTheDocument();
    },
  );
});

/**
 * Issue #125 : « impossible d'ajouter une ligne à un document de vente, et un document vide peut
 * être émis. » Trois preuves ci-dessous :
 *  1. l'ajout, la modification et la suppression de lignes sur un brouillon (une ligne recopiée
 *     d'un OR reste NON éditable ici — décision documentée dans `EcranFicheFacture.tsx`) ;
 *  2. ces trois gestes n'apparaissent JAMAIS sur un document émis (verrouillage MD-20/MD-21,
 *     doctrine inchangée) ;
 *  3. le refus d'émission d'un document sans ligne affiche le message SERVEUR précis
 *     (`erreurs[0].message`), jamais le bandeau générique `VALIDATION_ECHOUEE`.
 */
describe('EcranFicheFacture — lignes de document (issue #125)', () => {
  it('un brouillon SANS ligne affiche « Ajouter une ligne » et la soumission crée la ligne (corps envoyé exact)', async () => {
    const document_ = construireDocument({
      statut: 'brouillon',
      numero: null,
      numeroSequence: null,
      emisLe: null,
      emisPar: null,
      qr: null,
      lignes: [],
      nombreLignes: 0,
    });
    installerHandlerDocument(document_);

    let corpsRecu: unknown;
    server.use(
      http.post('/api/v1/documents-vente/facture-1/lignes', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(
          {
            donnees: {
              ...document_,
              lignes: [construireLigne({ designation: 'Vidange complète' })],
              nombreLignes: 1,
            },
            avertissements: [],
          },
          { status: 201 },
        );
      }),
    );

    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('Aucune ligne sur ce document.')).toBeInTheDocument();
    const boutonAjouter = screen.getByRole('button', { name: 'Ajouter une ligne' });
    await utilisateur.click(boutonAjouter);

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.type(within(dialogue).getByLabelText(/^Désignation/), 'Vidange complète');
    await utilisateur.type(within(dialogue).getByLabelText(/^Prix unitaire TTC/), '100.00');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      type: 'forfait',
      designation: 'Vidange complète',
      quantiteMillieme: 1000,
      prixUnitaireTtcCentimes: 10_000,
      regimeTva: 'normal',
      tauxTvaPourmille: 81,
    });

    expect(await screen.findByText('Vidange complète')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("une ligne saisie directement (`ligneOrId: null`) porte modifier/retirer ; une ligne issue d'un OR (`ligneOrId` renseigné) n'en porte aucun", async () => {
    installerHandlerDocument(
      construireDocument({
        statut: 'brouillon',
        numero: null,
        numeroSequence: null,
        emisLe: null,
        emisPar: null,
        qr: null,
        lignes: [
          construireLigne({
            id: 'ligne-libre',
            designation: 'Ligne saisie libre',
            ligneOrId: null,
          }),
          construireLigne({
            id: 'ligne-or',
            designation: 'Ligne issue OR',
            ligneOrId: 'or-ligne-9',
            numeroOrdre: 2,
          }),
        ],
        nombreLignes: 2,
      }),
    );
    rendre();

    const ligneLibre = (await screen.findByText('Ligne saisie libre')).closest('tr');
    const ligneOr = (await screen.findByText('Ligne issue OR')).closest('tr');
    if (!ligneLibre || !ligneOr) throw new Error('Lignes de tableau introuvables.');

    expect(
      within(ligneLibre).getByRole('button', { name: /Modifier la ligne/ }),
    ).toBeInTheDocument();
    expect(
      within(ligneLibre).getByRole('button', { name: /Retirer la ligne/ }),
    ).toBeInTheDocument();
    expect(
      within(ligneOr).queryByRole('button', { name: /Modifier la ligne/ }),
    ).not.toBeInTheDocument();
    expect(
      within(ligneOr).queryByRole('button', { name: /Retirer la ligne/ }),
    ).not.toBeInTheDocument();
  });

  it('« Retirer » appelle bien `DELETE .../lignes/{ligneId}` et la ligne disparaît de l’écran', async () => {
    const document_ = construireDocument({
      statut: 'brouillon',
      numero: null,
      numeroSequence: null,
      emisLe: null,
      emisPar: null,
      qr: null,
      lignes: [construireLigne({ id: 'ligne-a-retirer', designation: 'Ligne à retirer' })],
      nombreLignes: 1,
    });
    installerHandlerDocument(document_);

    let appelDelete = false;
    server.use(
      http.delete('/api/v1/documents-vente/facture-1/lignes/ligne-a-retirer', () => {
        appelDelete = true;
        return HttpResponse.json({
          donnees: { ...document_, lignes: [], nombreLignes: 0 },
          avertissements: [],
        });
      }),
    );

    const utilisateur = userEvent.setup();
    rendre();

    const bouton = await screen.findByRole('button', { name: /Retirer la ligne/ });
    await utilisateur.click(bouton);

    await waitFor(() => expect(appelDelete).toBe(true));
    await waitFor(() => expect(screen.queryByText('Ligne à retirer')).not.toBeInTheDocument());
    expect(await screen.findByText('Aucune ligne sur ce document.')).toBeInTheDocument();
  });

  it('un document ÉMIS ne montre ni « Ajouter une ligne » ni bouton modifier/retirer par ligne (verrouillage MD-20/MD-21)', async () => {
    installerHandlerDocument(
      construireDocument({
        statut: 'emis',
        lignes: [construireLigne({ designation: 'Ligne figée' })],
        nombreLignes: 1,
      }),
    );
    rendre();

    await screen.findByText('Ligne figée');
    expect(screen.queryByRole('button', { name: 'Ajouter une ligne' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier la ligne/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retirer la ligne/ })).not.toBeInTheDocument();
  });

  it("le refus d'émission d'un document SANS LIGNE affiche le message serveur précis, jamais le bandeau générique VALIDATION_ECHOUEE", async () => {
    connecterSession('direction');
    installerHandlerDocument(
      construireDocument({
        statut: 'brouillon',
        numero: null,
        numeroSequence: null,
        emisLe: null,
        emisPar: null,
        qr: null,
        lignes: [],
        nombreLignes: 0,
      }),
    );
    server.use(
      http.post('/api/v1/documents-vente/facture-1/emettre', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
            title: 'Validation échouée',
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            instance: 'req-1',
            erreurs: [
              {
                champ: 'lignes',
                code: 'aucune_ligne',
                message:
                  "Ce document n'a aucune ligne : ajoutez au moins une ligne avant de l'émettre.",
              },
            ],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Émettre' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Émettre' }));

    expect(
      await screen.findByText(
        "Ce document n'a aucune ligne : ajoutez au moins une ligne avant de l'émettre.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Certaines informations sont incorrectes ou incomplètes. Corrigez les champs signalés, puis réessayez.',
      ),
    ).not.toBeInTheDocument();
  });
});
