import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { AdresseStructureeQr } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { client, clientAdresse, utilisateur, vehicule, vehiculePlaque, type LigneClient } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

/**
 * Lectures PARTAGÉES par `facturation/documents` sur des tables qu'il ne possède pas (`client`,
 * `vehicule`, `utilisateur`). Copie locale du patron déjà posé par `atelier/references.ts` —
 * chaque module d'expert lit directement le schéma Drizzle partagé plutôt que de dépendre d'un
 * service d'un autre module (anti-couplage inter-experts, doctrine du projet).
 */

/** `nomAffiche` d'un client : raison sociale pour une entreprise, "nom prénom" sinon. Copie
 *  verbatim de `atelier/references.ts` (même règle, deux modules indépendants). */
export function nomAfficheClient(row: Pick<LigneClient, 'type' | 'nom' | 'prenom' | 'raisonSociale'>): string {
  if (row.type === 'entreprise') return row.raisonSociale ?? '';
  return [row.nom, row.prenom].filter((v): v is string => Boolean(v)).join(' ');
}

export async function chargerClientLigne(tx: TransactionDfa, ctx: ContexteTenant, clientId: string): Promise<LigneClient> {
  const [ligne] = await tx
    .select()
    .from(client)
    .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, clientId)))
    .limit(1);
  if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Client ${clientId} introuvable.`);
  return ligne;
}

export async function verifierVehiculeExiste(tx: TransactionDfa, ctx: ContexteTenant, vehiculeId: string): Promise<void> {
  const [ligne] = await tx
    .select({ id: vehicule.id })
    .from(vehicule)
    .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, vehiculeId)))
    .limit(1);
  if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Véhicule ${vehiculeId} introuvable.`);
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
export async function chargerAdresseFacturationStructuree(tx: TransactionDfa, ctx: ContexteTenant, clientId: string): Promise<AdresseStructureeQr | null> {
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
  const retenue = lignes.find((l) => l.type === 'facturation') ?? lignes.find((l) => l.type === 'principale') ?? null;
  if (!retenue || !retenue.rue || !retenue.npa || !retenue.localite) return null;
  return { rue: retenue.rue, numero: retenue.numero ?? null, npa: retenue.npa, localite: retenue.localite, pays: retenue.pays };
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
export async function chargerPlaqueVehiculeCourante(tx: TransactionDfa, ctx: ContexteTenant, vehiculeId: string | null): Promise<string | null> {
  if (!vehiculeId) return null;
  const [ligne] = await tx
    .select({ valeur: vehiculePlaque.valeur })
    .from(vehiculePlaque)
    .where(and(eq(vehiculePlaque.tenantId, ctx.tenantId), eq(vehiculePlaque.vehiculeId, vehiculeId), isNull(vehiculePlaque.au)))
    .orderBy(desc(vehiculePlaque.du))
    .limit(1);
  return ligne?.valeur ?? null;
}

export interface ResumeUtilisateur {
  readonly utilisateurId: string;
  readonly nomAffiche: string;
}

export async function chargerResumeUtilisateur(tx: TransactionDfa, ctx: ContexteTenant, utilisateurId: string | null): Promise<ResumeUtilisateur | null> {
  if (!utilisateurId) return null;
  const [ligne] = await tx
    .select({ id: utilisateur.id, prenom: utilisateur.prenom, nom: utilisateur.nom })
    .from(utilisateur)
    .where(and(eq(utilisateur.tenantId, ctx.tenantId), eq(utilisateur.id, utilisateurId)))
    .limit(1);
  if (!ligne) return null;
  return { utilisateurId: ligne.id, nomAffiche: `${ligne.prenom} ${ligne.nom}` };
}
