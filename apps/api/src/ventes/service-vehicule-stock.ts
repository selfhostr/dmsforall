import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  EntreeMarquerVenduVehiculeStock,
  EntreeMiseEnStock,
  EntreeModificationVehiculeStock,
  EntreeReceptionnerVehiculeStock,
  EntreeRemettreDisponibleVehiculeStock,
  FiltresVehiculesStock,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseVehiculeStock,
  RoleUtilisateur,
  VehiculeStockResume,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { depotPneus, vehiculeStock, type LigneVehiculeStock } from '../db/schema';
import {
  chargerPlaqueCourante,
  chargerResumeUtilisateur,
  chargerVehiculeLigne,
  construireVehiculeResume,
} from '../atelier/references';
import { CollecteurAvertissements } from '../common/avertissements';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { JETON_AUDIT, type ServiceAudit } from '../common/audit';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { remonterCausePg } from '../common/erreurs-pg/remonter-cause-pg';
import { Horloge } from '../common/horloge/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';

import { versVehiculeStockResponse, versVehiculeStockResume } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';
import {
  chargerVehiculeStock,
  chargerVehiculeStockOuNull,
  chargerVehiculeStockPourEcriture,
} from './references';

export interface ResultatCreationVehiculeStock {
  readonly statutHttp: number;
  readonly corps: ReponseAvecAvertissements<ReponseVehiculeStock>;
}

const DEFINITIONS_TRI_VEHICULES_STOCK: Readonly<
  Record<FiltresVehiculesStock['tri'], DefinitionTri>
> = {
  // `date_entree_stock` est une colonne `date` (pas `timestamptz`) : pas de perte de microseconde
  // possible, `temporel: true` n'est pas nécessaire ici (voir `common/pagination/valeur-temporelle.ts`).
  'dateEntreeStock:desc': { expression: sql`vs.date_entree_stock`, sens: 'desc', nullable: false },
  'dateEntreeStock:asc': { expression: sql`vs.date_entree_stock`, sens: 'asc', nullable: false },
  // RV-07 : jours écoulés depuis l'entrée en stock — expression calculée, jamais stockée.
  'joursStock:desc': {
    expression: sql`extract(epoch from (coalesce(vs.vendu_le, now()) - vs.date_entree_stock::timestamptz)) / 86400`,
    sens: 'desc',
    nullable: false,
  },
  'prixVenteAfficheCentimes:asc': {
    expression: sql`vs.prix_vente_affiche_centimes`,
    sens: 'asc',
    nullable: true,
  },
  'prixVenteAfficheCentimes:desc': {
    expression: sql`vs.prix_vente_affiche_centimes`,
    sens: 'desc',
    nullable: true,
  },
};

const COLONNES_VEHICULE_STOCK_LISTE = sql`
  vs.id as "id", vs.tenant_id as "tenantId", vs.site_id as "siteId", vs.provenance as "provenance",
  vs.date_entree_stock as "dateEntreeStock", vs.prix_achat_centimes as "prixAchatCentimes",
  vs.prix_vente_affiche_centimes as "prixVenteAfficheCentimes", vs.statut as "statutCommercial",
  vs.vendeur_precedent_assujetti as "vendeurPrecedentAssujetti",
  vs.origine_reprise_dossier_vente_id as "origineRepriseDossierVenteId",
  vs.dernier_motif_transition as "dernierMotifTransition",
  vs.receptionne_le as "receptionneLe", vs.reserve_le as "reserveLe", vs.vendu_le as "venduLe",
  vs.livre_le as "livreLe", vs.version as "version", vs.cree_le as "creeLe", vs.modifie_le as "modifieLe",
  v.marque as "vMarque", v.modele as "vModele", v.version as "vVersion", v.vin as "vVin",
  v.date_1re_circulation as "vDate1reCirculation", v.identification_incomplete as "vIdentificationIncomplete",
  p.valeur as "pValeur", p.canton as "pCanton"
`;

/**
 * Véhicule en stock (RV-01→RV-14, §6.1) — priorité 1 du module : entrée en stock, modification,
 * réception (VN commandé), retour manuel à `disponible`, liste paginée.
 */
