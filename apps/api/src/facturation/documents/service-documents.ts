import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  EntreeCreationDocumentVente,
  EntreeCreationLigneDocument,
  EntreeModificationDocumentVente,
  EntreeModificationLigneDocument,
  FiltresDocumentsVente,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import { documentVente, ligneDocument, type LigneDocumentVente, type LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { Horloge } from '../../common/horloge/horloge';
import { JETON_AUDIT, type ServiceAudit } from '../../common/audit';
import { JETON_IDEMPOTENCE, type ReponseMemorisable, type ResultatIdempotent, type ServiceIdempotence } from '../../common/idempotence';

import { calculerLigneDocument, calculerTotauxDocument } from './calcul-document';
import {
  chargerDocument,
  chargerDocumentPourEcriture,
  chargerLignePourEcriture,
  listerLignesDocument,
  listerVentilationTva,
} from './document-requetes';
import { versionDocumentVente } from './document-vente.etag';
import { traduireErreurDocument } from './erreurs-sql-document';
import { mapperDocument, mapperLigneDocument, type TotauxDocumentMappes } from './mappeurs';
import { chargerAdresseFacturationStructuree, chargerClientLigne, chargerPlaqueVehiculeCourante, chargerResumeUtilisateur, nomAfficheClient, verifierVehiculeExiste } from './references';

/** Statuts au-delà desquels une ligne ne peut plus être ajoutée/modifiée/supprimée (`MD-21`) — la
 *  base l'impose de toute façon (`ligne_document_verrouiller_document`) ; ce contrôle amont rend
 *  l'erreur lisible SANS aller-retour SQL pour le cas nominal (double-clic sur un écran périmé). */
function estDocumentModifiable(statut: LigneDocumentVente['statut']): boolean {
  return statut === 'brouillon';
}

@Injectable()
export class ServiceDocumentsVente {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_AUDIT) private readonly audit: ServiceAudit,
    private readonly horloge: Horloge,
  ) {}

  /**
   * `POST /documents-vente` — `Idempotency-Key` OBLIGATOIRE (`RF-9` : un brouillon ne consomme
   * aucun numéro, mais un double-clic comptoir ne doit pas produire deux brouillons quand même).
   *
   * `documentSourceId` (`devis` → `bon_commande`/`facture`, `RF-8`) : si posé, le document source
   * doit être dans l'état qui autorise sa transformation (`devis.statut = 'accepte'`,
   * `bon_commande.statut = 'emis'`) — sinon `DOCUMENT_SOURCE_DEJA_TRANSFORME` ou
   * `DOCUMENT_TRANSITION_INTERDITE`. Un `bon_commande` source est transitionné `emis → transforme`
   * DANS CETTE MÊME transaction (aucune séquence numérotée n'est brûlée par cette transition, la
   * table `transition_document_autorisee` la déclare `exige_motif = false`).
   *
   * SIMPLIFICATION SIGNALÉE : `entree.lignes` embarquées sont insérées telles quelles, avec
   * `remiseGlobaleRepartieCentimes = 0` (la remise globale n'est ventilée qu'à l'émission, `MD-59`)
   * — `POST /ordres-reparation/{id}/facturer` (recopie de lignes d'OR, `RF-81`) N'EST PAS
   * implémenté dans ce lot : hors du périmètre listé pour cette tâche (« créer un brouillon,
   * ajouter/modifier ses lignes, l'émettre, le transformer devis→facture, créer un avoir »).
   */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeCreationDocumentVente,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDocumentVente> }>> {
    return this.idempotence.executer(ctx, { methode: 'POST', chemin: '/documents-vente', cle: cleIdempotence, corps: entree }, async (tx) => {
      const clientLigne = await chargerClientLigne(tx, ctx, entree.clientId);
      if (entree.vehiculeId) await verifierVehiculeExiste(tx, ctx, entree.vehiculeId);

      if (entree.documentSourceId) {
        await this.transformerSource(tx, ctx, entree.documentSourceId, entree.typeDocument);
      }

      const maintenant = this.horloge.maintenant();
      const dateDocument = entree.dateDocument ?? maintenant.toISOString().slice(0, 10);
      const adresseFacturationFigee = (await chargerAdresseFacturationStructuree(tx, ctx, entree.clientId)) ?? {};

      const [doc] = await tx
        .insert(documentVente)
        .values({
          tenantId: ctx.tenantId,
          siteId: entree.siteId,
          typeDocument: entree.typeDocument,
          natureFacture: entree.typeDocument === 'facture' ? (entree.natureFacture ?? 'ordinaire') : 'ordinaire',
          clientId: entree.clientId,
          vehiculeId: entree.vehiculeId ?? null,
          documentSourceId: entree.documentSourceId ?? null,
          clientDesignationFigee: nomAfficheClient(clientLigne),
          clientIdeFige: clientLigne.ide,
          langueFigee: clientLigne.langue,
          adresseFacturationFigee,
          // Conditions de paiement figées (RF-04, PF-04) : SIMPLIFICATION SIGNALÉE — pas de capture
          // des conditions commerciales du client (`client_condition`) dans ce lot, contrairement à
          // `atelier/service-snapshot-or.ts` qui le fait pour l'OR. Laissé à `{}` : le champ existe
          // (`ValeursFigeesDocument.conditionsPaiement`), non peuplé.
          conditionsPaiementFigees: {},
          dateDocument,
          devise: entree.devise,
          remiseGlobaleSaisieCentimes: entree.remiseGlobaleSaisieCentimes != null ? BigInt(entree.remiseGlobaleSaisieCentimes) : null,
          remiseGlobalePourmille: entree.remiseGlobalePourmille ?? null,
        })
        .returning();
      if (!doc) throw new ErreurMetier('ERREUR_INTERNE', "L'insertion du document de vente n'a rendu aucune ligne.");

      let numeroOrdre = 1;
      for (const ligneEntree of entree.lignes) {
        await this.inserterLigne(tx, ctx, doc.id, numeroOrdre++, ligneEntree);
      }

      const document = await this.assemblerDocument(tx, ctx, principal.role, doc.id);
      return { statutHttp: 201, corps: { donnees: document, avertissements: [] } };
    });
  }

  async obtenirComplet(ctx: ContexteTenant, principal: PrincipalAuthentifie, documentId: string): Promise<ReponseDocumentVente> {
    return this.acces.enTenant(ctx, (tx) => this.assemblerDocument(tx, ctx, principal.role, documentId));
  }

  /** `PATCH /documents-vente/{id}` — brouillon uniquement (`MD-19`). `statut` reste en lecture
   *  seule, comme partout dans cette API. */
  async modifier(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    entree: EntreeModificationDocumentVente,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      if (!estDocumentModifiable(doc.statut)) {
        throw this.erreurVerrouille(doc);
      }

      if (entree.clientId && entree.clientId !== doc.clientId) {
        await chargerClientLigne(tx, ctx, entree.clientId);
      }
      if (entree.vehiculeId) await verifierVehiculeExiste(tx, ctx, entree.vehiculeId);

      try {
        await tx
          .update(documentVente)
          .set({
            ...(entree.clientId !== undefined ? { clientId: entree.clientId } : {}),
            ...(entree.vehiculeId !== undefined ? { vehiculeId: entree.vehiculeId ?? null } : {}),
            ...(entree.dateDocument !== undefined ? { dateDocument: entree.dateDocument } : {}),
            ...(entree.remiseGlobaleSaisieCentimes !== undefined
              ? { remiseGlobaleSaisieCentimes: entree.remiseGlobaleSaisieCentimes != null ? BigInt(entree.remiseGlobaleSaisieCentimes) : null }
              : {}),
            ...(entree.remiseGlobalePourmille !== undefined ? { remiseGlobalePourmille: entree.remiseGlobalePourmille ?? null } : {}),
          })
          .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId)));
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, documentId, doc.numero);
        if (traduite) throw traduite;
        throw erreur;
      }

      const document = await this.assemblerDocument(tx, ctx, principal.role, documentId);
      return { donnees: document, avertissements: [] };
    });
  }

  /** `GET /documents-vente` — SOUS-ENSEMBLE des filtres du contrat (`siteId`, `typeDocument`,
   *  `statut`, `clientId`, `vehiculeId`), tri `dateDocument:desc` par défaut. SIMPLIFICATION
   *  SIGNALÉE, même doctrine que `atelier/service-or.ts::lister` : `natureFacture`,
   *  `statutReglement`, `ordreReparationId`, les bornes de date et `q` ne sont pas câblés dans
   *  cette passe. Pagination par curseur d'offset opaque — volume d'un tenant, pas un flux
   *  illimité. */
  async lister(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    filtres: FiltresDocumentsVente,
    limite: number,
    curseur: string | undefined,
  ): Promise<{ donnees: readonly ReponseDocumentVente[]; curseurSuivant: string | null }> {
    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [eq(documentVente.tenantId, ctx.tenantId)];
      if (filtres.siteId) conditions.push(eq(documentVente.siteId, filtres.siteId));
      if (filtres.clientId) conditions.push(eq(documentVente.clientId, filtres.clientId));
      if (filtres.vehiculeId) conditions.push(eq(documentVente.vehiculeId, filtres.vehiculeId));
      if (filtres.typeDocument && filtres.typeDocument.length > 0) conditions.push(inArray(documentVente.typeDocument, filtres.typeDocument));
      if (filtres.statut && filtres.statut.length > 0) conditions.push(inArray(documentVente.statut, filtres.statut));

      const decalage = decoderCurseurOffset(curseur);
      const lignes = await tx
        .select()
        .from(documentVente)
        .where(and(...conditions))
        .orderBy(desc(documentVente.dateDocument), desc(documentVente.creeLe))
        .limit(limite + 1)
        .offset(decalage);

      const page = lignes.slice(0, limite);
      const suite = lignes.length > limite ? encoderCurseurOffset(decalage + limite) : null;

      const donnees = await Promise.all(page.map((l) => this.assemblerDocument(tx, ctx, principal.role, l.id)));
      return { donnees, curseurSuivant: suite };
    });
  }

  /* -------------------------------------------------------------------------------------------- */
  /* Lignes — POST/PATCH/DELETE, brouillon uniquement (MD-21)                                       */
  /* -------------------------------------------------------------------------------------------- */

  async ajouterLigne(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    entree: EntreeCreationLigneDocument,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      if (!estDocumentModifiable(doc.statut)) throw this.erreurVerrouille(doc);

      const existantes = await listerLignesDocument(tx, ctx, documentId);
      const numeroOrdre = (existantes.at(-1)?.numeroOrdre ?? 0) + 1;
      await this.inserterLigne(tx, ctx, documentId, numeroOrdre, entree);

      const document = await this.assemblerDocument(tx, ctx, principal.role, documentId);
      return { donnees: document, avertissements: [] };
    });
  }

  async modifierLigne(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    ligneId: string,
    entree: EntreeModificationLigneDocument,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      if (!estDocumentModifiable(doc.statut)) throw this.erreurVerrouille(doc);

      const ligneActuelle = await chargerLignePourEcriture(tx, ctx, documentId, ligneId);
      const fusionnee = this.fusionnerLigne(ligneActuelle, entree);
      const montants = calculerLigneDocument({
        prixUnitaireTtcCentimes: fusionnee.prixUnitaireTtcCentimes,
        quantiteMillieme: fusionnee.quantiteMillieme,
        remisePourmille: fusionnee.remisePourmille,
        remiseMontantCentimes: fusionnee.remiseMontantCentimes,
        remiseGlobaleRepartieCentimes: 0,
        tauxTvaPourmille: fusionnee.tauxTvaPourmille,
      });

      try {
        await tx
          .update(ligneDocument)
          .set({
            typeLigne: fusionnee.type,
            designation: fusionnee.designation,
            referenceTexte: fusionnee.referenceTexte,
            quantiteMillieme: fusionnee.quantiteMillieme,
            prixUnitaireCentimes: fusionnee.prixUnitaireTtcCentimes ?? 0,
            regimeTva: fusionnee.regimeTva,
            tauxTvaPourmille: fusionnee.tauxTvaPourmille,
            datePrestation: fusionnee.datePrestation,
            remisePourmille: fusionnee.remisePourmille,
            remiseMontantCentimes: fusionnee.remiseMontantCentimes,
            documentAcompteId: fusionnee.documentAcompteId ?? null,
            baseCentimes: montants.baseCentimes,
            htCentimes: montants.htCentimes,
            tvaCentimes: montants.tvaCentimes,
            ttcCentimes: montants.ttcCentimes,
          })
          .where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.id, ligneId)));
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, documentId, doc.numero);
        if (traduite) throw traduite;
        throw erreur;
      }

      const document = await this.assemblerDocument(tx, ctx, principal.role, documentId);
      return { donnees: document, avertissements: [] };
    });
  }

  /** `DELETE /documents-vente/{id}/lignes/{ligneId}` — brouillon uniquement (`MD-21`, privilège
   *  `[dfa:suppression-physique]` accordé à `dfa_app` sur `ligne_document`, migration 0012). */
  async supprimerLigne(ctx: ContexteTenant, principal: PrincipalAuthentifie, documentId: string, ligneId: string): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      if (!estDocumentModifiable(doc.statut)) throw this.erreurVerrouille(doc);
      await chargerLignePourEcriture(tx, ctx, documentId, ligneId);

      try {
        await tx.delete(ligneDocument).where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.id, ligneId)));
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, documentId, doc.numero);
        if (traduite) throw traduite;
        throw erreur;
      }

      const document = await this.assemblerDocument(tx, ctx, principal.role, documentId);
      return { donnees: document, avertissements: [] };
    });
  }

  /* -------------------------------------------------------------------------------------------- */
  /* Assemblage — appelé par ce service ET par service-emission.ts / service-avoir.ts, qui doivent  */
  /* tous renvoyer la même représentation (même patron que ServiceOr.assemblerDocument).            */
  /* -------------------------------------------------------------------------------------------- */

  async assemblerDocument(tx: TransactionDfa, ctx: ContexteTenant, role: PrincipalAuthentifie['role'], documentId: string): Promise<ReponseDocumentVente> {
    const doc = await chargerDocument(tx, ctx, documentId);
    const lignesToutes = await listerLignesDocument(tx, ctx, documentId);

    const brouillon = doc.statut === 'brouillon';
    const totaux: TotauxDocumentMappes = brouillon
      ? { ...calculerTotauxDocument(lignesToutes), ecartRepriseCentimes: 0 }
      : {
          totalHtCentimes: Number(doc.totalHtCentimes),
          totalTvaCentimes: Number(doc.totalTvaCentimes),
          totalTtcCentimes: Number(doc.totalTtcCentimes),
          ecartRepriseCentimes: Number(doc.ecartRepriseCentimes),
        };

    const ventilationTva = brouillon
      ? agregerLignesEnDirect(lignesToutes)
      : (await listerVentilationTva(tx, ctx, documentId)).map((v) => ({
          regimeTva: v.regimeTva,
          tauxTvaPourmille: v.tauxTvaPourmille,
          baseCentimes: v.baseCentimes,
          tvaCentimes: v.tvaCentimes,
        }));

    const figeesAdresse = adresseDepuisJsonb(doc.adresseFacturationFigee);
    const figeesPlaque = await chargerPlaqueVehiculeCourante(tx, ctx, doc.vehiculeId);

    const journalDoc = await this.audit.pourEntite(ctx, 'document_vente', documentId);
    const dernier = journalDoc.at(-1) ?? null;
    const modifiePar = await chargerResumeUtilisateur(tx, ctx, dernier?.utilisateurId ?? null);
    const entreeEmission = journalDoc.find((e) => (e.valeurApres as Record<string, unknown> | null)?.statut === 'emis');
    const emisPar = await chargerResumeUtilisateur(tx, ctx, entreeEmission?.utilisateurId ?? null);

    return mapperDocument({
      doc,
      lignesToutes,
      ventilationTva,
      role,
      figeesAdresse,
      figeesPlaque,
      emisPar,
      modifiePar,
      totaux,
      version: versionDocumentVente(doc.modifieLe),
    });
  }

  /* -------------------------------------------------------------------------------------------- */
  /* Aides internes                                                                                */
  /* -------------------------------------------------------------------------------------------- */

  private erreurVerrouille(doc: LigneDocumentVente): ErreurMetier {
    return new ErreurMetier('DOCUMENT_VERROUILLE', `Document verrouillé (statut ${doc.statut}) — seul un avoir permet une correction (MD-20).`, {
      blocages: [{ type: 'document_vente', id: doc.id, libelle: doc.numero ?? doc.id, donnees: { statutActuel: doc.statut } }],
      actionsProposees: [{ code: 'RAFRAICHIR' }],
    });
  }

  private async inserterLigne(tx: TransactionDfa, ctx: ContexteTenant, documentId: string, numeroOrdre: number, entree: EntreeCreationLigneDocument): Promise<LigneLigneDocument> {
    const montants = calculerLigneDocument({
      prixUnitaireTtcCentimes: entree.prixUnitaireTtcCentimes ?? null,
      quantiteMillieme: entree.quantiteMillieme,
      remisePourmille: entree.remisePourmille ?? null,
      remiseMontantCentimes: entree.remiseMontantCentimes ?? null,
      remiseGlobaleRepartieCentimes: 0,
      tauxTvaPourmille: entree.tauxTvaPourmille,
    });

    const [ligne] = await tx
      .insert(ligneDocument)
      .values({
        tenantId: ctx.tenantId,
        documentId,
        numeroOrdre,
        typeLigne: entree.type,
        designation: entree.designation,
        referenceTexte: entree.referenceTexte ?? null,
        documentAcompteId: entree.documentAcompteId ?? null,
        // Δ-RF40 (§0.2) : toute ligne saisie directement en facturation est TOUJOURS 'ttc' — champ
        // même pas exposé en entrée (voir la note de `ligne.ts` côté contrat), fixé ici.
        modeCalculTva: 'ttc',
        regimeTva: entree.regimeTva,
        tauxTvaPourmille: entree.tauxTvaPourmille,
        datePrestation: entree.datePrestation,
        quantiteMillieme: entree.quantiteMillieme,
        prixUnitaireCentimes: entree.prixUnitaireTtcCentimes ?? 0,
        remisePourmille: entree.remisePourmille ?? null,
        remiseMontantCentimes: entree.remiseMontantCentimes ?? null,
        remiseGlobaleRepartieCentimes: 0,
        baseCentimes: montants.baseCentimes,
        htCentimes: montants.htCentimes,
        tvaCentimes: montants.tvaCentimes,
        ttcCentimes: montants.ttcCentimes,
      })
      .returning();
    if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', "L'insertion de la ligne de document n'a rendu aucune ligne.");
    return ligne;
  }

  private fusionnerLigne(actuelle: LigneLigneDocument, entree: EntreeModificationLigneDocument) {
    return {
      type: entree.type ?? actuelle.typeLigne,
      designation: entree.designation ?? actuelle.designation,
      referenceTexte: entree.referenceTexte !== undefined ? (entree.referenceTexte ?? null) : actuelle.referenceTexte,
      quantiteMillieme: entree.quantiteMillieme ?? actuelle.quantiteMillieme,
      prixUnitaireTtcCentimes: entree.prixUnitaireTtcCentimes !== undefined ? entree.prixUnitaireTtcCentimes : actuelle.prixUnitaireCentimes,
      regimeTva: entree.regimeTva ?? actuelle.regimeTva,
      tauxTvaPourmille: entree.tauxTvaPourmille ?? actuelle.tauxTvaPourmille,
      datePrestation: entree.datePrestation ?? actuelle.datePrestation,
      remisePourmille: entree.remisePourmille !== undefined ? (entree.remisePourmille ?? null) : actuelle.remisePourmille,
      remiseMontantCentimes: entree.remiseMontantCentimes !== undefined ? (entree.remiseMontantCentimes ?? null) : actuelle.remiseMontantCentimes,
      documentAcompteId: entree.documentAcompteId !== undefined ? entree.documentAcompteId : actuelle.documentAcompteId,
    };
  }

  /**
   * `RF-8`/`MD-14` : valide et — pour un `bon_commande` — transitionne le document source DANS
   * cette même transaction, verrouillé (`for update`, posé par `chargerDocumentPourEcriture`).
   *
   * - `devis` source : doit être `statut = 'accepte'` (terminal, aucune transition à écrire —
   *   l'acceptation est un geste séparé, `POST /documents-vente/{id}/accepter`).
   * - `bon_commande` source : doit être `statut = 'emis'`, transitionné `→ 'transforme'` ici.
   * - tout autre `typeDocument` source (`facture`, `avoir`) : rejeté, `RF-8` ne les prévoit pas
   *   comme source d'un nouveau document dans la chaîne commerciale.
   *
   * L'index unique partiel `document_vente_source_uk` (migration §7.4) est le FILET : même si ce
   * contrôle applicatif laissait passer une seconde tentative concurrente, la base la refuserait —
   * traduite ici en `DOCUMENT_SOURCE_DEJA_TRANSFORME`.
   */
  private async transformerSource(tx: TransactionDfa, ctx: ContexteTenant, sourceId: string, typeDocumentCible: EntreeCreationDocumentVente['typeDocument']): Promise<void> {
    const source = await chargerDocumentPourEcriture(tx, ctx, sourceId);

    const dejaTransforme = await tx
      .select({ id: documentVente.id })
      .from(documentVente)
      .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.documentSourceId, sourceId)))
      .limit(1);
    if (dejaTransforme.length > 0) {
      throw new ErreurMetier('DOCUMENT_SOURCE_DEJA_TRANSFORME', 'Ce document source a déjà produit un document (RF-8) : un document source ne se transforme qu\'une fois.', {
        blocages: [{ type: 'document_vente', id: sourceId, libelle: source.numero ?? sourceId }],
        actionsProposees: [{ code: 'RAFRAICHIR' }],
      });
    }

    if (source.typeDocument === 'devis') {
      if (source.statut !== 'accepte') {
        throw new ErreurMetier('DOCUMENT_TRANSITION_INTERDITE', `Un devis ne peut servir de source qu'accepté (statut actuel : ${source.statut}).`, {
          blocages: [{ type: 'document_vente', id: sourceId, libelle: source.numero ?? sourceId, donnees: { statutActuel: source.statut } }],
        });
      }
      return;
    }

    if (source.typeDocument === 'bon_commande') {
      if (source.statut !== 'emis') {
        throw new ErreurMetier('DOCUMENT_TRANSITION_INTERDITE', `Un bon de commande ne peut servir de source qu'émis (statut actuel : ${source.statut}).`, {
          blocages: [{ type: 'document_vente', id: sourceId, libelle: source.numero ?? sourceId, donnees: { statutActuel: source.statut } }],
        });
      }
      try {
        await tx.update(documentVente).set({ statut: 'transforme' }).where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, sourceId)));
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, sourceId, source.numero);
        if (traduite) throw traduite;
        throw erreur;
      }
      return;
    }

    throw new ErreurMetier('VALIDATION_ECHOUEE', `Un document de type « ${source.typeDocument} » ne peut pas être document source (RF-8).`, {
      erreurs: [{ champ: 'documentSourceId', code: 'type_source_invalide', message: 'Seuls un devis accepté ou un bon de commande émis peuvent être source.' }],
    });
    // `typeDocumentCible` volontairement non exploité au-delà de la validation zod déjà passée
    // (schemaCreationDocumentVente) — aucune règle supplémentaire ne restreint QUEL type cible un
    // devis/bon_commande accepte en source (RF-7 : rien n'est obligatoire).
    void typeDocumentCible;
  }
}

