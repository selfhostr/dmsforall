import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { schemaModificationLigneDocument } from '@dfa/shared';
import type {
  EntreeCreationDocumentVente,
  EntreeCreationLigneDocument,
  EntreeModificationDocumentVente,
  EntreeModificationLigneDocument,
  FiltresDocumentsVente,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
  RoleUtilisateur,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import {
  documentVente,
  ligneDocument,
  type LigneDocumentVente,
  type LigneLigneDocument,
} from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { Horloge } from '../../common/horloge/horloge';
import { JETON_AUDIT, type EntreeAudit, type ServiceAudit } from '../../common/audit';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../../common/idempotence';
// Import de CLASSE (jamais `import type`, règle du dépôt — l'injection casse à l'exécution, pas à
// la compilation) : `ServiceMouvement` est exporté par `PiecesModule` pour cette injection croisée
// (RP-43, pont vente comptoir — voir `facturation.module.ts` et la note d'intégration de
// `contrats/pieces/mouvement.ts`).
import { ServiceMouvement } from '../../pieces/service-mouvement';
// Import direct du fichier (jamais le barrel `../../recherche`) : ce dernier réexporte aussi
// `recherche.controller.ts`/`recherche.module.ts` — inutile ici et évite tout risque de dépendance
// circulaire entre `facturation/` et `recherche/`. `motifFragment` est une fonction PURE (voir son
// en-tête) : aucune connexion, aucun couplage NestJS.
import { motifFragment } from '../../recherche/utilitaires-recherche';
import { neGarderQueChampsEnvoyes, PipeZod } from '../../common/validation';

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
import {
  chargerAdresseFacturationStructuree,
  chargerClientLigne,
  chargerConditionsPaiementEnVigueur,
  chargerDossierVentePourRattachement,
  chargerPlaqueVehiculeCourante,
  chargerResumeUtilisateur,
  nomAfficheClient,
  verifierVehiculeExiste,
} from './references';

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
    private readonly serviceMouvement: ServiceMouvement,
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
   * SIMPLIFICATION qui reste vraie ICI (pas dans le reste de la chaîne) : `entree.lignes`
   * embarquées sont insérées telles quelles, avec `remiseGlobaleRepartieCentimes = 0` (la remise
   * globale n'est ventilée qu'à l'émission, `MD-59`). `POST /ordres-reparation/{id}/facturer`
   * (recopie de lignes d'OR, `RF-81`) EST implémenté depuis — voir `atelier/service-facturation-
   * or.ts::ServiceFacturationOr.facturer` — mais N'APPELLE PAS cette méthode `creer` : il insère
   * `document_vente`/`ligne_document` lui-même, hors de ce fichier.
   */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeCreationDocumentVente,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDocumentVente> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/documents-vente', cle: cleIdempotence, corps: entree },
      async (tx) => {
        const clientLigne = await chargerClientLigne(tx, ctx, entree.clientId);
        if (entree.vehiculeId) await verifierVehiculeExiste(tx, ctx, entree.vehiculeId);
        // RV-37/MD-70 : tenant + état vérifiés ICI, dans la transaction — un dossier étranger ou
        // fermé (clos/annule/abandonne) fait échouer la création AVANT toute écriture, même patron
        // que `verifierVehiculeExiste` juste au-dessus.
        if (entree.dossierVenteId) {
          await chargerDossierVentePourRattachement(tx, ctx, entree.dossierVenteId);
        }

        if (entree.documentSourceId) {
          await this.transformerSource(tx, ctx, entree.documentSourceId, entree.typeDocument);
        }

        const maintenant = this.horloge.maintenant();
        const dateDocument = entree.dateDocument ?? maintenant.toISOString().slice(0, 10);
        const adresseFacturationFigee =
          (await chargerAdresseFacturationStructuree(tx, ctx, entree.clientId)) ?? {};
        // RM-07 : conditions EN VIGUEUR à la date MÉTIER du document (`dateDocument`), pas à
        // l'horloge serveur — un brouillon antidaté doit figer les conditions de l'époque visée,
        // pas celles d'aujourd'hui (même principe que `atelier/service-snapshot-or.ts::capturer`).
        const conditionsPaiementFigees = await chargerConditionsPaiementEnVigueur(
          tx,
          ctx,
          entree.clientId,
          new Date(`${dateDocument}T00:00:00.000Z`),
        );

        const [doc] = await tx
          .insert(documentVente)
          .values({
            tenantId: ctx.tenantId,
            siteId: entree.siteId,
            typeDocument: entree.typeDocument,
            natureFacture:
              entree.typeDocument === 'facture'
                ? (entree.natureFacture ?? 'ordinaire')
                : 'ordinaire',
            clientId: entree.clientId,
            vehiculeId: entree.vehiculeId ?? null,
            dossierVenteId: entree.dossierVenteId ?? null,
            documentSourceId: entree.documentSourceId ?? null,
            clientDesignationFigee: nomAfficheClient(clientLigne),
            clientIdeFige: clientLigne.ide,
            langueFigee: clientLigne.langue,
            adresseFacturationFigee,
            // RF-04/PF-04 : conditions de paiement du client figées à la création (`delaiPaiementJours`
            // notamment — fonde le calcul de `date_echeance` à l'émission, `echeance.ts`). `{}` si aucune
            // ligne `client_condition` n'est en vigueur à `dateDocument` (client sans conditions
            // paramétrées) — jamais une échéance fabriquée à partir d'un défaut codé en dur, voir
            // l'en-tête de `echeance.ts`.
            conditionsPaiementFigees,
            dateDocument,
            devise: entree.devise,
            remiseGlobaleSaisieCentimes:
              entree.remiseGlobaleSaisieCentimes != null
                ? BigInt(entree.remiseGlobaleSaisieCentimes)
                : null,
            remiseGlobalePourmille: entree.remiseGlobalePourmille ?? null,
          })
          .returning();
        if (!doc)
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion du document de vente n'a rendu aucune ligne.",
          );

        let numeroOrdre = 1;
        for (const ligneEntree of entree.lignes) {
          await this.inserterLigne(tx, ctx, principal.role, doc.id, numeroOrdre++, ligneEntree);
        }

        const document = await this.assemblerDocument(tx, ctx, principal.role, doc.id);
        return { statutHttp: 201, corps: { donnees: document, avertissements: [] } };
      },
    );
  }

  async obtenirComplet(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
  ): Promise<ReponseDocumentVente> {
    return this.acces.enTenant(ctx, (tx) =>
      this.assemblerDocument(tx, ctx, principal.role, documentId),
    );
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
              ? {
                  remiseGlobaleSaisieCentimes:
                    entree.remiseGlobaleSaisieCentimes != null
                      ? BigInt(entree.remiseGlobaleSaisieCentimes)
                      : null,
                }
              : {}),
            ...(entree.remiseGlobalePourmille !== undefined
              ? { remiseGlobalePourmille: entree.remiseGlobalePourmille ?? null }
              : {}),
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

  /**
   * `GET /documents-vente` — TOUS les filtres de `FiltresDocumentsVente` sont câblés (`siteId`,
   * `typeDocument`, `natureFacture`, `statut`, `statutReglement`, `clientId`, `vehiculeId`,
   * `ordreReparationId`, `dateDocumentDu`/`dateDocumentAu`, `enRetard`, `relanceNiveau`, `q`), tri
   * `dateDocument:desc` par défaut. Défaut PRÉCÉDENT corrigé : `ordreReparationId` était ACCEPTÉ par
   * la validation zod mais jamais traduit en SQL — une fiche d'OR listait alors les cinq derniers
   * documents du TENANT ENTIER (aucune condition sur cette colonne), preuve obtenue en comparant un
   * OR réel à un `ordreReparationId` inexistant qui rendait rigoureusement la même liste.
   *
   * `natureFacture` : composé avec `typeDocument = 'facture'` — la colonne `document_vente
   * .nature_facture` vaut `'ordinaire'` par défaut sur TOUT document (`creer()` ci-dessus, y
   * compris un `devis`/`bon_commande`/`avoir`), alors que la RÉPONSE ne l'expose jamais que pour une
   * `facture` (`MD-12`, `mappeurs.ts` : `null` sinon). Filtrer `natureFacture=ordinaire` sans cette
   * condition renverrait aussi tout devis/bon de commande/avoir — un mensonge du même type que celui
   * corrigé ici pour `ordreReparationId`.
   *
   * `q` : MÊME idiome que `recherche/service-recherche.ts::chercherDocuments` et
   * `vehicules/service-vehicule.ts` — `public.normaliser_recherche()` des deux côtés du `LIKE`,
   * jamais une normalisation TypeScript reconstruite (elle divergerait de celle de la base). Porte
   * sur `numero` et `clientDesignationFigee`, comme documenté par le contrat. AUCUN index dédié
   * n'exploite `normaliser_recherche()` sur `document_vente` aujourd'hui (Bitmap Heap Scan au grand
   * volume, ~230 ms mesurés par `recherche/service-recherche.ts` sur 91k lignes) — tradeoff déjà
   * accepté ailleurs dans le dépôt pour la même colonne, pas réintroduit ni aggravé ici.
   *
   * Pagination par curseur d'offset opaque — volume d'un tenant, pas un flux illimité ; chaque
   * filtre supplémentaire ne fait que rétrécir la clause `where` commune aux deux appels
   * (page N puis N+1), sans toucher au mécanisme de curseur lui-même.
   */
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
      if (filtres.typeDocument && filtres.typeDocument.length > 0)
        conditions.push(inArray(documentVente.typeDocument, filtres.typeDocument));
      if (filtres.statut && filtres.statut.length > 0)
        conditions.push(inArray(documentVente.statut, filtres.statut));
      if (filtres.statutReglement && filtres.statutReglement.length > 0)
        conditions.push(inArray(documentVente.statutReglement, filtres.statutReglement));
      if (filtres.ordreReparationId)
        conditions.push(eq(documentVente.ordreReparationId, filtres.ordreReparationId));
      // `natureFacture` — voir la note de tête : composé avec `typeDocument = 'facture'` pour
      // matcher la sémantique de la RÉPONSE (`MD-12`), pas la valeur brute en colonne (toujours
      // renseignée, même hors facture).
      if (filtres.natureFacture)
        conditions.push(
          eq(documentVente.typeDocument, 'facture'),
          eq(documentVente.natureFacture, filtres.natureFacture),
        );
      // Bornes INCLUSES (convention `xDu`/`xAu` de toute l'API — voir le contrat).
      if (filtres.dateDocumentDu)
        conditions.push(gte(documentVente.dateDocument, filtres.dateDocumentDu));
      if (filtres.dateDocumentAu)
        conditions.push(lte(documentVente.dateDocument, filtres.dateDocumentAu));
      // `enRetard` — MÊME règle que `calculerRetardDocument` (`echeance.ts`), traduite en SQL :
      // `statut = 'emis'` (une facture `annule_par_avoir` garde une `date_echeance`/
      // `solde_centimes` d'avant son annulation, RF-32 ne les nettoie pas — sans cette condition
      // elle resterait « en retard » pour un montant qui n'est plus dû, même garde que
      // `relances/regles-planification.ts::factureEligibleRelance`), `date_echeance` renseignée et
      // strictement dépassée par rapport à AUJOURD'HUI (horloge injectée, jamais `Date.now()` en
      // dur — même doctrine que le reste de ce module), et un solde encore dû. `isNotNull` posé
      // explicitement bien que `lt` sur une colonne `null` exclue déjà la ligne (comparaison SQL
      // à `null` = `unknown`) : lisible sans connaître cette subtilité de NULL SQL.
      if (filtres.enRetard) {
        const aujourdHui = this.horloge.maintenant().toISOString().slice(0, 10);
        conditions.push(
          eq(documentVente.statut, 'emis'),
          isNotNull(documentVente.dateEcheance),
          lt(documentVente.dateEcheance, aujourdHui),
          gt(documentVente.soldeCentimes, 0n),
        );
      }
      // `relanceNiveau` — égalité stricte sur la colonne réelle `document_vente.relance_niveau`
      // (voir la note d'ambiguïté du contrat, `contrats/facturation/document.ts` : ce filtre ne
      // prétend pas modéliser à lui seul « eligible à la prochaine relance »).
      if (filtres.relanceNiveau !== undefined)
        conditions.push(eq(documentVente.relanceNiveau, filtres.relanceNiveau));
      // `q` — voir la note de tête : `numero` (nullable, `coalesce` défensif) et
      // `clientDesignationFigee` (`not null`), normalisés identiquement des deux côtés du `LIKE`.
      if (filtres.q) {
        const motif = motifFragment(filtres.q);
        conditions.push(sql`(
          public.normaliser_recherche(coalesce(${documentVente.numero}, '')) like public.normaliser_recherche(${motif})
          or public.normaliser_recherche(${documentVente.clientDesignationFigee}) like public.normaliser_recherche(${motif})
        )`);
      }

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

      // `pourListe = true` : voir la note sur `assemblerDocument` — évite d'ouvrir jusqu'à
      // `limite` (max 200) transactions d'audit imbriquées en parallèle sur une seule page
      // (épuisement du pool `pg`, `max 10` par défaut). Même correctif que
      // `atelier/service-or.ts::lister`.
      const donnees = await Promise.all(
        page.map((l) => this.assemblerDocument(tx, ctx, principal.role, l.id, true)),
      );
      return { donnees, curseurSuivant: suite };
    });
  }

  /* -------------------------------------------------------------------------------------------- */
  /* Lignes — POST/PATCH/DELETE, brouillon uniquement (MD-21)                                       */
  /* -------------------------------------------------------------------------------------------- */

  /**
   * `POST /documents-vente/{id}/lignes` — `Idempotency-Key` OBLIGATOIRE, même doctrine que `creer`
   * ci-dessus et tout le reste du module (`RP-43`) : une ligne `type = 'piece'` avec
   * `articleId`+`siteId` déclenche un mouvement de stock `sortie_comptoir` DANS LA MÊME TRANSACTION
   * que l'insertion de la ligne (`inserterLigne` ci-dessous) — sans idempotence, un rejeu réseau ou
   * un double-clic sortirait la pièce du stock une seconde fois EN PLUS de dupliquer la ligne.
   *
   * `corps` de la clé d'idempotence inclut `documentId` explicitement : `chemin` est un PATRON de
   * route (`/documents-vente/{id}/lignes`, jamais l'id interpolé — même convention que
   * `pieces/service-mouvement.ts`), donc rien d'autre ne distingue deux documents différents dans
   * l'empreinte calculée sur `corps`.
   */
  async ajouterLigne(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    entree: EntreeCreationLigneDocument,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDocumentVente> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/documents-vente/{id}/lignes',
        cle: cleIdempotence,
        corps: { documentId, ...entree },
      },
      async (tx) => {
        const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
        if (!estDocumentModifiable(doc.statut)) throw this.erreurVerrouille(doc);

        const existantes = await listerLignesDocument(tx, ctx, documentId);
        const numeroOrdre = (existantes.at(-1)?.numeroOrdre ?? 0) + 1;
        await this.inserterLigne(tx, ctx, principal.role, documentId, numeroOrdre, entree);

        const document = await this.assemblerDocument(tx, ctx, principal.role, documentId);
        return { statutHttp: 201, corps: { donnees: document, avertissements: [] } };
      },
    );
  }

  /**
   * DÉFAUT CRITIQUE CORRIGÉ (argent) : `schemaModificationLigneDocument` est un
   * `formeLigneDocument.partial()` — `.partial()` rend `quantiteMillieme`/`regimeTva`
   * OPTIONNELS, il n'annule PAS leurs `.default(1000)`/`.default('normal')` (même mécanisme que
   * F-01-bis, `common/validation/champs-envoyes.ts`). Avant ce correctif, le contrôleur parsait le
   * corps AVANT d'appeler ce service (`@CorpsZod`) : un `PATCH { designation: '…' }` qui ne touche
   * QUE le libellé ressortait du `.parse()` avec `quantiteMillieme: 1000`/`regimeTva: 'normal'`
   * PEU IMPORTE la ligne réelle — `fusionnerLigne` (`entree.quantiteMillieme ?? actuelle...`) ne
   * voyait donc jamais `undefined`, retenait TOUJOURS la valeur fantôme, et les montants étaient
   * recalculés (et facturés) sur cette base erronée. Corrigé en recevant désormais le CORPS BRUT
   * ici — jamais pré-parsé par le contrôleur (voir `document-vente.controller.ts`) — et en ne
   * retenant, après `.parse()`, que les clés RÉELLEMENT envoyées (`neGarderQueChampsEnvoyes`,
   * même patron que `ServiceClientSousCollections.modifierAdresse`).
   */
  async modifierLigne(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    ligneId: string,
    corpsBrut: Readonly<Record<string, unknown>>,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    this.exigerCorpsNonVide(corpsBrut);
    const entreeParsee = new PipeZod(schemaModificationLigneDocument).transform(corpsBrut);
    const entree = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);
    // Un corps qui ne porte QUE des clés inconnues (zod les retire silencieusement au parse) est
    // vide une fois filtré, même si `corpsBrut` ne l'était pas — même garde, second passage
    // (F-01, `ServiceClientSousCollections.modifierAdresse`).
    this.exigerCorpsNonVide(entree);
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      if (!estDocumentModifiable(doc.statut)) throw this.erreurVerrouille(doc);
      await this.refuserSiLigneStockLiee(tx, ctx, ligneId);

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
  async supprimerLigne(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    ligneId: string,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      if (!estDocumentModifiable(doc.statut)) throw this.erreurVerrouille(doc);
      await chargerLignePourEcriture(tx, ctx, documentId, ligneId);
      await this.refuserSiLigneStockLiee(tx, ctx, ligneId);

      try {
        await tx
          .delete(ligneDocument)
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

  /* -------------------------------------------------------------------------------------------- */
  /* Assemblage — appelé par ce service ET par service-emission.ts / service-avoir.ts, qui doivent  */
  /* tous renvoyer la même représentation (même patron que ServiceOr.assemblerDocument).            */
  /*                                                                                                */
  /* `pourListe` (déf. `false`) : quand `true` (uniquement depuis `lister()`), saute                */
  /* `this.audit.pourEntite` — lequel ouvre SA PROPRE transaction                                   */
  /* (`ServiceAuditImpl.pourEntite`, `common/audit/service-audit.ts`, hors périmètre de ce           */
  /* correctif). Appelé une fois par élément dans un `Promise.all` sur toute une page (`limite`      */
  /* max = 200), il peut réclamer ~200 connexions imbriquées d'un coup et épuiser le pool. Les       */
  /* seuls champs qui en dépendent sont `modifiePar` (dernier événement du journal) et `emisPar`     */
  /* (première transition vers `statut = 'emis'`) — des champs de RÉPONSE, jamais consultés par le  */
  /* calcul de statut/droits ni par un écran de LISTE (`EcranListeFactures.tsx` type ses lignes en   */
  /* `DocumentVenteResume`, sans `modifiePar`/`emisPar` ; seule la fiche document, assemblage        */
  /* unitaire avec `pourListe` par défaut `false`, les utilise). Les vider en liste (`null`, valeur  */
  /* déjà couverte par le type `{ ... } | null`) est donc sans perte réelle pour cette route, et     */
  /* supprime intégralement le problème (zéro requête d'audit) plutôt que de le déplacer.            */
  /* -------------------------------------------------------------------------------------------- */

  async assemblerDocument(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: PrincipalAuthentifie['role'],
    documentId: string,
    pourListe = false,
  ): Promise<ReponseDocumentVente> {
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

    const journalDoc = pourListe
      ? ([] as readonly EntreeAudit[])
      : await this.audit.pourEntite(ctx, 'document_vente', documentId);
    const dernier = journalDoc.at(-1) ?? null;
    const modifiePar = await chargerResumeUtilisateur(tx, ctx, dernier?.utilisateurId ?? null);
    const entreeEmission = journalDoc.find(
      (e) => (e.valeurApres as Record<string, unknown> | null)?.statut === 'emis',
    );
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
      // Instant de LECTURE, jamais stocké — sert uniquement à dériver `enRetard`/`joursRetard`
      // (`mappeurs.ts`) à l'instant de la réponse, comparaison pure sans second aller-retour base.
      maintenant: this.horloge.maintenant(),
    });
  }

  /* -------------------------------------------------------------------------------------------- */
  /* Aides internes                                                                                */
  /* -------------------------------------------------------------------------------------------- */

  /**
   * F-01/F-01-bis : un corps qui ne porte AUCUN champ (`{}`, ou un corps qui ne contient que des
   * clés inconnues — zod les a déjà retirées en amont) n'est pas une panne serveur, c'est une
   * entrée invalide. Même garde que `ServiceClientSousCollections.exigerCorpsNonVide`, dupliquée
   * localement (périmètre `facturation/`, pas de dépendance croisée vers `clients/` pour ça).
   */
  private exigerCorpsNonVide(entree: Readonly<Record<string, unknown>>): void {
    if (Object.keys(entree).length === 0) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Le corps de la requête ne contient aucun champ à modifier.',
        {
          erreurs: [
            {
              champ: '(corps)',
              code: 'corps_vide',
              message: 'Au moins un champ doit être fourni pour une modification.',
            },
          ],
        },
      );
    }
  }

  private erreurVerrouille(doc: LigneDocumentVente): ErreurMetier {
    return new ErreurMetier(
      'DOCUMENT_VERROUILLE',
      `Document verrouillé (statut ${doc.statut}) — seul un avoir permet une correction (MD-20).`,
      {
        blocages: [
          {
            type: 'document_vente',
            id: doc.id,
            libelle: doc.numero ?? doc.id,
            donnees: { statutActuel: doc.statut },
          },
        ],
        actionsProposees: [{ code: 'RAFRAICHIR' }],
      },
    );
  }

  /**
   * `role` (ajouté pour le pont RP-43) : nécessaire UNIQUEMENT pour construire la réponse du
   * mouvement de stock créé en effet de bord (`versMouvementResponse` masque
   * `prixAchatReelCentimes` par rôle, `pieces/mappers.ts`) — cette réponse n'est PAS renvoyée à
   * l'appelant de `inserterLigne` (qui ne renvoie que la ligne de document), mais le paramètre est
   * obligatoire côté `ServiceMouvement`, jamais optionnel.
   */
  private async inserterLigne(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    documentId: string,
    numeroOrdre: number,
    entree: EntreeCreationLigneDocument,
  ): Promise<LigneLigneDocument> {
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
    if (!ligne)
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        "L'insertion de la ligne de document n'a rendu aucune ligne.",
      );

    // RP-43 — LE PONT : `articleId`/`siteId` fournis ENSEMBLE (contrainte du contrat,
    // `schemaCreationLigneDocument`, réservée à `type = 'piece'`) déclenchent, DANS CETTE MÊME
    // TRANSACTION, le mouvement `sortie_comptoir` correspondant — un échec ici (stock insuffisant,
    // article/site introuvable) fait échouer `inserterLigne` tout entier, donc l'`INSERT` de la
    // ligne ci-dessus n'est jamais committé sans lui (atomicité par construction : même `tx`, même
    // callback `idempotence.executer`/`acces.enTenant`, rien n'intercepte cette exception plus
    // haut). Absents (cas le plus courant hors comptoir — forfait, main d'œuvre, débours, ou une
    // ligne `piece` sans article de référentiel), rien ne change par rapport à avant ce lot.
    if (entree.articleId != null && entree.siteId != null) {
      await this.serviceMouvement.sortieComptoirPourLigneTx(tx, ctx, role, {
        articleId: entree.articleId,
        siteId: entree.siteId,
        quantiteMillieme: entree.quantiteMillieme,
        documentVenteLigneId: ligne.id,
        motif: null,
      });
    }

    return ligne;
  }

  /** RP-43/RP-46 : refuse `409 LIGNE_DOCUMENT_STOCK_LIEE` si `ligneId` a déjà déclenché un
   *  mouvement de stock (`mouvement_stock.document_vente_ligne_id`) — le mouvement est IMMUABLE
   *  (RP-18), la ligne qui l'a fait naître le devient avec lui (voir la docstring de
   *  `articleId`/`siteId` dans `contrats/facturation/ligne.ts`). Appelée par `modifierLigne` ET
   *  `supprimerLigne` — un blocage UNIFORME, pas seulement sur les champs qui touchent au stock :
   *  toute écriture sur une telle ligne pourrait désynchroniser la quantité facturée de la quantité
   *  réellement sortie. */
  private async refuserSiLigneStockLiee(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligneId: string,
  ): Promise<void> {
    const mouvement = await this.serviceMouvement.trouverMouvementParLigneDocumentTx(
      tx,
      ctx,
      ligneId,
    );
    if (!mouvement) return;
    throw new ErreurMetier(
      'LIGNE_DOCUMENT_STOCK_LIEE',
      `La ligne ${ligneId} a déjà déclenché un mouvement de stock (${mouvement.type}) — immuable (RP-18), seule une suppression du document entier (brouillon) ou un avoir (document émis) permet une correction.`,
      {
        blocages: [
          {
            type: 'ligne_document',
            id: ligneId,
            libelle: ligneId,
            donnees: { mouvementId: mouvement.id, mouvementType: mouvement.type },
          },
        ],
      },
    );
  }

  private fusionnerLigne(actuelle: LigneLigneDocument, entree: EntreeModificationLigneDocument) {
    return {
      type: entree.type ?? actuelle.typeLigne,
      designation: entree.designation ?? actuelle.designation,
      referenceTexte:
        entree.referenceTexte !== undefined
          ? (entree.referenceTexte ?? null)
          : actuelle.referenceTexte,
      quantiteMillieme: entree.quantiteMillieme ?? actuelle.quantiteMillieme,
      prixUnitaireTtcCentimes:
        entree.prixUnitaireTtcCentimes !== undefined
          ? entree.prixUnitaireTtcCentimes
          : actuelle.prixUnitaireCentimes,
      regimeTva: entree.regimeTva ?? actuelle.regimeTva,
      tauxTvaPourmille: entree.tauxTvaPourmille ?? actuelle.tauxTvaPourmille,
      datePrestation: entree.datePrestation ?? actuelle.datePrestation,
      remisePourmille:
        entree.remisePourmille !== undefined
          ? (entree.remisePourmille ?? null)
          : actuelle.remisePourmille,
      remiseMontantCentimes:
        entree.remiseMontantCentimes !== undefined
          ? (entree.remiseMontantCentimes ?? null)
          : actuelle.remiseMontantCentimes,
      documentAcompteId:
        entree.documentAcompteId !== undefined
          ? entree.documentAcompteId
          : actuelle.documentAcompteId,
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
  private async transformerSource(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    sourceId: string,
    typeDocumentCible: EntreeCreationDocumentVente['typeDocument'],
  ): Promise<void> {
    const source = await chargerDocumentPourEcriture(tx, ctx, sourceId);

    const dejaTransforme = await tx
      .select({ id: documentVente.id })
      .from(documentVente)
      .where(
        and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.documentSourceId, sourceId)),
      )
      .limit(1);
    if (dejaTransforme.length > 0) {
      throw new ErreurMetier(
        'DOCUMENT_SOURCE_DEJA_TRANSFORME',
        "Ce document source a déjà produit un document (RF-8) : un document source ne se transforme qu'une fois.",
        {
          blocages: [{ type: 'document_vente', id: sourceId, libelle: source.numero ?? sourceId }],
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        },
      );
    }

    if (source.typeDocument === 'devis') {
      if (source.statut !== 'accepte') {
        throw new ErreurMetier(
          'DOCUMENT_TRANSITION_INTERDITE',
          `Un devis ne peut servir de source qu'accepté (statut actuel : ${source.statut}).`,
          {
            blocages: [
              {
                type: 'document_vente',
                id: sourceId,
                libelle: source.numero ?? sourceId,
                donnees: { statutActuel: source.statut },
              },
            ],
          },
        );
      }
      return;
    }

    if (source.typeDocument === 'bon_commande') {
      if (source.statut !== 'emis') {
        throw new ErreurMetier(
          'DOCUMENT_TRANSITION_INTERDITE',
          `Un bon de commande ne peut servir de source qu'émis (statut actuel : ${source.statut}).`,
          {
            blocages: [
              {
                type: 'document_vente',
                id: sourceId,
                libelle: source.numero ?? sourceId,
                donnees: { statutActuel: source.statut },
              },
            ],
          },
        );
      }
      try {
        await tx
          .update(documentVente)
          .set({ statut: 'transforme' })
          .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, sourceId)));
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, sourceId, source.numero);
        if (traduite) throw traduite;
        throw erreur;
      }
      return;
    }

    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      `Un document de type « ${source.typeDocument} » ne peut pas être document source (RF-8).`,
      {
        erreurs: [
          {
            champ: 'documentSourceId',
            code: 'type_source_invalide',
            message: 'Seuls un devis accepté ou un bon de commande émis peuvent être source.',
          },
        ],
      },
    );
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
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return brut;
}

