/**
 * Logique de `creer-garage` : crée en UNE transaction un tenant, son site principal, son premier
 * utilisateur au rôle `direction` (plus la ligne d'audit `audit_utilisateur`) et les données de
 * départ d'un garage utilisable le premier jour (`parametrage/defauts-garage.ts`).
 *
 * Aucune dépendance à Nest ni à `tsx` : le service reçoit un exécuteur SQL et une fonction de
 * hachage, ce qui le rend testable sans base et exécutable dans l'image compilée.
 */

import { schemaMotDePasseNouveau } from '@dfa/shared';
import { z } from 'zod';

import { ErreurMetier } from '../common/erreurs';
import { ServicePolitiqueMotDePasse } from '../auth/politique-mot-de-passe';
import {
  codeSiteParDefaut,
  MOTIFS_RENDEZ_VOUS_PAR_DEFAUT,
  TAUX_HORAIRE_ATELIER_DEFAUT,
} from '../parametrage/defauts-garage';

export type CodeErreurCreerGarage =
  | 'GARAGE_INVALIDE'
  | 'COURRIEL_INVALIDE'
  | 'MOT_DE_PASSE_FAIBLE'
  | 'GARAGE_EXISTANT'
  | 'COURRIEL_EXISTANT';

/** Refus attendu (saisie ou doublon) : le point d'entrée l'affiche et sort en code non nul. */
export class ErreurCreerGarage extends Error {
  constructor(
    readonly code: CodeErreurCreerGarage,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurCreerGarage';
  }
}

