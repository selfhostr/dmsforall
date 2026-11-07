/**
 * `GET /evenements-temps-reel/flux` — canal SSE (Server-Sent Events), un flux HTTP long par poste
 * connecté. CHOIX SSE plutôt que WebSocket, voir le rapport de livraison pour l'arbitrage complet
 * (résumé : besoin strictement unidirectionnel serveur→navigateur, HTTP simple qui traverse mieux
 * un proxy/pare-feu d'entreprise qu'une upgrade WebSocket, aucune nouvelle dépendance).
 *
 * Authentification : `GardeSession` (APP_GUARD global) a déjà résolu le principal AVANT d'entrer
 * ici — comme toute route. La PARTICULARITÉ d'une connexion longue est qu'une session peut expirer
 * OU être révoquée (déconnexion explicite) PENDANT que le flux reste ouvert, sans qu'aucune requête
 * HTTP supplémentaire ne vienne faire rejouer la garde. `intervalleControleSession` ci-dessous
 * revérifie donc PÉRIODIQUEMENT la validité de la session via `ServiceSession.resoudre()` (même
 * logique que toute requête authentifiée : révocation, expiration absolue/glissante, compte/tenant
 * désactivés) et ferme le flux dès qu'elle échoue — latence bornée par
 * `DUREE_CONTROLE_SESSION_MS`, jamais instantanée, documenté explicitement plutôt que promis à tort.
 *
 * `@AucunDroitRequis()` : authentifié suffit pour OUVRIR le flux — le filtrage par droit/rôle a
 * déjà eu lieu à l'ÉMISSION (`ServiceEvenementsTempsReel.publier`, `rolesCibles`), pas ici. Ce
 * canal n'expose donc aucune décision d'autorisation propre : il relaie ce qu'on a déjà décidé de
 * lui donner pour ce rôle.
 */
import { droitsDuPrincipal } from '../auth/droits-personne';
import { Controller, Get, Inject, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { JETON_SERVICE_SESSION } from '../auth/jetons';
import type { ServiceSession } from '../auth/auth.types';
import { ServiceContexteRequete } from '../common/contexte';
import { AucunDroitRequis, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { JETON_CONFIG, type Config } from '../config';

import { RegistreAbonnesTempsReel } from './registre-abonnes-temps-reel';

/** Fréquence de revalidation de la session ET de battement de cœur (garde la connexion vivante à
 *  travers les proxys qui coupent les flux inactifs). 15s : assez court pour qu'une déconnexion
 *  ferme le flux à une échelle perceptible par un utilisateur, assez long pour ne pas multiplier
 *  les lectures `ServiceSession.resoudre()` (une requête base par tick et par connexion ouverte). */
const DUREE_CONTROLE_SESSION_MS = 15_000;

@ApiTags('Temps réel')
@ApiCookieAuth()
@Controller({ path: 'evenements-temps-reel', version: '1' })
@UseGuards(GardeDroit)
export class TempsReelController {
  constructor(
    private readonly contexte: ServiceContexteRequete,
    private readonly registre: RegistreAbonnesTempsReel,
    @Inject(JETON_SERVICE_SESSION) private readonly serviceSession: ServiceSession,
    @Inject(JETON_CONFIG) private readonly config: Config,
  ) {}

  @Get('flux')
  @AucunDroitRequis()
  @ApiOperation({
    summary: 'Flux Server-Sent Events des événements temps réel du tenant courant.',
    description:
      'Connexion HTTP longue : chaque message est une ligne `data: <json>` conforme à ' +
      "`EvenementTempsReel` (`@dfa/shared`). Filtré par rôle À L'ÉMISSION (le principal ne reçoit " +
      'que les événements dont il fait partie des destinataires) — ce endpoint ne fait aucun choix ' +
      "d'autorisation lui-même. Fermé automatiquement si la session expire ou est révoquée pendant " +
      `que le flux est ouvert (contrôle toutes les ${DUREE_CONTROLE_SESSION_MS / 1000}s).`,
  })
  @ApiProduces('text/event-stream')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  flux(@Req() req: Request, @Res() res: Response): void {
    const principal = this.contexte.exigerPrincipal();
    const tokenClair = this.lireCookieSession(req);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nginx (reverse proxy typique d'un déploiement garage) tamponne les réponses par défaut, ce
    // qui retarderait chaque événement jusqu'au remplissage du tampon — inacceptable pour une
    // notification censée être immédiate.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let ferme = false;

    const desabonner = this.registre.enregistrer(
      principal.tenantId,
      principal.role,
      (evenement) => {
        if (ferme) return;
        res.write(`event: message\ndata: ${JSON.stringify(evenement)}\n\n`);
      },
      droitsDuPrincipal(principal).aLeDroit,
    );

    const fermer = (): void => {
      if (ferme) return;
      ferme = true;
      if (intervalle) clearInterval(intervalle);
      desabonner();
      res.end();
    };

    const intervalle = setInterval(() => {
      void this.controlerSessionEtBattreLeCoeur(tokenClair, res, fermer);
    }, DUREE_CONTROLE_SESSION_MS);

    req.on('close', fermer);
  }

  private async controlerSessionEtBattreLeCoeur(
    tokenClair: string | null,
    res: Response,
    fermer: () => void,
  ): Promise<void> {
    if (!tokenClair) {
      fermer();
      return;
    }
    try {
      // Effet de bord accepté et voulu : une connexion SSE ouverte est une activité comme une
      // autre, elle prolonge la fenêtre d'inactivité glissante exactement comme n'importe quelle
      // requête authentifiée (voir `ServiceSessionImpl.resoudre`).
      await this.serviceSession.resoudre(tokenClair);
      res.write(': battement\n\n'); // ligne commentaire SSE — ignorée par EventSource, garde le flux vivant
    } catch {
      fermer();
    }
  }

  private lireCookieSession(req: Request): string | null {
    const valeur = req.cookies?.[this.config.SESSION_COOKIE_NOM];
    return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
  }
}
