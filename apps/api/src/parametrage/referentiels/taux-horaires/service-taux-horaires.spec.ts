import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant } from '../../../db';
import { schema } from '../../../db';
import { ServiceTauxHoraires } from './service-taux-horaires';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

// `decoderCurseurTrie` (common/pagination/curseur.ts) exige un `id` au format UUID pour tout
// curseur v2 — voir parametrage/referentiels/pagination-defaut.spec.ts pour le même constat.
const ID_TH_1 = '11111111-1111-4111-8111-111111111111';
const ID_TH_RECENT = '22222222-2222-4222-8222-222222222222';
const ID_TH_ANCIEN = '33333333-3333-4333-8333-333333333333';

/** Ligne de test, avec `creeLeTexte` — le texte natif Postgres consommé par `pageDepuisLignes()`
 *  (voir `service-taux-horaires.ts`, `.select({ ...getTableColumns(...), creeLeTexte: sql\`...::text\` })`).
 *  Absent par défaut : les tests qui ne paginent pas (limite > nombre de lignes) n'en ont pas besoin. */
function ligne(
  champs: Partial<schema.LigneTauxHoraire> = {},
  creeLeTexte?: string,
): schema.LigneTauxHoraire & { readonly creeLeTexte?: string } {
  return {
    id: ID_TH_1,
    tenantId: 'tid',
    code: 'MEC',
    libelle: 'Mécanique générale',
    montantCentimes: 14500,
    valideDu: '2026-01-01',
    valideAu: null,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-01-01T00:00:00.000Z'),
    ...champs,
    ...(creeLeTexte !== undefined ? { creeLeTexte } : {}),
  } as schema.LigneTauxHoraire;
}

interface OptionsAcces {
  readonly lignesListe?: readonly (schema.LigneTauxHoraire & { readonly creeLeTexte?: string })[];
  readonly ligneInsert?: schema.LigneTauxHoraire | undefined;
  readonly erreurInsert?: unknown;
  readonly ligneUpdate?: schema.LigneTauxHoraire | undefined;
  readonly ligneSelectUnitaire?: schema.LigneTauxHoraire | undefined;
  readonly erreurUpdate?: unknown;
  /** Journal des écritures : valeurs `set()` des UPDATE et `values()` des INSERT, dans l'ordre. */
  readonly journal?: { updates: unknown[]; inserts: unknown[] };
}

function accesFactice(options: OptionsAcces): AccesBase {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          if (options.lignesListe) {
            return { orderBy: () => ({ limit: () => Promise.resolve(options.lignesListe) }) };
          }
          return Promise.resolve(options.ligneSelectUnitaire ? [options.ligneSelectUnitaire] : []);
        },
      }),
    }),
    insert: () => ({
      values: (valeurs: unknown) => ({
        returning: () => {
          options.journal?.inserts.push(valeurs);
          if (options.erreurInsert) return Promise.reject(options.erreurInsert);
          return Promise.resolve(options.ligneInsert ? [options.ligneInsert] : []);
        },
      }),
    }),
    update: () => ({
      set: (valeurs: unknown) => {
        options.journal?.updates.push(valeurs);
        return {
          where: () => {
            const ecriture = options.erreurUpdate
              ? Promise.reject(options.erreurUpdate)
              : Promise.resolve([]);
            return Object.assign(ecriture, {
              returning: () => {
                if (options.erreurUpdate) return Promise.reject(options.erreurUpdate);
                return Promise.resolve(options.ligneUpdate ? [options.ligneUpdate] : []);
              },
            });
          },
        };
      },
    }),
  };
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceTauxHoraires.lister', () => {
  it('projette les lignes et pagine', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ lignesListe: [ligne()] }));
    const page = await service.lister(CTX, 50, undefined);
    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.code).toBe('MEC');
    expect(page.limite).toBe(50);
  });

  it('curseur suivant : conserve la microseconde exacte de la dernière ligne (pas de passage par Date)', async () => {
    // Deux lignes qui ne diffèrent que par la microseconde (même milliseconde) — motif du
    // constat mesuré sur `GET /vehicules` (4 lignes de même milliseconde de création). Si le
    // curseur était construit depuis `getTableColumns().creeLe` (un `Date`, résolution
    // milliseconde) plutôt que depuis `creeLeTexte`, `.171200` serait tronqué en `.171000`.
    const recente = ligne({ id: ID_TH_RECENT }, '2026-07-29 13:37:35.171200+00');
    const ancienne = ligne({ id: ID_TH_ANCIEN }, '2026-07-29 13:37:35.171100+00');

    const service = new ServiceTauxHoraires(accesFactice({ lignesListe: [recente, ancienne] }));
    const page = await service.lister(CTX, 1, undefined);

    expect(page.donnees.map((d) => d.id)).toEqual([ID_TH_RECENT]);
    expect(page.curseurSuivant).not.toBeNull();
    const charge = JSON.parse(Buffer.from(page.curseurSuivant!, 'base64url').toString('utf8')) as {
      t: string;
      v: string;
      i: string;
    };
    expect(charge.v).toBe('2026-07-29T13:37:35.171200+00:00');
    expect(charge.i).toBe(ID_TH_RECENT);

    // La page suivante, pour CE curseur, rend bien la ligne restante — preuve que le seuil
    // réinjecté en SQL (`curseurDecode.creeLeTexte::timestamptz`) distingue les deux lignes.
    const serviceSuite = new ServiceTauxHoraires(accesFactice({ lignesListe: [ancienne] }));
    const pageSuite = await serviceSuite.lister(CTX, 1, page.curseurSuivant!);
    expect(pageSuite.donnees.map((d) => d.id)).toEqual([ID_TH_ANCIEN]);
  });
});

