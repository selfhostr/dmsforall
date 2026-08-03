import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant } from '../../../db';
import { schema } from '../../../db';
import type { Horloge } from '../../../common/horloge';
import { ServicePrestations } from './service-prestations';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

// `decoderCurseurTrie` (common/pagination/curseur.ts) exige un `id` au format UUID pour tout
// curseur v2 — voir parametrage/referentiels/pagination-defaut.spec.ts pour le même constat.
const ID_PR_1 = '11111111-1111-4111-8111-111111111111';
const ID_PR_RECENTE = '22222222-2222-4222-8222-222222222222';
const ID_PR_ANCIENNE = '33333333-3333-4333-8333-333333333333';

function horlogeFigee(): Horloge {
  return { maintenant: () => new Date('2026-07-28T10:00:00.000Z') } as Horloge;
}

/** `creeLeTexte` : texte natif Postgres consommé par `pageDepuisLignes()` (voir
 *  `service-prestations.ts`, `.select({ ...getTableColumns(...), creeLeTexte: sql\`...::text\` })`).
 *  Absent par défaut : les tests qui ne paginent pas (limite > nombre de lignes) n'en ont pas besoin. */
function prestationBrute(
  champs: Partial<schema.LignePrestation> = {},
  creeLeTexte?: string,
): schema.LignePrestation & { readonly creeLeTexte?: string } {
  return {
    id: ID_PR_1,
    tenantId: 'tid',
    code: 'SRV-A',
    designationFr: 'Service A',
    designationDe: null,
    designationIt: null,
    typeLigne: 'forfait',
    tempsBaremeCentiemes: 120,
    tauxHoraireCode: 'MEC',
    tauxTvaPourmille: 81,
    actif: true,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-01-01T00:00:00.000Z'),
    ...champs,
    ...(creeLeTexte !== undefined ? { creeLeTexte } : {}),
  } as schema.LignePrestation;
}

interface OptionsAcces {
  readonly lignesPrestation?: readonly (schema.LignePrestation & {
    readonly creeLeTexte?: string;
  })[];
  readonly lignesPrix?: readonly { prestationId: string; prixCentimes: number }[];
  readonly lignePrestationInseree?: schema.LignePrestation;
  readonly erreurInsertPrestation?: unknown;
  readonly erreurInsertPrix?: unknown;
  readonly lignePrestationMaj?: schema.LignePrestation | undefined;
  readonly ligneSelectUnitaire?: schema.LignePrestation | undefined;
}

