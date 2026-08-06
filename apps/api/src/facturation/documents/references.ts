import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { AdresseStructureeQr, StatutDossierVente } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import {
  client,
  clientAdresse,
  clientCondition,
  dossierVente,
  utilisateur,
  vehicule,
  vehiculePlaque,
  type LigneClient,
} from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

/**
 * Lectures PARTAGÉES par `facturation/documents` sur des tables qu'il ne possède pas (`client`,
 * `vehicule`, `utilisateur`). Copie locale du patron déjà posé par `atelier/references.ts` —
 * chaque module d'expert lit directement le schéma Drizzle partagé plutôt que de dépendre d'un
 * service d'un autre module (anti-couplage inter-experts, doctrine du projet).
 */

/** `nomAffiche` d'un client : raison sociale pour une entreprise, "nom prénom" sinon. Copie
 *  verbatim de `atelier/references.ts` (même règle, deux modules indépendants). */
export function nomAfficheClient(
  row: Pick<LigneClient, 'type' | 'nom' | 'prenom' | 'raisonSociale'>,
): string {
  if (row.type === 'entreprise') return row.raisonSociale ?? '';
  return [row.nom, row.prenom].filter((v): v is string => Boolean(v)).join(' ');
}

export async function chargerClientLigne(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  clientId: string,
): Promise<LigneClient> {
  const [ligne] = await tx
    .select()
    .from(client)
    .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
    .limit(1);
  if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Client ${clientId} introuvable.`);
  return ligne;
}

export async function verifierVehiculeExiste(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<void> {
  const [ligne] = await tx
    .select({ id: vehicule.id })
    .from(vehicule)
    .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, vehiculeId)))
    .limit(1);
  if (!ligne)
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Véhicule ${vehiculeId} introuvable.`);
}

/** États `dossier_vente` FERMÉS (`STATUTS_DOSSIER_VENTE`, `@dfa/shared`) — un document de vente
 *  (`bon_commande`/`facture`, RV-37) ne peut plus s'y rattacher une fois le dossier clos, annulé ou
 *  abandonné. Les autres états (`prospection`, `engage`, `en_preparation`, `pret_a_livrer`,
 *  `livre`) acceptent un rattachement — un bon de commande s'accroche typiquement avant
 *  l'engagement, une facture (acompte ou solde, plusieurs par dossier possibles) à tout moment
 *  avant la clôture. Choix documenté, pas tranché par la spécification au moment de cette tâche —
 *  à confirmer par expert-metier si un état intermédiaire doit en réalité être exclu. */
const ETATS_DOSSIER_VENTE_FERMES: ReadonlySet<StatutDossierVente> = new Set([
  'clos',
  'annule',
  'abandonne',
]);

/**
 * Charge un dossier de vente pour y rattacher un document (`document_vente.dossier_vente_id`,
 * RV-37/MD-70) — copie locale du patron `chargerClientLigne` ci-dessus (lecture directe du schéma
 * Drizzle partagé, anti-couplage inter-experts, doctrine de ce module) plutôt qu'un import de
 * `ventes/references.ts` : ce module ne dépend d'AUCUN service ni fonction d'un autre module
 * d'expert, seulement des tables qu'il partage.
 *
 * Tenant-scopé explicitement (`eq(dossierVente.tenantId, ctx.tenantId)`, le RLS est le filet, pas
 * le mécanisme) — un `dossierVenteId` d'un autre tenant rend `RESSOURCE_INTROUVABLE`, exactement
 * comme `chargerClientLigne`/`verifierVehiculeExiste` ci-dessus : la ligne existe en base mais la
 * clause `where` ne la voit jamais, donc AUCUNE fuite d'information sur son existence réelle.
 */
