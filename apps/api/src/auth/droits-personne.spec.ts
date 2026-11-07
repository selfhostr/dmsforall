import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  DOMAINES_CAPACITE,
  GRILLE_VIDE,
  NIVEAUX_ACCES,
  PREREGLAGES,
  capacitesDeLaGrille,
  type DomaineCapacite,
  type GrilleCapacites,
  type NiveauAcces,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { CLE_META_ACTION, GardeDroit } from '../common/droits/garde-droit';
import { roleVoitLesMontants as montantsFacturation } from '../facturation/documents/mappeurs';
import { roleVoitLesMontants as montantsAtelier } from '../atelier/mappeurs';
import { CAPACITE_DE_L_ACTION } from './capacites-actions';
import {
  droitsDe,
  droitsDuPrincipal,
  voitLesMontants,
  voitLesMontantsDeFacturation,
  voitLesPrixAchat,
} from './droits-personne';
import { TOUTES_ACTIONS, actionsDeLaGrille, type Action } from './matrice-droits';

function grilleAvec(niveaux: Partial<Record<DomaineCapacite, NiveauAcces>>): GrilleCapacites {
  return {
    ...GRILLE_VIDE,
    niveaux: { ...GRILLE_VIDE.niveaux, ...niveaux },
    options: { voitMontants: true, voitPrixAchat: true, avoirsPlafonnes: false },
  };
}

function capacitesDe(action: Action): readonly string[] {
  const c = CAPACITE_DE_L_ACTION[action];
  return typeof c === 'string' ? [c] : c;
}

describe('grille Rien / Voir / Faire — chaque domaine, chaque niveau', () => {
  for (const domaine of DOMAINES_CAPACITE) {
    // Actions classées UNIQUEMENT sous ce domaine (hors gestes partagés à capacités multiples).
    const propres = TOUTES_ACTIONS.filter((a) =>
      capacitesDe(a).every((c) => c.startsWith(`${domaine}.`)),
    );

    it(`${domaine} : « Rien » ne donne aucune de ses actions propres`, () => {
      const actions = new Set(actionsDeLaGrille(grilleAvec({ [domaine]: 'rien' })));
      expect(propres.filter((a) => actions.has(a))).toEqual([]);
    });

    it(`${domaine} : « Voir » donne la lecture mais aucune écriture`, () => {
      const actions = new Set(actionsDeLaGrille(grilleAvec({ [domaine]: 'voir' })));
      const voir = propres.filter((a) => capacitesDe(a).every((c) => c.endsWith('.voir')));
      const faire = propres.filter((a) => capacitesDe(a).every((c) => c.endsWith('.faire')));
      expect(voir.length + faire.length).toBeGreaterThan(0);
      expect(voir.filter((a) => !actions.has(a))).toEqual([]);
      expect(faire.filter((a) => actions.has(a))).toEqual([]);
    });

    it(`${domaine} : « Faire » donne lecture ET écriture`, () => {
      const actions = new Set(actionsDeLaGrille(grilleAvec({ [domaine]: 'faire' })));
      expect(propres.filter((a) => !actions.has(a))).toEqual([]);
    });
  }

  it('les niveaux sont emboîtés : tout ce que donne Voir, Faire le donne aussi', () => {
    for (const domaine of DOMAINES_CAPACITE) {
      const voir = new Set(actionsDeLaGrille(grilleAvec({ [domaine]: 'voir' })));
      const faire = new Set(actionsDeLaGrille(grilleAvec({ [domaine]: 'faire' })));
      expect([...voir].filter((a) => !faire.has(a))).toEqual([]);
    }
    expect(NIVEAUX_ACCES).toEqual(['rien', 'voir', 'faire']);
  });

  it('une grille vide ne donne que le socle commun (lecture du tenant, des sites, recherche…)', () => {
    const actions = actionsDeLaGrille({
      ...GRILLE_VIDE,
      options: { voitMontants: false, voitPrixAchat: false, avoirsPlafonnes: false },
    });
    expect(actions.every((a) => capacitesDe(a).includes('base'))).toBe(true);
    expect(actions).toContain('socle.tenant.lire');
    expect(actions).not.toContain('client.creer');
  });

  it('Encadrer et Employés & réglages sont des cases distinctes de la grille', () => {
    const base = grilleAvec({});
    const encadre = new Set(actionsDeLaGrille({ ...base, encadrer: true }));
    expect(encadre.has('atelier.or.rouvrir')).toBe(true);
    expect(encadre.has('socle.utilisateur.creer')).toBe(false);
    const employes = new Set(actionsDeLaGrille({ ...base, gererEmployes: true }));
    expect(employes.has('socle.utilisateur.creer')).toBe(true);
    expect(employes.has('reprise.import.lancer')).toBe(false);
  });
});

