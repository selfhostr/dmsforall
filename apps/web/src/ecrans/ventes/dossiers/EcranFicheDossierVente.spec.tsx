import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  DocumentVenteResume,
  ReponseDocumentVente,
  ReponseDossierVente,
  ReponseReprise,
  VehiculeResume,
} from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFicheDossierVente } from './EcranFicheDossierVente';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CLIENT_ACHETEUR = {
  id: 'client-1',
  numeroClient: 'CL-0001',
  nomAffiche: 'Jean Dupont',
  type: 'particulier' as const,
  statut: 'actif' as const,
  langueCorrespondance: 'fr' as const,
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 0,
  dernierPassageLe: null,
};

const DOSSIER: ReponseDossierVente = {
  id: 'dossier-1',
  siteId: 'site-1',
  statut: 'prospection',
  typeVehicule: null,
  vehicule: null,
  clientAcheteur: CLIENT_ACHETEUR,
  clientFacture: CLIENT_ACHETEUR,
  clientConducteur: null,
  reprise: null,
  financement: null,
  financements: [],
  financementsTronques: false,
  documents: [],
  documentsTronques: false,
  documentsRequis: [],
  identitePieceType: null,
  identiteVerifieeLe: null,
  dateLivraisonEstimee: null,
  dateLivraisonEffective: null,
  kilometrageDepart: null,
  prospectionLe: '2026-08-01T08:00:00.000Z',
  engageLe: null,
  enPreparationLe: null,
  pretALivrerLe: null,
  livreLe: null,
  closLe: null,
  annuleLe: null,
  abandonneLe: null,
  motifCloture: null,
  actionsDisponibles: ['modifier', 'engager', 'annuler', 'abandonner'],
  version: 1,
  creeLe: '2026-08-01T08:00:00.000Z',
  modifieLe: '2026-08-01T08:00:00.000Z',
  modifiePar: null,
};

/** Fixture minimale mais complète (tous les champs non-optionnels de `ReponseDocumentVente`) — le
 *  document renvoyé par `POST /documents-vente` lors du rattachement d'un bon de commande (RV-37,
 *  voir `useCreerBonCommandeDossier`). Champs financiers volontairement absents (comme un
 *  brouillon fraîchement créé, `MD-19`) plutôt qu'à `0`. */
function construireBonCommande(): ReponseDocumentVente {
  return {
    id: 'doc-bc-1',
    typeDocument: 'bon_commande',
    natureFacture: null,
    origine: 'dfa',
    numero: null,
    numeroSequence: null,
    numeroOrigine: null,
    exercice: null,
    statut: 'brouillon',
    siteId: 'site-1',
    clientId: 'client-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: 'dossier-1',
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Jean Dupont',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      plaque: null,
    },
    dateDocument: '2026-08-04',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
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
    nombreLignes: 0,
    lignesTronquees: false,
    version: 1,
    emisLe: null,
    emisPar: null,
    creeLe: '2026-08-04T09:00:00.000Z',
    modifieLe: '2026-08-04T09:00:00.000Z',
    modifiePar: null,
  };
}

/** Jumeau de `construireBonCommande` pour #124 — même fixture, `typeDocument: 'facture'` et un
 *  `id` distinct pour ne pas confondre les deux dans les assertions de lien. */
function construireFacture(): ReponseDocumentVente {
  return { ...construireBonCommande(), id: 'doc-facture-1', typeDocument: 'facture' };
}

