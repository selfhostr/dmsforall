import { GRILLE_VIDE } from '@dfa/shared';
import { colonnesDepuisGrille } from '../auth/grille-utilisateur';
import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../db/db.types';
import type { LigneUtilisateur } from '../db/schema';
import { auditUtilisateur } from '../db/schema';
import type { ServiceMotDePasse } from '../auth/auth.types';
import { ServiceBorne } from './service-borne';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'acteur-1', requeteId: null };
const ID_BORNE = '11111111-1111-4111-8111-111111111111';
const ID_SITE = '22222222-2222-4222-8222-222222222222';

function motDePasseFactice(): ServiceMotDePasse {
  return {
    hacher: vi.fn(async (clair: string) => `HASH(${clair})`),
    verifier: vi.fn(async () => true),
    verifierLeurre: vi.fn(async () => undefined),
    doitEtreRehache: vi.fn(() => false),
  };
}

function ligneBorne(champs: Partial<LigneUtilisateur> = {}): LigneUtilisateur {
  return {
    id: ID_BORNE,
    tenantId: 'tid-1',
    email: 'borne-aaaa1111@bornes.dmsforall.invalid',
    motDePasseHash: 'ancien',
    prenom: 'Borne',
    nom: 'Atelier Sion',
    langue: 'fr',
    role: 'poste_atelier',
    siteId: ID_SITE,
    statut: 'actif',
    echecsConnexion: 0,
    verrouilleJusquA: null,
    derniereConnexionLe: null,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
    // Borne = profil figé : grille vide (contrainte `utilisateur_borne_sans_grille_chk`).
    ...colonnesDepuisGrille(GRILLE_VIDE),
    ...champs,
  };
}

interface Appel {
  readonly table: unknown;
  readonly payload?: unknown;
}

/** Même patron que `service-utilisateur.spec.ts` : file de réponses, inserts enregistrés. */
function txFactice(reponses: readonly unknown[]) {
  const file = [...reponses];
  const inserts: Appel[] = [];
  const maj: unknown[] = [];
  function chaine(capture?: Appel, estMaj = false): unknown {
    return new Proxy(
      {},
      {
        get(_c, prop) {
          if (prop === 'then') {
            if (capture) inserts.push(capture);
            if (estMaj) maj.push(true);
            const v = file.shift();
            return (resolve: (x: unknown) => void) => Promise.resolve(v).then(resolve);
          }
          return (...args: unknown[]) => {
            if (prop === 'values' && capture)
              return chaine({ table: capture.table, payload: args[0] });
            if (prop === 'set') return chaine(undefined, true);
            return chaine(capture, estMaj);
          };
        },
      },
    );
  }
  const tx = {
    select: () => chaine(),
    insert: (table: unknown) => chaine({ table }),
    update: () => chaine(undefined, true),
    delete: () => chaine(),
  } as unknown as TransactionDfa;
  return { tx, inserts, maj };
}

function service(reponses: readonly unknown[]) {
  const { tx, inserts, maj } = txFactice(reponses);
  const acces = {
    enTenant: vi.fn(async (_c: unknown, fn: (t: TransactionDfa) => unknown) => fn(tx)),
  };
  const mdp = motDePasseFactice();
  return { svc: new ServiceBorne(acces as unknown as AccesBase, mdp), inserts, maj, mdp };
}

describe('ServiceBorne', () => {
  it('creer : insère un compte poste_atelier rattaché au site, mot de passe rendu en clair UNE fois et jamais écrit en clair', async () => {
    const { svc, inserts, mdp } = service([
      [{ id: ID_SITE, nom: 'Sion' }], // chargerSites
      [ligneBorne()], // insert utilisateur returning
      undefined, // insert audit
    ]);
    const r = await svc.creer(CTX, { nom: 'Atelier Sion', siteId: ID_SITE });

    expect(r.acces.motDePasseTemporaire.length).toBeGreaterThanOrEqual(12);
    expect(r.borne.site).toEqual({ id: ID_SITE, nom: 'Sion' });
    expect(r.borne.identifiant).toMatch(/^borne-[0-9a-f]{8}@bornes\.dmsforall\.invalid$/);
    const insertUtilisateur = inserts[0]?.payload as Record<string, unknown>;
    expect(insertUtilisateur).toMatchObject({
      tenantId: 'tid-1',
      role: 'poste_atelier',
      siteId: ID_SITE,
      statut: 'actif',
    });
    expect(insertUtilisateur.motDePasseHash).toBe(`HASH(${r.acces.motDePasseTemporaire})`);
    expect(JSON.stringify(inserts.map((i) => i.payload))).not.toContain(
      `"${r.acces.motDePasseTemporaire}"`,
    );
    expect(mdp.hacher).toHaveBeenCalledTimes(1);
    const audit = inserts[1];
    expect(audit?.table).toBe(auditUtilisateur);
    expect(JSON.stringify(audit?.payload)).not.toContain(r.acces.motDePasseTemporaire);
  });

  it('creer : site d’un autre tenant (introuvable pour ce tenant) → 400, aucune insertion', async () => {
    const { svc, inserts } = service([[]]);
    await expect(svc.creer(CTX, { nom: 'X', siteId: ID_SITE })).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
    expect(inserts).toHaveLength(0);
  });

  it('desactiver / reactiver / reinitialiserAcces : id inconnu, autre tenant ou compte de personne → RESSOURCE_INTROUVABLE (404), aucune écriture', async () => {
    for (const appel of [
      (s: ServiceBorne) => s.desactiver(CTX, ID_BORNE),
      (s: ServiceBorne) => s.reactiver(CTX, ID_BORNE),
      (s: ServiceBorne) => s.reinitialiserAcces(CTX, ID_BORNE),
    ]) {
      const { svc, inserts, maj } = service([[]]);
      await expect(appel(svc)).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
      expect(inserts).toHaveLength(0);
      expect(maj).toHaveLength(0);
    }
  });

  it('desactiver : suspend la borne, révoque ses sessions et audite', async () => {
    const { svc, inserts, maj } = service([
      [ligneBorne()], // chargerBorne
      undefined, // update statut
      undefined, // update session
      undefined, // audit
      [ligneBorne({ statut: 'suspendu' })], // rechargement
      [{ id: ID_SITE, nom: 'Sion' }],
    ]);
    const r = await svc.desactiver(CTX, ID_BORNE);
    expect(r.statut).toBe('suspendu');
    expect(maj).toHaveLength(2); // statut + sessions
    expect(inserts[0]?.payload).toMatchObject({
      action: 'desactivation',
      actionParId: 'acteur-1',
      utilisateurCibleId: ID_BORNE,
    });
  });

  it('reinitialiserAcces : nouveau hash, sessions révoquées, mot de passe jamais dans l’audit', async () => {
    const { svc, inserts, maj } = service([[ligneBorne()], undefined, undefined, undefined]);
    const r = await svc.reinitialiserAcces(CTX, ID_BORNE);
    expect(r.motDePasseTemporaire.length).toBeGreaterThanOrEqual(12);
    expect(maj).toHaveLength(2);
    expect(JSON.stringify(inserts.map((i) => i.payload))).not.toContain(r.motDePasseTemporaire);
    expect(inserts[0]?.payload).toMatchObject({ action: 'reinitialisation_acces' });
  });
});
