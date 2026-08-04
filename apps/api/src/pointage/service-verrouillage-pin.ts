import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { JETON_REDIS } from '../common/limitation/redis.provider';

/**
 * Anti-balayage du sélecteur de PIN de la borne (RM-129, `docs/specification-pointage-borne.md`).
 *
 * ------------------------------------------------------------------------------------------------
 * POURQUOI CE SERVICE EXISTE, ET POURQUOI IL EST SUR REDIS
 * ------------------------------------------------------------------------------------------------
 * Un PIN fait 4 chiffres — 10'000 combinaisons. Sans ralentissement après échecs, quiconque devant
 * la borne peut les épuiser en quelques minutes et « deviner » l'identité de n'importe quel
 * technicien du site. RM-129 impose donc un verrouillage temporaire APRÈS un petit nombre d'échecs.
 *
 * Le mécanisme de VÉRITÉ pour l'anti-force-brute de la connexion est double dans ce dépôt :
 *   1. `ServiceLimitationDebit` (Redis, fenêtre glissante `common/limitation/`) — un plafond PLAT
 *      « N essais par fenêtre », inapte à exprimer une escalade de paliers ;
 *   2. le verrouillage PROGRESSIF du compte (`auth/services/authentification.service.ts`,
 *      `PALIERS_VERROUILLAGE_MINUTES`) — mais celui-là est PERSISTÉ EN BASE
 *      (`utilisateur.verrouille_jusqu_a`), et cette tâche n'a le droit de poser AUCUNE migration.
 *
 * Ce service reprend donc la LOGIQUE progressive du (2) sur l'INFRASTRUCTURE du (1) : le MÊME
 * client Redis partagé (`JETON_REDIS`, exporté globalement par `LimitationModule`), pas un nouveau
 * store. Aucune table, aucune colonne — exactement ce que la consigne demande (« pas de migration
 * nécessaire si tu passes par Redis »).
 *
 * ------------------------------------------------------------------------------------------------
 * PORTÉE DU VERROU : L'IDENTITÉ DE LA BORNE, JAMAIS UN `idAppareil` DÉCLARATIF
 * ------------------------------------------------------------------------------------------------
 * Les clés sont scopées sur `(tenantId, borneUtilisateurId)`, où `borneUtilisateurId` est le compte
 * de service de la borne résolu DEPUIS LA SESSION (`principal.utilisateurId`), jamais un
 * identifiant fourni dans la requête. Un attaquant ne peut donc pas remettre son compteur à zéro en
 * changeant un champ de corps : le verrou suit la tablette physique authentifiée, pas une étiquette
 * qu'on choisit. C'est aussi ce qui rend le verrou EFFICACE malgré la session très longue d'un
 * compte de service (voir `auth/comptes-de-service.ts`) : la borne ne peut pas « se reconnecter »
 * pour effacer son ardoise sans le mot de passe du compte, que les techniciens ne connaissent pas.
 *
 * ------------------------------------------------------------------------------------------------
 * PALIERS COURTS, ET POURQUOI
 * ------------------------------------------------------------------------------------------------
 * Verrouiller une borne bloque TOUTE l'équipe qui pointe dessus, pas un individu : les paliers
 * (RM-129) sont donc volontairement courts — 30 s, 2 min, 10 min, 30 min — un compromis entre
 * « freiner un balayage » et « ne pas paralyser l'atelier sur une faute de frappe ». Le compteur
 * d'échecs survit au verrou (sa fenêtre est plus longue que le plus long palier) pour que l'escalade
 * se poursuive si le balayage reprend dès le déverrouillage ; une identification RÉUSSIE le remet à
 * zéro (`reinitialiser`).
 *
 * CONSTANTES DE CODE, PAS DE CONFIG — même arbitrage que `SESSION_COMPTE_DE_SERVICE_*` dans
 * `auth/comptes-de-service.ts` : `apps/api/src/config/` est hors du périmètre d'écriture de cette
 * tâche. À promouvoir en variables validées par zod (`PIN_*`) le jour où un exploitant doit les
 * régler par déploiement — signalé à @laupernoe.
 */

/** Nombre d'échecs CONSÉCUTIFS toléré avant le premier verrouillage (le 5ᵉ échec verrouille). */
export const SEUIL_ECHECS_AVANT_VERROUILLAGE = 5;

/**
 * Durées de verrouillage successives (RM-129), EN SECONDES. Le 1ᵉʳ verrou (au `SEUIL`ᵉ échec) dure
 * 30 s ; chaque échec supplémentaire monte d'un cran ; au-delà du dernier cran, le palier reste à
 * 30 min. Court par nécessité : une borne verrouillée bloque toute l'équipe (voir en-tête).
 */