export async function chargerDossierVentePourRattachement(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<{ readonly id: string; readonly statut: StatutDossierVente }> {
  const [ligne] = await tx
    .select({ id: dossierVente.id, statut: dossierVente.statut })
    .from(dossierVente)
    .where(and(eq(dossierVente.tenantId, ctx.tenantId), eq(dossierVente.id, dossierVenteId)))
    .limit(1);
  if (!ligne) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Dossier de vente ${dossierVenteId} introuvable.`,
    );
  }
  if (ETATS_DOSSIER_VENTE_FERMES.has(ligne.statut)) {
    throw new ErreurMetier(
      'DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE',
      `Le dossier de vente ${dossierVenteId} est "${ligne.statut}" : il n'accepte plus de nouveau document rattaché (RV-37).`,
      { detail: `statutActuel=${ligne.statut}` },
    );
  }
  return ligne;
}

/**
 * Adresse de facturation active du client, sous la forme structurée exigée par la QR-facture
 * (`AdresseStructureeQr`, `rue`/`numero` séparés).
 *
 * ÉCART RÉSOLU (migration 0014) : `client_adresse.numero` existe désormais comme colonne dédiée,
 * NULLABLE à dessein (case postale, lieu-dit, hameau n'en ont pas — `RF-60` assoupli vers le
 * standard SIX, arbitrage repris tel quel de la migration). `numero` est donc lu tel quel ici,
 * `null` compris : ce n'est PAS traité comme un échec — `evaluerCompletudeAdresse` /
 * `CHAMPS_REQUIS_BLOC_DEBITEUR` (`facturation/qr/adresse.ts`, hors périmètre de ce module)
 * décident seuls si son absence rend le bloc débiteur incomplet, jamais ce chargeur. Avant cette
 * résolution, `numero` était rendu `null` INCONDITIONNELLEMENT (aucune colonne dédiée n'existait) :
 * ce n'est plus le cas, les adresses saisies avec numéro le portent maintenant jusqu'au bloc
 * débiteur du QR. Les adresses migrées avant 0014 restent à `numero = null` tant qu'une ressaisie
 * ne les complète pas (aucune reprise automatique n'a été faite, choix déjà tranché par 0014).
 */
export async function chargerAdresseFacturationStructuree(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  clientId: string,
): Promise<AdresseStructureeQr | null> {
  const lignes = await tx
    .select()
    .from(clientAdresse)
    .where(
      and(
        eq(clientAdresse.tenantId, ctx.tenantId),
        eq(clientAdresse.clientId, clientId),
        eq(clientAdresse.actif, true),
        or(eq(clientAdresse.type, 'facturation'), eq(clientAdresse.type, 'principale')),
      ),
    );
  const retenue =
    lignes.find((l) => l.type === 'facturation') ??
    lignes.find((l) => l.type === 'principale') ??
    null;
  if (!retenue || !retenue.rue || !retenue.npa || !retenue.localite) return null;
  return {
    rue: retenue.rue,
    numero: retenue.numero ?? null,
    npa: retenue.npa,
    localite: retenue.localite,
    pays: retenue.pays,
  };
}

/**
 * Conditions commerciales du client EN VIGUEUR à la date `le` (RM-07/AC-12/PF-04) — copie locale
 * du patron `atelier/references.ts::chargerConditionsEnVigueur` (même anti-couplage inter-experts
 * que le reste de ce fichier : lecture directe du schéma Drizzle partagé, jamais un appel au
 * service `atelier/`). Au plus une ligne, garanti par la contrainte d'exclusion en base sur
 * `client_condition` (même commentaire que la fonction copiée).
 *
 * Rend directement la forme JSONB à figer sur `document_vente.conditions_paiement_figees`
 * (`{} ` si aucune condition en vigueur — la colonne est `not null default '{}'::jsonb`, jamais
 * `null`), MÊME SOUS-ENSEMBLE DE CHAMPS que `ValeursSnapshotOr.conditionsFigees`
 * (`atelier/service-snapshot-or.ts`) pour que `conditions_paiement_figees` ait la même forme,
 * qu'un document naisse ici (`ServiceDocumentsVente.creer`) ou via `atelier/service-facturation-
 * or.ts::ServiceFacturationOr.facturer`, qui appelle CETTE MÊME fonction (import direct,
 * `apps/api/src/atelier/service-facturation-or.ts`) plutôt que de dupliquer la lecture.
 *
 * COMBLE LA SIMPLIFICATION SIGNALÉE qui bloquait tout calcul d'échéance (`echeance.ts` :
 * `lireDelaiPaiementJoursFige` lit exactement `delaiPaiementJours` sur l'objet rendu ici) — avant
 * cette fonction, `ServiceDocumentsVente.creer` écrivait `conditionsPaiementFigees: {}`
 * inconditionnellement (RF-04/PF-04 jamais capturées), ce qui aurait rendu `date_echeance`
 * TOUJOURS `null` même pour un client dont les conditions sont correctement paramétrées.
 */
