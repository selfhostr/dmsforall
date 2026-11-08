import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type {
  ClientResume,
  ElementBloquant,
  EntreeArreterContactClient,
  EntreeCreationClient,
  EntreeDesactivationClient,
  EntreeReprendreContactClient,
  PageCurseur,
  ParametresDoublonsClients,
  ReponseAvecAvertissements,
  ReponseClient,
  ReponseClientNote,
  ReponseDoublonsClients,
  RoleUtilisateur,
} from '@dfa/shared';
import { schemaModificationClient } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { enDate, JETON_DB } from '../db';
import {
  client,
  clientAdresse,
  clientCondition,
  clientNote,
  ordreReparation,
  vehiculeDetention,
} from '../db/schema';
import type { LigneClient, NouveauClient } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { Horloge } from '../common/horloge';
import { JETON_IDEMPOTENCE } from '../common/idempotence';
import type {
  ReponseMemorisable,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import { PipeZod } from '../common/validation';
import { JETON_COMPTEURS } from '../parametrage/compteurs/compteurs.jetons';
import type { ServiceCompteurs } from '../parametrage/compteurs/compteurs.types';

import { detecterDoublons } from './detection-doublons';
import { exigerCapacite } from '../auth/droits-personne';
import { versClientResponse, versClientResume } from './mappers';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from '../common/pagination';
import type { ParametresListeClients } from './schemas';
import { normaliserTelephoneCh } from './telephone';

/**
 * Clé de compteur du numéro de client (RM-11) : `annee` fixe et jamais recalculée sur
 * l'année courante — contrairement au numéro d'OR (réinitialisable par
 * `parametre_atelier.or_reset_annuel`), un numéro de client est CONTINU par tenant, sans reset,
 * pour toute la vie du tenant. Fixer `annee` garantit que la clé `(tenant, 'client', annee, null)`
 * de `compteur_document` reste identique indéfiniment, donc que le compteur ne recommence
 * jamais à 1 au changement d'année.
 */
const ANNEE_COMPTEUR_CLIENT = 2000;

function formaterNumeroClient(n: number): string {
  return `CL-${String(n).padStart(6, '0')}`;
}

function choisirTelephonePrincipal(
  telephones: readonly { readonly valeur: string; readonly principal: boolean }[],
): string | null {
  if (telephones.length === 0) return null;
  return telephones.find((t) => t.principal)?.valeur ?? telephones[0]!.valeur;
}

/** Statuts terminaux d'un OR au sens de RM-12 : un OR dans un autre statut est « ouvert ». */
const STATUTS_OR_TERMINAUX = ['cloture', 'annule'] as const;

const DEFINITIONS_TRI_CLIENTS: Readonly<Record<ParametresListeClients['tri'], DefinitionTri>> = {
  'nom:asc': {
    expression: sql`coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''))`,
    sens: 'asc',
    nullable: false,
  },
  'nom:desc': {
    expression: sql`coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''))`,
    sens: 'desc',
    nullable: false,
  },
  'numeroClient:asc': { expression: sql`c.numero`, sens: 'asc', nullable: false },
  'numeroClient:desc': { expression: sql`c.numero`, sens: 'desc', nullable: false },
  'creeLe:desc': { expression: sql`c.cree_le`, sens: 'desc', nullable: false, temporel: true },
  /**
   * Pas de colonne `dernier_passage_le` sur `client` (GAP DE CONTRAT signalé en réponse de
   * tâche) : dérivé d'une sous-requête sur `ordre_reparation.ouvert_le`, non indexée pour ce
   * tri précis — acceptable au volume du lot 1 (§6.3 du plan : « à ~50 OR/jour c'est invisible »).
   */
  'dernierPassageLe:desc': {
    expression: sql`(select max(o.ouvert_le) from public.ordre_reparation o where o.tenant_id = c.tenant_id and o.client_id = c.id)`,
    sens: 'desc',
    nullable: true,
    temporel: true,
  },
};

/** Colonnes de `client`, aliasées en camelCase — nécessaire car `tx.execute()` (SQL brut) rend les noms de colonnes réels, pas le mapping Drizzle. */
const COLONNES_CLIENT_ALIASEES = sql`
  c.id as "id", c.tenant_id as "tenantId", c.numero as "numero", c.type as "type",
  c.civilite as "civilite", c.nom as "nom", c.prenom as "prenom", c.raison_sociale as "raisonSociale",
  c.ide as "ide", c.langue as "langue", c.email as "email", c.telephone as "telephone",
  c.telephone_e164 as "telephoneE164", c.canal_prefere as "canalPrefere", c.statut as "statut",
  c.po_obligatoire as "poObligatoire", c.groupe_client_id as "groupeClientId",
  c.fusionne_vers_client_id as "fusionneVersClientId", c.reference_externe as "referenceExterne",
  c.cree_le as "creeLe", c.modifie_le as "modifieLe"
`;

export interface EntreeCreationClientResultat {
  readonly statutHttp: number;
  readonly corps: ReponseAvecAvertissements<ReponseClient>;
}

/**
 * Service cœur du domaine clients : CRUD de la fiche, détection de doublons (RM-05), immuabilité
 * du type (RM-01), désactivation gardée (RM-12). Les sous-collections (adresses, contacts,
 * conditions, consentements, notes) et les projections (véhicules/OR du client) sont des
 * services distincts — voir `service-client-*.ts`.
 */
@Injectable()
export class ServiceClient {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_COMPTEURS) private readonly compteurs: ServiceCompteurs,
    private readonly horloge: Horloge,
  ) {}

  async lister(
    ctx: ContexteTenant,
    params: ParametresListeClients,
  ): Promise<PageCurseur<ClientResume>> {
    const definition = DEFINITIONS_TRI_CLIENTS[params.tri];
    const idExpr = sql`c.id`;
    const curseurDecode = decoderCurseurPourTri(
      params.curseur,
      params.tri,
      DEFINITIONS_TRI_CLIENTS,
    );
    // RM-... / §6.2 : défaut `actif`+`bloque` — un client bloqué reste visible au comptoir.
    const statuts =
      params.statut && params.statut.length > 0 ? params.statut : (['actif', 'bloque'] as const);

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [
        sql`c.tenant_id = ${ctx.tenantId}`,
        // DÉFAUT CONSTATÉ (corrigé) : `c.statut::text in (...)` castait la colonne ENUM en `text`
        // AVANT comparaison — un `CAST` sur la colonne rend l'expression opaque aux statistiques
        // de `client.statut` (MCV liées au type énuméré natif, pas à sa projection texte), et
        // PostgreSQL retombe sur une sélectivité par défaut (~1 %/valeur du tableau) au lieu de la
        // vraie distribution. Mesuré sur `dfa_dev` (9916 clients, tous `actif`) : `rows=99` estimées
        // contre 9916 réelles avec le cast, `rows=9916` (exact) sans lui — cette estimation fausse
        // faisait basculer le planificateur sur un `Seq Scan` + tri complet dès qu'une limite plus
        // large (`limite=200`) rendait le coût apparent du chemin indexé artificiellement élevé
        // (banc de charge du 27.08.2026, `clients-limite200-page1`). Comparaison NATIVE sur l'enum
        // (`= any(...)::public.statut_client[]`), même patron que `filtres.statut` côté véhicules
        // (`service-vehicule.ts`, `v.statut = any(${sql.param(filtres.statut)}::public.statut_vehicule[])`)
        // — jamais l'interpolation directe d'un tableau JS dans `sql\`\``, qui produirait un
        // constructeur d'enregistrement plutôt qu'un tableau SQL.
        sql`c.statut = any(${sql.param(statuts)}::public.statut_client[])`,
      ];

      if (params.type) conditions.push(sql`c.type = ${params.type}`);
      if (params.groupeId) conditions.push(sql`c.groupe_client_id = ${params.groupeId}`);
      if (params.poObligatoire !== undefined)
        conditions.push(sql`c.po_obligatoire = ${params.poObligatoire}`);
      // `siteId` (P-30) : `client` ne porte aucune colonne de site — filtre ignoré au lot 1 (voir
      // le commentaire de `schemaFiltresClients.siteId`, `@dfa/shared` : « ignoré sinon »).
      if (params.q) {
        const motif = `%${params.q}%`;
        // Fragment numérique du terme (chiffres + '+') : n'active la clause téléphone que s'il en
        // existe un — sinon `chiffres` serait vide et `like '%%'` matcherait tout client ayant un
        // numéro de téléphone, quel que soit le terme recherché (bruit total sur une recherche par
        // nom pure, ex. `q=Rochat`).
        const chiffres = params.q.replace(/[^0-9+]/g, '');
        const clausesRecherche = [
          // DÉFAUT CONSTATÉ (corrigé) : l'opérateur `%` (similarité trigram PLEINE CHAÎNE, seuil
          // par défaut 0.3) exige que le terme tapé ressemble au nom ENTIER — un fragment court
          // comme « Rhône » dans « Transports Rhône Sàrl » tombe sous le seuil et ne matchait
          // jamais, alors que le moteur de recherche globale (`recherche/service-recherche.ts`,
          // fonction `chercherClients`) trouve ce même client. Corrigé en alignant sur le MÊME
          // mécanisme que ce moteur : `like` sur l'expression normalisée (accents/casse/séparateurs
          // gommés par `normaliser_recherche()`), servi par le même index GIN trigram déjà posé
          // (`client_recherche_idx`, migration 0006 — `gin_trgm_ops` supporte `~~`/`like`, pas
          // seulement `%`, donc aucun index supplémentaire n'est nécessaire).
          sql`(public.normaliser_recherche(coalesce(c.raison_sociale, c.nom || ' ' || coalesce(c.prenom, ''), '')) like public.normaliser_recherche(${motif}) or public.normaliser_recherche(coalesce(c.raison_sociale, coalesce(c.prenom || ' ', '') || c.nom, '')) like public.normaliser_recherche(${motif}))`,
          sql`c.numero ilike ${motif}`,
          sql`c.email ilike ${motif}`,
          sql`c.ide ilike ${motif}`,
        ];
        if (chiffres.length > 0) {
          // Fragment brut (comportement déjà en place) : substring direct sur `telephone_e164`.
          clausesRecherche.push(sql`c.telephone_e164 like ${`%${chiffres}%`}`);

          // DÉFAUT CONSTATÉ (corrigé) : recopier le numéro AFFICHÉ (« 079 123 45 67 ») ou tapé au
          // format national sans espaces (« 0791234567 ») ne retrouvait rien — `telephone_e164`
          // est stocké en E.164 (« +41791234567 »), et aucune équivalence 0/0041/+41 n'était
          // appliquée au terme de recherche alors qu'elle l'est déjà à l'ÉCRITURE
          // (`normaliserTelephoneCh`, RM-05). Deux volets, la même règle :
          //
          // (a) le terme ENTIER ressemble à un numéro complet dans un format suisse usuel
          //     (espaces/points/tirets/barres obliques, 0 national, 0041 international) :
          //     comparaison EXACTE sur `telephone_e164`, servie par l'index btree déjà posé
          //     (`client_telephone_idx`, tenant_id, telephone_e164) — plus rapide que le `like`
          //     fragment ci-dessus, et c'est le chemin qui répond au cas d'usage réel (« recopier
          //     le numéro affiché »).
          const telephoneComplet = normaliserTelephoneCh(params.q);
          if (telephoneComplet) {
            clausesRecherche.push(sql`c.telephone_e164 = ${telephoneComplet}`);
          }

          // (b) le terme est un FRAGMENT (recherche en cours de frappe, pas encore un numéro
          //     complet reconnu par (a)) : même équivalence national/international appliquée à la
          //     sous-chaîne de chiffres elle-même (0791… → 41791…, 0041791… → 41791…), pour que
          //     « 079… » retrouve aussi « +41… » par sous-chaîne.
          const chiffresSeuls = chiffres.replace(/\+/g, '');
          let varianteNationale: string | null = null;
          if (chiffresSeuls.startsWith('0041')) varianteNationale = `41${chiffresSeuls.slice(4)}`;
          else if (chiffresSeuls.startsWith('00')) varianteNationale = chiffresSeuls.slice(2);
          else if (chiffresSeuls.startsWith('0')) varianteNationale = `41${chiffresSeuls.slice(1)}`;
          if (varianteNationale && varianteNationale.length > 0) {
            clausesRecherche.push(sql`c.telephone_e164 like ${`%${varianteNationale}%`}`);
          }
        }
        conditions.push(sql`(${sql.join(clausesRecherche, sql` or `)})`);
      }
      if (curseurDecode) {
        conditions.push(
          construireConditionKeyset(definition, idExpr, curseurDecode.valeur, curseurDecode.id),
        );
      }

      // Désambiguïsation comptoir (§ arbitrage L1-16bis) : `localite`, `nombreVehicules` et
      // `dernierPassageLe` sont produits dans CETTE MÊME requête via `LEFT JOIN LATERAL` — jamais
      // une requête par ligne, qui tiendrait très bien sur le garage de démo et s'effondrerait
      // chez un client réel à plusieurs milliers de fiches. Trois LATERAL, TOUJOURS en LEFT JOIN
      // (jamais INNER) : un client sans adresse ou sans véhicule doit rester dans la page, pas en
      // disparaître silencieusement — les deux dernières sont des agrégats bruts (`count`, `max`)
      // qui rendent systématiquement une ligne (0 / null), même sur zéro correspondance ; seule la
      // sous-requête `a` (adresse) peut légitimement ne rien renvoyer, d'où le LEFT JOIN LATERAL.
      const requete = sql`
        select ${COLONNES_CLIENT_ALIASEES}, ${expressionTriValeur(definition)} as "triValeur",
               a.localite as "localite",
               coalesce(v.nombre, 0) as "nombreVehicules",
               dp.dernier as "dernierPassageLe"
          from public.client c
          left join lateral (
            select ca.localite
              from public.client_adresse ca
             where ca.tenant_id = c.tenant_id and ca.client_id = c.id and ca.type = 'principale' and ca.actif = true
             order by ca.cree_le desc
             limit 1
          ) a on true
          left join lateral (
            select count(*)::int as nombre
              from public.vehicule_detention vd
             where vd.tenant_id = c.tenant_id and vd.client_id = c.id and vd.au is null
          ) v on true
          left join lateral (
            select max(o.ouvert_le) as dernier
              from public.ordre_reparation o
             where o.tenant_id = c.tenant_id and o.client_id = c.id
          ) dp on true
         where ${sql.join(conditions, sql` and `)}
         order by ${construireOrderBy(definition, idExpr)}
         limit ${params.limite + 1}
      `;

      const resultat = await tx.execute<
        LigneClient & {
          // `string | number | null`, jamais `Date` : pour `creeLe:desc`/`dernierPassageLe:desc`
          // (colonnes `temporel: true`), `expressionTriValeur()` cast explicitement en `::text` dans
          // le `SELECT` ci-dessus — précisément pour empêcher le pilote de la rendre en `Date` et
          // d'en tronquer la microseconde avant que la valeur de curseur ne soit construite (voir
          // `common/pagination/keyset.ts`, `valeurCurseurDepuisTri()` plus bas).
          triValeur: string | number | null;
          localite: string | null;
          nombreVehicules: number;
          // `Date | string` : SQL brut (`tx.execute`), même piège que `dernierPassage()` ci-dessous —
          // voir `enDate()`. Purement un champ d'AFFICHAGE (`ClientResume.dernierPassageLe`), jamais
          // une valeur de curseur — sans rapport avec `triValeur` ci-dessus même quand le tri actif
          // est `dernierPassageLe:desc` (deux expressions SQL distinctes, l'une pour l'affichage via
          // LATERAL, l'autre pour le tri).
          dernierPassageLe: Date | string | null;
        }
      >(requete);
      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((ligne) =>
          versClientResume(ligne, {
            localite: ligne.localite,
            nombreVehicules: ligne.nombreVehicules,
            dernierPassageLe: ligne.dernierPassageLe,
          }),
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

  async creer(
    ctx: ContexteTenant,
    entree: EntreeCreationClient,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<EntreeCreationClientResultat & ReponseMemorisable>> {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/clients', cle: cleIdempotence, corps: entree },
      async (tx) => ({ statutHttp: 201, corps: await this.creerTx(tx, ctx, entree) }),
    );
  }

  /**
   * Cœur transactionnel de `creer()` (détection de doublon non bloquante, numéro, fiche, adresse,
   * conditions), SANS enveloppe d'idempotence — réutilisé par `POST /ordres-reparation/creation-rapide`.
   */
  async creerTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: EntreeCreationClient,
  ): Promise<ReponseAvecAvertissements<ReponseClient>> {
    const collecteur = new CollecteurAvertissements();

    const telephonePrincipal = choisirTelephonePrincipal(entree.telephones);
    const telephoneE164 = normaliserTelephoneCh(telephonePrincipal);

    const nomComplet =
      entree.type === 'entreprise'
        ? (entree.raisonSociale ?? '')
        : [entree.nom, entree.prenom].filter((v): v is string => Boolean(v)).join(' ');

    // RM-05 : détection AVANT création, jamais bloquante (CT-01) — voir `detection-doublons.ts`.
    const candidats = await detecterDoublons(tx, ctx.tenantId, {
      nomComplet: nomComplet || undefined,
      npa: entree.adressePrincipale?.npa,
      email: entree.email ?? undefined,
      telephoneE164: telephoneE164 ?? undefined,
      ide: entree.type === 'entreprise' ? (entree.ide ?? undefined) : undefined,
    });
    if (candidats.length > 0) {
      collecteur.ajouter(
        'CLIENT_DOUBLON_PROBABLE',
        `${candidats.length} fiche(s) client existante(s) ressemble(nt) à celle-ci.`,
        { candidats },
      );
    }

    const numeroBrut = await this.compteurs.prochainNumero(tx, {
      tenantId: ctx.tenantId,
      typeDocument: 'client',
      annee: ANNEE_COMPTEUR_CLIENT,
      siteId: null,
    });
    const numero = formaterNumeroClient(numeroBrut);

    const [ligne] = await tx
      .insert(client)
      .values({
        tenantId: ctx.tenantId,
        numero,
        type: entree.type,
        civilite: entree.civilite ?? null,
        nom: entree.nom ?? null,
        prenom: entree.prenom ?? null,
        raisonSociale: entree.raisonSociale ?? null,
        ide: entree.ide ?? null,
        langue: entree.langueCorrespondance,
        email: entree.email ?? null,
        telephone: telephonePrincipal,
        telephoneE164,
        poObligatoire: entree.poObligatoire,
        groupeClientId: entree.groupeId ?? null,
        referenceExterne: entree.referenceExterne ?? null,
      })
      .returning();
    if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du client.');

    // Particulier au comptoir sans rendez-vous (RF-59) : pas d'adresse, pas de ligne
    // `client_adresse` — une absence n'est pas une adresse à champs vides.
    if (entree.adressePrincipale) {
      await tx.insert(clientAdresse).values({
        tenantId: ctx.tenantId,
        clientId: ligne.id,
        type: 'principale',
        rue: entree.adressePrincipale.rue,
        complement: entree.adressePrincipale.complement ?? null,
        npa: entree.adressePrincipale.npa,
        localite: entree.adressePrincipale.localite,
        pays: entree.adressePrincipale.pays,
      });
    }

    if (entree.conditions) {
      await tx.insert(clientCondition).values({
        tenantId: ctx.tenantId,
        clientId: ligne.id,
        rabaisMoPourmille: entree.conditions.rabaisMoPourmille,
        rabaisPiecesPourmille: entree.conditions.rabaisPiecesPourmille,
        rabaisPneusPourmille: entree.conditions.rabaisPneusPourmille,
        tauxHoraireCode: entree.conditions.tauxHoraireCode ?? null,
        delaiPaiementJours: entree.conditions.delaiPaiementJours ?? null,
        modePaiement: entree.conditions.modePaiement ?? null,
        plafondCentimes: entree.conditions.plafondCentimes ?? null,
        valideDu: this.dateDuJour(),
        valideAu: null,
      });
    }

    // Fiche fraîchement créée : aucune note d'alerte ne peut encore exister pour elle.
    return collecteur.envelopper(versClientResponse(ligne, null, []));
  }

  async parId(ctx: ContexteTenant, clientId: string): Promise<ReponseClient> {
    return this.acces.enTenant(ctx, (tx) => this.parIdTx(tx, ctx, clientId));
  }

  /** Comme `parId`, dans une transaction déjà ouverte (création rapide d'OR). */
  async parIdTx(tx: TransactionDfa, ctx: ContexteTenant, clientId: string): Promise<ReponseClient> {
    const ligne = await this.chargerOu404(tx, ctx, clientId);
    const dernierPassageLe = await this.dernierPassage(tx, ctx, clientId);
    const notesAlerte = await this.chargerNotesAlerte(tx, ctx, clientId);
    return versClientResponse(ligne, dernierPassageLe, notesAlerte);
  }

  /**
   * `type` n'est PAS dans `schemaModificationClient` (RM-01) : sa présence dans le corps BRUT
   * (avant tout `parse`) doit être détectée ici, sinon zod la retire silencieusement et le refus
   * `409 CLIENT_TYPE_IMMUABLE` attendu par le contrat ne se produit jamais.
   */
  async modifier(
    ctx: ContexteTenant,
    clientId: string,
    corpsBrut: Record<string, unknown>,
  ): Promise<ReponseAvecAvertissements<ReponseClient>> {
    if ('type' in corpsBrut) {
      throw new ErreurMetier(
        'CLIENT_TYPE_IMMUABLE',
        "Le type d'un client est figé après sa création (RM-01).",
      );
    }
    const entree = new PipeZod(schemaModificationClient).transform(corpsBrut);

    return this.acces.enTenant(ctx, async (tx) => {
      const ligneActuelle = await this.chargerOu404(tx, ctx, clientId);

      const valeurs: Partial<NouveauClient> = {};
      if ('civilite' in entree) valeurs.civilite = entree.civilite ?? null;
      if ('nom' in entree) valeurs.nom = entree.nom ?? null;
      if ('prenom' in entree) valeurs.prenom = entree.prenom ?? null;
      if ('raisonSociale' in entree) valeurs.raisonSociale = entree.raisonSociale ?? null;
      if ('ide' in entree) valeurs.ide = entree.ide ?? null;
      if ('langueCorrespondance' in entree && entree.langueCorrespondance)
        valeurs.langue = entree.langueCorrespondance;
      if ('email' in entree) valeurs.email = entree.email ?? null;
      if ('telephone' in entree) {
        valeurs.telephone = entree.telephone ?? null;
        valeurs.telephoneE164 = normaliserTelephoneCh(entree.telephone ?? null);
      }
      if ('poObligatoire' in entree && entree.poObligatoire !== undefined)
        valeurs.poObligatoire = entree.poObligatoire;
      if ('groupeId' in entree) valeurs.groupeClientId = entree.groupeId ?? null;
      if ('referenceExterne' in entree) valeurs.referenceExterne = entree.referenceExterne ?? null;

      // Miroir du CHECK `client_identite_chk` (migration 0006), évalué AVANT l'update — le CHECK
      // garantit l'intégrité en base (ce n'est donc jamais corrompu), mais sans cette validation
      // ici l'échec ne serait rattrapé qu'à l'écriture, en erreur pg brute non typée plutôt qu'en
      // `400 VALIDATION_ECHOUEE` propre. `type` est IMMUABLE (RM-01, refusé plus haut) : c'est
      // TOUJOURS `ligneActuelle.type` qui fait autorité, jamais une valeur du corps. `nom`/
      // `raisonSociale` effectifs : la valeur envoyée si le champ est présent dans le corps,
      // sinon celle déjà en base — un `PATCH { nom: null }` sur un `particulier` doit être
      // rattrapé même si `raisonSociale` n'est jamais mentionné.
      const nomEffectif = 'nom' in entree ? (entree.nom ?? null) : ligneActuelle.nom;
      const raisonSocialeEffectif =
        'raisonSociale' in entree ? (entree.raisonSociale ?? null) : ligneActuelle.raisonSociale;
      if (ligneActuelle.type === 'particulier' && !nomEffectif) {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Validation échouée.', {
          erreurs: [
            {
              champ: 'nom',
              code: 'custom',
              message: 'Un particulier exige `nom`.',
            },
          ],
        });
      }
      if (ligneActuelle.type === 'entreprise' && !raisonSocialeEffectif) {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Validation échouée.', {
          erreurs: [
            {
              champ: 'raisonSociale',
              code: 'custom',
              message: 'Une entreprise exige `raisonSociale`.',
            },
          ],
        });
      }

      if (Object.keys(valeurs).length > 0) {
        await tx
          .update(client)
          .set(valeurs)
          .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)));
      }

      const ligneMaj = await this.chargerOu404(tx, ctx, clientId);
      const dernierPassageLe = await this.dernierPassage(tx, ctx, clientId);
      const notesAlerte = await this.chargerNotesAlerte(tx, ctx, clientId);
      return new CollecteurAvertissements().envelopper(
        versClientResponse(ligneMaj, dernierPassageLe, notesAlerte),
      );
    });
  }

  /**
   * RM-12 : refuse si des OR ou des détentions restent ouverts. RDV omis délibérément — la table
   * `rendez_vous` n'existe pas au lot 1 (voir `plan-lot1-execution.md` §L1-05 Δ4).
   *
   * GAP DE CONTRAT signalé en réponse de tâche : `TypeElementBloquant` (`@dfa/shared`) ne porte
   * aucune valeur pour une détention de véhicule — seules les OR ouverts sont nommés dans
   * `blocages[]`, une détention ouverte est signalée via `detail` (texte libre) faute de type.
   */
  async desactiver(
    ctx: ContexteTenant,
    clientId: string,
    entree: EntreeDesactivationClient,
  ): Promise<ReponseAvecAvertissements<ReponseClient>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, clientId);

      const orsOuverts = await tx
        .select({ id: ordreReparation.id, numero: ordreReparation.numero })
        .from(ordreReparation)
        .where(
          and(
            eq(ordreReparation.tenantId, ctx.tenantId),
            eq(ordreReparation.clientId, clientId),
            // `notInArray` exige un tableau mutable pour ce overload ; `STATUTS_OR_TERMINAUX` est
            // un tuple `as const` (readonly) — on le déroule au point d'appel plutôt que de perdre
            // sa littéralité à la déclaration (TS2769).
            notInArray(ordreReparation.statut, [...STATUTS_OR_TERMINAUX]),
          ),
        )
        .limit(50);

      const detentionsOuvertes = await tx
        .select({ id: vehiculeDetention.id })
        .from(vehiculeDetention)
        .where(
          and(
            eq(vehiculeDetention.tenantId, ctx.tenantId),
            eq(vehiculeDetention.clientId, clientId),
            isNull(vehiculeDetention.au),
          ),
        )
        .limit(1);

      if (orsOuverts.length > 0 || detentionsOuvertes.length > 0) {
        const blocages: ElementBloquant[] = orsOuverts.map((or) => ({
          type: 'ordre_reparation',
          id: or.id,
          libelle: `Ordre de réparation ${or.numero}`,
        }));
        throw new ErreurMetier(
          'CLIENT_DESACTIVATION_IMPOSSIBLE',
          'Désactivation impossible : le client a encore des ordres de réparation ou des détentions de véhicule ouverts (RM-12).',
          {
            blocages,
            detail:
              detentionsOuvertes.length > 0
                ? 'Au moins une détention de véhicule est encore ouverte pour ce client.'
                : undefined,
            actionsProposees: [{ code: 'RAFRAICHIR' }],
          },
        );
      }

      await tx
        .update(client)
        .set({ statut: 'inactif' })
        .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)));

      // `client` ne porte aucune colonne « motif de désactivation » (GAP DE CONTRAT signalé en
      // réponse de tâche) : le motif est conservé sous forme de note interne plutôt que perdu.
      await tx.insert(clientNote).values({
        tenantId: ctx.tenantId,
        clientId,
        nature: 'interne',
        texte: `Désactivation : ${entree.motif}`,
        auteurId: ctx.utilisateurId,
      });

      const ligneMaj = await this.chargerOu404(tx, ctx, clientId);
      const dernierPassageLe = await this.dernierPassage(tx, ctx, clientId);
      const notesAlerte = await this.chargerNotesAlerte(tx, ctx, clientId);
      return new CollecteurAvertissements().envelopper(
        versClientResponse(ligneMaj, dernierPassageLe, notesAlerte),
      );
    });
  }

  /**
   * RA-14 (`docs/specification-relances-automatiques.md` §5) : pose l'arrêt de tout contact.
   * GESTE DÉDIÉ, pas un champ du `PATCH` générique — même arbitrage que `desactiver()` ci-dessus
   * (`statut`) : un booléen à conséquence légale et commerciale (le job de relances, `relances/
   * service-relances-facture.ts`, le lit AVANT tout envoi et le fait primer sur tout consentement
   * marketing) mérite une route nommée, traçable dans les journaux applicatifs, plutôt qu'une clé
   * parmi d'autres d'un corps `PATCH` libre où elle serait facile à poser par erreur.
   *
   * Idempotent en pratique : reposer le drapeau alors qu'il l'est déjà REMPLACE `motif` (pas
   * d'erreur 409 — voir `schemaArreterContactClient`). `client.motif` est écrit directement (colonne
   * dédiée, CHECK `client_plus_aucun_contact_motif_chk` en base) : QUI a posé le drapeau et QUAND
   * sont capturés par le trigger d'audit générique déjà posé sur `client` (migration 0006,
   * `client_audit` → `audit_atelier`), sans code supplémentaire ici.
   *
   * `role` : droit PROVISOIRE (voir `droits-provisoires.ts`, tête de fichier) — vérifié ICI, avant
   * tout accès base, faute d'accès de cette tâche à `auth/matrice-droits.ts`.
   */
  async arreterContact(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    clientId: string,
    entree: EntreeArreterContactClient,
  ): Promise<ReponseAvecAvertissements<ReponseClient>> {
    exigerCapacite(role, 'accueil.faire', 'client.contact.arreter');
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, clientId);

      await tx
        .update(client)
        .set({ plusAucunContact: true, motif: entree.motif })
        .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)));

      const ligneMaj = await this.chargerOu404(tx, ctx, clientId);
      const dernierPassageLe = await this.dernierPassage(tx, ctx, clientId);
      const notesAlerte = await this.chargerNotesAlerte(tx, ctx, clientId);
      return new CollecteurAvertissements().envelopper(
        versClientResponse(ligneMaj, dernierPassageLe, notesAlerte),
      );
    });
  }

  /**
   * RA-14 : lève l'arrêt de tout contact — pendant symétrique de `arreterContact()` ci-dessus,
   * jamais un simple `PATCH` pour la même raison. `client.motif` documente la raison COURANTE du
   * drapeau (requise par le CHECK base tant qu'il est posé) : une fois `plusAucunContact` remis à
   * `false`, ce champ est vidé — il ne peut donc pas porter la raison de LA LEVÉE elle-même.
   * `entree.motif` (obligatoire, `schemaReprendreContactClient`) est conservé comme `client_note`
   * de nature `interne`, MÊME PATRON que `desactiver()` ci-dessus pour le motif de désactivation :
   * une note interne plutôt qu'un motif perdu. Idempotent, comme `arreterContact` : lever un
   * drapeau déjà baissé n'est pas une erreur, juste un état déjà atteint.
   *
   * `role` : droit PROVISOIRE (voir `droits-provisoires.ts`, tête de fichier) — vérifié ICI, avant
   * tout accès base, faute d'accès de cette tâche à `auth/matrice-droits.ts`.
   */
  async reprendreContact(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    clientId: string,
    entree: EntreeReprendreContactClient,
  ): Promise<ReponseAvecAvertissements<ReponseClient>> {
    exigerCapacite(role, 'accueil.faire', 'client.contact.reprendre');
    return this.acces.enTenant(ctx, async (tx) => {
      await this.chargerOu404(tx, ctx, clientId);

      await tx
        .update(client)
        .set({ plusAucunContact: false, motif: null })
        .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)));

      await tx.insert(clientNote).values({
        tenantId: ctx.tenantId,
        clientId,
        nature: 'interne',
        texte: `Reprise de contact autorisée (RA-14) : ${entree.motif}`,
        auteurId: ctx.utilisateurId,
      });

      const ligneMaj = await this.chargerOu404(tx, ctx, clientId);
      const dernierPassageLe = await this.dernierPassage(tx, ctx, clientId);
      const notesAlerte = await this.chargerNotesAlerte(tx, ctx, clientId);
      return new CollecteurAvertissements().envelopper(
        versClientResponse(ligneMaj, dernierPassageLe, notesAlerte),
      );
    });
  }

  async doublons(
    ctx: ContexteTenant,
    params: ParametresDoublonsClients,
  ): Promise<ReponseDoublonsClients> {
    return this.acces.enTenant(ctx, async (tx) => {
      const telephoneE164 = params.telephoneMobile
        ? (normaliserTelephoneCh(params.telephoneMobile) ?? undefined)
        : undefined;
      const candidats = await detecterDoublons(tx, ctx.tenantId, {
        nomComplet: params.nom,
        npa: params.npa,
        email: params.email,
        telephoneE164,
        ide: params.ide,
        exclureClientId: params.exclureClientId,
      });
      return { candidats };
    });
  }

  private async chargerOu404(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    clientId: string,
  ): Promise<LigneClient> {
    const lignes = await tx
      .select()
      .from(client)
      .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
      .limit(1);
    const ligne = lignes[0];
    // 404, jamais 403 : un client d'un autre tenant ne doit même pas laisser deviner qu'il existe.
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');
    return ligne;
  }

  /**
   * `Date | string` en retour : SQL brut (`tx.execute`) — mesuré, le pilote `pg` y rend en fait
   * `timestamptz` en `Date` (pas en chaîne) par défaut ; `enDate()` reste défensif au cas où un
   * chemin d'exécution différent (fonction SECURITY DEFINER, cast explicite ailleurs) rendrait un
   * jour une chaîne à la place. Purement un champ d'AFFICHAGE : la conversion (`enDate()`) est
   * appliquée par l'appelant, au moment de construire la réponse (`mappers.ts`), pas ici — voir la
   * doc de `enDate()`. Sans rapport avec la valeur de CURSEUR de `lister()` ci-dessus (voir
   * `common/pagination/keyset.ts`) : cette méthode n'est jamais appelée en contexte de pagination.
   */
  private async dernierPassage(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    clientId: string,
  ): Promise<Date | string | null> {
    const resultat = await tx.execute<{ dernier: Date | string | null }>(sql`
      select max(o.ouvert_le) as dernier
        from public.ordre_reparation o
       where o.tenant_id = ${ctx.tenantId} and o.client_id = ${clientId}
    `);
    return resultat.rows[0]?.dernier ?? null;
  }

  private dateDuJour(): string {
    return this.horloge.maintenant().toISOString().slice(0, 10);
  }

  /**
   * RM-13 : notes de nature `alerte` UNIQUEMENT (`ReponseClient.notesAlerte`) — les notes
   * `interne` (ex. le motif de désactivation ci-dessus) ne sortent JAMAIS par ce chemin, elles
   * ne sont exposées que par `GET /clients/{clientId}/notes` (`ServiceClientSousCollections`).
   * Non paginé : le volume d'alertes actives sur une fiche est borné par construction métier
   * (on ne laisse pas s'accumuler des dizaines d'alertes non traitées).
   *
   * SQL brut (`tx.execute`), comme `dernierPassage` ci-dessus — même raison : une projection en
   * lecture composée (jointure auteur) n'a pas besoin de passer par le query builder Drizzle ici.
   */
  private async chargerNotesAlerte(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    clientId: string,
  ): Promise<ReponseClientNote[]> {
    const resultat = await tx.execute<{
      id: string;
      texte: string;
      // `Date | string` : SQL brut (`tx.execute`) — voir `enDate()`.
      creeLe: Date | string;
      auteurId: string | null;
      auteurPrenom: string | null;
      auteurNom: string | null;
    }>(sql`
      select n.id as "id", n.texte as "texte", n.cree_le as "creeLe",
             n.auteur_id as "auteurId", u.prenom as "auteurPrenom", u.nom as "auteurNom"
        from public.client_note n
        left join public.utilisateur u on u.tenant_id = n.tenant_id and u.id = n.auteur_id
       where n.tenant_id = ${ctx.tenantId} and n.client_id = ${clientId} and n.nature = 'alerte'
       order by n.cree_le desc
    `);

    return resultat.rows.map((ligne) => ({
      id: ligne.id,
      nature: 'alerte' as const,
      texte: ligne.texte,
      auteur:
        ligne.auteurId && ligne.auteurPrenom && ligne.auteurNom
          ? {
              utilisateurId: ligne.auteurId,
              nomAffiche: `${ligne.auteurPrenom} ${ligne.auteurNom}`,
            }
          : null,
      creeLe: enDate(ligne.creeLe).toISOString(),
    }));
  }
}
