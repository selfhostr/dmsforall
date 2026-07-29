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
 * Sur refus, lève `ErreurMetier('RECHERCHE_TROP_DE_REQUETES', …, { enTetes: { 'Retry-After': … } })` :
 * `FiltreProbleme` (`apps/api/src/common/erreurs/filtre-probleme.ts`) sait déjà relayer
 * `enTetes` telles quelles sur la réponse — c'est le mécanisme générique prévu pour `Retry-After`
 * (voir le commentaire de `OptionsErreurMetier.enTetes` : « ex. Retry-After sur 429 »), le même
 * levier que celui posé une seconde fois par le code d'auth, jamais un troisième mécanisme.
 *
 * CODE DÉDIÉ (résolu, voir historique de ce fichier) : ce garde utilisait initialement
 * `AUTH_TROP_DE_TENTATIVES` par réutilisation — seul code `CodeErreur` à statut 429 du contrat à
 * l'époque — mais son libellé i18n FR (`apps/web/…/erreurs.json`) est phrasé en MINUTES
 * (« Réessayez dans X minutes »), pertinent pour la fenêtre de connexion (900s) mais faux pour la
 * fenêtre courte de la recherche (`LIMITE_RECHERCHE_FENETRE_SECONDES` ci-dessous, 30s par défaut),
 * et le mot « tentatives » évoque une erreur d'identifiants plutôt qu'une recherche trop fréquente.
 * `RECHERCHE_TROP_DE_REQUETES` (`packages/shared/src/contrats/probleme.ts`) est le code dédié,
 * ajouté EN FIN de `CODES_ERREUR` (garde de compilation `GardePrefixeSocleErreur` — le socle et les
 * codes de l'étape 1 gardent leurs positions), avec son propre libellé i18n dans les trois langues.
 *
 * SEUILS CONFIGURABLES (résolu, voir historique de ce fichier) : `LIMITE_RECHERCHE_UTILISATEUR` et
 * `LIMITE_RECHERCHE_FENETRE_SECONDES` vivent désormais dans le schéma zod de config
 * (`apps/api/src/config/charger-config.ts`, où le dimensionnement 40/30s est documenté et
 * justifié) et sont injectées ici via `JETON_CONFIG` — plus de constante en dur, un seul chemin de
 * configuration, cohérent avec la convention du dépôt (toute config passe par le schéma zod validé
 * au démarrage).
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import type { Config } from '../../config/config.types';
import { JETON_CONFIG } from '../../config/config.jetons';
import { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { JETON_SERVICE_LIMITATION_DEBIT } from '../limitation/limitation-debit.jetons';
import type { ServiceLimitationDebit } from '../limitation/limitation-debit.types';

@Injectable()
export class GardeLimitationRecherche implements CanActivate {
  constructor(
    @Inject(JETON_SERVICE_LIMITATION_DEBIT) private readonly limiteur: ServiceLimitationDebit,
    @Inject(JETON_CONFIG) private readonly config: Config,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  async canActivate(_contexteExecution: ExecutionContext): Promise<boolean> {
    // Exécuté après GardeSession (APP_GUARD global) et GardeDroit : un principal authentifié est
    // garanti attaché ici — voir la même hypothèse, déjà vérifiée en production, dans GardeDroit.
    const principal = this.contexte.exigerPrincipal();

    const resultat = await this.limiteur.consommer(
      `recherche:utilisateur:${principal.utilisateurId}`,
      this.config.LIMITE_RECHERCHE_UTILISATEUR,
      this.config.LIMITE_RECHERCHE_FENETRE_SECONDES,
    );

    if (!resultat.autorise) {
      throw new ErreurMetier(
        'RECHERCHE_TROP_DE_REQUETES',
        'Trop de requêtes de recherche pour cet utilisateur, réessayez plus tard.',
        { enTetes: { 'Retry-After': String(resultat.resteSecondes) } },
      );
    }

    return true;
  }
}
