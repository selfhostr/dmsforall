/**
 * Service d'orchestration du déclenchement d'export fiduciaire — le maillon manquant identifié à
 * la livraison de `winbiz/` (voir l'en-tête de `export.module.ts`) : sélectionne les documents de
 * vente ÉMIS et NON ENCORE EXPORTÉS d'un tenant sur une période, construit les écritures (MD-84),
 * produit le fichier via l'adaptateur (`WinbizExporteurService`, seule cible câblée à ce jour), et
 * marque les documents exportés.
 *
 * --- Cibles supportées -----------------------------------------------------------------------
 * `CIBLES_EXPORT` (`@dfa/shared`) liste `bexio`/`winbiz`/`abacus`/`banana`/`csv`, mais SEUL
 * `winbiz` a un adaptateur écrit (`export/winbiz/`). Les quatre autres échouent PROPREMENT
 * (`FONCTION_NON_DISPONIBLE`) — jamais un fichier vide ou approximatif (consigne explicite de la
 * tâche). Le point d'extension pour un futur adaptateur est le dispatch en tête de `lancer()`
 * (`if (entree.cible !== 'winbiz')`, à faire évoluer vers un registre par cible), pas
 * `construireEcritureDocument` (cœur, agnostique de la cible).
 *
 * --- Granularité -------------------------------------------------------------------------------
 * Seul le mode `detaille` (une écriture par document, MD-88) est implémenté. `agrege` (une
 * écriture par jour × compte × taux) exigerait un regroupement inter-documents entièrement
 * différent, non construit dans ce lot — demandé, il échoue `FONCTION_NON_DISPONIBLE` plutôt que
 * d'être approximé par un simple relabelling du mode détaillé.
 *
 * --- `WINBIZ_TVA_METH` — PAS un point ouvert à ce niveau -----------------------------------------
 * Signalé dans la consigne de cette tâche comme non tranché ; mesuré avant d'affirmer (voir le
 * rapport de livraison) : `export/winbiz/winbiz.constantes.ts` a DÉJÀ tranché et testé au niveau
 * octet (`winbiz-serialiseur.spec.ts`) la valeur `TVA_meth` de la colonne 14 du canal WinBIZ, avec
 * son propre avertissement documenté (« à vérifier sur un dossier réel »). Cette question ne
 * concerne QUE la représentation interne d'une ligne de TVA dans LE CANAL WinBIZ — elle ne
 * remonte jamais jusqu'ici : `EcritureExport`/`LigneEcritureExport` (le contrat que ce service
 * produit) porte des montants HT/TVA/TTC déjà désambiguïsés (MD-84 : « aucun adaptateur ne
 * recalcule un montant »), jamais une figure composée que WinBIZ devrait lui-même décomposer.
 * Ce service n'introduit donc AUCUNE configuration supplémentaire pour ce point — la rouvrir ici
 * dupliquerait une décision déjà prise et testée dans le domaine qui la possède.
 *
 * --- Multi-lot (> 100 Ko, `TAILLE_MAX_LOT_OCTETS_WINBIZ`) -----------------------------------------
 * `export_comptable` est UNE ligne = UN lot transmis (`empreinte_sha256`, `nb_ecritures`,
 * `total_debit/credit_centimes` — une seule valeur de chacun par ligne). Quand
 * `WinbizExporteurService.genererLots` doit scinder en plusieurs fichiers, ce service ouvre UNE
 * ligne `export_comptable` PAR LOT et marque chaque document avec l'`export_id` du lot qui
 * contient RÉELLEMENT son écriture — jamais un id de lot arbitraire. Le pilote (un seul garage)
 * n'atteindra vraisemblablement jamais ce seuil, mais le traiter faux serait un mécompte
 * découvert au bouclement (MD-92/93), pas une approximation acceptable.
 *
 * --- Granularité du suivi d'export côté paiement — migration 0019 (MD-91) -------------------------
 * Trouvaille du lot précédent, tranchée côté produit et posée en base par la migration 0019 :
 * l'ÉVÉNEMENT comptable qui produit une écriture n'est ni le document (immuable) ni le paiement en
 * tant que tel (un encaissement peut rester en attente d'affectation, puis recevoir de NOUVELLES
 * imputations bien APRÈS avoir déjà été exporté — avance client affectée plus tard à une facture
 * qui n'existait pas encore) — c'est l'IMPUTATION. Le suivi porte donc sur DEUX colonnes désormais,
 * avec des rôles distincts et non interchangeables :
 *   - `imputation_paiement.exporteLe`/`exportId` — la SOURCE DE VÉRITÉ pour la sélection des
 *     candidats : ce qui n'a jamais été exporté part au prochain lot, quel que soit l'état de son
 *     paiement.
 *   - `paiement.exporteLe`/`exportId` — CONSERVÉE (migration 0019, expand sans contract), mais
 *     re-sémantisée : elle ne dit plus « ce paiement est exporté », elle dit « le CASH de ce
 *     paiement a déjà été transmis » — la seule information qui empêche de compter deux fois le
 *     même encaissement quand une imputation tardive du même paiement part dans un lot ultérieur
 *     (voir `construireEcriturePaiement`, paramètre `financierNouveauCetExport`). Un paiement peut
 *     donc apparaître dans plusieurs lots au fil du temps, sans jamais reposer sa ligne financière.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, inArray, isNull, sql } from 'drizzle-orm';
import { gzipSync } from 'node:zlib';
import type {
  CibleExport,
  DocumentExporte,
  EcritureExport,
  EntreeLancerExport,
  ImputationExportee,
  LotExportProduit,
  PaiementExporte,
  ReponseAvecAvertissements,
  ReponseExportComptable,
} from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import {
  documentVente,
  documentVenteTva,
  exportComptable,
  exportComptableFichier,
  imputationPaiement,
  ligneDocument,
  paiement,
  site,
  type LigneDocumentVente,
  type LigneDocumentVenteTva,
  type LigneImputationPaiement,
  type LigneLigneDocument,
  type LignePaiement,
} from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';
import { Horloge } from '../../common/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../../common/idempotence';

import {
  decrireTrous,
  trouverTrousNumerotation,
  type CandidatContinuite,
  type TrouDetecte,
} from './continuite/verification-continuite';
import { CsvExporteurService } from './csv';
import { ErreurEcritureDesequilibree } from './ecritures/erreur-desequilibre';
import {
  blocagesDesequilibres,
  blocagesLimites,
  blocagesMapping,
  blocagesTrous,
  type DiagnosticExport,
} from './prerequis/prerequis-export';
import { construireEcritureDocument } from './ecritures/construction-ecriture';
import { decrireBesoinManquant, type BesoinMappingManquant } from './ecritures/comptes-resolus';
import {
  construireEcriturePaiement,
  decrireLimitePaiement,
  type DocumentPourEcriturePaiement,
  type LimiteEcriturePaiement,
} from './ecritures/construction-ecriture-paiement';
import { chargerCodesTva, chargerComptesResolusADate } from './mapping/chargement-mapping';
import { ErreurExportWinbiz, WinbizExporteurService } from './winbiz';

/** Types de document qui produisent des écritures comptables (MD-84) — `devis`/`bon_commande` ne
 *  sont pas des ventes réalisées, ils ne sont jamais candidats à l'export. */
