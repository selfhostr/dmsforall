import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  OrdreReparationResume,
  ReponseClient,
  ReponseClientAdresse,
  ReponseClientCondition,
  ReponseClientConsentement,
  ReponseClientContact,
  ReponseClientNote,
  VehiculeResume,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { enDate, JETON_DB } from '../db';
import {
  client,
  clientAdresse,
  clientCondition,
  clientConsentement,
  clientContact,
  clientNote,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs';

import type { EntreeAnonymisationClient } from './schemas';
import { schemaListeOrDuClient, schemaListeVehiculesDuClient } from './schemas';
import {
  versAdresseResponse,
  versConditionResponse,
  versConsentementResponse,
  versContactResponse,
  versNoteResponse,
} from './mappers';
import { ServiceClient } from './service-client';
import { ServiceClientOrdresReparation } from './service-client-ordres-reparation';
import { ServiceClientVehicules } from './service-client-vehicules';

/** Même patron que `service-client-sous-collections.ts::estViolation` (fichier-local, non
 *  partagé — voir le commentaire de tête de cette fonction là-bas). Repris ici pour reconnaître
 *  la violation de `client_anonymisation_tenant_client_uk` (migration 0061, garde d'idempotence
 *  en base : un second geste sur le même client échoue par contrainte). */
const PROFONDEUR_MAX_CAUSE = 10;
function estViolation(erreur: unknown, sqlstate: string, contrainte?: string): boolean {
  let courante: unknown = erreur;
  for (let profondeur = 0; profondeur < PROFONDEUR_MAX_CAUSE; profondeur += 1) {
    if (typeof courante !== 'object' || courante === null) return false;
    const brute = courante as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (brute.code === sqlstate && (contrainte === undefined || brute.constraint === contrainte)) {
      return true;
    }
    courante = brute.cause;
  }
  return false;
}

type LigneDocumentVenteExportBrute = {
  readonly id: string;
  readonly numero: string | null;
  readonly typeDocument: string;
  readonly statut: string;
  readonly dateDocument: string | null;
  // `total_ttc_centimes` est `bigint` (`document_vente.ts`) : le pilote `pg` le rend en STRING via
  // `tx.execute()` (aucun `setTypeParser` sur OID 20 dans ce dépôt) — jamais un `Number()`
  // implicite. Converti explicitement dans `versDocumentVenteExport` ci-dessous. Les montants
  // d'un client réel restent très en-deçà de `Number.MAX_SAFE_INTEGER` en centimes.
  readonly totalTtcCentimes: string;
  readonly devise: string;
};

type LigneRendezVousExportBrute = {
  readonly id: string;
  readonly date: string;
  readonly moment: string;
  readonly statut: string;
  readonly commentaire: string | null;
  readonly motifAnnulation: string | null;
};

type LigneRelanceExportBrute = {
  readonly id: string;
  readonly typeRelance: string;
  readonly palier: number;
  readonly canal: string;
  readonly destinataireFige: string;
  readonly contenuFige: string;
  readonly statutEnvoi: string;
  readonly envoyeLe: Date | string;
};

export interface ExportClient {
  readonly genereLe: string;
  readonly client: ReponseClient;
  readonly adresses: readonly ReponseClientAdresse[];
  readonly contacts: readonly ReponseClientContact[];
  readonly conditions: readonly ReponseClientCondition[];
  readonly consentements: readonly ReponseClientConsentement[];
  readonly notes: readonly ReponseClientNote[];
  readonly vehicules: readonly VehiculeResume[];
  readonly ordresReparation: readonly OrdreReparationResume[];
  readonly documentsVente: readonly {
    readonly id: string;
    readonly numero: string | null;
    readonly typeDocument: string;
    readonly statut: string;
    readonly dateDocument: string | null;
    readonly totalTtcCentimes: number;
    readonly devise: string;
  }[];
  readonly rendezVous: readonly LigneRendezVousExportBrute[];
  readonly relances: readonly {
    readonly id: string;
    readonly typeRelance: string;
    readonly palier: number;
    readonly canal: string;
    readonly destinataireFige: string;
    readonly contenuFige: string;
    readonly statutEnvoi: string;
    readonly envoyeLe: string;
  }[];
}

/**
 * Droits nLPD sur la fiche client (tâche « effacement nLPD », migration 0061) :
 *
 *  - `exporter()` (droit d'ACCÈS, art. 25) : bundle complet et LISIBLE de tout ce que
 *    l'application détient sur un client — recensement exhaustif en tête de
 *    `migrations/0061_anonymisation_client.sql`, y compris les emplacements hors de portée de ce
 *    module (signalés en commentaire dans `relances`, ci-dessous). Lecture seule, aucun effet de
 *    bord, jamais d'idempotence à gérer.
 *
 *  - `anonymiser()` (droit à l'EFFACEMENT, art. 32) : geste IRRÉVERSIBLE, un seul par client
 *    (`client_anonymisation_tenant_client_uk`, migration 0061). Toute la donnée effacée est
 *    scrubée par `public.anonymiser_client_donnees()` (SECURITY DEFINER — dfa_app n'a pas les
 *    privilèges pour redresser `audit_atelier` seul, voir l'en-tête de la migration) ; CE service
 *    pose la trace `client_anonymisation` (qui/quand/motif STAFF — JAMAIS les données du client),
 *    puis appelle la fonction base. `client_anonymisation` INSÉRÉE AVANT le scrub, dans la MÊME
 *    transaction : la contrainte unique sert de verrou d'idempotence — un second appel échoue par
 *    violation de contrainte, mappée en `409 CLIENT_DEJA_ANONYMISE`, jamais une double
 *    anonymisation silencieuse.
 *
 * Le rôle est vérifié EN AMONT par `GardeDroit` (`@ExigerDroit('client.export.generer'
 * |'client.anonymiser')`, `client-rgpd.controller.ts`, matrice `auth/matrice-droits.ts`) — ce
 * service ne revérifie plus le rôle lui-même : le palliatif `droits-provisoires.ts` a été retiré.
 */
@Injectable()
export class ServiceClientRgpd {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly serviceClient: ServiceClient,
    private readonly serviceClientVehicules: ServiceClientVehicules,
    private readonly serviceClientOrdresReparation: ServiceClientOrdresReparation,
  ) {}

  async exporter(ctx: ContexteTenant, clientId: string): Promise<ExportClient> {
    const [
      ficheClient,
      { adresses, contacts, conditions, consentements, notes },
      vehicules,
      ordresReparation,
      documentsVente,
      rendezVous,
      relances,
    ] = await Promise.all([
      this.serviceClient.parId(ctx, clientId),
      this.chargerSousCollections(ctx, clientId),
      this.listerTousLesVehicules(ctx, clientId),
      this.listerTousLesOr(ctx, clientId),
      this.listerDocumentsVente(ctx, clientId),
      this.listerRendezVous(ctx, clientId),
      this.listerRelances(ctx, clientId),
    ]);

    return {
      genereLe: new Date().toISOString(),
      client: ficheClient,
      adresses,
      contacts,
      conditions,
      consentements,
      notes,
      vehicules,
      ordresReparation,
      documentsVente,
      rendezVous,
      relances,
    };
  }

  async anonymiser(
    ctx: ContexteTenant,
    clientId: string,
    entree: EntreeAnonymisationClient,
  ): Promise<ReponseClient> {
    await this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select({ id: client.id })
        .from(client)
        .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
        .limit(1);
      // 404, jamais 403 : même doctrine que `ServiceClient.chargerOu404` — un client d'un autre
      // tenant ne doit même pas laisser deviner qu'il existe.
      if (!lignes[0]) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');

      try {
        await tx.execute(sql`
          insert into public.client_anonymisation (tenant_id, client_id, utilisateur_id, motif)
          values (${ctx.tenantId}, ${clientId}, ${ctx.utilisateurId}, ${entree.motif})
        `);
      } catch (erreur) {
        if (estViolation(erreur, '23505', 'client_anonymisation_tenant_client_uk')) {
          throw new ErreurMetier('CLIENT_DEJA_ANONYMISE', 'Ce client a déjà été anonymisé.');
        }
        throw erreur;
      }

      await tx.execute(
        sql`select public.anonymiser_client_donnees(${ctx.tenantId}::uuid, ${clientId}::uuid)`,
      );
    });

    // Séquentiel, HORS de la transaction ci-dessus (donc sur l'état réellement commité) : nicher
    // un second `acces.enTenant(...)` dans le premier ouvrirait une connexion DIFFÉRENTE du pool
    // (voir CONTRIBUTING.md, « AccesBase.enTenant depuis une transaction ouverte n'est pas atomique »),
    // qui ne verrait pas encore le scrub non commité.
    return this.serviceClient.parId(ctx, clientId);
  }

  private async chargerSousCollections(ctx: ContexteTenant, clientId: string) {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignesClient = await tx
        .select({ id: client.id })
        .from(client)
        .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
        .limit(1);
      if (!lignesClient[0]) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');

      const [lignesAdresse, lignesContact, lignesCondition, lignesConsentement, lignesNote] =
        await Promise.all([
          tx
            .select()
            .from(clientAdresse)
            .where(
              and(eq(clientAdresse.tenantId, ctx.tenantId), eq(clientAdresse.clientId, clientId)),
            ),
          tx
            .select()
            .from(clientContact)
            .where(
              and(eq(clientContact.tenantId, ctx.tenantId), eq(clientContact.clientId, clientId)),
            ),
          tx
            .select()
            .from(clientCondition)
            .where(
              and(
                eq(clientCondition.tenantId, ctx.tenantId),
                eq(clientCondition.clientId, clientId),
              ),
            ),
          tx
            .select()
            .from(clientConsentement)
            .where(
              and(
                eq(clientConsentement.tenantId, ctx.tenantId),
                eq(clientConsentement.clientId, clientId),
              ),
            ),
          // TOUTES natures (interne comprise) — voir la description du contrôleur/DTO : le droit
          // d'accès nLPD porte sur la donnée détenue, pas sur ce qui remonte au comptoir.
          tx
            .select()
            .from(clientNote)
            .where(and(eq(clientNote.tenantId, ctx.tenantId), eq(clientNote.clientId, clientId))),
        ]);

      return {
        adresses: lignesAdresse.map(versAdresseResponse),
        contacts: lignesContact.map(versContactResponse),
        // `.map(versConditionResponse)` directement serait un piège : `Array.prototype.map` passe
        // `(valeur, index, tableau)`, et `versConditionResponse` a un DEUXIÈME paramètre optionnel
        // (`tauxHoraireResolu`) — l'index numérique s'y glisserait silencieusement. Taux horaire
        // non résolu ici (nécessite `atelier/taux-horaire.ts`, hors périmètre) : `null` explicite,
        // jamais un `index` de tableau.
        conditions: lignesCondition.map((c) => versConditionResponse(c, null)),
        consentements: lignesConsentement.map(versConsentementResponse),
        notes: lignesNote.map((n) => versNoteResponse(n, null)),
      };
    });
  }

  /** Boucle sur `ServiceClientVehicules.lister` jusqu'à épuisement du curseur — un export doit
   *  être EXHAUSTIF (brief de tâche, littéral), jamais tronqué à la première page de 200. */
  private async listerTousLesVehicules(
    ctx: ContexteTenant,
    clientId: string,
  ): Promise<readonly VehiculeResume[]> {
    const tous: VehiculeResume[] = [];
    let curseur: string | undefined;
    for (;;) {
      const params = schemaListeVehiculesDuClient.parse({
        limite: 200,
        curseur,
        // `schemaBooleenQuery` (`@dfa/shared`) attend la forme QUERY-STRING (`'true'`/`'false'`),
        // jamais un booléen JS direct — c'est un schéma de désérialisation de `URLSearchParams`,
        // réutilisé ici hors contexte HTTP. `'true'` littéral, pas `true`.
        inclureAnciennesDetentions: 'true',
      });
      const page = await this.serviceClientVehicules.lister(ctx, clientId, params);
      tous.push(...page.donnees);
      if (!page.curseurSuivant) break;
      curseur = page.curseurSuivant;
    }
    return tous;
  }

  private async listerTousLesOr(
    ctx: ContexteTenant,
    clientId: string,
  ): Promise<readonly OrdreReparationResume[]> {
    const tous: OrdreReparationResume[] = [];
    let curseur: string | undefined;
    for (;;) {
      const params = schemaListeOrDuClient.parse({ limite: 200, curseur });
      // `avecMontants: true` — un export nLPD est une divulgation COMPLÈTE au sens de l'art. 25,
      // distincte de la visibilité comptoir des montants (RF-116, `roleVoitLesMontants()`) : ce
      // droit est déjà gardé au palier `client.export.generer` (`auth/matrice-droits.ts`,
      // `INFERE_CLIENT_EXPORT`).
      const page = await this.serviceClientOrdresReparation.lister(ctx, clientId, params, true);
      tous.push(...page.donnees);
      if (!page.curseurSuivant) break;
      curseur = page.curseurSuivant;
    }
    return tous;
  }

  /** Pas de pagination : volume borné par construction (l'historique documentaire d'UN client),
   *  même doctrine que `client_note` (`db/schema/atelier/client.ts`, commentaire de tête). */
  private async listerDocumentsVente(ctx: ContexteTenant, clientId: string) {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneDocumentVenteExportBrute>(sql`
        select
          d.id as "id", d.numero as "numero", d.type_document::text as "typeDocument",
          d.statut::text as "statut", d.date_document::text as "dateDocument",
          d.total_ttc_centimes::text as "totalTtcCentimes", d.devise as "devise"
        from public.document_vente d
        where d.tenant_id = ${ctx.tenantId} and d.client_id = ${clientId}
        order by d.cree_le desc
      `);
      return resultat.rows.map((ligne) => ({
        id: ligne.id,
        numero: ligne.numero,
        typeDocument: ligne.typeDocument,
        statut: ligne.statut,
        dateDocument: ligne.dateDocument,
        totalTtcCentimes: Number(ligne.totalTtcCentimes),
        devise: ligne.devise,
      }));
    });
  }

  private async listerRendezVous(ctx: ContexteTenant, clientId: string) {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneRendezVousExportBrute>(sql`
        select
          r.id as "id", r.date::text as "date", r.moment::text as "moment",
          r.statut::text as "statut", r.commentaire as "commentaire",
          r.motif_annulation as "motifAnnulation"
        from public.rendez_vous r
        where r.tenant_id = ${ctx.tenantId} and r.client_id = ${clientId}
        order by r.date desc, r.cree_le desc
      `);
      return resultat.rows;
    });
  }

  /**
   * `relance_planifiee` (référence le client) jointe à `relance_envoi` (DONNÉE PERSONNELLE FIGÉE,
   * RA-12 — `destinataire_fige`/`contenu_fige`, jamais recalculés). Lecture seule : ce module n'a
   * AUCUN moyen d'ANONYMISER ces deux colonnes (hors de son périmètre d'écriture, table du module
   * `relances`) — signalé en tête de la migration 0061 et dans le rapport de tâche comme le résidu
   * le plus sérieux du recensement. L'exposer ici au moins dans l'EXPORT (droit d'accès) reste
   * correct : c'est une donnée réellement détenue, le client a le droit de la voir.
   */
  private async listerRelances(ctx: ContexteTenant, clientId: string) {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneRelanceExportBrute>(sql`
        select
          e.id as "id", p.type_relance::text as "typeRelance", p.palier as "palier",
          e.canal::text as "canal", e.destinataire_fige as "destinataireFige",
          e.contenu_fige as "contenuFige", e.statut_envoi::text as "statutEnvoi",
          e.envoye_le as "envoyeLe"
        from public.relance_envoi e
        join public.relance_planifiee p
          on p.tenant_id = e.tenant_id and p.id = e.relance_planifiee_id
        where e.tenant_id = ${ctx.tenantId} and p.client_id = ${clientId}
        order by e.envoye_le desc
      `);
      return resultat.rows.map((ligne) => ({
        id: ligne.id,
        typeRelance: ligne.typeRelance,
        palier: ligne.palier,
        canal: ligne.canal,
        destinataireFige: ligne.destinataireFige,
        contenuFige: ligne.contenuFige,
        statutEnvoi: ligne.statutEnvoi,
        envoyeLe: enDate(ligne.envoyeLe).toISOString(),
      }));
    });
  }
}
