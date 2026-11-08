import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  IDS_PREREGLAGE,
  PREREGLAGES,
  ROLES_PERSONNE,
  ROLES_UTILISATEUR,
  CAPACITES,
  type RoleUtilisateur,
} from '@dfa/shared';

import { CAPACITE_DE_L_ACTION } from './capacites-actions';
import {
  ACTIONS_PROFIL_BORNE,
  DROIT_PAR_CONFIRMATION,
  MATRICE_DROITS,
  TOUTES_ACTIONS,
  actionsDeLaGrille,
  type Action,
} from './matrice-droits';
import { MATRICE_DROITS_HISTORIQUE } from './matrice-droits-historique';

/**
 * Matrice d'exécution = préréglages. La preuve centrale : AUCUNE personne ne perd un droit à la
 * migration (`droits(préréglage du rôle) ⊇ droits historiques`), vérifiée sur chaque action et
 * chaque rôle, et les AJOUTS sont listés en dur pour qu'ils ne grossissent jamais en silence.
 */

/** Attributions NOUVELLES par préréglage (à relire par le propriétaire). Valeurs exactes. */
const AJOUTS_ATTENDUS: Readonly<Record<string, readonly string[]>> = {
  admin: [],
  direction: [],
  vendeur: [
    'facturation.avoir.plafonne',
    'facturation.document.emettre_avoir',
    'ventes.vehicule_stock.creer',
    'ventes.vehicule_stock.modifier',
  ],
  receptionnaire: [],
  chef_atelier: ['facturation.avoir.plafonne', 'rendez_vous.creer'],
  technicien: ['atelier.journal.lire'],
  magasinier: [
    'atelier.journal.lire',
    'atelier.or.demarrer',
    'atelier.or.passer_en_controle',
    'courtoisie.lire',
    'facturation.avoir.plafonne',
    'pieces.parametrage.modifier',
    'rendez_vous.lire',
    'vehicule.travail_reporte.signaler',
    'ventes.dossier.lire',
    'ventes.vehicule_stock.lire',
  ],
  comptable: ['atelier.journal.lire', 'courtoisie.lire', 'rendez_vous.lire'],
};

describe('préréglages ⊇ matrice historique (aucun droit retiré)', () => {
  for (const role of ROLES_PERSONNE) {
    it(`${role} : chacune des actions historiques est conservée`, () => {
      const derives = new Set<Action>(MATRICE_DROITS[role]);
      const perdues = MATRICE_DROITS_HISTORIQUE[role].filter((a) => !derives.has(a));
      expect(perdues).toEqual([]);
    });

    it(`${role} : les attributions ajoutées sont exactement celles validées`, () => {
      const historiques = new Set<Action>(MATRICE_DROITS_HISTORIQUE[role]);
      const ajouts = MATRICE_DROITS[role].filter((a) => !historiques.has(a)).sort();
      expect(ajouts).toEqual([...(AJOUTS_ATTENDUS[role] ?? [])].sort());
    });
  }

  it('admin (compte technique, RF-115) : aucun droit financier, pièces ni ventes, aucun geste patron', () => {
    const interdits = MATRICE_DROITS.admin.filter(
      (a) =>
        /^(pieces|ventes|relances|tableau_bord\.financier)\./.test(a) ||
        /^facturation\.(paiement|export|parametrage|avoir|document\.(creer|modifier|transitionner|emettre|corriger|imprimer))/.test(
          a,
        ),
    );
    expect(interdits).toEqual([]);
    expect(MATRICE_DROITS.admin).not.toContain('reprise.import.lancer');
    expect(MATRICE_DROITS.admin).not.toContain('reprise.plan.valider');
    expect(MATRICE_DROITS.admin).not.toContain('facturation.parametrage.creancier.modifier');
  });

  it('gestes irréversibles (IBAN, lancement de la reprise, validation du plan) : direction seule', () => {
    for (const action of [
      'facturation.parametrage.creancier.modifier',
      'reprise.import.lancer',
      'reprise.plan.valider',
    ] as const) {
      const titulaires = ROLES_UTILISATEUR.filter((r) => MATRICE_DROITS[r].includes(action));
      expect(titulaires).toEqual(['direction']);
    }
  });

  it("le comptable ne modifie pas l'IBAN (PR #31) et garde l'export fiduciaire", () => {
    expect(MATRICE_DROITS.comptable).not.toContain('facturation.parametrage.creancier.modifier');
    expect(MATRICE_DROITS.comptable).toContain('facturation.export.lire');
  });

  it('direction détient tout sauf la contrainte de plafond et le geste réservé à la borne', () => {
    const manquantes = TOUTES_ACTIONS.filter((a) => !MATRICE_DROITS.direction.includes(a));
    expect(manquantes.sort()).toEqual([
      'atelier.pointage.identifier',
      'facturation.avoir.plafonne',
    ]);
  });
});