export const PALIERS_VERROUILLAGE_PIN_SECONDES = [30, 120, 600, 1800] as const;

/**
 * Durée de vie du compteur d'échecs consécutifs, EN SECONDES. Strictement plus longue que le plus
 * long palier (1800 s) pour que l'escalade se poursuive si le balayage reprend juste après un
 * déverrouillage ; assez courte pour qu'une borne laissée tranquille une heure reparte de zéro.
 */
export const FENETRE_ECHECS_SECONDES = 3600;

/** Résultat d'une vérification de verrou. `resteSecondes` n'a de sens que si `verrouille`. */
export interface EtatVerrouPin {
  readonly verrouille: boolean;
  readonly resteSecondes: number;
}

@Injectable()
export class ServiceVerrouillagePin {
  constructor(@Inject(JETON_REDIS) private readonly redis: Redis) {}

  private cleEchecs(tenantId: string, borneUtilisateurId: string): string {
    return `pin-pointage:echecs:${tenantId}:${borneUtilisateurId}`;
  }

  private cleVerrou(tenantId: string, borneUtilisateurId: string): string {
    return `pin-pointage:verrou:${tenantId}:${borneUtilisateurId}`;
  }

  /**
   * À appeler AVANT toute vérification de PIN. Rend `{ verrouille: true, resteSecondes }` si la
   * borne est actuellement verrouillée — l'appelant refuse alors sans même consulter la base
   * (`POINTAGE_PIN_VERROUILLE`, 423). Ne consomme aucune tentative : un simple constat.
   */
  async etatVerrou(tenantId: string, borneUtilisateurId: string): Promise<EtatVerrouPin> {
    const ttlMs = await this.redis.pttl(this.cleVerrou(tenantId, borneUtilisateurId));
    // `pttl` : -2 = clé absente, -1 = sans expiration (jamais posé ainsi ici). Verrouillé ⇔ TTL > 0.
    if (ttlMs > 0) {
      return { verrouille: true, resteSecondes: Math.max(1, Math.ceil(ttlMs / 1000)) };
    }
    return { verrouille: false, resteSecondes: 0 };
  }

  /**
   * À appeler après un PIN REFUSÉ. Incrémente le compteur d'échecs consécutifs (fenêtre glissante
   * `FENETRE_ECHECS_SECONDES`) et, à partir du `SEUIL`ᵉ échec, pose/renouvelle le verrou pour la
   * durée du palier courant. Rend l'état du verrou résultant (utile aux tests ; l'appelant renvoie
   * toujours `POINTAGE_PIN_INVALIDE` sur la tentative fautive elle-même — le verrou ne mord qu'à la
   * tentative SUIVANTE, via `etatVerrou`).
   */
  async enregistrerEchec(tenantId: string, borneUtilisateurId: string): Promise<EtatVerrouPin> {
    const cleEchecs = this.cleEchecs(tenantId, borneUtilisateurId);
    const echecs = await this.redis.incr(cleEchecs);
    // `incr` crée la clé sans TTL : on (re)pose la fenêtre à chaque échec (fenêtre glissante).
    await this.redis.pexpire(cleEchecs, FENETRE_ECHECS_SECONDES * 1000);

    if (echecs < SEUIL_ECHECS_AVANT_VERROUILLAGE) {
      return { verrouille: false, resteSecondes: 0 };
    }

    const indexPalier = Math.min(
      echecs - SEUIL_ECHECS_AVANT_VERROUILLAGE,
      PALIERS_VERROUILLAGE_PIN_SECONDES.length - 1,
    );
    const dureeSecondes =
      PALIERS_VERROUILLAGE_PIN_SECONDES[indexPalier] ?? PALIERS_VERROUILLAGE_PIN_SECONDES[0];

    await this.redis.set(
      this.cleVerrou(tenantId, borneUtilisateurId),
      '1',
      'PX',
      dureeSecondes * 1000,
    );
    return { verrouille: true, resteSecondes: dureeSecondes };
  }

  /**
   * À appeler après une identification RÉUSSIE : efface compteur et verrou. Une bonne saisie
   * témoigne d'un usage légitime — l'ardoise repart de zéro pour ne pas pénaliser l'équipe après
   * quelques fautes de frappe suivies d'un succès.
   */
  async reinitialiser(tenantId: string, borneUtilisateurId: string): Promise<void> {
    await this.redis.del(
      this.cleEchecs(tenantId, borneUtilisateurId),
      this.cleVerrou(tenantId, borneUtilisateurId),
    );
  }
}
