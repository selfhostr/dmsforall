import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config';
import type { ContexteTenant } from '../db';
import type { FabriqueTransportSmtp } from './fabrique-transport-smtp';
import type { ServiceReglageEnvoiCourriel } from './service-reglage-envoi-courriel';
import type { ServiceJournal } from '../common/journal';
import { ErreurDechiffrementSecret } from './chiffrement-secrets';
import { ErreurHoteSmtpInterdit } from './garde-hote-smtp';
import { ServiceCourriel } from './service-courriel';
import {
  TAILLE_MAX_PIECE_JOINTE_OCTETS,
  type EnveloppeCourriel,
  type PieceJointeCourriel,
  type TransportCourriel,
} from './transport-courriel.interface';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: null, requeteId: null };

function reglagesAucun(): ServiceReglageEnvoiCourriel {
  return { resoudreEnvoiGarage: vi.fn(async () => null) } as unknown as ServiceReglageEnvoiCourriel;
}

function fabriqueFactice(): FabriqueTransportSmtp {
  return { creer: vi.fn() } as unknown as FabriqueTransportSmtp;
}

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

function transportEspion(): { transport: TransportCourriel; enveloppes: EnveloppeCourriel[] } {
  const enveloppes: EnveloppeCourriel[] = [];
  const transport: TransportCourriel = {
    envoyer: vi.fn(async (enveloppe: EnveloppeCourriel) => {
      enveloppes.push(enveloppe);
      return { succes: true, idMessage: 'msg-1' };
    }),
  };
  return { transport, enveloppes };
}

describe('ServiceCourriel — construction de l’enveloppe', () => {
  it('l’expéditeur est TOUJOURS SMTP_EXPEDITEUR (no-reply@dmsforall.example), jamais l’adresse du garage', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.de).toBe('no-reply@dmsforall.example');
  });

  it('utilise le repli no-reply@dmsforall.example si SMTP_EXPEDITEUR est absente (dev sans .env complet)', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = {} as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.de).toBe('no-reply@dmsforall.example');
  });

  it('le Reply-To porte l’adresse du garage, jamais l’expéditeur technique', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.repondreA).toBe('contact@garage-martin.ch');
  });

  it('le nom affiché porte le nom du garage, suffixé « via dmsforall »', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.nomExpediteurAffiche).toBe('Garage Martin via dmsforall');
  });

  it('rend le résultat du transport tel quel', async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );

    const resultat = await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(resultat).toEqual({ succes: true, idMessage: 'msg-1' });
  });
});

describe('ServiceCourriel — journalisation, sans données personnelles au niveau info/warn', () => {
  it("le succès n'écrit ni l'adresse du destinataire ni le sujet au niveau info — seul le compte", async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const journal = journalFactice();
    const service = new ServiceCourriel(
      transport,
      config,
      journal,
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client-un@example.ch', 'client-deux@example.ch'],
      sujet: 'Rappel facture 2026-042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(journal.info).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.info as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.destinataires).toBeUndefined();
    expect(donnees.sujet).toBeUndefined();
    expect(donnees.nombreDestinataires).toBe(2);
    expect(JSON.stringify(donnees)).not.toContain('client-un@example.ch');
    expect(JSON.stringify(donnees)).not.toContain('Rappel facture 2026-042');
  });

  it("l'échec n'écrit ni l'adresse du destinataire ni le sujet au niveau warn — seul le compte et l'erreur de transport", async () => {
    const transport: TransportCourriel = {
      envoyer: vi.fn(async () => ({ succes: false, erreur: 'boîte pleine' })),
    };
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const journal = journalFactice();
    const service = new ServiceCourriel(
      transport,
      config,
      journal,
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Rappel facture 2026-042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(journal.warn).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.destinataires).toBeUndefined();
    expect(donnees.sujet).toBeUndefined();
    expect(donnees.nombreDestinataires).toBe(1);
    expect(donnees.erreur).toBe('boîte pleine');
  });

  it('conserve le détail (destinataires, sujet) au niveau debug — désactivé par défaut en production', async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const journal = journalFactice();
    const service = new ServiceCourriel(
      transport,
      config,
      journal,
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Rappel facture 2026-042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(journal.debug).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.debug as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.destinataires).toEqual(['client@example.ch']);
    expect(donnees.sujet).toBe('Rappel facture 2026-042');
  });
});

