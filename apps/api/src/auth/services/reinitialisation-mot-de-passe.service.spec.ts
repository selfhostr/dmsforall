import { describe, expect, it, vi } from 'vitest';
import type { UtilisateurAmorcage } from '../../db/db.types';
import type { AccesAmorcage, AccesBase, ContexteTenant, TransactionDfa } from '../../db/db.types';
import { jetonReinitialisationMotDePasse, session, utilisateur } from '../../db/schema';
import type { Config } from '../../config/config.types';
import type { ServiceContexteRequete } from '../../common/contexte/contexte-requete.service';
import type { ServiceLimitationDebit } from '../../common/limitation/limitation-debit.types';
import type { ServiceCourriel } from '../../courriel';
import { ServicePolitiqueMotDePasse } from '../politique-mot-de-passe';
import type { ServiceMotDePasse } from '../auth.types';
import { ErreurJetonReinitialisationInvalide, ErreurTropDeTentatives } from '../erreurs-auth';
import { ServiceReinitialisationMotDePasseImpl } from './reinitialisation-mot-de-passe.service';

const TENANT_ID = 'tenant-id';
const UTILISATEUR_ID = 'utilisateur-id';
const EMAIL = 'julie.rey@garage-martin.ch';

function configTest(overrides: Partial<Config> = {}): Config {
  return {
    LIMITE_CONNEXION_IP: 20,
    LIMITE_CONNEXION_COMPTE: 15,
    LIMITE_FENETRE_SECONDES: 900,
    WEB_URL_PUBLIQUE: 'https://app.dmsforall.example',
    SMTP_EXPEDITEUR: undefined,
    ...overrides,
  } as Config;
}

function utilisateurTest(overrides: Partial<UtilisateurAmorcage> = {}): UtilisateurAmorcage {
  return {
    id: UTILISATEUR_ID,
    tenantId: TENANT_ID,
    email: EMAIL,
    motDePasseHash: '$argon2id$v=19$m=19456,t=2,p=1$ancien',
    statut: 'actif',
    statutTenant: 'actif',
    role: 'vendeur',
    langue: 'fr',
    echecsConnexion: 3,
    verrouilleJusquA: null,
    ...overrides,
  };
}

/**
 * Fausse transaction générique à file ordonnée — même patron que
 * `socle/service-utilisateur.spec.ts::construireTxFactice` : chaque chaîne
 * `select()/insert()/update()...` ouvre un proxy qui, à l'`await` final, consomme la prochaine
 * valeur de la file. Les appels `values()/set()` sont en plus enregistrés (table + payload) pour
 * inspecter ce qui a réellement été écrit sans interpréter du SQL.
 */
interface AppelEnregistre {
  readonly table: unknown;
  readonly payload?: unknown;
}

function construireTxFactice(reponses: readonly unknown[]): {
  readonly tx: TransactionDfa;
  readonly appels: AppelEnregistre[];
  /** Compte les appels `.for('update')` — garde de non-régression sur le verrouillage anti-TOCTOU
   *  de `confirmer()` (voir son commentaire : deux confirmations concurrentes sur le même jeton
   *  ne doivent jamais toutes les deux le voir « valide »). */
  readonly appelsFor: string[];
} {
  const file = [...reponses];
  const appels: AppelEnregistre[] = [];
  const appelsFor: string[] = [];

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
            if (prop === 'for') appelsFor.push(String(args[0]));
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
  } as unknown as TransactionDfa;

  return { tx, appels, appelsFor };
}

