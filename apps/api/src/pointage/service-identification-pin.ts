import { Inject, Injectable } from '@nestjs/common';
import { estCompteDeService, type ReponseIdentificationPin } from '@dfa/shared';

import { exigerSiteDuCompteDeService, verifierSiteAutorise } from '../auth/comptes-de-service';
import { JETON_SERVICE_MOT_DE_PASSE } from '../auth/jetons';
import type { ServiceMotDePasse } from '../auth/auth.types';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

import {
  chargerLignePin,
  chargerPinsActifsAutresTechniciens,
  chargerPinsActifsDuSite,
  chargerUtilisateurCible,
  desactiverPin,
  insererPin,
  majPinHash,
  verifierSiteExiste,
} from './pin-requetes';
import type { EntreeAttributionPin, EntreeRevocationPin, ReponsePinPointage } from './pin-contrats';
import { ServiceVerrouillagePin } from './service-verrouillage-pin';

/**
 * Mode « borne partagée » du pointage — identification par PIN (RM-113 → RM-115, RM-126, RM-129) et
 * gestion des PIN (RM-127, RM-128). `docs/specification-pointage-borne.md`.
 *
 * SERVICE VOLONTAIREMENT SÉPARÉ de `ServicePointage` (démarrer/arrêter/corriger) : ce sont deux
 * surfaces distinctes. Le PIN n'ouvre AUCUNE session, ne pose aucun cookie/jeton et n'autorise aucun
 * geste — il RÉPOND SEULEMENT « voici qui c'est » (contrat `pointage/identification.ts`). Le DROIT
 * d'écrire un pointage reste porté par la session de la borne (`atelier.pointage.demarrer/arreter`),
 * jamais par le PIN.
 *
 * Le hachage réutilise le MÊME primitif Argon2id que les mots de passe (`ServiceMotDePasse`,
 * RM-126) : aucun second algorithme à écrire ni à auditer. Le service est fourni au module par
 * `JETON_SERVICE_MOT_DE_PASSE` — voir `pointage.module.ts` pour le choix de le lier localement
 * plutôt que d'importer `AuthModule`.
 */
