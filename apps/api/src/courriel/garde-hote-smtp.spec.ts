import { describe, expect, it } from 'vitest';

import { adresseEstReseauPrive, ErreurHoteSmtpInterdit, resoudreHoteSmtp } from './garde-hote-smtp';

describe('adresseEstReseauPrive', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
  ])('%s est privée ou locale', (ip) => {
    expect(adresseEstReseauPrive(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '172.15.0.1', '172.32.0.1', '195.15.0.1', '2a00:1450:4001::1'])(
    '%s est publique',
    (ip) => {
      expect(adresseEstReseauPrive(ip)).toBe(false);
    },
  );

  it('une chaîne qui n’est pas une adresse est refusée par prudence', () => {
    expect(adresseEstReseauPrive('pas-une-ip')).toBe(true);
  });
});

describe('resoudreHoteSmtp', () => {
  it('rend l’adresse résolue et garde le nom pour le certificat', async () => {
    const r = await resoudreHoteSmtp('mail.exemple.ch', false, async () => ['195.15.0.1']);
    expect(r).toEqual({ adresse: '195.15.0.1', nom: 'mail.exemple.ch' });
  });

  it('refuse un nom qui pointe vers un réseau privé, même si une seule adresse l’est (DNS piégé)', async () => {
    await expect(
      resoudreHoteSmtp('piege.exemple.ch', false, async () => ['195.15.0.1', '10.0.0.8']),
    ).rejects.toBeInstanceOf(ErreurHoteSmtpInterdit);
  });

  it('refuse une adresse IP privée saisie directement', async () => {
    await expect(resoudreHoteSmtp('192.168.1.5', false, async () => [])).rejects.toBeInstanceOf(
      ErreurHoteSmtpInterdit,
    );
  });

  it('autorise le réseau privé quand l’instance le permet explicitement', async () => {
    const r = await resoudreHoteSmtp('192.168.1.5', true, async () => []);
    expect(r.adresse).toBe('192.168.1.5');
  });

  it('un nom sans aucune adresse est refusé', async () => {
    await expect(resoudreHoteSmtp('vide.exemple.ch', true, async () => [])).rejects.toBeInstanceOf(
      ErreurHoteSmtpInterdit,
    );
  });
});