const TYPES_DOCUMENT_EXPORTABLES = ['facture', 'avoir'] as const;
type TypeDocumentExportable = (typeof TYPES_DOCUMENT_EXPORTABLES)[number];

/** RF-32 : une facture annulée par avoir garde sa place dans la série et doit, elle aussi, finir
 *  par être exportée — donc candidate au même titre qu'un document toujours `emis`. */
const STATUTS_EXPORTABLES = ['emis', 'annule_par_avoir'] as const;

/** Contrat de réponse porté par `@dfa/shared` (`contrats/facturation/export-fiduciaire.ts`) —
 *  ré-exporté ici pour les DTO Swagger et les tests de ce domaine. */
export type {
  DocumentExporte,
  ImputationExportee,
  LotExportProduit,
  PaiementExporte,
  ReponseExportComptable,
};

/** Plafond du fichier conservé (gzip) — miroir du CHECK de `export_comptable_fichier` (0084). */
const PLAFOND_FICHIER_GZ_OCTETS = 16 * 1024 * 1024;

/** Lot sérialisé, indépendant de la cible (structure commune WinBIZ / CSV). */
interface LotFichier {
  readonly contenu: Buffer;
  readonly nomFichier: string;
  readonly nbEcritures: number;
  readonly nbLignesCsv: number;
  readonly totalDebitCentimes: bigint;
  readonly totalCreditCentimes: bigint;
  readonly empreinteSha256: string;
  readonly avertissements: readonly { readonly message: string }[];
}

/** Ce que `preparer` sait de la période, SANS rien lever ni écrire : socle commun de l'aperçu et du
 *  déclenchement. */
export interface PreparationExport {
  readonly candidats: readonly LigneDocumentVente[];
  readonly infosCandidats: readonly CandidatContinuite[];
  readonly imputations: readonly LigneImputationPaiement[];
  readonly paiementsFinancierNouveau: readonly LignePaiement[];
  readonly ecritures: readonly EcritureExport[];
  /** `reference` d'écriture → désignation du client (document) ou du payeur (paiement). */
  readonly clientParReference: ReadonlyMap<string, string>;
  readonly diagnostic: DiagnosticExport;
}

function estTypeDocumentExportable(t: string): t is TypeDocumentExportable {
  return (TYPES_DOCUMENT_EXPORTABLES as readonly string[]).includes(t);
}

@Injectable()
export class ServiceExportComptable {
  constructor(
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly winbiz: WinbizExporteurService,
    private readonly csv: CsvExporteurService,
    private readonly horloge: Horloge,
  ) {}