@Injectable()
export class ServiceIdentificationPin {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_SERVICE_MOT_DE_PASSE) private readonly motDePasse: ServiceMotDePasse,
    private readonly verrouillage: ServiceVerrouillagePin,
  ) {}

  /* ---------------------------------------------------------------------------------------- */
  /* Identification (borne — `atelier.pointage.identifier`)                                    */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * `POST /pointages/identification` — reconnaît un technicien par son PIN, sur le site de la BORNE
   * (résolu depuis la session, jamais de la requête). N'ouvre AUCUNE session.
   *
   * Ordre (RM-129) : (1) refuser d'emblée si la borne est verrouillée par l'anti-balayage ;
   * (2) chercher un PIN actif du site qui corresponde ; (3) succès → remettre l'ardoise à zéro et
   * rendre l'identité ; (4) échec → enregistrer la tentative (escalade éventuelle) et refuser en
   * `401 POINTAGE_PIN_INVALIDE`. Le verrou ne mord qu'à la tentative SUIVANTE : la tentative fautive
   * elle-même reçoit toujours `POINTAGE_PIN_INVALIDE`, jamais `423` — un client ne doit pas déduire
   * de l'apparition du 423 « le PIN que je viens de taper était le bon ».
   */
  async identifier(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    codePin: string,
  ): Promise<ReponseIdentificationPin> {
    // Site de la borne DEPUIS LA SESSION — lève 401 si le principal n'est pas un compte de service
    // (la route est déjà réservée à `poste_atelier` par `@ExigerDroit`, ceci est la ceinture).
    const siteId = exigerSiteDuCompteDeService(principal);
    const borneUtilisateurId = principal.utilisateurId;

    const verrou = await this.verrouillage.etatVerrou(ctx.tenantId, borneUtilisateurId);
    if (verrou.verrouille) {
      throw this.erreurVerrouille(verrou.resteSecondes);
    }

    const technicien = await this.acces.enTenant(ctx, async (tx) => {
      const pins = await chargerPinsActifsDuSite(tx, ctx, siteId);
      for (const pin of pins) {
        if (await this.motDePasse.verifier(pin.pinHash, codePin)) {
          return {
            technicienId: pin.utilisateurId,
            prenom: pin.prenom,
            nom: pin.nom,
            // Site de la BORNE (session), pas du technicien identifié — même valeur que `siteId`
            // résolu ci-dessus par `exigerSiteDuCompteDeService`, portée jusqu'au client pour que
            // l'écran borne n'ait plus jamais à le redemander (contrat `identification.ts`).
            siteId,
          } satisfies ReponseIdentificationPin;
        }
      }
      return null;
    });

    if (technicien === null) {
      await this.verrouillage.enregistrerEchec(ctx.tenantId, borneUtilisateurId);
      throw new ErreurMetier(
        'POINTAGE_PIN_INVALIDE',
        'Aucun technicien actif de ce site ne porte ce code PIN.',
      );
    }

    await this.verrouillage.reinitialiser(ctx.tenantId, borneUtilisateurId);
    return technicien;
  }

  private erreurVerrouille(resteSecondes: number): ErreurMetier {
    // `Retry-After` (secondes) porté par l'en-tête — même patron que le 429 de la connexion
    // (`FiltreProbleme` relaie `enTetes`). Le contrat (`identification.ts`) l'annonce explicitement.
    return new ErreurMetier(
      'POINTAGE_PIN_VERROUILLE',
      `Sélecteur de code PIN temporairement verrouillé (trop de tentatives). Réessayez dans ${String(resteSecondes)} s.`,
      { enTetes: { 'Retry-After': String(resteSecondes) } },
    );
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Gestion des PIN (encadrement — `atelier.pointage.gerer_pin`)                              */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * `PUT /pointages/pins` — attribuer ou réinitialiser le PIN d'un technicien sur un site (RM-128).
   * Upsert : crée le rattachement s'il n'existe pas, sinon met à jour son PIN et le réactive.
   *
   * Le PIN est HACHÉ (Argon2id) avant tout stockage — jamais en clair (RM-126). Unicité du PIN PAR
   * SITE vérifiée à l'écriture (RM-127) : un hachage salé rend deux hachages du même PIN toujours
   * différents, donc aucune contrainte DB ne peut la porter — on itère les autres PIN actifs du site
   * et on compare par `argon2.verify()`.
   */
  async attribuer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeAttributionPin,
  ): Promise<ReponsePinPointage> {
    // Défense en profondeur : pour une PERSONNE (le cas normal de `gerer_pin`), c'est un no-op ;
    // si un compte de service détenait un jour ce droit, il ne pourrait écrire QUE sur son site.
    verifierSiteAutorise(principal, entree.siteId);

    // Hachage HORS transaction : Argon2id est coûteux en CPU (par conception) et n'a besoin
    // d'aucune ligne — le calculer sous verrou tiendrait la transaction ouverte pour rien.
    const pinHash = await this.motDePasse.hacher(entree.codePin);
    const modifieParUtilisateurId = this.exigerUtilisateurCourant(ctx);

    return this.acces.enTenant(ctx, async (tx) => {
      await verifierSiteExiste(tx, ctx, entree.siteId);

      const cible = await chargerUtilisateurCible(tx, ctx, entree.utilisateurId);
      if (estCompteDeService(cible.role)) {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          "Un PIN désigne une personne : impossible de l'attribuer à un compte de service (la borne).",
          {
            erreurs: [
              { champ: 'utilisateurId', code: 'compte_de_service', message: 'Cible invalide.' },
            ],
          },
        );
      }

      // RM-127 — unicité du PIN par site (hors le technicien lui-même, dont réattribuer le même PIN
      // n'est pas un conflit).
      const autres = await chargerPinsActifsAutresTechniciens(
        tx,
        ctx,
        entree.siteId,
        entree.utilisateurId,
      );
      for (const autre of autres) {
        if (await this.motDePasse.verifier(autre.pinHash, entree.codePin)) {
          throw new ErreurMetier(
            'CONFLIT',
            'Ce code PIN est déjà utilisé par un autre technicien de ce site (RM-127).',
          );
        }
      }

      const existant = await chargerLignePin(tx, ctx, entree.siteId, entree.utilisateurId);
      if (existant) {
        await majPinHash(
          tx,
          ctx,
          entree.siteId,
          entree.utilisateurId,
          pinHash,
          modifieParUtilisateurId,
        );
      } else {
        await insererPin(tx, {
          tenantId: ctx.tenantId,
          siteId: entree.siteId,
          utilisateurId: entree.utilisateurId,
          pinHash,
          actif: true,
          creeParUtilisateurId: modifieParUtilisateurId,
          modifieParUtilisateurId,
        });
      }

      return { siteId: entree.siteId, utilisateurId: entree.utilisateurId, actif: true };
    });
  }

  /**
   * `POST /pointages/pins/revocation` — retire un technicien de la borne d'un site (`actif=false`,
   * jamais un DELETE : la ligne inactive garde l'historique du rattachement, migration 0036 §E).
   * `404` si aucun rattachement ACTIF n'existe — rien à révoquer.
   */
  async revoquer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeRevocationPin,
  ): Promise<ReponsePinPointage> {
    verifierSiteAutorise(principal, entree.siteId);
    const modifieParUtilisateurId = this.exigerUtilisateurCourant(ctx);

    return this.acces.enTenant(ctx, async (tx) => {
      const existant = await chargerLignePin(tx, ctx, entree.siteId, entree.utilisateurId);
      if (!existant || !existant.actif) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          'Aucun rattachement PIN actif à révoquer pour ce technicien sur ce site.',
        );
      }
      await desactiverPin(tx, ctx, entree.siteId, entree.utilisateurId, modifieParUtilisateurId);
      return { siteId: entree.siteId, utilisateurId: entree.utilisateurId, actif: false };
    });
  }

  /**
   * L'auteur du geste (RM-128, `cree_par`/`modifie_par` — jamais NULL). Vient du contexte résolu
   * depuis la session, jamais de la requête. `null` = tâche système, qui n'a rien à faire ici.
   */
  private exigerUtilisateurCourant(ctx: ContexteTenant): string {
    if (ctx.utilisateurId === null) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        'La gestion des PIN exige un utilisateur authentifié (RM-128 : traçabilité qui/quand).',
      );
    }
    return ctx.utilisateurId;
  }
}
