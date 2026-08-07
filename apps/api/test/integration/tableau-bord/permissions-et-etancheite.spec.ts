/**
 * Tableau de bord — séparation des pouvoirs (RF-115) et étanchéité inter-tenant, sur vraie
 * Postgres éphémère (testcontainers) et vraie app NestJS (`creerAppTest`), par les VRAIS
 * contrôleurs HTTP — jamais un appel direct au service, exactement le patron déjà en place pour
 * `test/lot1/facturation/emission-document.spec.ts` et `test/lot2/pneus/hangar-pneus.spec.ts`.
 *
 * PRIORITÉ N°1 de ce module (brief de la tâche) : `GET /tableau-bord/financier` expose le chiffre
 * d'affaires CONSOLIDÉ du garage — `admin` en est EXCLU (RF-115, rôle technique, séparation des
 * pouvoirs), alors qu'il détient par ailleurs `tableau_bord.activite.lire`. Le pire contournement
 * imaginable pour ce module serait qu'un champ financier fuite malgré tout par
 * `GET /tableau-bord/activite` (ouvert à `admin` et à 7 autres rôles) : la section 3 ci-dessous le
 * vérifie explicitement, par la forme ET par le contenu de la réponse.
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md). `apps/api/src/tableau-bord/**`
 * n'est ni lu comme source de vérité du comportement attendu au-delà de ce qui est nécessaire à
 * construire des fixtures valides, ni modifié ici.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoleUtilisateur } from '@dfa/shared';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import {
  semerGarageDemoLot1,
  creerOrPourTest,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import {
  construireCookiePour,
  creerFactureEmisePourTest,
  creerPaiementPourTest,
  creerPosteAtelierPourTest,
  getActivite,
  getFinancier,
  PRIMITIVE_HT,
  PRIMITIVE_TTC,
  PRIMITIVE_TVA,
} from './fixtures-tableau-bord';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let cookiePour: ReturnType<typeof construireCookiePour>;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

const ROLES_FINANCIER_AUTORISES: readonly RoleUtilisateur[] = ['direction', 'comptable'];
const ROLES_FINANCIER_REFUSES: readonly RoleUtilisateur[] = [
  'admin', // RF-115, littéral : la séparation des pouvoirs que ce test existe pour prouver.
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
];
const ROLES_ACTIVITE_AUTORISES: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
];

// =================================================================================================
// 1. GET /tableau-bord/financier — direction/comptable SEULS (RF-115, admin exclu)
// =================================================================================================

describe('GET /tableau-bord/financier — réservé à direction/comptable (RF-115)', () => {
  it.each(ROLES_FINANCIER_AUTORISES)('%s est autorisé (200)', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await getFinancier(ctx, cookie);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    expect(reponse.body.chiffreAffaires).toBeDefined();
  });

  it.each(ROLES_FINANCIER_REFUSES)(
    '%s est refusé (403 DROIT_INSUFFISANT), y compris admin',
    async (role) => {
      const cookie = await cookiePour(garage.tenantA, role);
      const reponse = await getFinancier(ctx, cookie);
      expect(reponse.status, `role=${role} : ${JSON.stringify(reponse.body)}`).toBe(403);
      expect(reponse.body.code).toBe('DROIT_INSUFFISANT');
    },
  );

  it('le compte de service poste_atelier est refusé (403) — aucun droit financier, par construction', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const poste = await creerPosteAtelierPourTest(bdd, garage.tenantA.tenant.id, site, 'financier');
    const cookie = await cookieDeSessionPour(ctx, poste.email, poste.motDePasseClair);

    const reponse = await getFinancier(ctx, cookie);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(403);
    expect(reponse.body.code).toBe('DROIT_INSUFFISANT');
  });

  it('sans session (401), avant tout accès base', async () => {
    const reponse = await ctx.requete.get('/api/v1/tableau-bord/financier');
    expect(reponse.status).toBe(401);
  });
});

// =================================================================================================
// 2. GET /tableau-bord/activite — les 8 rôles de PERSONNE (admin INCLUS), poste_atelier SEUL exclu
// =================================================================================================

describe('GET /tableau-bord/activite — ouvert aux 8 rôles de personne, poste_atelier exclu', () => {
  it.each(ROLES_ACTIVITE_AUTORISES)('%s est autorisé (200), y compris admin', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await getActivite(ctx, cookie);
    expect(reponse.status, `role=${role} : ${JSON.stringify(reponse.body)}`).toBe(200);
    expect(reponse.body.ordresReparationParStatut).toBeDefined();
  });

  it('le compte de service poste_atelier est refusé (403) — écran mural, aucune utilité à son rôle', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const poste = await creerPosteAtelierPourTest(bdd, garage.tenantA.tenant.id, site, 'activite');
    const cookie = await cookieDeSessionPour(ctx, poste.email, poste.motDePasseClair);

    const reponse = await getActivite(ctx, cookie);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(403);
    expect(reponse.body.code).toBe('DROIT_INSUFFISANT');
  });

  it('sans session (401), avant tout accès base', async () => {
    const reponse = await ctx.requete.get('/api/v1/tableau-bord/activite');
    expect(reponse.status).toBe(401);
  });
});

// =================================================================================================
// 3. AUCUN MONTANT ne transite par /activite — le contournement qui rendrait RF-115 illusoire.
//    Preuve par la FORME (l'ensemble exact des clés de la réponse, récursivement) ET par le
//    CONTENU (les valeurs financières exactes semées ci-dessous n'apparaissent nulle part dans le
//    JSON brut de /activite).
// =================================================================================================

describe('GET /tableau-bord/activite ne rend AUCUN montant, ni par un champ ni par le contenu', () => {
  it('avec des données financières réelles en base (facture émise, valeurs connues), la réponse activite ne porte que les clés documentées', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const client = garage.tenantA.clients[0]!.id;
    const facture = await creerFactureEmisePourTest(
      ctx,
      garage.tenantA,
      'receptionnaire',
      cookiePour,
      {
        siteId: site,
        clientId: client,
        dateDocument: new Date().toISOString().slice(0, 10),
        nombreLignesPrimitives: 1,
      },
    );
    // Contrôle positif : la donnée financière existe bien quelque part (le tableau financier la
    // voit), sans quoi l'absence de fuite ci-dessous ne prouverait rien (il n'y aurait simplement
    // rien à fuir).
    const cookieDirection = await cookiePour(garage.tenantA, 'direction');
    const financier = await getFinancier(ctx, cookieDirection);
    expect(financier.status, JSON.stringify(financier.body)).toBe(200);
    expect(financier.body.chiffreAffaires.totalTtcCentimes).toBeGreaterThanOrEqual(PRIMITIVE_TTC);

    const cookieAdmin = await cookiePour(garage.tenantA, 'admin');
    const activite = await getActivite(ctx, cookieAdmin);
    expect(activite.status, JSON.stringify(activite.body)).toBe(200);
    const corps = activite.body as Record<string, unknown>;

    // Ensemble EXACT des clés de premier niveau — documenté par ReponseActiviteTableauBordDto.
    // Une clé en trop (ex. un champ financier ajouté par erreur) fait rougir cette assertion,
    // pas seulement un `expect(...).not.toHaveProperty(...)` qui ne couvrirait qu'un nom deviné.
    expect(Object.keys(corps).sort()).toEqual(
      [
        'articlesSousSeuilReapprovisionnement',
        'delaiMoyenRestitutionMinutes',
        'lignesEnAttenteValidation',
        'ordresReparationOuvertsPeriode',
        'ordresReparationParStatut',
        'ordresReparationRestituesPeriode',
        'periode',
        'siteId',
      ].sort(),
    );
    expect(Object.keys(corps.periode as object).sort()).toEqual(['au', 'du']);
    for (const ligne of corps.ordresReparationParStatut as readonly Record<string, unknown>[]) {
      expect(Object.keys(ligne).sort()).toEqual(['nombre', 'statut']);
    }

    // Aucune clé, à AUCUNE profondeur, ne ressemble à un montant.
    const motsInterdits = /centime|montant|ttc|\btva\b|\bht\b|prix|chiffre/i;
    const verifierAucuneCleFinanciere = (valeur: unknown): void => {
      if (Array.isArray(valeur)) {
        for (const v of valeur) verifierAucuneCleFinanciere(v);
        return;
      }
      if (valeur !== null && typeof valeur === 'object') {
        for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
          expect(cle, `clé suspecte dans la réponse activite : "${cle}"`).not.toMatch(
            motsInterdits,
          );
          verifierAucuneCleFinanciere(v);
        }
      }
    };
    verifierAucuneCleFinanciere(corps);

    // Contenu : les valeurs financières EXACTES semées ci-dessus (facture connue : 6475/525/7000)
    // n'apparaissent nulle part dans le JSON brut de /activite — un smoking gun si jamais elles y
    // étaient, quel que soit le nom du champ qui les porterait.
    const brut = JSON.stringify(corps);
    expect(brut).not.toContain(String(PRIMITIVE_HT));
    expect(brut).not.toContain(String(PRIMITIVE_TVA));
    expect(brut).not.toContain(String(PRIMITIVE_TTC));
    expect(brut).not.toContain(facture.numero);
  });
});

// =================================================================================================
// 4. Isolation tenant (règle n°1 du projet) — un chiffre d'affaires de tenant B est invisible sous
//    le contexte tenant A, à la fois pour le financier ET pour l'activité, par les VRAIS
//    contrôleurs HTTP (pas seulement le SQL/RLS, déjà couvert ailleurs — ici c'est la garantie de
//    bout en bout : scoping applicatif explicite + RLS, dans le chemin réel d'une requête).
// =================================================================================================

describe('isolation tenant — le chiffre d’affaires et l’activité de B sont invisibles sous A', () => {
  it('financier : une facture ÉMISE et intégralement payée chez B (période 2031-01) est invisible sous A, visible sous B', async () => {
    const site = garage.tenantB.tenant.sites[0]!.id;
    const client = garage.tenantB.clients[0]!.id;
    const cookieA = await cookiePour(garage.tenantA, 'direction');

    // `encoursClientsCentimes` est un SNAPSHOT non borné par la période (voir le contrat et la
    // discipline déjà en place dans `financier-arithmetique.spec.ts` §6) : une facture de A émise
    // par un AUTRE test de CE fichier (section 3 ci-dessus, jamais réglée) reste dans le solde de A
    // indéfiniment. Une valeur absolue serait donc vraie ou fausse selon l'ordre d'exécution — DELTA
    // avant/après, jamais une valeur absolue, même règle que `financier-arithmetique.spec.ts`.
    const avantA = await getFinancier(ctx, cookieA, { du: '2031-01-01', au: '2031-01-31' });
    expect(avantA.status, JSON.stringify(avantA.body)).toBe(200);
    const encoursABaseline = avantA.body.encoursClientsCentimes as number;

    const facture = await creerFactureEmisePourTest(ctx, garage.tenantB, 'direction', cookiePour, {
      siteId: site,
      clientId: client,
      dateDocument: '2031-01-15',
      nombreLignesPrimitives: 1,
    });

    // Point de preuve DÉCISIF : à cet instant précis, B porte une créance RÉELLE et NON NULLE
    // (facture émise, pas encore réglée — `solde_centimes = PRIMITIVE_TTC` côté B). Si le scoping
    // tenant de l'agrégation encours fuitait, c'est ICI que ce serait visible sous A : B a quelque
    // chose de concret à fuir. Une fois le paiement complet passé ci-dessous, B retombe à
    // solde=0 et ne fuiterait plus rien à voir même en cas de fuite réelle — ce contrôle
    // intermédiaire est donc la seule fenêtre de ce test qui puisse réellement rougir sur une
    // fuite inter-tenant de l'encours.
    const pendantCreanceB = await getFinancier(ctx, cookieA, {
      du: '2031-01-01',
      au: '2031-01-31',
    });
    expect(pendantCreanceB.status, JSON.stringify(pendantCreanceB.body)).toBe(200);
    expect(
      (pendantCreanceB.body.encoursClientsCentimes as number) - encoursABaseline,
      `l'encours de A a bougé alors que seule une créance non réglée de B (facture ${facture.id}, ` +
        `${String(PRIMITIVE_TTC)} c.) vient d'apparaître : fuite inter-tenant sur l'encours clients.`,
    ).toBe(0);

    // Réglée intégralement : solde=0, déterministe indépendamment de tout autre test de ce fichier.
    await creerPaiementPourTest(ctx, garage.tenantB, 'direction', cookiePour, {
      siteId: site,
      dateValeur: '2031-01-15',
      montantCentimes: PRIMITIVE_TTC,
      payeurLibelle: 'Client isolation tenant',
      imputations: [
        { documentId: facture.id, montantCentimes: PRIMITIVE_TTC, nature: 'reglement' },
      ],
    });

    const sousA = await getFinancier(ctx, cookieA, { du: '2031-01-01', au: '2031-01-31' });
    expect(sousA.status, JSON.stringify(sousA.body)).toBe(200);
    expect(sousA.body.chiffreAffaires).toEqual({
      totalHtCentimes: 0,
      totalTvaCentimes: 0,
      totalTtcCentimes: 0,
      nombreDocuments: 0,
    });
    expect(sousA.body.encaissementsCentimes).toBe(0);
    expect((sousA.body.encoursClientsCentimes as number) - encoursABaseline).toBe(0);

    // Contrôle positif : la donnée existe bel et bien, et B la voit — sinon l'assertion
    // d'isolation ci-dessus ne prouverait rien (il n'y aurait simplement rien à isoler).
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    const sousB = await getFinancier(ctx, cookieB, { du: '2031-01-01', au: '2031-01-31' });
    expect(sousB.status, JSON.stringify(sousB.body)).toBe(200);
    expect(sousB.body.chiffreAffaires).toEqual({
      totalHtCentimes: PRIMITIVE_HT,
      totalTvaCentimes: PRIMITIVE_TVA,
      totalTtcCentimes: PRIMITIVE_TTC,
      nombreDocuments: 1,
    });
    expect(sousB.body.encaissementsCentimes).toBe(PRIMITIVE_TTC);
    expect(sousB.body.encoursClientsCentimes).toBe(0);
  });

  it('activité : un OR planifié chez B n’apparaît pas dans le compte "planifie" de A', async () => {
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    const avant = await getActivite(ctx, cookieA);
    expect(avant.status, JSON.stringify(avant.body)).toBe(200);
    const planifieAvant = (
      avant.body.ordresReparationParStatut as readonly { statut: string; nombre: number }[]
    ).find((l) => l.statut === 'planifie')!.nombre;

    const site = garage.tenantB.tenant.sites[0]!.id;
    await creerOrPourTest(
      bdd,
      garage.tenantB.tenant,
      site,
      garage.tenantB.clients[0]!,
      garage.tenantB.vehicules[0]!,
    );

    const apres = await getActivite(ctx, cookieA);
    const planifieApres = (
      apres.body.ordresReparationParStatut as readonly { statut: string; nombre: number }[]
    ).find((l) => l.statut === 'planifie')!.nombre;
    expect(planifieApres, "l'OR créé côté tenant B ne doit pas incrémenter le compte de A").toBe(
      planifieAvant,
    );

    // Contrôle positif, même raisonnement que ci-dessus.
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    const sousB = await getActivite(ctx, cookieB);
    const planifieB = (
      sousB.body.ordresReparationParStatut as readonly { statut: string; nombre: number }[]
    ).find((l) => l.statut === 'planifie')!.nombre;
    expect(planifieB).toBeGreaterThanOrEqual(1);
  });
});
