import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant } from '../../db';
import type { ServiceJournal } from '../../common/journal';
import type { Horloge } from '../../common/horloge';
import type { AdaptateurConnecteur, RequeteOperationConnecteur } from '../adaptateur-connecteur';

import {
  POLITIQUE_RESILIENCE_CONNECTEUR_DEFAUT,
  type PolitiqueResilienceConnecteur,
} from './politique-resilience';
import { ServiceExecuteurConnecteurResilient } from './service-executeur-connecteur-resilient';
import { ServiceAttente } from './service-attente';

/**
 * Garde-fous d'un appel sortant (item C du socle étape 5) : délai maximal, réessais à espacement
 * croissant, disjoncteur, isolation tenant, aucun secret dans les journaux.
 *
 * Aucune vraie temporisation : la pause entre tentatives passe par une `ServiceAttente` factice
 * qui résout immédiatement (et enregistre les délais demandés) ; le filet de sécurité par
 * tentative (`setTimeout` réel dans le service) est prouvé avec `vi.useFakeTimers()` UNIQUEMENT
 * dans le test dédié au dépassement de délai — les autres tests ne l'utilisent pas, un adaptateur
 * qui se résout/rejette immédiatement gagne toujours la course contre un minuteur réel qui n'a
 * pas encore été avancé.
 */

const CTX_TENANT_A: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'u1', requeteId: null };
const CTX_TENANT_B: ContexteTenant = { tenantId: 'tenant-b', utilisateurId: 'u2', requeteId: null };

const REQUETE: RequeteOperationConnecteur = {
  operation: 'export',
  nature: 'annonce_vehicule',
  objetId: 'veh-1',
  donnees: { cleApiSecrete: 'NE-DOIT-JAMAIS-APPARAITRE-EN-CLAIR' },
};

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

/** Horloge factice pilotée à la main — permet de contrôler précisément le temps écoulé pour
 *  prouver l'ouverture et la fermeture du disjoncteur sans horloge murale. */
function horlogeFactice(depart = 1_000_000): { horloge: Horloge; avancer(ms: number): void } {
  let maintenant = depart;
  const horloge = { maintenant: () => new Date(maintenant) } as unknown as Horloge;
  return { horloge, avancer: (ms: number) => (maintenant += ms) };
}

function adaptateurFactice(typeConnecteurCode = 'factice_listing_publisher'): {
  adaptateur: AdaptateurConnecteur;
  executer: ReturnType<typeof vi.fn>;
} {
  const executer = vi.fn();
  const adaptateur: AdaptateurConnecteur = {
    nomInterface: 'ListingPublisher',
    typeConnecteurCode,
    executer,
  };
  return { adaptateur, executer };
}

function politiqueTest(
  surcharge: Partial<PolitiqueResilienceConnecteur> = {},
): PolitiqueResilienceConnecteur {
  return { ...POLITIQUE_RESILIENCE_CONNECTEUR_DEFAUT, ...surcharge };
}