describe('personne cumulant plusieurs métiers (le but de la grille)', () => {
  const mecanoMagasinier: GrilleCapacites = {
    ...PREREGLAGES.technicien.grille,
    niveaux: { ...PREREGLAGES.technicien.grille.niveaux, pieces: 'faire' },
    options: { ...PREREGLAGES.technicien.grille.options, voitPrixAchat: true },
  };

  it('mécanicien + magasinier : démarre un OR ET sort une pièce du stock', () => {
    const actions = new Set(actionsDeLaGrille(mecanoMagasinier));
    expect(actions.has('atelier.or.demarrer')).toBe(true);
    expect(actions.has('atelier.pointage.demarrer')).toBe(true);
    expect(actions.has('pieces.mouvement.creer')).toBe(true);
    expect(actions.has('pieces.commande_fournisseur.reception')).toBe(true);
  });

  it('… sans rien d’autre : ni émettre une facture, ni rouvrir un OR, ni gérer les comptes', () => {
    const actions = new Set(actionsDeLaGrille(mecanoMagasinier));
    for (const a of [
      'facturation.document.emettre_facture',
      'atelier.or.rouvrir',
      'socle.utilisateur.creer',
      'ventes.dossier.creer',
    ] as const) {
      expect(actions.has(a), a).toBe(false);
    }
  });

  it('… et, ne voyant pas les montants de vente, il ne les reçoit pas (option par personne)', () => {
    expect(droitsDe('technicien', mecanoMagasinier).voitMontants).toBe(false);
    expect(droitsDe('technicien', mecanoMagasinier).voitPrixAchat).toBe(true);
  });

  it('secrétaire accueil + vente VO : crée un OR ET un dossier de vente', () => {
    const g = {
      ...PREREGLAGES.receptionnaire.grille,
      niveaux: { ...PREREGLAGES.receptionnaire.grille.niveaux, ventes: 'faire' as const },
    };
    const actions = new Set(actionsDeLaGrille(g));
    expect(actions.has('atelier.or.creer')).toBe(true);
    expect(actions.has('ventes.dossier.creer')).toBe(true);
  });
});

describe('fiduciaire : lecture seule, montants visibles', () => {
  const droits = droitsDe('comptable', PREREGLAGES.fiduciaire.grille);

  it('ne détient AUCUNE action d’écriture (tout est lecture, impression ou export en lecture)', () => {
    const ecritures = droits.actions.filter(
      (a) => !/\.(lire|executer)$/.test(a) && a !== 'facturation.document.imprimer',
    );
    expect(ecritures).toEqual([]);
  });

  it('voit les montants de facturation, les factures et l’export, mais ni client, ni OR, ni pièces, ni ventes', () => {
    expect(droits.aLeDroit('facturation.document.lire')).toBe(true);
    expect(droits.aLeDroit('facturation.document.imprimer')).toBe(true);
    expect(droits.aLeDroit('facturation.export.lire')).toBe(true);
    expect(droits.aLeDroit('tableau_bord.financier.lire')).toBe(true);
    expect(droits.capacites.has('facturation.montants')).toBe(true);
    for (const a of [
      'client.lire',
      'atelier.or.lire',
      'pieces.article.lire',
      'ventes.dossier.lire',
    ] as const) {
      expect(droits.aLeDroit(a), a).toBe(false);
    }
  });

  it('ne peut ni exporter (créer), ni rembourser, ni corriger, ni toucher à l’IBAN', () => {
    for (const a of [
      'facturation.export.creer',
      'facturation.paiement.rembourser',
      'facturation.document.corriger',
      'facturation.parametrage.creancier.modifier',
    ] as const) {
      expect(droits.aLeDroit(a), a).toBe(false);
    }
  });
});

