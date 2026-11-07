/**
 * Outils communs des fichiers `seed-complement-*.ts` (jeu de démonstration « complet »).
 *
 * Ces fichiers écrivent en SQL direct avec le rôle `dfa_migrator` (propriétaire du schéma),
 * dans UNE transaction. Les triggers métier (machines à états, verrouillage des documents émis,
 * audit trail) restent actifs : chaque insertion respecte donc le chemin légal (un document naît
 * en brouillon puis est émis, un OR traverse ses états un par un).
 *
 * Tout est déterministe (générateur pseudo-aléatoire à graine fixe) et RELATIF À « MAINTENANT » :
 * le jeu reste vivant quel que soit le jour où le seed est lancé.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export interface Ctx {
  readonly c: Client;
  readonly tenantId: string;
  readonly maintenant: Date;
  readonly rnd: () => number;
  readonly journaliser: (m: string) => void;
  /** Identifiants par clé métier, remplis au fil des sections. */
  readonly sites: Map<string, string>;
  readonly utilisateurs: Map<string, string>;
  readonly compteurs: Map<string, number>;
}

/** mulberry32 : générateur déterministe. */
export function creerRnd(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function choisir<T>(ctx: Ctx, liste: readonly T[]): T {
  const v = liste[Math.floor(ctx.rnd() * liste.length)];
  if (v === undefined) throw new Error('liste vide');
  return v;
}

export function entre(ctx: Ctx, min: number, max: number): number {
  return min + Math.floor(ctx.rnd() * (max - min + 1));
}

function snake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function serialiser(v: unknown): unknown {
  return v !== null &&
    typeof v === 'object' &&
    !(v instanceof Date) &&
    !Array.isArray(v) &&
    !Buffer.isBuffer(v)
    ? JSON.stringify(v)
    : v;
}

/** Insère une ligne (clés camelCase ou snake_case) avec `tenant_id` et un `id` si absent. */
export async function ins(
  ctx: Ctx,
  table: string,
  ligne: Record<string, unknown>,
  options: { sansId?: boolean } = {},
): Promise<string> {
  const id = (ligne['id'] as string | undefined) ?? randomUUID();
  const donnees: Record<string, unknown> = { tenantId: ctx.tenantId, ...ligne };
  if (options.sansId !== true) donnees['id'] = id;
  const cles = Object.keys(donnees).filter((k) => donnees[k] !== undefined);
  const colonnes = cles.map((k) => `"${snake(k)}"`).join(', ');
  const params = cles.map((k) => serialiser(donnees[k]));
  const marques = cles.map((_, i) => `$${String(i + 1)}`).join(', ');
  await ctx.c.query(`insert into ${table} (${colonnes}) values (${marques})`, params);
  return id;
}

export async function maj(
  ctx: Ctx,
  table: string,
  id: string,
  champs: Record<string, unknown>,
  colId = 'id',
): Promise<void> {
  const cles = Object.keys(champs).filter((k) => champs[k] !== undefined);
  const sets = cles.map((k, i) => `"${snake(k)}" = $${String(i + 3)}`).join(', ');
  const params = cles.map((k) => serialiser(champs[k]));
  await ctx.c.query(`update ${table} set ${sets} where tenant_id = $1 and "${colId}" = $2`, [
    ctx.tenantId,
    id,
    ...params,
  ]);
}

export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  ctx: Ctx,
  texte: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await ctx.c.query(texte, params);
  return r.rows as T[];
}

// --- Dates relatives -----------------------------------------------------------------------