describe('ServiceExecuteurConnecteurResilient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exécution réussie du premier coup : rend le résultat, réinitialise le disjoncteur', async () => {
    const { horloge } = horlogeFactice();
    const attente = new ServiceAttente();
    const journal = journalFactice();
    const executeur = new ServiceExecuteurConnecteurResilient(horloge, attente, journal);
    const resumeSucces = {
      lignesTotal: 0,
      lignesCreees: 0,
      lignesMajees: 0,
      lignesRejetees: 0,
      lignesIgnorees: 0,
    };
    const { adaptateur, executer } = adaptateurFactice();
    executer.mockResolvedValue({ resume: resumeSucces, erreurs: [] });

    const resultat = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE);

    expect(resultat).toEqual({
      reussite: true,
      resultat: { resume: resumeSucces, erreurs: [] },
      raisonEchec: null,
      tentatives: 1,
    });
    expect(executer).toHaveBeenCalledTimes(1);
  });

  it('réessaie avec un espacement croissant puis abandonne après épuisement des tentatives', async () => {
    const { horloge } = horlogeFactice();
    const appelsAttente: number[] = [];
    const attente = {
      attendre: vi.fn((ms: number) => {
        appelsAttente.push(ms);
        return Promise.resolve();
      }),
    } as unknown as ServiceAttente;
    const journal = journalFactice();
    const executeur = new ServiceExecuteurConnecteurResilient(horloge, attente, journal);
    const { adaptateur, executer } = adaptateurFactice();
    executer.mockRejectedValue(new Error('tiers indisponible'));

    const politique = politiqueTest({
      nombreMaxTentatives: 3,
      espacementInitialSecondes: 1,
      facteurCroissance: 2,
    });

    const resultat = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);

    expect(resultat.reussite).toBe(false);
    expect(resultat.raisonEchec).toBe('tentatives_epuisees');
    expect(resultat.tentatives).toBe(3);
    expect(executer).toHaveBeenCalledTimes(3);
    // 2 pauses pour 3 tentatives, espacement doublé à chaque échec : 1000 ms puis 2000 ms.
    expect(appelsAttente).toEqual([1_000, 2_000]);
  });

  it('dépasse le délai maximal si l’adaptateur ne se résout jamais, sans bloquer indéfiniment', async () => {
    vi.useFakeTimers();
    const { horloge } = horlogeFactice();
    const attente = new ServiceAttente();
    const journal = journalFactice();
    const executeur = new ServiceExecuteurConnecteurResilient(horloge, attente, journal);
    const { adaptateur, executer } = adaptateurFactice();
    executer.mockReturnValue(new Promise(() => {})); // ne se résout jamais

    const politique = politiqueTest({ nombreMaxTentatives: 1, delaiMaxMs: 5_000 });
    const promesseResultat = executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);

    await vi.advanceTimersByTimeAsync(5_000);
    const resultat = await promesseResultat;

    expect(resultat).toEqual({
      reussite: false,
      resultat: null,
      raisonEchec: 'delai_depasse',
      tentatives: 1,
    });
  });

  it('ouvre le disjoncteur après le nombre d’échecs consécutifs configuré et coupe l’appel réseau', async () => {
    const { horloge, avancer } = horlogeFactice();
    const attente = { attendre: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceAttente;
    const journal = journalFactice();
    const executeur = new ServiceExecuteurConnecteurResilient(horloge, attente, journal);
    const { adaptateur, executer } = adaptateurFactice();
    executer.mockRejectedValue(new Error('tiers indisponible'));

    const politique = politiqueTest({
      nombreMaxTentatives: 1,
      seuilCoupureEchecsConsecutifs: 2,
      dureeCoupureMs: 30_000,
    });

    const r1 = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);
    const r2 = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);
    expect(r1.raisonEchec).toBe('tentatives_epuisees');
    expect(r2.raisonEchec).toBe('tentatives_epuisees');
    expect(executer).toHaveBeenCalledTimes(2);

    // 3e appel : le disjoncteur est ouvert, aucune tentative réseau supplémentaire.
    const r3 = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);
    expect(r3).toEqual({
      reussite: false,
      resultat: null,
      raisonEchec: 'circuit_ouvert',
      tentatives: 0,
    });
    expect(executer).toHaveBeenCalledTimes(2);

    // La coupure écoulée, le disjoncteur retente au prochain appel.
    avancer(30_001);
    executer.mockResolvedValueOnce({
      resume: {
        lignesTotal: 0,
        lignesCreees: 0,
        lignesMajees: 0,
        lignesRejetees: 0,
        lignesIgnorees: 0,
      },
      erreurs: [],
    });
    const r4 = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);
    expect(r4.reussite).toBe(true);
    expect(executer).toHaveBeenCalledTimes(3);
  });

  it('isole le disjoncteur par tenant : les échecs du tenant A n’ouvrent jamais le circuit du tenant B', async () => {
    const { horloge } = horlogeFactice();
    const attente = { attendre: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceAttente;
    const journal = journalFactice();
    const executeur = new ServiceExecuteurConnecteurResilient(horloge, attente, journal);
    const { adaptateur, executer } = adaptateurFactice('meme_type_connecteur');

    const politique = politiqueTest({ nombreMaxTentatives: 1, seuilCoupureEchecsConsecutifs: 1 });

    executer.mockRejectedValue(new Error('tiers indisponible'));
    const rA = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);
    expect(rA.raisonEchec).toBe('tentatives_epuisees');

    // Le disjoncteur du tenant A est désormais ouvert (seuil = 1) — le tenant B, même type de
    // connecteur, n'est pas affecté : sa tentative part bien vers l'adaptateur.
    executer.mockResolvedValueOnce({
      resume: {
        lignesTotal: 0,
        lignesCreees: 0,
        lignesMajees: 0,
        lignesRejetees: 0,
        lignesIgnorees: 0,
      },
      erreurs: [],
    });
    const rB = await executeur.executer(CTX_TENANT_B, adaptateur, REQUETE, politique);
    expect(rB.reussite).toBe(true);

    const rA2 = await executeur.executer(CTX_TENANT_A, adaptateur, REQUETE, politique);
    expect(rA2.raisonEchec).toBe('circuit_ouvert');
  });

  it('ne journalise jamais le contenu de `requete.donnees` ni un secret qu’il porte', async () => {
    const { horloge } = horlogeFactice();
    const attente = { attendre: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceAttente;
    const journal = journalFactice();
    const executeur = new ServiceExecuteurConnecteurResilient(horloge, attente, journal);
    const { adaptateur, executer } = adaptateurFactice();
    executer.mockRejectedValue(new Error('tiers indisponible'));

    await executeur.executer(
      CTX_TENANT_A,
      adaptateur,
      REQUETE,
      politiqueTest({ nombreMaxTentatives: 2 }),
    );

    const journalMock = journal as unknown as {
      debug: ReturnType<typeof vi.fn>;
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
    const tousLesAppels = [
      ...journalMock.debug.mock.calls,
      ...journalMock.info.mock.calls,
      ...journalMock.warn.mock.calls,
      ...journalMock.error.mock.calls,
    ];
    expect(tousLesAppels.length).toBeGreaterThan(0);
    for (const appel of tousLesAppels) {
      const serialise = JSON.stringify(appel);
      expect(serialise).not.toContain('NE-DOIT-JAMAIS-APPARAITRE-EN-CLAIR');
      expect(serialise).not.toContain('cleApiSecrete');
      expect(serialise).not.toContain('donnees');
    }
  });
});
