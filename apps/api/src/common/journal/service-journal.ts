import { Inject, Injectable } from '@nestjs/common';
import pino from 'pino';
import { JETON_CONFIG, type Config } from '../../config';

/**
 * Champs jamais journalisés en clair, quelle que soit leur profondeur dans l'objet loggé.
 * `pino` ne supporte pas nativement un "redact partout" insensible à la profondeur : on
 * énumère donc les emplacements usuels (racine, un et deux niveaux d'imbrication, en-têtes
 * HTTP) plutôt que de risquer d'oublier un cas et de faire fuiter un secret dans les logs.
 */
const CHAMPS_SENSIBLES = ['motDePasse', 'cookie', 'authorization', 'tokenClair'] as const;

function construireCheminsRedaction(): string[] {
  const chemins: string[] = [];
  for (const champ of CHAMPS_SENSIBLES) {
    chemins.push(champ, `*.${champ}`, `*.*.${champ}`, `headers.${champ}`, `requete.headers.${champ}`);
  }
  return chemins;
}

function serialiserErreur(erreur: unknown): Record<string, unknown> {
  if (erreur instanceof Error) {
    return { nom: erreur.name, message: erreur.message, pile: erreur.stack };
  }
  return { valeur: erreur };
}

/**
 * Logs JSON structurés (pino). C'est le SEUL endroit où une erreur inattendue et sa stack
 * complète doivent apparaître — jamais dans un corps de réponse HTTP (voir FiltreProbleme).
 */
@Injectable()
export class ServiceJournal {
  private readonly pino: pino.Logger;

  constructor(@Inject(JETON_CONFIG) config: Config) {
    this.pino = pino({
      level: config.LOG_NIVEAU,
      redact: { paths: construireCheminsRedaction(), censor: '[EXPURGE]' },
      base: { app: 'dfa-api', version: config.VERSION_APP },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  debug(message: string, donnees?: Record<string, unknown>): void {
    this.pino.debug(donnees ?? {}, message);
  }

  info(message: string, donnees?: Record<string, unknown>): void {
    this.pino.info(donnees ?? {}, message);
  }

  warn(message: string, donnees?: Record<string, unknown>): void {
    this.pino.warn(donnees ?? {}, message);
  }

  error(message: string, erreur?: unknown, donnees?: Record<string, unknown>): void {
    this.pino.error({ ...(donnees ?? {}), erreur: serialiserErreur(erreur) }, message);
  }
}
