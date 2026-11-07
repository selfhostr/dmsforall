import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ReponseDocumentVente } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SheetEncaissement } from './SheetEncaissement';

/** Même fixture, à la même forme RÉELLE (`ReponseDocumentVente` complet, `figees.clientDesignation`)
 *  que `documents-vente.api.spec.ts` / `EcranListeFactures.spec.tsx` — voir l'ÉCART SIGNALÉ en tête
 *  de `hooks/facturation/documents-vente.api.ts` : `GET /documents-vente` ne rend jamais la
 *  projection étroite `DocumentVenteResume` que le contrat annonce. */
function construireDocumentBrut(
  overrides: Partial<ReponseDocumentVente> = {},
): ReponseDocumentVente {
  return {
    id: 'doc-emis-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: '2026-00010',
    numeroSequence: 10,
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
    dateDocument: '2026-07-01',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 4167,
    totalTvaCentimes: 333,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 4500,
    ventilationTva: [],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 4500,
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
    emisLe: '2026-07-01T09:00:00.000Z',
    emisPar: { utilisateurId: 'u1', nomAffiche: 'Alice' },
    creeLe: '2026-07-01T08:00:00.000Z',
    modifieLe: '2026-07-01T09:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <SheetEncaissement
        ouvert
        onOuvertChange={() => {}}
        siteId="site-1"
        clientId="cl-1"
        destinataireNom="Jean Dupont"
      />
    </QueryClientProvider>,
  );
}

/**
 * Preuve directe du parcours navigateur qui a confirmé le défaut : une facture `annule_par_avoir`
 * (dette éteinte, `RF-32` ne nettoie ni `statutReglement` ni `soldeCentimes` à l'annulation)
 * apparaissait dans CE panneau, cochable, avec un « reste dû » qui n'est plus dû, et pouvait porter
 * le total sélectionné.
 *
 * Le mock ci-dessous applique le filtre `statut` de la même façon que `ServiceDocumentsVente.lister`
 * (`apps/api/src/facturation/documents/service-documents.ts`, lu et vérifié avant d'écrire ce test :
 * `inArray(documentVente.statut, filtres.statut)`) — il REPRODUIT ce comportement, il ne l'EXÉCUTE
 * pas. Ce test prouve donc que LE FRONT (`useFacturesOuvertesClient` → `SheetEncaissement`) exclut
 * bien la facture annulée UNE FOIS que le serveur applique le filtre qu'on lui envoie ; il ne prouve
 * pas que le serveur réel l'applique — cette preuve-là est côté `apps/api`, hors périmètre de cet
 * lot (voir `useFacturesOuvertesClient.spec.tsx` pour le même avertissement, et la description du
 * correctif serveur, hors périmètre, qui doit en plus refuser l'IMPUTATION elle-même sur un document
 * non `emis` — le filtre d'affichage n'est jamais la frontière de sécurité).
 */
