import { describe, expect, it } from 'vitest';
import {
  ROLES_COMPTE_DE_SERVICE,
  ROLES_PERSONNE,
  ROLES_UTILISATEUR,
  type RoleUtilisateur,
} from '@dfa/shared';

import {
  type Action,
  DROIT_PAR_CONFIRMATION,
  MATRICE_DROITS,
  ROLES_SANS_MONTANT,
} from './matrice-droits';
// Import de lecture depuis le périmètre `facturation/documents/` (pas d'écriture) : le test ci-dessous
// doit lier `facturation.document.imprimer` à la fonction RÉELLE, pas à une copie de sa liste de rôles
// recopiée à la main — exactement le risque que ce test existe pour éliminer.
import { roleVoitLesMontants } from '../facturation/documents/mappeurs';

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
    expect(rolesAyant('atelier.or.creer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
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
    expect(rolesAyant('atelier.or.controler')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'technicien'].sort(),
    );
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
    expect(rolesAyant('atelier.or.annuler')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
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
    expect(rolesAyant('parametrage.atelier.modifier')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
    expect(rolesAyant('parametrage.referentiel.modifier')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
  });

  it('atelier.or.demarrer / atelier.or.passer_en_controle — chef d’atelier, technicien, direction, admin (T-04/T-11) : pas réceptionnaire', () => {
    expect(rolesAyant('atelier.or.demarrer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'technicien'].sort(),
    );
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
    expect(rolesAyant('atelier.or.cloturer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });

  it('vehicule.detention.corriger — chef d’atelier, direction, admin (correction sensible, symétrique du kilométrage à la baisse)', () => {
    expect(rolesAyant('vehicule.detention.corriger')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
  });

  it('atelier.journal.lire — réceptionnaire, chef d’atelier, direction, admin uniquement (pas technicien/magasinier/comptable)', () => {
    expect(rolesAyant('atelier.journal.lire')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'receptionnaire'].sort(),
    );
  });
});

/**
 * RF-114 (`docs/specification-etape-2-facturation.md` §9), ligne par ligne — même patron que le
 * bloc §10 ci-dessus, pour les 5 actions ajoutées par l'agent `paiements`.
 */
describe('MATRICE_DROITS — RF-114, facturation/paiements (étape 2)', () => {
  it('« Voir les montants » côté paiements : direction, comptable, vendeur, réceptionnaire, chef d’atelier, magasinier — PAS technicien, PAS admin (RF-115 littéral : « il ne voit pas les montants, n’émet rien et n’encaisse rien » — DROITS_PAIEMENT_PAR_ROLE.admin = [], y compris la lecture, à la différence du choix fait côté documents, voir plus bas)', () => {
    expect(rolesAyant('facturation.paiement.lire')).toEqual(
      ['chef_atelier', 'comptable', 'direction', 'magasinier', 'receptionnaire', 'vendeur'].sort(),
    );
    expect(MATRICE_DROITS.technicien).not.toContain('facturation.paiement.lire');
    expect(MATRICE_DROITS.admin).not.toContain('facturation.paiement.lire');
  });

  it('« Encaisser / imputer » : direction, comptable, vendeur, réceptionnaire, magasinier — PAS chef d’atelier, PAS technicien, PAS admin (RF-115)', () => {
    const attendus = ['comptable', 'direction', 'magasinier', 'receptionnaire', 'vendeur'].sort();
    expect(rolesAyant('facturation.paiement.creer')).toEqual(attendus);
    expect(rolesAyant('facturation.paiement.imputer')).toEqual(attendus);
    expect(MATRICE_DROITS.chef_atelier).not.toContain('facturation.paiement.creer');
    expect(MATRICE_DROITS.admin).not.toContain('facturation.paiement.creer');
  });

  it('« Rembourser un trop-perçu » et l’abandon d’avance inféré (RF-79 issue 3) : direction, comptable SEULS', () => {
    expect(rolesAyant('facturation.paiement.rembourser')).toEqual(
      ['comptable', 'direction'].sort(),
    );
    expect(rolesAyant('facturation.paiement.abandonner')).toEqual(
      ['comptable', 'direction'].sort(),
    );
  });
});

/**
 * RF-114 (`docs/specification-etape-2-facturation.md` §9), bloc « documents » — même patron que le
 * bloc paiements ci-dessus, pour les 9 actions ajoutées par l'agent `documents`. Trois points
 * spécifiques à ce bloc, absents du bloc paiements :
 *  - `facturation.document.lire` est accordée aux 8 rôles SANS exception (contrairement à
 *    `facturation.paiement.lire`, refusée à `admin`) : RF-116 (visibilité des MONTANTS, pas de la
 *    ligne de document elle-même) est filtré séparément par `ROLES_SANS_MONTANT_FACTURATION` dans
 *    `facturation/documents/mappeurs.ts` (`ROLES_SANS_MONTANT` + `admin`), PAS ici — voir le test
 *    dédié plus bas qui vérifie que `ROLES_SANS_MONTANT` (le const partagé avec l'atelier) N'EST
 *    PAS étendu à `admin` en dur dans ce fichier.
 *  - `facturation.document.emettre_facture` reproduit à l'identique l'asymétrie déjà vérifiée côté
 *    paiements (chef_atelier ⊉ receptionnaire) : `receptionnaire` l'a, `chef_atelier` non.
 *  - `facturation.document.emettre_avoir` porte le dégradé RF-117 documenté (pas de plafond en
 *    base) : `receptionnaire` la détient SANS PLAFOND dans la matrice — signalé, pas caché.
 */
describe('MATRICE_DROITS — RF-114, facturation/documents (étape 2)', () => {
  it('« (lecture) » — accordée aux 8 rôles de PERSONNE sans exception, y compris admin (RF-116, les montants sont filtrés ailleurs : facturation/documents/mappeurs.ts) — mais PAS au compte de service poste_atelier, dont le périmètre est construit par énumération et non par ouverture de la lecture par défaut', () => {
    expect(rolesAyant('facturation.document.lire')).toEqual([...ROLES_PERSONNE].sort());
    expect(MATRICE_DROITS.poste_atelier).not.toContain('facturation.document.lire');
  });

  it('« Créer / modifier un brouillon » (creer, modifier, transitionner, avoir.creer) : direction, comptable, vendeur, réceptionnaire, chef d’atelier, magasinier — PAS technicien, PAS admin (RF-115)', () => {
    const attendus = [
      'chef_atelier',
      'comptable',
      'direction',
      'magasinier',
      'receptionnaire',
      'vendeur',
    ].sort();
    const actionsBrouillon: Action[] = [
      'facturation.document.creer',
      'facturation.document.modifier',
      'facturation.document.transitionner',
      'facturation.avoir.creer',
    ];
    for (const action of actionsBrouillon) {
      expect(rolesAyant(action)).toEqual(attendus);
    }
    expect(MATRICE_DROITS.technicien).not.toContain('facturation.document.creer');
    expect(MATRICE_DROITS.admin).not.toContain('facturation.document.creer');
  });

  it('« Émettre un devis / bon de commande » (portillon générique facturation.document.emettre + facturation.document.emettre_devis_bc) : direction, comptable, vendeur, réceptionnaire, chef d’atelier — PAS magasinier, PAS technicien, PAS admin', () => {
    const attendus = ['chef_atelier', 'comptable', 'direction', 'receptionnaire', 'vendeur'].sort();
    expect(rolesAyant('facturation.document.emettre')).toEqual(attendus);
    expect(rolesAyant('facturation.document.emettre_devis_bc')).toEqual(attendus);
    expect(MATRICE_DROITS.magasinier).not.toContain('facturation.document.emettre_devis_bc');
  });

  it('« Émettre une facture » : direction, comptable, vendeur, réceptionnaire — PAS chef d’atelier (rompt la hiérarchie habituelle chef_atelier ⊇ receptionnaire, RF-114 littéral), PAS magasinier, PAS technicien, PAS admin', () => {
    expect(rolesAyant('facturation.document.emettre_facture')).toEqual(
      ['comptable', 'direction', 'receptionnaire', 'vendeur'].sort(),
    );
    expect(MATRICE_DROITS.receptionnaire).toContain('facturation.document.emettre_facture');
    expect(MATRICE_DROITS.chef_atelier).not.toContain('facturation.document.emettre_facture');
  });

  it('« Émettre un avoir » : direction, comptable, réceptionnaire — PAS vendeur, PAS chef d’atelier, PAS magasinier, PAS technicien, PAS admin', () => {
    expect(rolesAyant('facturation.document.emettre_avoir')).toEqual(
      ['comptable', 'direction', 'receptionnaire'].sort(),
    );
    expect(MATRICE_DROITS.vendeur).not.toContain('facturation.document.emettre_avoir');
    expect(MATRICE_DROITS.chef_atelier).not.toContain('facturation.document.emettre_avoir');
  });

  it('⚠️ RF-117 (plafond de montant sur l’émission d’avoir par receptionnaire) NON IMPLÉMENTÉ, documenté explicitement — aucune colonne de paramétrage n’existe pour ce plafond : la matrice traite ICI receptionnaire comme habilité SANS PLAFOND, dégradé assumé (pas un oubli silencieux). Si un plafond est un jour ajouté, il devra être vérifié en service après chargement du montant réel de l’avoir — même patron que atelier.or.plafond_modifier (ServiceOr.modifier) ou vehicule.kilometrage.corriger_regression, PAS dans cette matrice qui ne connaît pas les montants.', () => {
    expect(MATRICE_DROITS.receptionnaire).toContain('facturation.document.emettre_avoir');
  });

  it('la hiérarchie chef_atelier ⊇ receptionnaire, vraie sur tout le lot 1, est DÉLIBÉRÉMENT rompue par RF-114 pour les actions financières : chef_atelier ne détient NI l’émission de facture, NI l’émission d’avoir, NI l’encaissement/l’imputation de paiement, que receptionnaire détient tous les quatre — un test doit échouer si quelqu’un « corrige » cette asymétrie en la prenant pour un oubli de recopie', () => {
    const financiersReceptionnaireSansChefAtelier: Action[] = [
      'facturation.document.emettre_facture',
      'facturation.document.emettre_avoir',
      'facturation.paiement.creer',
      'facturation.paiement.imputer',
    ];
    for (const action of financiersReceptionnaireSansChefAtelier) {
      expect(MATRICE_DROITS.receptionnaire, `receptionnaire devrait détenir '${action}'`).toContain(
        action,
      );
      expect(
        MATRICE_DROITS.chef_atelier,
        `chef_atelier NE DEVRAIT PAS détenir '${action}'`,
      ).not.toContain(action);
    }
  });
});

/**
 * Bloc créancier QR-facture (`GET|PATCH /parametres-facturation/creancier`,
 * `apps/api/src/parametrage/bloc-creancier/`, hors périmètre de ce fichier) : porte l'IBAN sur
 * lequel les clients du garage paient. Arbitrage du coordinateur — palier de gouvernance le PLUS
 * ÉLEVÉ de toute la matrice, repris à l'identique de `DISPOSITION_AVANCE_PAIEMENT` (« Rembourser un
 * trop-perçu ») : direction + comptable SEULS, PAS admin (RF-115). Ce bloc casse la même hiérarchie
 * que RF-114 côté paiements/documents, mais pour un cas plus insidieux : `parametrage.atelier.
 * modifier`/`parametrage.referentiel.modifier` donnent TOUS les deux l'écriture à `admin`
 * (`INFERE_PARAMETRAGE_GOUVERNANCE`), donc un relecteur pressé pourrait « corriger » l'absence
 * d'admin ici en la prenant pour un oubli de recopie plutôt qu'une décision RF-115 délibérée — le
 * test ci-dessous existe précisément pour empêcher ce geste.
 */
describe('MATRICE_DROITS — bloc créancier QR-facture (facturation/parametrage/bloc-creancier, palier de gouvernance le plus élevé)', () => {
  it('« Voir » / « Modifier » l’IBAN créancier : direction, comptable SEULS — comme facturation.paiement.rembourser/abandonner, le palier le plus haut de la matrice', () => {
    expect(rolesAyant('facturation.parametrage.creancier.lire')).toEqual(
      ['comptable', 'direction'].sort(),
    );
    expect(rolesAyant('facturation.parametrage.creancier.modifier')).toEqual(
      ['comptable', 'direction'].sort(),
    );
  });

  it('RF-115 — admin N’A NI la lecture NI l’écriture de l’IBAN créancier, à la différence de parametrage.atelier.modifier/parametrage.referentiel.modifier qui, eux, donnent l’écriture à admin : un test doit échouer si l’entrée admin de ce bloc est un jour remplie par copier-coller de direction, en la prenant pour un oubli de recopie plutôt qu’une décision RF-115 délibérée', () => {
    expect(MATRICE_DROITS.admin).not.toContain('facturation.parametrage.creancier.lire');
    expect(MATRICE_DROITS.admin).not.toContain('facturation.parametrage.creancier.modifier');
    // Contraste explicite avec les DEUX actions parametrage.* existantes, qui donnent bien l'écriture
    // à admin — la différence de traitement N'EST PAS une incohérence, c'est RF-115.
    expect(MATRICE_DROITS.admin).toContain('parametrage.atelier.modifier');
    expect(MATRICE_DROITS.admin).toContain('parametrage.referentiel.modifier');
  });

  it('aucun autre rôle que direction/comptable ne détient l’une ou l’autre action (vendeur, réceptionnaire, chef_atelier, technicien, magasinier exclus, alignés sur DISPOSITION_AVANCE_PAIEMENT)', () => {
    const rolesExclus: RoleUtilisateur[] = [
      'vendeur',
      'receptionnaire',
      'chef_atelier',
      'technicien',
      'magasinier',
    ];
    for (const role of rolesExclus) {
      expect(
        MATRICE_DROITS[role],
        `${role} ne devrait détenir aucune action creancier`,
      ).not.toContain('facturation.parametrage.creancier.lire');
      expect(
        MATRICE_DROITS[role],
        `${role} ne devrait détenir aucune action creancier`,
      ).not.toContain('facturation.parametrage.creancier.modifier');
    }
  });
});

/**
 * Export fiduciaire (`POST /exports-fiduciaires`, `apps/api/src/facturation/export/`, hors
 * périmètre de ce fichier) : transmet les écritures comptables (factures/avoirs émis) à la
 * fiduciaire. Arbitrage du coordinateur, même motif et MÊME PALIER que le bloc créancier ci-dessus —
 * direction + comptable SEULS, PAS admin (RF-115). Transmettre à la fiduciaire est IRRÉVERSIBLE côté
 * destinataire (`EXPORT_DEJA_TRANSMIS`), au moins aussi engageant qu'un remboursement.
 */
describe('MATRICE_DROITS — export fiduciaire (facturation/export, même palier de gouvernance que le bloc créancier)', () => {
  it('« Lancer un export fiduciaire » : direction, comptable SEULS — même palier que facturation.paiement.rembourser/abandonner et le bloc créancier', () => {
    expect(rolesAyant('facturation.export.creer')).toEqual(['comptable', 'direction'].sort());
  });

  it('RF-115 — admin N’A PAS le droit de lancer un export fiduciaire : un test doit échouer si l’entrée admin de ce bloc est un jour remplie par copier-coller de direction, en la prenant pour un oubli de recopie plutôt qu’une décision RF-115 délibérée', () => {
    expect(MATRICE_DROITS.admin).not.toContain('facturation.export.creer');
    // Contraste explicite : direction et comptable, eux, ont bien le droit.
    expect(MATRICE_DROITS.direction).toContain('facturation.export.creer');
    expect(MATRICE_DROITS.comptable).toContain('facturation.export.creer');
  });

  it('aucun autre rôle que direction/comptable ne détient cette action (vendeur, réceptionnaire, chef_atelier, technicien, magasinier exclus, alignés sur DISPOSITION_AVANCE_PAIEMENT et le bloc créancier)', () => {
    const rolesExclus: RoleUtilisateur[] = [
      'vendeur',
      'receptionnaire',
      'chef_atelier',
      'technicien',
      'magasinier',
    ];
    for (const role of rolesExclus) {
      expect(
        MATRICE_DROITS[role],
        `${role} ne devrait détenir aucun droit d'export fiduciaire`,
      ).not.toContain('facturation.export.creer');
    }
  });
});

/**
 * Impression PDF facture QR (`GET /documents-vente/{id}/pdf`, `apps/api/src/facturation/
 * impression/`, hors périmètre de ce fichier) : le PDF expose les montants en clair (et sa charge
 * QR aussi), donc RF-116 (visibilité des montants selon le rôle) s'applique à l'impression comme à
 * l'écran. `facturation.document.imprimer` est accordée EXACTEMENT aux rôles pour lesquels
 * `roleVoitLesMontants()` (`facturation/documents/mappeurs.ts`) est vrai — voir le commentaire sur
 * l'entrée `TOUTES_ACTIONS` correspondante dans `matrice-droits.ts` pour le détail de l'arbitrage.
 */
describe('MATRICE_DROITS — impression PDF facture QR (RF-116, facturation/impression)', () => {
  it('« Imprimer un PDF de facture » : direction, comptable, vendeur, réceptionnaire, chef d’atelier, magasinier — PAS technicien, PAS admin', () => {
    expect(rolesAyant('facturation.document.imprimer')).toEqual(
      ['chef_atelier', 'comptable', 'direction', 'magasinier', 'receptionnaire', 'vendeur'].sort(),
    );
  });

  it('RF-116 — ce droit vaut EXACTEMENT roleVoitLesMontants(role), ni plus ni moins, pour chacun des 8 rôles : un futur élargissement de l’un sans l’autre (par ex. donner l’impression à technicien, ou retirer les montants à magasinier sans retirer son impression) doit faire rougir ce test — la garantie qui compte ici, plus que la liste elle-même', () => {
    for (const role of ROLES_UTILISATEUR) {
      const detientImpression = MATRICE_DROITS[role].includes('facturation.document.imprimer');
      expect(
        detientImpression,
        `${role} : facturation.document.imprimer (${detientImpression}) devrait valoir roleVoitLesMontants('${role}') (${roleVoitLesMontants(role)})`,
      ).toBe(roleVoitLesMontants(role));
    }
  });

  it('distinct de EMISSION_FACTURE : chef_atelier et magasinier voient les montants (donc impriment) sans détenir le droit d’émettre une facture — consulter n’est pas engager, ce n’est pas une incohérence à aplatir', () => {
    expect(MATRICE_DROITS.chef_atelier).toContain('facturation.document.imprimer');
    expect(MATRICE_DROITS.chef_atelier).not.toContain('facturation.document.emettre_facture');
    expect(MATRICE_DROITS.magasinier).toContain('facturation.document.imprimer');
    expect(MATRICE_DROITS.magasinier).not.toContain('facturation.document.emettre_facture');
  });

  it('RF-115 — admin n’a pas ce droit, à la différence de facturation.document.lire qui, lui, lui est accordé (RF-116 filtre les MONTANTS, pas la lecture de la ligne de document) : contraste documenté, pas un oubli', () => {
    expect(MATRICE_DROITS.admin).not.toContain('facturation.document.imprimer');
    expect(MATRICE_DROITS.admin).toContain('facturation.document.lire');
  });
});

describe('MATRICE_DROITS — lecture large (LECTURE_SOCLE et LECTURE_ETENDUE)', () => {
  it('recherche.executer, parametrage.*.lire, client.lire, vehicule.lire — accordés aux 8 rôles de PERSONNE, JAMAIS au compte de service poste_atelier : la borne est un écran mural allumé en permanence devant clients et visiteurs, LECTURE_ETENDUE y exposerait le fichier clients du garage à la vue de tous', () => {
    const lectures: Action[] = [
      'recherche.executer',
      'parametrage.atelier.lire',
      'parametrage.referentiel.lire',
      'client.lire',
      'vehicule.lire',
    ];
    for (const action of lectures) {
      expect(rolesAyant(action)).toEqual([...ROLES_PERSONNE].sort());
      expect(
        MATRICE_DROITS.poste_atelier,
        `poste_atelier ne doit pas détenir ${action}`,
      ).not.toContain(action);
    }
  });

  it('atelier.or.lire — accordé à tous les rôles SAUF vendeur (absent des flux étape 1, §2.1), y compris à poste_atelier : la borne doit afficher les OR en cours de son atelier pour que le technicien choisisse sur quoi pointer (sans montants, cf. ROLES_SANS_MONTANT)', () => {
    expect(rolesAyant('atelier.or.lire')).toEqual(
      [
        'admin',
        'chef_atelier',
        'comptable',
        'direction',
        'magasinier',
        'poste_atelier',
        'receptionnaire',
        'technicien',
      ].sort(),
    );
    expect(MATRICE_DROITS.vendeur).not.toContain('atelier.or.lire');
  });

  it('comptable — consulte, ne modifie rien dans l’atelier/clients/véhicules (§2.1) : uniquement des actions *.lire ou recherche.executer HORS domaines facturation et ventes (RF-114 étape 2 ET §11 étape 4 lui donnent délibérément des droits d’écriture/de confirmation financiers — comptable n’est plus lecture-seule sur ces deux domaines)', () => {
    for (const action of MATRICE_DROITS.comptable) {
      if (action.startsWith('facturation.') || action.startsWith('ventes.')) continue;
      expect(action.endsWith('.lire') || action === 'recherche.executer').toBe(true);
    }
    // Le domaine financier, lui, doit bien contenir de l'écriture pour comptable (sinon RF-114 est cassé).
    expect(MATRICE_DROITS.comptable).toContain('facturation.paiement.creer');
    expect(MATRICE_DROITS.comptable).toContain('facturation.document.emettre_facture');
    // §11 étape 4, ligne 7 : comptable confirme/refuse un financement.
    expect(MATRICE_DROITS.comptable).toContain('ventes.financement.confirmer');
  });

  it('vendeur — hors flux de l’étape 1 : aucune écriture atelier, pas même la lecture d’un OR, HORS domaines facturation et ventes (RF-114 lui donne l’encaissement et l’émission devis/BC/facture mais PAS l’avoir ; §11 étape 4 lui donne le pilotage du dossier de vente mais PAS l’écriture sur `vehicule_stock`, QV-15 non tranché)', () => {
    for (const action of MATRICE_DROITS.vendeur) {
      if (action.startsWith('facturation.') || action.startsWith('ventes.')) continue;
      expect(action.endsWith('.lire') || action === 'recherche.executer').toBe(true);
    }
    expect(MATRICE_DROITS.vendeur).not.toContain('atelier.or.lire');
    // Comparaison de longueur globale retirée (fragile — brisée par la seule croissance normale du
    // domaine ventes, sans rapport avec l'intention réelle du test) : les assertions ciblées
    // ci-dessous couvrent l'intention (vendeur reste hors atelier, hors avoir, hors écriture stock).
    // Domaine financier : écriture accordée par RF-114, mais pas l'avoir (voir bloc RF-114 documents).
    expect(MATRICE_DROITS.vendeur).toContain('facturation.paiement.creer');
    expect(MATRICE_DROITS.vendeur).not.toContain('facturation.document.emettre_avoir');
    // §11 étape 4 : vendeur pilote le dossier de bout en bout, mais pas l'écriture vehicule_stock (QV-15).
    expect(MATRICE_DROITS.vendeur).toContain('ventes.dossier.engager');
    expect(MATRICE_DROITS.vendeur).not.toContain('ventes.vehicule_stock.creer');
    expect(MATRICE_DROITS.vendeur).not.toContain('ventes.vehicule_stock.modifier');
  });
});

describe('MATRICE_DROITS — admin et direction (superset SAUF droits financiers étape 2, RF-115, et le domaine pièces étape 3)', () => {
  it('admin détient le même périmètre que direction pour tout ce qui n’est pas financier, pièces, ni ventes (rôle technique/propriétaire, non décrit comme acteur métier de l’étape 1) — le pointage (lot 2), lui, N’EST PAS exclu : admin y détient le même périmètre que direction (pointage = temps de travail, pas RF-115)', () => {
    // `pieces.` exclu ici pour la MÊME raison que `facturation.` : la matrice §11 de
    // docs/specification-etape-3-pieces.md écrit littéralement « non (RF-115, aucun droit métier) »
    // pour admin sur TOUT le domaine pièces (y compris la simple lecture) — voir
    // `DROITS_PIECES_PAR_ROLE` dans matrice-droits.ts et le test dédié plus bas. `ventes.` exclu
    // pour la même raison, décision de l'agent ventes (voir `DROITS_VENTES_PAR_ROLE`) : admin n'a
    // aucun droit sur le domaine ventes, y compris la lecture.
    const sansFacturationNiPiecesNiVentes = (actions: readonly Action[]) =>
      actions.filter(
        (a) =>
          !a.startsWith('facturation.') && !a.startsWith('pieces.') && !a.startsWith('ventes.'),
      );
    expect([...sansFacturationNiPiecesNiVentes(MATRICE_DROITS.admin)].sort()).toEqual(
      [...sansFacturationNiPiecesNiVentes(MATRICE_DROITS.direction)].sort(),
    );
  });

  it('RF-115 appliqué au domaine pièces (étape 3) — admin n’a AUCUNE action pieces.*, pas même la lecture, contrairement à direction qui en a plusieurs', () => {
    expect(MATRICE_DROITS.admin.filter((a) => a.startsWith('pieces.'))).toEqual([]);
    expect(MATRICE_DROITS.direction.some((a) => a.startsWith('pieces.'))).toBe(true);
  });

  it('RF-115 — admin n’a AUCUN droit financier D’ÉCRITURE NI D’ENCAISSEMENT (aucune action facturation.paiement.*, aucune écriture/émission facturation.document.*), contrairement à direction : séparation des pouvoirs explicite dès l’étape 2. SEULE exception, volontaire et distincte : facturation.document.lire (RF-116, visibilité des MONTANTS, est filtré ailleurs — facturation/documents/mappeurs.ts — jamais en cachant la ligne de document elle-même à admin) — documenté ici pour que ce ne soit jamais lu comme un oubli.', () => {
    expect(MATRICE_DROITS.admin.filter((a) => a.startsWith('facturation.'))).toEqual([
      'facturation.document.lire',
    ]);
    expect(MATRICE_DROITS.admin.some((a) => a.startsWith('facturation.paiement.'))).toBe(false);
    expect(MATRICE_DROITS.direction.some((a) => a.startsWith('facturation.'))).toBe(true);
  });

  it('RF-116 — ROLES_SANS_MONTANT (const PARTAGÉ avec l’atelier) n’est PAS étendu à admin dans ce fichier : le masquage des montants pour admin en facturation (RF-115) est appliqué LOCALEMENT dans facturation/documents/mappeurs.ts (ROLES_SANS_MONTANT_FACTURATION = ROLES_SANS_MONTANT + admin), précisément pour ne pas changer, par effet de bord, l’affichage des montants d’admin côté atelier — non demandé par aucune règle métier', () => {
    expect(ROLES_SANS_MONTANT).not.toContain('admin');
    // Contenu exact : `technicien` (lot 1) et `poste_atelier` (mode borne — écran mural exposé
    // aux clients). L'assertion reste EXHAUSTIVE, pas relâchée en `toContain` : ce qu'elle garde,
    // c'est qu'aucun rôle n'entre ni ne sort de cette liste sans décision consciente — `admin` en
    // particulier, qui est masqué en facturation SEULEMENT, par ROLES_SANS_MONTANT_FACTURATION.
    expect(ROLES_SANS_MONTANT).toEqual(['technicien', 'poste_atelier']);
  });

  it('direction détient tout ce que chef_atelier détient, plus au moins client.condition.modifier', () => {
    for (const action of MATRICE_DROITS.chef_atelier) {
      expect(MATRICE_DROITS.direction).toContain(action);
    }
    expect(MATRICE_DROITS.direction).toContain('client.condition.modifier');
    expect(MATRICE_DROITS.chef_atelier).not.toContain('client.condition.modifier');
  });

  it('chef_atelier détient tout ce que réceptionnaire détient (supervision), plus la correction et la gouvernance — HORS domaines facturation et ventes, où RF-114 et §11 (étape 4) cassent délibérément cette hiérarchie (voir les tests dédiés dans les blocs « RF-114, facturation/documents » et « ventes »)', () => {
    for (const action of MATRICE_DROITS.receptionnaire) {
      if (action.startsWith('facturation.') || action.startsWith('ventes.')) continue;
      expect(MATRICE_DROITS.chef_atelier).toContain(action);
    }
  });
});

/**
 * §11 de `docs/specification-etape-4-ventes.md` (lignes 720-730), littéral sur 9 lignes / 4
 * colonnes (`vendeur`, `direction`, `comptable`, `receptionnaire`) — voir le commentaire de tête de
 * `DROITS_VENTES_PAR_ROLE` (`matrice-droits.ts`) pour le détail des inférences et des deux points
 * `[À VALIDER]` (QV-15, QV-16) traités en position conservatrice.
 */
describe('MATRICE_DROITS — ventes VN/VO (étape 4, matrice §11)', () => {
  it('§11 lignes 1/2 — créer/modifier un dossier en prospection, faire signer le bon de commande (engager) : vendeur, direction SEULS', () => {
    expect(rolesAyant('ventes.dossier.creer')).toEqual(['direction', 'vendeur'].sort());
    expect(rolesAyant('ventes.dossier.engager')).toEqual(['direction', 'vendeur'].sort());
  });

  it('§11 ligne 3 — saisir une estimation/valeur de reprise négociée : vendeur, direction SEULS', () => {
    expect(rolesAyant('ventes.reprise.creer')).toEqual(['direction', 'vendeur'].sort());
    expect(rolesAyant('ventes.reprise.negocier')).toEqual(['direction', 'vendeur'].sort());
  });

  it('§11 ligne 4 [À VALIDER, QV-15] — visibilité de la marge/du prix d’achat : lecture accordée à direction, comptable ET vendeur (le contrat gelé `ReponseVehiculeStock.prixAchatCentimes` est `number` non-nullable — masquer le CHAMP par rôle exigerait de rouvrir un contrat gelé, hors périmètre de cet agent) ; SEULE L’ÉCRITURE reste conservatrice (voir le test suivant)', () => {
    expect(rolesAyant('ventes.vehicule_stock.lire')).toEqual(
      ['chef_atelier', 'comptable', 'direction', 'receptionnaire', 'vendeur'].sort(),
    );
  });

  it('§11 ligne 9 [À VALIDER, QV-15] — modifier le prix d’achat/frais de remise en état d’un véhicule en stock : direction SEULE ; vendeur EXCLU en position conservatrice tant que QV-15 n’est pas tranché', () => {
    expect(rolesAyant('ventes.vehicule_stock.creer')).toEqual(['direction']);
    expect(rolesAyant('ventes.vehicule_stock.modifier')).toEqual(['direction']);
    expect(MATRICE_DROITS.vendeur).not.toContain('ventes.vehicule_stock.creer');
    expect(MATRICE_DROITS.vendeur).not.toContain('ventes.vehicule_stock.modifier');
  });

  it('§11 ligne 7 — confirmer un financement/leasing : vendeur, direction, comptable', () => {
    expect(rolesAyant('ventes.financement.confirmer')).toEqual(
      ['comptable', 'direction', 'vendeur'].sort(),
    );
  });

  it('§11 ligne 8 [À VALIDER, QV-16] — enregistrer la livraison : vendeur, direction SEULS ; receptionnaire EXCLU en position conservatrice (« possible selon organisation » non tranché)', () => {
    expect(rolesAyant('ventes.dossier.livrer')).toEqual(['direction', 'vendeur'].sort());
    expect(MATRICE_DROITS.receptionnaire).not.toContain('ventes.dossier.livrer');
  });

  it('§11 lignes 5/6 (émission facture/avoir) — DÉJÀ couvertes par le bloc RF-114 (étape 2), aucune nouvelle action créée : ce bloc ne fait QUE confirmer la cohérence', () => {
    expect(MATRICE_DROITS.vendeur).toContain('facturation.document.emettre_facture');
    expect(MATRICE_DROITS.vendeur).not.toContain('facturation.document.emettre_avoir');
    expect(MATRICE_DROITS.comptable).toContain('facturation.document.emettre_avoir');
  });

  it('correction exceptionnelle (remettre-disponible, confirmer une reprise hors du flux engager) — INFÉRÉE, direction SEULE, même doctrine que vehicule.detention.corriger', () => {
    expect(rolesAyant('ventes.vehicule_stock.corriger')).toEqual(['direction']);
    expect(rolesAyant('ventes.reprise.confirmer')).toEqual(['direction']);
  });

  it('RF-115 (décision de cet agent, §11 ne mentionne pas admin) — admin n’a AUCUNE action ventes.*, pas même la lecture, contrairement à direction qui en a plusieurs', () => {
    expect(MATRICE_DROITS.admin.filter((a) => a.startsWith('ventes.'))).toEqual([]);
    expect(MATRICE_DROITS.direction.some((a) => a.startsWith('ventes.'))).toBe(true);
  });

  it('chef_atelier — lecture minimale INFÉRÉE (coordination de la préparation VO), PAS reprise/financement (détail financier sans besoin opérationnel identifié)', () => {
    expect(MATRICE_DROITS.chef_atelier).toContain('ventes.vehicule_stock.lire');
    expect(MATRICE_DROITS.chef_atelier).toContain('ventes.dossier.lire');
    expect(MATRICE_DROITS.chef_atelier).not.toContain('ventes.reprise.lire');
    expect(MATRICE_DROITS.chef_atelier).not.toContain('ventes.financement.lire');
  });

  it('technicien et magasinier — acteurs d’AUCUNE ligne de §11 : aucune action ventes.*', () => {
    expect(MATRICE_DROITS.technicien.filter((a) => a.startsWith('ventes.'))).toEqual([]);
    expect(MATRICE_DROITS.magasinier.filter((a) => a.startsWith('ventes.'))).toEqual([]);
  });
});

/**
 * Pointage (lot 2, RM-87→RM-99, RM-113→RM-123) : bloc transmis par l'orchestrateur pour le compte
 * de l'agent `pointage/`, périmètre disjoint de ce fichier. Voir `DROITS_POINTAGE_PAR_ROLE`
 * (`matrice-droits.ts`) pour l'arbitrage documenté (@laupernoe, 2026-08-03) : `comptable` ne détient NI
 * `verrouiller_periode` NI `deverrouiller_periode`, corrigé depuis une première version qui lui
 * accordait `verrouiller_periode` seul et heurtait l'invariant « comptable = lecture-seule hors
 * facturation/ventes ».
 */
describe('MATRICE_DROITS — pointage (lot 2)', () => {
  it('demarrer/arreter/lire : chef_atelier, direction, admin, technicien, magasinier + le compte de service poste_atelier — PAS receptionnaire, PAS vendeur, PAS comptable', () => {
    // POURQUOI `poste_atelier` est ici (mode borne, docs/specification-pointage-borne.md) : la
    // requête `POST /pointages` qui écrit la ligne est émise par la SESSION DE LA BORNE. Le PIN
    // n'est qu'une donnée du corps qui NOMME le `technicienId` — il ne porte, par contrat gelé
    // (`packages/shared/src/contrats/pointage/identification.ts`), AUCUNE autorité : « le DROIT
    // d'écrire un pointage est déjà porté par la session de la borne, pas par le PIN ». Sans ces
    // droits sur le compte de borne, `POST /pointages` répondrait 403 et le mode borne serait
    // mort-né. `lire` est nécessaire pour que l'écran affiche le pointage qu'il vient d'ouvrir
    // (« Marco, en cours depuis 14:12 »).
    //
    // Ce n'est PAS une porte dérobée : la borne ne gagne rien d'autre que ces trois gestes plus
    // `identifier` et deux lectures (voir le bloc « poste_atelier, compte de service » en fin de
    // fichier, qui fige sa liste EXHAUSTIVE et interdit nommément tout geste sensible). Le pire
    // effet d'un PIN emprunté reste ce que la spécification déclare accepter : une heure imputée
    // au mauvais nom, jamais une élévation de privilège.
    const attendus = [
      'admin',
      'chef_atelier',
      'direction',
      'magasinier',
      'poste_atelier',
      'technicien',
    ].sort();
    expect(rolesAyant('atelier.pointage.demarrer')).toEqual(attendus);
    expect(rolesAyant('atelier.pointage.arreter')).toEqual(attendus);
    expect(rolesAyant('atelier.pointage.lire')).toEqual(attendus);

    // L'intention d'origine du test, préservée mot pour mot : ces trois rôles restent exclus.
    for (const role of ['receptionnaire', 'vendeur', 'comptable'] as const) {
      for (const action of [
        'atelier.pointage.demarrer',
        'atelier.pointage.arreter',
        'atelier.pointage.lire',
      ] as const) {
        expect(MATRICE_DROITS[role], `${role} ne doit pas détenir ${action}`).not.toContain(action);
      }
    }
  });

  it('GARDE-FOU DU MODE BORNE — le compte de service n’obtient QUE les trois gestes de pointage ci-dessus (plus `identifier`) : il ne détient AUCUNE autre action `atelier.pointage.*`, et son périmètre TOTAL sur toute la matrice se limite à sept actions dont aucune n’écrit hors du pointage. Un écran mural non verrouillé, accessible à quiconque entre dans l’atelier, ne doit jamais devenir le chemin par lequel on contourne « le PIN n’autorise aucun geste sensible »', () => {
    expect([...MATRICE_DROITS.poste_atelier].sort()).toEqual(
      [
        'socle.tenant.lire',
        'socle.site.lire',
        'atelier.or.lire',
        'atelier.pointage.identifier',
        'atelier.pointage.demarrer',
        'atelier.pointage.arreter',
        'atelier.pointage.lire',
      ].sort(),
    );

    // Les trois actions de pointage QUI RESTENT interdites à la borne — celles qui réécrivent ou
    // figent des heures déjà déclarées, donc les seules du domaine qui engagent la paie.
    for (const action of [
      'atelier.pointage.corriger_autrui',
      'atelier.pointage.verrouiller_periode',
      'atelier.pointage.deverrouiller_periode',
      'atelier.pointage.gerer_pin',
    ] as const) {
      expect(MATRICE_DROITS.poste_atelier, `borne : ${action} doit rester interdit`).not.toContain(
        action,
      );
    }

    // Échantillon nommé des gestes sensibles exigés par RM-115/RM-131 : signature/réponse de
    // devis, transitions d'OR, facturation, lecture du fichier clients, montants.
    for (const action of [
      'atelier.devis.repondre',
      'atelier.or.receptionner',
      'atelier.or.restituer',
      'atelier.ligne.valider',
      'facturation.document.lire',
      'facturation.document.emettre_facture',
      'facturation.paiement.creer',
      'facturation.paiement.imputer',
      'client.lire',
      'vehicule.lire',
      'recherche.executer',
    ] as const) {
      expect(MATRICE_DROITS.poste_atelier, `borne : ${action} doit rester interdit`).not.toContain(
        action,
      );
    }

    // Et aucun montant ne doit atteindre l'écran, quel que soit l'endpoint emprunté.
    expect(ROLES_SANS_MONTANT).toContain('poste_atelier');
  });

  it('corriger_autrui : chef_atelier, direction, admin SEULS', () => {
    expect(rolesAyant('atelier.pointage.corriger_autrui')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
  });

  it('verrouiller_periode : chef_atelier, direction, admin SEULS — PAS comptable (arbitrage @laupernoe 2026-08-03 : verrouiller une période fige des heures de travail avant la paie, geste de droit du travail réservé à l’atelier/la direction, pas un geste comptable)', () => {
    expect(rolesAyant('atelier.pointage.verrouiller_periode')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
    expect(MATRICE_DROITS.comptable).not.toContain('atelier.pointage.verrouiller_periode');
  });

  it('deverrouiller_periode : chef_atelier, direction, admin SEULS — PAS comptable (rouvrir une période figée est plus engageant que la clôturer, même précédent que atelier.or.rouvrir réservé à chef_atelier/direction alors que la fermeture symétrique est plus largement accordée)', () => {
    expect(rolesAyant('atelier.pointage.deverrouiller_periode')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
    expect(MATRICE_DROITS.comptable).not.toContain('atelier.pointage.deverrouiller_periode');
    expect(MATRICE_DROITS.comptable).not.toContain('atelier.pointage.verrouiller_periode');
  });

  it('comptable — aucune action d’écriture de pointage (ni verrouiller, ni déverrouiller) : cohérent avec l’invariant « comptable = lecture-seule hors facturation/ventes » vérifié plus haut dans ce fichier', () => {
    expect(MATRICE_DROITS.comptable.filter((a) => a.startsWith('atelier.pointage.'))).toEqual([]);
  });

  it('admin détient les 7 actions de pointage d’encadrement, comme direction — PAS une violation de RF-115 (le pointage n’est pas un droit financier)', () => {
    const actionsPointage: Action[] = [
      'atelier.pointage.demarrer',
      'atelier.pointage.arreter',
      'atelier.pointage.lire',
      'atelier.pointage.pointer_autrui',
      'atelier.pointage.corriger_autrui',
      'atelier.pointage.verrouiller_periode',
      'atelier.pointage.deverrouiller_periode',
    ];
    for (const action of actionsPointage) {
      expect(MATRICE_DROITS.admin).toContain(action);
    }
  });

  it('pointer_autrui (FAILLE CORRIGÉE — démarrer/arrêter le pointage d’un AUTRE que soi) : chef_atelier, direction, admin SEULS — JAMAIS technicien ni magasinier (ils pointent pour EUX-MÊMES, pas pour un collègue), ni la borne poste_atelier (compte de service exempté du contrôle soi/autrui, il ne détient donc pas ce droit), ni receptionnaire/vendeur/comptable (aucune action de pointage)', () => {
    expect(rolesAyant('atelier.pointage.pointer_autrui')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
    // Le cœur de la faille : un technicien NE DOIT PAS pouvoir imputer des heures à un collègue.
    expect(MATRICE_DROITS.technicien).not.toContain('atelier.pointage.pointer_autrui');
    expect(MATRICE_DROITS.magasinier).not.toContain('atelier.pointage.pointer_autrui');
    // La borne pointe pour autrui PAR CONCEPTION (technicien identifié par PIN), mais via
    // demarrer/arreter + son statut de compte de service, jamais via ce droit — voir le describe
    // poste_atelier plus bas qui fige sa liste exhaustive.
    expect(MATRICE_DROITS.poste_atelier).not.toContain('atelier.pointage.pointer_autrui');
  });

  it('receptionnaire et vendeur — aucune action de pointage (pas leur outil)', () => {
    expect(MATRICE_DROITS.receptionnaire.filter((a) => a.startsWith('atelier.pointage.'))).toEqual(
      [],
    );
    expect(MATRICE_DROITS.vendeur.filter((a) => a.startsWith('atelier.pointage.'))).toEqual([]);
  });
});

describe('MATRICE_DROITS — périmètre clos (aucune fuite hors de la liste close du lot 1 + facturation/paiements + facturation/documents + bloc créancier + export fiduciaire + impression PDF étape 2 + pièces étape 3 + ventes étape 4 + pointage lot 2)', () => {
  it('l’union de toutes les actions accordées ne contient QUE les actions du socle + les actions closes du lot 1 + les 5 actions facturation.paiement.* (agent paiements) + les 9 actions facturation.document.*/facturation.avoir.creer (agent documents) + les 2 actions facturation.parametrage.creancier.* + facturation.export.creer + facturation.document.imprimer (arbitrages coordinateur) + les 9 actions pieces.* (étape 3)', () => {
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
      // --- Étape 2 : facturation — documents (RF-1 → RF-32, RF-114 → RF-120) ---
      'facturation.document.lire',
      'facturation.document.creer',
      'facturation.document.modifier',
      'facturation.document.transitionner',
      'facturation.document.emettre',
      'facturation.document.emettre_devis_bc',
      'facturation.document.emettre_facture',
      'facturation.document.emettre_avoir',
      'facturation.avoir.creer',
      // --- Étape 2 : facturation — paiements (RF-65 → RF-80, RF-114 → RF-116) ---
      'facturation.paiement.lire',
      'facturation.paiement.creer',
      'facturation.paiement.imputer',
      'facturation.paiement.rembourser',
      'facturation.paiement.abandonner',
      // --- Étape 2 : bloc créancier QR-facture (arbitrage coordinateur, palier direction+comptable) ---
      'facturation.parametrage.creancier.lire',
      'facturation.parametrage.creancier.modifier',
      // --- Étape 2 : export fiduciaire (arbitrage coordinateur, même palier direction+comptable) ---
      'facturation.export.creer',
      // --- Étape 2 : impression PDF facture QR (accordée exactement à roleVoitLesMontants()) ---
      'facturation.document.imprimer',
      // --- Étape 3 : pièces (RP-01 → RP-25, matrice §11 de docs/specification-etape-3-pieces.md) ---
      'pieces.article.lire',
      'pieces.article.creer',
      'pieces.article.modifier',
      'pieces.stock.lire',
      'pieces.stock.modifier',
      'pieces.mouvement.creer',
      'pieces.reservation.lire',
      'pieces.reservation.satisfaire',
      'pieces.reservation.liberer',
      // --- Étape 3, second relais : fournisseurs, commandes fournisseur, consignes, paramétrage ---
      'pieces.fournisseur.lire',
      'pieces.fournisseur.creer',
      'pieces.fournisseur.modifier',
      'pieces.commande_fournisseur.lire',
      'pieces.commande_fournisseur.creer',
      'pieces.commande_fournisseur.reception',
      'pieces.consigne.lire',
      'pieces.consigne.retourner',
      'pieces.parametrage.lire',
      'pieces.parametrage.modifier',
      // --- Étape 4 : ventes VN/VO (RV-01→RV-62, matrice §11 de docs/specification-etape-4-ventes.md) ---
      'ventes.vehicule_stock.lire',
      'ventes.vehicule_stock.creer',
      'ventes.vehicule_stock.modifier',
      'ventes.vehicule_stock.corriger',
      'ventes.dossier.lire',
      'ventes.dossier.creer',
      'ventes.dossier.modifier',
      'ventes.dossier.engager',
      'ventes.dossier.preparer',
      'ventes.dossier.marquer_pret_a_livrer',
      'ventes.dossier.livrer',
      'ventes.dossier.cloturer',
      'ventes.dossier.annuler',
      'ventes.dossier.abandonner',
      'ventes.reprise.lire',
      'ventes.reprise.creer',
      'ventes.reprise.modifier',
      'ventes.reprise.negocier',
      'ventes.reprise.confirmer',
      'ventes.reprise.refuser',
      'ventes.financement.lire',
      'ventes.financement.creer',
      'ventes.financement.confirmer',
      'ventes.financement.refuser',
      // --- Lot 2 : pointage (RM-87→RM-99, RM-113→RM-123), transmis par l'orchestrateur ---
      'atelier.pointage.demarrer',
      'atelier.pointage.arreter',
      'atelier.pointage.lire',
      // `pointer_autrui` : ajouté par la correction de faille (démarrer/arrêter le pointage d'un
      // AUTRE que soi — encadrement seul, vérifié en service). Voir le describe « pointer_autrui ».
      'atelier.pointage.pointer_autrui',
      'atelier.pointage.corriger_autrui',
      'atelier.pointage.verrouiller_periode',
      'atelier.pointage.deverrouiller_periode',
      // --- Mode « borne partagée » du pointage (docs/specification-pointage-borne.md) ----------
      // Livrées par expert-auth EN AMONT du module PIN, pour que l'agent qui construira
      // `pin_pointage` reprenne des noms et un périmètre de rôles déjà arbitrés. Inertes tant
      // qu'aucune route ne les exerce — déclarées comme telles dans
      // `common/droits/allowlist-actions-non-decorees.ts`.
      'atelier.pointage.identifier',
      'atelier.pointage.gerer_pin',
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
  it('contient exactement technicien et poste_atelier — le second ajouté avec le mode borne : un écran mural allumé en permanence, à la vue des clients et des visiteurs, ne doit afficher aucun prix ni total (divulgation commerciale par simple présence physique dans l’atelier, un canal que l’auth ne peut gouverner qu’en retirant les montants à la source)', () => {
    expect(ROLES_SANS_MONTANT).toEqual(['technicien', 'poste_atelier']);
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
    expect(DROIT_PAR_CONFIRMATION.VEHICULE_DEUX_OR_OUVERTS).toBe(
      'atelier.confirmation.deux_or_ouverts',
    );
    expect(DROIT_PAR_CONFIRMATION.OR_SANS_RDV).toBe('atelier.confirmation.or_sans_rdv');

    for (const code of ['CLIENT_BLOQUE', 'VEHICULE_DEUX_OR_OUVERTS', 'OR_SANS_RDV'] as const) {
      const action = DROIT_PAR_CONFIRMATION[code];
      expect(MATRICE_DROITS.chef_atelier).toContain(action);
      expect(MATRICE_DROITS.direction).toContain(action);
    }
    // VEHICULE_DEUX_OR_OUVERTS est « receptionnaire+ » (contrats-api-etape-1.md L525).
    expect(MATRICE_DROITS.receptionnaire).toContain(
      DROIT_PAR_CONFIRMATION.VEHICULE_DEUX_OR_OUVERTS,
    );
    // CLIENT_BLOQUE et OR_SANS_RDV sont réservés à chef d'atelier/direction (L524, L529).
    expect(MATRICE_DROITS.receptionnaire).not.toContain(DROIT_PAR_CONFIRMATION.CLIENT_BLOQUE);
    expect(MATRICE_DROITS.receptionnaire).not.toContain(DROIT_PAR_CONFIRMATION.OR_SANS_RDV);
  });

  it('mappe les 3 confirmations hors périmètre (RDV, prêt) vers des actions dédiées, elles aussi détenues par chef_atelier et direction', () => {
    for (const code of [
      'RDV_RESSOURCE_CHEVAUCHEMENT',
      'RDV_HORS_OUVERTURE',
      'PRET_VEHICULE_INDISPONIBLE',
    ] as const) {
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

/**
 * `poste_atelier` — compte de SERVICE (la borne tactile de l'atelier), pas une personne.
 *
 * Ces tests ne vérifient pas une liste, ils verrouillent une DOCTRINE : ce rôle est le seul du
 * fichier dont le périmètre est construit par ÉNUMÉRATION (tout ce qui n'y est pas est refusé),
 * à rebours de la règle générale « la lecture est ouverte, seule l'écriture est gouvernée ». La
 * raison est physique : l'écran est accroché à un mur, allumé en permanence, sans verrouillage,
 * et n'importe qui entrant dans l'atelier est devant.
 *
 * Le risque que ces tests existent pour empêcher est précis : un futur agent qui, voyant la borne
 * « manquer » d'un droit pour faire marcher un écran, lui ajoute `LECTURE_ETENDUE` par confort de
 * copie — et publie du même geste le fichier clients du garage sur un mur d'atelier. Un test rouge
 * est la seule chose qui transforme ce geste en décision consciente.
 */
describe('MATRICE_DROITS — poste_atelier, compte de service (mode borne du pointage)', () => {
  it('est le seul rôle de ROLES_COMPTE_DE_SERVICE, et il est bien absent de ROLES_PERSONNE (les deux partitionnent ROLES_UTILISATEUR)', () => {
    expect([...ROLES_COMPTE_DE_SERVICE]).toEqual(['poste_atelier']);
    expect(ROLES_PERSONNE).not.toContain('poste_atelier');
    expect([...ROLES_PERSONNE, ...ROLES_COMPTE_DE_SERVICE].sort()).toEqual(
      [...ROLES_UTILISATEUR].sort(),
    );
  });

  it('détient EXACTEMENT six actions, ni une de plus : lire son tenant, lire son site, lire les OR, identifier par PIN, démarrer et arrêter un pointage', () => {
    expect([...MATRICE_DROITS.poste_atelier].sort()).toEqual(
      [
        'socle.tenant.lire',
        'socle.site.lire',
        'atelier.or.lire',
        'atelier.pointage.identifier',
        'atelier.pointage.demarrer',
        'atelier.pointage.arreter',
        'atelier.pointage.lire',
      ].sort(),
    );
  });

  it('ne détient AUCUNE action d’écriture hors du domaine pointage : tout ce qu’il porte est soit un `.lire`, soit une action `atelier.pointage.*` — un geste sensible depuis un écran mural non verrouillé (RM-115/RM-131) doit rester structurellement impossible', () => {
    for (const action of MATRICE_DROITS.poste_atelier) {
      expect(
        action.endsWith('.lire') || action.startsWith('atelier.pointage.'),
        `poste_atelier détient ${action}, qui n’est ni une lecture ni une action de pointage`,
      ).toBe(true);
    }
  });

  it('ne détient AUCUNE action des domaines facturation, ventes, pièces, client, véhicule, paramétrage ni recherche — y compris en LECTURE, à la différence de tous les autres rôles', () => {
    const domainesInterdits = [
      'facturation.',
      'ventes.',
      'pieces.',
      'client.',
      'vehicule.',
      'parametrage.',
      'recherche.',
      'rendez_vous.',
      'pret_vehicule.',
    ];
    for (const action of MATRICE_DROITS.poste_atelier) {
      for (const prefixe of domainesInterdits) {
        expect(
          action.startsWith(prefixe),
          `poste_atelier détient ${action}, du domaine interdit ${prefixe}`,
        ).toBe(false);
      }
    }
  });

  it('ne détient AUCUNE transition d’OR ni action de ligne/devis : la borne pointe, elle ne pilote pas l’atelier (RM-131)', () => {
    const interdits: Action[] = [
      'atelier.or.creer',
      'atelier.or.modifier',
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
      'atelier.ligne.valider',
      'atelier.ligne.marquer_realisee',
      'atelier.devis.repondre',
      'atelier.journal.lire',
    ];
    for (const action of interdits) {
      expect(
        MATRICE_DROITS.poste_atelier,
        `poste_atelier ne doit pas détenir ${action}`,
      ).not.toContain(action);
    }
  });

  it('ne détient NI corriger_autrui NI les verrouillages de période : une correction ou une clôture d’heures se décide depuis un compte nominatif, au bureau — jamais depuis un écran partagé où l’auteur réel n’est prouvé par rien', () => {
    expect(MATRICE_DROITS.poste_atelier).not.toContain('atelier.pointage.corriger_autrui');
    expect(MATRICE_DROITS.poste_atelier).not.toContain('atelier.pointage.verrouiller_periode');
    expect(MATRICE_DROITS.poste_atelier).not.toContain('atelier.pointage.deverrouiller_periode');
  });

  it('ne détient PAS gerer_pin : la borne ne s’auto-administre pas ses propres codes — sinon quiconque devant l’écran pourrait s’attribuer un PIN et pointer au nom de n’importe qui', () => {
    expect(MATRICE_DROITS.poste_atelier).not.toContain('atelier.pointage.gerer_pin');
  });

  it('figure dans ROLES_SANS_MONTANT : aucun montant ne doit atteindre un écran mural exposé aux clients et visiteurs', () => {
    expect(ROLES_SANS_MONTANT).toContain('poste_atelier');
    expect(roleVoitLesMontants('poste_atelier')).toBe(false);
  });

  it('atelier.pointage.identifier est détenu par poste_atelier SEUL : sur un compte de personne l’identification n’a pas d’objet (la session dit déjà qui agit), et l’ouvrir plus largement offrirait un oracle de PIN à tout compte du tenant', () => {
    expect(rolesAyant('atelier.pointage.identifier')).toEqual(['poste_atelier']);
  });

  it('atelier.pointage.gerer_pin (RM-128) est détenu par chef_atelier, direction et admin — exactement le trio qui corrige déjà les pointages d’autrui et verrouille les périodes ; PAS le technicien (aucun auto-service de PIN), PAS le comptable, PAS la borne', () => {
    expect(rolesAyant('atelier.pointage.gerer_pin')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
    expect(MATRICE_DROITS.technicien).not.toContain('atelier.pointage.gerer_pin');
  });

  it('CONSTAT MESURÉ, contraire à la prémisse de RM-124 : gerer_pin et parametrage.atelier.modifier ont AUJOURD’HUI exactement le même périmètre de rôles — la spec borne présente le second comme « déjà porté par direction/admin », alors que la matrice du lot 1 l’accorde AUSSI au chef d’atelier. Les deux droits restent deux entrées distinctes de TOUTES_ACTIONS, donc séparables sans migration le jour où la gouvernance du MODE de site sera réellement resserrée ; ce test fige le constat plutôt qu’une intention', () => {
    const perimetreGerationPin = rolesAyant('atelier.pointage.gerer_pin');
    const perimetreModeSite = rolesAyant('parametrage.atelier.modifier');
    expect(perimetreGerationPin).toEqual(['admin', 'chef_atelier', 'direction'].sort());
    expect(perimetreModeSite).toEqual(perimetreGerationPin);
  });
});
