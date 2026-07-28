import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, lt, or } from 'drizzle-orm';
import type {
  EntreeAdresseClient,
  EntreeConditionClient,
  EntreeConsentementClient,
  EntreeContactClient,
  EntreeNoteClient,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseClientAdresse,
  ReponseClientCondition,
  ReponseClientConsentement,
  ReponseClientContact,
  ReponseClientNote,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { JETON_DB } from '../db';
import { client, clientAdresse, clientCondition, clientConsentement, clientContact, clientNote, utilisateur } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { ServiceJournal } from '../common/journal';
import { decoderCurseur, encoderCurseur } from '../common/pagination';

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

/** Reconnaît une erreur Postgres brute (`pg`) par SQLSTATE et, si besoin, par nom de contrainte. */
function estViolation(erreur: unknown, sqlstate: string, contrainte?: string): boolean {
  if (typeof erreur !== 'object' || erreur === null) return false;
  const brute = erreur as { code?: unknown; constraint?: unknown };
  if (brute.code !== sqlstate) return false;
  return contrainte === undefined || brute.constraint === contrainte;
}

/**
 * Sous-collections de la fiche client : adresses (RM-03), contacts (RM-04), conditions
 * commerciales DATÉES (RM-07), consentements APPEND-ONLY (RM-09, nLPD), notes (RM-13).
 *
 * Pagination par curseur v1 (`creeLe desc, id desc`) : aucune de ces cinq collections ne
 * déclare de `tri` fermé au contrat (§6.2) — voir `schemas.ts#schemaPageSousCollection`.
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
      const curseurDecode = params.curseur ? decoderCurseur(params.curseur) : null;
      const conditionTenant = and(eq(clientAdresse.tenantId, ctx.tenantId), eq(clientAdresse.clientId, clientId));
      const conditionCurseur = curseurDecode
        ? or(
            lt(clientAdresse.creeLe, curseurDecode.creeLe),
            and(eq(clientAdresse.creeLe, curseurDecode.creeLe), lt(clientAdresse.id, curseurDecode.id)),
          )
        : undefined;
      const lignes = await tx
        .select()
        .from(clientAdresse)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientAdresse.creeLe), desc(clientAdresse.id))
        .limit(params.limite + 1);

      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];
      return {
        donnees: pageLignes.map(versAdresseResponse),
        curseurSuivant: aUnePageSuivante && derniere ? encoderCurseur({ creeLe: derniere.creeLe, id: derniere.id }) : null,
        limite: params.limite,
      };
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
      try {
        await tx
          .update(clientAdresse)
          .set(entree)
          .where(and(eq(clientAdresse.tenantId, ctx.tenantId), eq(clientAdresse.clientId, clientId), eq(clientAdresse.id, adresseId)));
      } catch (erreur) {
        throw this.traduireViolationAdresse(erreur, entree.type);
      }
      const lignes = await tx
        .select()
        .from(clientAdresse)
        .where(and(eq(clientAdresse.tenantId, ctx.tenantId), eq(clientAdresse.clientId, clientId), eq(clientAdresse.id, adresseId)))
        .limit(1);
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
      return new ErreurMetier('VALIDATION_ECHOUEE', 'Une seule adresse de ce type peut être active à la fois (RM-03).', {
        erreurs: [{ champ: 'type', code: 'adresse_active_unique', message: `Une adresse « ${type ?? ''} » active existe déjà.` }],
      });
    }
    if (erreur instanceof ErreurMetier) return erreur;
    // F-01 (audit sécurité) : JAMAIS `String(erreur)` en `detail` — `FiltreProbleme` recopie ce
    // champ tel quel dans la réponse HTTP pour TOUT `ErreurMetier`, y compris `ERREUR_INTERNE`.
    // Une erreur pg brute non reconnue (message du pilote, nom de contrainte) reste donc
    // JOURNALISÉE (`ServiceJournal`, jamais exposée) — le client ne reçoit qu'un code stable.
    this.journal.error("Échec technique non typé sur une adresse client", erreur, { clientOperation: 'adresse' });
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
      const curseurDecode = params.curseur ? decoderCurseur(params.curseur) : null;
      const conditionTenant = and(eq(clientContact.tenantId, ctx.tenantId), eq(clientContact.clientId, clientId));
      const conditionCurseur = curseurDecode
        ? or(
            lt(clientContact.creeLe, curseurDecode.creeLe),
            and(eq(clientContact.creeLe, curseurDecode.creeLe), lt(clientContact.id, curseurDecode.id)),
          )
        : undefined;
      const lignes = await tx
        .select()
        .from(clientContact)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientContact.creeLe), desc(clientContact.id))
        .limit(params.limite + 1);

      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];
      return {
        donnees: pageLignes.map(versContactResponse),
        curseurSuivant: aUnePageSuivante && derniere ? encoderCurseur({ creeLe: derniere.creeLe, id: derniere.id }) : null,
        limite: params.limite,
      };
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
      const valeurs = 'telephone' in entree ? { ...entree, telephoneE164: normaliserTelephoneCh(entree.telephone ?? null) } : entree;
      await tx
        .update(clientContact)
        .set(valeurs)
        .where(and(eq(clientContact.tenantId, ctx.tenantId), eq(clientContact.clientId, clientId), eq(clientContact.id, contactId)));
      const lignes = await tx
        .select()
        .from(clientContact)
        .where(and(eq(clientContact.tenantId, ctx.tenantId), eq(clientContact.clientId, clientId), eq(clientContact.id, contactId)))
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
      const curseurDecode = params.curseur ? decoderCurseur(params.curseur) : null;
      const conditionTenant = and(eq(clientCondition.tenantId, ctx.tenantId), eq(clientCondition.clientId, clientId));
      const conditionCurseur = curseurDecode
        ? or(
            lt(clientCondition.creeLe, curseurDecode.creeLe),
            and(eq(clientCondition.creeLe, curseurDecode.creeLe), lt(clientCondition.id, curseurDecode.id)),
          )
        : undefined;
      const lignes = await tx
        .select()
        .from(clientCondition)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientCondition.creeLe), desc(clientCondition.id))
        .limit(params.limite + 1);

      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];
      return {
        donnees: pageLignes.map(versConditionResponse),
        curseurSuivant: aUnePageSuivante && derniere ? encoderCurseur({ creeLe: derniere.creeLe, id: derniere.id }) : null,
        limite: params.limite,
      };
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
          throw new ErreurMetier('VALIDATION_ECHOUEE', 'Cette période chevauche des conditions déjà en vigueur pour ce client (RM-07).', {
            erreurs: [{ champ: 'valideDuLe', code: 'periode_chevauchement', message: 'Période de validité en conflit avec une autre.' }],
          });
        }
        if (erreur instanceof ErreurMetier) throw erreur;
        // F-01 (audit sécurité) : même règle que `traduireViolationAdresse` — jamais `String(erreur)`
        // en `detail`, toujours journalisé côté serveur, jamais exposé au client.
        this.journal.error('Échec technique non typé sur une condition client', erreur, { clientOperation: 'condition' });
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
      const curseurDecode = params.curseur ? decoderCurseur(params.curseur) : null;
      const conditionTenant = and(eq(clientConsentement.tenantId, ctx.tenantId), eq(clientConsentement.clientId, clientId));
      const conditionCurseur = curseurDecode
        ? or(
            lt(clientConsentement.creeLe, curseurDecode.creeLe),
            and(eq(clientConsentement.creeLe, curseurDecode.creeLe), lt(clientConsentement.id, curseurDecode.id)),
          )
        : undefined;
      const lignes = await tx
        .select()
        .from(clientConsentement)
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientConsentement.creeLe), desc(clientConsentement.id))
        .limit(params.limite + 1);

      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];
      return {
        donnees: pageLignes.map(versConsentementResponse),
        curseurSuivant: aUnePageSuivante && derniere ? encoderCurseur({ creeLe: derniere.creeLe, id: derniere.id }) : null,
        limite: params.limite,
      };
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

      const curseurDecode = params.curseur ? decoderCurseur(params.curseur) : null;
      const conditionTenant = and(eq(clientNote.tenantId, ctx.tenantId), eq(clientNote.clientId, clientId));
      const conditionCurseur = curseurDecode
        ? or(lt(clientNote.creeLe, curseurDecode.creeLe), and(eq(clientNote.creeLe, curseurDecode.creeLe), lt(clientNote.id, curseurDecode.id)))
        : undefined;

      const lignes = await tx
        .select({ ...getTableColumns(clientNote), auteurPrenom: utilisateur.prenom, auteurNom: utilisateur.nom })
        .from(clientNote)
        .leftJoin(utilisateur, and(eq(clientNote.tenantId, utilisateur.tenantId), eq(clientNote.auteurId, utilisateur.id)))
        .where(conditionCurseur ? and(conditionTenant, conditionCurseur) : conditionTenant)
        .orderBy(desc(clientNote.creeLe), desc(clientNote.id))
        .limit(params.limite + 1);

      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((ligne) => versNoteResponse(ligne, this.auteurDepuisLigne(ligne))),
        curseurSuivant: aUnePageSuivante && derniere ? encoderCurseur({ creeLe: derniere.creeLe, id: derniere.id }) : null,
        limite: params.limite,
      };
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
        .values({ tenantId: ctx.tenantId, clientId, nature: entree.nature, texte: entree.texte, auteurId: ctx.utilisateurId })
        .returning();
      if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', 'Échec de création de la note.');

      const auteur = ctx.utilisateurId ? await this.chargerAuteur(tx, ctx, ctx.utilisateurId) : null;
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
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'Le corps de la requête ne contient aucun champ à modifier.', {
        erreurs: [
          { champ: '(corps)', code: 'corps_vide', message: 'Au moins un champ doit être fourni pour une modification.' },
        ],
      });
    }
  }

  private async verifierClientExiste(tx: TransactionDfa, ctx: ContexteTenant, clientId: string): Promise<void> {
    const lignes = await tx
      .select({ id: client.id })
      .from(client)
      .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
      .limit(1);
    if (lignes.length === 0) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');
  }

  private async chargerAuteur(tx: TransactionDfa, ctx: ContexteTenant, utilisateurId: string): Promise<AuteurNote | null> {
    const lignes = await tx
      .select({ prenom: utilisateur.prenom, nom: utilisateur.nom })
      .from(utilisateur)
      .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)))
      .limit(1);
    const ligne = lignes[0];
    return ligne ? { utilisateurId, nomAffiche: `${ligne.prenom} ${ligne.nom}` } : null;
  }

  private auteurDepuisLigne(ligne: { auteurId: string | null; auteurPrenom: string | null; auteurNom: string | null }): AuteurNote | null {
    return ligne.auteurId && ligne.auteurPrenom && ligne.auteurNom
      ? { utilisateurId: ligne.auteurId, nomAffiche: `${ligne.auteurPrenom} ${ligne.auteurNom}` }
      : null;
  }
}
