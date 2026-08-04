import { beforeEach, describe, expect, it } from 'vitest';
import type Redis from 'ioredis';

import {
  FENETRE_ECHECS_SECONDES,
  PALIERS_VERROUILLAGE_PIN_SECONDES,
  SEUIL_ECHECS_AVANT_VERROUILLAGE,
  ServiceVerrouillagePin,
} from './service-verrouillage-pin';

/**
 * Anti-balayage du PIN (RM-129) — prouvé de bout en bout sur un Redis SIMULÉ à TTL contrôlable :
 * l'escalade des paliers, l'expiration du verrou, la persistance du compteur au travers du verrou,
 * la réinitialisation sur succès, et l'ISOLEMENT du verrou par (tenant, borne). Aucun vrai Redis,
 * aucune horloge murale : le temps est une variable qu'on avance à la main.
 */

/**
 * Faux Redis minimal : uniquement les commandes que `ServiceVerrouillagePin` utilise, avec une
 * sémantique de TTL fidèle (expiration paresseuse à l'accès, comme un vrai serveur Redis). `now`
 * est piloté par le test — aucun `setTimeout`, aucune dépendance à l'heure réelle.
 */
class FauxRedis {
  now = 1_000_000;
  private readonly store = new Map<string, { valeur: number | string; expireA: number | null }>();

  private lireVivant(cle: string): { valeur: number | string; expireA: number | null } | undefined {
    const e = this.store.get(cle);
    if (!e) return undefined;
    if (e.expireA !== null && this.now >= e.expireA) {
      this.store.delete(cle);
      return undefined;
    }
    return e;
  }

  pttl(cle: string): Promise<number> {
    const e = this.lireVivant(cle);
    if (!e) return Promise.resolve(-2);
    if (e.expireA === null) return Promise.resolve(-1);
    return Promise.resolve(e.expireA - this.now);
  }

  incr(cle: string): Promise<number> {
    const e = this.lireVivant(cle);
    const nouveau = (e ? Number(e.valeur) : 0) + 1;
    this.store.set(cle, { valeur: nouveau, expireA: e ? e.expireA : null });
    return Promise.resolve(nouveau);
  }

  pexpire(cle: string, ms: number): Promise<number> {
    const e = this.lireVivant(cle);
    if (!e) return Promise.resolve(0);
    e.expireA = this.now + ms;
    return Promise.resolve(1);
  }

  set(cle: string, valeur: string, _mode: 'PX', ms: number): Promise<'OK'> {
    this.store.set(cle, { valeur, expireA: this.now + ms });
    return Promise.resolve('OK');
  }

  del(...cles: string[]): Promise<number> {
    let n = 0;
    for (const c of cles) if (this.store.delete(c)) n += 1;
    return Promise.resolve(n);
  }
}

const TENANT = 'tenant-A';
const BORNE = 'borne-1';

function creer(): { service: ServiceVerrouillagePin; redis: FauxRedis } {
  const redis = new FauxRedis();
  const service = new ServiceVerrouillagePin(redis as unknown as Redis);
  return { service, redis };
}

/** Enchaîne `n` échecs et rend l'état du dernier. */
async function echouer(service: ServiceVerrouillagePin, n: number) {
  let dernier = { verrouille: false, resteSecondes: 0 };
  for (let i = 0; i < n; i += 1) dernier = await service.enregistrerEchec(TENANT, BORNE);
  return dernier;
}