describe('borne (poste_atelier) : profil d’appareil figé', () => {
  it('garde exactement ses 7 actions historiques', () => {
    expect([...MATRICE_DROITS.poste_atelier].sort()).toEqual(
      [...MATRICE_DROITS_HISTORIQUE.poste_atelier].sort(),
    );
    expect([...ACTIONS_PROFIL_BORNE]).toHaveLength(7);
  });

  it('la borne n’a EXACTEMENT que ces 7 actions : aucune écriture OR, aucune facturation, aucun client, aucun réglage', () => {
    expect([...MATRICE_DROITS.poste_atelier].sort()).toEqual(
      [
        'atelier.or.lire',
        'atelier.pointage.arreter',
        'atelier.pointage.demarrer',
        'atelier.pointage.identifier',
        'atelier.pointage.lire',
        'socle.site.lire',
        'socle.tenant.lire',
      ].sort(),
    );
    for (const a of [
      'facturation.document.lire',
      'accueil.demarrage.lire',
      'tableau_bord.activite.lire',
      'atelier.or.creer',
      'atelier.pointage.pointer_autrui',
      'socle.utilisateur.lire',
    ] as const) {
      expect(MATRICE_DROITS.poste_atelier, a).not.toContain(a);
    }
  });

  it('personne d’autre ne peut pointer par PIN (atelier.pointage.identifier)', () => {
    for (const role of ROLES_PERSONNE) {
      expect(MATRICE_DROITS[role]).not.toContain('atelier.pointage.identifier');
    }
  });
});

describe('table action -> capacités', () => {
  it('classe chaque action, avec des capacités connues', () => {
    const connues = new Set<string>(CAPACITES);
    for (const action of TOUTES_ACTIONS) {
      const classement = CAPACITE_DE_L_ACTION[action];
      expect(classement, action).toBeDefined();
      const liste = typeof classement === 'string' ? [classement] : classement;
      expect(liste.length, action).toBeGreaterThan(0);
      for (const c of liste) expect(connues.has(c), `${action} -> ${c}`).toBe(true);
    }
  });

  it('ne classe aucune action fantôme', () => {
    const toutes = new Set<string>(TOUTES_ACTIONS);
    expect(Object.keys(CAPACITE_DE_L_ACTION).filter((a) => !toutes.has(a))).toEqual([]);
  });

  it('toute confirmation pointe vers une action classée', () => {
    for (const action of Object.values(DROIT_PAR_CONFIRMATION)) {
      expect(CAPACITE_DE_L_ACTION[action]).toBeDefined();
    }
  });

  it('chaque préréglage correspond à un rôle d’origine valide, et MATRICE_DROITS couvre tous les rôles', () => {
    expect(Object.keys(MATRICE_DROITS).sort()).toEqual([...ROLES_UTILISATEUR].sort());
    for (const id of IDS_PREREGLAGE) {
      expect(ROLES_PERSONNE).toContain(PREREGLAGES[id].roleOrigine);
    }
  });

  it('MATRICE_DROITS[role] est exactement les actions de la grille du préréglage', () => {
    for (const role of ROLES_PERSONNE) {
      expect(MATRICE_DROITS[role as RoleUtilisateur]).toEqual(
        actionsDeLaGrille(PREREGLAGES[role].grille),
      );
    }
  });
});