describe('SheetEncaissement — facture annulée par avoir', () => {
  it("n'affiche PAS la facture annulée par avoir dans « Factures ouvertes » — ni son numéro, ni son « reste dû », ni de case à cocher pour elle", async () => {
    const factureOuverte = construireDocumentBrut();
    const factureAnnuleeParAvoir = construireDocumentBrut({
      id: 'doc-annule-1',
      numero: '2026-00011',
      statut: 'annule_par_avoir',
      statutReglement: 'partiel',
      soldeCentimes: 6000,
    });

    server.use(
      http.get('/api/v1/documents-vente', ({ request }) => {
        const statuts = new URL(request.url).searchParams.getAll('statut');
        const toutes = [factureOuverte, factureAnnuleeParAvoir];
        const donnees =
          statuts.length > 0 ? toutes.filter((d) => statuts.includes(d.statut)) : toutes;
        return HttpResponse.json({ donnees, curseurSuivant: null, limite: 100 });
      }),
    );

    rendre();

    // La facture encore ouverte est bien là — le panneau n'est pas vide, la requête a répondu.
    expect(await screen.findByText(/2026-00010/)).toBeInTheDocument();

    // La facture annulée par avoir n'apparaît NULLE PART dans le panneau : ni son numéro...
    expect(screen.queryByText(/2026-00011/)).not.toBeInTheDocument();
    // ...ni son reste dû stale de CHF 60.00 (le scénario exact confirmé en navigateur)...
    expect(screen.queryByText(/60\.00/)).not.toBeInTheDocument();
    // ...ni une case à cocher qui la désignerait par son id (preuve précise, pas une recherche par
    // texte qui pourrait accidentellement passer).
    expect(document.getElementById('encaissement-facture-doc-annule-1')).toBeNull();

    // Une seule ligne dans la liste — celle de la facture réellement ouverte.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it(
    'le total sélectionné ne peut porter que le solde de la facture encore ouverte — la facture ' +
      'annulée, absente de la liste, ne peut structurellement plus contribuer à ce total',
    async () => {
      const factureOuverte = construireDocumentBrut();
      const factureAnnuleeParAvoir = construireDocumentBrut({
        id: 'doc-annule-1',
        numero: '2026-00011',
        statut: 'annule_par_avoir',
        statutReglement: 'partiel',
        soldeCentimes: 6000,
      });

      server.use(
        http.get('/api/v1/documents-vente', ({ request }) => {
          const statuts = new URL(request.url).searchParams.getAll('statut');
          const toutes = [factureOuverte, factureAnnuleeParAvoir];
          const donnees =
            statuts.length > 0 ? toutes.filter((d) => statuts.includes(d.statut)) : toutes;
          return HttpResponse.json({ donnees, curseurSuivant: null, limite: 100 });
        }),
      );

      rendre();
      await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(1));

      // Aucune sélection au départ (pas de facture précochée pour ce point d'entrée) : le total
      // affiché est déjà 0.00 partout (aucune devise résolue tant que rien n'est coché, voir
      // `deviseSelectionCommune`) — et surtout, jamais un montant qui inclurait les CHF 60.00 de la
      // facture éteinte : elle est absente de la liste, donc structurellement exclue de la somme
      // (`totalSelectionneCentimes = factures.filter(f => selection.has(f.id)).reduce(...)`).
      expect(screen.getAllByText('0.00')).toHaveLength(2); // « Total sélectionné » + « Reste à encaisser »
      expect(screen.queryByText(/60\.00/)).not.toBeInTheDocument();
    },
  );
});

/** Réponse `POST /paiements` minimale mais valide (`ReponsePaiement`), pour les deux tests
 *  ci-dessous — seuls les champs lus par `useEncaissement`/le panneau (`imputations`,
 *  `montantCentimes` n'est PAS relu, la confirmation affichée vient du calcul local) importent. */
function reponsePaiementBrute() {
  return {
    donnees: {
      id: 'paiement-1',
      siteId: 'site-1',
      dateValeur: '2026-08-11',
      moyen: 'especes',
      montantCentimes: 4500,
      devise: 'CHF',
      payeurClientId: 'cl-1',
      payeurLibelle: 'Jean Dupont',
      referenceQr: null,
      identifiantTransactionBanque: null,
      source: 'manuel',
      contrePasseId: null,
      imputations: [
        {
          id: 'imp-1',
          paiementId: 'paiement-1',
          documentId: 'doc-emis-1',
          montantCentimes: 4500,
          nature: 'reglement',
          imputeLe: '2026-08-11T00:00:00.000Z',
          imputePar: null,
        },
      ],
      montantNonImputeCentimes: 0,
      issuesDisponibles: [],
      creeLe: '2026-08-11T00:00:00.000Z',
      creePar: null,
    },
    avertissements: [],
  };
}

/**
 * Reproduit le défaut d'argent le plus grave remonté par le testeur novice (facture Meier Urs,
 * 60 CHF, « L'opération n'a pas abouti. Réessayez ; si cela revient, prévenez le support. » puis, au rejeu, « Le montant
 * imputé dépasse le reste à payer. ») — CAUSE RACINE PROUVÉE en exécution réelle (`POST
 * /paiements` sur l'API tournante, deux clés distinctes, même corps) : le premier appel réussit
 * réellement côté serveur (`201`, facture soldée), le second — portant une NOUVELLE clé
 * d'idempotence générée à chaque clic — est un encaissement DISTINCT que le serveur refuse à bon
 * droit (`409`, solde déjà nul). Le défaut n'est donc pas le refus du second appel : c'est que le
 * rejeu n'était jamais reconnu comme un rejeu.
 */
