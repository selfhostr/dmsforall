import { describe, expect, it } from 'vitest';
import { ROLES_UTILISATEUR, type RoleUtilisateur } from '@dfa/shared';

import { type Action, DROIT_PAR_CONFIRMATION, MATRICE_DROITS, ROLES_SANS_MONTANT } from './matrice-droits';

/**
 * Bloquant B3 (rapport QA étape 0) : `Record<RoleUtilisateur, …>` couvre la compilation (un rôle
 * manquant dans `MATRICE_DROITS` fait échouer `pnpm typecheck`), mais rien n'empêche quelqu'un de
 * réélargir le type à `Record<string, …>` pour « débloquer » un typecheck rouge sans réfléchir —
 * exactement ce que faisait le code avant correction. Ce test couvre CE cas-là : une parité
 * vérifiée à l'EXÉCUTION entre `ROLES_UTILISATEUR` (contrat partagé) et les clés réelles de
 * `MATRICE_DROITS`, dans les deux sens (aucun rôle oublié, aucune clé fantôme).
 */
describe('MATRICE_DROITS — parité avec ROLES_UTILISATEUR (bloquant B3)', () => {
  it('contient EXACTEMENT les mêmes rôles que ROLES_UTILISATEUR, ni plus ni moins', () => {
    const rolesMatrice = Object.keys(MATRICE_DROITS).sort();
    const rolesContrat = [...ROLES_UTILISATEUR].sort();

    expect(rolesMatrice).toEqual(rolesContrat);
  });

  it('chaque rôle de ROLES_UTILISATEUR a une entrée définie (jamais undefined) dans MATRICE_DROITS', () => {
    for (const role of ROLES_UTILISATEUR) {
      expect(MATRICE_DROITS[role]).toBeDefined();
      expect(Array.isArray(MATRICE_DROITS[role])).toBe(true);
    }
  });
});

/** Rôles qui détiennent une action donnée, triés pour une comparaison stable. */
function rolesAyant(action: Action): RoleUtilisateur[] {
  return (Object.keys(MATRICE_DROITS) as RoleUtilisateur[])
    .filter((role) => MATRICE_DROITS[role].includes(action))
    .sort();
}

/**
 * Un test par ligne de §10 (`docs/specification-etape-1-atelier-clients.md`, lignes 956-981),
 * nommé d'après la ligne. `admin` n'apparaît dans aucune colonne de §10 (voir tête de fichier) :
 * il est vérifié comme systématiquement présent, au même titre que `direction`, dont il reprend
 * le périmètre par construction. `vendeur` n'apparaît pas non plus : vérifié absent partout sauf
 * lecture (couvert par le test de lecture ci-dessous).
 */
