import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { POLITIQUES_CONTROLE_QUALITE, type RoleUtilisateur } from '@dfa/shared';

import {
  JETON_DB,
  schema,
  type AccesBase,
  type ContexteTenant,
  type TransactionDfa,
} from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import { MATRICE_DROITS } from '../../auth/matrice-droits';
import { verifierChampsActifsParametresAtelier } from './gouvernance-fonctionnalites';
import {
  versColonnesMiseAJour,
  versDtoParametresAtelier,
  type DtoParametresAtelier,
} from './mappeur-parametres-atelier';
import type { EntreeModificationParametresAtelierEtendue } from './schema-modification-parametres-atelier-etendu';

/**
 * Δ3 (`db/migrations/0005_parametrage.sql`) : le type PG `politique_controle_qualite` reste
 * complet (4 valeurs, pour le lot 2), mais un `CHECK` restreint la colonne à `jamais`/`toujours`
 * au lot 1. Le schéma zod gelé (`schemaModificationParametresAtelier`, `packages/shared`) accepte
 * pourtant les 4 valeurs de l'enum complet — un client qui enverrait `selon_type` franchirait donc
 * la validation de forme et ne serait rattrapé que par la contrainte SQL, avec un message Postgres
 * brut. Ce garde-fou applicatif restitue une erreur métier lisible AVANT d'atteindre la base.
 */
const CONTROLE_QUALITE_VALEURS_LOT1: ReadonlySet<string> = new Set(['jamais', 'toujours']);