  /**
   * Point d'entrée unique — `POST /exports-fiduciaires` (contrat `schemaLancerExport`,
   * `packages/shared`). `Idempotency-Key` : mémorisation complète (statut + corps) via le même
   * mécanisme que `ServicePaiement`/`ServiceEmissionDocument` — un rejeu réseau ne produit jamais
   * un second export ni un second marquage (MD-92 : « un document déjà exporté ne peut pas être
   * ré-exporté sans une action explicite et tracée » — un REJEU n'est justement PAS un tel geste).
   */
  async lancer(
    ctx: ContexteTenant,
    entree: EntreeLancerExport,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseExportComptable> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/exports-fiduciaires', cle: cleIdempotence, corps: entree },
      async (tx) => {
        if (entree.cible !== 'winbiz' && entree.cible !== 'csv') {
          const message = `Aucun adaptateur d'export n'est câblé pour la cible « ${entree.cible} » — seuls winbiz et csv sont disponibles.`;
          throw new ErreurMetier('FONCTION_NON_DISPONIBLE', message, { detail: message });
        }
        if (entree.granularite !== undefined && entree.granularite !== 'detaille') {
          const message = `Le mode d'agrégation « ${entree.granularite} » n'est pas implémenté — seul detaille l'est dans ce lot.`;
          throw new ErreurMetier('FONCTION_NON_DISPONIBLE', message, { detail: message });
        }

        if (entree.periodeAu < entree.periodeDu) {
          throw new ErreurMetier('VALIDATION_ECHOUEE', 'La fin de période précède son début.', {
            erreurs: [
              {
                champ: 'periodeAu',
                code: 'periode_inversee',
                message: 'La fin de période précède son début.',
              },
            ],
          });
        }
        const preparation = await this.preparer(tx, ctx, entree);
        const {
          candidats,
          infosCandidats,
          imputations: imputationsCandidates,
          paiementsFinancierNouveau,
          ecritures,
          clientParReference,
          diagnostic,
        } = preparation;
        if (
          candidats.length === 0 &&
          imputationsCandidates.length === 0 &&
          paiementsFinancierNouveau.length === 0
        ) {
          return {
            statutHttp: 200,
            corps: {
              donnees: {
                lots: [],
                documentsExportes: [],
                paiementsExportes: [],
                imputationsExportees: [],
              },
              avertissements: [],
            },
          };
        }

        // Prérequis bloquants. Les éléments utiles (numéros, comptes, montants) voyagent dans
        // `blocages[].donnees` : le front n'affiche jamais `detail` (convention), `detail` ne sert
        // qu'au support et aux logs.
        if (diagnostic.trous.length > 0) {
          const message = `Trou de numérotation détecté avant export : ${decrireTrous(diagnostic.trous)} — émis, non exportés, et absents de ce lot (hors période ou déjà traités séparément).`;
          throw new ErreurMetier('EXPORT_TROU_NUMEROTATION', message, {
            detail: message,
            blocages: blocagesTrous(diagnostic.trous),
          });
        }
        if (diagnostic.manquants.length > 0) {
          const nommes = diagnostic.manquants.slice(0, 20).map(decrireBesoinManquant);
          const message =
            `Mapping comptable incomplet pour ${String(diagnostic.manquants.length)} élément(s) — export refusé en bloc plutôt que partiel : ` +
            nommes.join(' ; ') +
            (diagnostic.manquants.length > 20
              ? ` … et ${String(diagnostic.manquants.length - 20)} de plus.`
              : '');
          throw new ErreurMetier('EXPORT_MAPPING_INCOMPLET', message, {
            detail: message,
            blocages: blocagesMapping(diagnostic.manquants),
          });
        }
        if (diagnostic.desequilibres.length > 0) {
          const message = `Écritures déséquilibrées (MD-85) : ${diagnostic.desequilibres.map((e) => e.message).join(' ; ')}`;
          throw new ErreurMetier('EXPORT_ECRITURES_DESEQUILIBREES', message, {
            detail: message,
            blocages: blocagesDesequilibres(diagnostic.desequilibres),
          });
        }
        // Distinct de `manquants` (paramétrage rattrapable) : ce que ce lot logiciel ne sait PAS
        // construire du tout (compensation, escompte/perte multi-taux — voir l'en-tête de
        // `construction-ecriture-paiement.ts`). `FONCTION_NON_DISPONIBLE`, jamais une écriture
        // devinée et fausse.
        if (diagnostic.limites.length > 0) {
          const nommees = diagnostic.limites.slice(0, 20).map(decrireLimitePaiement);
          const message =
            `Construction d'écriture de paiement non prise en charge pour ${String(diagnostic.limites.length)} imputation(s) — export refusé en bloc : ` +
            nommees.join(' ; ') +
            (diagnostic.limites.length > 20
              ? ` … et ${String(diagnostic.limites.length - 20)} de plus.`
              : '');
          throw new ErreurMetier('FONCTION_NON_DISPONIBLE', message, {
            detail: message,
            blocages: blocagesLimites(diagnostic.limites),
          });
        }

        const lot = this.produireLot(entree, ecritures, clientParReference);
        const contenuGz = gzipSync(lot.contenu);
        if (contenuGz.length > PLAFOND_FICHIER_GZ_OCTETS) {
          const message = `Le fichier produit (${String(contenuGz.length)} octets compressés) dépasse le plafond de conservation de ${String(PLAFOND_FICHIER_GZ_OCTETS)} octets : réduire la période demandée.`;
          throw new ErreurMetier('FONCTION_NON_DISPONIBLE', message, { detail: message });
        }
        const synthese = syntheseDocuments(candidats);

        const [ligneExport] = await tx
          .insert(exportComptable)
          .values({
            tenantId: ctx.tenantId,
            cible: entree.cible,
            mode: 'detaille',
            periodeDebut: entree.periodeDu,
            periodeFin: entree.periodeAu,
            genereParId: ctx.utilisateurId,
            nbEcritures: lot.nbEcritures,
            totalDebitCentimes: lot.totalDebitCentimes,
            totalCreditCentimes: lot.totalCreditCentimes,
            empreinteSha256: lot.empreinteSha256,
            statut: 'genere',
            nbFactures: synthese.nbFactures,
            nbAvoirs: synthese.nbAvoirs,
            nbEncaissements: paiementsFinancierNouveau.length,
            totalHtCentimes: synthese.totalHtCentimes,
            totalTvaCentimes: synthese.totalTvaCentimes,
            totalTtcCentimes: synthese.totalTtcCentimes,
            facturePremier: synthese.facturePremier,
            factureDernier: synthese.factureDernier,
            avoirPremier: synthese.avoirPremier,
            avoirDernier: synthese.avoirDernier,
          })
          .returning();
        if (!ligneExport) {
          const message = "Échec de l'enregistrement du lot d'export.";
          throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
        }

        // Fichier conservé (gzip, table séparée 0084) : permet `GET /exports-fiduciaires/{id}/fichier`
        // à l'identique, empreinte SHA-256 vérifiable.
        await tx.insert(exportComptableFichier).values({
          tenantId: ctx.tenantId,
          exportId: ligneExport.id,
          nomFichier: lot.nomFichier,
          typeMime: typeMimeCible(entree.cible),
          tailleOctets: lot.contenu.length,
          contenuGz,
        });

        // Marquage `exporte_le`/`export_id` — la SEULE écriture possible sur un document verrouillé
        // (MD-20), un paiement immuable (MD-52, `paiement_verrouiller`) ou une imputation immuable
        // (`imputation_paiement_verrouiller`, migration 0019) : ces trois entités listent explicitement
        // ces deux colonnes comme seules modifiables après création. Un export transmis est définitif
        // (`EXPORT_DEJA_TRANSMIS`, MD-92) — c'est ce marquage, sur les TROIS tables, qui l'empêche de
        // repartir. Fait dans le MÊME `tx` que l'insertion de `export_comptable` ci-dessus : soit les
        // quatre écritures (le lot, les documents, les paiements, les imputations) commitent
        // ensemble, soit aucune. `paiement.exporteLe` ne marque QUE les paiements dont le CASH part
        // dans CE lot (`paiementsFinancierNouveau`, migration 0019 §« Granularité du suivi ») — jamais
        // un paiement qui n'apparaît que via une imputation tardive, son cash étant déjà transmis.
        const idsCandidats = infosCandidats.map((c) => c.id);
        const idsPaiementsFinancierNouveau = paiementsFinancierNouveau.map((p) => p.id);
        const idsImputations = imputationsCandidates.map((i) => i.id);
        await Promise.all([
          idsCandidats.length > 0
            ? tx
                .update(documentVente)
                .set({ exporteLe: this.horloge.maintenant(), exportId: ligneExport.id })
                .where(
                  and(
                    eq(documentVente.tenantId, ctx.tenantId),
                    inArray(documentVente.id, idsCandidats),
                  ),
                )
            : Promise.resolve(),
          idsPaiementsFinancierNouveau.length > 0
            ? tx
                .update(paiement)
                .set({ exporteLe: this.horloge.maintenant(), exportId: ligneExport.id })
                .where(
                  and(
                    eq(paiement.tenantId, ctx.tenantId),
                    inArray(paiement.id, idsPaiementsFinancierNouveau),
                  ),
                )
            : Promise.resolve(),
          idsImputations.length > 0
            ? tx
                .update(imputationPaiement)
                .set({ exporteLe: this.horloge.maintenant(), exportId: ligneExport.id })
                .where(
                  and(
                    eq(imputationPaiement.tenantId, ctx.tenantId),
                    inArray(imputationPaiement.id, idsImputations),
                  ),
                )
            : Promise.resolve(),
        ]);

        const reponse: ReponseExportComptable = {
          lots: [
            {
              exportId: ligneExport.id,
              cible: entree.cible,
              nomFichier: lot.nomFichier,
              nbEcritures: lot.nbEcritures,
              nbLignesCsv: lot.nbLignesCsv,
              totalDebitCentimes: lot.totalDebitCentimes.toString(),
              totalCreditCentimes: lot.totalCreditCentimes.toString(),
              empreinteSha256: lot.empreinteSha256,
              contenuBase64: lot.contenu.toString('base64'),
              avertissements: lot.avertissements.map((a) => a.message),
            },
          ],
          documentsExportes: infosCandidats.map((c) => ({
            id: c.id,
            numero: c.numero,
            typeDocument: c.typeDocument,
          })),
          paiementsExportes: paiementsFinancierNouveau.map((p) => ({ id: p.id, moyen: p.moyen })),
          imputationsExportees: imputationsCandidates.map((i) => ({
            id: i.id,
            paiementId: i.paiementId,
            documentId: i.documentId,
          })),
        };
        return { statutHttp: 201, corps: { donnees: reponse, avertissements: [] } };
      },
    );
  }

  private nomFichier(entree: EntreeLancerExport, indexLot: number): string {
    return `dfa-export-${entree.cible}-${entree.periodeDu}-au-${entree.periodeAu}-lot${String(indexLot + 1)}.csv`;
  }

  /** Sérialise selon la cible. WinBIZ peut exiger plusieurs fichiers (100 Ko) : non supporté ici. */
  private produireLot(
    entree: EntreeLancerExport,
    ecritures: readonly EcritureExport[],
    clientParReference: ReadonlyMap<string, string>,
  ): LotFichier {
    if (entree.cible === 'csv') {
      return this.csv.genererLot(
        ecritures,
        `dfa-export-csv-${entree.periodeDu}-au-${entree.periodeAu}.csv`,
        clientParReference,
      );
    }
    let lots: ReturnType<WinbizExporteurService['genererLots']>;
    try {
      lots = this.winbiz.genererLots(ecritures, (index) => this.nomFichier(entree, index));
    } catch (e) {
      // L'adaptateur WinBIZ est sans dépendance Nest (donc sans `ErreurMetier`) : on traduit ici,
      // au bord, plutôt qu'un 500 pour une écriture que le format WinBIZ ne sait pas porter.
      if (!(e instanceof ErreurExportWinbiz)) throw e;
      const detail =
        e.reference === undefined ? e.message : `${e.message} (écriture ${e.reference})`;
      throw new ErreurMetier('EXPORT_WINBIZ_INVALIDE', 'Écriture refusée par le format WinBIZ.', {
        detail,
      });
    }
    if (lots.length > 1) {
      // Voir l'en-tête de ce fichier, §« Multi-lot » : la corrélation document → lot au-delà
      // d'un seul lot n'est pas construite dans ce service — refuser plutôt que mécompter.
      const message =
        `Le lot dépasse la taille maximale d'un fichier WinBIZ et devrait être scindé en ${String(lots.length)} fichiers — ` +
        'non supporté par ce service (corrélation document/lot non construite) : réduire la période demandée.';
      throw new ErreurMetier('FONCTION_NON_DISPONIBLE', message, { detail: message });
    }
    const lot = lots[0];
    if (!lot) {
      const message = 'Aucun lot produit malgré des candidats non vides.';
      throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
    }
    return lot;
  }

  /**
   * Socle commun de l'aperçu et du déclenchement : sélectionne les candidats de la période, détecte
   * les trous de numérotation, construit les écritures et COLLECTE tout ce qui empêcherait l'export
   * (`diagnostic`) sans rien lever ni écrire. Un `ERREUR_INTERNE` (invariant de schéma rompu)
   * continue, lui, de lever.
   */
  async preparer(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: Pick<EntreeLancerExport, 'cible' | 'periodeDu' | 'periodeAu'>,
  ): Promise<PreparationExport> {
    const [candidats, { imputations, paiementsFinancierNouveau }] = await Promise.all([
      this.chargerCandidats(tx, ctx, entree),
      this.chargerCandidatsPaiements(tx, ctx, entree),
    ]);

    // Validation explicite des invariants attendus sur tout document `emis`/`annule_par_avoir`
    // (numéro, séquence, exercice attribués — `document_vente_numero_brouillon_chk` le garantit
    // pour `numero`) plutôt qu'une assertion de type : une régression du schéma ou un statut mal
    // filtré doit faire échouer LOUD ici, jamais produire une écriture avec un `numero` fantôme.
    const infosCandidats: readonly CandidatContinuite[] = candidats.map((c) => {
      if (c.numero === null || c.numeroSequence === null || c.exercice === null) {
        const message = `Document ${c.id} candidat à l'export sans numéro/séquence/exercice alors que son statut (${c.statut}) l'exige.`;
        throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
      }
      if (!estTypeDocumentExportable(c.typeDocument)) {
        const message = `Document ${c.id} de type ${c.typeDocument} ne devrait jamais être candidat à l'export.`;
        throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
      }
      return {
        id: c.id,
        typeDocument: c.typeDocument,
        exercice: c.exercice,
        numeroSequence: c.numeroSequence,
        numero: c.numero,
      };
    });

    if (
      candidats.length === 0 &&
      imputations.length === 0 &&
      paiementsFinancierNouveau.length === 0
    ) {
      return {
        candidats,
        infosCandidats,
        imputations,
        paiementsFinancierNouveau,
        ecritures: [],
        clientParReference: new Map(),
        diagnostic: { trous: [], manquants: [], desequilibres: [], limites: [] },
      };
    }

    // La continuité de numérotation (MD-32) ne concerne QUE facture/avoir — un paiement n'a pas
    // de série numérotée. Rien à vérifier si cette période n'a produit aucun document candidat
    // (un export peut être exclusivement composé de paiements, p. ex. un mois où seuls des
    // encaissements sur des factures antérieures restent à transmettre).
    const trous: readonly TrouDetecte[] =
      infosCandidats.length > 0 ? await trouverTrousNumerotation(tx, ctx, infosCandidats) : [];

    const [docs, paiements] = await Promise.all([
      this.construireEcritures(tx, ctx, candidats, entree.cible),
      this.construireEcrituresPaiements(
        tx,
        ctx,
        imputations,
        paiementsFinancierNouveau,
        entree.cible,
      ),
    ]);

    const clientParReference = new Map<string, string>();
    for (const c of candidats) {
      if (c.numero !== null) clientParReference.set(c.numero, c.clientDesignationFigee);
    }
    for (const p of paiementsFinancierNouveau) clientParReference.set(p.id, p.payeurLibelle);
    for (const [id, libelle] of paiements.payeurParPaiement) clientParReference.set(id, libelle);

    return {
      candidats,
      infosCandidats,
      imputations,
      paiementsFinancierNouveau,
      ecritures: [...docs.ecritures, ...paiements.ecritures],
      clientParReference,
      diagnostic: {
        trous,
        manquants: [...docs.manquants, ...paiements.manquants],
        desequilibres: [...docs.desequilibres, ...paiements.desequilibres],
        limites: paiements.limites,
      },
    };
  }

  /** Sélection tenant-scopée, RESCOPÉE explicitement (le RLS est le filet, pas le mécanisme). */
  private async chargerCandidats(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: Pick<EntreeLancerExport, 'periodeDu' | 'periodeAu'>,
  ): Promise<readonly LigneDocumentVente[]> {
    const conditions = [
      eq(documentVente.tenantId, ctx.tenantId),
      inArray(documentVente.typeDocument, [...TYPES_DOCUMENT_EXPORTABLES]),
      inArray(documentVente.statut, [...STATUTS_EXPORTABLES]),
      isNull(documentVente.exporteLe),
      between(documentVente.dateDocument, entree.periodeDu, entree.periodeAu),
      // `capacites.multiDevise: false` (WinbizExporteurService) : un document en EUR (RF-58) sort
      // du périmètre de cet adaptateur — ni converti (aucune source de change dans ce service), ni
      // silencieusement inclus au mauvais montant. Signalé au rapport de livraison, pas traité ici.
      eq(documentVente.devise, 'CHF'),
    ];

    return tx
      .select()
      .from(documentVente)
      .where(and(...conditions))
      .orderBy(
        asc(documentVente.dateDocument),
        asc(documentVente.typeDocument),
        asc(documentVente.numeroSequence),
      );
  }

  private async construireEcritures(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    candidats: readonly LigneDocumentVente[],
    cible: CibleExport,
  ): Promise<{
    ecritures: readonly EcritureExport[];
    manquants: readonly BesoinMappingManquant[];
    desequilibres: readonly ErreurEcritureDesequilibree[];
  }> {
    const ids = candidats.map((c) => c.id);
    if (ids.length === 0) return { ecritures: [], manquants: [], desequilibres: [] };

    const [toutesLesLignes, toutesLesVentilations, sites, codesTva] = await Promise.all([
      tx
        .select()
        .from(ligneDocument)
        .where(
          and(eq(ligneDocument.tenantId, ctx.tenantId), inArray(ligneDocument.documentId, ids)),
        ),
      tx
        .select()
        .from(documentVenteTva)
        .where(
          and(
            eq(documentVenteTva.tenantId, ctx.tenantId),
            inArray(documentVenteTva.documentId, ids),
          ),
        ),
      tx
        .select({ id: site.id, code: site.code })
        .from(site)
        .where(
          and(
            eq(site.tenantId, ctx.tenantId),
            inArray(site.id, [...new Set(candidats.map((c) => c.siteId))]),
          ),
        ),
      chargerCodesTva(tx, ctx, cible),
    ]);

    const lignesParDocument = grouperParDocument(toutesLesLignes, (l) => l.documentId);
    const ventilationsParDocument = grouperParDocument(toutesLesVentilations, (v) => v.documentId);
    const codeSiteParId = new Map(sites.map((s) => [s.id, s.code]));

    const datesDistinctes = [
      ...new Set(candidats.map((c) => c.dateDocument).filter((d): d is string => d !== null)),
    ];
    const comptesParDate = new Map(
      await Promise.all(
        datesDistinctes.map(
          async (date) =>
            [date, await chargerComptesResolusADate(tx, ctx, cible, date, codesTva)] as const,
        ),
      ),
    );

    const ecritures: EcritureExport[] = [];
    const manquants: BesoinMappingManquant[] = [];
    const desequilibres: ErreurEcritureDesequilibree[] = [];

    for (const doc of candidats) {
      const comptes = doc.dateDocument !== null ? comptesParDate.get(doc.dateDocument) : undefined;
      if (!comptes) {
        const message = `Résolution du plan comptable manquante pour la date ${String(doc.dateDocument)}.`;
        throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
      }
      try {
        const resultat = construireEcritureDocument(
          doc,
          lignesParDocument.get(doc.id) ?? [],
          ventilationsParDocument.get(doc.id) ?? [],
          comptes,
          codeSiteParId.get(doc.siteId) ?? null,
        );
        if (resultat.succes) ecritures.push(resultat.ecriture);
        else manquants.push(...resultat.manquants);
      } catch (e) {
        if (!(e instanceof ErreurEcritureDesequilibree)) throw e;
        desequilibres.push(e);
      }
    }

    return { ecritures, manquants, desequilibres };
  }

  /**
   * Sélection tenant-scopée en DEUX parties, granularité imputation (migration 0019, voir l'en-tête
   * de fichier) :
   *   - `imputations` : `imputation_paiement.exporteLe is null`, filtrées sur `imputeLe` — la date
   *     à laquelle l'ACTE d'imputer a eu lieu, pas la date du paiement (exactement la requête
   *     mesurée par la migration 0019 pour son index partiel, `tenant_id = $1 and exporte_le is
   *     null and impute_le between $2 and $3`).
   *   - `paiementsFinancierNouveau` : `paiement.exporteLe is null`, filtrés sur `dateValeur` — les
   *     paiements dont le CASH n'a encore jamais été transmis (premier export de ce paiement,
   *     qu'il ait ou non des imputations candidates en même temps).
   * Ces deux ensembles se recoupent souvent (premier export d'un paiement avec ses imputations
   * initiales) mais AUCUN n'est un sous-ensemble de l'autre : un paiement peut n'avoir que des
   * imputations candidates (financier déjà transmis avant, `MD-57` issue 2) ou l'inverse (avance
   * pure, remboursement — aucune imputation, `MD-57`).
   *
   * Aucun filtre par site : la numérotation des factures/avoirs est par tenant et par exercice
   * (`facturation/documents/numerotation.ts`, `siteId: null`), donc la continuité l'est aussi — voir
   * `continuite/verification-continuite.ts`. Un export par site ferait apparaître les documents des
   * autres sites comme des trous.
   */
  private async chargerCandidatsPaiements(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: Pick<EntreeLancerExport, 'periodeDu' | 'periodeAu'>,
  ): Promise<{
    imputations: readonly LigneImputationPaiement[];
    paiementsFinancierNouveau: readonly LignePaiement[];
  }> {
    const conditionsFinancier = [
      eq(paiement.tenantId, ctx.tenantId),
      isNull(paiement.exporteLe),
      between(paiement.dateValeur, entree.periodeDu, entree.periodeAu),
      // `capacites.multiDevise: false` (WinbizExporteurService) — même garde que `chargerCandidats`.
      eq(paiement.devise, 'CHF'),
    ];

    const [paiementsFinancierNouveau, imputationsBrutes] = await Promise.all([
      tx
        .select()
        .from(paiement)
        .where(and(...conditionsFinancier))
        .orderBy(asc(paiement.dateValeur), asc(paiement.id)),
      tx
        .select()
        .from(imputationPaiement)
        .where(
          and(
            eq(imputationPaiement.tenantId, ctx.tenantId),
            isNull(imputationPaiement.exporteLe),
            sql`${imputationPaiement.imputeLe}::date >= ${entree.periodeDu}::date`,
            sql`${imputationPaiement.imputeLe}::date <= ${entree.periodeAu}::date`,
          ),
        )
        .orderBy(asc(imputationPaiement.imputeLe), asc(imputationPaiement.id)),
    ]);

    return { imputations: imputationsBrutes, paiementsFinancierNouveau };
  }

  /**
   * Construit une `EcritureExport` par PAIEMENT touché — un pour chaque paiement présent dans
   * `paiementsFinancierNouveau` OU référencé par au moins une imputation de `imputations` (l'union
   * des deux, jamais un sous-ensemble de l'un). Le maillon manquant identifié à la livraison
   * précédente : sans lui, l'export ne transmettait que la créance et le produit d'un document,
   * jamais son encaissement, laissant les factures éternellement ouvertes dans la comptabilité de
   * la fiduciaire. Bascule 0019 : la granularité de sélection est l'imputation, mais l'AGRÉGATION en
   * écritures reste PAR PAIEMENT — `construireEcriturePaiement` (le cœur pur) n'a besoin de savoir,
   * par paiement, que « son cash part-il dans CE lot » (`financierNouveauCetExport`), calculé ici
   * depuis l'appartenance à `paiementsFinancierNouveau`.
   *
   * Les documents référencés par les imputations peuvent être HORS de la période demandée (le cas
   * courant : une facture de mars encaissée en avril) — chargés séparément des `candidats`
   * documents de `construireEcritures`, jamais supposés être un sous-ensemble de ceux-ci.
   */
  private async construireEcrituresPaiements(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    imputations: readonly LigneImputationPaiement[],
    paiementsFinancierNouveau: readonly LignePaiement[],
    cible: CibleExport,
  ): Promise<{
    ecritures: readonly EcritureExport[];
    manquants: readonly BesoinMappingManquant[];
    limites: readonly LimiteEcriturePaiement[];
    desequilibres: readonly ErreurEcritureDesequilibree[];
    /** Payeur de chaque paiement traité — alimente la colonne « Client » du CSV. */
    payeurParPaiement: ReadonlyMap<string, string>;
  }> {
    if (imputations.length === 0 && paiementsFinancierNouveau.length === 0) {
      return {
        ecritures: [],
        manquants: [],
        limites: [],
        desequilibres: [],
        payeurParPaiement: new Map(),
      };
    }

    const idsFinancierNouveau = new Set(paiementsFinancierNouveau.map((p) => p.id));

    // Garde défensive (en-tête de fichier, § « Granularité ») : un paiement dont le CASH part pour
    // la première fois dans ce lot ne devrait JAMAIS porter d'imputation déjà exportée AILLEURS —
    // ce serait le signe qu'un autre chemin a marqué une imputation sans jamais marquer le
    // paiement, brisant l'invariant que `financierNouveauCetExport` suppose vrai. N'arrive jamais
    // en pratique (ce service est le SEUL à écrire ces deux colonnes) ; garde LOUD plutôt qu'une
    // écriture qui recompterait un encaissement déjà transmis.
    if (idsFinancierNouveau.size > 0) {
      const [incoherence] = await tx
        .select({ paiementId: imputationPaiement.paiementId })
        .from(imputationPaiement)
        .where(
          and(
            eq(imputationPaiement.tenantId, ctx.tenantId),
            inArray(imputationPaiement.paiementId, [...idsFinancierNouveau]),
            sql`${imputationPaiement.exporteLe} is not null`,
          ),
        )
        .limit(1);
      if (incoherence) {
        const message = `Paiement ${incoherence.paiementId} candidat au premier envoi financier mais porte déjà une imputation exportée — invariant rompu.`;
        throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
      }
    }

    // Détail complet de TOUS les paiements concernés — financier nouveau OU seulement des
    // imputations tardives (leur `LignePaiement` entière est nécessaire dans les deux cas : moyen,
    // montant, payeurLibelle, siteId, dateValeur).
    const paiementParId = new Map<string, LignePaiement>(
      paiementsFinancierNouveau.map((p) => [p.id, p]),
    );
    const idsAResoudre = [...new Set(imputations.map((i) => i.paiementId))].filter(
      (id) => !paiementParId.has(id),
    );
    if (idsAResoudre.length > 0) {
      const lignes = await tx
        .select()
        .from(paiement)
        .where(and(eq(paiement.tenantId, ctx.tenantId), inArray(paiement.id, idsAResoudre)));
      for (const l of lignes) paiementParId.set(l.id, l);
    }

    const idsPaiementsAProcess = new Set<string>([
      ...idsFinancierNouveau,
      ...imputations.map((i) => i.paiementId),
    ]);
    const paiementsAProcess = [...idsPaiementsAProcess].map((id) => {
      const ligne = paiementParId.get(id);
      // `imputation_paiement_fk_paiement` garantit l'existence du paiement référencé — n'arrive
      // jamais en pratique ; garde LOUD plutôt qu'une écriture construite avec des champs fantômes.
      if (!ligne) {
        const message = `Paiement ${id} référencé par une imputation candidate introuvable.`;
        throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
      }
      return ligne;
    });
    paiementsAProcess.sort((a, b) =>
      a.dateValeur === b.dateValeur
        ? a.id.localeCompare(b.id)
        : a.dateValeur.localeCompare(b.dateValeur),
    );

    const idsDocuments = [...new Set(imputations.map((i) => i.documentId))];
    const [documentsRows, ventilationsRows, sites, codesTva] = await Promise.all([
      idsDocuments.length > 0
        ? tx
            .select({ id: documentVente.id, numero: documentVente.numero })
            .from(documentVente)
            .where(
              and(
                eq(documentVente.tenantId, ctx.tenantId),
                inArray(documentVente.id, idsDocuments),
              ),
            )
        : Promise.resolve([]),
      idsDocuments.length > 0
        ? tx
            .select()
            .from(documentVenteTva)
            .where(
              and(
                eq(documentVenteTva.tenantId, ctx.tenantId),
                inArray(documentVenteTva.documentId, idsDocuments),
              ),
            )
        : Promise.resolve([]),
      tx
        .select({ id: site.id, code: site.code })
        .from(site)
        .where(
          and(
            eq(site.tenantId, ctx.tenantId),
            inArray(site.id, [...new Set(paiementsAProcess.map((p) => p.siteId))]),
          ),
        ),
      chargerCodesTva(tx, ctx, cible),
    ]);

    const ventilationsParDocument = grouperParDocument(ventilationsRows, (v) => v.documentId);
    const documentsInfo = new Map<string, DocumentPourEcriturePaiement>();
    for (const d of documentsRows) {
      // `document_vente_numero_brouillon_chk` garantit un `numero` non nul pour tout document
      // qu'une imputation peut légitimement référencer (émis) — un `numero` nul ici serait une
      // rupture de la FK `imputation_paiement_fk_document`, jamais atteinte en pratique.
      if (d.numero === null) continue;
      documentsInfo.set(d.id, {
        numero: d.numero,
        ventilationTva: (ventilationsParDocument.get(d.id) ?? []).map((v) => ({
          regimeTva: v.regimeTva,
          tauxTvaPourmille: v.tauxTvaPourmille,
        })),
      });
    }
    for (const documentId of idsDocuments) {
      if (!documentsInfo.has(documentId)) {
        // `imputation_paiement_fk_document` garantit l'existence du document référencé — n'arrive
        // jamais en pratique ; garde LOUD plutôt qu'une écriture construite avec un numéro fantôme.
        const message = `Document ${documentId} référencé par une imputation de paiement introuvable.`;
        throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
      }
    }

    const codeSiteParId = new Map(sites.map((s) => [s.id, s.code]));
    const imputationsParPaiement = grouperParDocument(imputations, (i) => i.paiementId);

    const datesDistinctes = [...new Set(paiementsAProcess.map((p) => p.dateValeur))];
    const comptesParDate = new Map(
      await Promise.all(
        datesDistinctes.map(
          async (date) =>
            [date, await chargerComptesResolusADate(tx, ctx, cible, date, codesTva)] as const,
        ),
      ),
    );

    const ecritures: EcritureExport[] = [];
    const manquants: BesoinMappingManquant[] = [];
    const limites: LimiteEcriturePaiement[] = [];
    const desequilibres: ErreurEcritureDesequilibree[] = [];

    for (const p of paiementsAProcess) {
      const comptes = comptesParDate.get(p.dateValeur);
      if (!comptes) {
        const message = `Résolution du plan comptable manquante pour la date ${p.dateValeur}.`;
        throw new ErreurMetier('ERREUR_INTERNE', message, { detail: message });
      }
      const imps = (imputationsParPaiement.get(p.id) ?? []).map((i) => ({
        documentId: i.documentId,
        montantCentimes: i.montantCentimes,
        nature: i.nature,
      }));
      try {
        const resultat = construireEcriturePaiement(
          {
            id: p.id,
            dateValeur: p.dateValeur,
            moyen: p.moyen,
            montantCentimes: p.montantCentimes,
            payeurLibelle: p.payeurLibelle,
          },
          imps,
          documentsInfo,
          comptes,
          codeSiteParId.get(p.siteId) ?? null,
          idsFinancierNouveau.has(p.id),
        );
        if (resultat.succes) {
          ecritures.push(resultat.ecriture);
        } else {
          manquants.push(...resultat.manquants);
          limites.push(...resultat.limites);
        }
      } catch (e) {
        if (!(e instanceof ErreurEcritureDesequilibree)) throw e;
        desequilibres.push(e);
      }
    }

    return {
      ecritures,
      manquants,
      limites,
      desequilibres,
      payeurParPaiement: new Map(paiementsAProcess.map((p) => [p.id, p.payeurLibelle])),
    };
  }
}