describe('ServiceTauxHoraires.creer', () => {
  it('crée et projette la ligne', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneInsert: ligne() }));
    const dto = await service.creer(CTX, {
      code: 'MEC',
      libelle: 'Mécanique générale',
      montantCentimes: 14500,
      valideDuLe: '2026-01-01',
    });
    expect(dto.code).toBe('MEC');
    expect(dto.montantCentimes).toBe(14500);
  });

  it('période chevauchante (exclusion_violation, 23P01) : 409 CONFLIT', async () => {
    const service = new ServiceTauxHoraires(
      accesFactice({ erreurInsert: { code: '23P01', message: 'exclusion violation' } }),
    );
    await expect(
      service.creer(CTX, {
        code: 'MEC',
        libelle: 'X',
        montantCentimes: 1000,
        valideDuLe: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'CONFLIT' });
  });

  it('autre erreur base : propagée telle quelle, jamais masquée en CONFLIT', async () => {
    const erreur = new Error('panne réseau');
    const service = new ServiceTauxHoraires(accesFactice({ erreurInsert: erreur }));
    await expect(
      service.creer(CTX, {
        code: 'MEC',
        libelle: 'X',
        montantCentimes: 1000,
        valideDuLe: '2026-01-01',
      }),
    ).rejects.toThrow('panne réseau');
  });
});