@Injectable()
export class ServiceVehiculeStock {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_AUDIT) private readonly audit: ServiceAudit,
    private readonly horloge: Horloge,
  ) {}

  /**
   * `POST /vehicules/{vehiculeId}/stock` — `Idempotency-Key` obligatoire. Le véhicule DOIT déjà
   * exister (`POST /vehicules`, étape 1) ; `409 VENTE_VEHICULE_STOCK_DEJA_EXISTANT` si une ligne
   * existe déjà pour cet id (marqueur « déjà mis en stock »).
   */
  async mettreEnStock(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    vehiculeId: string,
    entree: EntreeMiseEnStock,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & ResultatCreationVehiculeStock>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/vehicules/{vehiculeId}/stock',
        cle: cleIdempotence,
        corps: entree,
      },
      async (tx) => {
        const vehiculeLigne = await chargerVehiculeLigne(tx, ctx, vehiculeId);

        const existant = await chargerVehiculeStockOuNull(tx, ctx, vehiculeId, true);
        if (existant) {
          throw new ErreurMetier(
            'VENTE_VEHICULE_STOCK_DEJA_EXISTANT',
            'Ce véhicule est déjà (ou a déjà été) mis en stock.',
          );
        }

        // Statut initial DÉRIVÉ (contrat, littéral) : `en_commande` si `provenance = 'neuf_constructeur'`
        // et que le véhicule n'a pas encore de VIN connu, `disponible` sinon.
        const statutInitial =
          entree.provenance === 'neuf_constructeur' && !vehiculeLigne.vin
            ? 'en_commande'
            : 'disponible';
        const maintenant = this.horloge.maintenant();

        let ligne: LigneVehiculeStock;
        try {
          const inserees = await tx
            .insert(vehiculeStock)
            .values({
              id: vehiculeId,
              tenantId: ctx.tenantId,
              siteId: entree.siteId,
              provenance: entree.provenance,
              dateEntreeStock: entree.dateEntreeStock,
              prixAchatCentimes: entree.prixAchatCentimes,
              prixVenteAfficheCentimes: entree.prixVenteAfficheCentimes ?? null,
              statutCommercial: statutInitial,
              vendeurPrecedentAssujetti: entree.vendeurPrecedentAssujetti ?? null,
              receptionneLe: statutInitial === 'disponible' ? maintenant : null,
            })
            .returning();
          const inseree = inserees[0];
          if (!inseree)
            throw new ErreurMetier('ERREUR_INTERNE', "La mise en stock n'a rendu aucune ligne.");
          ligne = inseree;
        } catch (erreur) {
          if (estViolationCleUnique(erreur)) {
            throw new ErreurMetier(
              'VENTE_VEHICULE_STOCK_DEJA_EXISTANT',
              'Ce véhicule est déjà (ou a déjà été) mis en stock.',
            );
          }
          throw erreur;
        }

        const reponse = await this.assembler(tx, ctx, principal.role, ligne);
        return { statutHttp: 201, corps: new CollecteurAvertissements().envelopper(reponse) };
      },
    );
  }

  async obtenir(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    vehiculeId: string,
  ): Promise<ReponseVehiculeStock> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerVehiculeStock(tx, ctx, vehiculeId);
      return this.assembler(tx, ctx, role, ligne);
    });
  }

  /** `PATCH /vehicules/{vehiculeId}/stock` — `If-Match` obligatoire (correctif de périmètre du
   *  contrat, voir sa tête de fichier). `prixAchatCentimes` verrouillé dès `statutCommercial = 'vendu'`. */
  async modifier(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    vehiculeId: string,
    ifMatch: string | undefined,
    entree: EntreeModificationVehiculeStock,
  ): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
    const versionAttendue = extraireVersionETag(ifMatch);

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerVehiculeStockPourEcriture(tx, ctx, vehiculeId);

      if (versionAttendue !== ligne.version) {
        throw new ErreurMetier(
          'CONFLIT',
          'La version de la fiche stock a changé depuis la dernière lecture.',
          {
            detail: `version_attendue=${String(versionAttendue)};version_actuelle=${String(ligne.version)}`,
            actionsProposees: [{ code: 'RAFRAICHIR' }],
          },
        );
      }

      if (
        entree.prixAchatCentimes !== undefined &&
        entree.prixAchatCentimes !== ligne.prixAchatCentimes &&
        (ligne.statutCommercial === 'vendu' || ligne.statutCommercial === 'livre')
      ) {
        throw new ErreurMetier(
          'CONFLIT',
          'Le prix d’achat est verrouillé après la vente — une correction passe par une note interne.',
          {
            detail: `statutActuel=${ligne.statutCommercial}`,
            actionsProposees: [],
          },
        );
      }

      await tx
        .update(vehiculeStock)
        .set({
          ...(entree.dateEntreeStock !== undefined
            ? { dateEntreeStock: entree.dateEntreeStock }
            : {}),
          ...(entree.prixAchatCentimes !== undefined
            ? { prixAchatCentimes: entree.prixAchatCentimes }
            : {}),
          ...(entree.prixVenteAfficheCentimes !== undefined
            ? { prixVenteAfficheCentimes: entree.prixVenteAfficheCentimes ?? null }
            : {}),
          ...(entree.vendeurPrecedentAssujetti !== undefined
            ? { vendeurPrecedentAssujetti: entree.vendeurPrecedentAssujetti ?? null }
            : {}),
        })
        .where(
          sql`${vehiculeStock.tenantId} = ${ctx.tenantId} and ${vehiculeStock.id} = ${vehiculeId}`,
        );

      const misAJour = await chargerVehiculeStock(tx, ctx, vehiculeId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  /** `POST /vehicules/{vehiculeId}/stock/receptionner` — `en_commande -> disponible` (RV-09). */
  async receptionner(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    vehiculeId: string,
    _entree: EntreeReceptionnerVehiculeStock,
  ): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerVehiculeStockPourEcriture(tx, ctx, vehiculeId);
      if (ligne.statutCommercial !== 'en_commande') {
        throw new ErreurMetier(
          'CONFLIT',
          `Réception impossible : le véhicule n'est pas en commande (statut actuel : ${ligne.statutCommercial}).`,
          { actionsProposees: [{ code: 'RAFRAICHIR' }] },
        );
      }
      const maintenant = this.horloge.maintenant();
      await tx
        .update(vehiculeStock)
        .set({ statutCommercial: 'disponible', receptionneLe: maintenant })
        .where(
          sql`${vehiculeStock.tenantId} = ${ctx.tenantId} and ${vehiculeStock.id} = ${vehiculeId}`,
        );

      const misAJour = await chargerVehiculeStock(tx, ctx, vehiculeId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  /** `POST /vehicules/{vehiculeId}/stock/remettre-disponible` — `reserve -> disponible`, motif
   *  obligatoire (RV-10, correction exceptionnelle — le geste normal est un effet de bord de
   *  `POST /dossiers-vente/{id}/annuler|abandonner`). */
  async remettreDisponible(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    vehiculeId: string,
    entree: EntreeRemettreDisponibleVehiculeStock,
  ): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerVehiculeStockPourEcriture(tx, ctx, vehiculeId);
      if (ligne.statutCommercial !== 'reserve') {
        throw new ErreurMetier(
          'CONFLIT',
          `Remise à disponible impossible : le véhicule n'est pas réservé (statut actuel : ${ligne.statutCommercial}).`,
          { actionsProposees: [{ code: 'RAFRAICHIR' }] },
        );
      }
      await tx
        .update(vehiculeStock)
        .set({ statutCommercial: 'disponible', dernierMotifTransition: entree.motif })
        .where(
          sql`${vehiculeStock.tenantId} = ${ctx.tenantId} and ${vehiculeStock.id} = ${vehiculeId}`,
        );

      const misAJour = await chargerVehiculeStock(tx, ctx, vehiculeId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  /**
   * `POST /vehicules/{vehiculeId}/stock/marquer-vendu` — `reserve -> vendu` (RV-09), pose `venduLe`.
   *
   * **TROU COMBLÉ** (constaté en reprenant ce fichier) : `transition_autorisee` autorise déjà
   * `reserve -> vendu` en base (`migrations/0032_ventes.sql` §9, `exige_motif = false`), mais AUCUN
   * code de ce dépôt ne l'invoquait avant cette méthode — `POST /dossiers-vente/{id}/livrer`
   * (`service-dossier-vente.ts`) EXIGE ce statut sans qu'aucun chemin ne puisse jamais le produire,
   * bloquant tout dossier réel à `pret_a_livrer`.
   *
   * USAGE NORMAL : effet de bord PROGRAMMATIQUE de `facturation/` à l'émission de la facture
   * (RV-37) — `ServiceVehiculeStock` est exporté par `VentesModule` précisément pour cette
   * injection croisée ; le câblage réel côté `facturation/` reste À FAIRE par le propriétaire de ce
   * module (hors périmètre de cet agent), qui devra fournir un `motif` informatif (ex. « Facture
   * <numero> émise ») — la transition elle-même n'exige rien (`exige_motif = false`), mais ce
   * service garde un `motif` obligatoire pour un contrat UNIQUE entre l'usage normal et l'usage
   * exceptionnel (voir ci-dessous), plutôt que deux méthodes quasi identiques.
   *
   * Cet appel direct existe AUSSI pour la correction exceptionnelle (dossier orphelin,
   * resynchronisation, ou usage/test avant que le câblage facturation n'existe) — même patron que
   * `remettreDisponible` : motif obligatoire, droit `ventes.vehicule_stock.corriger`.
   */
  async marquerVendu(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    vehiculeId: string,
    entree: EntreeMarquerVenduVehiculeStock,
  ): Promise<ReponseAvecAvertissements<ReponseVehiculeStock>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerVehiculeStockPourEcriture(tx, ctx, vehiculeId);
      if (ligne.statutCommercial !== 'reserve') {
        throw new ErreurMetier(
          'CONFLIT',
          `Marquage vendu impossible : le véhicule n'est pas réservé (statut actuel : ${ligne.statutCommercial}).`,
          { actionsProposees: [{ code: 'RAFRAICHIR' }] },
        );
      }
      const maintenant = this.horloge.maintenant();
      await tx
        .update(vehiculeStock)
        .set({
          statutCommercial: 'vendu',
          venduLe: maintenant,
          dernierMotifTransition: entree.motif,
        })
        .where(
          sql`${vehiculeStock.tenantId} = ${ctx.tenantId} and ${vehiculeStock.id} = ${vehiculeId}`,
        );

      const misAJour = await chargerVehiculeStock(tx, ctx, vehiculeId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      const collecteur = new CollecteurAvertissements();
      await this.signalerDepotsPneusOuverts(tx, ctx, vehiculeId, collecteur);
      return collecteur.envelopper(reponse);
    });
  }

  /**
   * RPP-06 (`docs/specification-parc-et-hangar-pneus.md`) : la vente d'un véhicule ne transfère
   * JAMAIS automatiquement au nouveau propriétaire un éventuel dépôt de pneus qui lui est
   * rattaché — c'est un choix commercial (le vendeur peut les inclure ou les reprendre), jamais un
   * geste automatique sur un bien qui appartient au client. SIGNALEMENT, jamais un blocage : la
   * vente aboutit dans tous les cas, cette méthode n'ajoute qu'un avertissement.
   *
   * Lecture SEULE de `depot_pneus` (module `pneus/`, hors périmètre d'écriture de cet agent —
   * aucune mutation, aucune règle métier dupliquée depuis `pneus/service-depot-pneus.ts`) :
   * seulement l'existence de jeux encore ACTIFS (`en_depot`/`monte`/`a_relancer`, tout sauf le
   * statut TERMINAL `sorti`, RPP-05) pour ce véhicule. `vehiculeId` ici **est** `vehicule.id`
   * (voir la tête de fichier de `db/schema/ventes/vehicule-stock.ts` : `vehicule_stock` est une
   * extension 1:1 de `vehicule`, même identifiant), exactement la colonne que référence
   * `depot_pneus.vehicule_id`.
   *
   * Cas « aucun dépôt » : ne fait rien, n'ajoute aucun avertissement, ne lève jamais — c'est le
   * chemin normal de la quasi-totalité des ventes.
   */
  private async signalerDepotsPneusOuverts(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    vehiculeId: string,
    collecteur: CollecteurAvertissements,
  ): Promise<void> {
    const ouverts = await tx
      .select({ id: depotPneus.id, saison: depotPneus.saison, statut: depotPneus.statut })
      .from(depotPneus)
      .where(
        and(
          eq(depotPneus.tenantId, ctx.tenantId),
          eq(depotPneus.vehiculeId, vehiculeId),
          inArray(depotPneus.statut, ['en_depot', 'monte', 'a_relancer']),
        ),
      )
      .limit(10);

    if (ouverts.length === 0) return;

    collecteur.ajouter(
      'VEHICULE_DEPOTS_PNEUS_OUVERTS',
      `${ouverts.length} dépôt(s) de pneus encore ouvert(s) pour ce véhicule vendu — à traiter ` +
        `explicitement (garder, rendre au client, ou transférer au nouveau propriétaire), RPP-06.`,
      { depotsOuverts: ouverts },
    );
  }

  /**
   * `GET /vehicules-stock` — collection paginée par curseur (RV-01 → RV-14, priorité 4 du module).
   * Rend `VehiculeStockResume` (projection légère), contrat littéral : « embarquée dans
   * dossier-vente.ts ET les listes de véhicules en stock ».
   */
  async lister(
    ctx: ContexteTenant,
    filtres: FiltresVehiculesStock,
  ): Promise<PageCurseur<VehiculeStockResume>> {
    const definition = DEFINITIONS_TRI_VEHICULES_STOCK[filtres.tri];
    const idExpr = sql`vs.id`;
    const curseurDecode = decoderCurseurPourTri(filtres.curseur, filtres.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`vs.tenant_id = ${ctx.tenantId}`];
      if (filtres.siteId) conditions.push(sql`vs.site_id = ${filtres.siteId}`);
      if (filtres.provenance && filtres.provenance.length > 0) {
        conditions.push(
          sql`vs.provenance in (${sql.join(
            filtres.provenance.map((p) => sql`${p}`),
            sql`, `,
          )})`,
        );
      }
      if (filtres.statutCommercial && filtres.statutCommercial.length > 0) {
        conditions.push(
          sql`vs.statut::text in (${sql.join(
            filtres.statutCommercial.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      if (filtres.typeVehicule) {
        conditions.push(
          filtres.typeVehicule === 'vn'
            ? sql`(vs.provenance = 'neuf_constructeur' and v.date_1re_circulation is null)`
            : sql`(vs.provenance <> 'neuf_constructeur' or v.date_1re_circulation is not null)`,
        );
      }
      if (filtres.q) {
        const motif = `%${filtres.q}%`;
        conditions.push(sql`(
          v.marque ilike ${motif} or v.modele ilike ${motif} or v.version ilike ${motif}
          or v.vin ilike ${motif} or p.valeur ilike ${motif}
        )`);
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const requete = sql`
        select ${COLONNES_VEHICULE_STOCK_LISTE}, ${expressionTriValeur(definition)} as "triValeur"
          from public.vehicule_stock vs
          join public.vehicule v on v.tenant_id = vs.tenant_id and v.id = vs.id
          left join lateral (
            select vp.valeur, vp.canton from public.vehicule_plaque vp
             where vp.tenant_id = vs.tenant_id and vp.vehicule_id = vs.id and vp.au is null
             order by vp.du desc limit 1
          ) p on true
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${filtres.limite + 1}
      `;

      const resultat = await tx.execute<{
        id: string;
        tenantId: string;
        siteId: string;
        provenance: string;
        dateEntreeStock: string;
        prixAchatCentimes: number;
        prixVenteAfficheCentimes: number | null;
        statutCommercial: VehiculeStockResume['statutCommercial'];
        vendeurPrecedentAssujetti: boolean | null;
        origineRepriseDossierVenteId: string | null;
        dernierMotifTransition: string | null;
        // `timestamptz` lus par SQL brut (`tx.execute`) : le pilote `pg` les rend en CHAÎNE, pas en
        // `Date` (piège documenté dans le dépôt). Typer `Date` ici était le mensonge qui faisait
        // planter `calculerJoursStock` (`venduLe.getTime()`) en 500 dès qu'un véhicule était vendu.
        receptionneLe: string | null;
        reserveLe: string | null;
        venduLe: string | null;
        livreLe: string | null;
        version: number;
        creeLe: string;
        modifieLe: string;
        vMarque: string;
        vModele: string;
        vVersion: string | null;
        vVin: string | null;
        vDate1reCirculation: string | null;
        vIdentificationIncomplete: boolean;
        pValeur: string | null;
        pCanton: string | null;
        triValeur: string | number | null;
      }>(requete);
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > filtres.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, filtres.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];
      const maintenant = this.horloge.maintenant();

      const donnees = pageLignes.map((l) =>
        versVehiculeStockResume(
          {
            id: l.id,
            provenance: l.provenance,
            dateEntreeStock: l.dateEntreeStock,
            prixVenteAfficheCentimes: l.prixVenteAfficheCentimes,
            statutCommercial: l.statutCommercial,
            venduLe: l.venduLe,
          },
          {
            id: l.id,
            plaque: l.pValeur,
            canton: l.pCanton,
            designation: [l.vMarque, l.vModele, l.vVersion]
              .filter((v): v is string => Boolean(v))
              .join(' '),
            vin: l.vVin,
            premiereMiseEnCirculationLe: l.vDate1reCirculation,
            identificationIncomplete: l.vIdentificationIncomplete,
          },
          l.vDate1reCirculation,
          maintenant,
        ),
      );

      return {
        donnees,
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: filtres.tri,
                valeur: valeurCurseurDepuisTri(definition, derniere.triValeur),
                id: derniere.id,
              })
            : null,
        limite: filtres.limite,
      };
    });
  }

  private async assembler(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    ligne: LigneVehiculeStock,
  ): Promise<ReponseVehiculeStock> {
    const vehiculeLigne = await chargerVehiculeLigne(tx, ctx, ligne.id);
    const plaque = await chargerPlaqueCourante(tx, ctx, ligne.id);
    const vehiculeResume = construireVehiculeResume(vehiculeLigne, plaque);

    const journal = await this.audit.pourEntite(ctx, 'vehicule_stock', ligne.id);
    const dernier = journal.at(-1) ?? null;
    const modifiePar = await chargerResumeUtilisateur(tx, ctx, dernier?.utilisateurId ?? null);

    return versVehiculeStockResponse({
      ligne,
      vehicule: vehiculeResume,
      date1reCirculation: vehiculeLigne.date1reCirculation,
      role,
      maintenant: this.horloge.maintenant(),
      modifiePar,
    });
  }
}

/** `W/"<version>"` -> entier. `undefined`/format invalide -> `400 VALIDATION_ECHOUEE`, même patron
 *  que `atelier/service-or.ts::extraireVersionETag`. */
function extraireVersionETag(ifMatch: string | undefined): number {
  const correspondance = ifMatch ? /^W\/"(\d+)"$/.exec(ifMatch.trim()) : null;
  if (!correspondance?.[1]) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      'En-tête If-Match requis et doit porter la forme W/"<version>".',
      {
        erreurs: [
          { champ: 'If-Match', code: 'requis', message: 'En-tête If-Match manquant ou invalide.' },
        ],
      },
    );
  }
  return Number(correspondance[1]);
}

/** `23505` = `unique_violation` PostgreSQL — deux mises en stock concurrentes du même véhicule.
 *  Drizzle enveloppe systématiquement l'erreur `pg` brute dans une `DrizzleQueryError` qui ne porte
 *  `code` que sous `.cause` (jamais en surface) — `remonterCausePg` déballe cette chaîne avant
 *  comparaison. Voir `common/erreurs-pg/remonter-cause-pg.ts` pour le détail du défaut corrigé. */
function estViolationCleUnique(erreur: unknown): boolean {
  return remonterCausePg(erreur)?.code === '23505';
}

export { extraireVersionETag, estViolationCleUnique };
