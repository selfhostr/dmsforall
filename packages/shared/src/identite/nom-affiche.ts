/**
 * Affichage des noms de personnes — point de vérité unique (API + web).
 * Convention retenue : « Prénom Nom » (« Urs Meier »). La casse saisie n'est jamais modifiée.
 * Le tri des listes reste par nom de famille puis prénom (côté SQL), indépendamment de ce rendu.
 */

export interface IdentitePersonne {
  readonly nom?: string | null;
  readonly prenom?: string | null;
}

export interface IdentiteClient extends IdentitePersonne {
  readonly type: 'particulier' | 'entreprise';
  readonly raisonSociale?: string | null;
}

/** « Prénom Nom » ; prénom absent ou blanc → nom seul ; chaque partie est trimée. */
export function formaterNomPersonne(personne: IdentitePersonne): string {
  return [personne.prenom, personne.nom]
    .map((valeur) => valeur?.trim())
    .filter((valeur): valeur is string => Boolean(valeur))
    .join(' ');
}

/** Entreprise → raison sociale inchangée (trimée) ; particulier → « Prénom Nom ». */
export function formaterNomClient(client: IdentiteClient): string {
  if (client.type === 'entreprise') {
    return (client.raisonSociale ?? '').trim();
  }
  return formaterNomPersonne(client);
}