describe('ServiceTauxHoraires.modifier', () => {
  // Aujourd'hui (Zurich) = 2026-08-10 ; la période de test court depuis 2026-01-01, sans fin.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T10:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function journalVide() {
    return { updates: [] as unknown[], inserts: [] as unknown[] };
  }

  it('libellé seul : mis à jour en place, aucune nouvelle période', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({
        ligneSelectUnitaire: ligne(),
        ligneUpdate: ligne({ libelle: 'Renommé' }),
        journal,
      }),
    );
    const dto = await service.modifier(CTX, ID_TH_1, { libelle: 'Renommé' });
    expect(dto.libelle).toBe('Renommé');
    expect(journal.updates).toEqual([{ libelle: 'Renommé' }]);
    expect(journal.inserts).toEqual([]);
  });

  it('corps vide : relit sans écrire', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({ ligneSelectUnitaire: ligne(), journal }),
    );
    const dto = await service.modifier(CTX, ID_TH_1, {});
    expect(dto.code).toBe('MEC');
    expect(journal.updates).toEqual([]);
    expect(journal.inserts).toEqual([]);
  });

  it('id introuvable pour ce tenant : RESSOURCE_INTROUVABLE', async () => {
    const service = new ServiceTauxHoraires(accesFactice({}));
    await expect(service.modifier(CTX, 'absent', { libelle: 'X' })).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });

  it('nouveau montant sur la période en cours : clôt la précédente à aujourd’hui (borne exclusive, dernier jour couvert = la veille) et ouvre une nouvelle période datée d’aujourd’hui', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({
        ligneSelectUnitaire: ligne({ montantCentimes: 14500 }),
        ligneInsert: ligne({
          id: ID_TH_RECENT,
          montantCentimes: 15000,
          valideDu: '2026-08-10',
          valideAu: null,
        }),
        journal,
      }),
    );

    const dto = await service.modifier(CTX, ID_TH_1, { montantCentimes: 15000 });

    expect(journal.updates).toEqual([{ valideAu: '2026-08-10' }]);
    expect(journal.inserts).toEqual([
      {
        tenantId: 'tid',
        code: 'MEC',
        libelle: 'Mécanique générale',
        montantCentimes: 15000,
        valideDu: '2026-08-10',
        valideAu: null,
      },
    ]);
    expect(dto).toMatchObject({
      id: ID_TH_RECENT,
      montantCentimes: 15000,
      valideDuLe: '2026-08-10',
      valideAuLe: null,
    });
  });

  it('valideDuLe futur fourni : la nouvelle période démarre à cette date, l’ancienne s’arrête là', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({
        ligneSelectUnitaire: ligne(),
        ligneInsert: ligne({ id: ID_TH_RECENT, valideDu: '2026-09-01' }),
        journal,
      }),
    );
    await service.modifier(CTX, ID_TH_1, {
      montantCentimes: 16000,
      valideDuLe: '2026-09-01',
      libelle: 'Nouveau libellé',
    });
    expect(journal.updates).toEqual([{ valideAu: '2026-09-01' }]);
    expect(journal.inserts).toEqual([
      expect.objectContaining({
        libelle: 'Nouveau libellé',
        montantCentimes: 16000,
        valideDu: '2026-09-01',
        valideAu: null,
      }),
    ]);
  });

  it('la nouvelle période hérite d’une fin future de l’ancienne', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({
        ligneSelectUnitaire: ligne({ valideAu: '2026-12-31' }),
        ligneInsert: ligne({ id: ID_TH_RECENT }),
        journal,
      }),
    );
    await service.modifier(CTX, ID_TH_1, { montantCentimes: 16000 });
    expect(journal.inserts).toEqual([
      expect.objectContaining({ valideDu: '2026-08-10', valideAu: '2026-12-31' }),
    ]);
  });

  it('valideDuLe dans le passé avec un nouveau montant : refusé (400), rien n’est écrit', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({ ligneSelectUnitaire: ligne(), journal }),
    );
    await expect(
      service.modifier(CTX, ID_TH_1, { montantCentimes: 16000, valideDuLe: '2026-08-09' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(journal.updates).toEqual([]);
    expect(journal.inserts).toEqual([]);
  });

  it('valideDuLe sans changement de montant sur une période en cours : refusé (400)', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneSelectUnitaire: ligne() }));
    await expect(
      service.modifier(CTX, ID_TH_1, { valideDuLe: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });

  it('montant identique à l’actuel : pas de nouvelle période (mise à jour en place du reste)', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({ ligneSelectUnitaire: ligne(), ligneUpdate: ligne(), journal }),
    );
    await service.modifier(CTX, ID_TH_1, { montantCentimes: 14500, libelle: 'X' });
    expect(journal.inserts).toEqual([]);
  });

  it('période close : 409 CONFLIT, aucune écriture', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({ ligneSelectUnitaire: ligne({ valideAu: '2026-08-10' }), journal }),
    );
    await expect(service.modifier(CTX, ID_TH_1, { libelle: 'X' })).rejects.toMatchObject({
      code: 'CONFLIT',
    });
    await expect(service.modifier(CTX, ID_TH_1, { montantCentimes: 99999 })).rejects.toMatchObject({
      code: 'CONFLIT',
    });
    expect(journal.updates).toEqual([]);
    expect(journal.inserts).toEqual([]);
  });

  it('période pas encore commencée : montant et dates se modifient en place (rien d’historique)', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({
        ligneSelectUnitaire: ligne({ valideDu: '2026-09-01' }),
        ligneUpdate: ligne({ valideDu: '2026-10-01', montantCentimes: 15500 }),
        journal,
      }),
    );
    await service.modifier(CTX, ID_TH_1, { montantCentimes: 15500, valideDuLe: '2026-10-01' });
    expect(journal.updates).toEqual([{ montantCentimes: 15500, valideDu: '2026-10-01' }]);
    expect(journal.inserts).toEqual([]);
  });

  it('période commencée aujourd’hui et nouveau montant daté d’aujourd’hui : correction en place (la précédente serait vide)', async () => {
    const journal = journalVide();
    const service = new ServiceTauxHoraires(
      accesFactice({
        ligneSelectUnitaire: ligne({ valideDu: '2026-08-10' }),
        ligneUpdate: ligne({ valideDu: '2026-08-10', montantCentimes: 15000 }),
        journal,
      }),
    );
    await service.modifier(CTX, ID_TH_1, { montantCentimes: 15000 });
    expect(journal.updates).toEqual([{ montantCentimes: 15000 }]);
    expect(journal.inserts).toEqual([]);
  });

  it('fin de période fixée dans le passé : refusé (400)', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneSelectUnitaire: ligne() }));
    await expect(
      service.modifier(CTX, ID_TH_1, { valideAuLe: '2026-08-10' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });

  it('nouvelle période en collision avec une période future (23P01) : 409 CONFLIT', async () => {
    const service = new ServiceTauxHoraires(
      accesFactice({
        ligneSelectUnitaire: ligne(),
        erreurInsert: { code: '23P01', message: 'exclusion violation' },
      }),
    );
    await expect(service.modifier(CTX, ID_TH_1, { montantCentimes: 16000 })).rejects.toMatchObject({
      code: 'CONFLIT',
    });
  });
});
