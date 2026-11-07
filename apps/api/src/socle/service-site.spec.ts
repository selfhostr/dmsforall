import { describe, expect, it } from 'vitest';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../db/db.types';
import type { LigneSite } from '../db/schema';
import { ServiceSite } from './service-site';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

// `decoderCurseurTrie` (common/pagination/curseur.ts) exige un `id` au format UUID — un curseur
// v2 ne peut pas encoder n'importe quelle chaîne (voir le même constat dans
// parametrage/referentiels/pagination-defaut.spec.ts). Les fixtures utilisent donc de vrais UUID.
const ID_S1 = '11111111-1111-4111-8111-111111111111';
const ID_S2 = '22222222-2222-4222-8222-222222222222';
const ID_RECENT = '33333333-3333-4333-8333-333333333333';
const ID_ANCIEN = '44444444-4444-4444-8444-444444444444';

function ligneSite(
  champs: Partial<LigneSite> = {},
  creeLeTexte: string,
): LigneSite & { readonly creeLeTexte: string } {
  return {
    id: champs.id ?? ID_S1,
    tenantId: 'tid-1',
    code: champs.code ?? 'SION',
    codeCourt: champs.codeCourt ?? 'SION',
    nom: champs.nom ?? 'Site Sion',
    rue: null,
    npa: null,
    localite: null,
    pays: 'CH',
    actif: true,
    // `creeLe` (Date) n'est jamais consultée par `ServiceSite.lister()` pour construire le
    // curseur — seule `creeLeTexte` l'est (voir service-site.ts). Une valeur volontairement
    // tronquée à la milliseconde ici prouverait, si le test échouait, qu'une régression a
    // réintroduit une dépendance à cette colonne `Date`.
    creeLe: new Date(creeLeTexte),
    modifieLe: new Date(creeLeTexte),
    ...champs,
    creeLeTexte,
  };
}

/**
 * Fausse transaction : `select({...}).from(site).where(cond).orderBy(...).limit(n)` rend, dans
 * l'ordre, les lots fournis par `pages`. Le contenu de `cond` n'est PAS interprété (aucun moteur
 * SQL ici) — chaque lot doit donc déjà représenter ce qu'une vraie requête Postgres aurait rendu
 * pour cette page. Ce test ne prouve donc pas que le prédicat SQL filtre juste (ça, seule une
 * vraie base le prouve — voir vehicules/ pour le motif équivalent déjà en production) ; il prouve
 * que `ServiceSite.lister()` fait circuler `creeLeTexte` sans jamais passer par un `Date` JS entre
 * la ligne lue et le curseur rendu, puis entre le curseur reçu et le seuil réinjecté en SQL —
 * exactement les deux points de perte identifiés dans le correctif.
 */
function accesFactice(pages: readonly (readonly unknown[])[]): AccesBase {
  const restantes = [...pages];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(restantes.shift() ?? []),
          }),
        }),
      }),
    }),
  } as unknown as TransactionDfa;

  return {
    enTenant: async <T>(
      _ctx: ContexteTenant,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<T> => travail(tx),
  } as AccesBase;
}

describe('ServiceSite.lister — pagination keyset sur creeLe, précision microseconde', () => {
  it('le curseur rendu conserve la microseconde exacte de la dernière ligne (pas de passage par Date)', async () => {
    // `.171181`, pas `.171` : si `ServiceSite.lister()` construisait le curseur depuis un `Date`
    // (résolution milliseconde), cette valeur serait tronquée à `.171000+00:00`.
    const lignes = [
      ligneSite({ id: ID_S2 }, '2026-07-29 13:37:35.171200+00'),
      ligneSite({ id: ID_S1 }, '2026-07-29 13:37:35.171181+00'), // ligne surnuméraire (limite+1)
    ];
    const acces = accesFactice([lignes]);
    const service = new ServiceSite(acces);

    const resultat = await service.lister(CTX, { limite: 1 });

    expect(resultat.donnees.map((s) => s.id)).toEqual([ID_S2]);
    expect(resultat.curseurSuivant).not.toBeNull();

    const charge = JSON.parse(
      Buffer.from(resultat.curseurSuivant!, 'base64url').toString('utf8'),
    ) as {
      t: string;
      v: string;
      i: string;
    };
    expect(charge.t).toBe('creeLe:desc');
    expect(charge.v).toBe('2026-07-29T13:37:35.171200+00:00');
    expect(charge.i).toBe(ID_S2);
  });

  it('deux lignes qui ne diffèrent que par la microseconde (même milliseconde) sortent toutes deux, une par une', async () => {
    // Reproduit le motif exact du constat mesuré (4 véhicules de même microseconde) : ici deux
    // sites dont `creeLe` ne diffère qu'à la 5e décimale de seconde. Si le curseur perdait cette
    // microseconde à l'encodage OU au décodage, la page 2 reviendrait vide (le seuil retomberait
    // sur la même valeur tronquée que la ligne déjà rendue, l'excluant elle-même).
    const plusRecente = ligneSite({ id: ID_RECENT }, '2026-07-29 13:37:35.171200+00');
    const plusAncienne = ligneSite({ id: ID_ANCIEN }, '2026-07-29 13:37:35.171100+00');

    // Page 1 : la requête réelle rendrait `limite + 1 = 2` lignes triées desc.
    const acces = accesFactice([[plusRecente, plusAncienne]]);
    const service = new ServiceSite(acces);

    const page1 = await service.lister(CTX, { limite: 1 });
    expect(page1.donnees.map((s) => s.id)).toEqual([ID_RECENT]);
    expect(page1.curseurSuivant).not.toBeNull();

    // Page 2 : simule ce qu'une vraie requête Postgres rendrait pour CE curseur — seule
    // `plusAncienne` reste sous le seuil, sans ligne surnuméraire (fin de liste).
    const acces2 = accesFactice([[plusAncienne]]);
    const service2 = new ServiceSite(acces2);
    const page2 = await service2.lister(CTX, { limite: 1, curseur: page1.curseurSuivant! });

    expect(page2.donnees.map((s) => s.id)).toEqual([ID_ANCIEN]);
  });
});

