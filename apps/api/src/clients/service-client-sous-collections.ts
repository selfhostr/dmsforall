import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import {
  npaSuisseValide,
  TRI_DEFAUT_CREATION,
  type EntreeAdresseClient,
  type EntreeConditionClient,
  type EntreeConsentementClient,
  type EntreeContactClient,
  type EntreeNoteClient,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseClientAdresse,
  type ReponseClientCondition,
  type ReponseClientConsentement,
  type ReponseClientContact,
  type ReponseClientNote,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import {
  client,
  clientAdresse,
  clientCondition,
  clientConsentement,
  clientContact,
  clientNote,
  utilisateur,
} from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { ServiceJournal } from '../common/journal';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';

import type { AuteurNote } from './mappers';
import {
  versAdresseResponse,
  versConditionResponse,
  versConsentementResponse,
  versContactResponse,
  versNoteResponse,
} from './mappers';
import type { ParametresPageSousCollection } from './schemas';
import { normaliserTelephoneCh } from './telephone';

/** Profondeur maximale de déballage de `.cause` — bornée pour ne jamais risquer une boucle
 *  infinie sur une chaîne cyclique pathologique (Drizzle n'enveloppe qu'une seule fois en
 *  pratique). Même borne que `vehicules/erreurs-contraintes.ts::PROFONDEUR_MAX_CAUSE`. */
const PROFONDEUR_MAX_CAUSE = 10;

/**
 * Reconnaît une erreur Postgres brute (`pg`) par SQLSTATE et, si besoin, par nom de contrainte —
 * en déballant la chaîne `.cause`, bornée à `PROFONDEUR_MAX_CAUSE`.
 *
 * Drizzle (`pg-core/session.js`, `catch (e) { throw new DrizzleQueryError(query, params, e) }`)
 * enveloppe SYSTÉMATIQUEMENT l'erreur brute du pilote `pg` dans une `DrizzleQueryError` qui porte
 * `code`/`constraint`/`detail` sous `.cause` — JAMAIS au premier niveau. Avant ce correctif,
 * `estViolation` ne lisait que `erreur.code` en surface : elle ne reconnaissait donc jamais rien,
 * et toute violation de contrainte (23505 sur les adresses RM-03, 23P01 sur les conditions
 * RM-07/CT-03) retombait en `ERREUR_INTERNE`/500 au lieu du 400/409 métier attendu. Patron repris
 * de `vehicules/erreurs-contraintes.ts::remonterCause` (même doctrine, appliqué localement ici
 * plutôt que via un helper partagé, en cours d'extraction ailleurs).
 *
 * Le test à chaque profondeur (plutôt qu'un déballage suivi d'un test unique) évite qu'une
 * `constraint` homonyme portée par un NIVEAU DIFFÉRENT de la chaîne ne soit prise pour la
 * contrainte recherchée : seule une correspondance exacte SQLSTATE+contrainte sur le MÊME objet
 * compte.
 */
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

/**
 * Curseur v2 (`creeLe:desc`, seul tri des cinq sous-collections — aucune n'expose de `tri`
 * fermé au contrat, §6.2) décodé — `creeLeTexte` reste le texte natif PostgreSQL du `timestamptz`,
 * jamais un `Date`, jusqu'à sa réinjection en SQL (`::timestamptz`).
 *
 * `Date` ne représente que la milliseconde depuis l'epoch (limite structurelle du type) alors que
 * PostgreSQL conserve la microseconde ; l'ancien code faisait `encoderCurseur({ creeLe: Date, id })`
 * → `.toISOString()` en interne, ce qui tronquait silencieusement le seuil de pagination et faisait
 * sauter les lignes qui partagent la même milliseconde de création (insertion en lot, reprise de
 * données) — voir `common/pagination/valeur-temporelle.ts` pour la mesure complète du défaut.
 *
 * `decoderCurseurTrie` décode aussi bien un curseur v1 historique (`{c,i}`, socle étape 0 — traité
 * comme équivalent à `TRI_DEFAUT_CREATION`) qu'un curseur v2 émis par `encoderCurseurTrie` ci-dessous
 * : un curseur v1 encore en circulation au moment de ce correctif continue donc à se décoder
 * normalement (jamais un 500, jamais une page qui saute), avec la précision milliseconde qu'il
 * portait déjà — seuls les curseurs ÉMIS APRÈS ce correctif gagnent la précision microseconde.
 *
 * DÉFAUT CORRIGÉ (même classe que celui documenté dans `common/pagination/curseur.ts`, constaté
 * en exécution réelle sur `apps/api/src/pneus/**`) : le `decoderCurseurTrie` appelé ici demande
 * désormais explicitement `typeValeur = 'temporel'` — sans quoi une valeur forgée qui n'est pas un
 * horodatage PostgreSQL bien formé traverserait ce décodage intacte et atteindrait le `::timestamptz`
 * de la clause `WHERE` ci-dessous (`conditionCurseur`), provoquant une erreur PostgreSQL native
 * (`22007`) non interceptée → `500 ERREUR_INTERNE` au lieu du `400 VALIDATION_ECHOUEE` attendu.
 */
function decoderCurseurSousCollection(curseur: string): {
  readonly creeLeTexte: string;
  readonly id: string;
} {
  const donnees = decoderCurseurTrie(curseur, TRI_DEFAUT_CREATION, 'temporel');
  if (typeof donnees.valeur !== 'string') {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return { creeLeTexte: donnees.valeur, id: donnees.id };
}

/**
 * Assemblage de page identique aux cinq sous-collections (adresses, contacts, conditions,
 * consentements, notes) : troncature à `limite`, mapping vers le DTO de réponse, encodage du
 * curseur suivant sur `(creeLeTexte, id)` de la dernière ligne retenue — factorisé ici après
 * constat de cinq copies BIT-À-BIT de cette même séquence dans les méthodes `lister*` ci-dessous
 * (seules les requêtes SQL, elles, diffèrent réellement d'une sous-collection à l'autre).
 */
function assemblerPageSousCollection<
  TLigne extends { readonly creeLeTexte: string; readonly id: string },
  TReponse,
>(
  lignes: readonly TLigne[],
  limite: number,
  mapper: (ligne: TLigne) => TReponse,
): PageCurseur<TReponse> {
  const aUnePageSuivante = lignes.length > limite;
  const pageLignes = aUnePageSuivante ? lignes.slice(0, limite) : lignes;
  const derniere = pageLignes[pageLignes.length - 1];

  return {
    donnees: pageLignes.map(mapper),
    curseurSuivant:
      aUnePageSuivante && derniere
        ? encoderCurseurTrie({
            tri: TRI_DEFAUT_CREATION,
            valeur: valeurCurseurTimestamptz(derniere.creeLeTexte),
            id: derniere.id,
          })
        : null,
    limite,
  };
}

/**
 * Sous-collections de la fiche client : adresses (RM-03), contacts (RM-04), conditions
 * commerciales DATÉES (RM-07), consentements APPEND-ONLY (RM-09, nLPD), notes (RM-13).
 *
 * Pagination par curseur v2, tri fixe (`creeLe desc, id desc` — `TRI_DEFAUT_CREATION`) : aucune
 * de ces cinq collections ne déclare de `tri` fermé au contrat (§6.2) — voir
 * `schemas.ts#schemaPageSousCollection`. Le curseur transite par `decoderCurseurSousCollection()`/
 * `encoderCurseurTrie()` (jamais l'ancien `decoderCurseur()`/`encoderCurseur()` v1, qui passait par
 * un `Date` JS et tronquait la microseconde du `timestamptz` — voir la doc de
 * `decoderCurseurSousCollection` ci-dessus) ; un curseur v1 émis avant ce correctif reste décodable
 * indéfiniment (compatibilité ascendante du format, garantie par `decoderCurseurTrie`).
 */
@Injectable()
export class ServiceClientSousCollections {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly journal: ServiceJournal,
  ) {}

  // -----------------------------------------------------------------------------------------
  // Adresses (RM-03)
  // -----------------------------------------------------------------------------------------

  async listerAdresses(
    ctx: ContexteTenant,
    clientId: string,
    params: ParametresPageSousCollection,
  ): Promise<PageCurseur<ReponseClientAdresse>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const curseurDecode = params.curseur ? decoderCurseurSousCollection(params.curseur) : null;
      const conditionTenant = and(
        eq(clientAdresse.tenantId, ctx.tenantId),
        eq(clientAdresse.clientId, clientId),
      );
      // Seuil keyset construit en SQL brut plutôt qu'avec `lt`/`or` du query builder : le membre
      // droit doit être un texte casté explicitement `::timestamptz`, jamais un `Date` JS passé en
      // paramètre (le pilote `pg` le sérialiserait à la milliseconde, perdant la microseconde que
      // `clientAdresse.creeLe` conserve réellement en base — voir `decoderCurseurSousCollection`).
      const conditionCurseur = curseurDecode
        ? sql`(${clientAdresse.creeLe}, ${clientAdresse.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
        : undefined;
      const lignes = await tx
        .select({
          ...getTableColumns(clientAdresse),
          // Texte natif Postgres du timestamptz — jamais le `Date` de `getTableColumns()` (mode
          // 'date', microseconde déjà perdue). Voir common/pagination/valeur-temporelle.ts.
          creeLeTexte: sql<string>`${clientAdresse.creeLe}::text`,
        })
        .from(clientAdresse)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientAdresse.creeLe), desc(clientAdresse.id))
        .limit(params.limite + 1);

      return assemblerPageSousCollection(lignes, params.limite, versAdresseResponse);
    });
  }

  async creerAdresse(
    ctx: ContexteTenant,
    clientId: string,
    entree: EntreeAdresseClient,
  ): Promise<ReponseAvecAvertissements<ReponseClientAdresse>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      try {
        const [ligne] = await tx
          .insert(clientAdresse)
          .values({ tenantId: ctx.tenantId, clientId, ...entree })
          .returning();
        if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', "Échec de création de l'adresse.");
        return new CollecteurAvertissements().envelopper(versAdresseResponse(ligne));
      } catch (erreur) {
        throw this.traduireViolationAdresse(erreur, entree.type);
      }
    });
  }

  async modifierAdresse(
    ctx: ContexteTenant,
    clientId: string,
    adresseId: string,
    entree: Partial<EntreeAdresseClient> & { readonly actif?: boolean },
  ): Promise<ReponseAvecAvertissements<ReponseClientAdresse>> {
    // F-01 (audit sécurité) : un corps vide n'est pas une erreur interne — c'est une entrée
    // invalide, refusée AVANT d'ouvrir la transaction, avant même de vérifier que le client
    // existe. Sans cette garde, `tx.update(...).set({})` atteint Drizzle/Postgres, qui refuse
    // avec un message d'infrastructure ("No values to set") — c'est CE message qui fuitait au
    // client via `detail` (voir `traduireViolationAdresse`, corrigé dans le même correctif).
    this.exigerCorpsNonVide(entree);
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const conditionAdresse = and(
        eq(clientAdresse.tenantId, ctx.tenantId),
        eq(clientAdresse.clientId, clientId),
        eq(clientAdresse.id, adresseId),
      );
      // Trou de validation partielle (NPA×pays, `schemaModificationAdresseClient` dans
      // `@dfa/shared`) : le schéma zod ne voit que CE corps, jamais la ligne existante. Un
      // `PATCH { npa: 'ABCDE' }` seul sur une adresse CH existante — ou symétriquement
      // `PATCH { pays: 'CH' }` seul sur une adresse dont le NPA en base ne fait pas 4 chiffres —
      // atteindrait la base sans jamais être revalidé. On ne charge l'existant QUE si `npa` ou
      // `pays` est touché : un corps qui ne les modifie pas ne peut pas violer cette règle,
      // aucune lecture supplémentaire n'est justifiée.
      if ('npa' in entree || 'pays' in entree) {
        const lignesExistantes = await tx
          .select()
          .from(clientAdresse)
          .where(conditionAdresse)
          .limit(1);
        const ligneExistante = lignesExistantes[0];
        if (!ligneExistante)
          throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Adresse introuvable.');
        const paysEffectif = 'pays' in entree ? entree.pays : ligneExistante.pays;
        const npaEffectif = 'npa' in entree ? entree.npa : ligneExistante.npa;
        // `clientAdresse.npa` est NULLABLE en base (migration 0006, `npa text null` — legacy),
        // même si le contrat API l'exige toujours à la création (`schemaAdresseClientBase`) :
        // un `npa` absent (`null`/`undefined`) sur une adresse CH échoue au même titre qu'un
        // format invalide — `npaSuisseValide` n'accepte qu'une chaîne à 4 chiffres.
        if (
          paysEffectif === 'CH' &&
          !(typeof npaEffectif === 'string' && npaSuisseValide(npaEffectif))
        ) {
          throw new ErreurMetier('VALIDATION_ECHOUEE', 'Validation échouée.', {
            erreurs: [
              {
                champ: 'npa',
                code: 'custom',
                message: 'Le NPA suisse comporte exactement 4 chiffres (ex. 1950).',
              },
            ],
          });
        }
      }
      try {
        await tx.update(clientAdresse).set(entree).where(conditionAdresse);
      } catch (erreur) {
        throw this.traduireViolationAdresse(erreur, entree.type);
      }
      const lignes = await tx.select().from(clientAdresse).where(conditionAdresse).limit(1);
      const ligne = lignes[0];
      if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Adresse introuvable.');
      return new CollecteurAvertissements().envelopper(versAdresseResponse(ligne));
    });
  }

  private traduireViolationAdresse(erreur: unknown, type: string | undefined): ErreurMetier {
    if (
      estViolation(erreur, '23505', 'client_adresse_principale_uk') ||
      estViolation(erreur, '23505', 'client_adresse_facturation_uk')
    ) {
      return new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Une seule adresse de ce type peut être active à la fois (RM-03).',
        {
          erreurs: [
            {
              champ: 'type',
              code: 'adresse_active_unique',
              message: `Une adresse « ${type ?? ''} » active existe déjà.`,
            },
          ],
        },
      );
    }
    if (erreur instanceof ErreurMetier) return erreur;
    // F-01 (audit sécurité) : JAMAIS `String(erreur)` en `detail` — `FiltreProbleme` recopie ce
    // champ tel quel dans la réponse HTTP pour TOUT `ErreurMetier`, y compris `ERREUR_INTERNE`.
    // Une erreur pg brute non reconnue (message du pilote, nom de contrainte) reste donc
    // JOURNALISÉE (`ServiceJournal`, jamais exposée) — le client ne reçoit qu'un code stable.
    this.journal.error('Échec technique non typé sur une adresse client', erreur, {
      clientOperation: 'adresse',
    });
    return new ErreurMetier('ERREUR_INTERNE', "Échec sur l'adresse.");
  }

  // -----------------------------------------------------------------------------------------
  // Contacts (RM-04)
  // -----------------------------------------------------------------------------------------

  async listerContacts(
    ctx: ContexteTenant,
    clientId: string,
    params: ParametresPageSousCollection,
  ): Promise<PageCurseur<ReponseClientContact>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const curseurDecode = params.curseur ? decoderCurseurSousCollection(params.curseur) : null;
      const conditionTenant = and(
        eq(clientContact.tenantId, ctx.tenantId),
        eq(clientContact.clientId, clientId),
      );
      const conditionCurseur = curseurDecode
        ? sql`(${clientContact.creeLe}, ${clientContact.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
        : undefined;
      const lignes = await tx
        .select({
          ...getTableColumns(clientContact),
          creeLeTexte: sql<string>`${clientContact.creeLe}::text`,
        })
        .from(clientContact)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientContact.creeLe), desc(clientContact.id))
        .limit(params.limite + 1);

      return assemblerPageSousCollection(lignes, params.limite, versContactResponse);
    });
  }

  async creerContact(
    ctx: ContexteTenant,
    clientId: string,
    entree: EntreeContactClient,
  ): Promise<ReponseAvecAvertissements<ReponseClientContact>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const telephoneE164 = normaliserTelephoneCh(entree.telephone ?? null);
      const [ligne] = await tx
        .insert(clientContact)
        .values({ tenantId: ctx.tenantId, clientId, ...entree, telephoneE164 })
        .returning();
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du contact.');
      return new CollecteurAvertissements().envelopper(versContactResponse(ligne));
    });
  }

  async modifierContact(
    ctx: ContexteTenant,
    clientId: string,
    contactId: string,
    entree: Partial<EntreeContactClient> & { readonly actif?: boolean },
  ): Promise<ReponseAvecAvertissements<ReponseClientContact>> {
    // F-01 (audit sécurité) : même garde que `modifierAdresse` — un corps vide est une entrée
    // invalide, refusée avant d'atteindre la base.
    this.exigerCorpsNonVide(entree);
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const valeurs =
        'telephone' in entree
          ? { ...entree, telephoneE164: normaliserTelephoneCh(entree.telephone ?? null) }
          : entree;
      await tx
        .update(clientContact)
        .set(valeurs)
        .where(
          and(
            eq(clientContact.tenantId, ctx.tenantId),
            eq(clientContact.clientId, clientId),
            eq(clientContact.id, contactId),
          ),
        );
      const lignes = await tx
        .select()
        .from(clientContact)
        .where(
          and(
            eq(clientContact.tenantId, ctx.tenantId),
            eq(clientContact.clientId, clientId),
            eq(clientContact.id, contactId),
          ),
        )
        .limit(1);
      const ligne = lignes[0];
      if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Contact introuvable.');
      return new CollecteurAvertissements().envelopper(versContactResponse(ligne));
    });
  }

  // -----------------------------------------------------------------------------------------
  // Conditions commerciales — DATÉES (RM-07, CT-03)
  // -----------------------------------------------------------------------------------------

  async listerConditions(
    ctx: ContexteTenant,
    clientId: string,
    params: ParametresPageSousCollection,
  ): Promise<PageCurseur<ReponseClientCondition>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const curseurDecode = params.curseur ? decoderCurseurSousCollection(params.curseur) : null;
      const conditionTenant = and(
        eq(clientCondition.tenantId, ctx.tenantId),
        eq(clientCondition.clientId, clientId),
      );
      const conditionCurseur = curseurDecode
        ? sql`(${clientCondition.creeLe}, ${clientCondition.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
        : undefined;
      const lignes = await tx
        .select({
          ...getTableColumns(clientCondition),
          creeLeTexte: sql<string>`${clientCondition.creeLe}::text`,
        })
        .from(clientCondition)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientCondition.creeLe), desc(clientCondition.id))
        .limit(params.limite + 1);

      return assemblerPageSousCollection(lignes, params.limite, versConditionResponse);
    });
  }

  async creerCondition(
    ctx: ContexteTenant,
    clientId: string,
    entree: EntreeConditionClient,
  ): Promise<ReponseAvecAvertissements<ReponseClientCondition>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      try {
        const [ligne] = await tx
          .insert(clientCondition)
          .values({
            tenantId: ctx.tenantId,
            clientId,
            rabaisMoPourmille: entree.rabaisMoPourmille,
            rabaisPiecesPourmille: entree.rabaisPiecesPourmille,
            rabaisPneusPourmille: entree.rabaisPneusPourmille,
            tauxHoraireCode: entree.tauxHoraireCode ?? null,
            delaiPaiementJours: entree.delaiPaiementJours ?? null,
            modePaiement: entree.modePaiement ?? null,
            plafondCentimes: entree.plafondCentimes ?? null,
            valideDu: entree.valideDuLe,
            valideAu: entree.valideAuLe ?? null,
          })
          .returning();
        if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création de la condition.');
        return new CollecteurAvertissements().envelopper(versConditionResponse(ligne));
      } catch (erreur) {
        // RM-07/CT-03 : l'EXCLUDE `client_condition_periode_excl` refuse tout chevauchement de
        // périodes — traduit en 400 (§7.3 du contrat), PAS en 409 : c'est une erreur de saisie
        // de dates, pas un conflit de ressource.
        if (estViolation(erreur, '23P01', 'client_condition_periode_excl')) {
          throw new ErreurMetier(
            'VALIDATION_ECHOUEE',
            'Cette période chevauche des conditions déjà en vigueur pour ce client (RM-07).',
            {
              erreurs: [
                {
                  champ: 'valideDuLe',
                  code: 'periode_chevauchement',
                  message: 'Période de validité en conflit avec une autre.',
                },
              ],
            },
          );
        }
        if (erreur instanceof ErreurMetier) throw erreur;
        // F-01 (audit sécurité) : même règle que `traduireViolationAdresse` — jamais `String(erreur)`
        // en `detail`, toujours journalisé côté serveur, jamais exposé au client.
        this.journal.error('Échec technique non typé sur une condition client', erreur, {
          clientOperation: 'condition',
        });
        throw new ErreurMetier('ERREUR_INTERNE', 'Échec sur la condition.');
      }
    });
  }

  // -----------------------------------------------------------------------------------------
  // Consentements — APPEND-ONLY (RM-09, nLPD)
  // -----------------------------------------------------------------------------------------

  async listerConsentements(
    ctx: ContexteTenant,
    clientId: string,
    params: ParametresPageSousCollection,
  ): Promise<PageCurseur<ReponseClientConsentement>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const curseurDecode = params.curseur ? decoderCurseurSousCollection(params.curseur) : null;
      const conditionTenant = and(
        eq(clientConsentement.tenantId, ctx.tenantId),
        eq(clientConsentement.clientId, clientId),
      );
      const conditionCurseur = curseurDecode
        ? sql`(${clientConsentement.creeLe}, ${clientConsentement.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
        : undefined;
      const lignes = await tx
        .select({
          ...getTableColumns(clientConsentement),
          creeLeTexte: sql<string>`${clientConsentement.creeLe}::text`,
        })
        .from(clientConsentement)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientConsentement.creeLe), desc(clientConsentement.id))
        .limit(params.limite + 1);

      return assemblerPageSousCollection(lignes, params.limite, versConsentementResponse);
    });
  }

  async creerConsentement(
    ctx: ContexteTenant,
    clientId: string,
    entree: EntreeConsentementClient,
  ): Promise<ReponseAvecAvertissements<ReponseClientConsentement>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      // Append-only : une révocation antérieure n'est jamais mise à jour, on insère une
      // nouvelle ligne `accorde: false` (voir `db/schema/atelier/client.ts`, `clientConsentement`).
      const [ligne] = await tx
        .insert(clientConsentement)
        .values({
          tenantId: ctx.tenantId,
          clientId,
          type: entree.type,
          accorde: entree.accorde,
          recueilliLe: new Date(entree.recueilliLe),
          canal: entree.canal ?? null,
        })
        .returning();
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création du consentement.');
      return new CollecteurAvertissements().envelopper(versConsentementResponse(ligne));
    });
  }

  // -----------------------------------------------------------------------------------------
  // Notes (RM-13)
  // -----------------------------------------------------------------------------------------

  async listerNotes(
    ctx: ContexteTenant,
    clientId: string,
    params: ParametresPageSousCollection,
  ): Promise<PageCurseur<ReponseClientNote>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);

      const curseurDecode = params.curseur ? decoderCurseurSousCollection(params.curseur) : null;
      const conditionTenant = and(
        eq(clientNote.tenantId, ctx.tenantId),
        eq(clientNote.clientId, clientId),
      );
      const conditionCurseur = curseurDecode
        ? sql`(${clientNote.creeLe}, ${clientNote.id}) < (${curseurDecode.creeLeTexte}::timestamptz, ${curseurDecode.id})`
        : undefined;

      const lignes = await tx
        .select({
          ...getTableColumns(clientNote),
          auteurPrenom: utilisateur.prenom,
          auteurNom: utilisateur.nom,
          creeLeTexte: sql<string>`${clientNote.creeLe}::text`,
        })
        .from(clientNote)
        .leftJoin(
          utilisateur,
          and(
            eq(clientNote.tenantId, utilisateur.tenantId),
            eq(clientNote.auteurId, utilisateur.id),
          ),
        )
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientNote.creeLe), desc(clientNote.id))
        .limit(params.limite + 1);

      return assemblerPageSousCollection(lignes, params.limite, (ligne) =>
        versNoteResponse(ligne, this.auteurDepuisLigne(ligne)),
      );
    });
  }

  async creerNote(
    ctx: ContexteTenant,
    clientId: string,
    entree: EntreeNoteClient,
  ): Promise<ReponseAvecAvertissements<ReponseClientNote>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await this.verifierClientExiste(tx, ctx, clientId);
      const [ligne] = await tx
        .insert(clientNote)
        .values({
          tenantId: ctx.tenantId,
          clientId,
          nature: entree.nature,
          texte: entree.texte,
          auteurId: ctx.utilisateurId,
        })
        .returning();
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création de la note.');

      const auteur = ctx.utilisateurId
        ? await this.chargerAuteur(tx, ctx, ctx.utilisateurId)
        : null;
      return new CollecteurAvertissements().envelopper(versNoteResponse(ligne, auteur));
    });
  }

  // -----------------------------------------------------------------------------------------
  // Utilitaires partagés
  // -----------------------------------------------------------------------------------------

  /**
   * F-01 (audit sécurité) : un `PATCH` dont le corps ne porte AUCUN champ (`{}`, ou un corps qui
   * ne contient que des clés inconnues — zod les a déjà retirées en amont) n'est pas une panne
   * serveur, c'est une entrée invalide. Avant ce garde, `modifierAdresse`/`modifierContact`
   * laissaient un tel corps atteindre `tx.update(...).set({})` : Drizzle/Postgres refuse alors
   * avec un message d'infrastructure ("No values to set"), que le code appelant promouvait au
   * rang de `detail` exposé — exactement le défaut que ce correctif ferme. Réutilisé par toute
   * sous-collection PATCH-able ; conditions/consentements/notes n'ont pas de `PATCH` (RM-07 daté,
   * RM-09/RM-13 append-only), donc pas besoin de cette garde.
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

  private async verifierClientExiste(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    clientId: string,
  ): Promise<void> {
    const lignes = await tx
      .select({ id: client.id })
      .from(client)
      .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
      .limit(1);
    if (lignes.length === 0) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');
  }

  private async chargerAuteur(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    utilisateurId: string,
  ): Promise<AuteurNote | null> {
    const lignes = await tx
      .select({ prenom: utilisateur.prenom, nom: utilisateur.nom })
      .from(utilisateur)
      .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)))
      .limit(1);
    const ligne = lignes[0];
    return ligne ? { utilisateurId, nomAffiche: `${ligne.prenom} ${ligne.nom}` } : null;
  }

  private auteurDepuisLigne(ligne: {
    auteurId: string | null;
    auteurPrenom: string | null;
    auteurNom: string | null;
  }): AuteurNote | null {
    return ligne.auteurId && ligne.auteurPrenom && ligne.auteurNom
      ? { utilisateurId: ligne.auteurId, nomAffiche: `${ligne.auteurPrenom} ${ligne.auteurNom}` }
      : null;
  }
}
