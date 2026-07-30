import type { TypeDocumentVente } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import type { ServiceCompteurs } from '../../parametrage/compteurs/compteurs.types';

/**
 * Numérotation continue par tenant/exercice (`RF-20`, `MD-32`) — réutilise `ServiceCompteurs`
 * (`compteur_document`, verrou de ligne en transaction) EXACTEMENT comme `atelier/service-or.ts`
 * réutilise le même service pour la clé `ordre_reparation`. Aucune séquence PostgreSQL, aucun
 * `SELECT max(numero) + 1` — voir la consigne de la tâche.
 *
 * Portée TOUJOURS `tenant` (`siteId: null`) : contrairement à `parametre_atelier.or_porteeNumerotation`
 * (portée `site` possible pour l'OR), aucune colonne équivalente n'existe pour la facturation
 * (migration 0010 §4 n'ajoute que `taux_tva_defaut_pourmille`/`arrondi_especes_actif` à
 * `parametre_atelier`) — RF-20 lui-même dit « par tenant et par exercice », sans mention de site.
 *
 * FORMAT DU NUMÉRO — DÉCISION SIGNALÉE, à confirmer avec expert-facturation/@laupernoe : `MD-03` dit
 * seulement que `numero` est « composé depuis `numero_sequence` + préfixe + année (`P-01`) », sans
 * jamais définir CE préfixe en base (contrairement à `parametre_atelier.or_prefixe` pour l'OR —
 * aucune colonne équivalente n'existe pour la facturation). Les exemples littéraux du modèle
 * documentaire (`MD-06`, `CF-01`, §9.7) montrent tous la forme SANS préfixe par type :
 * `2026-00318`, `2026-00301`, `2026-00412`. Cette fonction reproduit exactement cette forme,
 * `${exercice}-${numeroSequence sur 5 chiffres}`, pour LES QUATRE types de document — sans risque
 * de collision inter-séries puisque l'unicité de `numero` est scopée par `(tenant_id,
 * type_document, numero)` (`document_vente_numero_uk`, migration §7.4).
 */
export interface NumeroDocumentGenere {
  readonly numero: string;
  readonly numeroSequence: number;
  readonly exercice: number;
}

export async function genererNumeroDocument(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  compteurs: ServiceCompteurs,
  typeDocument: TypeDocumentVente,
  dateDocument: Date,
): Promise<NumeroDocumentGenere> {
  const exercice = dateDocument.getUTCFullYear();
  const numeroSequence = await compteurs.prochainNumero(tx, {
    tenantId: ctx.tenantId,
    typeDocument: `document_vente:${typeDocument}`,
    annee: exercice,
    siteId: null,
  });
  const numero = `${String(exercice)}-${String(numeroSequence).padStart(5, '0')}`;
  return { numero, numeroSequence, exercice };
}