/**
 * Défaut n°1 (rapport de livraison, même classe que celle corrigée dans
 * `apps/api/src/pneus/pagination-triee.ts`) : `GET /sites` répondait `500 ERREUR_INTERNE` sur un
 * curseur v2 SYNTAXIQUEMENT valide (forme `{t,v,i}` correcte, `t = creeLe:desc`, `i` un uuid) mais
 * dont la valeur `v` n'était pas le texte natif PostgreSQL d'un `timestamptz` : le contrôle local
 * `typeof donnees.valeur !== 'string'` de `decoderCurseurSite` ne juge que le TYPE JS, jamais le
 * FORMAT — une chaîne quelconque le traversait intacte jusqu'au `::timestamptz` de
 * `conditionCurseur`, provoquant une erreur PostgreSQL native non interceptée.
 *
 * Chaque cas ci-dessous doit être rejeté AVANT tout accès base : `accesFactice` lève si `select()`
 * est appelé, pour prouver que `decoderCurseurTrie(..., 'temporel')` rejette bien la valeur au
 * décodage, jamais en laissant la requête SQL échouer.
 */
describe('ServiceSite.lister — curseur forgé : rejet 400 avant toute requête SQL', () => {
  function accesQuiEchoueSiInterroge(): AccesBase {
    return {
      enTenant: async <T>(): Promise<T> => {
        throw new Error('ne doit jamais être atteint : le curseur devait être rejeté avant.');
      },
    } as unknown as AccesBase;
  }

  function curseurV2(v: unknown): string {
    const brut = JSON.stringify({ t: 'creeLe:desc', v, i: ID_S1 });
    return Buffer.from(brut, 'utf8').toString('base64url');
  }

  it('rejette (VALIDATION_ECHOUEE) une valeur qui n’est pas un timestamptz PostgreSQL', async () => {
    const service = new ServiceSite(accesQuiEchoueSiInterroge());

    await expect(
      service.lister(CTX, { limite: 10, curseur: curseurV2('not-a-real-timestamp') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('rejette une valeur numérique', async () => {
    const service = new ServiceSite(accesQuiEchoueSiInterroge());

    await expect(service.lister(CTX, { limite: 10, curseur: curseurV2(42) })).rejects.toMatchObject(
      { code: 'VALIDATION_ECHOUEE', status: 400 },
    );
  });

  it('rejette une chaîne vide', async () => {
    const service = new ServiceSite(accesQuiEchoueSiInterroge());

    await expect(service.lister(CTX, { limite: 10, curseur: curseurV2('') })).rejects.toMatchObject(
      { code: 'VALIDATION_ECHOUEE', status: 400 },
    );
  });

  it('rejette un curseur d’un autre tri (même s’il est par ailleurs bien formé)', async () => {
    const service = new ServiceSite(accesQuiEchoueSiInterroge());
    const brut = JSON.stringify({ t: 'nom:asc', v: 'x', i: ID_S1 });
    const curseur = Buffer.from(brut, 'utf8').toString('base64url');

    await expect(service.lister(CTX, { limite: 10, curseur })).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      status: 400,
    });
  });

  it('rejette un uuid mal formé dans "i"', async () => {
    const service = new ServiceSite(accesQuiEchoueSiInterroge());
    const brut = JSON.stringify({
      t: 'creeLe:desc',
      v: '2026-01-01 00:00:00+00',
      i: 'pas-un-uuid',
    });
    const curseur = Buffer.from(brut, 'utf8').toString('base64url');

    await expect(service.lister(CTX, { limite: 10, curseur })).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      status: 400,
    });
  });

  it('rejette un base64 invalide', async () => {
    const service = new ServiceSite(accesQuiEchoueSiInterroge());

    await expect(
      service.lister(CTX, { limite: 10, curseur: '!!!pas-du-base64url!!!' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('rejette une chaîne vide en curseur brut', async () => {
    // `curseur: ''` est falsy : traité comme "pas de curseur" par `params.curseur ? ... : null`
    // — première page, pas un rejet. Documente la frontière volontairement, pour ne pas confondre
    // ce cas avec un curseur `{t,v,i}` dont `v` serait la chaîne vide (rejeté ci-dessus).
    const service = new ServiceSite(accesFactice([[]]));

    await expect(service.lister(CTX, { limite: 10, curseur: '' })).resolves.toMatchObject({
      donnees: [],
    });
  });

  it('accepte un timestamptz PostgreSQL bien formé, ne rejette pas à tort', async () => {
    const acces = accesFactice([[ligneSite({ id: ID_S1 }, '2026-01-01 00:00:00.000000+00')]]);
    const service = new ServiceSite(acces);

    await expect(
      service.lister(CTX, { limite: 10, curseur: curseurV2('2026-01-01 00:00:00+00') }),
    ).resolves.toMatchObject({ donnees: [{ id: ID_S1 }] });
  });
});
