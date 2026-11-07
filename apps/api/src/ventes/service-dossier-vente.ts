import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  EntreeActionAbandonnerDossierVente,
  EntreeActionAnnulerDossierVente,
  EntreeActionCloturerDossierVente,
  EntreeActionEngager,
  EntreeActionLivrer,
  EntreeActionMarquerPretALivrer,
  EntreeActionPreparer,
  EntreeCreationDossierVente,
  EntreeMarquerDocumentRequis,
  EntreeModificationDossierVente,
  FiltresDossiersVente,
  FinancementResume,
  PageCurseur,
  ProvenanceVehiculeStock,
  ReponseAvecAvertissements,
  ReponseDossierVente,
  RepriseResume,
  RoleUtilisateur,
  SuiviGarantie,
  VehiculeStockResume,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  documentVente,
  dossierVente,
  dossierVenteDocumentRequis,
  reprise,
  vehiculeDetention,
  vehiculeStock,
  type LigneDossierVente,
  type LigneReprise,
  type LigneVehiculeStock,
} from '../db/schema';
import {
  chargerClientLigne,
  chargerPlaqueCourante,
  chargerResumeUtilisateur,
  chargerVehiculeLigne,
  construireVehiculeResume,
  versClientResume,
} from '../atelier/references';
import { interpreterContrainteVehicule } from '../vehicules/erreurs-contraintes';
// Import cross-domaine EN LECTURE SEULE, même précédent que `calculerGarantie`/`ajouterMoisIso`
// réutilisés par `suivi-mappers.ts` depuis ce même module `vehicules/` : aucune écriture posée ici
// dans le domaine véhicule (voir le constat documenté en tête de cette classe, juste au-dessus de
// `ServiceDossierVente` — `livrer` ne pose toujours pas `vehicule.garantie_debut`, seule la
// LECTURE de la garantie déjà existante est ajoutée ici).
import { lireDernierKilometrage } from '../vehicules/vehicule-requetes';
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
// Import direct du fichier (jamais le barrel `../recherche`) : ce dernier réexporte aussi
// `recherche.controller.ts`/`recherche.module.ts` — inutile ici et évite tout risque de dépendance
// circulaire entre `ventes/` et `recherche/`. `motifFragment` est une fonction PURE (voir son
// en-tête) : aucune connexion, aucun couplage NestJS. Même idiome exact que
// `facturation/documents/service-documents.ts::lister`.
import { motifFragment } from '../recherche/utilitaires-recherche';

import {
  calculerTypeVehicule,
  roleVoitFinancement,
  roleVoitReprise,
  selectionnerFinancementCourant,
  versDocumentRequisResponse,
  versDocumentVenteResume,
  versDossierVenteResponse,
  versFinancementResume,
  versRepriseResume,
} from './mappers';
// `construireSuiviGarantie` : même fonction PURE que `GET /ventes/suivi` (voir son en-tête) —
// aucune seconde définition d'« encore valable » pour la fiche du dossier.
import { construireSuiviGarantie } from './suivi-mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from '../common/pagination';
import {
  chargerDossierVente,
  chargerDossierVentePourEcriture,
  chargerRepriseParDossierOuNull,
  chargerVehiculeStock,
  chargerVehiculeStockOuNull,
  chargerVehiculeStockPourEcriture,
  listerDocumentsDossierBrut,
  listerDocumentsRequis,
  listerFinancementsDossier,
  SEUIL_DOCUMENTS_DOSSIER,
  totauxTtcAffichesDocumentsDossier,
} from './references';
import { extraireVersionETag } from './service-vehicule-stock';
import { traduireErreurTransitionVente } from './traducteur-transition-ventes';

const DEFINITIONS_TRI_DOSSIERS_VENTE: Readonly<Record<FiltresDossiersVente['tri'], DefinitionTri>> =
  {
    'prospectionLe:desc': {
      expression: sql`dv.cree_le`,
      sens: 'desc',
      nullable: false,
      temporel: true,
    },
    'prospectionLe:asc': {
      expression: sql`dv.cree_le`,
      sens: 'asc',
      nullable: false,
      temporel: true,
    },
    // `date_livraison_estimee` est une colonne `date` (pas `timestamptz`) : pas de perte de
    // microseconde possible, `temporel` n'est pas nécessaire.
    'dateLivraisonEstimee:asc': {
      expression: sql`dv.date_livraison_estimee`,
      sens: 'asc',
      nullable: true,
    },
    'dateLivraisonEstimee:desc': {
      expression: sql`dv.date_livraison_estimee`,
      sens: 'desc',
      nullable: true,
    },
  };

/**
 * Le dossier de vente (RV-29→RV-38, RV-52→RV-58, §6.2) — objet CENTRAL du module. Priorité 2.
 *
 * SIMPLIFICATIONS SIGNALÉES (pas silencieuses) :
 *  - `marquer-pret-a-livrer` ne vérifie PAS l'expertise MFK (RV-56/CV-07, `vehicule_expertise` de
 *    l'atelier) ni la check-list `documentsRequis` autrement qu'en lecture — aucun paramètre tenant
 *    (`PV-03`) n'existe encore pour piloter ces gardes, `contrats/ventes/index.ts` le signale déjà
 *    comme un gap connu de CE lot ;
 *  - `livrer` POSE désormais la mise en stock automatique du véhicule repris confirmé (RV-24, voir
 *    le bloc dédié dans le corps de la méthode) et la clôture de sa détention (motif `reprise`,
 *    SANS réouverture — détenteur cible `[À VALIDER, QV-01]`, non tranché) ;
 *  - `livrer` NE POSE TOUJOURS PAS le début de garantie constructeur (RV-54,
 *    `vehicule.garantieDebut`) ni l'enregistrement du kilométrage de départ dans
 *    `vehicule_kilometrage` (source `vente`) — **CORRECTIF DE CONSTAT** (relu en reprenant ce
 *    fichier) : le commentaire précédent affirmait qu'aucune colonne/valeur d'enum n'existait pour
 *    ces deux effets — C'EST INEXACT. `vehicule.garantie_debut`/`garantie_mois`/`garantie_km`
 *    existent depuis `migrations/0007_vehicules.sql` (étape 1, avant même ce module), et
 *    `source_kilometrage` porte bien la valeur `'vente'` (`contrats/atelier/enums.ts::
 *    SOURCES_KILOMETRAGE`). Ces deux effets restent NON implémentés ICI volontairement : la
 *    consigne de ce lot est explicitement de ne pas toucher au domaine `vehicule` (étape 1,
 *    propriété d'un autre périmètre) au-delà de l'usage déjà établi de `vehicule_detention`
 *    ci-dessous — écrire dans `vehicule.garantie_debut`/`vehicule_kilometrage` sans arbitrage sur
 *    la source de `garantieMois`/`garantieKm` (déjà posés à l'intake ? valeur par défaut ?) serait
 *    inventer une règle métier. Remonté à le mainteneur avec le détail ci-dessus (rapport de
 *    livraison) plutôt que corrigé silencieusement ou laissé sous un faux prétexte technique ;
 *  - `documents-requis/marquer` est UPDATE-ONLY : `schemaMarquerDocumentRequis` ne porte pas de
 *    `libelle`, impossible de CRÉER un item sans texte d'affichage tant que `PV-03` n'existe pas ;
 *  - `livrer` avec `dateLivraisonEffective` = aujourd'hui — le cas le plus fréquent du comptoir
 *    (issue #13) — FONCTIONNE désormais même quand la détention actuellement ouverte du véhicule a
 *    démarré CE MÊME jour civil (`vehicule_detention.du`/`au` sont des `date`, sans heure : deux
 *    dates égales, même si les instants réels diffèrent de plusieurs heures) : dans ce cas précis,
 *    le détenteur est transféré sur la ligne déjà ouverte plutôt que clôturée/réouverte (la clôture
 *    échouerait sur `vehicule_detention_periode_chk`, `au > du` strict — voir le commentaire au
 *    bloc concerné). Une `dateLivraisonEffective` réellement ANTÉRIEURE au début d'une détention
 *    déjà ouverte reste refusée, à raison. Le même défaut affecte la clôture de la détention du
 *    véhicule REPRIS (RV-23) sans solution symétrique possible (pas de nouveau détenteur à qui
 *    transférer, `QV-01` non tranché) — dans ce sous-cas seulement, la détention du véhicule repris
 *    reste ouverte plutôt que de faire échouer toute la livraison, voir le commentaire au bloc RV-24.
 *  - `livrer` exige que la facture soit DÉJÀ ÉMISE (`VENTE_VEHICULE_INDISPONIBLE` sinon, RV-37) —
 *    l'ordre réel du parcours est donc engager → préparer → prêt à livrer → **facturer** →
 *    livrer, et non « prêt à livrer → livrer » : ce n'est pas un défaut (un véhicule livré doit
 *    être vendu), mais un enchaînement qui n'était documenté nulle part (issue #13, second point).
 *    Rendu explicite ici et sur la description OpenAPI de `POST /dossiers-vente/{id}/livrer`.
 */