function accesFactice(options: OptionsAcces, journal: string[] = []): AccesBase {
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === schema.prestation) {
            if (options.lignesPrestation) {
              return {
                orderBy: () => ({ limit: () => Promise.resolve(options.lignesPrestation) }),
              };
            }
            return Promise.resolve(
              options.ligneSelectUnitaire ? [options.ligneSelectUnitaire] : [],
            );
          }
          if (table === schema.prestationPrix) {
            return Promise.resolve(options.lignesPrix ?? []);
          }
          throw new Error('Table inattendue dans le mock.');
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: () => {
        if (table === schema.prestation) {
          journal.push('insert:prestation');
          return {
            returning: () =>
              options.erreurInsertPrestation
                ? Promise.reject(options.erreurInsertPrestation)
                : Promise.resolve(
                    options.lignePrestationInseree ? [options.lignePrestationInseree] : [],
                  ),
          };
        }
        if (table === schema.prestationPrix) {
          journal.push('insert:prestation_prix');
          return options.erreurInsertPrix
            ? Promise.reject(options.erreurInsertPrix)
            : Promise.resolve(undefined);
        }
        throw new Error('Table inattendue.');
      },
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: () => {
          if (table === schema.prestation) {
            return {
              returning: () =>
                Promise.resolve(options.lignePrestationMaj ? [options.lignePrestationMaj] : []),
            };
          }
          if (table === schema.prestationPrix) {
            journal.push('update:prestation_prix (cloture)');
            return Promise.resolve(undefined);
          }
          throw new Error('Table inattendue.');
        },
      }),
    }),
  };
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServicePrestations.lister', () => {
  it('fusionne le prix courant par prestation', async () => {
    const service = new ServicePrestations(
      accesFactice({
        lignesPrestation: [prestationBrute()],
        lignesPrix: [{ prestationId: ID_PR_1, prixCentimes: 19500 }],
      }),
      horlogeFigee(),
    );
    const page = await service.lister(CTX, 50, undefined);
    expect(page.donnees[0]?.prixCentimes).toBe(19500);
  });

  it('prestation sans prix ouvert -> prixCentimes null', async () => {
    const service = new ServicePrestations(
      accesFactice({ lignesPrestation: [prestationBrute()], lignesPrix: [] }),
      horlogeFigee(),
    );
    const page = await service.lister(CTX, 50, undefined);
    expect(page.donnees[0]?.prixCentimes).toBeNull();
  });

  it('designation.de/it replient sur le FR quand non traduites', async () => {
    const service = new ServicePrestations(
      accesFactice({ lignesPrestation: [prestationBrute()], lignesPrix: [] }),
      horlogeFigee(),
    );
    const page = await service.lister(CTX, 50, undefined);
    expect(page.donnees[0]?.designation).toEqual({
      fr: 'Service A',
      de: 'Service A',
      it: 'Service A',
    });
  });

  it('curseur suivant : conserve la microseconde exacte de la dernière ligne (pas de passage par Date)', async () => {
    // Deux lignes qui ne diffèrent que par la microseconde (même milliseconde) — motif du
    // constat mesuré sur `GET /vehicules` (4 lignes de même milliseconde de création). Si le
    // curseur était construit depuis `getTableColumns().creeLe` (un `Date`, résolution
    // milliseconde) plutôt que depuis `creeLeTexte`, `.171200` serait tronqué en `.171000`.
    const recente = prestationBrute(
      { id: ID_PR_RECENTE, code: 'SRV-B' },
      '2026-07-29 13:37:35.171200+00',
    );
    const ancienne = prestationBrute(
      { id: ID_PR_ANCIENNE, code: 'SRV-C' },
      '2026-07-29 13:37:35.171100+00',
    );

    const service = new ServicePrestations(
      accesFactice({ lignesPrestation: [recente, ancienne], lignesPrix: [] }),
      horlogeFigee(),
    );
    const page = await service.lister(CTX, 1, undefined);

    expect(page.donnees.map((d) => d.id)).toEqual([ID_PR_RECENTE]);
    expect(page.curseurSuivant).not.toBeNull();
    const charge = JSON.parse(Buffer.from(page.curseurSuivant!, 'base64url').toString('utf8')) as {
      t: string;
      v: string;
      i: string;
    };
    expect(charge.v).toBe('2026-07-29T13:37:35.171200+00:00');
    expect(charge.i).toBe(ID_PR_RECENTE);

    // La page suivante, pour CE curseur, rend bien la ligne restante — preuve que le seuil
    // réinjecté en SQL (`curseurDecode.creeLeTexte::timestamptz`) distingue les deux lignes.
    const serviceSuite = new ServicePrestations(
      accesFactice({ lignesPrestation: [ancienne], lignesPrix: [] }),
      horlogeFigee(),
    );
    const pageSuite = await serviceSuite.lister(CTX, 1, page.curseurSuivant!);
    expect(pageSuite.donnees.map((d) => d.id)).toEqual([ID_PR_ANCIENNE]);
  });
});