function projeterResumeDocument(document: ReponseDocumentVente): DocumentVenteResume {
  return {
    id: document.id,
    typeDocument: document.typeDocument,
    natureFacture: document.natureFacture,
    numero: document.numero,
    statut: document.statut,
    clientId: document.clientId,
    clientDesignation: document.figees.clientDesignation,
    dateDocument: document.dateDocument,
    devise: document.devise,
  };
}

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'vendeur') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/dossiers/dossier-1']}>
        <Routes>
          <Route path="/ventes/dossiers/:id" element={<EcranFicheDossierVente />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFicheDossierVente', () => {
  it('affiche la fiche avec le client, le statut et les actions de transition', async () => {
    server.use(http.get('/api/v1/dossiers-vente/dossier-1', () => HttpResponse.json(DOSSIER)));

    rendre();

    // Lot C (`docs/plan-refonte-navigation.md`) — le fil d'Ariane de `EnTeteDossierVente` répète
    // désormais le nom du client acheteur en plus du bloc identité : deux occurrences légitimes,
    // même idiome que `getAllByText('Prospection')` juste en dessous.
    expect((await screen.findAllByText('Jean Dupont')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Prospection').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Engager' })).toBeInTheDocument();
    // `CarteReprise`/`CarteFinancement` (branchées ici, plus les anciennes `*Resume` en lecture
    // seule — voir l'en-tête de `EcranFicheDossierVente.tsx`) : un dossier `prospection` sans
    // reprise ni financement affiche l'état vide INTERACTIF de chacune, pas un simple texte —
    // « vendeur » (rôle par défaut de `rendre()`) a le droit d'en créer une des deux.
    expect(screen.getByText('Pas de reprise sur ce dossier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter une reprise' })).toBeInTheDocument();
    expect(screen.getByText('Aucune tentative de financement enregistrée.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proposer un financement' })).toBeInTheDocument();
  });

  // RÈGLE DURE (masquage par rôle, voir le brief de branchement) : un rôle qui lit le dossier de
  // vente (`chef_atelier` ∈ `ROLES_LECTURE_DOSSIER_VENTE`, `ecrans/ventes/dossiers/droits.ts`) mais
  // n'a AUCUN droit `ventes.reprise.*`/`ventes.financement.*` (`chef_atelier` absent des deux
  // matrices dédiées, `ecrans/ventes/{reprises,financements}/droits.ts`) ne doit voir NI la carte
  // reprise NI la carte financement — pas une carte vide grisée, rien du tout :
  // `CarteReprise`/`CarteFinancement` retournent `null` avant même d'émettre une requête.
  it('un rôle sans droit sur reprise/financement (chef_atelier) : le dossier reste visible, ces deux cartes disparaissent', async () => {
    server.use(http.get('/api/v1/dossiers-vente/dossier-1', () => HttpResponse.json(DOSSIER)));

    rendre('chef_atelier');

    expect((await screen.findAllByText('Jean Dupont')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Pas de reprise sur ce dossier')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une reprise' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Aucune tentative de financement enregistrée.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Proposer un financement' }),
    ).not.toBeInTheDocument();
  });

  // Parcours complet demandé par l'audit de branchement : depuis la fiche du dossier (pas un
  // écran tiers non routé), saisir une reprise, la voir apparaître sur CETTE fiche. `onCree` ->
  // `onMutationReussie` -> `requete.refetch()` (voir `EcranFicheDossierVente.tsx`) recharge le
  // dossier PRIMAIRE, dont `dossier.reprise` embarqué passe de `null` à non-`null` : c'est cette
  // bascule que ce test exerce, pas seulement le POST isolé (déjà couvert par
  // `CarteReprise.spec.tsx`).
  it('parcours reprise : créer une reprise depuis la fiche du dossier la fait apparaître sur cette même fiche', async () => {
    const PLAQUE_VEHICULE_REPRIS = '987654';
    const VEHICULE_REPRIS: VehiculeResume = {
      id: '22222222-2222-4222-8222-222222222222',
      plaque: PLAQUE_VEHICULE_REPRIS,
      canton: 'GE',
      designation: 'Audi A4 2.0 TDI',
      vin: 'WAUZZZ8K9BA123456',
      premiereMiseEnCirculationLe: '2019-06-01',
      identificationIncomplete: false,
      emplacementLibre: null,
    };
    const REPRISE_CREEE: ReponseReprise = {
      id: 'reprise-1',
      dossierVenteId: 'dossier-1',
      vehiculeRepris: VEHICULE_REPRIS,
      statut: 'estimee',
      valeurEstimeeCentimes: 800_000,
      valeurNegocieeCentimes: null,
      ecartRepriseVehiculeCentimes: null,
      detteFinancementResiduelleCentimes: null,
      detteFinancementOrganismeId: null,
      detteFinancementOrganismeNom: null,
      estimeeLe: '2026-08-06T09:00:00.000Z',
      negocieeLe: null,
      confirmeeLe: null,
      refuseeLe: null,
      motifRefus: null,
      actionsDisponibles: ['negocier', 'refuser'],
      version: 1,
      creeLe: '2026-08-06T09:00:00.000Z',
      modifieLe: '2026-08-06T09:00:00.000Z',
      modifiePar: null,
    };

    let dossierPossedeReprise = false;

    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
        HttpResponse.json({
          ...DOSSIER,
          reprise: dossierPossedeReprise
            ? {
                id: REPRISE_CREEE.id,
                vehiculeRepris: REPRISE_CREEE.vehiculeRepris,
                statut: REPRISE_CREEE.statut,
                valeurEstimeeCentimes: REPRISE_CREEE.valeurEstimeeCentimes,
                valeurNegocieeCentimes: REPRISE_CREEE.valeurNegocieeCentimes,
                ecartRepriseVehiculeCentimes: REPRISE_CREEE.ecartRepriseVehiculeCentimes,
              }
            : null,
        }),
      ),
      http.get('/api/v1/vehicules', () =>
        HttpResponse.json({ donnees: [VEHICULE_REPRIS], curseurSuivant: null, limite: 50 }),
      ),
      http.get('/api/v1/dossiers-vente/dossier-1/reprise', () => HttpResponse.json(REPRISE_CREEE)),
      http.post('/api/v1/dossiers-vente/dossier-1/reprise', () => {
        dossierPossedeReprise = true;
        return HttpResponse.json({ donnees: REPRISE_CREEE, avertissements: [] });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Ajouter une reprise' }));
    await utilisateur.type(screen.getByLabelText(/Véhicule repris/), PLAQUE_VEHICULE_REPRIS);
    await utilisateur.click(await screen.findByRole('radio'));
    await utilisateur.type(screen.getByLabelText(/Valeur estimée/), '8000');
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter la reprise' }));

    // Le dossier PRIMAIRE a été rechargé : `dossier.reprise` n'est plus `null`, `CarteReprise`
    // bascule de son état vide à sa fiche complète (nouvelle requête `GET .../reprise`).
    await waitFor(() =>
      expect(screen.queryByText('Pas de reprise sur ce dossier')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Audi A4 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('Estimée')).toBeInTheDocument();
  });

  // Même préoccupation côté financement — `comptant` évite la recherche d'organisme (hors sujet
  // ici) et se confirme immédiatement côté serveur.
  it('parcours financement : proposer un financement comptant depuis la fiche du dossier le fait apparaître sur cette même fiche', async () => {
    let dossierAvecFinancement = false;
    const FINANCEMENT_CREE = {
      id: 'financement-1',
      type: 'comptant' as const,
      organisme: null,
      statutConfirmation: 'confirme' as const,
    };

    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
        HttpResponse.json({
          ...DOSSIER,
          financement: dossierAvecFinancement ? FINANCEMENT_CREE : null,
          financements: dossierAvecFinancement ? [FINANCEMENT_CREE] : [],
        }),
      ),
      http.post('/api/v1/dossiers-vente/dossier-1/financements', () => {
        dossierAvecFinancement = true;
        return HttpResponse.json({
          donnees: {
            ...FINANCEMENT_CREE,
            dossierVenteId: 'dossier-1',
            referenceContrat: null,
            confirmeLe: '2026-08-06T09:00:00.000Z',
            refuseLe: null,
            motifRefus: null,
            actionsDisponibles: [],
            version: 1,
            creeLe: '2026-08-06T09:00:00.000Z',
            modifieLe: '2026-08-06T09:00:00.000Z',
          },
          avertissements: [],
        });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Proposer un financement' }));
    await utilisateur.click(await screen.findByRole('button', { name: 'Proposer' }));

    await waitFor(() =>
      expect(
        screen.queryByText('Aucune tentative de financement enregistrée.'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText('Comptant').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Confirmé').length).toBeGreaterThan(0);
  });

  // Non-régression du bug mesuré en navigateur : un bon de commande `brouillon` jamais rempli
  // (`totalTtcCentimes: 0`, la somme d'aucune ligne) ne doit plus jamais s'afficher comme un prix
  // engagé « 0.00 » — indiscernable d'un vrai montant nul. Voir `utils.ts::selectionnerPrixDossierVente`.
  it("dossier avec un bon de commande brouillon vide : l'en-tête n'affiche aucun montant, jamais « 0.00 »", async () => {
    const BON_COMMANDE_BROUILLON_VIDE: DocumentVenteResume = {
      id: 'bc-vide-1',
      typeDocument: 'bon_commande',
      natureFacture: null,
      numero: null,
      statut: 'brouillon',
      clientId: 'client-1',
      clientDesignation: 'Jean Dupont',
      dateDocument: '2026-08-04',
      devise: 'CHF',
      totalTtcCentimes: 0,
    };

    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
        HttpResponse.json({ ...DOSSIER, documents: [BON_COMMANDE_BROUILLON_VIDE] }),
      ),
    );

    rendre();

    // Portée volontairement restreinte au bloc « Prix » de l'EN-TÊTE (`<dl>` qui porte le `<dt>`
    // « Prix ») : `CarteDocumentsVente` plus bas affiche elle aussi « 0.00 » pour ce même document
    // brouillon, LÉGITIMEMENT — chaque ligne de sa table porte son propre type/statut en regard, le
    // contexte lève l'ambiguïté que l'en-tête, lui, ne doit jamais introduire (§7.1, prix DÉRIVÉ,
    // seul résumé que le vendeur lit d'un coup d'œil).
    const dtPrix = await screen.findByText('Prix');
    const blocPrix = dtPrix.closest('dl');
    if (!blocPrix) throw new Error('Bloc <dl> du prix introuvable dans l’en-tête.');

    expect(within(blocPrix).getByText('Prix non défini')).toBeInTheDocument();
    expect(within(blocPrix).queryByText('0.00')).not.toBeInTheDocument();
    expect(within(blocPrix).queryByText(/0[.,]00/)).not.toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
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

    rendre();

    expect(await screen.findByText("Impossible d'afficher ce dossier")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  // Non-régression RV-37 : jusqu'ici `document_vente.dossier_vente_id` n'était jamais écrit depuis
  // le front, donc `dossier.documents.filter(d => d.typeDocument === 'bon_commande')` restait
  // TOUJOURS vide et `engager` (qui exige `bonCommandeDocumentId`) était inatteignable. Ce test
  // exerce le chemin de bout en bout : dialogue « Engager » ouvert sur un dossier SANS document ->
  // clic « Créer le bon de commande » -> `POST /documents-vente` porte `dossierVenteId` -> le
  // dossier refetché fait apparaître le bon de commande, le sélecteur cesse d'être vide.
  it('un dossier sans document : « Créer le bon de commande » le rattache et fait sortir le sélecteur de son état vide', async () => {
    let documentsDossier: readonly DocumentVenteResume[] = [];
    let corpsRecu: Record<string, unknown> | undefined;

    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
        HttpResponse.json({ ...DOSSIER, documents: documentsDossier }),
      ),
      http.post('/api/v1/documents-vente', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        const document = construireBonCommande();
        documentsDossier = [projeterResumeDocument(document)];
        return HttpResponse.json({ donnees: document, avertissements: [] });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Engager' }));
    expect(screen.getByText('Aucun bon de commande sur ce dossier')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Créer le bon de commande' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      typeDocument: 'bon_commande',
      dossierVenteId: 'dossier-1',
      siteId: 'site-1',
      clientId: 'client-1',
    });

    // Le dossier refetché (invalidation post-création) porte désormais le bon de commande : le
    // message d'état vide disparaît au profit du sélecteur.
    await waitFor(() =>
      expect(screen.queryByText('Aucun bon de commande sur ce dossier')).not.toBeInTheDocument(),
    );
    const selecteur = screen.getByRole('combobox', { name: 'Bon de commande' });
    expect(selecteur).toBeInTheDocument();

    // Non-régression #128 : le document créé est un `brouillon` sans `numero` — l'option ne doit
    // JAMAIS afficher `document.id` (`doc-bc-1`) en clair, mais un libellé traduit (statut + date).
    await utilisateur.click(selecteur);
    expect(await screen.findByRole('option', { name: /Brouillon/ })).toBeInTheDocument();
    expect(screen.queryByText('doc-bc-1')).not.toBeInTheDocument();
  });

  // #124 : le parcours de vente était une impasse — `livrer` (RV-37) exige côté serveur une
  // facture ÉMISE, mais aucun écran ne permettait d'en créer une depuis le dossier. Même chemin de
  // bout en bout que le test « bon de commande » ci-dessus, appliqué au dialogue `livrer` : bouton
  // « Créer la facture » -> `POST /documents-vente` porte `dossierVenteId` -> un lien vers
  // `/factures/{id}` apparaît pour que le vendeur poursuive (lignes, émission — hors périmètre).
  it('un dossier prêt à livrer sans facture : « Créer la facture » la rattache et affiche un lien vers /factures/{id}', async () => {
    let documentsDossier: readonly DocumentVenteResume[] = [];
    let corpsRecu: Record<string, unknown> | undefined;

    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
        HttpResponse.json({
          ...DOSSIER,
          statut: 'pret_a_livrer',
          actionsDisponibles: ['livrer'],
          documents: documentsDossier,
        }),
      ),
      http.post('/api/v1/documents-vente', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        const document = construireFacture();
        documentsDossier = [projeterResumeDocument(document)];
        return HttpResponse.json({ donnees: document, avertissements: [] });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Livrer' }));
    expect(screen.getByText('Aucune facture sur ce dossier')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Créer la facture' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      typeDocument: 'facture',
      dossierVenteId: 'dossier-1',
      siteId: 'site-1',
      clientId: 'client-1',
    });

    // Le lien apparaît immédiatement (via `factureCreeeId`, pas d'attente du refetch) et pointe
    // vers l'écran facturation où le vendeur ajoute les lignes et émet le document.
    const lien = await screen.findByRole('link', { name: 'Voir la facture' });
    expect(lien).toHaveAttribute('href', '/factures/doc-facture-1');
    expect(screen.queryByText('Aucune facture sur ce dossier')).not.toBeInTheDocument();
  });

  // Non-régression : le refus serveur documenté (dossier clos/annulé/abandonné, RV-37) s'affiche
  // avec un message actionnable — pas un échec silencieux ni un `ERREUR_INTERNE` générique.
  it('rattachement refusé par le serveur (409) : message explicite, pas un échec silencieux', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () => HttpResponse.json(DOSSIER)),
      http.post('/api/v1/documents-vente', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE',
            title: 'Rattachement au dossier de vente refusé',
            status: 409,
            code: 'DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE',
            instance: 'req-1',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Engager' }));
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le bon de commande' }));

    expect(
      await screen.findByText(
        'Ce dossier de vente est clos, annulé ou abandonné. Aucun document ne peut lui être rattaché.',
      ),
    ).toBeInTheDocument();
  });
});