function pieceJointe(taille: number, nomFichier = 'Facture-2026-00042.pdf'): PieceJointeCourriel {
  return { nomFichier, contenu: Buffer.alloc(taille, 1), typeMime: 'application/pdf' };
}

describe('ServiceCourriel — pièce jointe (facture PDF)', () => {
  it('traverse jusqu’à l’enveloppe transmise au transport', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );
    const piece = pieceJointe(1024);

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Facture 2026-00042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
      piecesJointes: [piece],
    });

    expect(enveloppes[0]?.piecesJointes).toEqual([piece]);
  });

  it('refuse AVANT tout appel au transport quand la taille cumulée dépasse la borne', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );

    await expect(
      service.envoyer({
        ctx: CTX,
        destinataires: ['client@example.ch'],
        sujet: 'Facture 2026-00042',
        nomGarage: 'Garage Martin',
        adresseReponseGarage: 'contact@garage-martin.ch',
        piecesJointes: [pieceJointe(TAILLE_MAX_PIECE_JOINTE_OCTETS + 1)],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(enveloppes).toHaveLength(0);
    expect(transport.envoyer).not.toHaveBeenCalled();
  });

  it('accepte pile la borne (limite inclusive)', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Facture 2026-00042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
      piecesJointes: [pieceJointe(TAILLE_MAX_PIECE_JOINTE_OCTETS)],
    });

    expect(enveloppes).toHaveLength(1);
  });

  it('la borne porte sur la taille CUMULÉE de plusieurs pièces jointes, pas chacune isolément', async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(
      transport,
      config,
      journalFactice(),
      reglagesAucun(),
      fabriqueFactice(),
    );
    const moitie = Math.floor(TAILLE_MAX_PIECE_JOINTE_OCTETS / 2) + 1;

    await expect(
      service.envoyer({
        ctx: CTX,
        destinataires: ['client@example.ch'],
        sujet: 'Facture 2026-00042',
        nomGarage: 'Garage Martin',
        adresseReponseGarage: 'contact@garage-martin.ch',
        piecesJointes: [pieceJointe(moitie, 'a.pdf'), pieceJointe(moitie, 'b.pdf')],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });

  it("le nom de la pièce jointe n'apparaît jamais au niveau info/warn — seul le compte", async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const journal = journalFactice();
    const service = new ServiceCourriel(
      transport,
      config,
      journal,
      reglagesAucun(),
      fabriqueFactice(),
    );

    await service.envoyer({
      ctx: CTX,
      destinataires: ['client@example.ch'],
      sujet: 'Facture 2026-00042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
      piecesJointes: [pieceJointe(1024, 'Facture-2026-00042-client-secret.pdf')],
    });

    const [, donneesInfo] = (journal.info as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donneesInfo.nombrePiecesJointes).toBe(1);
    expect(JSON.stringify(donneesInfo)).not.toContain('client-secret');

    const [, donneesDebug] = (journal.debug as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donneesDebug.nomsPiecesJointes).toEqual(['Facture-2026-00042-client-secret.pdf']);
  });
});

