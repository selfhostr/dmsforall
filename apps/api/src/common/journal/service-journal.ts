import { Inject, Injectable } from '@nestjs/common';
import pino from 'pino';
import { JETON_CONFIG, type Config } from '../../config';

/** Secrets techniques — jamais dans un log, quel que soit le niveau. */
const CHAMPS_SECRETS_TECHNIQUES = ['motDePasse', 'cookie', 'authorization', 'tokenClair'] as const;

/**
 * Données personnelles métier (clients, contacts, véhicules, tiers créanciers). Le journal est un
 * canal PARALLÈLE à la base : `tenant_id`/RLS/scoping applicatif ne s'y appliquent pas. Quiconque
 * accède aux logs (exploitant, collecteur centralisé, hébergeur) verrait sinon des données de
 * tous les tenants mélangées, sans jamais passer par l'étanchéité du produit — manquement nLPD.
 *
 * Limite connue et volontairement non couverte ici : cette liste redacte par NOM DE CHAMP. Elle
 * ne rattrape pas une donnée personnelle enfouie dans une chaîne libre (ex. un `sujet` de
 * courriel qui citerait un nom de client). C'est aux appelants de ne jamais construire une telle
 * chaîne à hauteur `info`/`warn` — voir `courriel/service-courriel.ts` et
 * `courriel/transport-capture.ts`, qui réservent ce détail au niveau `debug`.
 */
const CHAMPS_DONNEES_PERSONNELLES = [
  'email',
  'courriel',
  'destinataire',
  'destinataires',
  'telephone',
  'telephoneE164',
  'nom',
  'prenom',
  'nomAffiche',
  'rue',
  'npa',
  'localite',
  'adresse',
  'plaque',
  'vin',
  'iban',
  'qrIban',
  'ibanCreancier',
  'repondreA',
  'adresseReponseGarage',
] as const;

/**
 * Champs jamais journalisés en clair, quelle que soit leur profondeur dans l'objet loggé.
 * `pino` ne supporte pas nativement un "redact partout" insensible à la profondeur : on
 * énumère donc les emplacements usuels (racine, un et deux niveaux d'imbrication, en-têtes
 * HTTP) plutôt que de risquer d'oublier un cas et de faire fuiter un secret dans les logs.
 */
const CHAMPS_SENSIBLES = [...CHAMPS_SECRETS_TECHNIQUES, ...CHAMPS_DONNEES_PERSONNELLES] as const;

function construireCheminsRedaction(): string[] {
  const chemins: string[] = [];
  for (const champ of CHAMPS_SENSIBLES) {
    chemins.push(
      champ,
      `*.${champ}`,
      `*.*.${champ}`,
      `headers.${champ}`,
      `requete.headers.${champ}`,
    );
  }
  return chemins;
}

/**
 * Une `DrizzleQueryError` embarque dans son `message` la requête ET ses paramètres
 * (`Failed query: <SQL>\nparams: <valeurs>`) : les valeurs sont des données client (noms, IBAN,
 * téléphones). On ne journalise que le SQL, les valeurs deviennent `[masqué]`.
 */
function masquerParametresRequete(message: string): string {
  const indexParams = message.search(/\r?\nparams:/);
  if (indexParams === -1) return message;
  return `${message.slice(0, indexParams)}\nparams: [masqué]`;
}

function estErreurRequeteBase(erreur: Error): boolean {
  return (
    erreur.message.startsWith('Failed query') || erreur.constructor.name === 'DrizzleQueryError'
  );
}

export function serialiserErreur(erreur: unknown): Record<string, unknown> {
  if (erreur instanceof Error) {
    if (!estErreurRequeteBase(erreur)) {
      return { nom: erreur.name, message: erreur.message, pile: erreur.stack };
    }
    const messageMasque = masquerParametresRequete(erreur.message);
    // La pile reprend le message (en-tête V8) : le même masquage doit y être appliqué.
    const pileMasquee = erreur.stack?.split(erreur.message).join(messageMasque);
    return { nom: erreur.name, message: messageMasque, pile: pileMasquee };
  }
  return { valeur: erreur };
}

/**
 * Construit l'instance `pino` réellement utilisée par `ServiceJournal` — exportée séparément
 * pour que le test de non-régression (`service-journal.spec.ts`) puisse prouver la rédaction sur
 * la VRAIE configuration de production, flux personnalisé en paramètre pour capturer la sortie
 * JSON réelle (au lieu de relire la liste `CHAMPS_SENSIBLES` sans jamais exécuter `pino`, ce qui
 * ne prouverait rien sur le comportement réel — voir CONTRIBUTING.md, pièges vérifiés).
 */
export function construireLoggerPino(config: Config, flux?: pino.DestinationStream): pino.Logger {
  const options: pino.LoggerOptions = {
    level: config.LOG_NIVEAU,
    redact: { paths: construireCheminsRedaction(), censor: '[EXPURGE]' },
    base: { app: 'dfa-api', version: config.VERSION_APP },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return flux ? pino(options, flux) : pino(options);
}

/**
 * Logs JSON structurés (pino). C'est le SEUL endroit où une erreur inattendue et sa stack
 * complète doivent apparaître — jamais dans un corps de réponse HTTP (voir FiltreProbleme).
 */
@Injectable()
export class ServiceJournal {
  private readonly pino: pino.Logger;

  constructor(@Inject(JETON_CONFIG) config: Config) {
    this.pino = construireLoggerPino(config);
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
