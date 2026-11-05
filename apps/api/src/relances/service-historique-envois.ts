import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  RAISONS_REJET_MESSAGE_CLIENT,
  type PageCurseur,
  type RaisonRejetMessageClient,
  type ReponseRelanceEnvoi,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { JETON_DB } from '../db';
import { ErreurMetier } from '../common/erreurs';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';

import type { ParametresListeHistoriqueEnvois } from './schemas';

/** Tri fixe de cette collection — aucun `tri` exposé au contrat, voir `schemas.ts`. */
const TRI_HISTORIQUE_ENVOIS = 'envoyeLe:desc';

interface LigneHistoriqueEnvoiBrute {
  readonly [cle: string]: unknown;
  readonly id: string;
  readonly factureId: string;
  readonly factureNumero: string | null;
  readonly palier: number;
  readonly canal: string;
  readonly destinataire: string;
  readonly statutEnvoi: string;
  readonly erreur: string | null;
  readonly envoyeLeTexte: string;
}

/**
 * Même défaut corrigé que `decoderCurseurSousCollection`
 * (`clients/service-client-sous-collections.ts`) : jamais un `Date` JS pour un seuil de curseur
 * sur `timestamptz` (perte de microseconde), toujours le texte natif PostgreSQL — voir
 * `common/pagination/valeur-temporelle.ts`.
 */
