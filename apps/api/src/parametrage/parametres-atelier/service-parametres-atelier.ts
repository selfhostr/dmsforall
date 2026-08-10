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
   * FAILLE CORRIGÉE (issue #45, RF-115/RF-117) : `@ExigerDroit('parametrage.atelier.modifier')`,
   * posé de façon STATIQUE sur `PATCH /parametres-atelier`, donne l'écriture à `admin` via
   * `INFERE_PARAMETRAGE_GOUVERNANCE` (`auth/matrice-droits.ts`) — correct pour les réglages
   * ordinaires de cet endpoint (kilométrage obligatoire, signature de réception, préfixe OR…), mais
   * `reception.plafondAvoirReceptionnaireCentimes` (RF-117) est un plafond FINANCIER : `RF-115` est
   * littéral (« admin est un rôle technique et n'a aucun droit financier »). Le droit fort
   * `parametrage.atelier.plafond_avoir.modifier` doit donc être vérifié ICI, explicitement,
   * uniquement quand CE champ change effectivement — jamais en permanence (ce qui interdirait à
   * `chef_atelier` la modification des réglages ordinaires du même endpoint), et jamais côté route
   * (`@ExigerDroit` est statique par route, il ne peut pas distinguer les deux requêtes avant
   * d'avoir chargé la valeur actuelle en base). Même patron que `ServiceOr.modifier`
   * (`atelier.or.plafond_modifier`) et `ServiceVehiculeKilometrage.creer`
   * (`vehicule.kilometrage.corriger_regression`).
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

      this.verifierDroitPlafondAvoir(entree, ligneActuelle, role);

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
   * Vérifie le droit fort `parametrage.atelier.plafond_avoir.modifier` (issue #45, RF-115/RF-117)
   * UNIQUEMENT quand `reception.plafondAvoirReceptionnaireCentimes` soumis diffère de la valeur
   * actuelle en base — resoumettre la même valeur (y compris `null`, déjà en place) n'est pas une
   * modification. Posée AVANT tout écriture : aucune ligne n'est jamais touchée en cas de refus.
   */
  private verifierDroitPlafondAvoir(
    entree: EntreeModificationParametresAtelierEtendue,
    ligneActuelle: schema.LigneParametreAtelier,
    role: RoleUtilisateur,
  ): void {
    const valeurSoumise = entree.reception?.plafondAvoirReceptionnaireCentimes;
    const modifiePlafondAvoir =
      valeurSoumise !== undefined &&
      valeurSoumise !== ligneActuelle.plafondAvoirReceptionnaireCentimes;
    if (!modifiePlafondAvoir) return;

    const droitsDuRole = MATRICE_DROITS[role] ?? [];
    if (!droitsDuRole.includes('parametrage.atelier.plafond_avoir.modifier')) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        `Le rôle "${role}" n'a pas le droit de modifier le plafond d'avoir réceptionnaire (RF-115/RF-117, issue #45).`,
      );
    }
  }

  private async chargerLigne(
    tx: TransactionDfa,
    tenantId: string,
  ): Promise<schema.LigneParametreAtelier> {
    const [ligne] = await tx
      .select()
      .from(schema.parametreAtelier)
      .where(eq(schema.parametreAtelier.tenantId, tenantId));
    if (!ligne) {
      throw new ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        'Paramètres atelier introuvables pour ce tenant : la ligne de paramétrage aurait dû être créée à la création du tenant.',
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