/** Sous-ensemble de `pg.Client` utilisé ici. */
export interface ExecuteurSql {
  query(
    texte: string,
    valeurs?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type HacherMotDePasse = (clair: string) => Promise<string>;

export interface EntreeCreerGarage {
  readonly garage: string;
  readonly email: string;
  readonly motDePasse: string;
  readonly prenom: string;
  readonly nom: string;
}

export interface ResultatCreerGarage {
  readonly tenantId: string;
  readonly slug: string;
  readonly siteId: string;
  readonly siteCode: string;
  readonly utilisateurId: string;
  readonly email: string;
  readonly role: 'direction';
}

/** Slug conforme à `tenant_slug_format_chk` : `^[a-z0-9][a-z0-9-]{1,62}$`. */
export function deriverSlug(nomGarage: string): string {
  const slug = nomGarage
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new ErreurCreerGarage(
      'GARAGE_INVALIDE',
      'Garage name must contain at least 2 letters or digits.',
    );
  }
  return slug;
}

function estViolationUnicite(erreur: unknown): boolean {
  return (
    typeof erreur === 'object' && erreur !== null && (erreur as { code?: string }).code === '23505'
  );
}

function verifierMotDePasse(motDePasse: string, email: string): void {
  if (!schemaMotDePasseNouveau.safeParse(motDePasse).success) {
    throw new ErreurCreerGarage(
      'MOT_DE_PASSE_FAIBLE',
      'Le mot de passe doit contenir entre 12 et 256 caractères.',
    );
  }
  try {
    new ServicePolitiqueMotDePasse().verifier(motDePasse, { email });
  } catch (erreur) {
    // Le message de la politique nomme le motif exact (trop courant, prévisible, contient le
    // courriel) : on le restitue tel quel plutôt que d'en inventer un résumé.
    if (erreur instanceof ErreurMetier) {
      throw new ErreurCreerGarage('MOT_DE_PASSE_FAIBLE', erreur.message);
    }
    throw erreur;
  }
}

/**
 * Ce qu'un garage neuf doit avoir pour servir dès le premier jour : paramètres atelier du tenant et
 * du site (valeurs par défaut de la base), taux horaire « Atelier », motifs de rendez-vous courants.
 * Les compteurs de numérotation (OR, factures, clients…) se créent à la demande au premier document.
 * `on conflict do nothing` : rejouable sans doublon.
 */
async function poserDefautsGarage(
  bd: ExecuteurSql,
  tenantId: string,
  siteId: string,
): Promise<void> {
  await bd.query(
    'insert into parametre_atelier (tenant_id) values ($1) on conflict (tenant_id) do nothing',
    [tenantId],
  );
  await bd.query(
    'insert into parametre_site (tenant_id, site_id) values ($1, $2) on conflict (site_id) do nothing',
    [tenantId, siteId],
  );
  const t = TAUX_HORAIRE_ATELIER_DEFAUT;
  await bd.query(
    `insert into taux_horaire (tenant_id, code, libelle, montant_centimes, valide_du)
     values ($1, $2, $3, $4, $5)`,
    [tenantId, t.code, t.libelle, t.montantCentimes, t.valideDu],
  );
  for (const m of MOTIFS_RENDEZ_VOUS_PAR_DEFAUT) {
    await bd.query(
      `insert into motif_rendez_vous
         (tenant_id, code, libelle_fr, libelle_de, libelle_it, duree_defaut_minutes)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (tenant_id, code) do nothing`,
      [tenantId, m.code, m.libelleFr, m.libelleDe, m.libelleIt, m.dureeDefautMinutes],
    );
  }
}

export async function creerGarage(
  bd: ExecuteurSql,
  entree: EntreeCreerGarage,
  hacher: HacherMotDePasse,
): Promise<ResultatCreerGarage> {
  const garage = entree.garage.trim();
  const slug = deriverSlug(garage);

  const email = entree.email.trim().toLowerCase();
  if (!z.string().email().max(320).safeParse(email).success) {
    throw new ErreurCreerGarage('COURRIEL_INVALIDE', 'The email address is not valid.');
  }
  verifierMotDePasse(entree.motDePasse, email);

  // Hachage hors transaction : Argon2 est coûteux, inutile de garder la transaction ouverte.
  const motDePasseHash = await hacher(entree.motDePasse);

  await bd.query('begin');
  try {
    const garageExistant = await bd.query(
      'select id from tenant where slug = $1 or lower(raison_sociale) = lower($2) limit 1',
      [slug, garage],
    );
    if (garageExistant.rows.length > 0) {
      throw new ErreurCreerGarage('GARAGE_EXISTANT', `A garage named "${garage}" already exists.`);
    }
    const emailExistant = await bd.query('select id from utilisateur where email = $1 limit 1', [
      email,
    ]);
    if (emailExistant.rows.length > 0) {
      throw new ErreurCreerGarage('COURRIEL_EXISTANT', `The email ${email} is already in use.`);
    }

    const tenantId = String(
      (
        await bd.query(
          `insert into tenant (slug, raison_sociale, pays, langue_defaut, statut)
           values ($1, $2, 'CH', 'fr', 'actif') returning id`,
          [slug, garage],
        )
      ).rows[0]?.id,
    );
    const siteCode = codeSiteParDefaut(slug);
    const siteId = String(
      (
        await bd.query(
          `insert into site (tenant_id, code, nom, pays, actif)
           values ($1, $2, $3, 'CH', true) returning id`,
          [tenantId, siteCode, garage],
        )
      ).rows[0]?.id,
    );
    await poserDefautsGarage(bd, tenantId, siteId);
    const utilisateurId = String(
      (
        await bd.query(
          `insert into utilisateur (tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut)
           values ($1, $2, $3, $4, $5, 'fr', 'direction', 'actif') returning id`,
          [tenantId, email, motDePasseHash, entree.prenom, entree.nom],
        )
      ).rows[0]?.id,
    );
    await bd.query(
      'insert into utilisateur_site (tenant_id, utilisateur_id, site_id) values ($1, $2, $3)',
      [tenantId, utilisateurId, siteId],
    );
    // Premier compte : il n'a pas d'acteur autre que lui-même (amorçage par l'exploitation).
    await bd.query(
      `insert into audit_utilisateur (tenant_id, utilisateur_cible_id, action_par_id, action, avant, apres)
       values ($1, $2, $2, 'creation', null, $3::jsonb)`,
      [
        tenantId,
        utilisateurId,
        JSON.stringify({ role: 'direction', statut: 'actif', source: 'cli' }),
      ],
    );
    await bd.query('commit');
    return {
      tenantId,
      slug,
      siteId,
      siteCode,
      utilisateurId,
      email,
      role: 'direction',
    };
  } catch (erreur) {
    await bd.query('rollback');
    if (estViolationUnicite(erreur)) {
      throw new ErreurCreerGarage(
        'GARAGE_EXISTANT',
        'The garage or the email address already exists (concurrent creation).',
      );
    }
    throw erreur;
  }
}