describe('SheetEncaissement — encaissement (idempotence du rejeu, confirmation de succès)', () => {
  it(
    'porte la MÊME Idempotency-Key sur un rejeu après échec, contenu inchangé — DÉFAUT CORRIGÉ : ' +
      'avant ce correctif, `soumettre()` appelait `genererCleIdempotence()` À CHAQUE CLIC, donc ' +
      'un simple rejeu envoyait un encaissement structurellement DISTINCT aux yeux du serveur',
    async () => {
      const facture = construireDocumentBrut({ soldeCentimes: 4500 });
      server.use(
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({ donnees: [facture], curseurSuivant: null, limite: 100 }),
        ),
      );

      const clesRecues: (string | null)[] = [];
      let appel = 0;
      server.use(
        http.post('/api/v1/paiements', ({ request }) => {
          appel += 1;
          clesRecues.push(request.headers.get('Idempotency-Key'));
          if (appel === 1) {
            return HttpResponse.json(
              {
                type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
                title: 'Erreur interne',
                status: 500,
                code: 'ERREUR_INTERNE',
                instance: '',
              },
              { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
            );
          }
          return HttpResponse.json(reponsePaiementBrute(), { status: 201 });
        }),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await utilisateur.click(await screen.findByRole('checkbox'));
      await utilisateur.click(screen.getByRole('button', { name: 'Ajouter un moyen de paiement' }));
      await utilisateur.click(screen.getByRole('button', { name: "Enregistrer l'encaissement" }));

      // Premier essai : le message d'erreur générique apparaît, la clé a été prise par le serveur
      // (visible dans `clesRecues`, capturée par le handler MSW ci-dessus).
      await waitFor(() => expect(clesRecues).toHaveLength(1));
      expect(clesRecues[0]).toMatch(/^[0-9a-f-]{36}$/i);

      // Rejeu SANS rien modifier (le geste exact du testeur) : DOIT porter la MÊME clé.
      await utilisateur.click(screen.getByRole('button', { name: "Enregistrer l'encaissement" }));
      await waitFor(() => expect(clesRecues).toHaveLength(2));
      expect(clesRecues[1]).toEqual(clesRecues[0]);
    },
  );

  it(
    'confirme explicitement le succès (montant + badge « Réglée ») plutôt que de fermer le ' +
      'panneau en silence — item 3 du correctif : un succès et un échec ne doivent jamais se ' +
      "ressembler à l'écran",
    async () => {
      const facture = construireDocumentBrut({ soldeCentimes: 4500 });
      server.use(
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({ donnees: [facture], curseurSuivant: null, limite: 100 }),
        ),
        http.post('/api/v1/paiements', () =>
          HttpResponse.json(reponsePaiementBrute(), { status: 201 }),
        ),
      );

      const utilisateur = userEvent.setup();
      rendre();

      await utilisateur.click(await screen.findByRole('checkbox'));
      await utilisateur.click(screen.getByRole('button', { name: 'Ajouter un moyen de paiement' }));
      await utilisateur.click(screen.getByRole('button', { name: "Enregistrer l'encaissement" }));

      // `findByText` (async) attend la confirmation elle-même — le montant « CHF 45.00 » seul
      // apparaîtrait prématurément (déjà visible dans le formulaire, sous « Total sélectionné »,
      // AVANT même l'envoi), d'où l'attente portée sur le badge « Réglée » qui, lui, n'existe que
      // dans la confirmation.
      expect(await screen.findByText('Réglée')).toBeInTheDocument();
      expect(screen.getAllByText('CHF 45.00').length).toBeGreaterThan(0);
      // Le formulaire de saisie a disparu — remplacé par la confirmation, jamais superposé.
      expect(
        screen.queryByRole('button', { name: "Enregistrer l'encaissement" }),
      ).not.toBeInTheDocument();
    },
  );
});

/**
 * DÉFAUT CORRIGÉ (issues #80/#61, testeur novice — « je n'ai pas osé aller plus loin : j'allais
 * enregistrer de l'argent en avance sur le compte d'un client qui a déjà payé ») : quand ce
 * panneau s'ouvrait sur un client sans aucune facture ouverte, il affichait déjà le message
 * « aucune facture ouverte » MAIS laissait la section de saisie et le bouton d'enregistrement
 * pleinement actifs juste en dessous — un encaissement pouvait devenir une avance client comme
 * simple EFFET DE BORD, sans qu'aucun geste explicite ne l'ait choisi.
 */