function typeMimeCible(cible: CibleExport): string {
  return cible === 'csv' ? 'text/csv; charset=utf-8' : 'text/csv; charset=windows-1252';
}

interface SyntheseDocuments {
  readonly nbFactures: number;
  readonly nbAvoirs: number;
  readonly totalHtCentimes: bigint;
  readonly totalTvaCentimes: bigint;
  readonly totalTtcCentimes: bigint;
  readonly facturePremier: string | null;
  readonly factureDernier: string | null;
  readonly avoirPremier: string | null;
  readonly avoirDernier: string | null;
}

/** Compteurs, totaux (avoirs en négatif, MD-46) et plage de numéros — candidats triés par date puis
 *  numéro de séquence : premier/dernier = extrêmes de la SÉQUENCE, pas de la date. */
export function syntheseDocuments(candidats: readonly LigneDocumentVente[]): SyntheseDocuments {
  let totalHt = 0n;
  let totalTva = 0n;
  let totalTtc = 0n;
  const cle = (d: LigneDocumentVente): number =>
    (d.exercice ?? 0) * 1_000_000_000 + (d.numeroSequence ?? 0);
  const extremes: Record<
    'facture' | 'avoir',
    { min: LigneDocumentVente | null; max: LigneDocumentVente | null }
  > = { facture: { min: null, max: null }, avoir: { min: null, max: null } };
  let nbFactures = 0;
  let nbAvoirs = 0;
  for (const c of candidats) {
    totalHt += c.totalHtCentimes;
    totalTva += c.totalTvaCentimes;
    totalTtc += c.totalTtcCentimes;
    if (c.typeDocument !== 'facture' && c.typeDocument !== 'avoir') continue;
    if (c.typeDocument === 'facture') nbFactures += 1;
    else nbAvoirs += 1;
    const e = extremes[c.typeDocument];
    if (e.min === null || cle(c) < cle(e.min)) e.min = c;
    if (e.max === null || cle(c) > cle(e.max)) e.max = c;
  }
  return {
    nbFactures,
    nbAvoirs,
    totalHtCentimes: totalHt,
    totalTvaCentimes: totalTva,
    totalTtcCentimes: totalTtc,
    facturePremier: extremes.facture.min?.numero ?? null,
    factureDernier: extremes.facture.max?.numero ?? null,
    avoirPremier: extremes.avoir.min?.numero ?? null,
    avoirDernier: extremes.avoir.max?.numero ?? null,
  };
}

function grouperParDocument<T>(lignes: readonly T[], cle: (l: T) => string): Map<string, T[]> {
  const groupes = new Map<string, T[]>();
  for (const ligne of lignes) {
    const id = cle(ligne);
    const liste = groupes.get(id) ?? [];
    liste.push(ligne);
    groupes.set(id, liste);
  }
  return groupes;
}

// Types ré-exportés pour usage par un futur contrôleur : `POST /exports-fiduciaires` est câblé
// (`ExportComptableController`, `export-comptable.controller.ts`, importé par `FacturationModule`)
// — ce commentaire documentait un état antérieur (contrôleur absent faute de droit
// `facturation.export.creer`), corrigé ici pour ne pas induire en erreur un futur lecteur de ce
// fichier, hors du périmètre principal de cette tâche.
export type { LigneDocumentVenteTva, LigneLigneDocument };