/* ------------------------------------------------------------------ */
/* Curseur d'offset opaque — même mécanisme que atelier/service-or.ts   */
/* ------------------------------------------------------------------ */

export function encoderCurseurOffset(decalage: number): string {
  return Buffer.from(String(decalage), 'utf8').toString('base64url');
}

export function decoderCurseurOffset(curseur: string | undefined): number {
  if (!curseur) return 0;
  const brut = Number(Buffer.from(curseur, 'base64url').toString('utf8'));
  if (!Number.isInteger(brut) || brut < 0) {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [{ champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' }],
    });
  }
  return brut;
}

function agregerLignesEnDirect(lignes: readonly LigneLigneDocument[]): readonly { regimeTva: string; tauxTvaPourmille: number; baseCentimes: number; tvaCentimes: number }[] {
  const parClef = new Map<string, { regimeTva: string; tauxTvaPourmille: number; baseCentimes: number; tvaCentimes: number }>();
  for (const ligne of lignes) {
    const clef = `${ligne.regimeTva}|${String(ligne.tauxTvaPourmille)}`;
    const existant = parClef.get(clef);
    if (existant) {
      existant.baseCentimes += ligne.htCentimes;
      existant.tvaCentimes += ligne.tvaCentimes;
    } else {
      parClef.set(clef, { regimeTva: ligne.regimeTva, tauxTvaPourmille: ligne.tauxTvaPourmille, baseCentimes: ligne.htCentimes, tvaCentimes: ligne.tvaCentimes });
    }
  }
  return [...parClef.values()];
}

/** Exportée pour `qr-emission.ts` — même parsing du JSONB figé, réutilisé pour composer le bloc
 *  débiteur de la QR-facture à l'émission (`adresse_facturation_figee`, déjà figée à la création
 *  du document, `MD-24` : jamais recalculée). */
export function adresseDepuisJsonb(valeur: unknown): { rue: string; numero: string | null; npa: string; localite: string; pays: string } | null {
  if (typeof valeur !== 'object' || valeur === null) return null;
  const v = valeur as Record<string, unknown>;
  if (typeof v.rue !== 'string' || typeof v.npa !== 'string' || typeof v.localite !== 'string' || typeof v.pays !== 'string') return null;
  return { rue: v.rue, numero: typeof v.numero === 'string' ? v.numero : null, npa: v.npa, localite: v.localite, pays: v.pays };
}

// Réexporté pour service-emission.ts / service-avoir.ts.
export { mapperLigneDocument };
