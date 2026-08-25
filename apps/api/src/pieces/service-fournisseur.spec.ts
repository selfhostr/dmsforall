import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { EntreeCreationFournisseur } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneFournisseur } from '../db/schema';
import { ServiceFournisseur } from './service-fournisseur';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const dialect = new PgDialect();

function ligneFournisseur(champs: Partial<LigneFournisseur> = {}): LigneFournisseur {
  return {
    id: 'f1',
    tenantId: 'tid-1',
    nom: 'Bosch Suisse SA',
    email: null,
    telephone: null,
    delaiHabituelJours: 3,
    statut: 'actif',
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    modifieLe: new Date('2026-07-31T08:00:00.000Z'),
    ...champs,
  } as LigneFournisseur;
}

function txFactice(
  plan: {
    selects?: readonly unknown[][];
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
  } = {},
) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const setArgs: unknown[] = [];
  const insertValuesArgs: Array<Record<string, unknown>> = [];

  function chaineWhere() {
    const valeur = Promise.resolve(selects.shift() ?? []);
    return {
      limit: () => valeur,
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        valeur.then(resolve, reject),
    };
  }

  const tx = {
    select: () => ({ from: () => ({ where: () => chaineWhere() }) }),
    update: () => ({
      set: (vals: unknown) => {
        setArgs.push(vals);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return { returning: () => Promise.resolve([ligneFournisseur(vals)]) };
      },
    }),
    execute: vi.fn((_requete: unknown) => Promise.resolve(executes.shift() ?? { rows: [] })),
  };

  return { tx: tx as unknown as TransactionDfa, setArgs, insertValuesArgs, execute: tx.execute };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceFournisseur — RP-26/§1 : référentiel minimal, pas de suppression', () => {
  it('parId : 404 RESSOURCE_INTROUVABLE quand le fournisseur n’existe pas pour ce tenant', async () => {
    const { tx } = txFactice({ selects: [[]] });
    const service = new ServiceFournisseur(accesFactice(tx));

    await expect(service.parId(CTX, 'inconnu')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('creer : pas d’Idempotency-Key nécessaire, insère et enveloppe d’avertissements (vide)', async () => {
    const { tx, insertValuesArgs } = txFactice();
    const service = new ServiceFournisseur(accesFactice(tx));
    const entree: EntreeCreationFournisseur = { nom: 'Bosch Suisse SA', delaiHabituelJours: 3 };

    const resultat = await service.creer(CTX, entree);

    expect(resultat.donnees.nom).toBe('Bosch Suisse SA');
    expect(resultat.avertissements).toHaveLength(0);
    expect(insertValuesArgs[0]).toMatchObject({
      tenantId: 'tid-1',
      nom: 'Bosch Suisse SA',
      delaiHabituelJours: 3,
    });
  });

  it('desactiver : bascule statut à inactif (RP-07/RM-12/RM-31 — jamais de suppression)', async () => {
    const { tx, setArgs } = txFactice({
      selects: [[ligneFournisseur()], [ligneFournisseur({ statut: 'inactif' })]],
    });
    const service = new ServiceFournisseur(accesFactice(tx));

    const resultat = await service.desactiver(CTX, 'f1');

    expect(resultat.donnees.statut).toBe('inactif');
    expect(setArgs[0]).toMatchObject({ statut: 'inactif' });
  });

  it('modifier : n’écrit rien si le corps est vide ({}), relit simplement la fiche', async () => {
    const { tx, setArgs } = txFactice({ selects: [[ligneFournisseur()], [ligneFournisseur()]] });
    const service = new ServiceFournisseur(accesFactice(tx));

    await service.modifier(CTX, 'f1', {});

    expect(setArgs).toHaveLength(0);
  });
});

describe('ServiceFournisseur.lister — filtre `q` tolérant à la casse ET aux accents', () => {
  it('enveloppe `nom` dans public.normaliser_recherche(...) des deux côtés du `like`, jamais un `ilike` nu', async () => {
    const { tx, execute } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceFournisseur(accesFactice(tx));

    await service.lister(CTX, { limite: 50, tri: 'nom:asc', q: 'bösch' });

    const appel = execute.mock.calls[0]?.[0] as SQL;
    const { sql: texte } = dialect.sqlToQuery(appel);
    expect(texte).toContain('public.normaliser_recherche(f.nom) like public.normaliser_recherche(');
    expect(texte).not.toContain('ilike');
  });

  // Test décisif : un `q` accepté par le contrat mais ignoré par le service est le piège maison —
  // un ID/terme inexistant DOIT rendre une liste vide, jamais le référentiel entier.
  it('un terme qui ne correspond à aucun fournisseur rend une liste VIDE, jamais le référentiel entier', async () => {
    const { tx } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceFournisseur(accesFactice(tx));

    const page = await service.lister(CTX, { limite: 50, tri: 'nom:asc', q: 'introuvable-xyz' });

    expect(page.donnees).toEqual([]);
    expect(page.curseurSuivant).toBeNull();
  });

  // Piège du zéro/vide : `q` absent (`undefined`) ne doit JAMAIS ajouter la condition — un client
  // qui n'envoie pas `q` doit se comporter EXACTEMENT comme avant (rétrocompatibilité).
  it('sans `q`, aucune condition de recherche n’est ajoutée au SQL', async () => {
    const { tx, execute } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceFournisseur(accesFactice(tx));

    await service.lister(CTX, { limite: 50, tri: 'nom:asc' });

    const appel = execute.mock.calls[0]?.[0] as SQL;
    const { sql: texte } = dialect.sqlToQuery(appel);
    expect(texte).not.toContain('normaliser_recherche');
  });
});
