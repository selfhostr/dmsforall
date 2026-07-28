/**
 * Limitation de débit sur `GET /recherche` — finding D-01 (audit sécurité).
 *
 * `service-recherche.ts` (`apps/api/src/recherche/`) scanne `ordre_reparation` SANS index
 * d'expression trigram sur `numero` (signalé en tête de ce fichier, pas corrigé ici — hors
 * périmètre `apps/api/src/db/`), et le pool de connexions Postgres est PARTAGÉ entre tous les
 * tenants (`DATABASE_POOL_MAX`, défaut 10). Sans limite, une salve de requêtes concurrentes sur
 * `/recherche` épuise ce pool pour l'ENSEMBLE des garages, pas seulement pour l'auteur des
 * requêtes — un simple script côté client (ou un onglet qui boucle) devient un interrupteur d'arrêt
 * global du produit.
 *
 * PAR UTILISATEUR, jamais par IP ni globalement : plusieurs postes d'un même garage sortent
 * fréquemment derrière une seule IP publique (NAT du site) — une limite par IP punirait tout le
 * garage (plusieurs réceptionnistes) pour l'usage normal de l'un d'eux. Une limite par utilisateur
 * protège les AUTRES TENANTS d'un compte compromis ou d'un script errant sans jamais gêner les
 * collègues d'un même comptoir, qui consomment chacun leur propre budget.
 *
 * Réutilise `ServiceLimitationDebit` (Redis, fenêtre glissante, `apps/api/src/common/limitation/`)
 * — déjà éprouvé sur `POST /auth/connexion` — plutôt que d'écrire un second mécanisme de comptage.
 * Sur refus, lève `ErreurMetier('AUTH_TROP_DE_TENTATIVES', …, { enTetes: { 'Retry-After': … } })` :
 * `FiltreProbleme` (`apps/api/src/common/erreurs/filtre-probleme.ts`) sait déjà relayer
 * `enTetes` telles quelles sur la réponse — c'est le mécanisme générique prévu pour `Retry-After`
 * (voir le commentaire de `OptionsErreurMetier.enTetes` : « ex. Retry-After sur 429 »), le même
 * levier que celui posé une seconde fois par le code d'auth, jamais un troisième mécanisme.
 *
 * CODE RÉUTILISÉ, PAS DÉDIÉ — SIGNALÉ : `AUTH_TROP_DE_TENTATIVES` est le seul code `CodeErreur` à
 * statut 429 du contrat partagé aujourd'hui (`packages/shared/src/contrats/probleme.ts`), et son
 * libellé i18n FR (`apps/web/…/erreurs.json`) est phrasé en MINUTES (« Réessayez dans X minutes »),
 * pertinent pour la fenêtre de connexion (900s) mais pas pour la fenêtre courte de la recherche
 * (`FENETRE_RECHERCHE_SECONDES` ci-dessous). `packages/shared/` et `apps/web/` sont hors du
 * périmètre d'écriture de cette correction (propriété d'autres agents) : le code, le statut HTTP et
 * l'en-tête `Retry-After` sont corrects et suffisants pour le contrat HTTP, mais un code dédié
 * (ex. `RECHERCHE_TROP_DE_REQUETES` ou un `TROP_DE_REQUETES` générique, phrasé en secondes) est un
 * suivi propre à planifier avec le propriétaire de `packages/shared/`.
 *
 * SEUILS VOLONTAIREMENT EN CONSTANTES, PAS DANS LE SCHÉMA ZOD DE CONFIG — SIGNALÉ : par convention
 * du dépôt (voir l'en-tête de `main.ts`), `apps/api/src/main.ts` et
 * `apps/api/src/config/charger-config.ts` sont les DEUX SEULS fichiers autorisés à lire
 * `process.env`, et `charger-config.ts` est hors du périmètre d'écriture exclusif confié pour cette
 * correction (`apps/api/src/config/charger-config.spec.ts` le documente explicitement : « propriété
 * expert-auth, dans son périmètre exclusif »). Rendre ces seuils configurables par variable
 * d'environnement — ce que demande l'audit — appelle donc une coordination avec le propriétaire de
 * ce fichier plutôt qu'une modification directe ici. Schéma zod prêt à intégrer tel quel :
 *
 *   LIMITE_RECHERCHE_UTILISATEUR: z.coerce.number().int().min(1).default(40),
 *   LIMITE_RECHERCHE_FENETRE_SECONDES: z.coerce.number().int().min(1).default(30),
 *
 * Défaut retenu (40 requêtes / 30 secondes, soit ≈ 1,3 req/s en régime soutenu par utilisateur) :
 * la recherche est tapée à CHAQUE véhicule qui se présente au comptoir (RM-112) — un seuil trop
 * bas rend le produit inutilisable. Une plaque suisse tapée caractère par caractère SANS debounce
 * (~8-10 caractères) tient largement sous 10 requêtes en quelques secondes ; le front debounce en
 * pratique, ce qui réduit encore ce chiffre. 40/30s laisse la marge de plusieurs recherches
 * complètes à la suite (véhicule après véhicule) tout en bornant un script ou un compte compromis à
 * un débit très en-dessous de ce qu'il faudrait pour, à lui seul, épuiser un pool de 10 connexions
 * partagées entre tenants.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { JETON_SERVICE_LIMITATION_DEBIT } from '../limitation/limitation-debit.jetons';
import type { ServiceLimitationDebit } from '../limitation/limitation-debit.types';

/** Voir le commentaire de tête de fichier — à remplacer par une lecture de config dès que
 *  `LIMITE_RECHERCHE_UTILISATEUR`/`LIMITE_RECHERCHE_FENETRE_SECONDES` existent dans le schéma zod. */
export const LIMITE_RECHERCHE_UTILISATEUR = 40;
export const LIMITE_RECHERCHE_FENETRE_SECONDES = 30;

@Injectable()
export class GardeLimitationRecherche implements CanActivate {
  constructor(
    @Inject(JETON_SERVICE_LIMITATION_DEBIT) private readonly limiteur: ServiceLimitationDebit,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  async canActivate(_contexteExecution: ExecutionContext): Promise<boolean> {
    // Exécuté après GardeSession (APP_GUARD global) et GardeDroit : un principal authentifié est
    // garanti attaché ici — voir la même hypothèse, déjà vérifiée en production, dans GardeDroit.
    const principal = this.contexte.exigerPrincipal();

    const resultat = await this.limiteur.consommer(
      `recherche:utilisateur:${principal.utilisateurId}`,
      LIMITE_RECHERCHE_UTILISATEUR,
      LIMITE_RECHERCHE_FENETRE_SECONDES,
    );

    if (!resultat.autorise) {
      throw new ErreurMetier(
        'AUTH_TROP_DE_TENTATIVES',
        'Trop de requêtes de recherche pour cet utilisateur, réessayez plus tard.',
        { enTetes: { 'Retry-After': String(resultat.resteSecondes) } },
      );
    }

    return true;
  }
}
