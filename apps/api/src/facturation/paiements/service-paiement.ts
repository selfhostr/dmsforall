import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  EntreeAbandonnerAvance,
  EntreeCreationImputation,
  EntreeCreationPaiement,
  EntreeRembourserAvance,
  FiltresPaiements,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseImputationPaiement,
  ReponsePaiement,
} from '@dfa/shared';

import {
  enDate,
  JETON_DB,
  type AccesBase,
  type ContexteTenant,
  type TransactionDfa,
} from '../../db';
import {
  imputationPaiement,
  paiement,
  type LigneImputationPaiement,
  type LignePaiement,
} from '../../db/schema';
import { remonterCauseParCode } from '../../common/erreurs-pg';
import { ErreurMetier } from '../../common/erreurs';
import { Horloge } from '../../common/horloge/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../../common/idempotence';

import { verifierEspecesMultiple5 } from './arrondi-especes';
import { appliquerCompensationAvance, appliquerImputationsLettrage } from './imputations';
import {
  calculerMontantNonImputeCentimes,
  deviseFacturationDepuisBase,
  versImputation,
  versPaiement,
} from './mappeurs';
import {
  chargerArrondiEspecesActif,
  chargerPaiement,
  chargerPaiementPourEcriture,
  chargerResumesUtilisateurs,
  verifierClientExiste,
} from './paiement-requetes';
import {
  construireConditionKeysetPaiement,
  construireOrderByPaiement,
  decoderCurseurPourTriPaiement,
  definitionTriPaiement,
  encoderCurseurTrie,
  EXPRESSION_MONTANT_NON_IMPUTE,
} from './pagination-paiements';
import type { ParametresListePaiements } from './schemas';

type ReponsePaiementEnveloppe = ReponseAvecAvertissements<ReponsePaiement>;

/** Colonnes brutes de `public.paiement`, telles que rendues par le pilote `pg` sur `tx.execute()`
 *  — `bigint`/`timestamptz` en CHAÎNE (piège vérifié, voir `db/acces-amorcage.service.ts::enDate`
 *  et le commentaire de tête de ce module dans le rapport de livraison). Convertis explicitement
 *  avant tout usage, jamais passés tels quels à `versPaiement` (qui attend `LignePaiement`,
 *  produit par le query-builder Drizzle typé — `bigint`/`Date` déjà corrects). */
/**
 * `type`, PAS `interface` : un alias d'objet obtient un index signature implicite quand il est
 * vérifié contre une contrainte générique `Record<string, unknown>` (celle de `tx.execute<T>()`),
 * une `interface` ne l'obtient jamais — même patron que `LigneCandidatBrute`
 * (`clients/detection-doublons.ts`), `LigneOrDuClientBrute`
 * (`clients/service-client-ordres-reparation.ts`) et `LigneVehiculeResumeBrute`
 * (`clients/service-client-vehicules.ts`).
 */
type LignePaiementBrute = {
  readonly id: string;
  readonly tenant_id: string;
  readonly site_id: string;
  readonly date_valeur: string;
  readonly moyen: LignePaiement['moyen'];
  readonly montant_centimes: string;
  readonly devise: string;
  readonly payeur_client_id: string | null;
  readonly payeur_libelle: string;
  readonly reference_qr: string | null;
  readonly identifiant_transaction_banque: string | null;
  readonly source: LignePaiement['source'];
  readonly contre_passe_id: string | null;
  readonly cree_par_id: string | null;
  readonly cree_le: Date | string;
  readonly somme_reglement: string;
  readonly origine: LignePaiement['origine'];
  readonly numero_origine: string | null;
};

function ligneDepuisBrute(brute: LignePaiementBrute): LignePaiement {
  return {
    id: brute.id,
    tenantId: brute.tenant_id,
    siteId: brute.site_id,
    dateValeur: brute.date_valeur,
    moyen: brute.moyen,
    montantCentimes: BigInt(brute.montant_centimes),
    // Même garde que `mappeurs.ts::versPaiement` (`deviseFacturationDepuisBase`) : ce chemin
    // contourne le query-builder Drizzle typé (`tx.execute()` sur SQL brut), `brute.devise`
    // arrive donc en `string` non validé du pilote `pg` — une seule porte gardée, réutilisée ici
    // plutôt que dupliquée.
    devise: deviseFacturationDepuisBase(brute.devise, `paiement ${brute.id}`),
    payeurClientId: brute.payeur_client_id,
    payeurLibelle: brute.payeur_libelle,
    referenceQr: brute.reference_qr,
    identifiantTransactionBanque: brute.identifiant_transaction_banque,
    source: brute.source,
    contrePasseId: brute.contre_passe_id,
    origine: brute.origine,
    numeroOrigine: brute.numero_origine,
    exporteLe: null,
    exportId: null,
    creeParId: brute.cree_par_id,
    creeLe: enDate(brute.cree_le),
    modifieLe: enDate(brute.cree_le),
  };
}

