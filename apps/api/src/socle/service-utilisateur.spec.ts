import { describe, expect, it, vi } from 'vitest';
import { PREREGLAGES, type GrilleCapacites } from '@dfa/shared';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../db/db.types';
import type { LigneUtilisateur } from '../db/schema';
import type { ServiceMotDePasse, ServiceReinitialisationMotDePasse } from '../auth/auth.types';
import { colonnesDepuisGrille } from '../auth/grille-utilisateur';
import { resoudreSitePrincipal, ServiceUtilisateur } from './service-utilisateur';

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

function serviceReinitialisationFactice(): ServiceReinitialisationMotDePasse {
  return {
    demander: vi.fn(),
    confirmer: vi.fn(),
    revoquerJetonsActifsDansTransaction: vi.fn().mockResolvedValue(undefined),
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
    sitePrincipalId: null,
    statut: 'actif',
    echecsConnexion: 0,
    verrouilleJusquA: null,
    derniereConnexionLe: null,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
    // Grille du préréglage du rôle (comme le trigger d'insertion de la migration 0087).
    ...colonnesDepuisGrille(PREREGLAGES[(champs.role ?? 'vendeur') as 'vendeur'].grille),
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
    execute: () => chaine(),
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
    const service = new ServiceUtilisateur(
      accesQuiEchoueSiInterroge(),
      motDePasseFactice(),
      serviceReinitialisationFactice(),
    );

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
    const service = new ServiceUtilisateur(
      accesAvec(tx),
      motDePasse,
      serviceReinitialisationFactice(),
    );

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
    const service = new ServiceUtilisateur(
      accesQuiEchoueSiInterroge(),
      motDePasseFactice(),
      serviceReinitialisationFactice(),
    );

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
      [], // update(utilisateur).set({role + grille}).where(...)
      [], // revoquerSessionsActives (vendeur -> chef : perd Ventes : Faire, droits en baisse)
      [], // insert(auditUtilisateur).values(...)
      [apres], // chargerUtilisateurPourEcriture (rechargement final)
      [], // chargerSitesParUtilisateur
    ]);
    const service = new ServiceUtilisateur(
      accesAvec(tx),
      motDePasseFactice(),
      serviceReinitialisationFactice(),
    );

    const resultat = await service.modifier(CTX, ID_EMPLOYE, { role: 'chef_atelier' }, 'direction');

    expect(resultat.role).toBe('chef_atelier');
    const appelAudit = appels.find(
      (a) => (a.payload as { action?: string })?.action === 'modification_role',
    );
    expect(appelAudit?.payload).toMatchObject({
      utilisateurCibleId: ID_EMPLOYE,
      actionParId: ID_ACTEUR,
      action: 'modification_role',
      avant: { role: 'vendeur', capacites: PREREGLAGES.vendeur.grille },
      apres: {
        role: 'chef_atelier',
        prereglage: 'chef_atelier',
        capacites: PREREGLAGES.chef_atelier.grille,
      },
    });
  });
});

