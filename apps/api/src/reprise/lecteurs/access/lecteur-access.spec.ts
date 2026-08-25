import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lireLignesAccess,
  listerColonnesAccess,
  listerTablesAccess,
  verifierMdbToolsDisponible,
} from './lecteur-access';
import {
  ErreurDelaiDepasseProcessus,
  ErreurLectureAccess,
  ErreurOutilAccesIndisponible,
} from '../erreurs';
import type { FabriqueProcessus, ProcessusExecute } from './executeur-processus';

/** Sous-processus factice piloté par test — ne lance jamais un vrai `mdbtools`. */
function creerProcessusFactice(options: {
  stdout?: string;
  stderr?: string;
  codeSortie?: number | null;
  echoueAuLancement?: Error;
}): ProcessusExecute {
  const emetteur = new EventEmitter();
  const stdout = Readable.from(
    options.stdout !== undefined ? [Buffer.from(options.stdout, 'utf-8')] : [],
  );
  const stderr = Readable.from(
    options.stderr !== undefined ? [Buffer.from(options.stderr, 'utf-8')] : [],
  );

  const processus: ProcessusExecute = {
    stdout,
    stderr,
    on: emetteur.on.bind(emetteur),
    kill: vi.fn(),
  };

  queueMicrotask(() => {
    if (options.echoueAuLancement) {
      emetteur.emit('error', options.echoueAuLancement);
      return;
    }
    stdout.on('end', () => emetteur.emit('close', options.codeSortie ?? 0));
  });

  return processus;
}

function fabriqueVers(processus: ProcessusExecute): FabriqueProcessus {
  return () => processus;
}

describe('verifierMdbToolsDisponible', () => {
  it('rend disponible=true et la version quand mdb-tables --version réussit', async () => {
    const fabriqueProcessus = fabriqueVers(
      creerProcessusFactice({ stdout: 'mdbtools v1.0.1\n', codeSortie: 0 }),
    );
    const resultat = await verifierMdbToolsDisponible({ fabriqueProcessus });
    expect(resultat).toEqual({ disponible: true, version: 'mdbtools v1.0.1' });
  });

  it('rend disponible=false sans planter quand le binaire est absent (ENOENT)', async () => {
    const erreur = Object.assign(new Error('spawn mdb-tables ENOENT'), { code: 'ENOENT' });
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ echoueAuLancement: erreur }));
    const resultat = await verifierMdbToolsDisponible({ fabriqueProcessus });
    expect(resultat.disponible).toBe(false);
    expect(resultat.motif).toContain('ENOENT');
  });
});

describe('listerTablesAccess', () => {
  it('découpe la sortie une-table-par-ligne de mdb-tables -1', async () => {
    const fabriqueProcessus = fabriqueVers(
      creerProcessusFactice({ stdout: 'Table1\nTable2\nTable3\n', codeSortie: 0 }),
    );
    const tables = await listerTablesAccess('/chemin/base.mdb', { fabriqueProcessus });
    expect(tables).toEqual(['Table1', 'Table2', 'Table3']);
  });

  it('lève ErreurOutilAccesIndisponible quand mdb-tables est absent', async () => {
    const erreur = Object.assign(new Error('spawn mdb-tables ENOENT'), { code: 'ENOENT' });
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ echoueAuLancement: erreur }));
    await expect(listerTablesAccess('/chemin/base.mdb', { fabriqueProcessus })).rejects.toThrow(
      ErreurOutilAccesIndisponible,
    );
  });
});

describe('listerColonnesAccess', () => {
  it("extrait les noms de colonnes d'un bloc CREATE TABLE émis par mdb-schema", async () => {
    const ddl = [
      '-- MDB Tools - A library for reading MS Access database files',
      '',
      'CREATE TABLE [MaTable]',
      ' (',
      '\t[Colonne1]\t\tText (50), ',
      '\t[Colonne2]\t\tLong Integer, ',
      '\t[Colonne3]\t\tDateTime',
      ');',
    ].join('\n');
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ stdout: ddl, codeSortie: 0 }));
    const colonnes = await listerColonnesAccess('/chemin/base.mdb', 'MaTable', {
      fabriqueProcessus,
    });
    expect(colonnes).toEqual(['Colonne1', 'Colonne2', 'Colonne3']);
  });

  it('fonctionne même pour une table à 0 ligne (schéma seul, pas de dépendance aux données)', async () => {
    const ddl = 'CREATE TABLE [TableVide]\n (\n\t[Id]\t\tLong Integer\n);';
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ stdout: ddl, codeSortie: 0 }));
    const colonnes = await listerColonnesAccess('/chemin/base.mdb', 'TableVide', {
      fabriqueProcessus,
    });
    expect(colonnes).toEqual(['Id']);
  });
});