function accesAvec(tx: TransactionDfa): AccesBase {
  return {
    enTenant: async <T>(_ctx: ContexteTenant, travail: (t: TransactionDfa) => Promise<T>) =>
      travail(tx),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

function accesQuiEchoueSiInterroge(): AccesBase {
  return {
    enTenant: async () => {
      throw new Error('ne doit jamais être atteint : refus attendu avant tout accès base.');
    },
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  } as unknown as AccesBase;
}

function contexteTest(): ServiceContexteRequete {
  return { actuelOuNull: () => null } as unknown as ServiceContexteRequete;
}

function courrielFactice(): ServiceCourriel {
  return {
    envoyer: vi.fn().mockResolvedValue({ succes: true, idMessage: 'msg-1' }),
  } as unknown as ServiceCourriel;
}

function limiteurAutorisant(): ServiceLimitationDebit {
  return { consommer: vi.fn().mockResolvedValue({ autorise: true, resteSecondes: 0 }) };
}

function motDePasseFactice(): ServiceMotDePasse {
  return {
    hacher: vi.fn(async (clair: string) => `HASH(${clair})`),
    verifier: vi.fn(async () => true),
    verifierLeurre: vi.fn(async () => undefined),
    doitEtreRehache: vi.fn(() => false),
  };
}

function service(options: {
  readonly accesBase: AccesBase;
  readonly accesAmorcage: AccesAmorcage;
  readonly config?: Config;
  readonly limiteur?: ServiceLimitationDebit;
  readonly courriel?: ServiceCourriel;
  readonly servicePwd?: ServiceMotDePasse;
}): ServiceReinitialisationMotDePasseImpl {
  return new ServiceReinitialisationMotDePasseImpl(
    options.config ?? configTest(),
    options.accesBase,
    options.accesAmorcage,
    options.servicePwd ?? motDePasseFactice(),
    options.limiteur ?? limiteurAutorisant(),
    options.courriel ?? courrielFactice(),
    new ServicePolitiqueMotDePasse(),
    contexteTest(),
  );
}

describe('ServiceReinitialisationMotDePasseImpl.demander — anti-énumération', () => {
  it('email inconnu : ne lève jamais, aucun courriel envoyé, aucun accès base tenant, journalise avec tenantId null', async () => {
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn().mockResolvedValue(null),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
    const courriel = courrielFactice();
    const svc = service({
      accesBase: accesQuiEchoueSiInterroge(),
      accesAmorcage,
      courriel,
    });

    await expect(
      svc.demander({ email: 'inconnu@example.ch' }, '203.0.113.1', 'ua'),
    ).resolves.toBeUndefined();

    expect(courriel.envoyer).not.toHaveBeenCalled();
    expect(accesAmorcage.journaliserSecurite).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reinitialisation_echouee',
        tenantId: null,
        utilisateurId: null,
        emailTente: 'inconnu@example.ch',
        details: expect.objectContaining({ raison: 'email_inconnu' }),
      }),
    );
  });

  it('compte suspendu : même comportement générique qu’un email inconnu (pas de fuite du statut)', async () => {
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn().mockResolvedValue(utilisateurTest({ statut: 'suspendu' })),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
    const courriel = courrielFactice();
    const svc = service({ accesBase: accesQuiEchoueSiInterroge(), accesAmorcage, courriel });

    await expect(svc.demander({ email: EMAIL }, null, null)).resolves.toBeUndefined();
    expect(courriel.envoyer).not.toHaveBeenCalled();
  });

  it('email connu et actif : émet un jeton, révoque les jetons antérieurs, envoie un courriel, journalise le succès', async () => {
    const { tx, appels } = construireTxFactice([
      [], // revoquerJetonsActifsDansTransaction : update(jetonReinitialisationMotDePasse)
      [], // insert(jetonReinitialisationMotDePasse).values(...)
      [{ raisonSociale: 'Garage Martin Sàrl' }], // select(tenant.raisonSociale)
    ]);
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn().mockResolvedValue(utilisateurTest()),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
    const courriel = courrielFactice();
    const svc = service({ accesBase: accesAvec(tx), accesAmorcage, courriel });

    await svc.demander({ email: EMAIL }, '203.0.113.1', 'ua-test');

    // Le jeton précédent (s'il existe) est révoqué AVANT l'insertion du nouveau.
    const appelRevocation = appels.find(
      (a) =>
        a.table === jetonReinitialisationMotDePasse &&
        (a.payload as { revoqueLe?: Date } | undefined)?.revoqueLe instanceof Date,
    );
    expect(appelRevocation).toBeDefined();

    const appelInsertion = appels.find(
      (a) =>
        a.table === jetonReinitialisationMotDePasse &&
        a.payload &&
        'empreinteJeton' in (a.payload as object),
    );
    expect(appelInsertion?.payload).toMatchObject({
      tenantId: TENANT_ID,
      utilisateurId: UTILISATEUR_ID,
    });

    expect(courriel.envoyer).toHaveBeenCalledOnce();
    const messageEnvoye = (courriel.envoyer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      destinataires: readonly string[];
      nomGarage: string;
      corpsTexte: string;
    };
    expect(messageEnvoye.destinataires).toEqual([EMAIL]);
    expect(messageEnvoye.nomGarage).toBe('Garage Martin Sàrl');
    // Le lien pointe vers WEB_URL_PUBLIQUE et porte un jeton opaque (jamais le mot de passe).
    expect(messageEnvoye.corpsTexte).toContain(
      'https://app.dmsforall.example/reinitialiser-mot-de-passe?',
    );

    expect(accesAmorcage.journaliserSecurite).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reinitialisation_demandee', tenantId: TENANT_ID }),
    );
  });

  it('rejette avec 429 quand la limitation de débit par IP est dépassée, sans jamais interroger amorcage', async () => {
    const limiteur: ServiceLimitationDebit = {
      consommer: vi.fn().mockResolvedValueOnce({ autorise: false, resteSecondes: 12 }),
    };
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn(),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const svc = service({ accesBase: accesQuiEchoueSiInterroge(), accesAmorcage, limiteur });

    await expect(svc.demander({ email: EMAIL }, '203.0.113.1', 'ua')).rejects.toBeInstanceOf(
      ErreurTropDeTentatives,
    );
    expect(accesAmorcage.utilisateurParEmail).not.toHaveBeenCalled();
  });
});