describe('ServicePrestations.creer', () => {
  it('sans prixCentimes : crée la prestation seule, prixCentimes null', async () => {
    const journal: string[] = [];
    const service = new ServicePrestations(
      accesFactice({ lignePrestationInseree: prestationBrute() }, journal),
      horlogeFigee(),
    );
    const dto = await service.creer(CTX, {
      code: 'SRV-A',
      designationFr: 'Service A',
      typeLigne: 'forfait',
      tauxTvaPourmille: 81,
    });
    expect(dto.prixCentimes).toBeNull();
    expect(journal).toEqual(['insert:prestation']);
  });

  it("avec prixCentimes : crée la prestation PUIS ouvre un prix daté à aujourd'hui", async () => {
    const journal: string[] = [];
    const service = new ServicePrestations(
      accesFactice({ lignePrestationInseree: prestationBrute() }, journal),
      horlogeFigee(),
    );
    const dto = await service.creer(CTX, {
      code: 'SRV-A',
      designationFr: 'Service A',
      typeLigne: 'forfait',
      tauxTvaPourmille: 81,
      prixCentimes: 19500,
    });
    expect(dto.prixCentimes).toBe(19500);
    expect(journal).toEqual(['insert:prestation', 'insert:prestation_prix']);
  });

  it('code déjà existant (23505) : 409 CONFLIT', async () => {
    const service = new ServicePrestations(
      accesFactice({ erreurInsertPrestation: { code: '23505', message: 'unique violation' } }),
      horlogeFigee(),
    );
    await expect(
      service.creer(CTX, {
        code: 'SRV-A',
        designationFr: 'X',
        typeLigne: 'forfait',
        tauxTvaPourmille: 81,
      }),
    ).rejects.toMatchObject({ code: 'CONFLIT' });
  });
});

describe('ServicePrestations.modifier', () => {
  it('changement de prix : clôture le prix courant PUIS en ouvre un nouveau, dans cet ordre', async () => {
    const journal: string[] = [];
    const service = new ServicePrestations(
      accesFactice(
        {
          lignePrestationMaj: prestationBrute(),
          lignesPrix: [{ prestationId: 'pr-1', prixCentimes: 15000 }],
        },
        journal,
      ),
      horlogeFigee(),
    );
    const dto = await service.modifier(CTX, 'pr-1', { actif: false, prixCentimes: 19500 });
    expect(dto.prixCentimes).toBe(19500);
    expect(journal).toEqual(['update:prestation_prix (cloture)', 'insert:prestation_prix']);
  });

  it('prix identique au prix courant : aucune écriture sur prestation_prix', async () => {
    const journal: string[] = [];
    const service = new ServicePrestations(
      accesFactice(
        {
          lignePrestationMaj: prestationBrute(),
          lignesPrix: [{ prestationId: 'pr-1', prixCentimes: 19500 }],
        },
        journal,
      ),
      horlogeFigee(),
    );
    await service.modifier(CTX, 'pr-1', { actif: false, prixCentimes: 19500 });
    expect(journal).toEqual([]);
  });

  it('prixCentimes: null explicite : clôture sans rouvrir, prixCentimes devient null', async () => {
    const journal: string[] = [];
    // `{ prixCentimes: null }` seul ne touche aucune colonne de `prestation` (le prix vit dans
    // `prestation_prix`) : `modifier` prend donc la branche SELECT (colonnes vide), pas la
    // branche UPDATE — c'est `ligneSelectUnitaire` que le mock doit fournir ici, comme le service
    // le fait réellement (cf. `service-prestations.ts` : `Object.keys(colonnes).length === 0`).
    const service = new ServicePrestations(
      accesFactice(
        {
          ligneSelectUnitaire: prestationBrute(),
          lignesPrix: [{ prestationId: 'pr-1', prixCentimes: 19500 }],
        },
        journal,
      ),
      horlogeFigee(),
    );
    const dto = await service.modifier(CTX, 'pr-1', { prixCentimes: null });
    expect(dto.prixCentimes).toBeNull();
    expect(journal).toEqual(['update:prestation_prix (cloture)']);
  });

  it('corps sans prixCentimes : le prix courant est préservé tel quel', async () => {
    const service = new ServicePrestations(
      accesFactice({
        lignePrestationMaj: prestationBrute(),
        lignesPrix: [{ prestationId: 'pr-1', prixCentimes: 19500 }],
      }),
      horlogeFigee(),
    );
    const dto = await service.modifier(CTX, 'pr-1', { actif: false });
    expect(dto.prixCentimes).toBe(19500);
  });

  it('id introuvable : RESSOURCE_INTROUVABLE', async () => {
    const service = new ServicePrestations(
      accesFactice({ lignePrestationMaj: undefined }),
      horlogeFigee(),
    );
    await expect(service.modifier(CTX, 'absent', { actif: false })).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});
