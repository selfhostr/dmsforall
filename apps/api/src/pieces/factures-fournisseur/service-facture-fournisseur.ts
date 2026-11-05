import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  ChampsOrigineFactureFournisseur,
  FiltresFacturesFournisseur,
  PageCurseur,
  ReponseFactureFournisseur,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import { JETON_DB } from '../../db';
import {
  article,
  commandeFournisseur,
  commandeFournisseurLigne,
  factureFournisseur,
  factureFournisseurAudit,
  factureFournisseurDocument,
  factureFournisseurLigne,
  fournisseur,
  type LigneFactureFournisseur,
  type LigneFactureFournisseurDocument,
  type LigneFactureFournisseurLigne,
  type NouvelleFactureFournisseur,
  type NouvelleFactureFournisseurAudit,
  type NouvelleFactureFournisseurDocument,
  type NouvelleFactureFournisseurLigne,
} from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';

import { calculerReliquatMillieme } from '../mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from '../../common/pagination';

import { ServiceOrchestrateurLectureFacture } from './lecture/orchestrateur-lecture';
import type { DonneesFactureExtraites, EnTeteFactureExtrait } from './lecture/types';
import { versFactureFournisseurResponse } from './mappers';
import {
  assemblerResultatRapprochement,
  trouverCommandeExacte,
  trouverFournisseurExact,
  type CandidatCommandeFournisseur,
  type CandidatFournisseur,
} from './service-rapprochement';

/** Taille maximale acceptée pour un dépôt — une facture fournisseur (texte + un symbole QR) ne
 *  dépasse jamais quelques mégaoctets ; borne large pour un PDF scanné multi-pages. */
export const LIMITE_TAILLE_FACTURE_FOURNISSEUR_OCTETS = 20 * 1024 * 1024;

/** Signature binaire `%PDF-` — vérifie le TYPE RÉEL du fichier, jamais seulement le
 *  `Content-Type` déclaré par le client (qu'un appelant peut mentir sans effort). */
const SIGNATURE_PDF = Buffer.from('%PDF-', 'ascii');

function estUnPdfValide(fichier: Buffer): boolean {
  return fichier.length >= SIGNATURE_PDF.length && fichier.subarray(0, 5).equals(SIGNATURE_PDF);
}

const STATUTS_COMMANDE_AVEC_RELIQUAT = ['envoyee', 'partiellement_recue'] as const;

const DEFINITIONS_TRI_FACTURES_FOURNISSEUR: Readonly<
  Record<FiltresFacturesFournisseur['tri'], DefinitionTri>
> = {
  'creeLe:desc': { expression: sql`ff.cree_le`, sens: 'desc', nullable: false, temporel: true },
  'creeLe:asc': { expression: sql`ff.cree_le`, sens: 'asc', nullable: false, temporel: true },
};

const COLONNES_FACTURE_ALIASEES = sql`
  ff.id as "id", ff.tenant_id as "tenantId", ff.document_id as "documentId",
  ff.fournisseur_id as "fournisseurId", ff.commande_fournisseur_id as "commandeFournisseurId",
  ff.statut as "statut", ff.iban_creancier as "ibanCreancier", ff.nom_creancier as "nomCreancier",
  ff.numero_facture as "numeroFacture", ff.date_facture as "dateFacture",
  ff.montant_total_centimes as "montantTotalCentimes", ff.devise as "devise",
  ff.reference_paiement as "referencePaiement", ff.champs_origine as "champsOrigine",
  ff.depose_par_id as "deposeParId", ff.depose_le as "deposeLe",
  ff.valide_par_id as "valideParId", ff.valide_le as "valideLe", ff.motif_rejet as "motifRejet",
  ff.cree_le as "creeLe", ff.modifie_le as "modifieLe"
`;