function decoderCurseurHistorique(curseur: string): {
  readonly envoyeLeTexte: string;
  readonly id: string;
} {
  const donnees = decoderCurseurTrie(curseur, TRI_HISTORIQUE_ENVOIS, 'temporel');
  if (typeof donnees.valeur !== 'string') {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return { envoyeLeTexte: donnees.valeur, id: donnees.id };
}

/**
 * `relance_envoi.erreur` est stocké `"${raison}: ${message}"`
 * (`service-relances-facture.ts::enregistrerIssueEnvoi`) — `raison` est TOUJOURS l'un des quatre
 * codes fermés `RaisonRejetMessageClient` (le seul autre point d'écriture, la branche `catch` de
 * `traiterUneRelance`, retombe elle aussi sur `'quota_depasse'`). Rend `null` si le préfixe ne
 * correspond à aucun code connu — défensif, jamais un plantage d'affichage pour une ligne dont le
 * format aurait divergé ; le front retombe alors sur un libellé générique (voir
 * `relances:tracabilite.raisons.inconnue`).
 */
function analyserRaisonEchec(erreurTexte: string | null): RaisonRejetMessageClient | null {
  if (erreurTexte === null) return null;
  const prefixe = erreurTexte.split(': ')[0] ?? '';
  return (RAISONS_REJET_MESSAGE_CLIENT as readonly string[]).includes(prefixe)
    ? (prefixe as RaisonRejetMessageClient)
    : null;
}

function versReponse(ligne: LigneHistoriqueEnvoiBrute): ReponseRelanceEnvoi {
  return {
    id: ligne.id,
    factureId: ligne.factureId,
    factureNumero: ligne.factureNumero,
    palier: ligne.palier,
    canal: ligne.canal as ReponseRelanceEnvoi['canal'],
    destinataire: ligne.destinataire,
    statutEnvoi: ligne.statutEnvoi as ReponseRelanceEnvoi['statutEnvoi'],
    raisonEchec: analyserRaisonEchec(ligne.erreur),
    envoyeLe: ligne.envoyeLeTexte,
  };
}

/**
 * Historique d'envoi des relances de facture (issue #136) — LECTURE SEULE sur `relance_envoi`,
 * append-only, posée par `apps/api/src/db/migrations/0045_relances_socle.sql`. AUCUNE migration
 * nouvelle pour cette issue : la trace existait déjà en base (une ligne par tentative, RLS déjà
 * en place) — seul le listing manquait, voir le rapport de livraison qui accompagne ce fichier.
 *
 * Pièce de dossier pour le comptable, pas un journal technique (décision de conception, 14.08.2026) :
 * une ligne par relance PARTIE, avec sa date, son palier, le destinataire réellement touché
 * (figé, `relance_envoi.destinataire_fige`) et son résultat. Le contenu du message envoyé
 * (`relance_envoi.contenu_fige`) n'est délibérément jamais exposé — voir le contrat
 * `ReponseRelanceEnvoi` (`@dfa/shared`).
 *
 * Vérifier qu'une facture annulée par avoir n'est plus jamais relancée (raison d'être de l'issue
 * #136) se lit directement dans ce listing : `traiterUneRelance` (`service-relances-facture.ts`)
 * n'écrit JAMAIS de ligne `relance_envoi` pour une occasion arrêtée par
 * `verifierArretAutomatiqueFacture` (RA-08/RA-14) — la ligne passe à `relance_planifiee.statut =
 * 'annulee'` sans jamais atteindre `enregistrerIssueEnvoi`. Un comptable qui filtre par facture
 * (`factureId`) et compare la dernière ligne à la date de l'avoir constate donc directement
 * l'absence de toute tentative postérieure — voir `service-historique-envois.spec.ts`.
 */
@Injectable()
export class ServiceHistoriqueEnvoisRelance {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    params: ParametresListeHistoriqueEnvois,
  ): Promise<PageCurseur<ReponseRelanceEnvoi>> {
    const curseurDecode = params.curseur ? decoderCurseurHistorique(params.curseur) : null;

    return this.acces.enTenant(ctx, async (tx) => {
      // `factureId` FACULTATIF (voir `schemas.ts`) : absent, l'historique complet du tenant ;
      // fourni, filtré sur cette seule facture. Un identifiant qui ne correspond à AUCUNE
      // occasion planifiée de ce tenant doit rendre une page VIDE, jamais tout l'historique — le
      // filtre porte sur `rp.objet_id`, appliqué AVANT la limite, jamais laissé de côté.
      const conditionFacture = params.factureId
        ? sql`and rp.objet_id = ${params.factureId}`
        : sql``;
      const conditionCurseur = curseurDecode
        ? sql`and (re.envoye_le, re.id) < (${curseurDecode.envoyeLeTexte}::timestamptz, ${curseurDecode.id})`
        : sql``;

      const resultat = await tx.execute<LigneHistoriqueEnvoiBrute>(sql`
        select
          re.id::text as "id",
          rp.objet_id::text as "factureId",
          dv.numero as "factureNumero",
          rp.palier as "palier",
          re.canal::text as "canal",
          re.destinataire_fige as "destinataire",
          re.statut_envoi::text as "statutEnvoi",
          re.erreur as "erreur",
          re.envoye_le::text as "envoyeLeTexte"
        from public.relance_envoi re
        join public.relance_planifiee rp
          on rp.tenant_id = re.tenant_id and rp.id = re.relance_planifiee_id
        left join public.document_vente dv
          on dv.tenant_id = rp.tenant_id and dv.id = rp.objet_id
        where re.tenant_id = ${ctx.tenantId}
          -- Seul facture_echue/document_vente a une implementation d'envoi a ce jour (voir
          -- service-relances-facture.ts) : filtre defensif, a revoir si un futur lot fait
          -- transiter un autre type_relance par relance_envoi avec objet_type =
          -- 'document_vente'.
          and rp.type_relance = 'facture_echue'
          and rp.objet_type = 'document_vente'
          ${conditionFacture}
          ${conditionCurseur}
        order by re.envoye_le desc, re.id desc
        limit ${params.limite + 1}
      `);

      const lignes = resultat.rows;
      const aUnePageSuivante = lignes.length > params.limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, params.limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map(versReponse),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: TRI_HISTORIQUE_ENVOIS,
                valeur: valeurCurseurTimestamptz(derniere.envoyeLeTexte),
                id: derniere.id,
              })
            : null,
        limite: params.limite,
      };
    });
  }
}