describe('ServiceReinitialisationMotDePasseImpl.confirmer — usage unique, révocation des sessions', () => {
  function accesAmorcageAvecUtilisateur(): AccesAmorcage {
    return {
      utilisateurParEmail: vi.fn().mockResolvedValue(utilisateurTest()),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('jeton valide + mot de passe conforme : hache le mot de passe, révoque TOUTES les sessions, marque le jeton utilisé, journalise le succès, verrouille la ligne (for update, anti-TOCTOU)', async () => {
    const { tx, appels, appelsFor } = construireTxFactice([
      [{ id: 'jeton-id-1' }], // select(jetonReinitialisationMotDePasse) — vérification
      [], // update(jetonReinitialisationMotDePasse).set({utiliseLe})
      [], // update(session).set({revoqueeLe})
      [], // update(utilisateur).set({motDePasseHash, ...})
    ]);
    const accesAmorcage = accesAmorcageAvecUtilisateur();
    const servicePwd = motDePasseFactice();
    const svc = service({ accesBase: accesAvec(tx), accesAmorcage, servicePwd });

    await svc.confirmer(
      {
        email: EMAIL,
        jeton: 'jeton-clair-recu-par-courriel',
        nouveauMotDePasse: 'un-mot-de-passe-tres-solide',
      },
      '203.0.113.1',
      'ua',
    );

    expect(servicePwd.hacher).toHaveBeenCalledWith('un-mot-de-passe-tres-solide');

    const appelJeton = appels.find(
      (a) =>
        a.table === jetonReinitialisationMotDePasse &&
        (a.payload as { utiliseLe?: Date })?.utiliseLe,
    );
    expect(appelJeton).toBeDefined();

    const appelSession = appels.find(
      (a) =>
        a.table === session && (a.payload as { revoqueeLe?: Date })?.revoqueeLe instanceof Date,
    );
    expect(appelSession).toBeDefined();

    const appelUtilisateur = appels.find(
      (a) => a.table === utilisateur && (a.payload as { motDePasseHash?: string })?.motDePasseHash,
    );
    expect(appelUtilisateur?.payload).toMatchObject({
      motDePasseHash: 'HASH(un-mot-de-passe-tres-solide)',
      echecsConnexion: 0,
      verrouilleJusquA: null,
    });

    expect(accesAmorcage.journaliserSecurite).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reinitialisation_reussie', tenantId: TENANT_ID }),
    );

    expect(appelsFor).toContain('update');
  });

  it('jeton inconnu/expiré/déjà utilisé : erreur générique AUTH_JETON_REINITIALISATION_INVALIDE, mot de passe jamais haché', async () => {
    const { tx } = construireTxFactice([
      [], // select(jetonReinitialisationMotDePasse) — aucune ligne trouvée
    ]);
    const accesAmorcage = accesAmorcageAvecUtilisateur();
    const servicePwd = motDePasseFactice();
    const svc = service({ accesBase: accesAvec(tx), accesAmorcage, servicePwd });

    const erreur = await svc
      .confirmer(
        { email: EMAIL, jeton: 'jeton-invalide', nouveauMotDePasse: 'un-mot-de-passe-tres-solide' },
        null,
        null,
      )
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurJetonReinitialisationInvalide);
    expect(servicePwd.hacher).not.toHaveBeenCalled();
    expect(accesAmorcage.journaliserSecurite).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reinitialisation_echouee',
        details: expect.objectContaining({ raison: 'jeton_invalide' }),
      }),
    );
  });

  it('email inconnu à la confirmation : MÊME erreur générique qu’un jeton invalide (anti-énumération), jamais un accès base', async () => {
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn().mockResolvedValue(null),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn().mockResolvedValue(undefined),
    };
    const svc = service({ accesBase: accesQuiEchoueSiInterroge(), accesAmorcage });

    await expect(
      svc.confirmer(
        {
          email: 'inconnu@example.ch',
          jeton: 'peu-importe',
          nouveauMotDePasse: 'un-mot-de-passe-tres-solide',
        },
        null,
        null,
      ),
    ).rejects.toBeInstanceOf(ErreurJetonReinitialisationInvalide);
  });

  it('mot de passe trop commun : refusé APRÈS validation du jeton, jamais haché ni écrit (politique de mot de passe réelle), et le JETON N’EST PAS BRÛLÉ — l’employé peut réessayer avec le même lien', async () => {
    const { tx, appels } = construireTxFactice([
      [{ id: 'jeton-id-1' }], // select(jetonReinitialisationMotDePasse) — jeton trouvé et valide
    ]);
    const accesAmorcage = accesAmorcageAvecUtilisateur();
    const servicePwd = motDePasseFactice();
    const svc = service({ accesBase: accesAvec(tx), accesAmorcage, servicePwd });

    await expect(
      svc.confirmer(
        { email: EMAIL, jeton: 'jeton-clair', nouveauMotDePasse: 'aaaaaaaaaaaa' },
        null,
        null,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(servicePwd.hacher).not.toHaveBeenCalled();
    // La transaction est annulée AVANT le UPDATE marquant utilise_le : aucune écriture, jamais.
    expect(appels).toHaveLength(0);
    // Ni budget email consommé, ni journal d'échec dédié pour un mot de passe simplement refusé
    // (ce n'est pas une tentative suspecte contre le jeton lui-même).
    expect(accesAmorcage.journaliserSecurite).not.toHaveBeenCalled();
  });

  it('rejette avec 429 quand la limitation de débit par IP est dépassée, sans jamais interroger amorcage', async () => {
    const limiteur: ServiceLimitationDebit = {
      consommer: vi.fn().mockResolvedValueOnce({ autorise: false, resteSecondes: 5 }),
    };
    const accesAmorcage: AccesAmorcage = {
      utilisateurParEmail: vi.fn(),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    };
    const svc = service({ accesBase: accesQuiEchoueSiInterroge(), accesAmorcage, limiteur });

    await expect(
      svc.confirmer(
        { email: EMAIL, jeton: 'x', nouveauMotDePasse: 'un-mot-de-passe-tres-solide' },
        '203.0.113.1',
        'ua',
      ),
    ).rejects.toBeInstanceOf(ErreurTropDeTentatives);
    expect(accesAmorcage.utilisateurParEmail).not.toHaveBeenCalled();
  });
});

describe('ServiceReinitialisationMotDePasseImpl.revoquerJetonsActifsDansTransaction', () => {
  it('marque revoque_le sur les jetons non utilisés/non révoqués de cet utilisateur, dans la transaction fournie', async () => {
    const { tx, appels } = construireTxFactice([[]]);
    const accesAmorcage = {
      utilisateurParEmail: vi.fn(),
      sessionParEmpreinte: vi.fn(),
      toucherSession: vi.fn(),
      enregistrerEchecConnexion: vi.fn(),
      reinitialiserEchecsConnexion: vi.fn(),
      journaliserSecurite: vi.fn(),
    } satisfies AccesAmorcage;
    const svc = service({ accesBase: accesQuiEchoueSiInterroge(), accesAmorcage });
    const ctx: ContexteTenant = { tenantId: TENANT_ID, utilisateurId: 'admin-id', requeteId: null };

    await svc.revoquerJetonsActifsDansTransaction(tx, ctx, UTILISATEUR_ID);

    expect(appels).toHaveLength(1);
    expect(appels[0]?.table).toBe(jetonReinitialisationMotDePasse);
    expect(appels[0]?.payload).toMatchObject({ revoqueLe: expect.any(Date) });
  });
});
