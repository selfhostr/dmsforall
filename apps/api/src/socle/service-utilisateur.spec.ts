import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../db/db.types';
import type { LigneUtilisateur } from '../db/schema';
import type { ServiceMotDePasse } from '../auth/auth.types';
import { ServiceUtilisateur } from './service-utilisateur';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'acteur-1', requeteId: null };

const ID_EMPLOYE = '11111111-1111-4111-8111-111111111111';
const ID_SITE = '22222222-2222-4222-8222-222222222222';
const ID_ACTEUR = 'acteur-1';

function motDePasseFactice(): ServiceMotDePasse {
  return {
    hacher: vi.fn(async (clair: string) => `HASH(${clair})`),
    verifier: vi.fn(async () => true),
    verifierLeurre: vi.fn(async () => undefined),
    doitEtreRehache: vi.fn(() => false),
  };
}

function ligneUtilisateur(champs: Partial<LigneUtilisateur> = {}): LigneUtilisateur {
  return {
    id: ID_EMPLOYE,
    tenantId: 'tid-1',
    email: 'julie.rey@garage-martin.ch',
    motDePasseHash: 'ancien-hash',
    prenom: 'Julie',
    nom: 'Rey',
    langue: 'fr',
    role: 'vendeur',
    siteId: null,
    statut: 'actif',
    echecsConnexion: 0,
    verrouilleJusquA: null,
    derniereConnexionLe: null,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
    ...champs,
  };
}

/**
 * Fausse transaction générique : chaque appel `tx.select()/insert()/update()/delete()` ouvre une
 * chaîne dont le seul comportement observable est de rendre, à l'`await` final, la prochaine
 * valeur de la file `reponses` (même patron que `accesFactice` de `service-site.spec.ts`,
 * généralisé à toute la variété d'opérations utilisées par `ServiceUtilisateur`). Les appels
 * `insert(table).values(payload)` sont en plus ENREGISTRÉS (table + payload exact) — c'est ce qui
 * permet de prouver qu'un geste n'écrit jamais le mot de passe en clair dans l'audit, sans avoir
 * à interpréter du SQL.
 */
interface AppelEnregistre {
  readonly table: unknown;
  readonly payload?: unknown;
}

function construireTxFactice(reponses: readonly unknown[]): {
  readonly tx: TransactionDfa;
  readonly appels: AppelEnregistre[];
} {
  const file = [...reponses];
  const appels: AppelEnregistre[] = [];

  function chaine(capture?: AppelEnregistre): unknown {
    return new Proxy(
      {},
      {
        get(_cible, prop) {
          if (prop === 'then') {
            if (capture) appels.push(capture);
            const valeur = file.shift();
            return (resolve: (v: unknown) => void) => Promise.resolve(valeur).then(resolve);
          }
          return (...args: unknown[]) => {
            if ((prop === 'values' || prop === 'set') && capture) {
              return chaine({ ...capture, payload: args[0] });
            }
            return chaine(capture);
          };
        },
      },
    );
  }

  const tx = {
    select: () => chaine(),
    insert: (table: unknown) => chaine({ table }),
    update: (table: unknown) => chaine({ table }),
    delete: (table: unknown) => chaine({ table }),
  } as unknown as TransactionDfa;

  return { tx, appels };
}

function accesAvec(tx: TransactionDfa): AccesBase {
  return {
    enTenant: async <T>(_ctx: ContexteTenant, travail: (t: TransactionDfa) => Promise<T>) =>
      travail(tx),
  } as AccesBase;
}

function accesQuiEchoueSiInterroge(): AccesBase {
  return {
    enTenant: async () => {
      throw new Error(
        'ne doit jamais être atteint : la garde devait refuser avant tout accès base.',
      );
    },
  } as unknown as AccesBase;
}