/** SQLSTATE `23505` (unique_violation) — `identifiant_transaction_banque`. */
const SQLSTATE_UNICITE = '23505';

/**
 * `code` PostgreSQL d'une violation de contrainte `unique` (23505) — pilote `pg`.
 *
 * IMPORTANT : le pilote `pg` lève bien l'erreur brute avec `code` directement sur l'objet, mais
 * Drizzle (`pg-core/session.js`) l'enveloppe systématiquement dans une `DrizzleQueryError` qui
 * porte la brute sous `.cause` — jamais `code` en surface. Sans déballer `.cause`, cette fonction
 * ne reconnaît jamais rien et un doublon d'`identifiant_transaction_banque` retombe en
 * `ERREUR_INTERNE`/500 au lieu du `CONFLIT`/409 attendu. Déballage factorisé dans
 * `common/erreurs-pg/remonter-cause-pg.ts::remonterCauseParCode` — même patron que
 * `vehicules/erreurs-contraintes.ts::remonterCause`.
 */
function estViolationUnicite(erreur: unknown): boolean {
  return remonterCauseParCode(erreur, SQLSTATE_UNICITE) !== null;
}

@Injectable()
export class ServicePaiement {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
  ) {}

  /**
   * `POST /paiements` — encaissement + lettrage optionnel dans le même geste (RF-65, RF-69).
   * `Idempotency-Key` obligatoire : un rejeu réseau au comptoir ne doit jamais faire encaisser
   * deux fois le même geste (consigne explicite de la tâche).
   */
  async creer(
    ctx: ContexteTenant,
    entree: EntreeCreationPaiement,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponsePaiementEnveloppe }>> {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/paiements', cle: cleIdempotence, corps: entree },
      async (tx) => ({
        statutHttp: 201,
        corps: { donnees: await this.creerTx(tx, ctx, entree), avertissements: [] },
      }),
    );
  }

  /**
   * Cœur transactionnel de `creer()` : encaissement + lettrage optionnel, SANS enveloppe
   * d'idempotence. Réutilisé tel quel par `POST /ordres-reparation/{orId}/facturer-et-encaisser`
   * (qui porte sa propre clé d'idempotence pour le geste entier) — une seule implémentation des
   * barrières (montant strictement positif, doublon bancaire, lettrage).
   */
  async creerTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: EntreeCreationPaiement,
  ): Promise<ReponsePaiement> {
    // BARRIÈRE 1/3 (issue #9, GitHub — « un paiement négatif crédite une facture ») :
    // `POST /paiements` est le geste d'ENCAISSEMENT — MD-50 dit qu'un `paiement` PEUT être
    // signé négativement (remboursement/contre-passation), mais ce signe négatif est le
    // produit d'un geste métier DISTINCT, déjà modélisé et implémenté plus bas dans ce fichier
    // (`rembourser()`, RF-79 issue 1, MD-57) : il crée un paiement de sens opposé, plafonné au
    // solde réellement remboursable, tracé par `contrePasseId` vers l'avance d'origine — et
    // insère DIRECTEMENT en base sans jamais repasser par cette méthode `creer()`. Un montant
    // négatif saisi ICI n'aurait donc AUCUNE de ces garanties (pas d'origine, pas de plafond,
    // pas de traçabilité) : ce n'est pas un remboursement, c'est un trou.
    //
    // Le schéma partagé (`schemaCreationPaiement.montantCentimes: schemaCentimesTtc`,
    // `packages/shared/src/contrats/facturation/primitives.ts`) n'impose AUCUNE borne — signalé
    // pour resserrement côté contrat (hors périmètre `facturation/` de ce lot, voir le
    // rapport de livraison), corrigé ICI en attendant : la garde applicative est le premier
    // rempart, pas le seul (voir aussi `mappeurs.ts::calculerMontantNonImputeCentimes` et
    // `imputations.ts::verifierPaiementImputable` pour les deux suivants).
    if (entree.montantCentimes <= 0) {
      const negatif = entree.montantCentimes < 0;
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        negatif
          ? "Le montant d'un paiement créé via POST /paiements doit être strictement positif " +
              "— c'est un encaissement. Un remboursement se crée via " +
              'POST /paiements/{id}/rembourser (RF-79), jamais avec un montant négatif saisi ' +
              'directement.'
          : "Le montant d'un paiement ne peut pas être nul.",
        {
          erreurs: [
            {
              champ: 'montantCentimes',
              code: negatif ? 'montant_negatif' : 'montant_nul',
              message: negatif
                ? 'Montant strictement positif requis — utiliser POST /paiements/{id}/rembourser pour un remboursement.'
                : 'Montant non nul requis.',
            },
          ],
        },
      );
    }
    verifierEspecesMultiple5({
      moyenPaiement: entree.moyen,
      devise: entree.devise,
      arrondiEspecesActif:
        entree.moyen === 'especes' ? await chargerArrondiEspecesActif(tx, ctx) : true,
      montantCentimes: BigInt(entree.montantCentimes),
    });
    if (entree.payeurClientId) {
      await verifierClientExiste(tx, ctx, entree.payeurClientId);
    }

    let ligne: LignePaiement | undefined;
    try {
      [ligne] = await tx
        .insert(paiement)
        .values({
          tenantId: ctx.tenantId,
          siteId: entree.siteId,
          dateValeur: entree.dateValeur,
          moyen: entree.moyen,
          montantCentimes: BigInt(entree.montantCentimes),
          devise: entree.devise,
          payeurClientId: entree.payeurClientId ?? null,
          payeurLibelle: entree.payeurLibelle,
          identifiantTransactionBanque: entree.identifiantTransactionBanque ?? null,
          source: 'manuel',
          creeParId: ctx.utilisateurId,
        })
        .returning();
    } catch (erreur) {
      if (estViolationUnicite(erreur)) {
        throw new ErreurMetier(
          'CONFLIT',
          `Une transaction bancaire ${entree.identifiantTransactionBanque ?? ''} a déjà été enregistrée pour ce tenant.`,
        );
      }
      throw erreur;
    }
    if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de la création du paiement.');

    const imputations =
      entree.imputations.length > 0
        ? await appliquerImputationsLettrage(tx, ctx, ligne, entree.imputations)
        : [];

    const resumes = await chargerResumesUtilisateurs(tx, ctx, idsUtilisateurs(ligne, imputations));
    const reponse = versPaiement(ligne, imputations, resumes);
    return reponse;
  }

  async parId(ctx: ContexteTenant, paiementId: string): Promise<ReponsePaiement> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerPaiement(tx, ctx, paiementId);
      const imputations = await tx
        .select()
        .from(imputationPaiement)
        .where(
          and(
            eq(imputationPaiement.tenantId, ctx.tenantId),
            eq(imputationPaiement.paiementId, paiementId),
          ),
        )
        .orderBy(imputationPaiement.imputeLe);
      const resumes = await chargerResumesUtilisateurs(
        tx,
        ctx,
        idsUtilisateurs(ligne, imputations),
      );
      return versPaiement(ligne, imputations, resumes);
    });
  }

  /**
   * `GET /paiements` — collection paginée par curseur triable (`RF-72` : la liste « encaissements
   * à affecter », `nonImputeUniquement=true`, doit être vide en fin de journée). Requête SQL brute
   * (pas le query-builder Drizzle) pour porter l'expression de tri calculée
   * (`montantNonImputeCentimes`) et le sous-total `somme_reglement` en une seule passe — même
   * patron que `ServiceClient.lister` (`clients/service-client.ts`).
   */
  async lister(
    ctx: ContexteTenant,
    params: ParametresListePaiements,
  ): Promise<PageCurseur<ReponsePaiement>> {
    const definition = definitionTriPaiement(params.tri);
    const curseurDecode = decoderCurseurPourTriPaiement(params.curseur, params.tri);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`p.tenant_id = ${ctx.tenantId}`];

      if (params.siteId) conditions.push(sql`p.site_id = ${params.siteId}`);
      if (params.moyen && params.moyen.length > 0) {
        // DÉFAUT CONSTATÉ (corrigé, balayage du 27.08.2026) : `p.moyen::text in (...)` castait
        // l'enum en `text` avant comparaison, opaque aux statistiques PostgreSQL de la colonne —
        // même défaut que `client.statut` (`service-client.ts`). Comparaison native sur l'enum.
        conditions.push(sql`p.moyen = any(${sql.param(params.moyen)}::public.moyen_paiement[])`);
      }
      if (params.payeurClientId)
        conditions.push(sql`p.payeur_client_id = ${params.payeurClientId}`);
      if (params.documentId) {
        conditions.push(sql`
          exists (
            select 1 from public.imputation_paiement ip2
             where ip2.tenant_id = p.tenant_id and ip2.paiement_id = p.id and ip2.document_id = ${params.documentId}
          )
        `);
      }
      if (params.dateValeurDu) conditions.push(sql`p.date_valeur >= ${params.dateValeurDu}`);
      if (params.dateValeurAu) conditions.push(sql`p.date_valeur <= ${params.dateValeurAu}`);
      if (params.nonImputeUniquement) {
        // Même expression que le tri `montantNonImputeCentimes:desc` (`EXPRESSION_MONTANT_NON_
        // IMPUTE`, `pagination-paiements.ts`) — voir son commentaire (issue #9) : un remboursement
        // (`montant_centimes <= 0`, MD-57) ne doit JAMAIS apparaître dans l'écran « encaissements à
        // affecter » (RF-72), qui doit être vide en fin de journée.
        conditions.push(sql`${EXPRESSION_MONTANT_NON_IMPUTE} > 0`);
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeysetPaiement(definition, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const requete = sql`
        select p.*, coalesce(ri.somme_reglement, 0) as somme_reglement
          from public.paiement p
          left join lateral (
            select sum(abs(ip.montant_centimes)) as somme_reglement
              from public.imputation_paiement ip
             where ip.tenant_id = p.tenant_id and ip.paiement_id = p.id and ip.nature = 'reglement'
          ) ri on true
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderByPaiement(definition)}
         limit ${params.limite + 1}
      `;

      const resultat = await tx.execute<LignePaiementBrute>(requete);
      const lignesBrutes = resultat.rows;
      const aUnePageSuivante = lignesBrutes.length > params.limite;
      const pageLignesBrutes = aUnePageSuivante
        ? lignesBrutes.slice(0, params.limite)
        : lignesBrutes;
      const pageLignes = pageLignesBrutes.map(ligneDepuisBrute);

      const paiementIds = pageLignes.map((l) => l.id);
      const imputationsPage =
        paiementIds.length > 0
          ? await tx
              .select()
              .from(imputationPaiement)
              .where(
                and(
                  eq(imputationPaiement.tenantId, ctx.tenantId),
                  inArray(imputationPaiement.paiementId, paiementIds),
                ),
              )
              .orderBy(imputationPaiement.imputeLe)
          : [];
      const imputationsParPaiement = new Map<string, LigneImputationPaiement[]>();
      for (const imp of imputationsPage) {
        const liste = imputationsParPaiement.get(imp.paiementId) ?? [];
        liste.push(imp);
        imputationsParPaiement.set(imp.paiementId, liste);
      }

      const idsAResoudre = new Set<string>();
      for (const l of pageLignes) {
        const imps = imputationsParPaiement.get(l.id) ?? [];
        for (const id of idsUtilisateurs(l, imps)) idsAResoudre.add(id);
      }
      const resumes = await chargerResumesUtilisateurs(tx, ctx, idsAResoudre);

      const derniereBrute = pageLignesBrutes[pageLignesBrutes.length - 1];

      return {
        donnees: pageLignes.map((l) =>
          versPaiement(l, imputationsParPaiement.get(l.id) ?? [], resumes),
        ),
        curseurSuivant:
          aUnePageSuivante && derniereBrute
            ? encoderCurseurTrie({
                tri: params.tri,
                valeur: valeurCurseurBrute(derniereBrute, params.tri),
                id: derniereBrute.id,
              })
            : null,
        limite: params.limite,
      };
    });
  }

  /**
   * `POST /paiements/{id}/imputations` — affecte un paiement déjà enregistré (acompte non imputé,
   * trop-perçu réaffecté). `Idempotency-Key` obligatoire : DÉCISION DE SÉCURITÉ de ce lot, PAS
   * une exigence littérale du contrat gelé (`schemaCreationImputation` n'en fait pas mention,
   * contrairement à `schemaCreationPaiement` et `schemaRembourserAvance`) — une imputation double
   * sur retry réseau lettrerait deux fois le même encaissement. Signalé au rapport de livraison
   * comme écart à faire confirmer par l'équipe API/l'équipe facturation, jamais improvisé en silence.
   */
  async ajouterImputation(
    ctx: ContexteTenant,
    paiementId: string,
    entree: EntreeCreationImputation,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponsePaiementEnveloppe }>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/paiements/{id}/imputations',
        cle: cleIdempotence,
        corps: { paiementId, entree },
      },
      async (tx) => {
        const paiementLigne = await chargerPaiementPourEcriture(tx, ctx, paiementId);
        const nouvelles = await appliquerImputationsLettrage(tx, ctx, paiementLigne, [entree]);

        const imputations = await tx
          .select()
          .from(imputationPaiement)
          .where(
            and(
              eq(imputationPaiement.tenantId, ctx.tenantId),
              eq(imputationPaiement.paiementId, paiementId),
            ),
          )
          .orderBy(imputationPaiement.imputeLe);
        const resumes = await chargerResumesUtilisateurs(
          tx,
          ctx,
          idsUtilisateurs(paiementLigne, imputations),
        );
        const reponse = versPaiement(paiementLigne, imputations, resumes);
        return {
          statutHttp: nouvelles.length > 0 ? 201 : 200,
          corps: { donnees: reponse, avertissements: [] },
        };
      },
    );
  }

  /**
   * `POST /paiements/{id}/rembourser` — RF-79 issue 1 : crée un paiement de sens opposé
   * (`contrePasseId`), jamais une correction en place (MD-52, MD-57). `Idempotency-Key`
   * obligatoire (c'est une création de paiement, exigence littérale du contrat).
   */
  async rembourser(
    ctx: ContexteTenant,
    paiementId: string,
    entree: EntreeRembourserAvance,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponsePaiementEnveloppe }>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/paiements/{id}/rembourser',
        cle: cleIdempotence,
        corps: { paiementId, entree },
      },
      async (tx) => {
        const original = await chargerPaiementPourEcriture(tx, ctx, paiementId);
        const imputationsOriginal = await tx
          .select()
          .from(imputationPaiement)
          .where(
            and(
              eq(imputationPaiement.tenantId, ctx.tenantId),
              eq(imputationPaiement.paiementId, paiementId),
            ),
          );
        const nonImpute = calculerMontantNonImputeCentimes(
          original.montantCentimes,
          imputationsOriginal,
        );

        // DÉFAUT AUDIT : `nonImpute` ne décroît JAMAIS quand on rembourse — un remboursement crée un
        // paiement de sens opposé (`contrePasseId = original.id`), il n'écrit AUCUNE imputation sur
        // l'original. Contrôler `montant > nonImpute` seul laissait donc passer autant de
        // remboursements de N ct qu'on voulait (reproduit : 3 × 5000 ct pour 5000 ct dus). Le
        // montant réellement remboursable est l'avance non imputée MINUS ce qui a déjà été remboursé,
        // c.-à-d. la somme (en valeur absolue) des contre-passes déjà rattachées à ce paiement.
        //
        // Concurrence : `chargerPaiementPourEcriture` a verrouillé l'original `for update` — deux
        // remboursements simultanés du même paiement se sérialisent sur ce verrou, le second ne lisant
        // `dejaRembourse` qu'après le commit du premier. Aucun des deux ne peut donc dépasser le solde.
        const [agregatRembourse] = await tx
          .select({
            total: sql<string>`coalesce(sum(abs(${paiement.montantCentimes})), 0)`,
          })
          .from(paiement)
          .where(and(eq(paiement.tenantId, ctx.tenantId), eq(paiement.contrePasseId, paiementId)));
        const dejaRembourse = BigInt(agregatRembourse?.total ?? '0');
        const remboursable = nonImpute - dejaRembourse > 0n ? nonImpute - dejaRembourse : 0n;

        if (BigInt(entree.montantCentimes) > remboursable) {
          throw new ErreurMetier(
            'IMPUTATION_MONTANT_EXCEDENTAIRE',
            `Le remboursement demandé (${entree.montantCentimes} ct) dépasse le montant remboursable ` +
              `(${remboursable.toString()} ct) sur le paiement ${paiementId} — avance non imputée ` +
              `${nonImpute.toString()} ct, déjà remboursé ${dejaRembourse.toString()} ct.`,
          );
        }

        const [contrePasse] = await tx
          .insert(paiement)
          .values({
            tenantId: ctx.tenantId,
            siteId: original.siteId,
            dateValeur: this.horloge.maintenant().toISOString().slice(0, 10),
            // MD-57 : remboursement toujours par virement, montant NÉGATIF, jamais un UPDATE.
            moyen: 'virement',
            montantCentimes: -BigInt(entree.montantCentimes),
            devise: original.devise,
            payeurClientId: original.payeurClientId,
            payeurLibelle: original.payeurLibelle,
            identifiantTransactionBanque: entree.referenceVirement ?? null,
            source: 'manuel',
            contrePasseId: original.id,
            creeParId: ctx.utilisateurId,
          })
          .returning();
        if (!contrePasse)
          throw new ErreurMetier('ERREUR_INTERNE', 'Échec de la création du remboursement.');

        const resumes = await chargerResumesUtilisateurs(tx, ctx, idsUtilisateurs(contrePasse, []));
        const reponse = versPaiement(contrePasse, [], resumes);
        return { statutHttp: 201, corps: { donnees: reponse, avertissements: [] } };
      },
    );
  }

  /**
   * `POST /paiements/{id}/abandonner` — RF-79 issue 3 : imputation `compensation` en faveur du
   * garage sur un document de régularisation désigné. `Idempotency-Key` obligatoire — MÊME
   * décision de sécurité que `ajouterImputation` (voir son commentaire), et pour la même raison :
   * un geste qui renonce à rendre de l'argent au client ne doit jamais s'exécuter deux fois sur un
   * retry.
   */
  async abandonner(
    ctx: ContexteTenant,
    paiementId: string,
    entree: EntreeAbandonnerAvance,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponsePaiementEnveloppe }>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/paiements/{id}/abandonner',
        cle: cleIdempotence,
        corps: { paiementId, entree },
      },
      async (tx) => {
        const paiementAvance = await chargerPaiementPourEcriture(tx, ctx, paiementId);
        await appliquerCompensationAvance(
          tx,
          ctx,
          paiementAvance,
          entree.documentRegularisationId,
          entree.montantCentimes,
        );

        const imputations = await tx
          .select()
          .from(imputationPaiement)
          .where(
            and(
              eq(imputationPaiement.tenantId, ctx.tenantId),
              eq(imputationPaiement.paiementId, paiementId),
            ),
          )
          .orderBy(imputationPaiement.imputeLe);
        const resumes = await chargerResumesUtilisateurs(
          tx,
          ctx,
          idsUtilisateurs(paiementAvance, imputations),
        );
        const reponse = versPaiement(paiementAvance, imputations, resumes);
        return { statutHttp: 200, corps: { donnees: reponse, avertissements: [] } };
      },
    );
  }
}