describe('migration 0087 : le SQL recopie exactement les préréglages', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'db', 'migrations', '0087_capacites_par_personne.sql'),
    'utf8',
  );
  const lignes = [
    ...sql.matchAll(
      /^\s+\('([a-z_]+)', ((?:'[a-z]+'|true|false)(?:, (?:'[a-z]+'|true|false))*)\)/gm,
    ),
  ];

  it('contient une ligne par rôle de personne et la borne', () => {
    expect(lignes.map((l) => l[1]).sort()).toEqual([...ROLES_UTILISATEUR].sort());
  });

  for (const role of ROLES_PERSONNE) {
    it(`${role} : valeurs SQL identiques à PREREGLAGES`, () => {
      const ligne = lignes.find((l) => l[1] === role);
      expect(ligne).toBeDefined();
      const valeurs = (ligne?.[2] ?? '').split(', ').map((v) => v.replace(/'/g, ''));
      const g = PREREGLAGES[role].grille;
      expect(valeurs).toEqual([
        g.niveaux.atelier,
        g.niveaux.accueil,
        g.niveaux.facturation,
        g.niveaux.pieces,
        g.niveaux.ventes,
        g.niveaux.finances,
        String(g.encadrer),
        String(g.gererEmployes),
        String(g.patron),
        String(g.options.voitMontants),
        String(g.options.voitPrixAchat),
        String(g.options.avoirsPlafonnes),
      ]);
    });
  }
});

describe('droits vus par le menu et l’accueil (audit navigateur du 07.11.2026)', () => {
  it('vendeur : aucune lecture atelier / rendez-vous / pointage (le menu ne doit rien lui proposer qui parte en 403)', () => {
    for (const a of [
      'atelier.or.lire',
      'rendez_vous.lire',
      'atelier.ligne.marquer_realisee',
      'accueil.demarrage.lire',
    ] as const) {
      expect(MATRICE_DROITS.vendeur, a).not.toContain(a);
    }
    expect(MATRICE_DROITS.vendeur).toContain('tableau_bord.activite.lire');
  });

  it('accueil.demarrage.lire : direction et admin seulement (chef d’atelier exclu : la checklist ne doit pas l’appeler)', () => {
    const titulaires = ROLES_PERSONNE.filter((r) =>
      MATRICE_DROITS[r as RoleUtilisateur].includes('accueil.demarrage.lire'),
    ).sort();
    expect(titulaires).toEqual(['admin', 'direction']);
  });

  it('parametrage.modules.modifier : direction et admin seulement, chef d’atelier refusé en écriture mais lecture gardée', () => {
    const titulaires = ROLES_PERSONNE.filter((r) =>
      MATRICE_DROITS[r as RoleUtilisateur].includes('parametrage.modules.modifier'),
    ).sort();
    expect(titulaires).toEqual(['admin', 'direction']);
    expect(MATRICE_DROITS.chef_atelier).not.toContain('parametrage.modules.modifier');
    expect(MATRICE_DROITS.chef_atelier).toContain('parametrage.atelier.lire');
  });

  it('parametrage.envoi_courriel.gerer : direction et admin seulement, aucun autre rôle (chef d’atelier compris)', () => {
    const titulaires = ROLES_UTILISATEUR.filter((r) =>
      MATRICE_DROITS[r].includes('parametrage.envoi_courriel.gerer'),
    ).sort();
    expect(titulaires).toEqual(['admin', 'direction']);
    for (const role of [
      'chef_atelier',
      'comptable',
      'vendeur',
      'receptionnaire',
      'technicien',
      'magasinier',
      'poste_atelier',
    ] as const) {
      expect(MATRICE_DROITS[role], role).not.toContain('parametrage.envoi_courriel.gerer');
    }
  });
});
