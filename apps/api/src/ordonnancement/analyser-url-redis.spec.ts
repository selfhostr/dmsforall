import { describe, expect, it } from 'vitest';

import { analyserUrlRedisPourBullMq } from './analyser-url-redis';

describe('analyserUrlRedisPourBullMq', () => {
  it('URL simple sans authentification (dev/CI, docker-compose.dev.yml)', () => {
    expect(analyserUrlRedisPourBullMq('redis://redis:6379')).toEqual({
      host: 'redis',
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });

  it('URL avec mot de passe seul (production, docker-compose.yml)', () => {
    const options = analyserUrlRedisPourBullMq('redis://:s3cret@redis:6379');
    expect(options.host).toBe('redis');
    expect(options.port).toBe(6379);
    expect(options.password).toBe('s3cret');
    expect(options.username).toBeUndefined();
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  it("mot de passe URL-encodé, décodé (piège vérifié ailleurs dans ce dépôt : caractères spéciaux d'un mot de passe généré)", () => {
    const options = analyserUrlRedisPourBullMq('redis://:s%40cret%2F@redis:6379');
    expect(options.password).toBe('s@cret/');
  });

  it('nom d’utilisateur explicite (ACL Redis) conservé', () => {
    const options = analyserUrlRedisPourBullMq('redis://appuser:secret@redis:6379');
    expect(options.username).toBe('appuser');
    expect(options.password).toBe('secret');
  });

  it("nom d'utilisateur `default` implicite (redis://:motdepasse@…) jamais posé explicitement", () => {
    const options = analyserUrlRedisPourBullMq('redis://default:secret@redis:6379');
    // `default` est l'utilisateur ACL implicite — ioredis le gère tout seul via `password` seul,
    // le poser explicitement serait redondant, pas faux, mais volontairement évité (voir l'en-tête
    // de fichier).
    expect(options.username).toBeUndefined();
  });

  it('port par défaut (6379) si absent de l’URL', () => {
    expect(analyserUrlRedisPourBullMq('redis://redis').port).toBe(6379);
  });

  it('base logique explicite (chemin `/N`)', () => {
    expect(analyserUrlRedisPourBullMq('redis://redis:6379/3').db).toBe(3);
  });

  it('base logique absente -> aucune clé db posée', () => {
    expect(analyserUrlRedisPourBullMq('redis://redis:6379').db).toBeUndefined();
  });

  it('rediss:// (TLS) pose une option tls', () => {
    expect(analyserUrlRedisPourBullMq('rediss://redis:6380').tls).toEqual({});
  });

  it('redis:// (sans TLS) ne pose aucune option tls', () => {
    expect(analyserUrlRedisPourBullMq('redis://redis:6379').tls).toBeUndefined();
  });
});
