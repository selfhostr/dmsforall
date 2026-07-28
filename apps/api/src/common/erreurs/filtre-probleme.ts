import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CODES_ERREUR,
  TITRE_FR_PAR_CODE_ERREUR,
  type CodeErreur,
  type ErreurChamp,
  type ProblemeDetail,
} from '@dfa/shared';
import { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import { ServiceJournal } from '../journal/service-journal';
import { capturerErreurInattendue, type ContexteErreurSentry } from '../../observabilite';
import { ErreurMetier, STATUT_PAR_CODE_ERREUR } from './erreur-metier';

const TYPE_BASE = 'https://docs.dmsforall.example/erreurs';

/** Garde de type : le `code` porté par une exception appartient-il au contrat partagé ? */
function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return typeof valeur === 'string' && (CODES_ERREUR as readonly string[]).includes(valeur);
}

/**
 * Libellés FR stables — JAMAIS affichés par le front (voir contrat ProblemeDetail.title).
 * Ré-export du contrat partagé (gelé, `packages/shared/src/contrats/probleme.ts`) : ne
 * JAMAIS dupliquer cette table ici.
 */
const TITRE_PAR_CODE = TITRE_FR_PAR_CODE_ERREUR;

function construireCorps(code: CodeErreur, status: number, instance: string, detail?: string, erreurs?: ProblemeDetail['erreurs']): ProblemeDetail {
  return {
    type: `${TYPE_BASE}/${code}`,
    title: TITRE_PAR_CODE[code],
    status,
    code,
    ...(detail !== undefined ? { detail } : {}),
    instance,
    ...(erreurs !== undefined ? { erreurs } : {}),
  };
}

/**
 * Filtre global : toute exception, quelle qu'elle soit, ressort en `application/problem+json`
 * avec un `code` métier stable. Rien d'inattendu (stack, message d'exception non typée)
 * n'atteint jamais le corps de la réponse — seul `ErreurMetier` fournit le détail exposé au
 * client ; tout le reste devient `ERREUR_INTERNE`/500, avec la vraie erreur journalisée
 * côté serveur via `ServiceJournal`.
 */
@Catch()
export class FiltreProbleme implements ExceptionFilter {
  constructor(
    private readonly contexte: ServiceContexteRequete,
    private readonly journal: ServiceJournal,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reponse = ctx.getResponse<Response>();

    const contexteRequete = this.contexte.actuelOuNull();
    const instance = contexteRequete?.requeteId ?? randomUUID();

    // Contexte Sentry — identifiants techniques uniquement (voir observabilite/) : jamais
    // l'e-mail ni le nom de l'utilisateur, seulement tenantId (UUID technique, pas une donnée
    // personnelle) et le rôle. `route?.path` est le PATRON de route (ex. `/clients/:id`),
    // jamais l'URL résolue : une valeur de paramètre (VIN, plaque…) ne doit jamais finir en tag.
    const requete = ctx.getRequest<Request>();
    const contexteSentry: ContexteErreurSentry = {
      requeteId: instance,
      tenantId: contexteRequete?.principal?.tenantId,
      role: contexteRequete?.principal?.role,
      endpoint: typeof requete?.route?.path === 'string' ? requete.route.path : undefined,
      methode: requete?.method,
    };

    if (exception instanceof ErreurMetier) {
      if (exception.code === 'ERREUR_INTERNE') {
        this.journal.error('Erreur métier ERREUR_INTERNE', exception, { requeteId: instance });
        // Erreur INATTENDUE (par opposition aux erreurs métier normales comme un 401 identifiants
        // invalides, qui ne sont jamais envoyées à Sentry — voir capturer-erreur-inattendue.ts).
        capturerErreurInattendue(exception, contexteSentry);
      }
      const corps = construireCorps(exception.code, exception.status, instance, exception.detail, exception.erreurs);
      if (exception.enTetes) {
        for (const [nom, valeur] of Object.entries(exception.enTetes)) {
          reponse.setHeader(nom, valeur);
        }
      }
      reponse.status(exception.status).contentType('application/problem+json').json(corps);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const reponseException = exception.getResponse();

      // Une HttpException qui porte DÉJÀ un code métier du contrat partagé (c'est le cas des
      // exceptions du module auth, qui étendent HttpException plutôt qu'ErreurMetier) est
      // relayée telle quelle, avec son statut d'origine.
      //
      // Sans ce traitement, un 401 « identifiants invalides » ressortait en 500 ERREUR_INTERNE :
      // l'utilisateur voyait « une erreur interne s'est produite » au lieu de « mot de passe
      // incorrect », et l'API annonçait une panne serveur sur un cas de fonctionnement normal.
      if (
        typeof reponseException === 'object' &&
        reponseException !== null &&
        'code' in reponseException &&
        estCodeErreur((reponseException as { code: unknown }).code)
      ) {
        const corpsSource = reponseException as {
          code: CodeErreur;
          message?: string;
          retryApresSecondes?: number;
          erreurs?: ReadonlyArray<ErreurChamp>;
        };

        // `Retry-After` est normatif sur un 429 : sans lui, un client correct ne sait pas
        // quand retenter et martèle l'API, ce qui aggrave exactement ce que la limitation
        // de débit cherche à contenir.
        if (typeof corpsSource.retryApresSecondes === 'number') {
          reponse.setHeader('Retry-After', String(corpsSource.retryApresSecondes));
        }

        const corps = construireCorps(corpsSource.code, status, instance, undefined, corpsSource.erreurs);
        reponse.status(status).contentType('application/problem+json').json(corps);
        return;
      }

      // Exceptions Nest génériques (ex. corps JSON malformé rejeté par le parseur avant même
      // d'atteindre un contrôleur) : on les fait rentrer dans le contrat problem+json plutôt
      // que de laisser passer le format par défaut de Nest.
      const code: CodeErreur = status === 400 ? 'VALIDATION_ECHOUEE' : 'ERREUR_INTERNE';
      if (code === 'ERREUR_INTERNE') {
        this.journal.error('HttpException Nest non mappée', exception, { requeteId: instance, status });
        // Sentry seulement si le statut D'ORIGINE est déjà serveur (>= 500) : une route
        // inexistante (NotFoundException Nest, 404 — faute de frappe client, bot qui scanne
        // l'API) ou un 403 générique se retrouvent normalisés en ERREUR_INTERNE/500 dans la
        // réponse HTTP par la ligne au-dessus, mais ne sont PAS des incidents — les envoyer à
        // Sentry noierait les vraies alertes sous du bruit de trafic routinier (règle du
        // contrat : seules les erreurs INATTENDUES partent, voir capturer-erreur-inattendue.ts).
        if (status >= 500) {
          capturerErreurInattendue(exception, contexteSentry);
        }
      }
      const corps = construireCorps(code, STATUT_PAR_CODE_ERREUR[code], instance);
      reponse.status(STATUT_PAR_CODE_ERREUR[code]).contentType('application/problem+json').json(corps);
      return;
    }

    // Tout le reste (erreur de programmation, exception non typée…) : jamais exposé tel
    // quel. On journalise la vraie erreur, on renvoie un ERREUR_INTERNE générique.
    this.journal.error('Exception non typée capturée par FiltreProbleme', exception, { requeteId: instance });
    capturerErreurInattendue(exception, contexteSentry);
    const corps = construireCorps('ERREUR_INTERNE', 500, instance);
    reponse.status(500).contentType('application/problem+json').json(corps);
  }
}
