import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  EntreeAnnulationCommandeFournisseur,
  EntreeAnnulationReliquat,
  EntreeCreationCommandeFournisseur,
  EntreeReceptionCommandeFournisseur,
  FiltresCommandesFournisseur,
  FiltresLignesCommandeFournisseur,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseCommandeFournisseur,
  ReponseLigneCommandeFournisseur,
  ReponseReceptionCommandeFournisseur,
  StatutCommandeFournisseur,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import {
  article,
  commandeFournisseur,
  commandeFournisseurLigne,
  fournisseur,
  ligneOr,
  mouvementStock,
  site,
} from '../db/schema';
import type {
  LigneArticle,
  LigneCommandeFournisseur,
  LigneCommandeFournisseurLigne,
  NouveauMouvementStock,
  NouvelleCommandeFournisseur,
  NouvelleCommandeFournisseurLigne,
} from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { JETON_IDEMPOTENCE } from '../common/idempotence';
import type {
  ReponseMemorisable,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';

import {
  calculerReliquatMillieme,
  versCommandeFournisseurResponse,
  versLigneCommandeFournisseurResponse,
} from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from '../common/pagination';

const DEFINITIONS_TRI_COMMANDES: Readonly<
  Record<FiltresCommandesFournisseur['tri'], DefinitionTri>
> = {
  'creeLe:desc': { expression: sql`cf.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`cf.cree_le`, sens: 'asc', nullable: false, temporel: true },
  // `date_commande` est un `date` (granularité JOUR, pas `timestamptz`) : aucun risque de perte de
  // microseconde (voir `common/pagination/valeur-temporelle.ts`) — cast en texte directement dans
  // l'expression plutôt que via le mécanisme `temporel` (qui exige un format timestamptz complet,
  // `valeurCurseurTimestamptz()` rejetterait une date nue faute de composante horaire).
  'dateCommande:desc': { expression: sql`cf.date_commande::text`, sens: 'desc', nullable: false },
};

/**
 * `GET /commandes-fournisseur/{id}/lignes` — pagination v2 sur `numero_ordre` (`smallint`, unique
 * par commande) : un entier ordinal, PAS une colonne `timestamptz` — hors du périmètre du piège
 * `common/pagination/valeur-temporelle.ts` (`temporel` reste `false` à dessein, aucun `::text`
 * requis pour cette clé).
 */
const DEFINITIONS_TRI_LIGNES_COMMANDE: Readonly<
  Record<FiltresLignesCommandeFournisseur['tri'], DefinitionTri>
> = {
  'numeroOrdre:asc': { expression: sql`l.numero_ordre`, sens: 'asc', nullable: false },
};

const COLONNES_COMMANDE_ALIASEES = sql`
  cf.id as "id", cf.tenant_id as "tenantId", cf.fournisseur_id as "fournisseurId", cf.site_id as "siteId",
  cf.statut as "statut", cf.origine as "origine", cf.date_commande as "dateCommande",
  cf.envoyee_le as "envoyeeLe", cf.reference as "reference", cf.motif_annulation as "motifAnnulation",
  cf.cree_le as "creeLe", cf.modifie_le as "modifieLe"
`;

const COLONNES_LIGNE_ALIASEES = sql`
  l.id as "id", l.tenant_id as "tenantId", l.commande_fournisseur_id as "commandeFournisseurId",
  l.numero_ordre as "numeroOrdre", l.article_id as "articleId",
  l.quantite_commandee_millieme as "quantiteCommandeeMillieme",
  l.quantite_recue_cumulee_millieme as "quantiteRecueCumuleeMillieme",
  l.reliquat_annule_le as "reliquatAnnuleLe", l.reliquat_motif_annulation as "reliquatMotifAnnulation",
  l.prix_achat_attendu_centimes as "prixAchatAttenduCentimes", l.ligne_or_origine_id as "ligneOrOrigineId",
  l.cree_le as "creeLe", l.modifie_le as "modifieLe"
`;

export interface ResultatCreationCommandeFournisseur {
  readonly statutHttp: number;
  readonly corps: ReponseAvecAvertissements<ReponseCommandeFournisseur>;
}

export interface ResultatReceptionCommandeFournisseur {
  readonly statutHttp: number;
  readonly corps: ReponseAvecAvertissements<ReponseReceptionCommandeFournisseur>;
}

/**
 * Machine à états de la commande fournisseur (§6.2), recalculée APPLICATIVEMENT plutôt que
 * déduite du SQLSTATE `ZDFA1` (`verifier_transition()`, 0003/0024) — décision délibérée : la table
 * `transition_autorisee` (0024 §4) enregistre 8 transitions ATOMIQUES, mais aucune n'exprime
 * directement l'agrégat « tous les reliquats sont soldés » qui gouverne `recue`/`cloturee`. Ce
 * module calcule donc la cible AVANT d'écrire, avec le même effet pratique (une transition non
 * autorisée par la base resterait de toute façon refusée si ce calcul se trompait — filet de
 * dernier recours), sans dépendre de `common/avertissements/traducteur-erreur-transition-sql.ts`
 * (dont la table `TABLE_VERS_CODE_TRANSITION` ne connaît pas `commande_fournisseur` — hors
 * périmètre d'écriture de cet agent, signalé au rapport de livraison plutôt que modifié en douce).
 */
function calculerStatutCibleCommande(
  lignes: readonly LigneCommandeFournisseurLigne[],
): StatutCommandeFournisseur {
  const tousSoldes = lignes.every((l) => calculerReliquatMillieme(l) === 0);
  if (tousSoldes) {
    const auMoinsUneAnnulation = lignes.some((l) => l.reliquatAnnuleLe !== null);
    return auMoinsUneAnnulation ? 'cloturee' : 'recue';
  }
  const auMoinsUneProgression = lignes.some(
    (l) => l.quantiteRecueCumuleeMillieme > 0 || l.reliquatAnnuleLe !== null,
  );
  return auMoinsUneProgression ? 'partiellement_recue' : 'envoyee';
}

/**
 * Service commande fournisseur (RP-26 → RP-31, §6.2) — priorité 1 du lot : création (manuelle,
 * réservation en rupture, réapprovisionnement — l'ORIGINE arrive déjà tranchée dans `entree.origine`,
 * ce service ne DÉCLENCHE aucune commande automatiquement), machine à états jusqu'à réception,
 * entrée en stock à la réception (jonction avec `ServiceMouvement`/`ServiceStock`, 0025).
 *
 * `stock_article.quantitePhysiqueMillieme` et `article.prixAchatCentimes` ne sont JAMAIS écrits
 * directement par ce service : `mouvement_stock_appliquer_physique()` (trigger AFTER INSERT sur
 * `mouvement_stock`, 0025) s'en charge. Ce trigger tranche DÉJÀ, à l'insu de ce lot, la question
 * du prix d'achat que le brief demande explicitement de ne pas trancher soi-même (RP-33/QP-04,
 * `parametre_pieces.methodePrixAchat` encore `null`) : « dernier prix connu » — écrit tel quel dans
 * le commentaire SQL du trigger. Signalé au rapport de livraison, pas une décision de ce lot.
 */
@Injectable()
export class ServiceCommandeFournisseur {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
  ) {}

  async lister(
    ctx: ContexteTenant,
    params: FiltresCommandesFournisseur,
  ): Promise<PageCurseur<ReponseCommandeFournisseur>> {
    const definition = DEFINITIONS_TRI_COMMANDES[params.tri];
    const idExpr = sql`cf.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_COMMANDES,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`cf.tenant_id = ${ctx.tenantId}`];
      if (params.q) {
        // `public.normaliser_recherche(...)` des deux côtés — même idiome que
        // `pieces/service-article.ts`. `reference` est nullable (`reapprovisionnement_auto`) : un
        // `like` contre `null` vaut `null` (faux), la ligne est simplement exclue, jamais une
        // erreur.
        const motif = `%${params.q}%`;
        conditions.push(
          sql`public.normaliser_recherche(cf.reference) like public.normaliser_recherche(${motif})`,
        );
      }
      if (params.statut && params.statut.length > 0) {
        // DÉFAUT CONSTATÉ (corrigé, balayage du 27.08.2026) : `cf.statut::text in (...)` castait
        // l'enum en `text` avant comparaison, opaque aux statistiques PostgreSQL de la colonne —
        // même défaut que `client.statut` (`service-client.ts`). Comparaison native sur l'enum.
        conditions.push(
          sql`cf.statut = any(${sql.param(params.statut)}::public.statut_commande_fournisseur[])`,
        );
      }
      if (params.fournisseurId) conditions.push(sql`cf.fournisseur_id = ${params.fournisseurId}`);
      if (params.siteId) conditions.push(sql`cf.site_id = ${params.siteId}`);
      // Sucre documenté par le contrat (`commande-fournisseur.ts`) : équivalent à
      // `statut in ('envoyee','partiellement_recue')`, jamais une vue distincte en base. Même
      // correction de cast que ci-dessus, ici sur une liste constante plutôt qu'un paramètre.
      if (params.avecReliquat) {
        conditions.push(
          sql`cf.statut = any(${sql.param(['envoyee', 'partiellement_recue'])}::public.statut_commande_fournisseur[])`,
        );
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneCommandeFournisseur & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_COMMANDE_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.commande_fournisseur cf
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      const lignesParCommande = await this.chargerLignesParCommande(
        tx,
        ctx,
        pageLignes.map((l) => l.id),
      );

      return {
        donnees: pageLignes.map((l) =>
          versCommandeFournisseurResponse(l, lignesParCommande.get(l.id) ?? []),
        ),
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

  async parId(ctx: ContexteTenant, id: string): Promise<ReponseCommandeFournisseur> {
    return this.acces.enTenant(ctx, async (tx) => this.chargerCommandeAvecLignes(tx, ctx, id));
  }

  /**
   * `GET /commandes-fournisseur/{id}/lignes` — la suite de `ReponseCommandeFournisseur.lignes`
   * au-delà de `SEUIL_LIGNES_EMBARQUEES_COMMANDE_FOURNISSEUR` (`lignesTronquees`). Pagination v2
   * par curseur, même patron que `lister()` — 404 explicite si la commande n'existe pas pour ce
   * tenant.
   */
  async listerLignes(
    ctx: ContexteTenant,
    commandeId: string,
    params: FiltresLignesCommandeFournisseur,
  ): Promise<PageCurseur<ReponseLigneCommandeFournisseur>> {
    const definition = DEFINITIONS_TRI_LIGNES_COMMANDE[params.tri];
    const idExpr = sql`l.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_LIGNES_COMMANDE,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerCommandeOu404(tx, ctx, commandeId);

      const conditions = [
        sql`l.tenant_id = ${ctx.tenantId}`,
        sql`l.commande_fournisseur_id = ${commandeId}`,
      ];
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneCommandeFournisseurLigne & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_LIGNE_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.commande_fournisseur_ligne l
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((l) => versLigneCommandeFournisseurResponse(l)),
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
   * `POST /commandes-fournisseur` — `Idempotency-Key` OBLIGATOIRE (création sensible). Statut
   * initial toujours `brouillon`. Valide l'existence du fournisseur, du site, de chaque article et
   * — quand renseignée — de la ligne d'OR d'origine (RP-24), pour ne jamais laisser une violation
   * de FK brute (500 non qualifié) remonter au client.
   */
  async creer(
    ctx: ContexteTenant,
    entree: EntreeCreationCommandeFournisseur,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatCreationCommandeFournisseur & ReponseMemorisable>> {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/commandes-fournisseur', cle: cleIdempotence, corps: entree },
      async (tx) => {
        await this.chargerFournisseurOu404(tx, ctx, entree.fournisseurId);
        await this.chargerSiteOu404(tx, ctx, entree.siteId);
        for (const ligne of entree.lignes) {
          await this.chargerArticleOu404(tx, ctx, ligne.articleId);
          if (ligne.ligneOrOrigineId) {
            await this.chargerLigneOrOu404(tx, ctx, ligne.ligneOrOrigineId);
          }
        }

        const valeursCommande: NouvelleCommandeFournisseur = {
          tenantId: ctx.tenantId,
          fournisseurId: entree.fournisseurId,
          siteId: entree.siteId,
          origine: entree.origine,
          reference: entree.reference ?? null,
          ...(entree.dateCommande ? { dateCommande: entree.dateCommande } : {}),
        };
        const [commande] = await tx.insert(commandeFournisseur).values(valeursCommande).returning();
        if (!commande)
          throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création de la commande fournisseur.');

        const valeursLignes: NouvelleCommandeFournisseurLigne[] = entree.lignes.map(
          (ligne, index) => ({
            tenantId: ctx.tenantId,
            commandeFournisseurId: commande.id,
            numeroOrdre: index + 1,
            articleId: ligne.articleId,
            quantiteCommandeeMillieme: ligne.quantiteCommandeeMillieme,
            prixAchatAttenduCentimes: ligne.prixAchatAttenduCentimes ?? null,
            ligneOrOrigineId: ligne.ligneOrOrigineId ?? null,
          }),
        );
        await tx.insert(commandeFournisseurLigne).values(valeursLignes);

        const commandeComplete = await this.chargerCommandeAvecLignes(tx, ctx, commande.id);
        return {
          statutHttp: 201,
          corps: new CollecteurAvertissements().envelopper(commandeComplete),
        };
      },
    );
  }

  /** `POST /commandes-fournisseur/{id}/envoyer` — `brouillon → envoyee` (§6.2). */
  async envoyer(
    ctx: ContexteTenant,
    id: string,
  ): Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const commande = await this.chargerCommandeOu404PourVerrou(tx, ctx, id);
      if (commande.statut !== 'brouillon') {
        throw new ErreurMetier(
          'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
          `Transition interdite : la commande est "${commande.statut}", pas "brouillon".`,
        );
      }
      await tx.execute(sql`
        update public.commande_fournisseur
           set statut = 'envoyee', envoyee_le = now()
         where tenant_id = ${ctx.tenantId} and id = ${id}
      `);
      const commandeMaj = await this.chargerCommandeAvecLignes(tx, ctx, id);
      return new CollecteurAvertissements().envelopper(commandeMaj);
    });
  }

  /**
   * `POST /commandes-fournisseur/{id}/reception` — `Idempotency-Key` OBLIGATOIRE. Le magasinier
   * saisit ce qui est EFFECTIVEMENT livré (§7.4) : génère un mouvement `entree_livraison` par
   * ligne reçue, incrémente le cumul reçu de la ligne de commande d'ORIGINE (même en cas de
   * substitution par une référence équivalente — RP-02), et fait progresser le statut de la
   * commande selon l'état agrégé de TOUTES ses lignes après cet appel.
   *
   * `articleRecuId` (substitution, §7.4) : accepté SEULEMENT si l'article reçu porte, sur SA propre
   * fiche, une `referencePrincipale` déclarée comme référence `equivalente` de l'article COMMANDÉ
   * (`article_reference`, RP-02/RP-03) — INTERPRÉTATION signalée au rapport de livraison : le
   * contrat (`commande-fournisseur.ts`) décrit la règle en une phrase sans préciser le sens exact
   * du rapprochement entre deux fiches article distinctes ; aucune autre lecture cohérente du
   * schéma `article_reference` (une chaîne `reference`, jamais un pointeur vers un autre article)
   * n'a été trouvée. Sinon `409 RECEPTION_REFERENCE_NON_EQUIVALENTE`.
   */
  async reception(
    ctx: ContexteTenant,
    id: string,
    entree: EntreeReceptionCommandeFournisseur,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ResultatReceptionCommandeFournisseur & ReponseMemorisable>> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/commandes-fournisseur/{id}/reception',
        cle: cleIdempotence,
        corps: { id, ...entree },
      },
      async (tx) => {
        const commande = await this.chargerCommandeOu404PourVerrou(tx, ctx, id);
        if (commande.statut !== 'envoyee' && commande.statut !== 'partiellement_recue') {
          throw new ErreurMetier(
            'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
            `Réception impossible : la commande est "${commande.statut}", attendu "envoyee" ou "partiellement_recue".`,
          );
        }

        const lignesCommande = await this.chargerLignesPourVerrou(tx, ctx, id);
        const lignesParId = new Map(lignesCommande.map((l) => [l.id, l]));

        const collecteur = new CollecteurAvertissements();
        const mouvementsCrees: string[] = [];

        for (const ligneEntree of entree.lignes) {
          const ligne = lignesParId.get(ligneEntree.ligneId);
          if (!ligne) {
            throw new ErreurMetier(
              'RESSOURCE_INTROUVABLE',
              `Ligne de commande introuvable : ${ligneEntree.ligneId}.`,
            );
          }

          let articleMouvementId = ligne.articleId;
          if (ligneEntree.articleRecuId && ligneEntree.articleRecuId !== ligne.articleId) {
            const articleRecu = await this.chargerArticleOu404(tx, ctx, ligneEntree.articleRecuId);
            const equivalente = await this.estReferenceEquivalente(
              tx,
              ctx,
              ligne.articleId,
              articleRecu.referencePrincipale,
            );
            if (!equivalente) {
              throw new ErreurMetier(
                'RECEPTION_REFERENCE_NON_EQUIVALENTE',
                `"${articleRecu.referencePrincipale}" n'est pas déclarée comme référence équivalente de l'article commandé (RP-02).`,
              );
            }
            articleMouvementId = articleRecu.id;
          }

          const reliquatAvant = calculerReliquatMillieme(ligne);
          if (ligneEntree.quantiteRecueMillieme > reliquatAvant) {
            collecteur.ajouter(
              'RECEPTION_EXCEDENT_RELIQUAT',
              `Quantité reçue (${String(ligneEntree.quantiteRecueMillieme)}) supérieure au reliquat restant (${String(reliquatAvant)}).`,
              {
                ligneId: ligne.id,
                reliquatMillieme: reliquatAvant,
                quantiteRecueMillieme: ligneEntree.quantiteRecueMillieme,
              },
            );
          }

          const valeursMouvement: NouveauMouvementStock = {
            tenantId: ctx.tenantId,
            articleId: articleMouvementId,
            type: 'entree_livraison',
            quantiteMillieme: ligneEntree.quantiteRecueMillieme,
            siteId: commande.siteId,
            prixAchatReelCentimes: ligneEntree.prixAchatReelCentimes ?? null,
            motif: ligneEntree.motif ?? null,
            auteurId: ctx.utilisateurId,
            commandeFournisseurLigneId: ligne.id,
          };
          const [mouvement] = await tx.insert(mouvementStock).values(valeursMouvement).returning();
          if (!mouvement)
            throw new ErreurMetier('ERREUR_INTERNE', "Échec de création du mouvement d'entrée.");
          mouvementsCrees.push(mouvement.id);

          const nouveauCumul =
            ligne.quantiteRecueCumuleeMillieme + ligneEntree.quantiteRecueMillieme;
          await tx.execute(sql`
            update public.commande_fournisseur_ligne
               set quantite_recue_cumulee_millieme = ${nouveauCumul}
             where tenant_id = ${ctx.tenantId} and id = ${ligne.id}
          `);
          lignesParId.set(ligne.id, { ...ligne, quantiteRecueCumuleeMillieme: nouveauCumul });
        }

        const statutCible = calculerStatutCibleCommande([...lignesParId.values()]);
        await this.avancerStatutCommande(tx, ctx, id, commande.statut, statutCible);

        const commandeMaj = await this.chargerCommandeAvecLignes(tx, ctx, id);
        return {
          statutHttp: 201,
          corps: collecteur.envelopper({ mouvementsCrees, commandeFournisseur: commandeMaj }),
        };
      },
    );
  }

  /**
   * `POST /commandes-fournisseur/{id}/lignes/{ligneId}/annuler-reliquat` — solde un reliquat SANS
   * livraison (RP-28). `409 COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE` si le reliquat est déjà à
   * zéro, que ce soit par livraison complète ou par une annulation antérieure.
   */
  async annulerReliquat(
    ctx: ContexteTenant,
    commandeId: string,
    ligneId: string,
    entree: EntreeAnnulationReliquat,
  ): Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const commande = await this.chargerCommandeOu404PourVerrou(tx, ctx, commandeId);
      if (commande.statut !== 'envoyee' && commande.statut !== 'partiellement_recue') {
        throw new ErreurMetier(
          'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
          `Annulation de reliquat impossible : la commande est "${commande.statut}".`,
        );
      }

      const lignes = await this.chargerLignesPourVerrou(tx, ctx, commandeId);
      const ligne = lignes.find((l) => l.id === ligneId);
      if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Ligne de commande introuvable.');

      const reliquat = calculerReliquatMillieme(ligne);
      if (ligne.reliquatAnnuleLe !== null || reliquat === 0) {
        throw new ErreurMetier(
          'COMMANDE_FOURNISSEUR_RELIQUAT_DEJA_SOLDE',
          'Le reliquat de cette ligne est déjà soldé (livré en entier ou annulé précédemment).',
        );
      }

      await tx.execute(sql`
        update public.commande_fournisseur_ligne
           set reliquat_annule_le = now(), reliquat_motif_annulation = ${entree.motif}
         where tenant_id = ${ctx.tenantId} and id = ${ligneId}
      `);

      const lignesMaj = lignes.map((l) =>
        l.id === ligneId ? { ...l, reliquatAnnuleLe: new Date() } : l,
      );
      const statutCible = calculerStatutCibleCommande(lignesMaj);
      await this.avancerStatutCommande(tx, ctx, commandeId, commande.statut, statutCible);

      const commandeMaj = await this.chargerCommandeAvecLignes(tx, ctx, commandeId);
      return new CollecteurAvertissements().envelopper(commandeMaj);
    });
  }

  /**
   * `POST /commandes-fournisseur/{id}/annuler` — UNIQUEMENT depuis `brouillon` ou `envoyee`, AVANT
   * toute réception (§6.2). Persiste `entree.motif` dans `commande_fournisseur.motif_annulation`
   * (migration 0034, qui a comblé le gap de schéma constaté à l'audit de ce lot — cette colonne
   * n'existait pas : `_entree.motif` était validé par `schemaMotif` puis jeté silencieusement,
   * alors que `transition_autorisee.exige_motif = true` pour {brouillon,envoyee} -> annulee
   * (0024 §4)). La CHECK `commande_fournisseur_annulation_coherente_chk` (0034) refuserait
   * désormais toute annulation qui omettrait ce motif — cohérent avec `schemaMotif` déjà non vide
   * côté contrat, jamais redondant en pratique.
   */
  async annuler(
    ctx: ContexteTenant,
    commandeId: string,
    entree: EntreeAnnulationCommandeFournisseur,
  ): Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const commande = await this.chargerCommandeOu404PourVerrou(tx, ctx, commandeId);
      if (commande.statut !== 'brouillon' && commande.statut !== 'envoyee') {
        throw new ErreurMetier(
          'COMMANDE_FOURNISSEUR_TRANSITION_INTERDITE',
          `Annulation impossible : la commande est "${commande.statut}" — après réception, seul le reliquat s'annule ligne par ligne (§6.2).`,
        );
      }
      await tx.execute(sql`
        update public.commande_fournisseur set statut = 'annulee', motif_annulation = ${entree.motif}
         where tenant_id = ${ctx.tenantId} and id = ${commandeId}
      `);
      const commandeMaj = await this.chargerCommandeAvecLignes(tx, ctx, commandeId);
      return new CollecteurAvertissements().envelopper(commandeMaj);
    });
  }

  /**
   * §6.2 : `envoyee → cloturee` n'existe PAS dans `transition_autorisee` (0024 §4, 8 lignes
   * exactement) — seul cas où ce module a besoin de DEUX transitions successives dans la même
   * transaction (`envoyee → partiellement_recue → cloturee`) pour atteindre `cloturee` sans être
   * jamais passé par une vraie réception (reliquat total annulé d'un coup). Invisible pour
   * l'appelant : les deux `UPDATE` commitent ensemble.
   */
  private async avancerStatutCommande(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
    statutActuel: StatutCommandeFournisseur,
    statutCible: StatutCommandeFournisseur,
  ): Promise<void> {
    if (statutActuel === statutCible) return;
    if (statutActuel === 'envoyee' && statutCible === 'cloturee') {
      await this.ecrireStatutCommande(tx, ctx, id, 'partiellement_recue');
      await this.ecrireStatutCommande(tx, ctx, id, 'cloturee');
      return;
    }
    await this.ecrireStatutCommande(tx, ctx, id, statutCible);
  }

  private async ecrireStatutCommande(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
    statut: StatutCommandeFournisseur,
  ): Promise<void> {
    await tx.execute(sql`
      update public.commande_fournisseur set statut = ${statut}
       where tenant_id = ${ctx.tenantId} and id = ${id}
    `);
  }

  private async chargerCommandeAvecLignes(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<ReponseCommandeFournisseur> {
    const commande = await this.chargerCommandeOu404(tx, ctx, id);
    const lignesParCommande = await this.chargerLignesParCommande(tx, ctx, [id]);
    return versCommandeFournisseurResponse(commande, lignesParCommande.get(id) ?? []);
  }

  private async chargerLignesParCommande(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    commandeIds: readonly string[],
  ): Promise<ReadonlyMap<string, LigneCommandeFournisseurLigne[]>> {
    if (commandeIds.length === 0) return new Map();
    const lignes = await tx
      .select()
      .from(commandeFournisseurLigne)
      .where(
        and(
          eq(commandeFournisseurLigne.tenantId, ctx.tenantId),
          inArray(commandeFournisseurLigne.commandeFournisseurId, [...commandeIds]),
        ),
      )
      .orderBy(
        commandeFournisseurLigne.commandeFournisseurId,
        commandeFournisseurLigne.numeroOrdre,
      );

    const parCommande = new Map<string, LigneCommandeFournisseurLigne[]>();
    for (const l of lignes) {
      const liste = parCommande.get(l.commandeFournisseurId) ?? [];
      liste.push(l);
      parCommande.set(l.commandeFournisseurId, liste);
    }
    return parCommande;
  }

  private async chargerCommandeOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<LigneCommandeFournisseur> {
    const lignes = await tx
      .select()
      .from(commandeFournisseur)
      .where(and(eq(commandeFournisseur.tenantId, ctx.tenantId), eq(commandeFournisseur.id, id)))
      .limit(1);
    const ligne = lignes[0];
    if (!ligne)
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Commande fournisseur introuvable.');
    return ligne;
  }

  /** `select … for update` : sérialise toute transition/réception concurrente sur la MÊME commande. */
  private async chargerCommandeOu404PourVerrou(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<LigneCommandeFournisseur> {
    const resultat = await tx.execute<LigneCommandeFournisseur>(sql`
      select ${COLONNES_COMMANDE_ALIASEES} from public.commande_fournisseur cf
       where cf.tenant_id = ${ctx.tenantId} and cf.id = ${id}
       for update
    `);
    const ligne = resultat.rows[0];
    if (!ligne)
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Commande fournisseur introuvable.');
    return ligne;
  }

  /** `select … for update` : verrouille TOUTES les lignes avant réception/annulation de reliquat (recalcul d'agrégat cohérent). */
  private async chargerLignesPourVerrou(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    commandeId: string,
  ): Promise<LigneCommandeFournisseurLigne[]> {
    const resultat = await tx.execute<LigneCommandeFournisseurLigne>(sql`
      select ${COLONNES_LIGNE_ALIASEES} from public.commande_fournisseur_ligne l
       where l.tenant_id = ${ctx.tenantId} and l.commande_fournisseur_id = ${commandeId}
       order by l.numero_ordre
       for update
    `);
    return resultat.rows;
  }

  private async chargerFournisseurOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<void> {
    const lignes = await tx
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(and(eq(fournisseur.tenantId, ctx.tenantId), eq(fournisseur.id, id)))
      .limit(1);
    if (!lignes[0]) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Fournisseur introuvable.');
  }

  private async chargerSiteOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    siteId: string,
  ): Promise<void> {
    const lignes = await tx
      .select({ id: site.id })
      .from(site)
      .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
      .limit(1);
    if (!lignes[0]) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Site introuvable.');
  }

  private async chargerArticleOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
  ): Promise<LigneArticle> {
    const lignes = await tx
      .select()
      .from(article)
      .where(and(eq(article.tenantId, ctx.tenantId), eq(article.id, articleId)))
      .limit(1);
    const ligne = lignes[0];
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Article introuvable.');
    return ligne;
  }

  private async chargerLigneOrOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligneOrId: string,
  ): Promise<void> {
    const lignes = await tx
      .select({ id: ligneOr.id })
      .from(ligneOr)
      .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligneOrId)))
      .limit(1);
    if (!lignes[0])
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', "Ligne d'OR d'origine introuvable.");
  }

  private async estReferenceEquivalente(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleOriginalId: string,
    referenceRecue: string,
  ): Promise<boolean> {
    const resultat = await tx.execute<{ id: string }>(sql`
      select ar.id as "id" from public.article_reference ar
       where ar.tenant_id = ${ctx.tenantId} and ar.article_id = ${articleOriginalId}
         and ar.type = 'equivalente' and ar.reference = ${referenceRecue}
       limit 1
    `);
    return resultat.rows.length > 0;
  }
}
