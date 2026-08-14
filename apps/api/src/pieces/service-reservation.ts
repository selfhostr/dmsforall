import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  EntreeLiberationReservation,
  FiltresReservations,
  MotifLiberationReservation,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseReservationPiece,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import type { LigneReservationPiece } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';

import { versReservationResponse } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';

/** `LigneReservationPiece` (Drizzle, `reservation_piece` seule) enrichie des colonnes jointes par
 *  `COLONNES_RESERVATION_ALIASEES`/`JOINTURES_RESERVATION` — voir leur doc respective. */
type LigneReservationPieceEnrichie = LigneReservationPiece & {
  readonly articleNumero: string;
  readonly articleDesignation: string;
  readonly ordreReparationNumero: string;
};

const DEFINITIONS_TRI_RESERVATIONS: Readonly<Record<FiltresReservations['tri'], DefinitionTri>> = {
  'creeLe:desc': { expression: sql`r.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`r.cree_le`, sens: 'asc', nullable: false, temporel: true },
};

/**
 * DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut n°3) : `a.numero_article`/`a.designation` et
 * `o.numero` rejoints EN PLUS des colonnes brutes de `reservation_piece` — sans quoi la vue
 * transverse (`GET /reservations`) ne pouvait afficher que des identifiants opaques. Toute requête
 * qui utilise cette constante DOIT joindre `public.article a` et `public.ordre_reparation o` sur
 * `(tenant_id, id)` (voir `lister`/`chargerOu404`/`chargerPourVerrouOu404` ci-dessous) —
 * `numero_article` reste `coalesce()`é à `''` (nullable en base, même doctrine que
 * `service-stock.ts::reapprovisionnement`).
 */
const COLONNES_RESERVATION_ALIASEES = sql`
  r.id as "id", r.article_id as "articleId", coalesce(a.numero_article, '') as "articleNumero",
  a.designation as "articleDesignation", r.site_id as "siteId", r.ligne_or_id as "ligneOrId",
  r.ordre_reparation_id as "ordreReparationId", o.numero as "ordreReparationNumero",
  r.quantite_millieme as "quantiteMillieme",
  r.statut as "statut", r.cree_le as "creeLe", r.satisfaite_le as "satisfaiteLe",
  r.mouvement_sortie_id as "mouvementSortieId", r.liberee_le as "libereeLe",
  r.motif_liberation as "motifLiberation", r.motif_liberation_texte as "motifLiberationTexte",
  r.liberee_par_utilisateur_id as "libereeParUtilisateurId"
`;

/** Jointures REQUISES par `COLONNES_RESERVATION_ALIASEES` — factorisée pour ne jamais diverger
 *  entre les trois requêtes qui la consomment. */
const JOINTURES_RESERVATION = sql`
  join public.article a on a.tenant_id = r.tenant_id and a.id = r.article_id
  join public.ordre_reparation o on o.tenant_id = r.tenant_id and o.id = r.ordre_reparation_id
`;

/**
 * Service réservation (RP-19 → RP-25, §6.3) — LE cœur du sujet, priorité 4. La CRÉATION n'a pas
 * de méthode ici : elle naît toujours comme effet de bord de `POST /ordres-reparation/{orId}/lignes`
 * (`atelier/ligne.ts`, GELÉ, hors périmètre — le trigger `reservation_piece_verrouiller_stock`,
 * 0026, porte la garantie de concurrence `CP-02` à l'INSERT). Ce service couvre la lecture
 * transverse et les deux actions nommées de la machine à états (`satisfaire`, `liberer`).
 */
@Injectable()
export class ServiceReservation {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    params: FiltresReservations,
  ): Promise<PageCurseur<ReponseReservationPiece>> {
    const definition = DEFINITIONS_TRI_RESERVATIONS[params.tri];
    const idExpr = sql`r.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_RESERVATIONS,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`r.tenant_id = ${ctx.tenantId}`];
      if (params.articleId) conditions.push(sql`r.article_id = ${params.articleId}`);
      if (params.siteId) conditions.push(sql`r.site_id = ${params.siteId}`);
      if (params.ordreReparationId)
        conditions.push(sql`r.ordre_reparation_id = ${params.ordreReparationId}`);
      if (params.statut && params.statut.length > 0) {
        conditions.push(
          sql`r.statut::text in (${sql.join(
            params.statut.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneReservationPieceEnrichie & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_RESERVATION_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.reservation_piece r
          ${JOINTURES_RESERVATION}
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versReservationResponse(l)),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: params.tri,
                valeur: valeurCurseurDepuisTri(definition, derniere.triValeur),
                id: derniere.id,
              })
            : null,
        limite: params.limite,
      };
    });
  }

  /**
   * `POST /reservations/{id}/satisfaire` — RP-21 : le magasinier remet PHYSIQUEMENT la pièce.
   * Ouvre SA PROPRE transaction — entrypoint HTTP autonome. Voir `satisfaireTx` pour la logique et
   * pour la variante composable (dette technique soldée, atelier ↔ pièces, rapport de livraison
   * étape 3-4 : `AccesBase.enTenant`, appelé depuis l'intérieur d'un `tx` déjà ouvert, acquiert
   * quand même une connexion NEUVE et fait son propre BEGIN/COMMIT — aucune atomicité réelle avec
   * l'appelant. `satisfaireTx`/`satisfairePourLigneTx` reçoivent un `tx` déjà ouvert, en PREMIER
   * paramètre, même convention que les helpers `chargerXxx`/`listerXxx` de tout le dépôt).
   */
  async satisfaire(ctx: ContexteTenant, reservationId: string): Promise<ReponseReservationPiece> {
    return this.acces.enTenant(ctx, (tx) => this.satisfaireTx(tx, ctx, reservationId));
  }

  /**
   * Variante composable de `satisfaire`, pour un appelant qui possède déjà un `tx` ouvert (ex.
   * `ServiceLigneOr.marquerRealisee`) et doit que la sortie de stock commite ou échoue DANS LA MÊME
   * transaction que son propre changement d'état. `select … for update` sur la réservation
   * elle-même AVANT tout, pour qu'un double-appel concurrent (deux magasiniers sur le même
   * comptoir) ne puisse jamais générer deux mouvements de sortie pour la même réservation — le
   * second attend, relit `statut = 'satisfaite'` et refuse proprement (`409
   * RESERVATION_TRANSITION_INTERDITE`).
   */
  async satisfaireTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    reservationId: string,
  ): Promise<ReponseReservationPiece> {
    const ligne = await this.chargerPourVerrouOu404(tx, ctx, reservationId);
    this.verifierActiveOu409(ligne);
    return this.appliquerSatisfaction(tx, ctx, ligne);
  }

  /**
   * RP-21, appelée par `ServiceLigneOr.marquerRealisee` (`atelier/`) : satisfait la réservation
   * `active` de la ligne d'OR `ligneOrId` s'il y en a une, sous verrou (même garantie que
   * `satisfaireTx`, mais recherchée par `ligne_or_id` plutôt que par `id` de réservation — l'appelant
   * atelier ne connaît que la ligne, pas l'identifiant de la réservation). Silencieuse (`null`) si
   * aucune réservation active n'existe (jamais créée, stock insuffisant à la pose (`blocage =
   * 'pieces'`, RP-24), ou déjà `satisfaite`/`liberee`) — il n'y a alors rien à satisfaire, pas une
   * anomalie.
   */
  async satisfairePourLigneTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligneOrId: string,
  ): Promise<ReponseReservationPiece | null> {
    const resultat = await tx.execute<LigneReservationPieceEnrichie>(sql`
      select ${COLONNES_RESERVATION_ALIASEES} from public.reservation_piece r
      ${JOINTURES_RESERVATION}
       where r.tenant_id = ${ctx.tenantId} and r.ligne_or_id = ${ligneOrId} and r.statut = 'active'
       for update
    `);
    const ligne = resultat.rows[0];
    if (!ligne) return null;
    return this.appliquerSatisfaction(tx, ctx, ligne);
  }

  /**
   * Cœur partagé de `satisfaireTx`/`satisfairePourLigneTx` : `ligne` DOIT déjà être verrouillée
   * (`for update`) et `statut = 'active'` — aucune re-vérification ici.
   *
   * DÉFAUT CORRIGÉ (mesuré en exécution — `pont-atelier-pieces.spec.ts`, section « atomicité
   * réelle », réservation à 100% du disponible) : cette méthode écrit `stock_article` en DEUX
   * temps, chacun dans sa PROPRE instruction SQL, séparés par la FK `reservation_piece_fk_
   * mouvement_sortie` (0026) qui impose que le mouvement de sortie existe déjà AVANT que la
   * réservation puisse le référencer :
   *   1. INSERT mouvement_stock('sortie_or', -Q) -> stock_article.physique -= Q (trigger 0025/0040)
   *   2. UPDATE reservation_piece -> statut='satisfaite' -> stock_article.reservee -= Q (trigger 0026)
   * `stock_article_reservee_leq_physique_chk` (0025) est une CHECK — JAMAIS DEFERRABLE en
   * PostgreSQL (voir 0040, qui documente déjà ce piège pour un cas voisin) — donc évaluée
   * IMMÉDIATEMENT à la fin de CHAQUE instruction, jamais à la fin de la transaction. Entre 1. et
   * 2., `reservee` porte encore SON ANCIENNE valeur alors que `physique` a DÉJÀ baissé : dès que
   * `Q` dépasse la moitié du disponible que CETTE réservation occupe seule (le cas le plus
   * commun étant Q = disponible, « on utilise la dernière pièce »), l'étape 1 fait passer
   * `physique` EN DESSOUS de `reservee` — PostgreSQL annule alors TOUTE la transaction, alors même
   * que l'état FINAL (après les deux écritures) est parfaitement valide. Reproduit par isolation
   * SQL directe (rapport de livraison) : l'INSERT seul échoue avec ce SQLSTATE `23514` ; une
   * fois `reservee` déjà réduite avant l'INSERT, la séquence complète commit sans erreur.
   *
   * CORRECTIF — palier (« headroom ») temporaire sur `quantite_physique_millieme`, STRICTEMENT
   * interne à cette méthode et à CETTE transaction, jamais visible d'aucune autre (verrou de ligne
   * déjà posé — `for update` — par `chargerPourVerrouOu404`/`satisfairePourLigneTx` ; MVCC empêche
   * toute lecture externe d'un état intermédiaire non commité) :
   *   a. `physique += Q` AVANT l'INSERT du mouvement — augmenter `physique` ne peut JAMAIS violer
   *      `reservee <= physique`.
   *   b. le mouvement s'insère alors sans risque : `physique` retombe à SA valeur d'avant cette
   *      méthode, `reservee` inchangé — c'est EXACTEMENT l'invariant qui tenait déjà (ligne
   *      `stock_article` existante, donc `reservee <= physique` par construction).
   *   c. la transition officielle libère `reservee` (trigger 0026) sans risque, pour la même
   *      raison (`reservee` ne peut que DIMINUER : décroître ne menace jamais `<=`).
   *   d. `physique -= Q` retire le palier : l'état final est EXACTEMENT `physique_avant - Q`,
   *      `reservee_avant - Q` — identique à ce qu'une écriture directe unique (impossible ici,
   *      voir ci-dessus) aurait produit.
   * (a) et (d) s'ANNULENT TOUJOURS entre eux DANS LA MÊME transaction : soit elle commit et l'état
   * persisté est cohérent avec le SEUL mouvement réellement inséré (aucune dérive du solde dérivé
   * par rapport au grand livre `mouvement_stock`), soit elle échoue et PostgreSQL annule tout, y
   * compris le palier. Prouvé par isolation SQL directe (rapport de livraison) : la séquence
   * complète (a→b→c→d) commit et rend `physique`/`reservee` EXACTS.
   *
   * CORRECTIF STRUCTUREL PRÉFÉRABLE, SIGNALÉ PAS APPLIQUÉ (migrations gelées pour cette tâche,
   * `0045` déjà prise et invalide) : faire porter la libération de `reservee` par LE MÊME trigger
   * que celui qui décrémente `physique` (`mouvement_stock_appliquer_physique`/
   * `stock_article_appliquer_delta`, 0025/0040) quand `mouvement_stock.reservation_id` est
   * renseigné sur un `sortie_or`, et retirer cette responsabilité de `reservation_piece_transition`
   * pour la branche `satisfaite` (la garder pour `liberee`, qui ne crée jamais de mouvement) — un
   * SEUL UPDATE sur `stock_article` verrait alors l'état FINAL fusionné, jamais un état
   * intermédiaire, et cette méthode n'aurait plus besoin du palier ci-dessus.
   */
  private async appliquerSatisfaction(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneReservationPiece,
  ): Promise<ReponseReservationPiece> {
    await this.ajusterPhysiqueSansMouvement(tx, ctx, ligne, ligne.quantiteMillieme);

    const resultatMouvement = await tx.execute<{ id: string }>(sql`
      insert into public.mouvement_stock
        (tenant_id, article_id, type, quantite_millieme, site_id, auteur_id, ligne_or_id, reservation_id)
      values
        (${ctx.tenantId}, ${ligne.articleId}, 'sortie_or', ${-ligne.quantiteMillieme}, ${ligne.siteId},
         ${ctx.utilisateurId}, ${ligne.ligneOrId}, ${ligne.id})
      returning id as "id"
    `);
    const mouvementId = resultatMouvement.rows[0]?.id;
    if (!mouvementId)
      throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du mouvement de sortie.');

    await tx.execute(sql`
      update public.reservation_piece
         set statut = 'satisfaite', satisfaite_le = now(), mouvement_sortie_id = ${mouvementId}
       where tenant_id = ${ctx.tenantId} and id = ${ligne.id}
    `);

    await this.ajusterPhysiqueSansMouvement(tx, ctx, ligne, -ligne.quantiteMillieme);

    const ligneMaj = await this.chargerOu404(tx, ctx, ligne.id);
    return versReservationResponse(ligneMaj);
  }

  /**
   * Palier temporaire sur `quantite_physique_millieme`, JAMAIS sur `quantite_reservee_millieme`
   * (voir la docstring d'`appliquerSatisfaction` ci-dessus pour le raisonnement complet) — les deux
   * appels de cette méthode depuis `appliquerSatisfaction` (+Q puis -Q) s'annulent TOUJOURS avant
   * la fin de la transaction. AUCUN mouvement fictif : `mouvement_stock` (le grand livre auditable,
   * RP-16→RP-18) n'enregistre QUE le mouvement RÉEL inséré par `appliquerSatisfaction` — ce palier
   * ne lui correspond à rien de physique et ne doit JAMAIS y apparaître.
   */
  private async ajusterPhysiqueSansMouvement(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneReservationPiece,
    deltaMillieme: number,
  ): Promise<void> {
    await tx.execute(sql`
      update public.stock_article
         set quantite_physique_millieme = quantite_physique_millieme + ${deltaMillieme}
       where tenant_id = ${ctx.tenantId} and article_id = ${ligne.articleId} and site_id = ${ligne.siteId}
    `);
  }

  /**
   * Cascade déclenchée par `ServiceMouvement.creerMouvementSortie` (`casse`/`perte`, `forcer:
   * true`, RP-15/PP-02, 0047) quand le mouvement forcé ferait passer `quantite_physique_millieme`
   * SOUS `quantite_reservee_millieme` — invariant que `stock_article_reservee_leq_physique_chk`
   * (0025/0047 : `reservee <= greatest(physique, 0)`) refuse INCONDITIONNELLEMENT, `forcer` ou
   * pas. `ligne`/`ctx` restent verrouillés par l'appelant (`ServiceStock.chargerPourVerrou` sur
   * `stock_article`, avant que ce mouvement n'existe) — cette méthode n'acquiert QUE le verrou des
   * lignes `reservation_piece` qu'elle va libérer, jamais celui de `stock_article` lui-même.
   *
   * ORDRE — les réservations les PLUS RÉCENTES du (article, site) sautent EN PREMIER
   * (`order by cree_le desc`). Arbitrage assumé, aucune règle métier écrite ne le impose : une
   * réservation ANCIENNE porte un OR ouvert depuis plus longtemps — la casser en dernier limite
   * le risque de rouvrir un dossier que le client croit déjà avancé. Symétriquement, la
   * réservation la plus RÉCENTE est, en moyenne, celle dont le travail a le moins progressé et
   * dont le report perturbe le moins l'atelier. Signalé au rapport de livraison pour arbitrage
   * définitif si un besoin réel contredit cette hypothèse (ex. priorité par date de rendez-vous
   * client, information que cette méthode ne lit pas aujourd'hui).
   *
   * LIBÉRATION TOTALE, JAMAIS PARTIELLE — `reservation_piece.quantite_millieme` est FIGÉ à la
   * création (§6.3 : la seule évolution possible est la TRANSITION `active -> {satisfaite,
   * liberee}`, aucune colonne ni trigger ne réduit la quantité d'une réservation existante) : une
   * réservation amputée n'est donc PAS représentable dans ce modèle. Cette cascade libère des
   * réservations ENTIÈRES jusqu'à couvrir `quantiteACouvrirMillieme`, quitte à libérer LÉGÈREMENT
   * plus que le strict déficit (le reliquat retourne au disponible commun de l'article/site,
   * jamais perdu) — jamais une fraction d'une réservation.
   *
   * TERMINAISON GARANTIE : `quantite_reservee_millieme` est, par construction (0026 §tête), TOUJOURS
   * exactement la somme des `quantite_millieme` des réservations `active` de ce (article, site) —
   * libérer la totalité d'entre elles ramène donc TOUJOURS `reservee` à 0, qui satisfait
   * `reservee <= greatest(physique, 0)` quel que soit `physique`. La boucle ne peut donc jamais
   * s'arrêter faute de réservations tout en laissant l'invariant violé.
   *
   * Rend le détail de ce qui a sauté ([] si rien n'a dû l'être) — à charge de l'appelant de
   * journaliser/avertir (RP-15 : « forçage explicite et journalisé »).
   */
  async libererPourCascadeForcageTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
    quantiteACouvrirMillieme: number,
  ): Promise<
    readonly {
      readonly id: string;
      readonly ligneOrId: string;
      readonly ordreReparationId: string;
      readonly quantiteMillieme: number;
    }[]
  > {
    if (quantiteACouvrirMillieme <= 0) return [];

    const resultat = await tx.execute<{
      id: string;
      ligneOrId: string;
      ordreReparationId: string;
      quantiteMillieme: number;
    }>(sql`
      select r.id as "id", r.ligne_or_id as "ligneOrId", r.ordre_reparation_id as "ordreReparationId",
             r.quantite_millieme as "quantiteMillieme"
        from public.reservation_piece r
       where r.tenant_id = ${ctx.tenantId} and r.article_id = ${articleId} and r.site_id = ${siteId}
         and r.statut = 'active'
       order by r.cree_le desc, r.id desc
       for update
    `);

    const liberees: {
      id: string;
      ligneOrId: string;
      ordreReparationId: string;
      quantiteMillieme: number;
    }[] = [];
    let couvert = 0;
    // eslint-disable-next-line no-await-in-loop -- lot borné (RP-19 : au plus une réservation par
    // ligne d'OR, un (article, site) n'en accumule jamais un volume déraisonnable) — même doctrine
    // que `libererToutesActivesPourOrTx` ci-dessus.
    for (const reservation of resultat.rows) {
      if (couvert >= quantiteACouvrirMillieme) break;
      await this.ecrireLiberation(tx, ctx, reservation.id, 'liberation_forcage_stock', null, null);
      liberees.push(reservation);
      couvert += reservation.quantiteMillieme;
    }
    return liberees;
  }

  /**
   * DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut n°2) : aperçu, EN LECTURE SEULE, de ce que
   * `libererPourCascadeForcageTx` ci-dessus libérerait pour couvrir `quantiteACouvrirMillieme` —
   * MÊME ordre (`cree_le desc, id desc`), MÊME algorithme glouton (réservations entières jusqu'à
   * couvrir le déficit), mais AUCUNE écriture ni verrou (`for update` volontairement absent) : sert
   * à avertir l'utilisateur AVANT qu'il ne confirme un forçage — RP-15 exige un forçage « explicite
   * ET journalisé », ce qui suppose que l'explicite précède l'action, pas seulement le journal qui
   * la suit. Appelée par `ServiceMouvement.apercuForcage` DANS SA PROPRE transaction (`tx` reçu en
   * premier paramètre, même convention que `libererPourCascadeForcageTx`).
   *
   * PUREMENT INDICATIF : sans verrou, une course concurrente entre cet aperçu et un forçage réel
   * (le sien ou celui d'un autre magasinier) reste possible — acceptable pour un avertissement
   * affiché avant action, jamais pour l'action elle-même qui reste gouvernée, sous verrou, par
   * `libererPourCascadeForcageTx`.
   */
  async apercuLiberationCascadeTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
    siteId: string,
    quantiteACouvrirMillieme: number,
  ): Promise<
    readonly {
      readonly id: string;
      readonly ligneOrId: string;
      readonly ordreReparationId: string;
      readonly ordreReparationNumero: string;
      readonly quantiteMillieme: number;
    }[]
  > {
    if (quantiteACouvrirMillieme <= 0) return [];

    const resultat = await tx.execute<{
      id: string;
      ligneOrId: string;
      ordreReparationId: string;
      ordreReparationNumero: string;
      quantiteMillieme: number;
    }>(sql`
      select r.id as "id", r.ligne_or_id as "ligneOrId", r.ordre_reparation_id as "ordreReparationId",
             o.numero as "ordreReparationNumero", r.quantite_millieme as "quantiteMillieme"
        from public.reservation_piece r
        join public.ordre_reparation o on o.tenant_id = r.tenant_id and o.id = r.ordre_reparation_id
       where r.tenant_id = ${ctx.tenantId} and r.article_id = ${articleId} and r.site_id = ${siteId}
         and r.statut = 'active'
       order by r.cree_le desc, r.id desc
    `);

    const apercu: {
      id: string;
      ligneOrId: string;
      ordreReparationId: string;
      ordreReparationNumero: string;
      quantiteMillieme: number;
    }[] = [];
    let couvert = 0;
    for (const reservation of resultat.rows) {
      if (couvert >= quantiteACouvrirMillieme) break;
      apercu.push(reservation);
      couvert += reservation.quantiteMillieme;
    }
    return apercu;
  }

  /** Garde de transition commune à `satisfaireTx`/`libererTx` : seule une réservation `active` peut être satisfaite ou libérée manuellement. */
  private verifierActiveOu409(ligne: LigneReservationPiece): void {
    if (ligne.statut !== 'active') {
      throw new ErreurMetier(
        'RESERVATION_TRANSITION_INTERDITE',
        `Transition interdite : la réservation est "${ligne.statut}", pas "active".`,
      );
    }
  }

  /**
   * `POST /reservations/{id}/liberer` — RP-23, geste explicite du magasinier (troisième cas). Ouvre
   * SA PROPRE transaction — entrypoint HTTP autonome, voir `libererTx` pour la logique et la note
   * d'atomicité de `satisfaire` ci-dessus (même doctrine).
   */
  async liberer(
    ctx: ContexteTenant,
    reservationId: string,
    entree: EntreeLiberationReservation,
  ): Promise<ReponseAvecAvertissements<ReponseReservationPiece>> {
    return this.acces.enTenant(ctx, (tx) => this.libererTx(tx, ctx, reservationId, entree));
  }

  /**
   * Variante composable de `liberer`, `tx` déjà ouvert en premier paramètre (même convention que
   * `satisfaireTx`). Avertissement `RESERVATION_LIBEREE_OR_ACTIF` quand l'OR porteur n'est PAS
   * `annule` — approximation documentée (voir rapport de livraison) : `RP-23` décrit aussi la
   * libération automatique par « refus d'une ligne en décision de devis », état qu'aucune colonne
   * de `ligne_or` ne permet de distinguer sans lire `atelier/service-devis.ts` (hors périmètre) ;
   * ce service se limite au statut de l'OR, le cas le plus fréquent et le plus lisible.
   */
  async libererTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    reservationId: string,
    entree: EntreeLiberationReservation,
  ): Promise<ReponseAvecAvertissements<ReponseReservationPiece>> {
    const ligne = await this.chargerPourVerrouOu404(tx, ctx, reservationId);
    this.verifierActiveOu409(ligne);

    await this.ecrireLiberation(
      tx,
      ctx,
      reservationId,
      'liberation_manuelle',
      entree.motif,
      ctx.utilisateurId,
    );

    const collecteur = new CollecteurAvertissements();
    const orStatut = await tx.execute<{ statut: string }>(sql`
      select statut::text as "statut" from public.ordre_reparation
       where tenant_id = ${ctx.tenantId} and id = ${ligne.ordreReparationId}
    `);
    if (orStatut.rows[0]?.statut !== 'annule') {
      collecteur.ajouter(
        'RESERVATION_LIBEREE_OR_ACTIF',
        "Réservation libérée alors que l'ordre de réparation porteur n'est pas annulé (RP-23).",
        { reservationId, ordreReparationId: ligne.ordreReparationId },
      );
    }

    const ligneMaj = await this.chargerOu404(tx, ctx, reservationId);
    return collecteur.envelopper(versReservationResponse(ligneMaj));
  }

  /**
   * RP-23, deux premiers cas (annulation d'une ligne, refus en décision de devis) : appelée par
   * `ServiceLigneOr.annulerLignes`/`refuserLignes` (`atelier/`) — libère AUTOMATIQUEMENT la
   * réservation `active` de la ligne d'OR `ligneOrId`, sans second appel HTTP
   * (`POST /reservations/{id}/liberer` reste réservé au geste MANUEL du magasinier, troisième cas,
   * `motif_liberation = 'liberation_manuelle'`). Silencieuse si aucune réservation `active` n'existe
   * (ligne sans pièce, ou réservation déjà `satisfaite`/`liberee`) — rien à libérer n'est pas une
   * anomalie, symétrique de `satisfairePourLigneTx`.
   */
  async libererPourLigneTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligneOrId: string,
    motif: MotifLiberationReservation,
  ): Promise<void> {
    const resultat = await tx.execute<{ id: string }>(sql`
      select r.id as "id" from public.reservation_piece r
       where r.tenant_id = ${ctx.tenantId} and r.ligne_or_id = ${ligneOrId} and r.statut = 'active'
       for update
    `);
    const reservation = resultat.rows[0];
    if (!reservation) return;
    await this.ecrireLiberation(tx, ctx, reservation.id, motif, null, null);
  }

  /**
   * Issue #11 — RP-23, appelée par `ServiceTransitions.annuler` (`atelier/`) : annulation de l'OR
   * ENTIER (T-20), à distinguer d'`annulerLignes`/`refuserLignes` qui ciblent des lignes précises.
   * L'appelant garantit (via `piecesSortiesPourOrTx` ci-dessous, appelée AVANT le passage à
   * `annule`) qu'aucune réservation de cet OR n'est `satisfaite` au moment de cet appel — cette
   * méthode ne traite donc jamais que des réservations `active`, exactement comme
   * `libererPourLigneTx`, mais pour TOUTES les lignes de l'OR en une seule requête verrouillée
   * plutôt qu'un aller-retour par ligne. Silencieuse si aucune réservation `active` n'existe (OR
   * sans ligne `piece`, ou déjà toutes libérées/satisfaites) — rien à libérer n'est pas une
   * anomalie, même doctrine que `libererPourLigneTx`.
   */
  async libererToutesActivesPourOrTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ordreReparationId: string,
    motif: MotifLiberationReservation,
  ): Promise<void> {
    const resultat = await tx.execute<{ id: string }>(sql`
      select r.id as "id" from public.reservation_piece r
       where r.tenant_id = ${ctx.tenantId} and r.ordre_reparation_id = ${ordreReparationId}
         and r.statut = 'active'
       for update
    `);
    // eslint-disable-next-line no-await-in-loop -- petit lot borné (200 lignes max par OR, RP-19 :
    // au plus une réservation par ligne, donc au plus 200 réservations à traiter ici).
    for (const reservation of resultat.rows) {
      await this.ecrireLiberation(tx, ctx, reservation.id, motif, null, null);
    }
  }

  /**
   * RM-62, appelée par `ServiceTransitions.annuler` AVANT tout changement d'état : une réservation
   * `satisfaite` signale une pièce PHYSIQUEMENT sortie du stock pour cet OR — l'annulation de l'OR
   * ENTIER doit être refusée dans ce cas (« aucune pièce sortie », §4.4 RM-62, garde symétrique de
   * celles déjà posées sur les pointages ouverts et les lignes facturées). Distinct de
   * `libererToutesActivesPourOrTx` : une réservation déjà consommée ne se « libère » pas — la
   * remettre en stock exigerait un mouvement de retour, hors champ d'une simple annulation d'OR.
   * Rend les paires `(reservationId, ligneOrId)` bloquantes, pour que l'appelant les combine avec
   * ses propres blocages (pointages, factures) dans une réponse `problem+json` unique.
   */
  async listerPiecesSortiesPourOrTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ordreReparationId: string,
  ): Promise<readonly { id: string; ligneOrId: string }[]> {
    const resultat = await tx.execute<{ id: string; ligneOrId: string }>(sql`
      select r.id as "id", r.ligne_or_id as "ligneOrId" from public.reservation_piece r
       where r.tenant_id = ${ctx.tenantId} and r.ordre_reparation_id = ${ordreReparationId}
         and r.statut = 'satisfaite'
    `);
    return resultat.rows;
  }

  /** Cœur partagé de `libererTx`/`libererPourLigneTx` : UPDATE brut, sans relecture ni
   *  avertissement — laissés à la charge de l'appelant (leur besoin diffère : `libererTx` recharge
   *  et calcule `RESERVATION_LIBEREE_OR_ACTIF`, `libererPourLigneTx` n'en a besoin d'aucun des
   *  deux). `motifTexte`/`libereeParUtilisateurId` à `null` pour toute libération AUTOMATIQUE —
   *  cohérent avec `reservation_piece_motif_texte_chk` (0026) : le texte n'est obligatoire QUE pour
   *  `motif = 'liberation_manuelle'`. */
  private async ecrireLiberation(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    reservationId: string,
    motif: MotifLiberationReservation,
    motifTexte: string | null,
    libereeParUtilisateurId: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      update public.reservation_piece
         set statut = 'liberee', liberee_le = now(), motif_liberation = ${motif},
             motif_liberation_texte = ${motifTexte}, liberee_par_utilisateur_id = ${libereeParUtilisateurId}
       where tenant_id = ${ctx.tenantId} and id = ${reservationId}
    `);
  }

  private async chargerOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    reservationId: string,
  ): Promise<LigneReservationPieceEnrichie> {
    const resultat = await tx.execute<LigneReservationPieceEnrichie>(sql`
      select ${COLONNES_RESERVATION_ALIASEES} from public.reservation_piece r
      ${JOINTURES_RESERVATION}
       where r.tenant_id = ${ctx.tenantId} and r.id = ${reservationId}
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Réservation introuvable.');
    return ligne;
  }

  /** `select … for update` : sérialise satisfaire/liberer concurrents sur la MÊME réservation. */
  private async chargerPourVerrouOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    reservationId: string,
  ): Promise<LigneReservationPieceEnrichie> {
    const resultat = await tx.execute<LigneReservationPieceEnrichie>(sql`
      select ${COLONNES_RESERVATION_ALIASEES} from public.reservation_piece r
      ${JOINTURES_RESERVATION}
       where r.tenant_id = ${ctx.tenantId} and r.id = ${reservationId}
       for update
    `);
    const ligne = resultat.rows[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Réservation introuvable.');
    return ligne;
  }
}