describe('ServiceUtilisateur.creer — garde n°1 (élévation de rôle) AVANT tout accès base', () => {
  it("direction tentant de créer un admin : 403 DROIT_INSUFFISANT, la base n'est jamais interrogée", async () => {
    const service = new ServiceUtilisateur(accesQuiEchoueSiInterroge(), motDePasseFactice());

    await expect(
      service.creer(
        CTX,
        { prenom: 'X', nom: 'Y', email: 'x@garage-martin.ch', role: 'admin', siteIds: [ID_SITE] },
        'direction',
      ),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
  });
});

describe('ServiceUtilisateur.creer — chemin heureux', () => {
  it('admin créant un technicien : mot de passe temporaire généré et haché, jamais transmis en clair à la base, retourné une seule fois dans la réponse', async () => {
    const ligneInseree = ligneUtilisateur({ role: 'technicien' });
    const { tx, appels } = construireTxFactice([
      [{ id: ID_SITE }], // verifierSitesDuTenant
      [ligneInseree], // insert(utilisateur).values(...).returning()
      [], // insert(utilisateurSite).values([...])
      [], // insert(auditUtilisateur).values(...)
      [{ id: ID_SITE, nom: 'Site Sion' }], // chargerSites
    ]);
    const motDePasse = motDePasseFactice();
    const service = new ServiceUtilisateur(accesAvec(tx), motDePasse);

    const resultat = await service.creer(
      CTX,
      {
        prenom: 'Julie',
        nom: 'Rey',
        email: 'julie.rey@garage-martin.ch',
        role: 'technicien',
        siteIds: [ID_SITE],
      },
      'admin',
    );

    expect(resultat.acces.motDePasseTemporaire).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(motDePasse.hacher).toHaveBeenCalledWith(resultat.acces.motDePasseTemporaire);
    expect(resultat.utilisateur.sites).toEqual([{ id: ID_SITE, nom: 'Site Sion' }]);
    expect(resultat.utilisateur.statut).toBe('actif');

    // L'INSERT dans utilisateur reçoit le HASH, jamais le mot de passe en clair.
    const appelUtilisateur = appels.find(
      (a) => (a.payload as { motDePasseHash?: string })?.motDePasseHash,
    );
    // Seul le HASH (produit par ServiceMotDePasse.hacher) est écrit — jamais un champ dédié au
    // clair : `entree`/`values(...)` ne comporte aucune clé `motDePasseTemporaire`/`motDePasseClair`.
    expect(appelUtilisateur?.payload).toMatchObject({
      motDePasseHash: `HASH(${resultat.acces.motDePasseTemporaire})`,
    });
    expect(appelUtilisateur?.payload).not.toHaveProperty('motDePasseTemporaire');
    expect(appelUtilisateur?.payload).not.toHaveProperty('motDePasseClair');

    // L'audit ne contient JAMAIS le mot de passe, ni sa forme hachée — seul le fait qu'un compte a
    // été créé, avec le rôle et le statut.
    const appelAudit = appels.find(
      (a) => (a.payload as { action?: string })?.action === 'creation',
    );
    expect(appelAudit?.payload).toMatchObject({
      utilisateurCibleId: ligneInseree.id,
      actionParId: ID_ACTEUR,
      action: 'creation',
      apres: { role: 'technicien', statut: 'actif' },
    });
    expect(JSON.stringify(appelAudit?.payload)).not.toMatch(/HASH|motDePasse/i);
  });
});

describe('ServiceUtilisateur.modifier — garde n°1 AVANT tout accès base', () => {
  it("direction tentant de promouvoir un employé au rôle admin : 403 DROIT_INSUFFISANT, la base n'est jamais interrogée", async () => {
    const service = new ServiceUtilisateur(accesQuiEchoueSiInterroge(), motDePasseFactice());

    await expect(
      service.modifier(CTX, ID_EMPLOYE, { role: 'admin' }, 'direction'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
  });
});

describe('ServiceUtilisateur.modifier — changement de rôle, chemin heureux', () => {
  it('direction changeant un vendeur en chef_atelier (rôle métier, autorisé) : audit modification_role avec avant/après exacts', async () => {
    const avant = ligneUtilisateur({ role: 'vendeur' });
    const apres = ligneUtilisateur({ role: 'chef_atelier' });
    const { tx, appels } = construireTxFactice([
      [avant], // chargerUtilisateurPourEcriture (avant modification)
      [], // update(utilisateur).set({role}).where(...)
      [], // insert(auditUtilisateur).values(...)
      [apres], // chargerUtilisateurPourEcriture (rechargement final)
      [], // chargerSitesParUtilisateur
    ]);
    const service = new ServiceUtilisateur(accesAvec(tx), motDePasseFactice());

    const resultat = await service.modifier(CTX, ID_EMPLOYE, { role: 'chef_atelier' }, 'direction');

    expect(resultat.role).toBe('chef_atelier');
    const appelAudit = appels.find(
      (a) => (a.payload as { action?: string })?.action === 'modification_role',
    );
    expect(appelAudit?.payload).toMatchObject({
      utilisateurCibleId: ID_EMPLOYE,
      actionParId: ID_ACTEUR,
      action: 'modification_role',
      avant: { role: 'vendeur' },
      apres: { role: 'chef_atelier' },
    });
  });
});

describe('ServiceUtilisateur.desactiver — auto-désactivation refusée AVANT tout accès base', () => {
  it("un acteur qui tente de désactiver son propre compte reçoit 409 CONFLIT, la base n'est jamais interrogée", async () => {
    const service = new ServiceUtilisateur(accesQuiEchoueSiInterroge(), motDePasseFactice());

    await expect(service.desactiver(CTX, ID_ACTEUR)).rejects.toMatchObject({
      code: 'CONFLIT',
      status: 409,
    });
  });
});

describe('ServiceUtilisateur.desactiver — chemin heureux', () => {
  it('désactive, révoque les sessions actives, et journalise avant/après statut', async () => {
    const avant = ligneUtilisateur({ statut: 'actif' });
    const apres = ligneUtilisateur({ statut: 'suspendu' });
    const { tx, appels } = construireTxFactice([
      [avant], // chargerUtilisateurPourEcriture
      [], // update(utilisateur).set({statut:'suspendu'})
      [], // revoquerSessionsActives : update(session)
      [], // insert(auditUtilisateur)
      [apres], // rechargement final
      [], // chargerSitesParUtilisateur
    ]);
    const service = new ServiceUtilisateur(accesAvec(tx), motDePasseFactice());

    const resultat = await service.desactiver(CTX, ID_EMPLOYE);

    expect(resultat.statut).toBe('suspendu');
    expect(
      appels.some((a) => (a.payload as { revoqueeLe?: Date })?.revoqueeLe instanceof Date),
    ).toBe(true);
    const appelAudit = appels.find(
      (a) => (a.payload as { action?: string })?.action === 'desactivation',
    );
    expect(appelAudit?.payload).toMatchObject({
      avant: { statut: 'actif' },
      apres: { statut: 'suspendu' },
    });
  });
});

describe('ServiceUtilisateur.reinitialiserAcces — jamais de mot de passe en clair, ni dans la base ni dans l’audit', () => {
  it('génère un nouveau mot de passe, le hache, révoque les sessions, et journalise le geste sans jamais écrire sa valeur', async () => {
    const ligne = ligneUtilisateur();
    const { tx, appels } = construireTxFactice([
      [ligne], // chargerUtilisateurPourEcriture
      [], // update(utilisateur).set({motDePasseHash, echecsConnexion:0, verrouilleJusquA:null})
      [], // revoquerSessionsActives
      [], // insert(auditUtilisateur)
    ]);
    const motDePasse = motDePasseFactice();
    const service = new ServiceUtilisateur(accesAvec(tx), motDePasse);

    const resultat = await service.reinitialiserAcces(CTX, ID_EMPLOYE);

    expect(resultat.motDePasseTemporaire).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(motDePasse.hacher).toHaveBeenCalledWith(resultat.motDePasseTemporaire);

    const appelUpdateUtilisateur = appels.find(
      (a) => (a.payload as { motDePasseHash?: string })?.motDePasseHash,
    );
    expect(appelUpdateUtilisateur?.payload).toMatchObject({
      motDePasseHash: `HASH(${resultat.motDePasseTemporaire})`,
      echecsConnexion: 0,
      verrouilleJusquA: null,
    });

    const appelAudit = appels.find(
      (a) => (a.payload as { action?: string })?.action === 'reinitialisation_acces',
    );
    expect(appelAudit?.payload).toMatchObject({
      utilisateurCibleId: ID_EMPLOYE,
      actionParId: ID_ACTEUR,
      action: 'reinitialisation_acces',
      avant: null,
      apres: null,
    });
    // Aucune trace du mot de passe (clair ou haché) dans la ligne d'audit elle-même.
    expect(JSON.stringify(appelAudit?.payload)).not.toContain(resultat.motDePasseTemporaire);
    expect(JSON.stringify(appelAudit?.payload)).not.toMatch(/HASH/);
  });
});
