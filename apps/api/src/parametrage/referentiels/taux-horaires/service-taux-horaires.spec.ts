import { describe, expect, it, vi } from 'vitest';
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
      values: () => ({
        returning: () => {
          if (options.erreurInsert) return Promise.reject(options.erreurInsert);
          return Promise.resolve(options.ligneInsert ? [options.ligneInsert] : []);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            if (options.erreurUpdate) return Promise.reject(options.erreurUpdate);
            return Promise.resolve(options.ligneUpdate ? [options.ligneUpdate] : []);
          },
        }),
      }),
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
  it('met à jour et projette la ligne', async () => {
    const service = new ServiceTauxHoraires(
      accesFactice({ ligneUpdate: ligne({ libelle: 'Renommé' }) }),
    );
    const dto = await service.modifier(CTX, 'th-1', { libelle: 'Renommé' });
    expect(dto.libelle).toBe('Renommé');
  });

  it('corps vide : relit sans écrire', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneSelectUnitaire: ligne() }));
    const dto = await service.modifier(CTX, 'th-1', {});
    expect(dto.code).toBe('MEC');
  });

  it('id introuvable pour ce tenant : RESSOURCE_INTROUVABLE', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneUpdate: undefined }));
    await expect(service.modifier(CTX, 'absent', { libelle: 'X' })).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });

  it('extension de période en collision (23P01) : 409 CONFLIT', async () => {
    const service = new ServiceTauxHoraires(
      accesFactice({ erreurUpdate: { code: '23P01', message: 'exclusion violation' } }),
    );
    await expect(service.modifier(CTX, 'th-1', { valideAuLe: null })).rejects.toMatchObject({
      code: 'CONFLIT',
    });
  });
});