describe('masquage des montants selon les options de la personne (côté serveur)', () => {
  it('sans l’option « voit les montants », Finances ne donne rien et imprimer une facture est refusé (RF-116)', () => {
    const g: GrilleCapacites = {
      ...PREREGLAGES.fiduciaire.grille,
      options: { voitMontants: false, voitPrixAchat: false, avoirsPlafonnes: false },
    };
    const d = droitsDe('comptable', g);
    expect(d.capacites.has('facturation.montants')).toBe(false);
    expect(d.aLeDroit('facturation.document.imprimer')).toBe(false);
    expect(d.aLeDroit('facturation.paiement.lire')).toBe(false);
    expect(d.aLeDroit('tableau_bord.financier.lire')).toBe(false);
    expect(capacitesDeLaGrille(g).has('finances.voir')).toBe(false);
  });

  it('le technicien ne voit pas les montants ; admin voit ceux de l’atelier mais jamais ceux de la facturation', () => {
    expect(droitsDe('technicien').voitMontants).toBe(false);
    expect(droitsDe('admin').voitMontants).toBe(true);
    expect(droitsDe('admin').capacites.has('facturation.montants')).toBe(false);
    expect(droitsDe('poste_atelier').voitMontants).toBe(false);
  });

  it('la borne a un profil figé : aucune grille stockée ne lui donne un droit de plus', () => {
    const toutPermis = PREREGLAGES.direction.grille;
    expect(droitsDe('poste_atelier', toutPermis).actions).toEqual(
      droitsDe('poste_atelier').actions,
    );
    expect(droitsDe('poste_atelier', toutPermis).voitMontants).toBe(false);
  });

  it('prix d’achat : suit l’option, préréglages historiques conservés', () => {
    expect(droitsDe('magasinier').voitPrixAchat).toBe(true);
    expect(droitsDe('chef_atelier').voitPrixAchat).toBe(true);
    for (const r of ['vendeur', 'receptionnaire', 'technicien', 'admin'] as const) {
      expect(droitsDe(r).voitPrixAchat, r).toBe(false);
    }
  });

  describe('les mappers lisent la grille de la requête en cours, pas le préréglage du rôle', () => {
    const contexte = new ServiceContexteRequete();
    const dansRequete = <T>(principal: PrincipalAuthentifie, f: () => T): T =>
      contexte.demarrer(
        { requeteId: 'r', debutLe: new Date(), ip: null, userAgent: null, langue: 'fr' },
        () => {
          contexte.attacherPrincipal(principal);
          return f();
        },
      );
    const base: PrincipalAuthentifie = {
      sessionId: 's',
      tenantId: 't',
      utilisateurId: 'u',
      role: 'direction',
      langue: 'fr',
    };

    it('direction dont l’option montants est retirée : masqué partout, malgré le préréglage', () => {
      const principal = {
        ...base,
        capacites: {
          ...PREREGLAGES.direction.grille,
          options: { voitMontants: false, voitPrixAchat: false, avoirsPlafonnes: false },
        },
      };
      dansRequete(principal, () => {
        expect(voitLesMontants('direction')).toBe(false);
        expect(montantsAtelier('direction')).toBe(false);
        expect(montantsFacturation('direction')).toBe(false);
        expect(voitLesPrixAchat('direction')).toBe(false);
      });
    });

    it('technicien à qui l’on accorde l’option montants + Facturation : les voit', () => {
      const principal = {
        ...base,
        role: 'technicien' as const,
        capacites: {
          ...PREREGLAGES.technicien.grille,
          options: { voitMontants: true, voitPrixAchat: false, avoirsPlafonnes: false },
        },
      };
      dansRequete(principal, () => {
        expect(montantsAtelier('technicien')).toBe(true);
        expect(voitLesMontantsDeFacturation('technicien')).toBe(true);
      });
    });

    it('hors requête, ou rôle d’une autre personne : repli sur le préréglage, jamais plus large que lui', () => {
      expect(montantsAtelier('direction')).toBe(true);
      expect(montantsAtelier('technicien')).toBe(false);
      dansRequete({ ...base, role: 'technicien' }, () => {
        expect(montantsAtelier('vendeur')).toBe(true);
        expect(montantsAtelier('technicien')).toBe(false);
      });
    });
  });
});

describe('GardeDroit lit la grille de la personne, pas son rôle', () => {
  const reflector = (action: Action): Reflector =>
    ({
      getAllAndOverride: vi.fn((cle: string) => (cle === CLE_META_ACTION ? action : undefined)),
    }) as unknown as Reflector;
  const ctxExec = {
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  const contexte = (p: PrincipalAuthentifie): ServiceContexteRequete =>
    ({ exigerPrincipal: () => p }) as unknown as ServiceContexteRequete;
  const technicien: PrincipalAuthentifie = {
    sessionId: 's',
    tenantId: 't',
    utilisateurId: 'u',
    role: 'technicien',
    langue: 'fr',
  };

  it('technicien promu Pièces : Faire par sa grille : passe sur pieces.mouvement.creer (refusé à son préréglage)', () => {
    const sansGrille = new GardeDroit(reflector('pieces.mouvement.creer'), contexte(technicien));
    expect(() => sansGrille.canActivate(ctxExec)).toThrow(/DROIT_INSUFFISANT|pas le droit/);

    const promu = {
      ...technicien,
      capacites: {
        ...PREREGLAGES.technicien.grille,
        niveaux: { ...PREREGLAGES.technicien.grille.niveaux, pieces: 'faire' as const },
      },
    };
    const avecGrille = new GardeDroit(reflector('pieces.mouvement.creer'), contexte(promu));
    expect(avecGrille.canActivate(ctxExec)).toBe(true);
  });

  it('direction dont la grille a été réduite (Finances : Rien) : refusée sur le tableau financier malgré son rôle', () => {
    const reduit = {
      ...technicien,
      role: 'direction' as const,
      capacites: {
        ...PREREGLAGES.direction.grille,
        niveaux: { ...PREREGLAGES.direction.grille.niveaux, finances: 'rien' as const },
      },
    };
    const garde = new GardeDroit(reflector('tableau_bord.financier.lire'), contexte(reduit));
    expect(() => garde.canActivate(ctxExec)).toThrow();
    expect(droitsDuPrincipal(reduit).aLeDroit('client.creer')).toBe(true);
  });

  it('accès inter-rôle : un vendeur ne passe pas sur une action patron, même avec toutes les cases métier', () => {
    const vendeurTout = {
      ...technicien,
      role: 'vendeur' as const,
      capacites: {
        ...PREREGLAGES.direction.grille,
        gererEmployes: false,
        patron: false,
        encadrer: false,
      },
    };
    const garde = new GardeDroit(reflector('reprise.import.lancer'), contexte(vendeurTout));
    expect(() => garde.canActivate(ctxExec)).toThrow();
  });
});