describe('SheetEncaissement — aucune facture ouverte (avance client, geste explicite)', () => {
  it(
    'verrouille la saisie tant que l’avance n’est pas confirmée explicitement : ni le bouton ' +
      '« Ajouter un moyen de paiement », ni « Enregistrer l’encaissement » ne sont proposés avant ' +
      'le clic sur « Enregistrer quand même comme avance client »',
    async () => {
      server.use(
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 100 }),
        ),
      );

      const utilisateur = userEvent.setup();
      rendre();

      expect(
        await screen.findByText("Ce client n'a aucune facture ouverte à régler."),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Ajouter un moyen de paiement' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: "Enregistrer l'encaissement" }),
      ).not.toBeInTheDocument();

      const boutonConfirmer = screen.getByRole('button', {
        name: 'Enregistrer quand même comme avance client',
      });
      await utilisateur.click(boutonConfirmer);

      // Une fois le geste choisi explicitement, la saisie se révèle — jamais avant.
      expect(
        await screen.findByRole('button', { name: 'Ajouter un moyen de paiement' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: "Enregistrer l'encaissement" }),
      ).toBeInTheDocument();
    },
  );
});

/**
 * DÉFAUT CORRIGÉ (issue #135) : « CHF » était un texte fixe, et le paiement envoyé au serveur
 * était codé en dur `devise: 'CHF'` — une facture EUR sélectionnée envoyait donc TOUJOURS un
 * paiement CHF, refusé (`409 IMPUTATION_DEVISE_INCOHERENTE`) sans qu'aucun signal ne l'ait
 * annoncé. Décision : pas de sélecteur de devise (le produit ne fait pas de change, `MD-50`) —
 * le paiement suit désormais TOUJOURS la devise de la facture réglée.
 */
describe('SheetEncaissement — devise du paiement suit la facture réglée (issue #135)', () => {
  it('une facture EUR sélectionnée envoie un paiement en EUR, jamais CHF codé en dur', async () => {
    const factureEur = construireDocumentBrut({
      id: 'doc-eur-1',
      numero: '2026-00020',
      devise: 'EUR',
      soldeCentimes: 4500,
    });
    server.use(
      http.get('/api/v1/documents-vente', () =>
        HttpResponse.json({ donnees: [factureEur], curseurSuivant: null, limite: 100 }),
      ),
    );

    const corpsRecus: unknown[] = [];
    server.use(
      http.post('/api/v1/paiements', async ({ request }) => {
        corpsRecus.push(await request.json());
        return HttpResponse.json(reponsePaiementBrute(), { status: 201 });
      }),
    );

    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('checkbox'));
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter un moyen de paiement' }));
    await utilisateur.click(screen.getByRole('button', { name: "Enregistrer l'encaissement" }));

    await waitFor(() => expect(corpsRecus).toHaveLength(1));
    expect((corpsRecus[0] as { devise: string }).devise).toBe('EUR');
  });

  it(
    'une sélection mixte CHF/EUR verrouille la saisie et affiche un message explicite, ' +
      'plutôt que de laisser partir un paiement dans une devise devinée',
    async () => {
      const factureChf = construireDocumentBrut({ id: 'doc-chf-1', numero: '2026-00021' });
      const factureEur = construireDocumentBrut({
        id: 'doc-eur-1',
        numero: '2026-00022',
        devise: 'EUR',
        soldeCentimes: 3000,
      });
      server.use(
        http.get('/api/v1/documents-vente', () =>
          HttpResponse.json({
            donnees: [factureChf, factureEur],
            curseurSuivant: null,
            limite: 100,
          }),
        ),
      );

      const utilisateur = userEvent.setup();
      rendre();

      const cases = await screen.findAllByRole('checkbox');
      expect(cases).toHaveLength(2);
      const case0 = cases[0];
      const case1 = cases[1];
      expect(case0).toBeDefined();
      expect(case1).toBeDefined();
      if (case0 && case1) {
        await utilisateur.click(case0);
        await utilisateur.click(case1);

        expect(
          await screen.findByText(
            "Ces factures sont dans des devises différentes. Décochez-en pour ne garder que des factures dans la même devise avant d'encaisser.",
          ),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Ajouter un moyen de paiement' }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: "Enregistrer l'encaissement" }),
        ).not.toBeInTheDocument();

        // Décocher la facture EUR ramène la sélection à une seule devise : la saisie se débloque
        // sans qu'aucun autre geste n'ait été nécessaire.
        await utilisateur.click(case1);
      }
      expect(
        await screen.findByRole('button', { name: 'Ajouter un moyen de paiement' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/devises différentes/)).not.toBeInTheDocument();
    },
  );
});