describe('ServiceVerrouillagePin — escalade des paliers (RM-129)', () => {
  let service: ServiceVerrouillagePin;

  beforeEach(() => {
    service = creer().service;
  });

  it("n'est PAS verrouillé sous le seuil", async () => {
    const etat = await echouer(service, SEUIL_ECHECS_AVANT_VERROUILLAGE - 1);
    expect(etat.verrouille).toBe(false);
    expect((await service.etatVerrou(TENANT, BORNE)).verrouille).toBe(false);
  });

  it('verrouille au SEUIL-ième échec, sur le premier palier (30 s)', async () => {
    const etat = await echouer(service, SEUIL_ECHECS_AVANT_VERROUILLAGE);
    expect(etat.verrouille).toBe(true);
    expect(etat.resteSecondes).toBe(PALIERS_VERROUILLAGE_PIN_SECONDES[0]);
    expect(etat.resteSecondes).toBe(30);
  });

  it('escalade palier par palier (30 → 120 → 600 → 1800), puis reste au dernier', async () => {
    // Chaque échec au-delà du seuil monte d'un cran. On lit `resteSecondes` retourné par l'échec.
    const attendus = [30, 120, 600, 1800, 1800, 1800];
    const obtenus: number[] = [];
    for (let i = 0; i < attendus.length; i += 1) {
      const etat = await service.enregistrerEchec(TENANT, BORNE);
      if (i >= SEUIL_ECHECS_AVANT_VERROUILLAGE - 1) obtenus.push(etat.resteSecondes);
    }
    // i part de 0 ; le premier verrou tombe à i = SEUIL-1 (5ᵉ échec).
    expect(obtenus).toEqual(attendus.slice(0, obtenus.length));
    expect(obtenus).toEqual([30, 120, 600, 1800, 1800, 1800].slice(0, obtenus.length));
  });

  it('le verrou EXPIRE après sa durée, et le compteur SURVIT pour poursuivre l’escalade', async () => {
    const { service: s, redis } = creer();
    const premier = await echouer(s, SEUIL_ECHECS_AVANT_VERROUILLAGE); // verrou 30 s, compteur = 5
    expect(premier.resteSecondes).toBe(30);

    // Avance juste au-delà du palier de 30 s : le verrou tombe, le compteur (fenêtre 1 h) reste.
    redis.now += 31 * 1000;
    expect((await s.etatVerrou(TENANT, BORNE)).verrouille).toBe(false);

    // L'échec suivant est donc le 6ᵉ → palier 120 s, pas un retour à 30 s.
    const suivant = await s.enregistrerEchec(TENANT, BORNE);
    expect(suivant.verrouille).toBe(true);
    expect(suivant.resteSecondes).toBe(120);
  });

  it('reinitialiser (succès) efface compteur ET verrou : on repart de zéro', async () => {
    await echouer(service, SEUIL_ECHECS_AVANT_VERROUILLAGE + 2); // bien au-delà, verrou actif
    expect((await service.etatVerrou(TENANT, BORNE)).verrouille).toBe(true);

    await service.reinitialiser(TENANT, BORNE);
    expect((await service.etatVerrou(TENANT, BORNE)).verrouille).toBe(false);

    // Le prochain cycle recommence au premier palier, preuve que le compteur est bien reparti à 0.
    const etat = await echouer(service, SEUIL_ECHECS_AVANT_VERROUILLAGE);
    expect(etat.resteSecondes).toBe(30);
  });

  it('le compteur d’échecs expire après sa fenêtre : une borne laissée tranquille repart à zéro', async () => {
    const { service: s, redis } = creer();
    await echouer(s, SEUIL_ECHECS_AVANT_VERROUILLAGE - 1); // 4 échecs, pas encore verrouillé
    redis.now += (FENETRE_ECHECS_SECONDES + 1) * 1000; // au-delà de la fenêtre
    const etat = await s.enregistrerEchec(TENANT, BORNE); // repart à 1 → pas de verrou
    expect(etat.verrouille).toBe(false);
  });

  it('le verrou est ISOLÉ par (tenant, borne) : verrouiller l’un ne verrouille pas l’autre', async () => {
    await echouer(service, SEUIL_ECHECS_AVANT_VERROUILLAGE);
    expect((await service.etatVerrou(TENANT, BORNE)).verrouille).toBe(true);
    // Autre borne du même tenant : intacte.
    expect((await service.etatVerrou(TENANT, 'borne-2')).verrouille).toBe(false);
    // Autre tenant, même identifiant de borne : intact.
    expect((await service.etatVerrou('tenant-B', BORNE)).verrouille).toBe(false);
  });
});
