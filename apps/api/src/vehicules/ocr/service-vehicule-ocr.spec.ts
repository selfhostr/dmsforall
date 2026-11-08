import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import type { ServiceLimitationDebit } from '../../common/limitation';
import type { ServiceEvenementsTempsReel } from '../../temps-reel';
import {
  ErreurMoteurOcr,
  type ChampMultiLectureOcr,
  type ClientMoteurOcr,
  type ReponseBruteMoteurOcr,
} from './client-moteur-ocr';
import type { ConfigOcrPermis } from './config-ocr';
import { ServiceVehiculeOcr } from './service-vehicule-ocr';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const CONFIG: ConfigOcrPermis = {
  OCR_SERVICE_URL: 'http://ocr-permis:8090',
  OCR_SERVICE_TIMEOUT_MS: 5000,
  LIMITE_OCR_PERMIS_UTILISATEUR: 15,
  LIMITE_OCR_PERMIS_FENETRE_SECONDES: 300,
};

/** Champ à UNE lecture — les six champs partagent la même forme depuis le retrait du vote
 *  triple-passe (20.08, voir `ChampMultiLectureOcr`) : jamais plus d'une lecture par champ. */
function champUnique(texte: string, confiance: number): ChampMultiLectureOcr {
  return { lectures: [{ texte, confiance }] };
}

/** Réponse brute « tout est lu » — chaque test part de cette base et l'altère au besoin. */
function brutComplet(
  surcharge: Partial<ReponseBruteMoteurOcr['champs']> = {},
): ReponseBruteMoteurOcr {
  return {
    champs: {
      plaque: champUnique('VD 123456', 90),
      vin: champUnique('1M8GDM9AXKP042788', 88),
      codeTypeCh: champUnique('1VD455', 70),
      premiereMiseEnCirculationLe: champUnique('31.01.2007', 85),
      detenteurNom: champUnique('Dupont Jean', 60),
      detenteurAdresse: champUnique('Rue Exemple 4\n1950 Sion', 55),
      ...surcharge,
    },
    avertissements: [],
    dureeMs: 1500,
  };
}

function brutVide(): ReponseBruteMoteurOcr {
  return {
    champs: {
      plaque: null,
      vin: null,
      codeTypeCh: null,
      premiereMiseEnCirculationLe: null,
      detenteurNom: null,
      detenteurAdresse: null,
    },
    avertissements: ['libelle_non_localise:vin'],
    dureeMs: 900,
  };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail(tx),
    ),
  } as unknown as AccesBase;
}

/** Extrait le texte SQL LITTÉRAL (hors valeurs interpolées) d'un objet `sql\`…\`` de drizzle-orm —
 *  `queryChunks` alterne chunks `{ value: string[] }` (littéraux) et valeurs de paramètres brutes. */
function texteSql(requete: unknown): string {
  const chunks = (requete as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) =>
      c && typeof c === 'object' && 'value' in c ? (c as { value: string[] }).value.join('') : '',
    )
    .join(' ');
}

