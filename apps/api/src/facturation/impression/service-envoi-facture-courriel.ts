/**
 * `POST /documents-vente/{id}/envoyer-courriel` — envoi RÉEL de la facture par courriel, PDF en
 * pièce jointe, déclenché par un UTILISATEUR habilité (`PrincipalAuthentifie` réel — à la
 * différence du job de relances, `relances/service-relances-facture.ts`, qui lit un PDF déjà en
 * cache SANS principal). RF-116 est ici respecté au sens plein : `ServiceDocumentsVente.
 * obtenirComplet` ET `ServiceImpressionFacture.obtenirPdf` appliquent tous deux le masquage par
 * rôle (`roleVoitLesMontants`), et `ServiceImpressionFacture.obtenirPdf` génère PARESSEUSEMENT le
 * PDF s'il n'existe pas encore en cache — CONTRAIREMENT au job de relances, ce service peut donc
 * se permettre de toujours produire un PDF pour une facture émise éligible, jamais d'« anomalie
 * PDF manquant » à gérer ici (elle est déjà couverte par `obtenirPdf`, y compris son garde-fou
 * d'intégrité SHA-256).
 *
 * DEUX ANOMALIES EXPLICITES (arbitrage du coordinateur, rapport de livraison) :
 *   1. document pas éligible (pas une facture émise avec bulletin QR) → `DOCUMENT_PDF_
 *      INDISPONIBLE` (409), déjà levé par `ServiceImpressionFacture.obtenirPdf` — rien à ajouter.
 *   2. client sans adresse courriel enregistrée → `FACTURE_DESTINATAIRE_COURRIEL_ABSENT` (409),
 *      levé ICI avant tout envoi : rien ne garantit que `client.email` soit renseigné.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Langue } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { ServiceCourriel } from '../../courriel/service-courriel';
import { EXPEDITEUR_DFA_PAR_DEFAUT } from '../../courriel/config-courriel';
import { JETON_CONFIG, type Config } from '../../config';

import { ServiceDocumentsVente } from '../documents/service-documents';
import { construireContenuEnvoiFacture } from './contenu-envoi-facture-courriel';
import { ServiceImpressionFacture } from './service-impression-facture';

export interface ReponseEnvoiFactureCourriel {
  readonly envoye: boolean;
  readonly destinataire: string;
  readonly idMessage: string;
}

/** Voir `relances/service-relances-facture.ts::resoudreExpediteurGarage` — MÊME requête,
 *  dupliquée exprès (aucune dépendance de compilation entre modules d'experts parallèles). */
interface LigneDestinataireEtGarage {
  readonly [cle: string]: unknown;
  readonly clientEmail: string | null;
  readonly raisonSociale: string;
  readonly emailContactGarage: string | null;
}

@Injectable()
export class ServiceEnvoiFactureCourriel {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly serviceDocuments: ServiceDocumentsVente,
    private readonly serviceImpression: ServiceImpressionFacture,
    private readonly serviceCourriel: ServiceCourriel,
    @Inject(JETON_CONFIG) private readonly config: Config,
  ) {}

  async envoyer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
  ): Promise<ReponseEnvoiFactureCourriel> {
    // Droits (RF-116) + éligibilité (facture émise avec bulletin QR) : `obtenirComplet` masque
    // les montants selon le rôle, `obtenirPdf` refuse `DOCUMENT_PDF_INDISPONIBLE` sinon — même
    // portillon déclaratif que `GET .../pdf` (`@ExigerDroit('facturation.document.imprimer')` sur
    // la route, voir `impression-facture.controller.ts`).
    const document = await this.serviceDocuments.obtenirComplet(ctx, principal, documentId);
    const { buffer, nomFichier } = await this.serviceImpression.obtenirPdf(
      ctx,
      principal,
      documentId,
    );

    const { clientEmail, nomGarage, adresseReponseGarage } =
      await this.resoudreDestinataireEtGarage(ctx, document.clientId);

    if (!clientEmail) {
      throw new ErreurMetier(
        'FACTURE_DESTINATAIRE_COURRIEL_ABSENT',
        `Le client ${document.figees.clientDesignation} n'a pas d'adresse courriel enregistrée ` +
          `— impossible d'envoyer la facture ${document.numero ?? documentId} par ce canal.`,
      );
    }

    const contenu = construireContenuEnvoiFacture({
      numero: document.numero ?? documentId,
      totalTtcCentimes: document.totalTtcCentimes,
      langue: document.figees.clientLangue as Langue,
    });

    const resultat = await this.serviceCourriel.envoyer({
      destinataires: [clientEmail],
      sujet: contenu.sujet,
      corpsTexte: contenu.texte,
      nomGarage,
      adresseReponseGarage,
      piecesJointes: [{ nomFichier, contenu: buffer, typeMime: 'application/pdf' }],
    });

    if (!resultat.succes) {
      // Action SYNCHRONE déclenchée par un humain qui attend une réponse immédiate — contrairement
      // au job de relances (retenté au prochain passage), rien ne rejoue cet envoi automatiquement
      // si on rend un succès silencieux : refuser plutôt que de laisser croire que la facture est
      // partie.
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        `Échec de l'envoi du courriel pour la facture ${document.numero ?? documentId}.`,
        { detail: resultat.erreur },
      );
    }

    return {
      envoye: true,
      destinataire: clientEmail,
      idMessage: resultat.idMessage ?? '',
    };
  }

  /** Voir `relances/service-relances-facture.ts::resoudreExpediteurGarage` pour la doctrine
   *  complète du repli `adresseReponseGarage` (aucun champ dédié « adresse de contact du garage »
   *  n'existe encore dans le modèle de données — arbitrage signalé, pas une donnée stable). */
  private async resoudreDestinataireEtGarage(
    ctx: ContexteTenant,
    clientId: string,
  ): Promise<{ clientEmail: string | null; nomGarage: string; adresseReponseGarage: string }> {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneDestinataireEtGarage>(sql`
        select
          c.email as "clientEmail",
          t.raison_sociale as "raisonSociale",
          (
            select u.email
              from public.utilisateur u
             where u.tenant_id = t.id
               and u.statut = 'actif'
               and u.role in ('direction', 'comptable')
             order by (u.role = 'direction') desc, u.cree_le asc
             limit 1
          ) as "emailContactGarage"
        from public.tenant t
        join public.client c on c.tenant_id = t.id and c.id = ${clientId}
        where t.id = ${ctx.tenantId}
      `);
      const ligne = resultat.rows[0];
      /* c8 ignore next 3 -- invariant : `clientId` provient de `document.clientId`, une FK
       * garantie existante (voir `packages/shared/src/contrats/facturation/document.ts`). */
      if (!ligne) {
        throw new Error(
          `tenant ${ctx.tenantId} / client ${clientId} introuvable (invariant rompu).`,
        );
      }
      return {
        clientEmail: ligne.clientEmail,
        nomGarage: ligne.raisonSociale,
        adresseReponseGarage:
          ligne.emailContactGarage ?? this.config.SMTP_EXPEDITEUR ?? EXPEDITEUR_DFA_PAR_DEFAUT,
      };
    });
  }
}