describe('lireLignesAccess', () => {
  it('parse le CSV produit par mdb-export (en-tête -> colonnes)', async () => {
    const csv = 'Nom,Ville\n"Dupont","Lausanne"\n"Meier","Zürich"\n';
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ stdout: csv, codeSortie: 0 }));

    const lignes = [];
    for await (const ligne of lireLignesAccess('/chemin/base.mdb', 'Clients', {
      fabriqueProcessus,
    })) {
      lignes.push(ligne);
    }
    expect(lignes.map((l) => l.valeurs)).toEqual([
      { Nom: 'Dupont', Ville: 'Lausanne' },
      { Nom: 'Meier', Ville: 'Zürich' },
    ]);
  });

  it('gère les valeurs CSV avec guillemets et retours à la ligne échappés (doublement des guillemets)', async () => {
    const csv = 'Nom,Remarque\n"Dupont","Ligne 1\nLigne ""2"" avec guillemets"\n';
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ stdout: csv, codeSortie: 0 }));

    const lignes = [];
    for await (const ligne of lireLignesAccess('/chemin/base.mdb', 'Clients', {
      fabriqueProcessus,
    })) {
      lignes.push(ligne);
    }
    expect(lignes[0]!.valeurs.Remarque).toBe('Ligne 1\nLigne "2" avec guillemets');
  });

  it('convertit les champs CSV vides en null (mdb-export ne distingue pas NULL de chaîne vide)', async () => {
    const csv = 'Nom,Email\n"Dupont",""\n';
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ stdout: csv, codeSortie: 0 }));

    const lignes = [];
    for await (const ligne of lireLignesAccess('/chemin/base.mdb', 'Clients', {
      fabriqueProcessus,
    })) {
      lignes.push(ligne);
    }
    expect(lignes[0]!.valeurs.Email).toBeNull();
  });

  it('respecte `limite` et interrompt le flux tôt', async () => {
    const lignesSource = Array.from({ length: 100 }, (_, i) => `"Nom${i}"`).join('\n');
    const csv = `Nom\n${lignesSource}\n`;
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ stdout: csv, codeSortie: 0 }));

    const lignes = [];
    for await (const ligne of lireLignesAccess('/chemin/base.mdb', 'Clients', {
      fabriqueProcessus,
      limite: 3,
    })) {
      lignes.push(ligne);
    }
    expect(lignes).toHaveLength(3);
  });

  it('lève ErreurOutilAccesIndisponible quand mdb-export est absent (ENOENT)', async () => {
    const erreur = Object.assign(new Error('spawn mdb-export ENOENT'), { code: 'ENOENT' });
    const fabriqueProcessus = fabriqueVers(creerProcessusFactice({ echoueAuLancement: erreur }));

    await expect(async () => {
      for await (const _ of lireLignesAccess('/chemin/base.mdb', 'Clients', {
        fabriqueProcessus,
      })) {
        // ne devrait jamais y arriver
      }
    }).rejects.toThrow(ErreurOutilAccesIndisponible);
  });

  it('lève ErreurLectureAccess quand mdb-export sort en échec (code non nul)', async () => {
    const fabriqueProcessus = fabriqueVers(
      creerProcessusFactice({ stdout: '', stderr: 'table introuvable', codeSortie: 1 }),
    );

    await expect(async () => {
      for await (const _ of lireLignesAccess('/chemin/base.mdb', 'TableAbsente', {
        fabriqueProcessus,
      })) {
        // ne devrait jamais y arriver
      }
    }).rejects.toThrow(ErreurLectureAccess);
  });

  it('passe le nom de table en position finale précédée de « -- » (finding sécurité : un nom commençant par « - » ne doit jamais être repris comme option)', async () => {
    let argsCaptures: string[] = [];
    const fabriqueProcessus: FabriqueProcessus = (_commande, args) => {
      argsCaptures = args;
      return creerProcessusFactice({ stdout: 'Nom\n', codeSortie: 0 });
    };

    for await (const _ of lireLignesAccess('/chemin/base.mdb', '-TableSuspecte', {
      fabriqueProcessus,
    })) {
      // consomme le flux pour laisser le temps à l'appel d'être capturé
    }

    const indexSeparateur = argsCaptures.indexOf('--');
    expect(indexSeparateur).toBeGreaterThan(-1);
    expect(argsCaptures[indexSeparateur + 1]).toBe('-TableSuspecte');
    expect(argsCaptures.at(-1)).toBe('-TableSuspecte');
  });
});

