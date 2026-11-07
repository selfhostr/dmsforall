import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { construireLoggerPino, serialiserErreur } from './service-journal';
import type { Config } from '../../config';

/**
 * Garde-fou anti-récidive : un test unitaire qui casse dès qu'un champ portant une donnée
 * personnelle atteint réellement le JSON produit par `pino`, plutôt qu'une simple relecture de la
 * liste de rédaction. On appelle `construireLoggerPino` — la fonction EXACTE qui construit
 * l'instance `pino` de `ServiceJournal` en production, pas une réimplémentation — avec un flux de
 * sortie personnalisé, pour capturer le JSON réellement émis.
 *
 * Pourquoi un flux personnalisé plutôt qu'intercepter `process.stdout.write` : sans option
 * `transport`, `pino` écrit via `sonic-boom`, qui capture sa propre référence à `fs.writeSync`/
 * `fs.write` au chargement du module — un monkey-patch de `process.stdout.write` posé après coup
 * ne voit donc jamais rien passer (vérifié). `construireLoggerPino(config, flux)` fait passer
 * `pino` par le flux fourni, sans toucher au comportement de production (le flux est optionnel,
 * `ServiceJournal` ne le fournit jamais).
 */
function config(niveau: Config['LOG_NIVEAU'] = 'info'): Config {
  return { LOG_NIVEAU: niveau, VERSION_APP: '0.0.0-test' } as Config;
}

function capturerLignesJson(fn: (logger: ReturnType<typeof construireLoggerPino>) => void): {
  lignes: Array<Record<string, unknown>>;
} {
  const brut: string[] = [];
  const flux = new Writable({
    write(chunk: Buffer, _enc, cb) {
      brut.push(chunk.toString());
      cb();
    },
  });
  const logger = construireLoggerPino(config('info'), flux);
  fn(logger);
  const lignes = brut
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0)
    .map((ligne) => JSON.parse(ligne) as Record<string, unknown>);
  return { lignes };
}

describe('construireLoggerPino — rédaction des données personnelles (config réelle de ServiceJournal)', () => {
  it.each([
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
  ])('expurge réellement le champ personnel « %s » au niveau info', (champ) => {
    const valeurSensible = 'VALEUR-NE-DOIT-JAMAIS-SORTIR';

    const { lignes } = capturerLignesJson((logger) => {
      logger.info({ [champ]: valeurSensible }, 'événement de test');
    });

    expect(lignes[0]?.[champ]).toBe('[EXPURGE]');
    expect(JSON.stringify(lignes[0])).not.toContain(valeurSensible);
  });

  it.each(['motDePasse', 'cookie', 'authorization', 'tokenClair'])(
    'continue à expurger le secret technique « %s »',
    (champ) => {
      const valeurSensible = 'SECRET-NE-DOIT-JAMAIS-SORTIR';

      const { lignes } = capturerLignesJson((logger) => {
        logger.warn({ [champ]: valeurSensible }, 'événement de test');
      });

      expect(lignes[0]?.[champ]).toBe('[EXPURGE]');
      expect(JSON.stringify(lignes[0])).not.toContain(valeurSensible);
    },
  );

  it('ne redacte PAS un identifiant technique (tenantId) — le journal doit rester exploitable', () => {
    const { lignes } = capturerLignesJson((logger) => {
      logger.info({ tenantId: 'un-identifiant-de-tenant' }, 'événement de test');
    });

    expect(lignes[0]?.tenantId).toBe('un-identifiant-de-tenant');
  });

  it('rédaction par nom de champ seulement — une donnée personnelle enfouie dans une chaîne libre passe telle quelle (limite documentée, à ne jamais construire à hauteur info/warn)', () => {
    const { lignes } = capturerLignesJson((logger) => {
      logger.info({ sujet: 'Rappel pour jean.dupont@example.ch' }, 'événement de test');
    });

    expect(lignes[0]?.sujet).toBe('Rappel pour jean.dupont@example.ch');
  });

  it('une DrizzleQueryError journalisée ne contient ni la valeur d un IBAN ni le téléphone, ni dans le message ni dans la pile', () => {
    const iban = 'CH9300762011623852957';
    const telephone = '+41791234567';
    const erreur = new DrizzleQueryError(
      'insert into "clients" ("iban", "telephone") values ($1, $2)',
      [iban, telephone],
    );

    const { lignes } = capturerLignesJson((logger) => {
      logger.error({ erreur: serialiserErreur(erreur) }, 'Erreur de base de test');
    });

    const sortie = JSON.stringify(lignes[0]);
    expect(sortie).not.toContain(iban);
    expect(sortie).not.toContain(telephone);
    expect(lignes[0]?.erreur).toMatchObject({
      message:
        'Failed query: insert into "clients" ("iban", "telephone") values ($1, $2)\nparams: [masqué]',
    });
  });

  it('une erreur ordinaire garde son message tel quel (pas de masquage hors requête de base)', () => {
    expect(serialiserErreur(new Error('boom'))).toMatchObject({ nom: 'Error', message: 'boom' });
  });
});