/** Date `n` jours avant/après maintenant, à l'heure UTC `h`:`m`. */
export function jour(ctx: Ctx, n: number, h = 8, m = 0): Date {
  const d = new Date(ctx.maintenant);
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ajouterJours(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Jour ouvré (lundi à vendredi) le plus proche en reculant. */
export function jourOuvre(d: Date): Date {
  const r = new Date(d);
  while (r.getUTCDay() === 0 || r.getUTCDay() === 6) r.setUTCDate(r.getUTCDate() - 1);
  return r;
}

// --- Argent (centimes, entiers) ------------------------------------------------------------

export const TVA_PM = 81;

/** TVA d'une ligne HT : arrondi au centime (demi vers le haut). */
export function tvaDe(htCentimes: number, tauxPm = TVA_PM): number {
  return Math.round((htCentimes * tauxPm) / 1000);
}

/** Part HT d'un TTC (mode ttc des documents de vente). */
export function htDeTtc(ttcCentimes: number, tauxPm = TVA_PM): number {
  return Math.round((ttcCentimes * 1000) / (1000 + tauxPm));
}

/** Arrondi suisse 5 centimes (espèces). */
export function arrondi5(centimes: number): number {
  return Math.round(centimes / 5) * 5;
}

// --- Numéros -------------------------------------------------------------------------------

/** Prochain numéro d'un compteur, tenu en mémoire puis écrit en fin de seed. */
export async function prochainNumero(ctx: Ctx, type: string, annee: number): Promise<number> {
  const cle = `${type}|${String(annee)}`;
  let v = ctx.compteurs.get(cle);
  if (v === undefined) {
    const r = await sql<{ valeur: number }>(
      ctx,
      `select valeur from compteur_document where tenant_id = $1 and type_document = $2 and annee = $3 and site_id is null`,
      [ctx.tenantId, type, annee],
    );
    v = r[0]?.valeur ?? 0;
  }
  v += 1;
  ctx.compteurs.set(cle, v);
  return v;
}

export async function ecrireCompteurs(ctx: Ctx): Promise<void> {
  for (const [cle, valeur] of ctx.compteurs) {
    const [type, anneeTexte] = cle.split('|') as [string, string];
    const annee = Number(anneeTexte);
    const r = await ctx.c.query(
      `update compteur_document set valeur = $4 where tenant_id = $1 and type_document = $2 and annee = $3 and site_id is null`,
      [ctx.tenantId, type, annee, valeur],
    );
    if (r.rowCount === 0) {
      await ins(ctx, 'compteur_document', { typeDocument: type, annee, valeur, valeurDepart: 0 });
    }
  }
}

// --- QR-facture ----------------------------------------------------------------------------

const TABLE_MOD10 = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** Référence QR (QRR) : 26 chiffres + chiffre de contrôle modulo 10 récursif. */
export function referenceQrr(corps26: string): string {
  let report = 0;
  for (const ch of corps26) report = TABLE_MOD10[(report + Number(ch)) % 10] ?? 0;
  return `${corps26}${String((10 - report) % 10)}`;
}

export interface DonneesQr {
  readonly iban: string;
  readonly creancier: { nom: string; rue: string; numero: string; npa: string; localite: string };
  readonly montantCentimes: number;
  readonly debiteur: { nom: string; rue: string; npa: string; localite: string };
  readonly reference: string;
  readonly information: string;
}

export function formatMontant(centimes: number): string {
  return `${String(Math.floor(Math.abs(centimes) / 100))}.${String(Math.abs(centimes) % 100).padStart(2, '0')}`;
}

export function payloadQr(d: DonneesQr): { payload: string; sha256: string } {
  const lignes = [
    'SPC',
    '0200',
    '1',
    d.iban,
    'S',
    d.creancier.nom,
    d.creancier.rue,
    d.creancier.numero,
    d.creancier.npa,
    d.creancier.localite,
    'CH',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    formatMontant(d.montantCentimes),
    'CHF',
    'S',
    d.debiteur.nom,
    d.debiteur.rue,
    '',
    d.debiteur.npa,
    d.debiteur.localite,
    'CH',
    'QRR',
    d.reference,
    d.information,
    'EPD',
  ];
  const payload = lignes.join('\r\n');
  return { payload, sha256: createHash('sha256').update(payload).digest('hex') };
}