function idsUtilisateurs(
  ligne: LignePaiement,
  imputations: readonly LigneImputationPaiement[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (ligne.creeParId) ids.add(ligne.creeParId);
  for (const i of imputations) {
    if (i.imputeParId) ids.add(i.imputeParId);
  }
  return ids;
}

function valeurCurseurBrute(
  ligne: LignePaiementBrute,
  tri: FiltresPaiements['tri'],
): string | number {
  if (tri === 'montantNonImputeCentimes:desc') {
    // Miroir JS de `EXPRESSION_MONTANT_NON_IMPUTE` (`pagination-paiements.ts`) — DOIT rester
    // identique, sous peine de fabriquer un curseur v2 dont la valeur ne correspond plus à
    // l'expression triée en base (une régression de pagination, pas de sécurité argent, mais le
    // même principe « une seule formule, jamais deux qui divergent » — issue #9).
    const montant = BigInt(ligne.montant_centimes);
    if (montant <= 0n) return 0;
    const nonImpute = montant - BigInt(ligne.somme_reglement);
    return Number(nonImpute > 0n ? nonImpute : 0n);
  }
  return ligne.date_valeur;
}

// Ré-exporté pour la lisibilité du contrôleur (typage de la réponse d'imputation isolée, si un
// futur écran en a besoin sans recharger tout le paiement).
export type { ReponseImputationPaiement };
export { versImputation };