describe('listerColonnesAccess — nom de table (finding sécurité)', () => {
  it('passe le nom de table sous la forme --table=<valeur> (un seul token, jamais deux)', async () => {
    let argsCaptures: string[] = [];
    const fabriqueProcessus: FabriqueProcessus = (_commande, args) => {
      argsCaptures = args;
      return creerProcessusFactice({
        stdout: 'CREATE TABLE [T]\n (\n\t[Id]\t\tLong Integer\n);',
        codeSortie: 0,
      });
    };

    await listerColonnesAccess('/chemin/base.mdb', '-TableSuspecte', { fabriqueProcessus });

    expect(argsCaptures).toContain('--table=-TableSuspecte');
    expect(argsCaptures).not.toContain('-TableSuspecte');
  });
});

describe('lireLignesAccess — délai dur (finding sécurité MOYENNE)', () => {
  beforeEach(() => {
    // Seuls `setTimeout`/`clearTimeout` sont simulés — laisser `process.nextTick`/`setImmediate`
    // réels, dont dépendent les flux Node (`Readable`, `csv-parse`) de `lireLignesAccess`.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sous-processus factice qui ne produit JAMAIS le moindre octet et ne ferme jamais — simule
   *  un `.mdb` forgé qui fait boucler `mdbtools` (le scénario mesuré par l'audit). */
  function creerProcessusMuet(): { processus: ProcessusExecute; kill: ReturnType<typeof vi.fn> } {
    const emetteur = new EventEmitter();
    const kill = vi.fn();
    const stdout = new Readable({ read: () => undefined });
    const stderr = new Readable({ read: () => undefined });
    const processus: ProcessusExecute = {
      stdout,
      stderr,
      on: emetteur.on.bind(emetteur),
      kill,
    };
    return { processus, kill };
  }

  it("tue le sous-processus et lève ErreurDelaiDepasseProcessus après le délai d'inactivité — le worker n'est plus jamais occupé indéfiniment", async () => {
    const { processus, kill } = creerProcessusMuet();
    const fabriqueProcessus: FabriqueProcessus = () => processus;

    const consommer = (async () => {
      const lignes = [];
      for await (const ligne of lireLignesAccess('/chemin/forge.mdb', 'Clients', {
        fabriqueProcessus,
        delaiInactiviteExportMs: 1_000,
        delaiAbsoluExportMs: 60_000,
      })) {
        lignes.push(ligne);
      }
      return lignes;
    })();
    consommer.catch(() => undefined); // évite un unhandledRejection pendant l'avance des timers

    await vi.advanceTimersByTimeAsync(1_000);

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    await expect(consommer).rejects.toThrow(ErreurDelaiDepasseProcessus);
  });

  it('tue le sous-processus et lève ErreurDelaiDepasseProcessus au plafond ABSOLU (déclenchement indépendant de la garde inactivité)', async () => {
    const { processus, kill } = creerProcessusMuet();
    const fabriqueProcessus: FabriqueProcessus = () => processus;

    const consommer = (async () => {
      const lignes = [];
      for await (const ligne of lireLignesAccess('/chemin/forge.mdb', 'Clients', {
        fabriqueProcessus,
        delaiInactiviteExportMs: 60_000, // ne doit jamais se déclencher le premier ici
        delaiAbsoluExportMs: 3_000,
      })) {
        lignes.push(ligne);
      }
      return lignes;
    })();
    consommer.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(3_000);

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    await expect(consommer).rejects.toThrow(ErreurDelaiDepasseProcessus);
  });
});