@Injectable()
export class ServiceDossierVente {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_AUDIT) private readonly audit: ServiceAudit,
    private readonly horloge: Horloge,
  ) {}

  /** `POST /dossiers-vente` — `Idempotency-Key` obligatoire. `statut` initial toujours `prospection`. */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeCreationDossierVente,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDossierVente> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/dossiers-vente', cle: cleIdempotence, corps: entree },
      async (tx) => {
        await chargerClientLigne(tx, ctx, entree.clientAcheteurId);
        if (entree.clientFactureId) await chargerClientLigne(tx, ctx, entree.clientFactureId);
        if (entree.clientConducteurId) await chargerClientLigne(tx, ctx, entree.clientConducteurId);
        if (entree.vehiculeId) await chargerVehiculeStock(tx, ctx, entree.vehiculeId);

        const [ligne] = await tx
          .insert(dossierVente)
          .values({
            tenantId: ctx.tenantId,
            siteId: entree.siteId,
            statut: 'prospection',
            vehiculeId: entree.vehiculeId ?? null,
            clientAcheteurId: entree.clientAcheteurId,
            clientFactureId: entree.clientFactureId ?? null,
            clientConducteurId: entree.clientConducteurId ?? null,
            dateLivraisonEstimee: entree.dateLivraisonEstimee ?? null,
          })
          .returning();
        if (!ligne)
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "La création du dossier de vente n'a rendu aucune ligne.",
          );

        const document = await this.assembler(tx, ctx, principal.role, ligne);
        return { statutHttp: 201, corps: new CollecteurAvertissements().envelopper(document) };
      },
    );
  }

  async obtenirComplet(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
  ): Promise<ReponseDossierVente> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVente(tx, ctx, dossierVenteId);
      return this.assembler(tx, ctx, role, ligne);
    });
  }

  /** `PATCH /dossiers-vente/{id}` — `If-Match` obligatoire. Réassignation du véhicule refusée
   *  (`409 VENTE_DOSSIER_TRANSITION_INTERDITE`) au-delà de `prospection` (RV-30). */
  async modifier(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    ifMatch: string | undefined,
    entree: EntreeModificationDossierVente,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    const versionAttendue = extraireVersionETag(ifMatch);

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVentePourEcriture(tx, ctx, dossierVenteId);

      if (versionAttendue !== ligne.version) {
        throw new ErreurMetier(
          'CONFLIT',
          'La version du dossier de vente a changé depuis la dernière lecture.',
          {
            detail: `version_attendue=${String(versionAttendue)};version_actuelle=${String(ligne.version)}`,
            actionsProposees: [{ code: 'RAFRAICHIR' }],
          },
        );
      }

      const reassigneVehicule =
        entree.vehiculeId !== undefined && entree.vehiculeId !== ligne.vehiculeId;
      if (reassigneVehicule && ligne.statut !== 'prospection') {
        throw new ErreurMetier(
          'VENTE_DOSSIER_TRANSITION_INTERDITE',
          "Le véhicule associé ne peut plus être réassigné au-delà de l'état « prospection » (RV-30/RV-32).",
        );
      }
      if (reassigneVehicule && entree.vehiculeId) {
        await chargerVehiculeStock(tx, ctx, entree.vehiculeId);
      }
      if (entree.clientFactureId) await chargerClientLigne(tx, ctx, entree.clientFactureId);
      if (entree.clientConducteurId) await chargerClientLigne(tx, ctx, entree.clientConducteurId);

      await tx
        .update(dossierVente)
        .set({
          ...(entree.clientFactureId !== undefined
            ? { clientFactureId: entree.clientFactureId ?? null }
            : {}),
          ...(entree.clientConducteurId !== undefined
            ? { clientConducteurId: entree.clientConducteurId ?? null }
            : {}),
          ...(reassigneVehicule ? { vehiculeId: entree.vehiculeId ?? null } : {}),
          ...(entree.dateLivraisonEstimee !== undefined
            ? { dateLivraisonEstimee: entree.dateLivraisonEstimee ?? null }
            : {}),
        })
        .where(and(eq(dossierVente.tenantId, ctx.tenantId), eq(dossierVente.id, dossierVenteId)));

      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  /** `POST /dossiers-vente/{id}/documents-requis/marquer` — UPDATE-ONLY (voir tête de fichier). */
  async marquerDocumentRequis(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    entree: EntreeMarquerDocumentRequis,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerDossierVente(tx, ctx, dossierVenteId);
      const maintenant = this.horloge.maintenant();

      const misesAJour = await tx
        .update(dossierVenteDocumentRequis)
        .set({ fourni: entree.fourni, fourniLe: entree.fourni ? maintenant : null })
        .where(
          and(
            eq(dossierVenteDocumentRequis.tenantId, ctx.tenantId),
            eq(dossierVenteDocumentRequis.dossierVenteId, dossierVenteId),
            eq(dossierVenteDocumentRequis.code, entree.code),
          ),
        )
        .returning();
      if (misesAJour.length === 0) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Aucun document requis de code "${entree.code}" sur ce dossier (check-list non paramétrée, PV-03).`,
        );
      }

      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  /** `GET /dossiers-vente` — collection paginée par curseur. */
  async lister(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    filtres: FiltresDossiersVente,
  ): Promise<PageCurseur<ReponseDossierVente>> {
    const definition = DEFINITIONS_TRI_DOSSIERS_VENTE[filtres.tri];
    const idExpr = sql`dv.id`;
    const curseurDecode = decoderCurseurPourTri(
      filtres.curseur,
      filtres.tri,
      DEFINITIONS_TRI_DOSSIERS_VENTE,
    );

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [sql`dv.tenant_id = ${ctx.tenantId}`];
      if (filtres.siteId) conditions.push(sql`dv.site_id = ${filtres.siteId}`);
      if (filtres.statut && filtres.statut.length > 0) {
        // DÉFAUT CONSTATÉ (corrigé, balayage du 27.08.2026) : `dv.statut::text in (...)` castait
        // l'enum en `text` avant comparaison, opaque aux statistiques PostgreSQL de la colonne —
        // même défaut que `client.statut` (`service-client.ts`). Comparaison native sur l'enum.
        conditions.push(
          sql`dv.statut = any(${sql.param(filtres.statut)}::public.statut_dossier_vente[])`,
        );
      }
      if (filtres.clientAcheteurId)
        conditions.push(sql`dv.client_acheteur_id = ${filtres.clientAcheteurId}`);
      if (filtres.vehiculeId) conditions.push(sql`dv.vehicule_id = ${filtres.vehiculeId}`);
      // `q` — DÉFAUT CORRIGÉ (constaté en exécution réelle, `GET /dossiers-vente?q=...` rendait
      // TOUJOURS la même liste, y compris pour un fragment qui ne correspond à rien) : le contrat
      // (`contrats/ventes/dossier-vente.ts::schemaFiltresDossiersVente`) documente déjà « porte sur
      // le nom du client acheteur et la plaque/désignation du véhicule associé », mais ce filtre
      // n'était lu NULLE PART dans cette méthode — même famille de défaut que `ordreReparationId`
      // sur `GET /documents-vente` (piège documenté du dépôt).
      //
      // Porte sur le NOM DU CLIENT ACHETEUR et la PLAQUE COURANTE du véhicule associé — pas sur la
      // désignation (marque/modèle/version), volontairement écartée : `migrations/
      // 0013_ordre_reparation_numero_recherche.sql` documente déjà que la recherche par fragment sur
      // `marque`/`modele` de `vehicule` n'a JAMAIS eu de chemin d'index utilisable dans ce dépôt
      // (`vehicule_marque_modele_idx`, 0007, est un btree SANS `gin_trgm_ops` sur une expression
      // SANS `coalesce` — inutilisable par un `LIKE '%fragment%'`) et que la corriger exige une
      // restructuration de requête, pas une clause `OR` de plus. Ajouter cette branche ICI aurait
      // réintroduit sciemment le même défaut ailleurs jugé non trivial. Signalé à le mainteneur
      // plutôt que deviné : le contrat promet plus que ce filtre ne couvre (« désignation »), voir
      // le rapport de livraison.
      //
      // MÊME idiome que `facturation/documents/service-documents.ts::lister` : `public
      // .normaliser_recherche()` des deux côtés du `LIKE`, JAMAIS une normalisation TypeScript
      // reconstruite (elle divergerait de celle de la base, `recherche/utilitaires-recherche.ts`).
      //
      // Expression du nom EXACTEMENT celle indexée par `client_recherche_idx` (migrations/
      // 0006_clients.sql : `coalesce(raison_sociale, nom || ' ' || coalesce(prenom, ''), '')`) —
      // écart syntaxique = index inutilisable (même piège que `vehicule_marque_modele_idx`
      // ci-dessus). `vp.valeur` (plaque COURANTE, `au is null`) n'a pas besoin de
      // `vehicule_plaque_recherche_idx` ici : le `LEFT JOIN LATERAL` la résout déjà PAR VÉHICULE
      // (index `vehicule_plaque_courante_idx`), le `LIKE` ne filtre plus qu'une valeur déjà en
      // main — pas un balayage par fragment de toute la table `vehicule_plaque`.
      if (filtres.q) {
        const motif = motifFragment(filtres.q);
        conditions.push(sql`(
          public.normaliser_recherche(
            coalesce(cl.raison_sociale, cl.nom || ' ' || coalesce(cl.prenom, ''), '')
          ) like public.normaliser_recherche(${motif})
          or public.normaliser_recherche(
            coalesce(cl.raison_sociale, concat_ws(' ', cl.prenom, cl.nom), '')
          ) like public.normaliser_recherche(${motif})
          or public.normaliser_recherche(vp.valeur) like public.normaliser_recherche(${motif})
        )`);
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      const requete = sql`
        select dv.id as "id", ${expressionTriValeur(definition)} as "triValeur"
          from public.dossier_vente dv
          join public.client cl on cl.tenant_id = dv.tenant_id and cl.id = dv.client_acheteur_id
          left join lateral (
            select vp.valeur from public.vehicule_plaque vp
             where vp.tenant_id = dv.tenant_id and vp.vehicule_id = dv.vehicule_id and vp.au is null
             order by vp.du desc limit 1
          ) vp on true
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${filtres.limite + 1}
      `;
      const resultat = await tx.execute<{ id: string; triValeur: string | number | null }>(requete);
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > filtres.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, filtres.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      // `pourListe = true` : voir la note sur `assembler` — évite d'ouvrir jusqu'à `limite`
      // (max 200) transactions d'audit imbriquées en parallèle sur une seule page, ce qui épuisait
      // le pool `pg` (`max 10` par défaut).
      const donnees = await Promise.all(
        pageLignes.map(async (l) => {
          const ligne = await chargerDossierVente(tx, ctx, l.id);
          return this.assembler(tx, ctx, role, ligne, true);
        }),
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

  // -----------------------------------------------------------------------------------------
  // Transitions (§6.2)
  // -----------------------------------------------------------------------------------------

  /** `POST /dossiers-vente/{id}/engager` — `prospection -> engage` (RV-32). */
  async engager(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    entree: EntreeActionEngager,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVentePourEcriture(tx, ctx, dossierVenteId);

      if (!ligne.vehiculeId) {
        throw new ErreurMetier(
          'VENTE_VEHICULE_MANQUANT',
          "Aucun véhicule associé à ce dossier — impossible d'engager (RV-30/RV-32).",
        );
      }
      const vehiculeStockLigne = await chargerVehiculeStockPourEcriture(tx, ctx, ligne.vehiculeId);
      if (
        vehiculeStockLigne.statutCommercial !== 'disponible' &&
        vehiculeStockLigne.statutCommercial !== 'en_commande'
      ) {
        throw new ErreurMetier(
          'VENTE_VEHICULE_INDISPONIBLE',
          `Le véhicule associé n'est plus disponible (statut actuel : ${vehiculeStockLigne.statutCommercial}) — un autre dossier l'a réservé entre-temps (CV-01).`,
        );
      }

      const documentsExistants = await tx
        .select({ id: documentVente.id })
        .from(documentVente)
        .where(
          and(
            eq(documentVente.tenantId, ctx.tenantId),
            eq(documentVente.id, entree.bonCommandeDocumentId),
          ),
        )
        .limit(1);
      if (documentsExistants.length === 0) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Document ${entree.bonCommandeDocumentId} introuvable pour ce tenant.`,
        );
      }

      const repriseLigne = await this.chargerRepriseOuNullPourEcriture(tx, ctx, dossierVenteId);
      if (repriseLigne) {
        if (repriseLigne.statut === 'estimee') {
          throw new ErreurMetier(
            'VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE',
            'La reprise de ce dossier est encore au stade « estimée » — une valeur négociée est requise avant de signer (RV-27).',
          );
        }
        if (repriseLigne.statut === 'negociee') {
          await this.transitionnerReprise(tx, repriseLigne, {
            statut: 'confirmee',
            confirmeeLe: this.horloge.maintenant(),
          });
        }
      }

      const maintenant = this.horloge.maintenant();
      await this.transitionnerVehiculeStock(tx, vehiculeStockLigne, {
        statutCommercial: 'reserve',
        reserveLe: maintenant,
      });
      await this.transitionnerDossier(tx, ligne, {
        statut: 'engage',
        engageLe: maintenant,
        identitePieceType: entree.identitePieceType,
        identiteVerifieeLe: maintenant,
      });

      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  /**
   * `POST /dossiers-vente/{id}/preparer` — `engage -> en_preparation`.
   *
   * GARDE APPLICATIVE EXPLICITE (défaut constaté et corrigé, tests d'intégration) : contrairement à
   * `engager`/`livrer`, dont un rejeu échoue déjà indirectement via l'état du véhicule associé,
   * cette transition ne touche jamais `vehicule_stock` — rien ne l'empêchait, avant ce correctif,
   * d'être rejouée. Le trigger générique `verifier_transition()` (`0003_prealables_etape1.sql`)
   * traite un UPDATE qui écrit LE MÊME statut comme un non-événement (`old.statut is not distinct
   * from new.statut`) et ne consulte alors JAMAIS `transition_autorisee` — un second appel une fois
   * `en_preparation` déjà atteint ne changeait donc que l'horodatage, en silence, sans jamais lever
   * `ZDFA1`. D'où cette vérification AVANT `transitionnerDossier`, pour refuser tout rejeu par un
   * code métier stable plutôt que de laisser passer une transition fantôme.
   */
  async preparer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    _entree: EntreeActionPreparer,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVentePourEcriture(tx, ctx, dossierVenteId);
      if (ligne.statut !== 'engage') {
        throw new ErreurMetier(
          'VENTE_DOSSIER_TRANSITION_INTERDITE',
          `Préparation impossible : ce dossier n'est pas « engage » (statut actuel : ${ligne.statut}).`,
        );
      }
      await this.transitionnerDossier(tx, ligne, {
        statut: 'en_preparation',
        enPreparationLe: this.horloge.maintenant(),
      });
      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  /**
   * `POST /dossiers-vente/{id}/marquer-pret-a-livrer` — `en_preparation -> pret_a_livrer`.
   *
   * Même garde de rejeu explicite que `preparer` (voir sa docstring) : rien d'autre ne bloque un
   * second appel une fois `pret_a_livrer` déjà atteint — le financement reste `confirme`, et le
   * trigger générique laisse passer une écriture qui n'y change rien.
   *
   * DÉFAUT CORRIGÉ (issue #115, terrain) : la garde ci-dessous refusait la transition sous le
   * MÊME code, avec le MÊME message, dans DEUX situations pourtant très différentes — `!courant`
   * (aucun financement n'a JAMAIS été créé pour ce dossier : `DialogueCreationFinancement` reste
   * un geste manuel et facultatif, § `ventes/financements/`) et `courant.statut !== 'confirme'`
   * (un financement existe réellement, en attente ou refusé). Le premier cas est le chemin
   * COURANT d'une vente au comptant — RIEN dans RV-37 ni dans le modèle n'exige un financement
   * pour livrer, la table `financement_vente` reste vide par construction pour ces dossiers-là
   * (`schema/ventes/financement.ts`) — et ne doit donc JAMAIS bloquer. Trois situations, désormais
   * distinguées :
   *  1. `financements.length === 0` : AUTORISÉ (vente au comptant, aucune tentative de
   *     financement — le cas normal).
   *  2. `courant.statut` ∈ `{'en_attente', 'refuse'}` : REFUSÉ, message qui NOMME la situation
   *     réelle (« en attente de confirmation » / « a été refusé »), jamais le texte générique qui
   *     ne distinguait pas les deux.
   *  3. `courant.statut === 'confirme'` : AUTORISÉ (comportement inchangé).
   *
   * `VENTE_FINANCEMENT_NON_CONFIRME` reste l'unique code (`CODES_ERREUR`, contrat gelé — packages/
   * shared hors périmètre d'écriture de ce lot, aucun code dédié `_EN_ATTENTE`/`_REFUSE` ajouté
   * ici) : le bandeau `erreurs:codes.VENTE_FINANCEMENT_NON_CONFIRME` reste donc IDENTIQUE à
   * l'écran pour les cas 2a/2b — mais reste honnête pour les deux (un financement en attente
   * COMME un financement refusé sont, l'un et l'autre, réellement « non confirmés »). Le message
   * RÉEL (champ `message` de l'exception, jamais affiché au garagiste — voir `ErreurMetier`) est
   * néanmoins différencié pour les journaux/le support. SIGNALÉ au rapport de livraison : un code
   * dédié par situation permettrait un bandeau distinct à l'écran, hors mandat de ce correctif.
   */
  async marquerPretALivrer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    _entree: EntreeActionMarquerPretALivrer,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVentePourEcriture(tx, ctx, dossierVenteId);
      if (ligne.statut !== 'en_preparation') {
        throw new ErreurMetier(
          'VENTE_DOSSIER_TRANSITION_INTERDITE',
          `Passage à « pret_a_livrer » impossible : ce dossier n'est pas « en_preparation » (statut actuel : ${ligne.statut}).`,
        );
      }

      const financements = await listerFinancementsDossier(tx, ctx, dossierVenteId);
      const courant = selectionnerFinancementCourant(financements);
      // `courant === null` : AUCUNE tentative de financement pour ce dossier — vente au comptant,
      // transition AUTORISÉE (voir la docstring ci-dessus, situation 1). Ne throw QUE si un
      // financement existe réellement et n'est pas confirmé (situation 2).
      if (courant && courant.statut !== 'confirme') {
        throw new ErreurMetier(
          'VENTE_FINANCEMENT_NON_CONFIRME',
          courant.statut === 'refuse'
            ? `Le financement de ce dossier a été refusé (RV-37) — un nouveau financement doit être confirmé, ou le dossier doit repartir sans financement (vente au comptant).`
            : `Le financement de ce dossier est en attente de confirmation (RV-37) — passage à « prêt à livrer » impossible tant qu'il n'est ni confirmé ni retiré.`,
          { detail: `statutFinancement=${courant.statut};financementId=${courant.id}` },
        );
      }

      await this.transitionnerDossier(tx, ligne, {
        statut: 'pret_a_livrer',
        pretALivrerLe: this.horloge.maintenant(),
      });
      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  /** `POST /dossiers-vente/{id}/livrer` — `pret_a_livrer -> livre` (RV-52/RV-53). */
  async livrer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    entree: EntreeActionLivrer,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVentePourEcriture(tx, ctx, dossierVenteId);
      if (!ligne.vehiculeId) {
        throw new ErreurMetier('VENTE_VEHICULE_MANQUANT', 'Aucun véhicule associé à ce dossier.');
      }
      // Capturé dans une constante locale (pas `ligne.vehiculeId` réutilisé plus bas) : le narrowing
      // de la garde ci-dessus ne traverse pas la frontière de la closure `avecTraductionErreur`
      // imbriquée plus bas — TypeScript ne propage jamais le narrowing d'un accès de propriété dans
      // une fonction imbriquée, même sur un `const`, car rien ne garantit que la propriété n'a pas
      // été réassignée entre-temps.
      const vehiculeId = ligne.vehiculeId;

      // `vehicule_stock` passe `reserve -> vendu` à l'émission de la facture — effet de bord
      // PROGRAMMATIQUE de `facturation/` (hors périmètre de ce fichier) via
      // `ServiceVehiculeStock.marquerVendu` (exporté par `VentesModule` pour cette injection
      // croisée). CORRECTIF DE CONSTAT (relu en reprenant ce fichier) : ce commentaire affirmait que
      // le câblage réel côté facturation restait à faire par son propriétaire — C'EST INEXACT, il
      // est déjà câblé (`facturation/documents/service-emission.ts::marquerVehiculeVenduSiApplicable`,
      // appelée depuis `emettre()` après l'émission de la facture). Ici, on exige seulement que ce
      // soit déjà fait avant de livrer.
      const vehiculeStockLigne = await chargerVehiculeStockPourEcriture(tx, ctx, vehiculeId);
      if (vehiculeStockLigne.statutCommercial !== 'vendu') {
        // CODE CORRIGÉ (constaté en navigateur, puis reproduit en HTTP réel) : ce refus sortait
        // sous `VENTE_VEHICULE_INDISPONIBLE`, le MÊME code que la garde d'`engager()` ci-dessus
        // (« un autre dossier a réservé le véhicule entre-temps »). Le front n'affiche jamais
        // `detail` — `messageErreur`/`RefusBloquant` rendent `erreurs:codes.<CODE>` et rien
        // d'autre — donc le vendeur lisait « Ce véhicule n'est pas disponible actuellement » sur un
        // véhicule `reserve`, qui EST son état normal après l'engagement : un message à la fois
        // vrai côté machine et inutile côté comptoir. `VENTE_LIVRAISON_FACTURE_REQUISE` nomme la
        // cause, et sa traduction nomme le geste (« émettez d'abord la facture »).
        //
        // `detail` reste renseigné pour les journaux et le support (il porte le statut réel), il
        // n'est simplement plus le seul endroit où l'information existe.
        throw new ErreurMetier(
          'VENTE_LIVRAISON_FACTURE_REQUISE',
          `Livraison impossible : le véhicule n'est pas encore facturé (statut actuel : ${vehiculeStockLigne.statutCommercial}) — la facture doit être émise avant la livraison (RV-37).`,
          {
            detail: `Le véhicule est au statut « ${vehiculeStockLigne.statutCommercial} » : la facture de vente doit être émise avant la livraison (RV-37).`,
          },
        );
      }

      // DÉFAUT CORRIGÉ (issue #140, terrain) : la garde ci-dessus ne vérifie QUE
      // `vehiculeStockLigne.statutCommercial === 'vendu'` — mais ce statut peut être posé SANS
      // AUCUNE facture, par l'action « Marquer vendu » (`POST /vehicules/{id}/stock/marquer-
      // vendu`, `ventes.vehicule_stock.corriger`, réservée à la direction, « correction
      // exceptionnelle » — voir la docstring de `ServiceVehiculeStock.marquerVendu`). Un véhicule
      // ainsi corrigé À LA MAIN, sans qu'aucune facture n'ait jamais été émise pour CE dossier,
      // passait donc `livrer()` sur la seule foi du statut véhicule. Vérification AJOUTÉE, EN PLUS
      // du statut du véhicule (jamais à sa place — le statut reste la garde normale du chemin
      // programmatique RV-37, cette seconde garde ferme spécifiquement le chemin de correction
      // manuelle) : au moins UN document `facture` rattaché à CE dossier (`dossier_vente_id`),
      // déjà émis. `annule_par_avoir` inclus délibérément (RF-32) — une facture émise PUIS
      // créditée en TOTALITÉ reste la preuve qu'une facture a bien existé pour ce dossier ; exiger
      // `statut = 'emis'` strictement aurait fait régresser un dossier déjà `pret_a_livrer` dont la
      // facture serait annulée par avoir entre-temps, un cas dégradé hors du périmètre de ce
      // correctif. Chemin NORMAL (RV-37, `service-emission.ts::marquerVehiculeVenduSiApplicable`)
      // inchangé : la facture qui marque le véhicule `vendu` EST déjà rattachée à ce dossier, donc
      // toujours trouvée ici — non-régression vérifiée par `service-dossier-vente.spec.ts`.
      const facturesDossier = await tx
        .select({ id: documentVente.id })
        .from(documentVente)
        .where(
          and(
            eq(documentVente.tenantId, ctx.tenantId),
            eq(documentVente.dossierVenteId, dossierVenteId),
            eq(documentVente.typeDocument, 'facture'),
            inArray(documentVente.statut, ['emis', 'annule_par_avoir']),
          ),
        )
        .limit(1);
      if (facturesDossier.length === 0) {
        throw new ErreurMetier(
          'VENTE_LIVRAISON_FACTURE_REQUISE',
          `Livraison impossible : aucune facture émise n'est rattachée à ce dossier de vente (RV-37) — le véhicule porte le statut « ${vehiculeStockLigne.statutCommercial} », probablement posé par une correction manuelle (POST /vehicules/{id}/stock/marquer-vendu) plutôt que par l'émission réelle d'une facture.`,
          {
            detail: `dossierVenteId=${dossierVenteId} ; aucun document_vente typeDocument=facture statut∈{emis,annule_par_avoir} trouvé.`,
          },
        );
      }

      const maintenant = this.horloge.maintenant();
      await this.transitionnerVehiculeStock(tx, vehiculeStockLigne, {
        statutCommercial: 'livre',
        livreLe: maintenant,
      });
      await this.transitionnerDossier(tx, ligne, {
        statut: 'livre',
        livreLe: maintenant,
        dateLivraisonEffective: entree.dateLivraisonEffective,
      });

      // RV-53/RV-57 : clôture de la détention côté garage/ancien propriétaire (motif `vente`),
      // ouverture au nom du client conducteur — PAS de l'organisme de financement même en leasing
      // (CV-08, RV-40 dernier paragraphe).
      const nouveauDetenteurId = ligne.clientConducteurId ?? ligne.clientAcheteurId;
      const [detentionOuverte] = await tx
        .select({ id: vehiculeDetention.id, du: vehiculeDetention.du })
        .from(vehiculeDetention)
        .where(
          and(
            eq(vehiculeDetention.tenantId, ctx.tenantId),
            eq(vehiculeDetention.vehiculeId, vehiculeId),
            isNull(vehiculeDetention.au),
          ),
        )
        .limit(1);
      // BUG CORRIGÉ (constaté en exécution réelle, signalé par un lot tiers, `remonter-cause-pg.ts`
      // citait déjà ce fichier parmi les quatre concernés) : cette clôture/réouverture de détention
      // n'était protégée par AUCUN try/catch — une `dateLivraisonEffective` antérieure au `du` de la
      // détention actuellement ouverte viole `vehicule_detention_periode_chk` (`au > du`,
      // `schema/atelier/vehicule.ts`) et ressortait en 500 `ERREUR_INTERNE` au lieu d'un code métier
      // stable. Traduction réutilisée telle quelle depuis `vehicules/erreurs-contraintes.ts`
      // (`interpreterContrainteVehicule`, déjà câblée pour ce couple SQLSTATE/contrainte côté
      // `ServiceVehiculeDetention.changerDetenteur`) — pas une seconde table de contraintes.
      //
      // ISSUE #13 — « livrer le jour même échoue » : `vehicule_detention_periode_chk` impose
      // `au > du` STRICT. `du`/`au` sont des `date` Postgres (jour civil, `schemaDateJour` côté
      // contrat — AUCUNE heure, donc aucun fuseau à convertir ici : la date saisie par le comptoir
      // EST déjà « aujourd'hui » au sens suisse voulu, telle quelle). Si la détention actuellement
      // ouverte a démarré CE MÊME jour civil (ex. véhicule/détenteur enregistrés le matin,
      // livraison l'après-midi — le cas le plus courant en concession), `entree.dateLivraisonEffective`
      // est ÉGALE à `detentionOuverte.du`, jamais strictement supérieure : la clôture échouait
      // systématiquement, alors qu'il n'y a AUCUN conflit réel (la détention n'a jamais chevauché
      // qui que ce soit). Comparer à l'heure près (timestamptz) réglerait le problème mais `du`/`au`
      // ne portent pas cette précision — changer leur granularité est un choix de schéma
      // (`db/schema/atelier/vehicule.ts`, hors périmètre de ce module) ; décaler arbitrairement la
      // date d'un jour falsifierait la donnée saisie. Seule option correcte disponible SANS toucher
      // au schéma : transférer le détenteur SUR LA MÊME ligne plutôt que clôturer/réouvrir — `du`
      // n'est pas altéré (aucune date inventée), la ligne reste ouverte, et le trigger
      // `vehicule_detention_audit` (AFTER INSERT OR DELETE OR UPDATE) capture le changement de
      // `client_id` avant/après comme toute autre écriture (RM-111). Notons que `DELETE` est de
      // toute façon révoqué pour `dfa_app` sur cette table (migrations/0007_vehicules.sql) : un
      // couple DELETE+INSERT n'était pas une option. Quand `du` est strictement AVANT la date de
      // livraison (cas normal), le comportement clôture+réouverture existant est inchangé ; quand
      // `du` serait APRÈS (date de livraison antérieure à une détention déjà ouverte), la clôture
      // échoue toujours — c'est le refus attendu, `traduireErreurDetentionVehicule` le restitue en
      // 400 métier stable.
      await this.avecTraductionErreur(
        async () => {
          if (detentionOuverte && detentionOuverte.du === entree.dateLivraisonEffective) {
            await tx
              .update(vehiculeDetention)
              .set({ clientId: nouveauDetenteurId })
              .where(
                and(
                  eq(vehiculeDetention.tenantId, ctx.tenantId),
                  eq(vehiculeDetention.id, detentionOuverte.id),
                ),
              );
            return;
          }
          if (detentionOuverte) {
            await tx
              .update(vehiculeDetention)
              .set({ au: entree.dateLivraisonEffective, motifFin: 'vente' })
              .where(
                and(
                  eq(vehiculeDetention.tenantId, ctx.tenantId),
                  eq(vehiculeDetention.id, detentionOuverte.id),
                ),
              );
          }
          await tx.insert(vehiculeDetention).values({
            tenantId: ctx.tenantId,
            vehiculeId,
            clientId: nouveauDetenteurId,
            du: entree.dateLivraisonEffective,
          });
        },
        (erreur) => this.traduireErreurDetentionVehicule(erreur),
      );

      // RV-24 : une reprise CONFIRMÉE entre en stock à la livraison — TROU COMBLÉ (constaté en
      // reprenant ce fichier : `origineRepriseDossierVenteId` n'était jamais ÉCRIT nulle part dans
      // ce module, seulement lu). C'est la VALEUR NÉGOCIÉE, jamais l'estimée (RV-24, littéral,
      // rappel explicite en pied de `contrats/ventes/reprise.ts`), qui devient le prix d'achat
      // d'entrée en stock. `chargerRepriseOuNullPourEcriture` verrouille la ligne reprise pour la
      // durée de CETTE transaction (même verrou que `engager()`), donc atomique avec le reste de
      // `livrer()` : facture déjà émise, livraison ET entrée en stock de la reprise réussissent ou
      // échouent ensemble.
      const repriseLigne = await this.chargerRepriseOuNullPourEcriture(tx, ctx, dossierVenteId);
      if (repriseLigne && repriseLigne.statut === 'confirmee') {
        if (repriseLigne.valeurNegocieeCentimes === null) {
          // Ne peut pas arriver en pratique : `reprise_valeur_negociee_requise_chk`
          // (migrations/0032_ventes.sql) impose cette valeur dès que `statut <> 'estimee'`. Garde
          // défensive pour le typage (colonne nullable côté Drizzle), pas un cas métier attendu.
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            'Reprise confirmée sans valeur négociée — incohérence de données (RV-27).',
          );
        }

        // Garde applicative explicite (SELECT verrouillé avant INSERT), même style que
        // `ServiceVehiculeStock.mettreEnStock` pour `VENTE_VEHICULE_STOCK_DEJA_EXISTANT` : plus
        // lisible qu'une contrainte SQL brute, le `catch` ci-dessous reste le filet (course
        // concurrente), pas le mécanisme.
        const dejaEnStock = await chargerVehiculeStockOuNull(
          tx,
          ctx,
          repriseLigne.vehiculeRepriseId,
          true,
        );
        if (dejaEnStock) {
          throw new ErreurMetier(
            'VENTE_VEHICULE_STOCK_DEJA_EXISTANT',
            'Le véhicule repris est déjà (ou a déjà été) mis en stock.',
          );
        }

        try {
          await tx.insert(vehiculeStock).values({
            id: repriseLigne.vehiculeRepriseId,
            tenantId: ctx.tenantId,
            // RV-24 littéral ne précise pas le site — le dossier de vente porteur de la reprise est
            // la seule référence de site disponible à ce stade (pas de second champ « site de
            // reprise » dans le contrat `reprise.ts`).
            siteId: ligne.siteId,
            provenance: 'reprise',
            dateEntreeStock: entree.dateLivraisonEffective,
            prixAchatCentimes: repriseLigne.valeurNegocieeCentimes,
            // Même dérivation que `mettreEnStock` : `provenance = 'reprise'` n'est jamais
            // `neuf_constructeur`, donc jamais `en_commande` — toujours `disponible` d'emblée.
            statutCommercial: 'disponible',
            receptionneLe: maintenant,
            origineRepriseDossierVenteId: dossierVenteId,
          });
        } catch (erreur) {
          if (estViolationCleUniqueVehiculeStock(erreur)) {
            throw new ErreurMetier(
              'VENTE_VEHICULE_STOCK_DEJA_EXISTANT',
              'Le véhicule repris est déjà (ou a déjà été) mis en stock.',
            );
          }
          throw erreur;
        }
        // Audit : `vehicule_stock_audit` (trigger `after insert`, migrations/0032_ventes.sql)
        // capture cette création automatiquement — aucun appel explicite à `ServiceAudit` requis,
        // même mécanisme que la création via `POST /vehicules/{id}/stock`.

        // Détention du véhicule REPRIS : clôture motif `reprise` (RV-23), SANS réouverture — le
        // détenteur cible n'est PAS tranché (`QV-01`, rappel explicite en pied de
        // `contrats/ventes/reprise.ts`) ; cette action ne l'invente pas.
        const [detentionRepriseOuverte] = await tx
          .select({ id: vehiculeDetention.id, du: vehiculeDetention.du })
          .from(vehiculeDetention)
          .where(
            and(
              eq(vehiculeDetention.tenantId, ctx.tenantId),
              eq(vehiculeDetention.vehiculeId, repriseLigne.vehiculeRepriseId),
              isNull(vehiculeDetention.au),
            ),
          )
          .limit(1);
        // ISSUE #13, même défaut ici que sur la clôture ci-dessus : `vehicule_detention_periode_chk`
        // (`au > du` strict, jour civil) refuse de clôturer une détention ouverte CE MÊME jour —
        // cas atteignable si l'ancien propriétaire du véhicule repris a été enregistré (ou son
        // changement de détenteur) le jour même de cette reprise. Contrairement au bloc principal
        // ci-dessus, il n'y a ICI aucun nouveau détenteur vers qui transférer la ligne (QV-01,
        // toujours non tranché : « SANS réouverture », commentaire au-dessus) — le seul correctif
        // disponible sans schéma serait de mutariser la ligne vers un détenteur, or aucun n'existe.
        // On laisse donc cette détention ouverte plutôt que de faire échouer TOUTE la livraison
        // (véhicule vendu + reprise) pour une clôture que le modèle jour-civil ne peut de toute
        // façon pas représenter proprement à J égal (durée nulle, `DELETE` révoqué pour `dfa_app`,
        // migrations/0007_vehicules.sql — repartir d'une ligne neuve est également impossible) :
        // une détention qui reste un jour de trop au nom de l'ancien propriétaire, corrigible via
        // `POST /vehicules/{id}/detentions` (vehicules/, hors périmètre), est un moindre défaut
        // qu'une livraison bloquée.
        if (
          detentionRepriseOuverte &&
          detentionRepriseOuverte.du !== entree.dateLivraisonEffective
        ) {
          // Même garde que la clôture de détention ci-dessus (bug corrigé) : traduit une violation
          // de `vehicule_detention_periode_chk`/`vehicule_detention_unicite_excl` plutôt que de la
          // laisser fuiter en 500.
          await this.avecTraductionErreur(
            async () => {
              await tx
                .update(vehiculeDetention)
                .set({ au: entree.dateLivraisonEffective, motifFin: 'reprise' })
                .where(
                  and(
                    eq(vehiculeDetention.tenantId, ctx.tenantId),
                    eq(vehiculeDetention.id, detentionRepriseOuverte.id),
                  ),
                );
            },
            (erreur) => this.traduireErreurDetentionVehicule(erreur),
          );
        }
      }

      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  /**
   * `POST /dossiers-vente/{id}/cloturer` — `livre -> clos`.
   *
   * Même garde de rejeu explicite que `preparer`/`marquerPretALivrer` (voir la docstring de
   * `preparer`) : `clos` est terminal, mais rien n'empêchait avant ce correctif un second appel
   * après une première clôture réussie de passer en silence (seul `closLe` aurait bougé).
   */
  async cloturer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    _entree: EntreeActionCloturerDossierVente,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVentePourEcriture(tx, ctx, dossierVenteId);
      if (ligne.statut !== 'livre') {
        throw new ErreurMetier(
          'VENTE_DOSSIER_TRANSITION_INTERDITE',
          `Clôture impossible : ce dossier n'est pas « livre » (statut actuel : ${ligne.statut}).`,
        );
      }
      await this.transitionnerDossier(tx, ligne, {
        statut: 'clos',
        closLe: this.horloge.maintenant(),
      });
      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  /** `POST /dossiers-vente/{id}/annuler` — depuis `prospection`/`engage`/`en_preparation` UNIQUEMENT
   *  (RV-38, §6.2), motif obligatoire. */
  async annuler(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    entree: EntreeActionAnnulerDossierVente,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.terminerSansLivraison(ctx, role, dossierVenteId, 'annule', entree.motif);
  }

  /** `POST /dossiers-vente/{id}/abandonner` — même garde que `annuler`, sémantique distincte
   *  (rupture volontaire vs client qui ne répond plus). */
  async abandonner(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    entree: EntreeActionAbandonnerDossierVente,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.terminerSansLivraison(ctx, role, dossierVenteId, 'abandonne', entree.motif);
  }

  private async terminerSansLivraison(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    versStatut: 'annule' | 'abandonne',
    motif: string,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerDossierVentePourEcriture(tx, ctx, dossierVenteId);

      if (
        ligne.statut !== 'prospection' &&
        ligne.statut !== 'engage' &&
        ligne.statut !== 'en_preparation'
      ) {
        throw new ErreurMetier(
          'VENTE_DOSSIER_ANNULATION_IMPOSSIBLE',
          `Ce dossier ne peut plus être annulé/abandonné depuis son état actuel (${ligne.statut}) — RV-38 verrouille toute correction dès la préparation dépassée.`,
        );
      }

      const maintenant = this.horloge.maintenant();
      await this.transitionnerDossier(tx, ligne, {
        statut: versStatut,
        ...(versStatut === 'annule' ? { annuleLe: maintenant } : { abandonneLe: maintenant }),
        motifCloture: motif,
      });

      // CV-01 : un véhicule réservé le redevient disponible, jamais bloqué indéfiniment.
      if (ligne.vehiculeId) {
        const vehiculeStockLigne = await chargerVehiculeStockOuNull(
          tx,
          ctx,
          ligne.vehiculeId,
          true,
        );
        if (vehiculeStockLigne?.statutCommercial === 'reserve') {
          await this.transitionnerVehiculeStock(tx, vehiculeStockLigne, {
            statutCommercial: 'disponible',
            dernierMotifTransition: motif,
          });
        }
      }

      return this.assemblerReponseFinale(tx, ctx, role, dossierVenteId);
    });
  }

  // -----------------------------------------------------------------------------------------
  // Assemblage + primitives internes
  // -----------------------------------------------------------------------------------------

  // `pourListe` (déf. `false`) : quand `true` (uniquement depuis `lister()`), saute
  // `this.audit.pourEntite` — lequel ouvre SA PROPRE transaction (`ServiceAuditImpl.pourEntite`,
  // `common/audit/service-audit.ts`, hors périmètre de ce module). Appelé une fois par élément dans
  // un `Promise.all` sur toute une page (`limite` max = 200), il réclamait jusqu'à ~200 connexions
  // imbriquées d'un coup et épuisait le pool `pg`. Le seul champ qui en dépend est `modifiePar`
  // (dernier événement du journal) — un champ de RÉPONSE, jamais consulté par le calcul de
  // statut/droits ni affiché en LISTE (`DossierVenteResume` ne le porte pas). Le vider en liste
  // (`null`, valeur déjà couverte par le type) est sans perte réelle et supprime intégralement le
  // problème (zéro requête d'audit, pas seulement une sérialisation). Même correctif que
  // `ServiceOr.assemblerDocument`.
  private async assembler(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    ligne: LigneDossierVente,
    pourListe = false,
  ): Promise<ReponseDossierVente> {
    const clientAcheteurLigne = await chargerClientLigne(tx, ctx, ligne.clientAcheteurId);
    const clientAcheteur = await versClientResume(tx, ctx, clientAcheteurLigne);
    const clientFactureLigne = ligne.clientFactureId
      ? await chargerClientLigne(tx, ctx, ligne.clientFactureId)
      : clientAcheteurLigne;
    const clientFacture = ligne.clientFactureId
      ? await versClientResume(tx, ctx, clientFactureLigne)
      : clientAcheteur;
    const clientConducteur = ligne.clientConducteurId
      ? await versClientResume(tx, ctx, await chargerClientLigne(tx, ctx, ligne.clientConducteurId))
      : null;

    const { vehicule, typeVehicule, garantie } = await this.assemblerVehicule(
      tx,
      ctx,
      ligne.vehiculeId,
    );

    // FAILLE CORRIGÉE (audit sécurité) : `reprise`/`financement(s)` n'étaient JAMAIS gatés par leur
    // propre droit de lecture — `GET /dossiers-vente/{id}` (protégé par `ventes.dossier.lire` SEUL)
    // exposait TOUJOURS le détail complet, y compris à un rôle sans `ventes.reprise.lire`/
    // `ventes.financement.lire` (`chef_atelier`, voir `mappers.ts::roleVoitReprise`/
    // `roleVoitFinancement` pour le détail de la faille). Le rôle SANS le droit correspondant ne
    // déclenche même plus la requête : `undefined` en amont, jamais une valeur chargée puis
    // masquée trop tard — `versDossierVenteResponse` omet alors la clé ENTIÈRE de la réponse.
    const repriseResume = roleVoitReprise(role)
      ? await this.assemblerRepriseResume(tx, ctx, ligne.id)
      : undefined;

    let financements: FinancementResume[] | undefined;
    let financementCourant: FinancementResume | null | undefined;
    let financementsTronques: boolean | undefined;
    if (roleVoitFinancement(role)) {
      const financementsLignes = await listerFinancementsDossier(tx, ctx, ligne.id);
      const financementCourantLigne = selectionnerFinancementCourant(financementsLignes);
      const financementsAssembles: FinancementResume[] = [];
      let courant: FinancementResume | null = null;
      for (const f of financementsLignes) {
        const organisme = f.organismeId
          ? await versClientResume(tx, ctx, await chargerClientLigne(tx, ctx, f.organismeId))
          : null;
        const resume = versFinancementResume(f, organisme, role);
        financementsAssembles.push(resume);
        if (financementCourantLigne && f.id === financementCourantLigne.id) courant = resume;
      }
      financements = financementsAssembles;
      financementCourant = courant;
      // Contrat : « borné par SEUIL_FINANCEMENTS_EMBARQUES comme filet plutôt que par nécessité
      // réelle » (un garage ne réessaie pas dix organismes) — jamais tronqué en pratique.
      financementsTronques = false;
    }

    const documentsBrut = await listerDocumentsDossierBrut(tx, ctx, ligne.id);
    const documentsTronques = documentsBrut.length > SEUIL_DOCUMENTS_DOSSIER;
    const documentsRetenus = documentsTronques
      ? documentsBrut.slice(0, SEUIL_DOCUMENTS_DOSSIER)
      : documentsBrut;
    // #127 : totaux TTC recalculés en direct pour les documents `brouillon` (colonne stockée figée
    // seulement à l'émission, voir la docstring de `totauxTtcAffichesDocumentsDossier`).
    const totauxTtcAffiches = await totauxTtcAffichesDocumentsDossier(tx, ctx, documentsRetenus);
    const documents = documentsRetenus.map((d) =>
      versDocumentVenteResume(d, role, totauxTtcAffiches.get(d.id) ?? Number(d.totalTtcCentimes)),
    );

    const documentsRequisLignes = await listerDocumentsRequis(tx, ctx, ligne.id);
    const documentsRequis = documentsRequisLignes.map(versDocumentRequisResponse);

    const modifiePar = pourListe
      ? null
      : await chargerResumeUtilisateur(
          tx,
          ctx,
          (await this.audit.pourEntite(ctx, 'dossier_vente', ligne.id)).at(-1)?.utilisateurId ??
            null,
        );

    return versDossierVenteResponse({
      ligne,
      vehicule,
      typeVehicule,
      clientAcheteur,
      clientFacture,
      clientConducteur,
      reprise: repriseResume,
      financement: financementCourant,
      financements,
      financementsTronques,
      garantie,
      documents,
      documentsTronques,
      documentsRequis,
      role,
      modifiePar,
    });
  }

  /** Recharge le dossier depuis la base puis l'assemble, enveloppé pour la réponse HTTP — le motif
   *  de fin commun à toutes les transitions et à `modifier`/`marquerDocumentRequis` (huit sites
   *  identiques avant cette factorisation). `creer()` et `obtenirComplet()` ne l'utilisent PAS : le
   *  premier assemble une ligne déjà en main (pas de rechargement), le second rend
   *  `ReponseDossierVente` nu, jamais enveloppé d'avertissements. */
  private async assemblerReponseFinale(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
  ): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
    const misAJour = await chargerDossierVente(tx, ctx, dossierVenteId);
    const reponse = await this.assembler(tx, ctx, role, misAJour);
    return new CollecteurAvertissements().envelopper(reponse);
  }

  private async assemblerVehicule(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    vehiculeId: string | null,
  ): Promise<{
    vehicule: VehiculeStockResume | null;
    typeVehicule: ReponseDossierVente['typeVehicule'];
    garantie: SuiviGarantie | null;
  }> {
    if (!vehiculeId) return { vehicule: null, typeVehicule: null, garantie: null };

    const vehiculeStockLigne = await chargerVehiculeStock(tx, ctx, vehiculeId);
    const vehiculeLigne = await chargerVehiculeLigne(tx, ctx, vehiculeId);
    const plaque = await chargerPlaqueCourante(tx, ctx, vehiculeId);
    const resumeVehicule = construireVehiculeResume(vehiculeLigne, plaque);
    const typeVehicule = calculerTypeVehicule(
      vehiculeStockLigne.provenance,
      vehiculeLigne.date1reCirculation,
    );

    const vehicule: VehiculeStockResume = {
      id: vehiculeStockLigne.id,
      vehicule: resumeVehicule,
      provenance: vehiculeStockLigne.provenance as ProvenanceVehiculeStock,
      typeVehicule,
      statutCommercial: vehiculeStockLigne.statutCommercial,
      prixVenteAfficheCentimes: vehiculeStockLigne.prixVenteAfficheCentimes,
      joursStock: 0,
    };
    // `vehicule.garantieDebut`/`garantieMois`/`garantieKm` existent depuis `migrations/
    // 0007_vehicules.sql` (RM-33, étape 1) — pas de nouvelle colonne, LECTURE seule. Même fonction
    // pure que `GET /ventes/suivi` (`construireSuiviGarantie`), même relevé de kilométrage
    // (`lireDernierKilometrage`, `vehicules/vehicule-requetes.ts`) pour que `active` évalue la
    // borne kilométrique exactement comme le suivi — jamais une seconde règle d'« encore valable ».
    const dernierKilometrage = await lireDernierKilometrage(tx, ctx, vehiculeId);
    const garantie = construireSuiviGarantie(
      vehiculeLigne.garantieDebut,
      vehiculeLigne.garantieMois,
      vehiculeLigne.garantieKm,
      dernierKilometrage?.valeurKm ?? null,
      this.horloge.maintenant(),
    );
    return { vehicule, typeVehicule, garantie };
  }

  private async assemblerRepriseResume(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    dossierVenteId: string,
  ): Promise<RepriseResume | null> {
    const repriseLigne = await chargerRepriseParDossierOuNull(tx, ctx, dossierVenteId, false);
    if (!repriseLigne) return null;
    const vehiculeRepriseLigne = await chargerVehiculeLigne(
      tx,
      ctx,
      repriseLigne.vehiculeRepriseId,
    );
    const plaqueReprise = await chargerPlaqueCourante(tx, ctx, repriseLigne.vehiculeRepriseId);
    const vehiculeRepriseResume = construireVehiculeResume(vehiculeRepriseLigne, plaqueReprise);
    return versRepriseResume(repriseLigne, vehiculeRepriseResume);
  }

  /** Utilisée par `engager()` — `null` si aucune reprise n'existe pour ce dossier, jamais une
   *  exception (la reprise reste une composante OPTIONNELLE, RV-25). */
  private async chargerRepriseOuNullPourEcriture(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    dossierVenteId: string,
  ): Promise<LigneReprise | null> {
    return chargerRepriseParDossierOuNull(tx, ctx, dossierVenteId, true);
  }

  private async transitionnerDossier(
    tx: TransactionDfa,
    ligne: LigneDossierVente,
    champs: Partial<Omit<LigneDossierVente, 'id' | 'tenantId'>> & {
      readonly statut: LigneDossierVente['statut'];
    },
  ): Promise<void> {
    await this.avecTraductionErreur(
      async () => {
        await tx
          .update(dossierVente)
          .set(champs)
          .where(and(eq(dossierVente.tenantId, ligne.tenantId), eq(dossierVente.id, ligne.id)));
      },
      (erreur) => traduireErreurTransitionVente(erreur, ligne.id, ligne.id),
    );
  }

  private async transitionnerVehiculeStock(
    tx: TransactionDfa,
    ligne: LigneVehiculeStock,
    champs: Partial<Omit<LigneVehiculeStock, 'id' | 'tenantId'>> & {
      readonly statutCommercial: LigneVehiculeStock['statutCommercial'];
    },
  ): Promise<void> {
    await tx
      .update(vehiculeStock)
      .set(champs)
      .where(and(eq(vehiculeStock.tenantId, ligne.tenantId), eq(vehiculeStock.id, ligne.id)));
  }

  /**
   * BUG CORRIGÉ (`livrer()`, constaté en exécution réelle) : `vehicule_detention` porte deux
   * contraintes qu'une saisie utilisateur peut légitimement violer — `vehicule_detention_periode_chk`
   * (`au is null or au > du` : `dateLivraisonEffective` antérieure au début de la détention en
   * cours) et `vehicule_detention_unicite_excl` (RM-20 : deux détentions actives simultanées sur le
   * même véhicule). Sans traduction, l'une ou l'autre remontait en 500 `ERREUR_INTERNE` — jamais
   * acceptable pour une transition de machine à états (CONTRIBUTING.md). Réutilise
   * `interpreterContrainteVehicule` (`vehicules/erreurs-contraintes.ts`) TEL QUEL : cette table de
   * contraintes existe déjà et couvre exactement ces deux noms, inutile d'en tenir une seconde ici
   * (même bug que celui déjà documenté sur `traduireErreurTransitionVente`/
   * `estViolationCleUniqueVehiculeStock` dans ce fichier — l'un et l'autre déballent déjà `.cause`,
   * seul ce troisième site en avait été oublié).
   */
  private traduireErreurDetentionVehicule(erreur: unknown): ErreurMetier | null {
    const violee = interpreterContrainteVehicule(erreur);
    if (!violee) return null;
    const message =
      violee.contrainte === 'vehicule_detention_periode_chk'
        ? "La date de livraison précède le début d'une détention déjà enregistrée pour ce véhicule — vérifiez la date saisie."
        : 'Ce véhicule porte déjà une détention active sur la période demandée (RM-20).';
    // CORRECTIF DE CONSTAT (relu en reprenant ce fichier) : `message` n'était passé qu'au
    // constructeur `Error` sous-jacent (`super(message)`, `ErreurMetier.message`), jamais à
    // `options.detail` — le seul champ que `FiltreProbleme`/`construireCorps` sérialise dans le
    // corps `problem+json` réellement renvoyé au client (`title` ne porte que le libellé FR FIXE
    // par code, `TITRE_FR_PAR_CODE_ERREUR`, pas ce message contextualisé). Sans `detail`, le
    // 400 `VALIDATION_ECHOUEE` renvoyé ici était certes stable (pas un 500), mais totalement muet
    // pour l'appelant : aucune indication de CE QUI bloque, ni pourquoi (constaté en reproduisant
    // `POST /dossiers-vente/{id}/livrer` en conditions réelles — la seule différence visible entre
    // ce cas et un corps JSON malformé était l'absence du champ `erreurs`).
    return new ErreurMetier(violee.code, message, { detail: message });
  }

  private async transitionnerReprise(
    tx: TransactionDfa,
    ligne: LigneReprise,
    champs: Partial<Omit<LigneReprise, 'id' | 'tenantId'>> & {
      readonly statut: LigneReprise['statut'];
    },
  ): Promise<void> {
    await this.avecTraductionErreur(
      async () => {
        await tx
          .update(reprise)
          .set(champs)
          .where(and(eq(reprise.tenantId, ligne.tenantId), eq(reprise.id, ligne.id)));
      },
      (erreur) => traduireErreurTransitionVente(erreur, ligne.id, ligne.id),
    );
  }

  /** Exécute `travail`, catch, et traduit via `traducteur` — relance la traduction si elle réussit,
   *  sinon relance l'erreur d'origine telle quelle. Factorise le patron catch/traduire/relancer
   *  répété quatre fois dans ce fichier avant cette extraction (transitions dossier/reprise,
   *  ouverture et clôture de la détention véhicule à la livraison). */
  private async avecTraductionErreur<T>(
    travail: () => Promise<T>,
    traducteur: (erreur: unknown) => ErreurMetier | null,
  ): Promise<T> {
    try {
      return await travail();
    } catch (erreur) {
      const traduite = traducteur(erreur);
      if (traduite) throw traduite;
      throw erreur;
    }
  }
}

/** `23505` = `unique_violation` PostgreSQL — course concurrente sur `vehicule_stock.id` (PK, =
 *  `vehicule.id`) au moment de la mise en stock automatique d'une reprise confirmée. COPIE LOCALE
 *  VOLONTAIRE de `service-vehicule-stock.ts::estViolationCleUnique` (non exportée) — même doctrine
 *  de duplication assumée que `service-reprise.ts` pour la même petite fonction ; seul le
 *  déballage de `.cause` est factorisé via `remonterCausePg` (voir
 *  `common/erreurs-pg/remonter-cause-pg.ts`), pas la règle métier elle-même. */
export function estViolationCleUniqueVehiculeStock(erreur: unknown): boolean {
  return remonterCausePg(erreur)?.code === '23505';
}
