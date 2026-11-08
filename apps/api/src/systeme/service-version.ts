import { Inject, Injectable } from '@nestjs/common';
import type { VersionSysteme } from '@dfa/shared';

import { JETON_CONFIG, type Config } from '../config';
import { comparerVersions, normaliserVersion } from './comparer-versions';

export const JETON_FETCH_VERSION = Symbol('JETON_FETCH_VERSION');
export type FetchVersion = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export const URL_DERNIERE_VERSION = 'https://api.github.com/repos/selfhostr/dmsforall/releases/latest';
export const DUREE_CACHE_MS = 12 * 60 * 60 * 1000;
/** Après un échec on réessaie plus tôt, mais jamais à chaque requête. */
export const DUREE_CACHE_ECHEC_MS = 60 * 60 * 1000;
const DELAI_MS = 3000;

interface Derniere {
  readonly version: string;
  readonly url: string;
}

@Injectable()
export class ServiceVersion {
  private cache: { readonly valeur: Derniere | null; readonly expireA: number } | null = null;
  private enCours: Promise<Derniere | null> | null = null;

  constructor(
    @Inject(JETON_CONFIG) private readonly config: Config,
    @Inject(JETON_FETCH_VERSION) private readonly fetcher: FetchVersion,
  ) {}

  async obtenir(): Promise<VersionSysteme> {
    const actuelle = normaliserVersion(this.config.VERSION_APP) ?? this.config.VERSION_APP;
    const derniere = this.config.VERIFIER_MISE_A_JOUR ? await this.derniere() : null;
    const ecart = derniere === null ? null : comparerVersions(derniere.version, actuelle);
    return {
      actuelle,
      derniere: derniere?.version ?? null,
      miseAJourDisponible: ecart !== null && ecart > 0,
      urlNotes: derniere?.url ?? null,
    };
  }

  private async derniere(): Promise<Derniere | null> {
    if (this.cache !== null && this.cache.expireA > Date.now()) return this.cache.valeur;
    this.enCours ??= this.interroger().finally(() => {
      this.enCours = null;
    });
    return this.enCours;
  }

  private async interroger(): Promise<Derniere | null> {
    let valeur: Derniere | null = null;
    try {
      const reponse = await this.fetcher(URL_DERNIERE_VERSION, {
        signal: AbortSignal.timeout(DELAI_MS),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dmsforall' },
      });
      if (reponse.ok) valeur = lireRelease(await reponse.json());
    } catch {
      valeur = null;
    }
    this.cache = {
      valeur,
      expireA: Date.now() + (valeur === null ? DUREE_CACHE_ECHEC_MS : DUREE_CACHE_MS),
    };
    return valeur;
  }
}

function lireRelease(corps: unknown): Derniere | null {
  if (typeof corps !== 'object' || corps === null) return null;
  const { tag_name: tag, html_url: url } = corps as Record<string, unknown>;
  if (typeof tag !== 'string' || typeof url !== 'string') return null;
  const version = normaliserVersion(tag);
  // Seule une page GitHub est proposée en lien : jamais une URL arbitraire venue du réseau.
  if (version === null || !url.startsWith('https://github.com/selfhostr/dmsforall/')) return null;
  return { version, url };
}
