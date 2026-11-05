/**
 * Stockage des PDF de facture — abstraction volontairement minimale (`StockagePdf`) derrière
 * laquelle un adaptateur de production (S3-compatible, Infomaniak/Exoscale — voir
 * `docs/design-impression-facture-qr.md` §« Hors de portée ») pourra se brancher SANS toucher au
 * reste du module. Décision explicitement hors du périmètre l'équipe facturation : le choix d'un
 * stockage objet en production est une décision infrastructure (l'équipe infrastructure), pas une décision
 * de facturation — ce fichier ne fait qu'exposer l'interface et un adaptateur DISQUE LOCAL
 * suffisant pour le développement et un premier pilote mono-instance.
 *
 * Chemin choisi : `uploads/documents-pdf/<tenantId>/<documentId>.pdf`, sous `apps/api/` (relatif à
 * `process.cwd()` du process Nest). `uploads/` est DÉJÀ dans `.gitignore` racine (section
 * « Données locales... uploads/ ») — aucun fichier `.gitignore` supplémentaire n'était nécessaire,
 * et ce module n'en ajoute donc aucun (hors périmètre d'écriture de cette tâche de toute façon).
 *
 * CORRECTIF nLPD : `purgerTenant` ajouté — ces PDF (nom, adresse, détail des
 * prestations d'un client du garage) n'étaient JAMAIS effacés à la résiliation d'un tenant, alors
 * que les lignes SQL l'étaient (`purger_donnees_tenant()`, 0062). `ServiceCycleVieResiliation.purger`
 * appelle désormais cette méthode — MÊME DOCTRINE que `PortStockageArchiveReprise.purgerDossier`
 * (`reprise/depot/stockage-archive-reprise.ts`) : suppression par l'abstraction de stockage,
 * idempotente, refuse tout chemin qui sortirait de la racine.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface StockagePdf {
  /** Écrit `buffer` sous `cle` (crée les répertoires manquants). Écrase si `cle` existe déjà —
   *  la seule situation où c'est appelé deux fois pour la même clé est une course entre deux
   *  premières requêtes concurrentes sur le même document (voir `service-impression-facture.ts`),
   *  et le contenu généré est déterministe (mêmes octets), donc l'écrasement est sans conséquence. */
  ecrire(cle: string, buffer: Buffer): Promise<void>;
  lire(cle: string): Promise<Buffer>;
  /** Purge TOUS les PDF d'un tenant (`<tenantId>/**`) — résiliation nLPD. Idempotente : un tenant
   *  qui n'a jamais rien déposé ne lève pas. Refuse tout chemin qui sortirait de la racine de
   *  stockage (défense en profondeur, même si `tenantId` est un UUID non falsifiable). */
  purgerTenant(tenantId: string): Promise<void>;
}

/** `pdf_cle` : chemin relatif stocké en base, opaque pour le reste du produit — seul ce module
 *  sait comment le résoudre en emplacement réel. */
export function cleePdfDocument(tenantId: string, documentId: string): string {
  return `${tenantId}/${documentId}.pdf`;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export class StockagePdfDisqueLocal implements StockagePdf {
  private readonly racine: string;

  constructor(racine: string = join(process.cwd(), 'uploads', 'documents-pdf')) {
    this.racine = racine;
  }

  private cheminAbsolu(cle: string): string {
    return join(this.racine, cle);
  }

  async ecrire(cle: string, buffer: Buffer): Promise<void> {
    const chemin = this.cheminAbsolu(cle);
    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, buffer);
  }

  async lire(cle: string): Promise<Buffer> {
    return readFile(this.cheminAbsolu(cle));
  }

  async purgerTenant(tenantId: string): Promise<void> {
    // `tenantId` vide/blanc résoudrait à `this.racine` LUI-MÊME (`resolve(racine, '') ===
    // resolve(racine)`) — refusé explicitement, AVANT même `estSousRacine`, pour ne jamais purger
    // le stockage PDF de TOUS les tenants d'un seul coup sur une valeur dégénérée.
    if (tenantId.trim() === '') {
      throw new Error('StockagePdfDisqueLocal.purgerTenant : tenantId vide refusé.');
    }
    const chemin = resolve(this.racine, tenantId);
    if (!estSousRacine(this.racine, chemin)) {
      throw new Error(
        `StockagePdfDisqueLocal.purgerTenant : chemin hors racine refusé (« ${tenantId} »).`,
      );
    }
    await rm(chemin, { recursive: true, force: true });
  }
}

/** Même garde-fou que `reprise/depot/stockage-archive-reprise.ts::estSousRacine` — ne jamais
 *  supprimer hors de la racine de stockage, même si `tenantId` était corrompu. */
function estSousRacine(racine: string, cheminAbs: string): boolean {
  const racineAbs = resolve(racine) + sep;
  return cheminAbs === resolve(racine) || (resolve(cheminAbs) + sep).startsWith(racineAbs);
}
