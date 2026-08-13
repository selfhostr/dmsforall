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
 * FORMAT DU NUMÉRO — DÉCISION TRANCHÉE (bug #104, production de démo) : `MD-03` exige `numero`
 * « composé depuis `numero_sequence` + préfixe + année » — la forme SANS préfixe précédemment
 * implémentée ici (`${exercice}-${numeroSequence}`) respectait déjà l'unicité EN BASE
 * (`document_vente_numero_uk` est scopé par `(tenant_id, type_document, numero)`, donc deux
 * lignes de types différents ne se confondent JAMAIS pour Postgres) mais produisait une
 * COLLISION D'AFFICHAGE : le premier devis, le premier bon de commande, la première facture et le
 * premier avoir d'un même exercice partagent tous la chaîne littérale `2026-00001` — un doublon
 * aux yeux d'un client, d'un garagiste ou d'une fiduciaire qui lit le numéro, même si les quatre
 * lignes DB sont parfaitement distinctes. Reproduit et confirmé (voir preuve d'exécution dans le
 * rapport de livraison de ce correctif).
 *
 * Un préfixe visible par type de document ferme ce trou, à l'identique du patron déjà en place
 * pour l'OR (`atelier/service-or.ts::genererNumero`, `parametre_atelier.or_prefixe`, défaut
 * `'OR'`) : `${PREFIXE}-${exercice}-${numeroSequence sur 5 chiffres}`, ex. `FAC-2026-00318`,
 * `AVO-2026-00301`, `BDC-2026-00412`, `DEV-2026-00001`. Contrairement à l'OR, ce préfixe n'est PAS
 * paramétrable par tenant : les quatre types de document sont un enum GELÉ
 * (`TYPES_DOCUMENT_VENTE`, `x-dfa-enum-extensible: false`), pas un référentiel ouvert au garagiste
 * — rien ne justifie une colonne `parametre_atelier` supplémentaire pour un préfixe qui ne peut
 * structurellement prendre que quatre valeurs connues à l'avance. D'où `PREFIXES_TYPE_DOCUMENT`
 * ci-dessous, une constante de code, pas une donnée de configuration.
 *
 * AUCUNE migration DB requise : ni `document_vente_numero_uk` ni `document_vente_sequence_uk`
 * (migration 0010 §7.4) ne dépendent de la FORME de la chaîne `numero`, seulement de son unicité
 * par tenant/type/exercice — déjà garantie avant ce correctif. Ce dernier ne change que la
 * composition de la string, jamais son rôle d'unicité.
 *
 * NE RENUMÉROTE AUCUN document déjà émis : cette fonction n'est appelée qu'à l'émission d'un
 * document encore `brouillon` (`service-emission.ts::emettre`, RF-22) — les documents déjà émis
 * avant ce correctif gardent leur `numero` historique sans préfixe, verrouillé (MD-20). Les
 * collisions déjà produites par ces documents restent à traiter séparément (voir le rapport de
 * livraison — option de resemencer les données de démo, jamais un `UPDATE` sur un document émis).
 */
const PREFIXES_TYPE_DOCUMENT: Readonly<Record<TypeDocumentVente, string>> = {
  devis: 'DEV',
  bon_commande: 'BDC',
  facture: 'FAC',
  avoir: 'AVO',
};

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
  const prefixe = PREFIXES_TYPE_DOCUMENT[typeDocument];
  const numero = `${prefixe}-${String(exercice)}-${String(numeroSequence).padStart(5, '0')}`;
  return { numero, numeroSequence, exercice };
}