describe('ServiceCourriel — choix du serveur d’envoi (garage > instance > rien)', () => {
  const MESSAGE = {
    ctx: CTX,
    destinataires: ['client@example.ch'],
    sujet: 'Facture',
    nomGarage: 'Garage Martin',
    adresseReponseGarage: 'contact@garage-martin.ch',
  } as const;
  const SMTP_GARAGE = {
    hote: 'mail.garage-martin.ch',
    port: 587,
    securise: false,
    utilisateur: 'atelier',
    motDePasse: 'x',
    expediteur: 'atelier@garage-martin.ch',
  };

  function monter(
    config: Partial<Config>,
    garage: Awaited<ReturnType<ServiceReglageEnvoiCourriel['resoudreEnvoiGarage']>> | Error,
  ) {
    const instance = transportEspion();
    const garageTransport = transportEspion();
    const reglages = {
      resoudreEnvoiGarage: vi.fn(async () => {
        if (garage instanceof Error) throw garage;
        return garage;
      }),
    } as unknown as ServiceReglageEnvoiCourriel;
    const fabrique = {
      creer: vi.fn(() => garageTransport.transport),
    } as unknown as FabriqueTransportSmtp;
    const service = new ServiceCourriel(
      instance.transport,
      config as Config,
      journalFactice(),
      reglages,
      fabrique,
    );
    return { service, instance, garageTransport, reglages, fabrique };
  }

  const PROD = { NODE_ENV: 'production', SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as const;

  it('production + réglage du garage : part par SON serveur, avec SON adresse, SON nom et SA réponse', async () => {
    const { service, garageTransport, instance, fabrique } = monter(PROD, {
      smtp: SMTP_GARAGE,
      nomAffiche: 'Atelier Martin',
      adresseReponse: 'direction@garage-martin.ch',
    });
    const r = await service.envoyer(MESSAGE);
    expect(r.succes).toBe(true);
    expect(fabrique.creer).toHaveBeenCalledWith(SMTP_GARAGE);
    expect(instance.enveloppes).toHaveLength(0);
    expect(garageTransport.enveloppes[0]).toMatchObject({
      de: 'atelier@garage-martin.ch',
      nomExpediteurAffiche: 'Atelier Martin',
      repondreA: 'direction@garage-martin.ch',
    });
  });

  it('réglage du garage sans nom ni réponse : repli sur le nom du garage et l’adresse transmise, sans « via dmsforall »', async () => {
    const { service, garageTransport } = monter(PROD, {
      smtp: SMTP_GARAGE,
      nomAffiche: null,
      adresseReponse: null,
    });
    await service.envoyer(MESSAGE);
    expect(garageTransport.enveloppes[0]).toMatchObject({
      nomExpediteurAffiche: 'Garage Martin',
      repondreA: 'contact@garage-martin.ch',
    });
  });

  it('production sans réglage mais envoi réel de l’instance activé : serveur de l’instance, expéditeur technique', async () => {
    const { service, instance, fabrique } = monter({ ...PROD, COURRIEL_ENVOI_REEL: true }, null);
    const r = await service.envoyer(MESSAGE);
    expect(r.succes).toBe(true);
    expect(fabrique.creer).not.toHaveBeenCalled();
    expect(instance.enveloppes[0]).toMatchObject({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
    });
  });

  it('production sans réglage ni envoi d’instance : échec EXPLICITE « non configuré », jamais un faux succès', async () => {
    const { service, instance } = monter(PROD, null);
    const r = await service.envoyer(MESSAGE);
    expect(r.succes).toBe(false);
    expect(r.erreur).toContain('COURRIEL_NON_CONFIGURE');
    expect(instance.enveloppes).toHaveLength(0);
  });

  it('hors production : tout reste capturé, le réglage du garage n’est même pas consulté', async () => {
    const { service, instance, reglages, fabrique } = monter(
      { NODE_ENV: 'development' },
      { smtp: SMTP_GARAGE, nomAffiche: null, adresseReponse: null },
    );
    const r = await service.envoyer(MESSAGE);
    expect(r.succes).toBe(true);
    expect(instance.enveloppes).toHaveLength(1);
    expect(reglages.resoudreEnvoiGarage).not.toHaveBeenCalled();
    expect(fabrique.creer).not.toHaveBeenCalled();
  });

  it('hôte du garage interdit (réseau privé) ou secret illisible : échec typé, rien ne part, pas de repli sur l’instance', async () => {
    const interdit = monter(
      { ...PROD, COURRIEL_ENVOI_REEL: true },
      new ErreurHoteSmtpInterdit('10.0.0.1'),
    );
    const r1 = await interdit.service.envoyer(MESSAGE);
    expect(r1).toMatchObject({ succes: false, cause: 'hote_interdit' });
    expect(interdit.instance.enveloppes).toHaveLength(0);

    const illisible = monter(PROD, new ErreurDechiffrementSecret());
    expect(await illisible.service.envoyer(MESSAGE)).toMatchObject({
      succes: false,
      cause: 'authentification',
    });
  });

  it('sans adresse de réponse fournie (mot de passe oublié), le Reply-To est l’expéditeur', async () => {
    const { service, instance } = monter({ ...PROD, COURRIEL_ENVOI_REEL: true }, null);
    await service.envoyer({ ...MESSAGE, adresseReponseGarage: undefined });
    expect(instance.enveloppes[0]?.repondreA).toBe('no-reply@dmsforall.example');
  });
});
