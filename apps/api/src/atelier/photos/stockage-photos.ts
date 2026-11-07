/**
 * Stockage des photos de lignes d'OR — MÊME DOCTRINE que `StockagePdf`
 * (`facturation/impression/stockage-pdf.ts`) et `PortStockageArchiveReprise` : un port minimal,
 * un adaptateur DISQUE LOCAL, une clé RELATIVE opaque stockée en base, un refus de tout chemin qui
 * sortirait de la racine, une purge par tenant (nLPD : photos de véhicules et parfois de
 * personnes, à effacer à la résiliation).
 *
 * Chemin : `<racine>/<tenantId>/or/<orId>/<photoId>.<ext>` ; vignette : `<photoId>.vignette.jpg`.
 * Racine par défaut : `uploads/photos-or` sous `process.cwd()` (`uploads/` est déjà ignoré par
 * git). EN PRODUCTION ce répertoire doit être un volume persistant, comme `uploads/documents-pdf`
 * (`docker-compose.yml`, `dfa_api_uploads`) : sans volume monté, les photos disparaissent au
 * prochain `docker compose up --force-recreate`.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface PortStockagePhotos {
  /** Écrit `contenu` sous `cle` (crée les répertoires manquants). */
  ecrire(cle: string, contenu: Buffer): Promise<void>;
  /** Lit le fichier ; lève si absent. */
  lire(cle: string): Promise<Buffer>;
  /** Supprime le fichier ; idempotent (absent = succès). */
  supprimer(cle: string): Promise<void>;
  /** Purge TOUTES les photos d'un tenant (résiliation) ; idempotente. */
  purgerTenant(tenantId: string): Promise<void>;
}

const EXTENSIONS: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Clé relative de la photo — l'extension suit le type DÉTECTÉ par octets magiques, jamais un nom
 *  fourni par le client. */
export function clePhoto(
  tenantId: string,
  orId: string,
  photoId: string,
  typeMime: string,
): string {
  return `${tenantId}/or/${orId}/${photoId}.${EXTENSIONS[typeMime] ?? 'bin'}`;
}

export function cleVignettePhoto(tenantId: string, orId: string, photoId: string): string {
  return `${tenantId}/or/${orId}/${photoId}.vignette.jpg`;
}

function estSousRacine(racine: string, chemin: string): boolean {
  const base = resolve(racine);
  return chemin.startsWith(base + sep);
}

export class StockagePhotosDisqueLocal implements PortStockagePhotos {
  private readonly racine: string;

  constructor(racine: string = join(process.cwd(), 'uploads', 'photos-or')) {
    this.racine = racine;
  }

  private resoudre(cle: string): string {
    const chemin = resolve(this.racine, cle);
    if (cle.trim() === '' || !estSousRacine(this.racine, chemin)) {
      throw new Error(`StockagePhotosDisqueLocal : clé hors racine refusée (« ${cle} »).`);
    }
    return chemin;
  }

  async ecrire(cle: string, contenu: Buffer): Promise<void> {
    const chemin = this.resoudre(cle);
    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, contenu);
  }

  async lire(cle: string): Promise<Buffer> {
    return readFile(this.resoudre(cle));
  }

  async supprimer(cle: string): Promise<void> {
    await rm(this.resoudre(cle), { force: true });
  }

  async purgerTenant(tenantId: string): Promise<void> {
    // Un tenantId vide résoudrait à la racine elle-même : on purgerait TOUS les tenants.
    if (tenantId.trim() === '') {
      throw new Error('StockagePhotosDisqueLocal.purgerTenant : tenantId vide refusé.');
    }
    const chemin = resolve(this.racine, tenantId);
    if (!estSousRacine(this.racine, chemin)) {
      throw new Error(
        `StockagePhotosDisqueLocal.purgerTenant : chemin hors racine refusé (« ${tenantId} »).`,
      );
    }
    await rm(chemin, { recursive: true, force: true });
  }
}