function parametresSql(requete: unknown): readonly unknown[] {
  const chunks = (requete as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.filter((c) => !(c && typeof c === 'object' && 'value' in c));
}

/**
 * Route chaque appel `tx.execute` selon un fragment de texte SQL LITTÉRAL identifiant la table/
 * clause visée — robuste au nombre d'allers en base (ex. `type_approbation_ch` essaie plusieurs
 * candidats de code type) sans dépendre d'un ordre exact. Rend `[]` pour toute requête non
 * couverte — la maîtrise fine de CHAQUE requête est du ressort de `correspondance-permis.spec.ts`.
 */
function txFactice(routes: Readonly<Record<string, readonly unknown[]>> = {}): TransactionDfa {
  return {
    execute: vi.fn((requete: unknown) => {
      const texte = texteSql(requete);
      const entree = Object.entries(routes).find(([fragment]) => texte.includes(fragment));
      return Promise.resolve({ rows: entree ? entree[1] : [] });
    }),
  } as unknown as TransactionDfa;
}

function limiteurFactice(autorise = true): ServiceLimitationDebit {
  return {
    consommer: vi.fn().mockResolvedValue({ autorise, resteSecondes: autorise ? 0 : 42 }),
  };
}

function evenementsFactice(): ServiceEvenementsTempsReel {
  return { publier: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceEvenementsTempsReel;
}

function construireService(
  options: {
    tx?: TransactionDfa;
    moteur?: ClientMoteurOcr;
    limiteur?: ServiceLimitationDebit;
    evenements?: ServiceEvenementsTempsReel;
  } = {},
) {
  const tx = options.tx ?? txFactice();
  const acces = accesFactice(tx);
  const moteur: ClientMoteurOcr = options.moteur ?? {
    scanner: vi.fn().mockResolvedValue(brutComplet()),
  };
  const limiteur = options.limiteur ?? limiteurFactice();
  const evenements = options.evenements ?? evenementsFactice();

  const service = new ServiceVehiculeOcr(acces, moteur, limiteur, CONFIG, evenements);
  return { service, tx, acces, moteur, limiteur, evenements };
}

describe('ServiceVehiculeOcr.scanner — limitation de débit', () => {
  it('quota dépassé -> ErreurMetier AUTH_TROP_DE_TENTATIVES avec Retry-After, le moteur OCR n’est jamais appelé', async () => {
    const { service, moteur } = construireService({ limiteur: limiteurFactice(false) });

    await expect(service.scanner(CTX, Buffer.from('x'))).rejects.toMatchObject({
      code: 'AUTH_TROP_DE_TENTATIVES',
      enTetes: { 'Retry-After': '42' },
    });
    expect(moteur.scanner).not.toHaveBeenCalled();
  });
});

describe('ServiceVehiculeOcr.scanner — échecs du moteur OCR', () => {
  it('format non supporté (HEIC corrompu) -> ErreurMetier VALIDATION_ECHOUEE, journalisé sans le texte lu', async () => {
    const tx = txFactice();
    const moteur: ClientMoteurOcr = {
      scanner: vi
        .fn()
        .mockRejectedValue(new ErreurMoteurOcr('FORMAT_NON_SUPPORTE', 'HEIC corrompu')),
    };
    const { service } = construireService({ tx, moteur });

    await expect(service.scanner(CTX, Buffer.from('x'))).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });

    expect(tx.execute).toHaveBeenCalledTimes(1);
    const requete = (tx.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(texteSql(requete)).toContain('vehicule_ocr_scan_journal');
    expect(parametresSql(requete)).toContain('format_non_supporte');
  });

  it('moteur indisponible -> ErreurMetier SERVICE_LECTURE_INDISPONIBLE (503), journalisé', async () => {
    const tx = txFactice();
    const moteur: ClientMoteurOcr = {
      scanner: vi.fn().mockRejectedValue(new ErreurMoteurOcr('MOTEUR_INDISPONIBLE', 'timeout')),
    };
    const { service } = construireService({ tx, moteur });

    await expect(service.scanner(CTX, Buffer.from('x'))).rejects.toMatchObject({
      code: 'SERVICE_LECTURE_INDISPONIBLE',
      status: 503,
    });

    const requete = (tx.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(parametresSql(requete)).toContain('moteur_indisponible');
  });

  it('aucun champ exploitable extrait -> 422 VALIDATION_ECHOUEE, journalisé "rien_exploitable"', async () => {
    const tx = txFactice();
    const moteur: ClientMoteurOcr = { scanner: vi.fn().mockResolvedValue(brutVide()) };
    const { service } = construireService({ tx, moteur });

    await expect(service.scanner(CTX, Buffer.from('x'))).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
      status: 422,
    });

    const requete = (tx.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(parametresSql(requete)).toContain('rien_exploitable');
  });
});

describe('ServiceVehiculeOcr.scanner — succès, confiance par champ', () => {
  it('VIN à clé de contrôle valide, code type trouvé au référentiel -> vin/marque/modele "sure"', async () => {
    const tx = txFactice({
      type_approbation_ch: [
        { code_type_ch: '1VD455', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' },
      ],
    });
    const { service } = construireService({ tx });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.vin).toEqual({
      valeur: '1M8GDM9AXKP042788',
      confiance: 'sure',
    });
    expect(reponse.donnees.vehicule.marque).toEqual({ valeur: 'VW', confiance: 'sure' });
    expect(reponse.donnees.vehicule.modele).toEqual({ valeur: 'Polo', confiance: 'sure' });
  });

  it('VIN à clé de contrôle incohérente -> "absente" (jamais de statut "douteuse" pour ce champ)', async () => {
    const moteur: ClientMoteurOcr = {
      // WVWZZZ1KZAW123456 : fixture VIN existante du dépôt (vehicule.controller.ts), checksum invalide.
      scanner: vi
        .fn()
        .mockResolvedValue(brutComplet({ vin: champUnique('WVWZZZ1KZAW123456', 82) })),
    };
    const { service } = construireService({ moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.vin).toEqual({ valeur: null, confiance: 'absente' });
  });

  it('code type absent du référentiel -> marque/modele "absente" (jamais une valeur OCRisée non recoupée)', async () => {
    const { service } = construireService();

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.marque).toEqual({ valeur: null, confiance: 'absente' });
    expect(reponse.donnees.vehicule.modele).toEqual({ valeur: null, confiance: 'absente' });
  });

  it('champ non lu par le conteneur (zone/libellé non localisé) -> "absente", valeur null', async () => {
    const moteur: ClientMoteurOcr = {
      scanner: vi.fn().mockResolvedValue(brutComplet({ vin: null })),
    };
    const { service } = construireService({ moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.vin).toEqual({ valeur: null, confiance: 'absente' });
  });

  it('nom lu, aucun mot-clé de raison sociale -> personne physique : nom/prenom "douteuse", raisonSociale "absente"', async () => {
    const { service } = construireService();

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.detenteur.estEntreprise).toEqual({
      valeur: false,
      confiance: 'douteuse',
    });
    expect(reponse.donnees.detenteur.nom).toEqual({ valeur: 'Dupont', confiance: 'douteuse' });
    expect(reponse.donnees.detenteur.prenom).toEqual({ valeur: 'Jean', confiance: 'douteuse' });
    expect(reponse.donnees.detenteur.raisonSociale).toEqual({ valeur: null, confiance: 'absente' });
  });

  it('mot-clé de forme juridique détecté -> entreprise : raisonSociale "douteuse", nom/prenom "absente"', async () => {
    const moteur: ClientMoteurOcr = {
      scanner: vi
        .fn()
        .mockResolvedValue(brutComplet({ detenteurNom: champUnique('Garage Exemple SA', 70) })),
    };
    const { service } = construireService({ moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.detenteur.estEntreprise).toEqual({
      valeur: true,
      confiance: 'douteuse',
    });
    expect(reponse.donnees.detenteur.raisonSociale).toEqual({
      valeur: 'Garage Exemple SA',
      confiance: 'douteuse',
    });
    expect(reponse.donnees.detenteur.nom).toEqual({ valeur: null, confiance: 'absente' });
    expect(reponse.donnees.detenteur.prenom).toEqual({ valeur: null, confiance: 'absente' });
  });

  it('adresse : rue/npa/localite jamais "sure" (texte libre, aucune source de validation légitime)', async () => {
    const { service } = construireService();

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.detenteur.rue).toEqual({
      valeur: 'Rue Exemple 4',
      confiance: 'douteuse',
    });
    expect(reponse.donnees.detenteur.npa).toEqual({ valeur: '1950', confiance: 'douteuse' });
    expect(reponse.donnees.detenteur.localite).toEqual({ valeur: 'Sion', confiance: 'douteuse' });
  });

  it('un véhicule existant est retrouvé par VIN -> correspondances.vehicule = {id, libelle}', async () => {
    const tx = txFactice({
      // Fragment propre à la requête VIN (rechercherVehiculeParVin) — distinct de
      // vehicule_plaque/vehicule_ocr_scan_journal, qui contiennent aussi "vehicule".
      'upper(vin) = upper(': [{ id: 'veh-9', marque: 'VW', modele: 'Polo' }],
    });
    const { service } = construireService({ tx });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.correspondances.vehicule).toEqual({ id: 'veh-9', libelle: 'VW Polo' });
  });

  it('aucun véhicule trouvé -> la clé "vehicule" est ABSENTE de correspondances (jamais null)', async () => {
    const { service } = construireService();

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect('vehicule' in reponse.correspondances).toBe(false);
  });

  it('un client existant est retrouvé -> correspondances.client = {id, nomAffiche}, événement temps réel émis avec SEULEMENT son id', async () => {
    const tx = txFactice({
      client_adresse: [{ client_id: 'cli-7', numero: 'CL-007', nom: 'Dupont Jean', npa: '1950' }],
    });
    const { service, evenements } = construireService({ tx });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.correspondances.client).toEqual({ id: 'cli-7', nomAffiche: 'Dupont Jean' });
    expect(evenements.publier).toHaveBeenCalledWith(
      'tid-1',
      'vehicule.correspondance_scan_permis',
      { clientId: 'cli-7' },
      expect.arrayContaining(['receptionnaire', 'vendeur', 'direction']),
      // Filtre sur le DROIT de chaque abonné (sa grille), plus sur son rôle seul.
      'client.lire',
    );
  });

  it('aucun client trouvé -> aucun événement temps réel émis, clé "client" absente', async () => {
    const { service, evenements } = construireService();

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(evenements.publier).not.toHaveBeenCalled();
    expect('client' in reponse.correspondances).toBe(false);
  });

  it('VIN lu avec une confusion de caractère plausible (0/O, 1/I, 5/S…) -> corrigé et rendu "sure" (recherche contrainte, extraction-permis.rechercherVin)', async () => {
    const moteur: ClientMoteurOcr = {
      // '1MBGDM9AXKP042788' : le VIN valide '1M8GDM9AXKP042788' avec un '8' lu 'B' (classe de
      // confusion visuelle 8/B) — corrigible car SEUL candidat à valider la clé de contrôle.
      scanner: vi
        .fn()
        .mockResolvedValue(brutComplet({ vin: champUnique('1MBGDM9AXKP042788', 75) })),
    };
    const { service } = construireService({ moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.vin).toEqual({
      valeur: '1M8GDM9AXKP042788',
      confiance: 'sure',
    });
  });

  it('code type non trouvé en EXACT mais retrouvé en APPROXIMATIF (distance d’édition <= 2 contre le référentiel) -> marque/modele "sure" quand même', async () => {
    const tx = txFactice({
      // Fragment PROPRE à la requête approximative (`public.similarity(`, absent de la requête
      // exacte qui utilise `=` sans fonction de score) — la requête exacte, elle, ne matche aucune
      // route ci-dessous et rend donc [] pour chaque candidat essayé, avant le repli approximatif.
      'similarity(': [
        { code_type_ch: '1VD450', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' },
      ],
    });
    const moteur: ClientMoteurOcr = {
      // 'O' au lieu de '0' (confusion visuelle) — à distance d'édition 1 de '1VD450'.
      scanner: vi.fn().mockResolvedValue(brutComplet({ codeTypeCh: champUnique('1VD45O', 65) })),
    };
    const { service } = construireService({ tx, moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.marque).toEqual({ valeur: 'VW', confiance: 'sure' });
    expect(reponse.donnees.vehicule.modele).toEqual({ valeur: 'Polo', confiance: 'sure' });
  });

  it('le code type est cherché AVANT le VIN : sa marque (trouvée au référentiel) sert à départager deux candidats VIN concurrents (croisement WMI, wmi-marques.ts)', async () => {
    const tx = txFactice({
      // Route exacte : le PREMIER candidat de code type essayé matche déjà, donc l'approximatif
      // n'est jamais interrogé — même patron que le test de succès existant ci-dessus.
      type_approbation_ch: [
        {
          code_type_ch: '1VD455',
          marque: 'MITSUBISHI',
          modele: 'Space Star',
          carburant_code: null,
        },
      ],
    });
    const moteur: ClientMoteurOcr = {
      // 'JM8CT4CZ3DYK9NY46' : à une substitution de DEUX VIN différents à clé de contrôle valide
      // ('JMBCT4CZ3DYK9NY46' WMI JMB, et 'JM8CT4CZ30YK9NY46' WMI JM8) — ambigu SANS la marque, le
      // WMI Mitsubishi (JMB, wmi-marques.ts) départage vers le premier.
      scanner: vi
        .fn()
        .mockResolvedValue(brutComplet({ vin: champUnique('JM8CT4CZ3DYK9NY46', 70) })),
    };
    const { service } = construireService({ tx, moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.vin).toEqual({
      valeur: 'JMBCT4CZ3DYK9NY46',
      confiance: 'sure',
    });
  });

  it('deux candidats VIN valident la clé de contrôle et le code type n’est PAS trouvé (aucune marque pour départager) -> VIN "absente" (jamais un choix arbitraire)', async () => {
    const moteur: ClientMoteurOcr = {
      scanner: vi
        .fn()
        .mockResolvedValue(brutComplet({ vin: champUnique('JM8CT4CZ3DYK9NY46', 70) })),
    };
    const { service } = construireService({ moteur }); // txFactice() par défaut : code type jamais trouvé

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.vin).toEqual({ valeur: null, confiance: 'absente' });
  });

  it('scan réussi -> une ligne "succes" est écrite dans le journal d’audit', async () => {
    const { service, tx } = construireService();

    await service.scanner(CTX, Buffer.from('x'));

    const appelJournal = (tx.execute as ReturnType<typeof vi.fn>).mock.calls
      .map((appel) => appel[0])
      .find((requete) => texteSql(requete).includes('vehicule_ocr_scan_journal'));

    expect(appelJournal).toBeDefined();
    expect(texteSql(appelJournal)).toContain("'succes'");
  });
});

describe('ServiceVehiculeOcr.scanner — code type, une seule passe (retrait du vote triple-passe, 20.08)', () => {
  it('lecture validée au référentiel -> "sure" (voir le rapport de recalibrage : le vote triple-passe a été mesuré sans gain suffisant sur ce champ pour son coût en temps, retiré)', async () => {
    const tx = txFactice({
      type_approbation_ch: [
        { code_type_ch: '1VD455', marque: 'VW', modele: 'Polo', carburant_code: 'ESSENCE' },
      ],
    });
    const moteur: ClientMoteurOcr = {
      scanner: vi.fn().mockResolvedValue(brutComplet({ codeTypeCh: champUnique('1VD455', 70) })),
    };
    const { service } = construireService({ tx, moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.marque).toEqual({ valeur: 'VW', confiance: 'sure' });
  });

  it('lecture ne se validant pas au référentiel -> "absente", jamais une proposition non confirmée', async () => {
    // txFactice() par défaut, aucune route enregistrée : toute recherche (exacte puis
    // approximative) rend systématiquement [] -- aucun candidat, quel qu'il soit, ne trouve.
    const moteur: ClientMoteurOcr = {
      scanner: vi.fn().mockResolvedValue(brutComplet({ codeTypeCh: champUnique('1VD455', 70) })),
    };
    const { service } = construireService({ moteur });

    const reponse = await service.scanner(CTX, Buffer.from('x'));

    expect(reponse.donnees.vehicule.marque).toEqual({ valeur: null, confiance: 'absente' });
  });
});