describe('MATRICE_DROITS — §10 de la spec métier, ligne par ligne', () => {
  it('L958 — Créer / modifier un client : réceptionnaire, chef d’atelier, magasinier, direction, admin (pas technicien, pas comptable — lecture seule, pas vendeur)', () => {
    expect(rolesAyant('client.creer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'receptionnaire'].sort(),
    );
    expect(rolesAyant('client.modifier')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'receptionnaire'].sort(),
    );
  });

  it('L960 — Créer / modifier un véhicule : réceptionnaire, chef d’atelier, magasinier, direction, admin (technicien = « km seulement », testé séparément)', () => {
    expect(rolesAyant('vehicule.creer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'receptionnaire'].sort(),
    );
    expect(rolesAyant('vehicule.modifier')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'receptionnaire'].sort(),
    );
    // Le technicien a « km seulement » : jamais l'écriture générale du véhicule.
    expect(MATRICE_DROITS.technicien).not.toContain('vehicule.creer');
    expect(MATRICE_DROITS.technicien).not.toContain('vehicule.modifier');
  });

  it('L960 (nuance technicien) + RM-23 — saisie du kilométrage : réceptionnaire, chef d’atelier, technicien, magasinier, direction, admin', () => {
    expect(rolesAyant('vehicule.kilometrage.saisir')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'receptionnaire', 'technicien'].sort(),
    );
  });

  it('L961 — Changer le détenteur d’un véhicule : réceptionnaire, chef d’atelier, direction, admin', () => {
    expect(rolesAyant('vehicule.detention.changer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L962 — Corriger un kilométrage à la baisse : chef d’atelier, direction, admin (pas réceptionnaire)', () => {
    expect(rolesAyant('vehicule.kilometrage.corriger_regression')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
  });

  it('L965 — Ouvrir un OR : réceptionnaire, chef d’atelier, direction, admin (creer et receptionner)', () => {
    expect(rolesAyant('atelier.or.creer')).toEqual(['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort());
    expect(rolesAyant('atelier.or.receptionner')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L966 — Ajouter une ligne constatée : réceptionnaire, chef d’atelier, technicien, magasinier, direction, admin (pas comptable)', () => {
    expect(rolesAyant('atelier.ligne.creer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'receptionnaire', 'technicien'].sort(),
    );
  });

  it('L967 — Valider une ligne dans le plafond : réceptionnaire, chef d’atelier, direction, admin', () => {
    expect(rolesAyant('atelier.ligne.valider')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L968 — Enregistrer une réponse de devis complémentaire : réceptionnaire, chef d’atelier, direction, admin', () => {
    expect(rolesAyant('atelier.devis.repondre')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L969 — Modifier le montant plafond : réceptionnaire, chef d’atelier, direction, admin', () => {
    expect(rolesAyant('atelier.or.plafond_modifier')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L970/L971 — Appliquer un rabais / passer une ligne en payeur garage : réceptionnaire et chef d’atelier (bornés à P-13 en service), direction et admin (sans limite) — jamais technicien/magasinier/comptable', () => {
    expect(rolesAyant('atelier.ligne.modifier')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L975 — Valider le contrôle qualité : chef d’atelier, technicien, direction, admin (pas réceptionnaire)', () => {
    expect(rolesAyant('atelier.or.controler')).toEqual(['admin', 'chef_atelier', 'direction', 'technicien'].sort());
  });

  it('L976 — Passer l’OR à terminé : réceptionnaire, chef d’atelier, direction, admin', () => {
    expect(rolesAyant('atelier.or.terminer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L978 — Restituer le véhicule : réceptionnaire, chef d’atelier, direction, admin', () => {
    expect(rolesAyant('atelier.or.restituer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('L979 — Annuler un OR : réceptionnaire, chef d’atelier, direction, admin', () => {
    expect(rolesAyant('atelier.or.annuler')).toEqual(['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort());
  });

  it('L959, L963, L964, L972-974, L977, L980-981 — hors périmètre du lot 1 (Δ4 : fusion client, RDV, pointage, facturation étape 2, rétention, indicateurs) : aucune action de ces domaines n’existe', () => {
    const toutesActionsAccordees = new Set(Object.values(MATRICE_DROITS).flat());
    for (const action of toutesActionsAccordees) {
      expect(action.startsWith('rendez_vous.creer')).toBe(false);
      expect(action.startsWith('pointage.')).toBe(false);
      expect(action).not.toBe('client.fusionner');
      expect(action).not.toBe('atelier.or.facturer');
      expect(action).not.toBe('atelier.retention.lever');
      expect(action).not.toBe('atelier.productivite.lire');
    }
  });
});

describe('MATRICE_DROITS — actions inférées (aucune ligne §10 littérale)', () => {
  it('client.condition.modifier — direction et admin seuls (RM-07, distinct du rabais par ligne §10 L970 borné P-13)', () => {
    expect(rolesAyant('client.condition.modifier')).toEqual(['admin', 'direction'].sort());
  });

  it('parametrage.atelier.modifier / parametrage.referentiel.modifier — chef d’atelier, direction, admin uniquement', () => {
    expect(rolesAyant('parametrage.atelier.modifier')).toEqual(['admin', 'chef_atelier', 'direction'].sort());
    expect(rolesAyant('parametrage.referentiel.modifier')).toEqual(['admin', 'chef_atelier', 'direction'].sort());
  });

  it('atelier.or.demarrer / atelier.or.passer_en_controle — chef d’atelier, technicien, direction, admin (T-04/T-11) : pas réceptionnaire', () => {
    expect(rolesAyant('atelier.or.demarrer')).toEqual(['admin', 'chef_atelier', 'direction', 'technicien'].sort());
    expect(rolesAyant('atelier.or.passer_en_controle')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'technicien'].sort(),
    );
    expect(MATRICE_DROITS.receptionnaire).not.toContain('atelier.or.demarrer');
  });

  it('atelier.or.rouvrir — chef d’atelier, direction, admin (T-15) : pas réceptionnaire, réouverture technique', () => {
    expect(rolesAyant('atelier.or.rouvrir')).toEqual(['admin', 'chef_atelier', 'direction'].sort());
  });

  it('atelier.ligne.marquer_realisee — chef d’atelier, technicien, direction, admin : le technicien clôt sa propre exécution', () => {
    expect(rolesAyant('atelier.ligne.marquer_realisee')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'technicien'].sort(),
    );
  });

  it('atelier.or.cloturer — réceptionnaire, chef d’atelier, direction, admin, symétrique de restituer/terminer/annuler (T-19)', () => {
    expect(rolesAyant('atelier.or.cloturer')).toEqual(['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort());
  });

  it('vehicule.detention.corriger — chef d’atelier, direction, admin (correction sensible, symétrique du kilométrage à la baisse)', () => {
    expect(rolesAyant('vehicule.detention.corriger')).toEqual(['admin', 'chef_atelier', 'direction'].sort());
  });

  it('atelier.journal.lire — réceptionnaire, chef d’atelier, direction, admin uniquement (pas technicien/magasinier/comptable)', () => {
    expect(rolesAyant('atelier.journal.lire')).toEqual(['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort());
  });
});

describe('MATRICE_DROITS — lecture large (LECTURE_SOCLE et LECTURE_ETENDUE)', () => {
  it('recherche.executer, parametrage.*.lire, client.lire, vehicule.lire — accordés aux 8 rôles', () => {
    const lectures: Action[] = [
      'recherche.executer',
      'parametrage.atelier.lire',
      'parametrage.referentiel.lire',
      'client.lire',
      'vehicule.lire',
    ];
    for (const action of lectures) {
      expect(rolesAyant(action)).toEqual([...ROLES_UTILISATEUR].sort());
    }
  });

  it('atelier.or.lire — accordé à tous les rôles SAUF vendeur (absent des flux étape 1, §2.1)', () => {
    expect(rolesAyant('atelier.or.lire')).toEqual(
      ['admin', 'chef_atelier', 'comptable', 'direction', 'magasinier', 'receptionnaire', 'technicien'].sort(),
    );
    expect(MATRICE_DROITS.vendeur).not.toContain('atelier.or.lire');
  });

  it('comptable — consulte, ne modifie rien dans l’atelier (§2.1) : uniquement des actions *.lire ou recherche.executer', () => {
    for (const action of MATRICE_DROITS.comptable) {
      expect(action.endsWith('.lire') || action === 'recherche.executer').toBe(true);
    }
  });

  it('vendeur — hors flux de l’étape 1 : uniquement la lecture minimale, aucune écriture atelier, pas même la lecture d’un OR', () => {
    for (const action of MATRICE_DROITS.vendeur) {
      expect(action.endsWith('.lire') || action === 'recherche.executer').toBe(true);
    }
    expect(MATRICE_DROITS.vendeur).not.toContain('atelier.or.lire');
    expect(MATRICE_DROITS.vendeur.length).toBeLessThan(MATRICE_DROITS.receptionnaire.length);
  });
});

describe('MATRICE_DROITS — admin et direction (superset)', () => {
  it('admin détient exactement le même périmètre que direction (rôle technique/propriétaire, non décrit comme acteur métier de l’étape 1)', () => {
    expect([...MATRICE_DROITS.admin].sort()).toEqual([...MATRICE_DROITS.direction].sort());
  });

  it('direction détient tout ce que chef_atelier détient, plus au moins client.condition.modifier', () => {
    for (const action of MATRICE_DROITS.chef_atelier) {
      expect(MATRICE_DROITS.direction).toContain(action);
    }
    expect(MATRICE_DROITS.direction).toContain('client.condition.modifier');
    expect(MATRICE_DROITS.chef_atelier).not.toContain('client.condition.modifier');
  });

  it('chef_atelier détient tout ce que réceptionnaire détient (supervision), plus la correction et la gouvernance', () => {
    for (const action of MATRICE_DROITS.receptionnaire) {
      expect(MATRICE_DROITS.chef_atelier).toContain(action);
    }
  });
});

describe('MATRICE_DROITS — périmètre clos (aucune fuite hors de la liste close du lot 1, plan §6.4)', () => {
  it('l’union de toutes les actions accordées ne contient QUE les actions du socle + les actions closes du lot 1', () => {
    const actionsAttendues: Action[] = [
      'socle.tenant.lire',
      'socle.site.lire',
      'parametrage.atelier.lire',
      'parametrage.atelier.modifier',
      'parametrage.referentiel.lire',
      'parametrage.referentiel.modifier',
      'client.lire',
      'client.creer',
      'client.modifier',
      'client.desactiver',
      'client.condition.modifier',
      'client.consentement.enregistrer',
      'client.note.ecrire',
      'vehicule.lire',
      'vehicule.creer',
      'vehicule.modifier',
      'vehicule.archiver',
      'vehicule.plaque.gerer',
      'vehicule.detention.changer',
      'vehicule.detention.corriger',
      'vehicule.kilometrage.saisir',
      'vehicule.kilometrage.corriger_regression',
      'vehicule.expertise.saisir',
      'vehicule.campagne.gerer',
      'vehicule.travail_reporte.gerer',
      'recherche.executer',
      'atelier.or.lire',
      'atelier.or.creer',
      'atelier.or.modifier',
      'atelier.or.plafond_modifier',
      'atelier.or.receptionner',
      'atelier.or.demarrer',
      'atelier.or.passer_en_controle',
      'atelier.or.controler',
      'atelier.or.terminer',
      'atelier.or.rouvrir',
      'atelier.or.restituer',
      'atelier.or.cloturer',
      'atelier.or.annuler',
      'atelier.ligne.creer',
      'atelier.ligne.modifier',
      'atelier.ligne.valider',
      'atelier.ligne.refuser',
      'atelier.ligne.annuler',
      'atelier.ligne.marquer_realisee',
      'atelier.devis.creer',
      'atelier.devis.repondre',
      'atelier.journal.lire',
      'atelier.confirmation.client_bloque',
      'atelier.confirmation.deux_or_ouverts',
      'atelier.confirmation.or_sans_rdv',
      'rendez_vous.confirmation.ressource_chevauchement',
      'rendez_vous.confirmation.hors_ouverture',
      'pret_vehicule.confirmation.indisponible',
    ];

    const actionsAccordees = new Set(Object.values(MATRICE_DROITS).flat());

    expect([...actionsAccordees].sort()).toEqual([...actionsAttendues].sort());
  });
});

/**
 * `ROLES_SANS_MONTANT` (invariant front n°10, plan-lot1-execution.md L611-618) : le serveur retire
 * tout champ monétaire des réponses pour ces rôles. Vérifié cohérent avec la matrice : un rôle
 * de cette liste ne doit détenir aucune action qui manipule directement un montant (plafond,
 * rabais/payeur de ligne, conditions commerciales).
 */
describe('ROLES_SANS_MONTANT', () => {
  it('contient exactement technicien', () => {
    expect(ROLES_SANS_MONTANT).toEqual(['technicien']);
  });

  it('un rôle sans montant ne détient aucune action monétaire de la matrice', () => {
    const actionsMonetaires: Action[] = [
      'atelier.or.plafond_modifier',
      'atelier.ligne.modifier',
      'client.condition.modifier',
    ];
    for (const role of ROLES_SANS_MONTANT) {
      for (const action of actionsMonetaires) {
        expect(MATRICE_DROITS[role]).not.toContain(action);
      }
    }
  });
});

/**
 * `DROIT_PAR_CONFIRMATION` : exhaustif sur `CodeConfirmation` (6 valeurs) par construction du
 * compilateur — voir le commentaire de tête de fichier sur les 3 actions hors périmètre.
 */
describe('DROIT_PAR_CONFIRMATION', () => {
  it('mappe les 3 confirmations opérationnelles du lot 1 vers les actions atelier.confirmation.*, avec un droit détenu par chef_atelier et direction (contrats-api-etape-1.md L524-529)', () => {
    expect(DROIT_PAR_CONFIRMATION.CLIENT_BLOQUE).toBe('atelier.confirmation.client_bloque');
    expect(DROIT_PAR_CONFIRMATION.VEHICULE_DEUX_OR_OUVERTS).toBe('atelier.confirmation.deux_or_ouverts');
    expect(DROIT_PAR_CONFIRMATION.OR_SANS_RDV).toBe('atelier.confirmation.or_sans_rdv');

    for (const code of ['CLIENT_BLOQUE', 'VEHICULE_DEUX_OR_OUVERTS', 'OR_SANS_RDV'] as const) {
      const action = DROIT_PAR_CONFIRMATION[code];
      expect(MATRICE_DROITS.chef_atelier).toContain(action);
      expect(MATRICE_DROITS.direction).toContain(action);
    }
    // VEHICULE_DEUX_OR_OUVERTS est « receptionnaire+ » (contrats-api-etape-1.md L525).
    expect(MATRICE_DROITS.receptionnaire).toContain(DROIT_PAR_CONFIRMATION.VEHICULE_DEUX_OR_OUVERTS);
    // CLIENT_BLOQUE et OR_SANS_RDV sont réservés à chef d'atelier/direction (L524, L529).
    expect(MATRICE_DROITS.receptionnaire).not.toContain(DROIT_PAR_CONFIRMATION.CLIENT_BLOQUE);
    expect(MATRICE_DROITS.receptionnaire).not.toContain(DROIT_PAR_CONFIRMATION.OR_SANS_RDV);
  });

  it('mappe les 3 confirmations hors périmètre (RDV, prêt) vers des actions dédiées, elles aussi détenues par chef_atelier et direction', () => {
    for (const code of ['RDV_RESSOURCE_CHEVAUCHEMENT', 'RDV_HORS_OUVERTURE', 'PRET_VEHICULE_INDISPONIBLE'] as const) {
      const action = DROIT_PAR_CONFIRMATION[code];
      expect(MATRICE_DROITS.chef_atelier).toContain(action);
      expect(MATRICE_DROITS.direction).toContain(action);
    }
  });

  it('est exhaustif sur les 6 valeurs de CodeConfirmation (aucune clé manquante, aucune clé fantôme)', () => {
    const clesAttendues = [
      'CLIENT_BLOQUE',
      'VEHICULE_DEUX_OR_OUVERTS',
      'RDV_RESSOURCE_CHEVAUCHEMENT',
      'RDV_HORS_OUVERTURE',
      'PRET_VEHICULE_INDISPONIBLE',
      'OR_SANS_RDV',
    ].sort();
    expect(Object.keys(DROIT_PAR_CONFIRMATION).sort()).toEqual(clesAttendues);
  });
});
