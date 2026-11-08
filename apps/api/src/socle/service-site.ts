import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import {
  TRI_DEFAUT_CREATION,
  type EntreeModificationSite,
  type PageCurseur,
  type SiteResume,
} from '@dfa/shared';
import type { AccesBase, ContexteTenant } from '../db/db.types';
import { JETON_DB } from '../db/db.jetons';
import { site, type LigneSite } from '../db/schema';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';
import { ErreurMetier } from '../common/erreurs';

export interface ParametresListeSites {
  readonly limite: number;
  readonly curseur?: string;
}

function versSiteResume(ligne: LigneSite): SiteResume {
  return {
    id: ligne.id,
    code: ligne.code,
    codeCourt: ligne.codeCourt,
    nom: ligne.nom,
    actif: ligne.actif,
  };
}

/**
 * Curseur par défaut (`creeLe:desc`) décodé — `creeLeTexte` reste le texte natif PostgreSQL du
 * `timestamptz`, jamais un `Date`, de bout en bout jusqu'à sa réinjection en SQL (`::timestamptz`).
 * `Date` ne représente que la milliseconde depuis l'epoch (limite structurelle du type) alors que
 * PostgreSQL conserve la microseconde ; y transiter tronquerait silencieusement le seuil de
 * pagination et ferait sauter des lignes qui partagent la même milliseconde de création — voir
 * `common/pagination/valeur-temporelle.ts` pour la mesure complète du défaut. Décode aussi bien un
 * curseur v1 historique (socle étape 0, `decoderCurseurTrie` le traite comme équivalent à
 * `TRI_DEFAUT_CREATION`) qu'un curseur v2 émis par `lister()` ci-dessous.
 *
 * DÉFAUT CORRIGÉ (même classe que celui documenté dans `common/pagination/curseur.ts`, constaté en
 * exécution réelle sur `apps/api/src/pneus/**`) : `typeValeur = 'temporel'` est désormais demandé
 * explicitement à `decoderCurseurTrie` — sans quoi une valeur forgée qui n'est pas un horodatage
 * PostgreSQL bien formé traverserait ce décodage intacte (le contrôle `typeof !== 'string'`
 * ci-dessous ne vérifie que le TYPE JS, pas le format) et atteindrait le `::timestamptz` de
 * `conditionCurseur` dans `lister()`, provoquant une erreur PostgreSQL native (`22007`) non
 * interceptée → `500 ERREUR_INTERNE` au lieu du `400 VALIDATION_ECHOUEE` attendu.
 */
function decoderCurseurSite(curseur: string): {
  readonly creeLeTexte: string;
  readonly id: string;
} {
  const donnees = decoderCurseurTrie(curseur, TRI_DEFAUT_CREATION, 'temporel');
  if (typeof donnees.valeur !== 'string') {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return { creeLeTexte: donnees.valeur, id: donnees.id };
}

/**
 * Lecture des sites du tenant courant. Comme `ServiceTenant`, aucune méthode ne reçoit de
 * `tenantId` en paramètre client : uniquement le `ContexteTenant` construit depuis la session.
 */
@Injectable()
export class ServiceSite {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    params: ParametresListeSites,
  ): Promise<PageCurseur<SiteResume>> {
    const { limite } = params;
    const curseurDecode = params.curseur ? decoderCurseurSite(params.curseur) : null;

    return this.acces.enTenant(ctx, async (tx) => {
      // Rescope explicite sur tenant_id, même si le RLS filtre déjà via le GUC posé par
      // enTenant() : le RLS est le filet, jamais le mécanisme — un `where` manquant est un
      // défaut de revue même s'il est rattrapé côté base.
      const conditionTenant = eq(site.tenantId, ctx.tenantId);
      // Seuil keyset construit en SQL brut plutôt qu'avec `lt`/`or` du query builder : le
      // membre droit doit être un texte casté explicitement `::timestamptz`, jamais un `Date`
      // JS passé en paramètre (le pilote `pg` le sérialiserait à la milliseconde, perdant la
      // microseconde que `site.creeLe` conserve réellement en base — voir `decoderCurseurSite`).
      const conditionCurseur = curseurDecode
        ? sql`(${site.creeLe}, ${site.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
        : undefined;
      const conditionFinale = conditionCurseur
        ? and(conditionTenant, conditionCurseur)
        : conditionTenant;

      const lignes = await tx
        .select({
          ...getTableColumns(site),
          // Texte natif Postgres du timestamptz — jamais le `Date` de `getTableColumns()` (mode
          // 'date', microseconde déjà perdue). Voir common/pagination/valeur-temporelle.ts.
          creeLeTexte: sql<string>`${site.creeLe}::text`,
        })
        .from(site)
        .where(conditionFinale)
        .orderBy(desc(site.creeLe), desc(site.id))
        .limit(limite + 1);

      const aUnePageSuivante = lignes.length > limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map(versSiteResume),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: TRI_DEFAUT_CREATION,
                valeur: valeurCurseurTimestamptz(derniere.creeLeTexte),
                id: derniere.id,
              })
            : null,
        limite,
      };
    });
  }

  async parId(ctx: ContexteTenant, siteId: string): Promise<SiteResume> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(site)
        .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
        .limit(1);
      const ligne = lignes[0];

      if (!ligne) {
        // 404, jamais 403 : un site d'un autre tenant ne doit même pas laisser deviner qu'il existe.
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Site introuvable.');
      }

      return versSiteResume(ligne);
    });
  }

  /**
   * `PATCH /sites/{siteId}` — aujourd'hui le seul champ modifiable est le code court. Doublon dans
   * le tenant → 409 CONFLIT (contrainte `site_tenant_code_court_uk`), jamais un 500.
   */
  async modifier(
    ctx: ContexteTenant,
    siteId: string,
    entree: EntreeModificationSite,
  ): Promise<SiteResume> {
    return this.acces.enTenant(ctx, async (tx) => {
      const portee = and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId));
      const [existant] = await tx.select({ id: site.id }).from(site).where(portee).limit(1);
      if (!existant) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Site introuvable.');

      if (entree.codeCourt !== undefined) {
        try {
          await tx.update(site).set({ codeCourt: entree.codeCourt }).where(portee);
        } catch (erreur) {
          if (
            (erreur as { code?: string; cause?: { code?: string } }).cause?.code === '23505' ||
            (erreur as { code?: string }).code === '23505'
          ) {
            throw new ErreurMetier('CONFLIT', 'Ce code court est déjà utilisé par un autre site.', {
              erreurs: [
                {
                  champ: 'codeCourt',
                  code: 'code_court_deja_utilise',
                  message: 'Ce code court est déjà utilisé par un autre site.',
                },
              ],
            });
          }
          throw erreur;
        }
      }

      const [ligne] = await tx.select().from(site).where(portee).limit(1);
      if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Site introuvable.');
      return versSiteResume(ligne);
    });
  }
}
