/**
 * `ETag` faible d'un document de vente — sert la concurrence optimiste sur `PATCH
 * /documents-vente/{id}` et `PATCH .../lignes/{ligneId}` (brouillon uniquement, `MD-19`).
 *
 * ÉCART SIGNALÉ : `ordre_reparation` porte une colonne `version` dédiée, entier monotone
 * incrémenté par trigger sur les colonnes d'en-tête (`atelier/ordre-reparation.etag.ts`).
 * `document_vente` (migration `0010_facturation.sql` §7) N'A PAS cette colonne — vérifié : aucune
 * occurrence de `version` dans la définition de la table ni dans `db/schema/facturation/
 * document-vente.ts`. Le contrat gelé `ReponseDocumentVente.version` (`@dfa/shared`) l'exige
 * pourtant, non optionnel.
 *
 * Palliatif retenu ICI, à confirmer avec l'équipe base de données (une vraie colonne `version integer` est
 * la correction propre, migration additive hors du périmètre d'écriture de cette tâche) :
 * `version = modifie_le` en millisecondes epoch. `document_vente_touche_modifie_le` (trigger déjà
 * posé) garantit que `modifie_le` avance à CHAQUE `UPDATE`, y compris dans la fenêtre `brouillon`
 * où `PATCH` est autorisé — la propriété utile à la concurrence optimiste (« la valeur change à
 * chaque écriture, dans le même sens ») tient donc, même si ce n'est plus un compteur entier `+1`.
 * Une fois émis, le document est verrouillé (`MD-20`) : `modifie_le` ne bouge plus pour les colonnes
 * qui comptent, `version` reste donc stable pour un document émis — cohérent avec la doctrine
 * « un document émis ne change plus jamais de version au sens métier » du contrat.
 */
export function versionDocumentVente(modifieLe: Date): number {
  return modifieLe.getTime();
}

export function etagDocumentVente(modifieLe: Date): string {
  return `W/"${String(versionDocumentVente(modifieLe))}"`;
}

export function extraireVersionEtagDocument(ifMatch: string): number | null {
  const correspondance = /^W\/"(\d+)"$/.exec(ifMatch.trim());
  return correspondance?.[1] ? Number(correspondance[1]) : null;
}