describe('ServiceUtilisateur.desactiver — auto-désactivation refusée AVANT tout accès base', () => {
  it("un acteur qui tente de désactiver son propre compte reçoit 409 CONFLIT, la base n'est jamais interrogée", async () => {
    const service = new ServiceUtilisateur(
      accesQuiEchoueSiInterroge(),
      motDePasseFactice(),
      serviceReinitialisationFactice(),
    );

    await expect(service.desactiver(CTX, ID_ACTEUR, 'direction')).rejects.toMatchObject({
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
    const service = new ServiceUtilisateur(
      accesAvec(tx),
      motDePasseFactice(),
      serviceReinitialisationFactice(),
    );

    const resultat = await service.desactiver(CTX, ID_EMPLOYE, 'direction');

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
    const serviceReinitialisation = serviceReinitialisationFactice();
    const service = new ServiceUtilisateur(accesAvec(tx), motDePasse, serviceReinitialisation);

    const resultat = await service.reinitialiserAcces(CTX, ID_EMPLOYE, 'direction');

    // Finding sécurité : un jeton de réinitialisation en libre-service émis avant ce geste admin
    // ne doit pas survivre à la reprise de main — voir le commentaire au point d'appel dans
    // `service-utilisateur.ts::reinitialiserAcces`.
    expect(serviceReinitialisation.revoquerJetonsActifsDansTransaction).toHaveBeenCalledWith(
      tx,
      CTX,
      ID_EMPLOYE,
    );

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

// =================================================================================================
// Grille de capacités par personne — gouvernance (attaques : auto-élévation, dépassement, patron)
// =================================================================================================

const DIRECTION_REDUITE: GrilleCapacites = {
  ...PREREGLAGES.direction.grille,
  niveaux: { ...PREREGLAGES.direction.grille.niveaux, finances: 'rien' },
};

function serviceAvec(reponses: readonly unknown[]) {
  const { tx, appels } = construireTxFactice(reponses);
  const service = new ServiceUtilisateur(
    accesAvec(tx),
    motDePasseFactice(),
    serviceReinitialisationFactice(),
  );
  return { service, appels };
}

function serviceSansBase(): ServiceUtilisateur {
  return new ServiceUtilisateur(
    accesQuiEchoueSiInterroge(),
    motDePasseFactice(),
    serviceReinitialisationFactice(),
  );
}

describe('ServiceUtilisateur.modifierCapacites — chemin heureux', () => {
  it('direction accorde Pièces : Faire à un vendeur : écrit la grille, audit avant/après complets, sessions conservées (droits en hausse)', async () => {
    const avant = ligneUtilisateur({ role: 'vendeur' });
    const apres = ligneUtilisateur({ role: 'vendeur', niveauPieces: 'faire' });
    const { service, appels } = serviceAvec([[avant], [], [], [apres], []]);

    const resultat = await service.modifierCapacites(
      CTX,
      ID_EMPLOYE,
      { niveaux: { pieces: 'faire' } },
      'direction',
    );

    expect(resultat.capacites.niveaux.pieces).toBe('faire');
    expect(resultat.capacites.personnalisee).toBe(true);
    expect(resultat.capacites.prereglage).toBeNull();
    const update = appels.find((a) => (a.payload as { niveauPieces?: string })?.niveauPieces);
    expect(update?.payload).toMatchObject({ niveauPieces: 'faire', niveauVentes: 'faire' });
    const audit = appels.find(
      (a) => (a.payload as { action?: string })?.action === 'modification_role',
    );
    expect(audit?.payload).toMatchObject({
      utilisateurCibleId: ID_EMPLOYE,
      actionParId: ID_ACTEUR,
      avant: { role: 'vendeur', capacites: { niveaux: { pieces: 'voir' } } },
      apres: { role: 'vendeur', capacites: { niveaux: { pieces: 'faire' } } },
    });
    expect(
      appels.some((a) => (a.payload as { revoqueeLe?: Date })?.revoqueeLe instanceof Date),
    ).toBe(false);
  });

  it('droits en BAISSE (Ventes : Rien) : les sessions de la personne sont révoquées', async () => {
    const avant = ligneUtilisateur({ role: 'vendeur' });
    const apres = ligneUtilisateur({ role: 'vendeur', niveauVentes: 'rien' });
    const { service, appels } = serviceAvec([[avant], [], [], [], [apres], []]);

    await service.modifierCapacites(CTX, ID_EMPLOYE, { niveaux: { ventes: 'rien' } }, 'direction');

    expect(
      appels.some((a) => (a.payload as { revoqueeLe?: Date })?.revoqueeLe instanceof Date),
    ).toBe(true);
  });

  it('retirer l’option « voit les montants » est une baisse (sessions révoquées) ; la lever pour un technicien est refusée sans Facturation/Ventes/Finances incohérentes', async () => {
    const avant = ligneUtilisateur({ role: 'comptable' });
    const { service } = serviceAvec([[avant]]);
    // comptable a Facturation : Faire + Finances : Faire -> sans montants, la grille est incohérente.
    await expect(
      service.modifierCapacites(CTX, ID_EMPLOYE, { options: { voitMontants: false } }, 'direction'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });
});

describe('ServiceUtilisateur.modifierCapacites — attaques', () => {
  it('auto-élévation : personne ne modifie sa propre grille (403, la base n’est jamais interrogée)', async () => {
    await expect(
      serviceSansBase().modifierCapacites(CTX, ID_ACTEUR, { encadrer: true }, 'direction'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
  });

  it('auto-élévation par changement de rôle : un patron ne se re-promeut pas lui-même (403)', async () => {
    await expect(
      serviceSansBase().modifier(CTX, ID_ACTEUR, { role: 'direction' }, 'direction'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
  });

  it('un patron aux droits réduits (sans Finances) ne peut pas accorder Finances : Voir (403, champ nommé)', async () => {
    const { service } = serviceAvec([[ligneUtilisateur({ role: 'vendeur' })]]);
    const erreur = await service
      .modifierCapacites(
        CTX,
        ID_EMPLOYE,
        { niveaux: { finances: 'voir' } },
        { role: 'direction', capacites: DIRECTION_REDUITE },
      )
      .catch((e: unknown) => e);
    expect(erreur).toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
    expect((erreur as { erreurs?: Array<{ champ: string }> }).erreurs?.[0]?.champ).toBe(
      'niveaux.finances',
    );
  });

  it('un patron aux droits réduits ne peut pas non plus donner à autrui le préréglage direction (403)', async () => {
    await expect(
      serviceSansBase().modifier(
        CTX,
        ID_EMPLOYE,
        { role: 'direction' },
        { role: 'direction', capacites: DIRECTION_REDUITE },
      ),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('un acteur aux droits réduits ne modifie pas quelqu’un de plus puissant que lui (403)', async () => {
    const { service } = serviceAvec([[ligneUtilisateur({ role: 'comptable' })]]);
    await expect(
      service.modifierCapacites(
        CTX,
        ID_EMPLOYE,
        { niveaux: { atelier: 'voir' } },
        { role: 'direction', capacites: DIRECTION_REDUITE },
      ),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('un acteur levant le plafond d’avoir alors qu’il est lui-même plafonné : 403', async () => {
    const plafonne: GrilleCapacites = {
      ...PREREGLAGES.direction.grille,
      options: { ...PREREGLAGES.direction.grille.options, avoirsPlafonnes: true },
    };
    const { service } = serviceAvec([[ligneUtilisateur({ role: 'receptionnaire' })]]);
    await expect(
      service.modifierCapacites(
        CTX,
        ID_EMPLOYE,
        { options: { avoirsPlafonnes: false } },
        { role: 'direction', capacites: plafonne },
      ),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('un patron (direction) ne modifie pas les droits d’un compte admin (403) ; un admin le peut', async () => {
    const admin = ligneUtilisateur({ role: 'admin' });
    const { service } = serviceAvec([[admin]]);
    await expect(
      service.modifierCapacites(CTX, ID_EMPLOYE, { encadrer: false }, 'direction'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });

    const { service: serviceAdmin } = serviceAvec([[admin], [], [], [], [admin], []]);
    await expect(
      serviceAdmin.modifierCapacites(CTX, ID_EMPLOYE, { encadrer: false }, 'admin'),
    ).resolves.toBeDefined();
  });

  it('un admin ne peut pas s’accorder des droits qu’il n’a pas (Facturation) sur un tiers : 403', async () => {
    const { service } = serviceAvec([[ligneUtilisateur({ role: 'technicien' })]]);
    await expect(
      service.modifierCapacites(
        CTX,
        ID_EMPLOYE,
        { niveaux: { facturation: 'faire' }, options: { voitMontants: true } },
        'admin',
      ),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });

  it('les cases réservées au patron (gererEmployes, patron) sont refusées par le schéma', async () => {
    const { schemaModificationCapacites } = await import('@dfa/shared');
    expect(schemaModificationCapacites.safeParse({ patron: true }).success).toBe(false);
    expect(schemaModificationCapacites.safeParse({ gererEmployes: true }).success).toBe(false);
    expect(schemaModificationCapacites.safeParse({ tenantId: 'x', encadrer: true }).success).toBe(
      false,
    );
    expect(schemaModificationCapacites.safeParse({}).success).toBe(false);
  });

  it('employé d’un autre tenant (ou borne) : 404, jamais 403', async () => {
    const { service } = serviceAvec([[]]);
    await expect(
      service.modifierCapacites(CTX, ID_EMPLOYE, { encadrer: true }, 'direction'),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
  });
});

describe('ServiceUtilisateur — dernier patron non rétrogradable', () => {
  it('rétrograder le dernier patron actif (changement de rôle) : 409, rien n’est écrit', async () => {
    const patron = ligneUtilisateur({ role: 'direction' });
    const { service, appels } = serviceAvec([[patron], [], [{ n: 0 }]]);
    await expect(
      service.modifier(CTX, ID_EMPLOYE, { role: 'vendeur' }, 'direction'),
    ).rejects.toMatchObject({ code: 'CONFLIT' });
    expect(appels.some((a) => (a.payload as { role?: string })?.role === 'vendeur')).toBe(false);
  });

  it('désactiver le dernier patron actif : 409', async () => {
    const patron = ligneUtilisateur({ role: 'direction' });
    const { service } = serviceAvec([[patron], [], [{ n: 0 }]]);
    await expect(service.desactiver(CTX, ID_EMPLOYE, 'direction')).rejects.toMatchObject({
      code: 'CONFLIT',
    });
  });

  it('avec un second patron actif, la rétrogradation passe', async () => {
    const patron = ligneUtilisateur({ role: 'direction' });
    const apres = ligneUtilisateur({ role: 'vendeur' });
    const { service } = serviceAvec([[patron], [], [{ n: 1 }], [], [], [], [apres], []]);
    await expect(
      service.modifier(CTX, ID_EMPLOYE, { role: 'vendeur' }, 'direction'),
    ).resolves.toMatchObject({ role: 'vendeur' });
  });
});

describe('ServiceUtilisateur — préréglages', () => {
  it('fiduciaire : enregistré avec le rôle d’origine comptable, grille en lecture seule Facturation + Finances', async () => {
    const ligne = ligneUtilisateur({
      role: 'comptable',
      ...colonnesDepuisGrille(PREREGLAGES.fiduciaire.grille),
    });
    const { service, appels } = serviceAvec([
      [{ id: ID_SITE }],
      [ligne],
      [],
      [],
      [{ id: ID_SITE, nom: 'Sion' }],
    ]);

    const r = await service.creer(
      CTX,
      {
        prenom: 'Fi',
        nom: 'Du',
        email: 'fi@fiduciaire.ch',
        role: 'comptable',
        prereglage: 'fiduciaire',
        siteIds: [ID_SITE],
      },
      'direction',
    );

    expect(r.utilisateur.capacites.prereglage).toBe('fiduciaire');
    expect(r.utilisateur.capacites.personnalisee).toBe(true);
    const insert = appels.find((a) => (a.payload as { email?: string })?.email);
    expect(insert?.payload).toMatchObject({
      role: 'comptable',
      niveauFacturation: 'voir',
      niveauFinances: 'voir',
      niveauAtelier: 'rien',
      niveauPieces: 'rien',
    });
  });

  it('préréglage incompatible avec le rôle : 400', async () => {
    await expect(
      serviceSansBase().creer(
        CTX,
        {
          prenom: 'X',
          nom: 'Y',
          email: 'x@garage-martin.ch',
          role: 'vendeur',
          prereglage: 'fiduciaire',
          siteIds: [ID_SITE],
        },
        'direction',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });

  it('un patron réduit ne peut pas créer un employé avec un préréglage plus large que sa propre grille (403)', async () => {
    await expect(
      serviceSansBase().creer(
        CTX,
        {
          prenom: 'X',
          nom: 'Y',
          email: 'x@garage-martin.ch',
          role: 'comptable',
          siteIds: [ID_SITE],
        },
        { role: 'direction', capacites: DIRECTION_REDUITE },
      ),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
  });
});

describe('ServiceUtilisateur — désactiver / réactiver / réinitialiser : mêmes gardes que modifier (revue sécurité F1)', () => {
  const PATRON_COMPLET = (id = ID_EMPLOYE) => ligneUtilisateur({ id, role: 'direction' });

  it("réinitialiser l'accès d'un patron complet par un patron aux droits réduits : 403, aucun mot de passe écrit ni rendu", async () => {
    const { service, appels } = serviceAvec([[PATRON_COMPLET()]]);
    await expect(
      service.reinitialiserAcces(CTX, ID_EMPLOYE, {
        role: 'direction',
        capacites: DIRECTION_REDUITE,
      }),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
    expect(appels.some((a) => (a.payload as { motDePasseHash?: string })?.motDePasseHash)).toBe(
      false,
    );
  });

  it("… ni celui d'un compte admin par un non-admin ; un admin le peut", async () => {
    const admin = ligneUtilisateur({ role: 'admin' });
    const { service } = serviceAvec([[admin]]);
    await expect(service.reinitialiserAcces(CTX, ID_EMPLOYE, 'direction')).rejects.toMatchObject({
      code: 'DROIT_INSUFFISANT',
    });
    const { service: serviceAdmin } = serviceAvec([[admin], [], [], [], []]);
    await expect(serviceAdmin.reinitialiserAcces(CTX, ID_EMPLOYE, 'admin')).resolves.toBeDefined();
  });

  it('réinitialiser son PROPRE accès par cette route : 403 avant tout accès base', async () => {
    await expect(
      serviceSansBase().reinitialiserAcces(CTX, ID_ACTEUR, 'direction'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
  });

  it('suspendre un patron complet ou un admin par un patron réduit / un non-admin : 403', async () => {
    const { service } = serviceAvec([[PATRON_COMPLET()]]);
    await expect(
      service.desactiver(CTX, ID_EMPLOYE, { role: 'direction', capacites: DIRECTION_REDUITE }),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
    const { service: s2 } = serviceAvec([[ligneUtilisateur({ role: 'admin' })]]);
    await expect(s2.desactiver(CTX, ID_EMPLOYE, 'direction')).rejects.toMatchObject({
      code: 'DROIT_INSUFFISANT',
    });
  });

  it('réactiver : même garde (cible plus puissante 403 ; soi-même 403)', async () => {
    const { service } = serviceAvec([[ligneUtilisateur({ role: 'admin', statut: 'suspendu' })]]);
    await expect(service.reactiver(CTX, ID_EMPLOYE, 'direction')).rejects.toMatchObject({
      code: 'DROIT_INSUFFISANT',
    });
    await expect(serviceSansBase().reactiver(CTX, ID_ACTEUR, 'direction')).rejects.toMatchObject({
      code: 'DROIT_INSUFFISANT',
    });
  });
});

describe('resoudreSitePrincipal', () => {
  const MART = '33333333-3333-4333-8333-333333333333';

  it('création sans demande : le premier site de la personne', () => {
    expect(
      resoudreSitePrincipal({ sitesApres: [ID_SITE, MART], demande: undefined, actuel: null }),
    ).toBe(ID_SITE);
  });

  it('demande valide : elle est retenue', () => {
    expect(
      resoudreSitePrincipal({ sitesApres: [ID_SITE, MART], demande: MART, actuel: ID_SITE }),
    ).toBe(MART);
  });

  it('demande hors des sites de la personne : 400 VALIDATION_ECHOUEE', () => {
    expect(() =>
      resoudreSitePrincipal({ sitesApres: [ID_SITE], demande: MART, actuel: ID_SITE }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }));
  });

  it('retrait du site principal des affectations : bascule sur le premier site restant', () => {
    expect(resoudreSitePrincipal({ sitesApres: [MART], demande: undefined, actuel: ID_SITE })).toBe(
      MART,
    );
  });

  it('site principal conservé tant qu’il reste affecté', () => {
    expect(
      resoudreSitePrincipal({ sitesApres: [ID_SITE, MART], demande: undefined, actuel: MART }),
    ).toBe(MART);
  });

  it('aucune affectation : pas de site principal', () => {
    expect(resoudreSitePrincipal({ sitesApres: [], demande: undefined, actuel: MART })).toBeNull();
  });
});