function agregerLignesEnDirect(lignes: readonly LigneLigneDocument[]): readonly {
  regimeTva: string;
  tauxTvaPourmille: number;
  baseCentimes: number;
  tvaCentimes: number;
}[] {
  const parClef = new Map<
    string,
    { regimeTva: string; tauxTvaPourmille: number; baseCentimes: number; tvaCentimes: number }
  >();
  for (const ligne of lignes) {
    const clef = `${ligne.regimeTva}|${String(ligne.tauxTvaPourmille)}`;
    const existant = parClef.get(clef);
    if (existant) {
      existant.baseCentimes += ligne.htCentimes;
      existant.tvaCentimes += ligne.tvaCentimes;
    } else {
      parClef.set(clef, {
        regimeTva: ligne.regimeTva,
        tauxTvaPourmille: ligne.tauxTvaPourmille,
        baseCentimes: ligne.htCentimes,
        tvaCentimes: ligne.tvaCentimes,
      });
    }
  }
  return [...parClef.values()];
}

/** Exportée pour `qr-emission.ts` — même parsing du JSONB figé, réutilisé pour composer le bloc
 *  débiteur de la QR-facture à l'émission (`adresse_facturation_figee`, déjà figée à la création
 *  du document, `MD-24` : jamais recalculée). */
export function adresseDepuisJsonb(
  valeur: unknown,
): { rue: string; numero: string | null; npa: string; localite: string; pays: string } | null {
  if (typeof valeur !== 'object' || valeur === null) return null;
  const v = valeur as Record<string, unknown>;
  if (
    typeof v.rue !== 'string' ||
    typeof v.npa !== 'string' ||
    typeof v.localite !== 'string' ||
    typeof v.pays !== 'string'
  )
    return null;
  return {
    rue: v.rue,
    numero: typeof v.numero === 'string' ? v.numero : null,
    npa: v.npa,
    localite: v.localite,
    pays: v.pays,
  };
}

// Réexporté pour service-emission.ts / service-avoir.ts.
export { mapperLigneDocument };
