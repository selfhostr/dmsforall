/**
 * Échéance de paiement (RF-04/PF-04, MD-94) et indicateur de retard — calculs PURS, sans accès
 * base, réutilisés à l'émission (`service-emission.ts`, qui FIGE `date_echeance` au moment où la
 * facture devient verrouillée, MD-20/MD-24 : jamais recalculée après) et à la lecture
 * (`mappeurs.ts`, pour dériver `enRetard`/`joursRetard` à chaque réponse, sans jamais les stocker).
 *
 * RÈGLE MÉTIER RETENUE, établie AVANT ce code (voir la docstring de `lireDelaiPaiementJoursFige`
 * pour ce qui la fonde) : l'échéance d'une facture suisse = sa `dateDocument` + un délai NET en
 * JOURS CALENDAIRES (pas ouvrés — pratique standard « net 30 »), délai lu sur les conditions de
 * paiement du CLIENT figées à la création du document (`document_vente.conditions_paiement_figees`
 * → `client_condition.delai_paiement_jours`, `docs/modele-documentaire-facturation.md` §7.2 AC-12,
 * §10.1 PF-04). Aucun texte libre n'est jamais analysé : PF-04 documente aussi un délai par défaut
 * TENANT (« 30 jours net, sans escompte ») mais AUCUNE table ne le porte à ce jour
 * (`parametre_atelier`/`parametre_facturation` n'ont pas de colonne correspondante — vérifié,
 * absent du schéma) ; ce module ne l'invente donc pas et rend `null` plutôt qu'un « 30 jours »
 * codé en dur qui se prétendrait paramétrable alors qu'il ne l'est pas. Signalé à l'orchestrateur.
 *
 * Aucune fonction ici ne lit l'horloge elle-même : `maintenant` est toujours injecté par l'appelant
 * (même doctrine que `Horloge` partout ailleurs dans ce module) — un calcul de date doit rester
 * REJOUABLE en test, jamais dépendant de `Date.now()` en dur.
 */

/**
 * Lit `delaiPaiementJours` depuis les conditions de paiement FIGÉES d'un document
 * (`conditions_paiement_figees`, JSONB `not null default '{}'::jsonb`, SANS AUCUNE contrainte de
 * forme en base — voir le commentaire de `ValeursFigeesDocument.conditionsPaiement`,
 * `@dfa/shared`). Tolérant PAR CONSTRUCTION : tout ce qui n'est pas un entier ≥ 0 est traité comme
 * « absent » plutôt que de produire une échéance fabriquée à partir d'une donnée corrompue ou d'une
 * forme inattendue — cohérent avec la doctrine du dépôt rappelée dans la tâche : une échéance
 * FAUSSE est pire qu'une échéance ABSENTE. `0` est une valeur légitime (« payable à réception »,
 * échéance = date du document elle-même), donc explicitement acceptée, pas confondue avec absent.
 */
export function lireDelaiPaiementJoursFige(conditionsPaiementFigees: unknown): number | null {
  if (
    conditionsPaiementFigees === null ||
    typeof conditionsPaiementFigees !== 'object' ||
    Array.isArray(conditionsPaiementFigees)
  ) {
    return null;
  }
  const valeur = (conditionsPaiementFigees as Record<string, unknown>).delaiPaiementJours;
  if (typeof valeur !== 'number' || !Number.isInteger(valeur) || valeur < 0) return null;
  return valeur;
}

/**
 * `dateDocument` (`YYYY-MM-DD`, date MÉTIER/LÉGALE — jamais un horodatage serveur, voir le
 * commentaire de `ReponseDocumentVente.dateDocument`) + `delaiPaiementJours` jours CALENDAIRES.
 * `null` si `delaiPaiementJours` est `null` (aucun délai de paiement structuré n'a pu être déterminé
 * pour le client à la création du document) : ne fabrique JAMAIS une échéance plausible à partir
 * d'une valeur par défaut codée en dur (voir l'en-tête de ce fichier).
 */
export function calculerDateEcheance(
  dateDocument: string,
  delaiPaiementJours: number | null,
): string | null {
  if (delaiPaiementJours === null) return null;
  const base = new Date(`${dateDocument}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + delaiPaiementJours);
  return base.toISOString().slice(0, 10);
}

export interface RetardDocument {
  readonly enRetard: boolean;
  /** Entier strictement positif quand `enRetard`, sinon toujours `null` (jamais `0` : un document
   *  échu aujourd'hui même n'est pas encore « en retard », voir `calculerRetardDocument`). */
  readonly joursRetard: number | null;
}

/**
 * Indicateur de retard (colonne « Retard » de l'écran liste des factures) : en retard ⟺ une
 * échéance existe, elle est STRICTEMENT dépassée à l'instant `maintenant`, ET il reste un solde à
 * encaisser (`soldeCentimes > 0` — jamais négatif, `RF-67` : le trop-perçu vit sur le paiement, pas
 * sur le document). Une facture soldée n'est JAMAIS « en retard » même après son échéance ; une
 * facture sans échéance connue (`dateEcheance = null`) ne l'est jamais non plus — silence plutôt
 * que fausse alerte, même doctrine que `calculerDateEcheance`. Échéance = aujourd'hui : PAS en
 * retard (comparaison stricte `<`, pas `<=` — le client a jusqu'à la fin du jour d'échéance).
 */
export function calculerRetardDocument(params: {
  readonly dateEcheance: string | null;
  readonly soldeCentimes: number;
  readonly maintenant: Date;
}): RetardDocument {
  const { dateEcheance, soldeCentimes, maintenant } = params;
  if (dateEcheance === null || soldeCentimes <= 0) return { enRetard: false, joursRetard: null };

  const aujourdHui = maintenant.toISOString().slice(0, 10);
  if (dateEcheance >= aujourdHui) return { enRetard: false, joursRetard: null };

  const joursRetard = Math.round(
    (Date.parse(`${aujourdHui}T00:00:00.000Z`) - Date.parse(`${dateEcheance}T00:00:00.000Z`)) /
      86_400_000,
  );
  return { enRetard: true, joursRetard };
}
