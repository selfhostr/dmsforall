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
import { ErreurMetier } from './erreur-metier';

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

/**
 * `detail` d'une erreur `pg` (« Key (iban)=(CH93…) already exists. ») : le nom de colonne reste,
 * la valeur (donnée client) est masquée.
 */
function masquerValeursDetail(detail: unknown): unknown {
  if (typeof detail !== 'string') return detail;
  return detail.replace(/=\([^)]*\)/g, '=([masqué])');
}

/**
 * Causes techniques d'une erreur de base (ex. `DrizzleQueryError` enveloppant l'erreur `pg`) :
 * `code`, `constraint`, `detail` (valeurs masquées) et `message` de `cause`, sans JAMAIS les
 * paramètres de requête (`query`, `params`) ni le texte SQL.
 */
function causeTechnique(exception: unknown): Record<string, unknown> | undefined {
  if (typeof exception !== 'object' || exception === null || !('cause' in exception)) {
    return undefined;
  }
  const cause = (exception as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return undefined;
  const { code, constraint, detail, message } = cause as Record<string, unknown>;
  return { cause: { code, constraint, detail: masquerValeursDetail(detail), message } };
}

/** Champs facultatifs de `ProblemeDetail` au-delà du socle (type/title/status/code/instance). */
interface ChampsCorpsFacultatifs {
  readonly detail?: ProblemeDetail['detail'];
  readonly erreurs?: ProblemeDetail['erreurs'];
  readonly blocages?: ProblemeDetail['blocages'];
  readonly confirmationsRequises?: ProblemeDetail['confirmationsRequises'];
  readonly actionsProposees?: ProblemeDetail['actionsProposees'];
}

/**
 * N'émet chacun de ces cinq champs QUE quand ils sont présents (tous facultatifs sur
 * `ProblemeDetail`) : un `JSON.stringify` d'une clé `undefined` la fait disparaître, mais
 * autant ne jamais la poser sur l'objet plutôt que de compter sur ce comportement.
 */
function construireCorps(
  code: CodeErreur,
  status: number,
  instance: string,
  champs: ChampsCorpsFacultatifs = {},
): ProblemeDetail {
  const { detail, erreurs, blocages, confirmationsRequises, actionsProposees } = champs;
  return {
    type: `${TYPE_BASE}/${code}`,
    title: TITRE_PAR_CODE[code],
    status,
    code,
    ...(detail !== undefined ? { detail } : {}),
    instance,
    ...(erreurs !== undefined ? { erreurs } : {}),
    ...(blocages !== undefined ? { blocages } : {}),
    ...(confirmationsRequises !== undefined ? { confirmationsRequises } : {}),
    ...(actionsProposees !== undefined ? { actionsProposees } : {}),
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
      const corps = construireCorps(exception.code, exception.status, instance, {
        detail: exception.detail,
        erreurs: exception.erreurs,
        blocages: exception.blocages,
        confirmationsRequises: exception.confirmationsRequises,
        actionsProposees: exception.actionsProposees,
      });
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

        const corps = construireCorps(corpsSource.code, status, instance, {
          erreurs: corpsSource.erreurs,
        });
        reponse.status(status).contentType('application/problem+json').json(corps);
        return;
      }

      // Exceptions Nest génériques (ex. corps JSON malformé rejeté par le parseur avant même
      // d'atteindre un contrôleur, route inexistante, méthode HTTP non supportée…) : on les
      // fait rentrer dans le contrat problem+json plutôt que de laisser passer le format par
      // défaut de Nest.
      //
      // Le statut D'ORIGINE reste toujours celui renvoyé au client — un 4xx (404 route
      // inexistante, 405 méthode non supportée…) ne doit JAMAIS se travestir en panne serveur
      // 500 : c'était le bug constaté sur `GET /api/sante` (faute de frappe cliente), qui
      // faisait perdre une étape de diagnostic. Seul un statut D'ORIGINE déjà serveur (>= 500 —
      // incident réel) reste normalisé en ERREUR_INTERNE/500, comportement inchangé.
      if (status < 500) {
        // `codeConnu` : statuts qui ont un code métier dédié et déjà défini dans le contrat
        // partagé (§4.3, `STATUT_HTTP_PAR_CODE_ERREUR`). Pour les 4xx génériques restants sans
        // code dédié, ERREUR_INTERNE sert de repli ; le statut HTTP, lui, reste toujours correct.
        const codeConnu: CodeErreur | undefined =
          status === 400
            ? 'VALIDATION_ECHOUEE'
            : status === 404
              ? 'RESSOURCE_INTROUVABLE'
              : status === 405
                ? 'METHODE_NON_AUTORISEE'
                : undefined;
        const code = codeConnu ?? 'ERREUR_INTERNE';
        if (code === 'ERREUR_INTERNE') {
          // Routine (faute de frappe d'URL, bot qui scanne l'API, mauvais verbe HTTP…), jamais
          // un incident : journalisé pour le diagnostic, jamais envoyé à Sentry (règle du
          // contrat : seules les erreurs INATTENDUES partent, voir capturer-erreur-inattendue.ts).
          this.journal.warn('HttpException Nest 4xx sans code métier dédié', {
            requeteId: instance,
            status,
          });
        }
        const corps = construireCorps(code, status, instance);
        reponse.status(status).contentType('application/problem+json').json(corps);
        return;
      }

      // Statut D'ORIGINE déjà serveur (>= 500) : comportement inchangé — ERREUR_INTERNE/500,
      // journalisé en erreur et envoyé à Sentry (incident réel, jamais du trafic routinier).
      this.journal.error('HttpException Nest non mappée', exception, {
        requeteId: instance,
        status,
      });
      capturerErreurInattendue(exception, contexteSentry);
      const corps = construireCorps('ERREUR_INTERNE', 500, instance);
      reponse.status(500).contentType('application/problem+json').json(corps);
      return;
    }

    // Tout le reste (erreur de programmation, exception non typée…) : jamais exposé tel
    // quel. On journalise la vraie erreur, on renvoie un ERREUR_INTERNE générique.
    this.journal.error('Exception non typée capturée par FiltreProbleme', exception, {
      requeteId: instance,
      ...causeTechnique(exception),
    });
    capturerErreurInattendue(exception, contexteSentry);
    const corps = construireCorps('ERREUR_INTERNE', 500, instance);
    reponse.status(500).contentType('application/problem+json').json(corps);
  }
}