export async function chargerConditionsPaiementEnVigueur(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  clientId: string,
  le: Date,
): Promise<Record<string, unknown>> {
  const dateJour = le.toISOString().slice(0, 10);
  const lignes = await tx
    .select()
    .from(clientCondition)
    .where(and(eq(clientCondition.tenantId, ctx.tenantId), eq(clientCondition.clientId, clientId)));
  const enVigueur =
    lignes.find((l) => l.valideDu <= dateJour && (l.valideAu === null || l.valideAu >= dateJour)) ??
    null;
  if (!enVigueur) return {};
  return {
    rabaisMoPourmille: enVigueur.rabaisMoPourmille,
    rabaisPiecesPourmille: enVigueur.rabaisPiecesPourmille,
    rabaisPneusPourmille: enVigueur.rabaisPneusPourmille,
    tauxHoraireCode: enVigueur.tauxHoraireCode,
    delaiPaiementJours: enVigueur.delaiPaiementJours,
    modePaiement: enVigueur.modePaiement,
    plafondCentimes: enVigueur.plafondCentimes,
  };
}

/**
 * Plaque COURANTE du véhicule (`au is null`) — utilisée en repli pour `figees.plaque`.
 *
 * ÉCART SIGNALÉ : `document_vente` (migration 0010 §7) ne porte AUCUNE colonne `plaque_figee`,
 * contrairement à `ordre_reparation.plaque_figee` (0008) — alors que `ValeursFigeesDocument.plaque`
 * du contrat gelé (`@dfa/shared`) l'exige au même titre que le reste des valeurs figées (`MD-24` :
 * « un document émis ne va rien chercher ailleurs pour s'afficher »). Faute de colonne, cette
 * fonction lit la plaque COURANTE au moment de l'affichage — donc PAS figée : un changement de
 * plaque après émission changerait ce que rend `GET /documents-vente/{id}`, ce que `MD-24` interdit
 * en principe. À signaler à expert-database : la vraie correction est une migration additive
 * (`document_vente.plaque_figee text`), hors du périmètre d'écriture de cette tâche.
 */
export async function chargerPlaqueVehiculeCourante(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string | null,
): Promise<string | null> {
  if (!vehiculeId) return null;
  const [ligne] = await tx
    .select({ valeur: vehiculePlaque.valeur })
    .from(vehiculePlaque)
    .where(
      and(
        eq(vehiculePlaque.tenantId, ctx.tenantId),
        eq(vehiculePlaque.vehiculeId, vehiculeId),
        isNull(vehiculePlaque.au),
      ),
    )
    .orderBy(desc(vehiculePlaque.du))
    .limit(1);
  return ligne?.valeur ?? null;
}

export interface ResumeUtilisateur {
  readonly utilisateurId: string;
  readonly nomAffiche: string;
}

export async function chargerResumeUtilisateur(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  utilisateurId: string | null,
): Promise<ResumeUtilisateur | null> {
  if (!utilisateurId) return null;
  const [ligne] = await tx
    .select({ id: utilisateur.id, prenom: utilisateur.prenom, nom: utilisateur.nom })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)))
    .limit(1);
  if (!ligne) return null;
  return { utilisateurId: ligne.id, nomAffiche: `${ligne.prenom} ${ligne.nom}` };
}
