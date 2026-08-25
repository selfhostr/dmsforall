/**
 * Stockage disque des tranches binaires + assemblage de l'archive de reprise — MÊME DOCTRINE que
 * `exploitation/cycle-vie-tenant/service-stockage-export-tenant.ts::StockageExportTenantDisqueLocal`
 * (adaptateur disque local, interface réduite, S3-compatible en production HORS PÉRIMÈTRE — décision
 * infrastructure, pas reprise).
 *
 * Racine : `uploads/reprise/<tenantId>/<dossierId>/`, sœur de `uploads/exports-resiliation/` et
 * `uploads/documents-pdf/` (déjà sous `.gitignore` racine, section « Données locales… uploads/ »).
 *
 * TOUT EN FLUX, JAMAIS EN MÉMOIRE : les archives réelles mesurées vont jusqu'à 43 Go — écrire une
 * tranche est une simple écriture de fichier (la tranche elle-même, 16 Mo par défaut, tient en
 * mémoire côté Nest via le corps de requête déjà bufferisé par Express ; ce n'est PAS ce fichier
 * qui bufferise l'archive entière). L'ASSEMBLAGE (`assemblerEtCalculerEmpreinte`), lui, lit et
 * écrit tranche par tranche via des flux Node — le fichier assemblé peut atteindre 60 Go, jamais
 * chargé entièrement en mémoire, et l'empreinte SHA-256 est calculée EN MÊME TEMPS que l'écriture
 * (une seule passe, pas une relecture complète après coup).
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface PortStockageArchiveReprise {
  /** Racine RELATIVE, opaque, pour un dossier donné — stockée telle quelle en base
   *  (`dossier_reprise.stockage_chemin`). */
  racineDossier(tenantId: string, dossierId: string): string;

  /** Écrit (ou écrase — idempotence par numéro) une tranche. Rend la taille réellement écrite. */
  ecrireTranche(racineDossier: string, numero: number, contenu: Buffer): Promise<number>;

  /** `true` si la tranche `numero` existe déjà sur disque (indépendamment de la base — sert de
   *  garde-fou de cohérence, jamais de source de vérité : la base reste la source de vérité pour
   *  la reprise après interruption). */
  trancheExiste(racineDossier: string, numero: number): Promise<boolean>;

  /**
   * Concatène les tranches `0..dernierNumero` (dans l'ordre, PAS d'espace mémoire proportionnel à
   * la taille totale) en un fichier unique, et rend son empreinte SHA-256 calculée EN MÊME TEMPS
   * que l'écriture. Chemin de l'archive assemblée = `<racineDossier>/archive.bin`.
   */
  assemblerEtCalculerEmpreinte(
    racineDossier: string,
    dernierNumero: number,
  ): Promise<{ readonly cheminArchive: string; readonly empreinteSha256Hex: string }>;

  /** Chemin ABSOLU de l'archive assemblée — consommé par le port de lecture (`lecture/`). Lève si
   *  l'archive n'a pas encore été assemblée (`finaliser` pas encore appelé avec succès). */
  cheminAbsoluArchive(racineDossier: string): Promise<string>;

  /**
   * Purge SEULEMENT les tranches d'origine (`tranches/`), PAS l'archive assemblée
   * (`archive.bin`) — appelée par `ServiceDepotReprise.finaliser()` juste après que l'intégrité
   * de l'archive assemblée a été vérifiée : les tranches n'ont alors plus aucune utilité (la
   * reprise après interruption ne s'applique qu'à un dépôt encore `depot_en_cours` ; passé ce
   * point, seule `archive.bin` sert — analyse, relance d'analyse et import ne lisent jamais les
   * tranches). Sans cette purge, une archive de reprise assemblée ET ses tranches d'origine
   * coexistent indéfiniment sur le disque (mesuré : +~2x la taille de l'archive tant que le
   * dossier reste actif). Idempotente : ne lève pas si `tranches/` est déjà absent.
   */
  purgerTranches(racineDossier: string): Promise<void>;

  /**
   * Purge intégrale (tranches + archive assemblée) — RGPD/nLPD : données personnelles de clients
   * d'un garage tiers, jamais conservées indéfiniment après un import terminé ou un dossier
   * annulé. Idempotente : ne lève pas si le répertoire est déjà absent.
   */
  purgerDossier(racineDossier: string): Promise<void>;
}

export class StockageArchiveRepriseDisqueLocal implements PortStockageArchiveReprise {
  private readonly racine: string;

  constructor(racine: string = join(process.cwd(), 'uploads', 'reprise')) {
    this.racine = racine;
  }

  racineDossier(tenantId: string, dossierId: string): string {
    return `${tenantId}/${dossierId}`;
  }