@Injectable()
export class ServiceParametresAtelier {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(ctx: ContexteTenant): Promise<DtoParametresAtelier> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerLigne(tx, ctx.tenantId);
      return versDtoParametresAtelier(ligne);
    });
  }

  /**
   * `role` (issue #45) — vient TOUJOURS du principal de session
   * (`ServiceContexteRequete.exigerPrincipal` côté contrôleur), jamais d'un paramètre client,
   * exactement comme `ctx.tenantId`.
   *
   * FAILLE CORRIGÉE (issue #45, RF-115/RF-117 ; étendue issue #52) : `@ExigerDroit('parametrage.
   * atelier.modifier')`, posé de façon STATIQUE sur `PATCH /parametres-atelier`, donne l'écriture
   * à `admin` via `INFERE_PARAMETRAGE_GOUVERNANCE` (`auth/matrice-droits.ts`) — correct pour les
   * réglages ordinaires de cet endpoint (kilométrage obligatoire, signature de réception, préfixe
   * OR…), mais DEUX champs de `reception` sont des plafonds FINANCIERS, MÊME sémantique documentée
   * (`db/schema/atelier/parametrage.ts`, colonnes `plafond_defaut_centimes` /
   * `plafond_avoir_receptionnaire_centimes` : NULL = aucun plafond convenu, 0 = accord requis pour
   * tout, n>0 = plafond nominal) : `plafondAvoirReceptionnaireCentimes` (RF-117, issue #45) ET
   * `plafondDefautCentimes` (issue #52, même famille — admin pouvait le fixer à 777777 en
   * production, prouvé en exécution). `RF-115` est littéral (« admin est un rôle technique et n'a
   * aucun droit financier »). Le droit fort `parametrage.atelier.plafond_avoir.modifier` doit donc
   * être vérifié ICI, explicitement, pour CHACUN de ces deux champs, uniquement quand CE champ
   * change effectivement — jamais en permanence (ce qui interdirait à `chef_atelier` la
   * modification des réglages ordinaires du même endpoint), et jamais côté route (`@ExigerDroit`
   * est statique par route, il ne peut pas distinguer les deux requêtes avant d'avoir chargé la
   * valeur actuelle en base). Même patron que `ServiceOr.modifier` (`atelier.or.plafond_modifier`)
   * et `ServiceVehiculeKilometrage.creer` (`vehicule.kilometrage.corriger_regression`).
   *
   * UNE SEULE action (`parametrage.atelier.plafond_avoir.modifier`) couvre les deux champs — pas
   * une action dédiée par champ. Choix assumé (issue #52) : les deux plafonds vivent dans la même
   * table, portent le même commentaire de sémantique tête à tête, et gouvernent la même population
   * de rôles (direction + comptable seuls, `admin: []` — voir `DROITS_PLAFOND_AVOIR_RECEPTIONNAIRE_
   * PAR_ROLE`, `auth/matrice-droits.ts`) : dédoubler l'action aurait ajouté une distinction que rien
   * ne justifie, à l'inverse de `atelier.or.plafond_modifier`, dont la population (réceptionnaire +
   * chef_atelier + direction, un plafond OPÉRATIONNEL par OR) diffère réellement de celle-ci (un
   * plafond de POLITIQUE tenant, direction + comptable). Si les deux plafonds `parametres-atelier`
   * devaient un jour diverger par rôle, cette action redeviendrait deux actions distinctes.
   */
  async modifier(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    entree: EntreeModificationParametresAtelierEtendue,
  ): Promise<DtoParametresAtelier> {
    verifierChampsActifsParametresAtelier(entree);
    this.verifierControleQualiteLot1(entree);

    const colonnes = versColonnesMiseAJour(entree);

    return this.acces.enTenant(ctx, async (tx) => {
      const ligneActuelle = await this.chargerLigne(tx, ctx.tenantId);

      this.verifierDroitPlafondsFinanciers(entree, ligneActuelle, role);

      if (Object.keys(colonnes).length === 0) {
        // Corps entièrement composé de domaines absents (`{}` ou domaines vides après validation) :
        // rien à écrire, la ligne déjà chargée ci-dessus (pour la vérification du plafond) sert de
        // réponse plutôt que d'exécuter un UPDATE sans SET.
        return versDtoParametresAtelier(ligneActuelle);
      }

      const [ligne] = await tx
        .update(schema.parametreAtelier)
        .set(colonnes)
        .where(eq(schema.parametreAtelier.tenantId, ctx.tenantId))
        .returning();

      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          'Paramètres atelier introuvables pour ce tenant : la ligne de paramétrage aurait dû être créée à la création du tenant.',
        );
      }
      return versDtoParametresAtelier(ligne);
    });
  }

  /**
   * Vérifie le droit fort `parametrage.atelier.plafond_avoir.modifier` (issue #45, RF-115/RF-117 ;
   * étendue issue #52) pour les DEUX plafonds financiers de `reception` — `plafondAvoirReceptionnaireCentimes`
   * ET `plafondDefautCentimes`, même sémantique documentée (voir le commentaire sur `modifier`
   * ci-dessus pour l'arbitrage complet) — CHACUN UNIQUEMENT quand sa valeur soumise diffère de la
   * valeur actuelle en base : resoumettre la même valeur (y compris `null`, déjà en place) n'est pas
   * une modification. Posée AVANT tout écriture : aucune ligne n'est jamais touchée en cas de refus.
   */
  private verifierDroitPlafondsFinanciers(
    entree: EntreeModificationParametresAtelierEtendue,
    ligneActuelle: schema.LigneParametreAtelier,
    role: RoleUtilisateur,
  ): void {
    this.verifierDroitPlafondFinancier(
      role,
      entree.reception?.plafondAvoirReceptionnaireCentimes,
      ligneActuelle.plafondAvoirReceptionnaireCentimes,
      "plafond d'avoir réceptionnaire",
    );
    this.verifierDroitPlafondFinancier(
      role,
      entree.reception?.plafondDefautCentimes,
      ligneActuelle.plafondDefautCentimes,
      'plafond par défaut de réception',
    );
  }

  private verifierDroitPlafondFinancier(
    role: RoleUtilisateur,
    valeurSoumise: number | null | undefined,
    valeurActuelle: number | null,
    libelleChamp: string,
  ): void {
    const modifieLePlafond = valeurSoumise !== undefined && valeurSoumise !== valeurActuelle;
    if (!modifieLePlafond) return;

    const droitsDuRole = MATRICE_DROITS[role] ?? [];
    if (!droitsDuRole.includes('parametrage.atelier.plafond_avoir.modifier')) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        `Le rôle "${role}" n'a pas le droit de modifier le ${libelleChamp} (RF-115, issue #45/#52).`,
      );
    }
  }

  /**
   * Charge la ligne du tenant ; si elle manque (garage créé avant que `creer-garage` ne la pose,
   * ou ligne jamais écrite), la crée avec les valeurs par défaut de la base — `on conflict do
   * nothing` rend la création concurrente inoffensive. Un garage neuf n'a ainsi jamais de 404.
   */
  private async chargerLigne(
    tx: TransactionDfa,
    tenantId: string,
  ): Promise<schema.LigneParametreAtelier> {
    const lire = (): Promise<schema.LigneParametreAtelier[]> =>
      tx
        .select()
        .from(schema.parametreAtelier)
        .where(eq(schema.parametreAtelier.tenantId, tenantId));

    const [existante] = await lire();
    if (existante) return existante;

    await tx.insert(schema.parametreAtelier).values({ tenantId }).onConflictDoNothing();
    const [ligne] = await lire();
    if (!ligne) {
      throw new ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        'Paramètres atelier introuvables pour ce tenant et impossibles à initialiser.',
      );
    }
    return ligne;
  }

  private verifierControleQualiteLot1(entree: EntreeModificationParametresAtelierEtendue): void {
    const valeur = entree.travaux?.controleQualite;
    if (valeur === undefined) return;
    if (!CONTROLE_QUALITE_VALEURS_LOT1.has(valeur)) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        `"travaux.controleQualite" est restreint à ${[...CONTROLE_QUALITE_VALEURS_LOT1].join('|')} au lot 1 (Δ3).`,
        {
          erreurs: [
            {
              champ: 'travaux.controleQualite',
              code: 'valeur_hors_lot1',
              message: `Valeurs admises au lot 1 : ${POLITIQUES_CONTROLE_QUALITE.filter((v) =>
                CONTROLE_QUALITE_VALEURS_LOT1.has(v),
              ).join(', ')}.`,
            },
          ],
        },
      );
    }
  }
}