/**
 * Lecture automatique des factures fournisseurs — dépôt, chaîne QR → texte PDF → OCR,
 * rapprochement, validation/rejet. Voir le rapport de livraison pour le détail de chaque étape.
 *
 * Le rôle n'est plus vérifié ICI : `@ExigerDroit(...)` posé sur chaque route de
 * `FactureFournisseurController`, contrôlé par `GardeDroit` contre `MATRICE_DROITS`
 * (`auth/matrice-droits.ts`) — bascule depuis le palliatif `droits-provisoires.ts` (retiré), qui
 * portait la vérification réelle ici faute d'accès à la matrice centrale.
 */
@Injectable()
export class ServiceFactureFournisseur {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly orchestrateur: ServiceOrchestrateurLectureFacture,
  ) {}

  /**
   * `ContexteTenant.utilisateurId` est `string | null` DANS SON TYPE (`null` = tâche système —
   * job BullMQ, migration, seed, voir `db/db.types.ts`) mais toute méthode de ce service n'est
   * appelée QUE depuis `FactureFournisseurController`, TOUJOURS derrière `GardeSession` — un
   * utilisateur authentifié existe donc systématiquement en pratique
   * (`ServiceContexteRequete.contexteTenant()` le peuple depuis `exigerPrincipal()`). Garde
   * défensive plutôt qu'une assertion `!` : si jamais ce service était un jour appelé depuis un
   * contexte système (job de purge…), l'échec serait explicite (`ERREUR_INTERNE`), jamais une
   * ligne d'audit avec un auteur `null` silencieusement acceptée par TypeScript.
   */
  private exigerUtilisateurId(ctx: ContexteTenant): string {
    if (!ctx.utilisateurId) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        'Aucun utilisateur dans le contexte — cette opération exige une session authentifiée.',
      );
    }
    return ctx.utilisateurId;
  }

  async deposer(ctx: ContexteTenant, fichier: Buffer): Promise<ReponseFactureFournisseur> {
    const utilisateurId = this.exigerUtilisateurId(ctx);

    if (!estUnPdfValide(fichier)) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Fichier déposé non reconnu comme PDF (signature %PDF- absente) — seul le PDF est accepté.',
      );
    }

    const empreinte = createHash('sha256').update(fichier).digest();

    // Chaîne de lecture AVANT toute écriture — aucun état partiel en base si elle échoue.
    const donnees = await this.orchestrateur.lire(fichier);

    return this.acces.enTenant(ctx, async (tx) => {
      const documentExistant = await tx
        .select({ id: factureFournisseurDocument.id })
        .from(factureFournisseurDocument)
        .where(
          and(
            eq(factureFournisseurDocument.tenantId, ctx.tenantId),
            eq(factureFournisseurDocument.empreinteSha256, empreinte),
          ),
        )
        .limit(1);
      if (documentExistant.length > 0) {
        throw new ErreurMetier(
          'CONFLIT',
          'Ce fichier a déjà été déposé (même empreinte SHA-256) — double dépôt refusé.',
        );
      }

      const nouveauDocument: NouvelleFactureFournisseurDocument = {
        tenantId: ctx.tenantId,
        contenu: fichier,
        typeMime: 'application/pdf',
        tailleOctets: fichier.length,
        empreinteSha256: empreinte,
        deposeParId: utilisateurId,
      };
      const [document] = await tx
        .insert(factureFournisseurDocument)
        .values(nouveauDocument)
        .returning();
      if (!document)
        throw new ErreurMetier('ERREUR_INTERNE', 'Échec d’enregistrement du document.');

      const fournisseurId = await this.rapprocherFournisseurTx(tx, ctx, donnees);
      const commandeCandidate = fournisseurId
        ? await this.chargerCommandeCandidateTx(tx, ctx, fournisseurId, donnees)
        : null;
      const resultat = assemblerResultatRapprochement(donnees, fournisseurId, commandeCandidate);

      const champsOrigine = construireChampsOrigine(donnees.enTete);
      const statut = resultat.commandeFournisseurId ? 'rapprochee' : 'deposee';

      const nouvelleFacture: NouvelleFactureFournisseur = {
        tenantId: ctx.tenantId,
        documentId: document.id,
        fournisseurId: resultat.fournisseurId,
        commandeFournisseurId: resultat.commandeFournisseurId,
        statut,
        ibanCreancier: donnees.enTete.ibanCreancier?.valeur ?? null,
        nomCreancier: donnees.enTete.nomCreancier?.valeur ?? null,
        numeroFacture: donnees.enTete.numeroFacture?.valeur ?? null,
        dateFacture: donnees.enTete.dateFacture?.valeur ?? null,
        montantTotalCentimes: donnees.enTete.montantTotalCentimes?.valeur ?? null,
        devise: donnees.enTete.devise?.valeur ?? 'CHF',
        referencePaiement: donnees.enTete.referencePaiement?.valeur ?? null,
        champsOrigine,
        deposeParId: utilisateurId,
      };
      const [facture] = await tx.insert(factureFournisseur).values(nouvelleFacture).returning();
      if (!facture)
        throw new ErreurMetier('ERREUR_INTERNE', 'Échec d’enregistrement de la facture.');

      const nouvellesLignes: NouvelleFactureFournisseurLigne[] = resultat.lignes.map(
        (l, index) => ({
          tenantId: ctx.tenantId,
          factureFournisseurId: facture.id,
          numeroOrdre: index + 1,
          referenceArticle: l.extraite.referenceArticle,
          designation: l.extraite.designation,
          quantiteMillieme: l.extraite.quantiteMillieme,
          prixUnitaireCentimes: l.extraite.prixUnitaireCentimes,
          totalLigneCentimes: l.extraite.totalLigneCentimes,
          origine: l.extraite.origine,
          articleId: l.articleId,
          commandeFournisseurLigneId: l.commandeFournisseurLigneId,
          ecartPrixUnitaireCentimes: l.ecart?.prixUnitaireCentimes ?? null,
          ecartQuantiteMillieme: l.ecart?.quantiteMillieme ?? null,
          ecartTotalCentimes: l.ecart?.totalCentimes ?? null,
        }),
      );
      const lignesInserees =
        nouvellesLignes.length > 0
          ? await tx.insert(factureFournisseurLigne).values(nouvellesLignes).returning()
          : [];

      const audit: NouvelleFactureFournisseurAudit = {
        tenantId: ctx.tenantId,
        factureFournisseurId: facture.id,
        utilisateurId,
        action: 'depot',
        valeurAvant: null,
        valeurApres: {
          statut,
          fournisseurId: resultat.fournisseurId,
          commandeFournisseurId: resultat.commandeFournisseurId,
        },
      };
      await tx.insert(factureFournisseurAudit).values(audit);

      return versFactureFournisseurResponse(facture, document, lignesInserees);
    });
  }

  async lister(
    ctx: ContexteTenant,
    params: FiltresFacturesFournisseur,
  ): Promise<PageCurseur<ReponseFactureFournisseur>> {
    const definition = DEFINITIONS_TRI_FACTURES_FOURNISSEUR[params.tri];
    const idExpr = sql`ff.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_FACTURES_FOURNISSEUR,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`ff.tenant_id = ${ctx.tenantId}`];
      if (params.q) {
        // `public.normaliser_recherche(...)` des deux côtés — même idiome que
        // `pieces/service-article.ts`. `nom_creancier`/`numero_facture` sont nullables (lecture
        // QR/OCR incertaine) : une facture sans l'un reste trouvable par l'autre.
        const motif = `%${params.q}%`;
        conditions.push(sql`(
          public.normaliser_recherche(ff.nom_creancier) like public.normaliser_recherche(${motif})
          or public.normaliser_recherche(ff.numero_facture) like public.normaliser_recherche(${motif})
        )`);
      }
      if (params.statut && params.statut.length > 0) {
        // DÉFAUT CONSTATÉ (corrigé, balayage du 27.08.2026) : `ff.statut::text in (...)` castait
        // l'enum en `text` avant comparaison, opaque aux statistiques PostgreSQL de la colonne —
        // même défaut que `client.statut` (`service-client.ts`). Comparaison native sur l'enum.
        conditions.push(
          sql`ff.statut = any(${sql.param(params.statut)}::public.statut_facture_fournisseur[])`,
        );
      }
      if (params.fournisseurId) conditions.push(sql`ff.fournisseur_id = ${params.fournisseurId}`);
      if (params.commandeFournisseurId) {
        conditions.push(sql`ff.commande_fournisseur_id = ${params.commandeFournisseurId}`);
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const resultat = await tx.execute<
        LigneFactureFournisseur & { triValeur: string | number | null }
      >(sql`
        select ${COLONNES_FACTURE_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur"
          from public.facture_fournisseur ff
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `);

      const lignesFactures = resultat.rows;
      const aUnePageSuivante = lignesFactures.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignesFactures.slice(0, params.limite) : lignesFactures;
      const derniere = pageLignes[pageLignes.length - 1];

      const documentIds = pageLignes.map((f) => f.documentId);
      const factureIds = pageLignes.map((f) => f.id);
      const documents = documentIds.length
        ? await tx
            .select()
            .from(factureFournisseurDocument)
            .where(
              and(
                eq(factureFournisseurDocument.tenantId, ctx.tenantId),
                inArray(factureFournisseurDocument.id, documentIds),
              ),
            )
        : [];
      const documentParId = new Map(documents.map((d) => [d.id, d]));
      const lignesFacture = factureIds.length
        ? await tx
            .select()
            .from(factureFournisseurLigne)
            .where(
              and(
                eq(factureFournisseurLigne.tenantId, ctx.tenantId),
                inArray(factureFournisseurLigne.factureFournisseurId, factureIds),
              ),
            )
        : [];
      const lignesParFactureId = groupeParFacture(lignesFacture);

      return {
        donnees: pageLignes.map((f) => {
          const document = documentParId.get(f.documentId);
          if (!document) {
            throw new ErreurMetier(
              'ERREUR_INTERNE',
              'Document introuvable pour une facture listée.',
            );
          }
          return versFactureFournisseurResponse(f, document, lignesParFactureId.get(f.id) ?? []);
        }),
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

  async obtenir(ctx: ContexteTenant, id: string): Promise<ReponseFactureFournisseur> {
    return this.acces.enTenant(ctx, async (tx) => {
      const { facture, document } = await this.chargerFactureEtDocumentOu404Tx(tx, ctx, id);
      const lignes = await tx
        .select()
        .from(factureFournisseurLigne)
        .where(
          and(
            eq(factureFournisseurLigne.tenantId, ctx.tenantId),
            eq(factureFournisseurLigne.factureFournisseurId, id),
          ),
        );
      return versFactureFournisseurResponse(facture, document, lignes);
    });
  }

  /** `GET /{id}/document` — le binaire, uniquement ici (jamais dans `obtenir`/`lister`). */
  async obtenirDocument(
    ctx: ContexteTenant,
    id: string,
  ): Promise<{ readonly contenu: Buffer; readonly typeMime: string }> {
    return this.acces.enTenant(ctx, async (tx) => {
      const { document } = await this.chargerFactureEtDocumentOu404Tx(tx, ctx, id);
      return { contenu: document.contenu, typeMime: document.typeMime };
    });
  }

  async valider(ctx: ContexteTenant, id: string): Promise<ReponseFactureFournisseur> {
    const utilisateurId = this.exigerUtilisateurId(ctx);
    return this.acces.enTenant(ctx, async (tx) => {
      const { facture, document } = await this.chargerFactureEtDocumentOu404Tx(tx, ctx, id);
      if (facture.statut === 'validee' || facture.statut === 'rejetee') {
        throw new ErreurMetier(
          'CONFLIT',
          `Facture déjà ${facture.statut === 'validee' ? 'validée' : 'rejetée'} — décision terminale.`,
        );
      }

      await tx
        .update(factureFournisseur)
        .set({ statut: 'validee', valideParId: utilisateurId, valideLe: new Date() })
        .where(and(eq(factureFournisseur.tenantId, ctx.tenantId), eq(factureFournisseur.id, id)));

      const audit: NouvelleFactureFournisseurAudit = {
        tenantId: ctx.tenantId,
        factureFournisseurId: id,
        utilisateurId,
        action: 'validation',
        valeurAvant: { statut: facture.statut },
        valeurApres: { statut: 'validee' },
      };
      await tx.insert(factureFournisseurAudit).values(audit);

      const { facture: factureMaj } = await this.chargerFactureEtDocumentOu404Tx(tx, ctx, id);
      const lignes = await tx
        .select()
        .from(factureFournisseurLigne)
        .where(
          and(
            eq(factureFournisseurLigne.tenantId, ctx.tenantId),
            eq(factureFournisseurLigne.factureFournisseurId, id),
          ),
        );
      return versFactureFournisseurResponse(factureMaj, document, lignes);
    });
  }

  async rejeter(
    ctx: ContexteTenant,
    id: string,
    motif: string,
  ): Promise<ReponseFactureFournisseur> {
    const utilisateurId = this.exigerUtilisateurId(ctx);
    return this.acces.enTenant(ctx, async (tx) => {
      const { facture, document } = await this.chargerFactureEtDocumentOu404Tx(tx, ctx, id);
      if (facture.statut === 'validee' || facture.statut === 'rejetee') {
        throw new ErreurMetier(
          'CONFLIT',
          `Facture déjà ${facture.statut === 'validee' ? 'validée' : 'rejetée'} — décision terminale.`,
        );
      }

      await tx
        .update(factureFournisseur)
        .set({ statut: 'rejetee', motifRejet: motif })
        .where(and(eq(factureFournisseur.tenantId, ctx.tenantId), eq(factureFournisseur.id, id)));

      const audit: NouvelleFactureFournisseurAudit = {
        tenantId: ctx.tenantId,
        factureFournisseurId: id,
        utilisateurId,
        action: 'rejet',
        valeurAvant: { statut: facture.statut },
        valeurApres: { statut: 'rejetee', motifRejet: motif },
      };
      await tx.insert(factureFournisseurAudit).values(audit);

      const { facture: factureMaj } = await this.chargerFactureEtDocumentOu404Tx(tx, ctx, id);
      const lignes = await tx
        .select()
        .from(factureFournisseurLigne)
        .where(
          and(
            eq(factureFournisseurLigne.tenantId, ctx.tenantId),
            eq(factureFournisseurLigne.factureFournisseurId, id),
          ),
        );
      return versFactureFournisseurResponse(factureMaj, document, lignes);
    });
  }

  private async chargerFactureEtDocumentOu404Tx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    id: string,
  ): Promise<{ facture: LigneFactureFournisseur; document: LigneFactureFournisseurDocument }> {
    const lignes = await tx
      .select()
      .from(factureFournisseur)
      .where(and(eq(factureFournisseur.tenantId, ctx.tenantId), eq(factureFournisseur.id, id)))
      .limit(1);
    const facture = lignes[0];
    if (!facture)
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Facture fournisseur introuvable.');

    const documents = await tx
      .select()
      .from(factureFournisseurDocument)
      .where(
        and(
          eq(factureFournisseurDocument.tenantId, ctx.tenantId),
          eq(factureFournisseurDocument.id, facture.documentId),
        ),
      )
      .limit(1);
    const document = documents[0];
    if (!document)
      throw new ErreurMetier('ERREUR_INTERNE', 'Document introuvable pour cette facture.');

    return { facture, document };
  }

  /** Fournisseurs du tenant (référentiel court, jamais paginé — voir `service-rapprochement.ts`). */
  private async rapprocherFournisseurTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    donnees: DonneesFactureExtraites,
  ): Promise<string | null> {
    if (!donnees.enTete.nomCreancier) return null;
    const candidats: CandidatFournisseur[] = (
      await tx
        .select({ id: fournisseur.id, nom: fournisseur.nom })
        .from(fournisseur)
        .where(eq(fournisseur.tenantId, ctx.tenantId))
    ).map((f) => ({ id: f.id, nom: f.nom }));

    return trouverFournisseurExact(donnees, candidats);
  }

  /** Commandes candidates D'UN SEUL fournisseur déjà identifié, avec reliquat par article — voir
   *  `service-rapprochement.ts#assemblerResultatRapprochement` pour pourquoi ce découpage. */
  private async chargerCommandeCandidateTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    fournisseurId: string,
    donnees: DonneesFactureExtraites,
  ): Promise<CandidatCommandeFournisseur | null> {
    const commandes = await tx
      .select({ id: commandeFournisseur.id, reference: commandeFournisseur.reference })
      .from(commandeFournisseur)
      .where(
        and(
          eq(commandeFournisseur.tenantId, ctx.tenantId),
          eq(commandeFournisseur.fournisseurId, fournisseurId),
          inArray(commandeFournisseur.statut, [...STATUTS_COMMANDE_AVEC_RELIQUAT]),
        ),
      );
    if (commandes.length === 0) return null;

    const commandeIds = commandes.map((c) => c.id);
    const lignesCommandes = await tx
      .select({
        id: commandeFournisseurLigne.id,
        commandeFournisseurId: commandeFournisseurLigne.commandeFournisseurId,
        articleId: commandeFournisseurLigne.articleId,
        quantiteCommandeeMillieme: commandeFournisseurLigne.quantiteCommandeeMillieme,
        quantiteRecueCumuleeMillieme: commandeFournisseurLigne.quantiteRecueCumuleeMillieme,
        reliquatAnnuleLe: commandeFournisseurLigne.reliquatAnnuleLe,
        prixAchatAttenduCentimes: commandeFournisseurLigne.prixAchatAttenduCentimes,
        // `referencePrincipale` (référence INTERNE de l'article, unique par tenant) — pas
        // `article_reference.reference` (références ALTERNATIVES, dont le type `fournisseur`
        // porte la référence propre au catalogue d'UN fournisseur donné, `contrats/pieces/
        // enums.ts`). Utiliser la référence spécifique au fournisseur rapproché serait plus
        // proche de ce qu'imprime réellement une facture — hors périmètre de ce lot, signalé
        // au rapport de livraison plutôt qu'ajouté sans échantillon réel pour le valider.
        referenceArticle: article.referencePrincipale,
      })
      .from(commandeFournisseurLigne)
      .innerJoin(
        article,
        and(
          eq(article.tenantId, commandeFournisseurLigne.tenantId),
          eq(article.id, commandeFournisseurLigne.articleId),
        ),
      )
      .where(
        and(
          eq(commandeFournisseurLigne.tenantId, ctx.tenantId),
          inArray(commandeFournisseurLigne.commandeFournisseurId, commandeIds),
        ),
      );

    const candidats: CandidatCommandeFournisseur[] = commandes.map((c) => ({
      id: c.id,
      reference: c.reference,
      lignes: lignesCommandes
        .filter((l) => l.commandeFournisseurId === c.id)
        .map((l) => ({
          id: l.id,
          articleId: l.articleId,
          referenceArticle: l.referenceArticle,
          quantiteReliquatMillieme: calculerReliquatMillieme(l),
          prixAchatAttenduCentimes: l.prixAchatAttenduCentimes,
        })),
    }));

    const idTrouve = trouverCommandeExacte(donnees, candidats);
    return candidats.find((c) => c.id === idTrouve) ?? null;
  }
}

function construireChampsOrigine(enTete: EnTeteFactureExtrait): ChampsOrigineFactureFournisseur {
  const resultat: {
    -readonly [K in keyof ChampsOrigineFactureFournisseur]?: ChampsOrigineFactureFournisseur[K];
  } = {};
  for (const cle of Object.keys(enTete) as (keyof EnTeteFactureExtrait)[]) {
    const champ = enTete[cle];
    if (champ) resultat[cle] = champ.origine;
  }
  return resultat;
}

function groupeParFacture(
  lignes: readonly LigneFactureFournisseurLigne[],
): Map<string, LigneFactureFournisseurLigne[]> {
  const groupes = new Map<string, LigneFactureFournisseurLigne[]>();
  for (const ligne of lignes) {
    const liste = groupes.get(ligne.factureFournisseurId) ?? [];
    liste.push(ligne);
    groupes.set(ligne.factureFournisseurId, liste);
  }
  return groupes;
}