  async ecrireTranche(racineDossier: string, numero: number, contenu: Buffer): Promise<number> {
    const chemin = this.cheminTranche(racineDossier, numero);
    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, contenu);
    return contenu.length;
  }

  async trancheExiste(racineDossier: string, numero: number): Promise<boolean> {
    try {
      await stat(this.cheminTranche(racineDossier, numero));
      return true;
    } catch {
      return false;
    }
  }

  async assemblerEtCalculerEmpreinte(
    racineDossier: string,
    dernierNumero: number,
  ): Promise<{ readonly cheminArchive: string; readonly empreinteSha256Hex: string }> {
    const cheminArchive = this.resoudreArchive(racineDossier);
    await mkdir(dirname(cheminArchive), { recursive: true });

    const hash = createHash('sha256');
    const sortie = createWriteStream(cheminArchive);
    try {
      for (let numero = 0; numero <= dernierNumero; numero += 1) {
        const cheminTranche = this.cheminTranche(racineDossier, numero);
        for await (const morceau of createReadStream(cheminTranche)) {
          const tampon: Buffer = morceau as Buffer;
          hash.update(tampon);
          if (!sortie.write(tampon)) {
            await new Promise<void>((res) => sortie.once('drain', res));
          }
        }
      }
      await new Promise<void>((res, rej) => {
        sortie.end((erreur?: Error | null) => (erreur ? rej(erreur) : res()));
      });
    } catch (erreur) {
      sortie.destroy();
      throw erreur;
    }

    return { cheminArchive, empreinteSha256Hex: hash.digest('hex') };
  }

  async cheminAbsoluArchive(racineDossier: string): Promise<string> {
    const chemin = this.resoudreArchive(racineDossier);
    await stat(chemin).catch(() => {
      throw new Error(
        `StockageArchiveRepriseDisqueLocal.cheminAbsoluArchive : archive non assemblée pour « ${racineDossier} » (finaliser() pas encore appelé avec succès).`,
      );
    });
    return chemin;
  }

  async purgerTranches(racineDossier: string): Promise<void> {
    const cheminTranches = join(this.racine, racineDossier, 'tranches');
    // Même garde-fou que `purgerDossier` ci-dessous — ne jamais supprimer hors de la racine de
    // stockage, même si `racineDossier` était corrompu.
    if (!estSousRacine(this.racine, cheminTranches)) {
      throw new Error(
        `StockageArchiveRepriseDisqueLocal.purgerTranches : chemin hors racine refusé (« ${racineDossier} »).`,
      );
    }
    await rm(cheminTranches, { recursive: true, force: true });
  }

  async purgerDossier(racineDossier: string): Promise<void> {
    const cheminRacineDossier = resolve(this.racine, racineDossier);
    // Garde-fou identique à `StockageExportTenantDisqueLocal.resoudreDansRepertoire` : ne jamais
    // supprimer hors de la racine de stockage, même si `racineDossier` était corrompu.
    if (!estSousRacine(this.racine, cheminRacineDossier)) {
      throw new Error(
        `StockageArchiveRepriseDisqueLocal.purgerDossier : chemin hors racine refusé (« ${racineDossier} »).`,
      );
    }
    await rm(cheminRacineDossier, { recursive: true, force: true });

    // Défaut 4 (mandat reprise) : sans ce nettoyage, `uploads/reprise/<tenantId>/` reste sur le
    // disque, vide, après la purge du dernier dossier d'un tenant — un répertoire par tenant qui
    // s'accumule indéfiniment. Best-effort, jamais bloquant : une erreur (répertoire déjà absent,
    // ou un AUTRE dossier de ce tenant vient d'y écrire en même temps) ne doit jamais faire
    // échouer la purge elle-même, qui est ce qui compte réellement (RGPD/nLPD).
    const cheminRepertoireTenant = dirname(cheminRacineDossier);
    const racineAbs = resolve(this.racine);
    if (
      cheminRepertoireTenant !== racineAbs &&
      estSousRacine(this.racine, cheminRepertoireTenant)
    ) {
      try {
        const entrees = await readdir(cheminRepertoireTenant);
        if (entrees.length === 0) {
          await rm(cheminRepertoireTenant, { recursive: false, force: true });
        }
      } catch {
        // Répertoire déjà absent, ou non-vide entre-temps (autre dossier du même tenant en
        // cours de dépôt) — sans conséquence, cette purge annexe est best-effort.
      }
    }
  }

  private cheminTranche(racineDossier: string, numero: number): string {
    return join(this.racine, racineDossier, 'tranches', `${numero}.bin`);
  }

  private resoudreArchive(racineDossier: string): string {
    return join(this.racine, racineDossier, 'archive.bin');
  }
}

function estSousRacine(racine: string, cheminAbs: string): boolean {
  const racineAbs = resolve(racine) + sep;
  return cheminAbs === resolve(racine) || (resolve(cheminAbs) + sep).startsWith(racineAbs);
}

// Exports internes utilisés par les tests de purge (vérifier l'absence effective sur disque).
export async function listerFichiersRecursif(chemin: string): Promise<readonly string[]> {
  try {
    const entrees = await readdir(chemin, { withFileTypes: true });
    const resultats: string[] = [];
    for (const entree of entrees) {
      const cheminEnfant = join(chemin, entree.name);
      if (entree.isDirectory()) {
        resultats.push(...(await listerFichiersRecursif(cheminEnfant)));
      } else {
        resultats.push(cheminEnfant);
      }
    }
    return resultats;
  } catch {
    return [];
  }
}

export async function supprimerFichierSiExiste(chemin: string): Promise<void> {
  await unlink(chemin).catch(() => undefined);
}
