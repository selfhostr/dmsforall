/**
 * Échéance de paiement (RF-04/PF-04, MD-94) et indicateur de retard — calculs PURS, sans accès
 * base, réutilisés à l'émission (`service-emission.ts`, qui FIGE `date_echeance` au moment où la
 * facture devient verrouillée, MD-20/MD-24 : jamais recalculée après), à la lecture (`mappeurs.ts`,
 * pour dériver `enRetard`/`joursRetard` à chaque réponse, sans jamais les stocker) et au filtre de
 * liste (`service-documents.ts::lister`, filtre `enRetard` — MÊME règle, traduite en SQL plutôt
 * qu'appliquée en JS, voir la note de `calculerRetardDocument` sur `statut`).
 *
 * RÈGLE MÉTIER RETENUE, établie AVANT ce code (voir la docstring de `lireDelaiPaiementJoursFige`
 * pour ce qui la fonde) : l'échéance d'une facture suisse = sa `dateDocument` + un délai NET en
 * JOURS CALENDAIRES (pas ouvrés — pratique standard « net 30 »), délai lu PRIORITAIREMENT sur les
 * conditions de paiement du CLIENT figées à la création du document
 * (`document_vente.conditions_paiement_figees` → `client_condition.delai_paiement_jours`,
 * `docs/modele-documentaire-facturation.md` §7.2 AC-12, §10.1 PF-04). Aucun texte libre n'est
 * jamais analysé.
 *
 * ISSUE #17, RÉSOLUE PAR LA MIGRATION 0046 — DÉCISION ARBITRÉE SANS LE MAINTENEUR (voir l'en-tête de cette
 * migration pour la justification complète et le chemin de retour arrière) : PF-04 documente
 * aussi un délai par défaut TENANT (« 30 jours net, sans escompte »), qu'AUCUNE table ne portait
 * jusqu'ici — un client créé sans conditions commerciales (chemin par défaut du formulaire
 * standard) n'avait donc JAMAIS d'échéance, et restait invisible aux relances automatiques
 * (`relances/regles-planification.ts`, qui calcule chaque palier depuis `date_echeance`).
 * `tenant.delai_paiement_jours_defaut` (colonne `not null default 30`) porte maintenant ce
 * réglage — {@link resoudreDelaiPaiementJours} ci-dessous applique la priorité : le délai du
 * CLIENT, quand il existe, l'emporte TOUJOURS ; le défaut tenant n'intervient qu'en son absence
 * totale, jamais en écrasement d'une valeur client déjà connue (y compris `0`, « payable à
 * réception » — voir `lireDelaiPaiementJoursFige`, qui distingue déjà explicitement `0` de
 * « absent »).
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
 * Résout le délai de paiement à appliquer (issue #17, migration 0046) : celui du CLIENT s'il
 * existe (`delaiClientFige`, déjà lu par {@link lireDelaiPaiementJoursFige} — `0` est une valeur
 * légitime, PAS un « absent »), sinon le défaut du TENANT (`delaiTenantDefaut`,
 * `tenant.delai_paiement_jours_defaut`). `null` seulement si NI L'UN NI L'AUTRE n'est déterminable
 * — cas résiduel (tenant introuvable dans la transaction), jamais le chemin normal depuis que la
 * colonne tenant est `not null default 30`.
 *
 * Fonction PURE délibérément séparée de {@link calculerDateEcheance} : le repli tenant est une
 * règle de RÉSOLUTION de délai, la conversion en date est un calcul de CALENDRIER — deux
 * responsabilités, deux fonctions testables indépendamment.
 */
export function resoudreDelaiPaiementJours(
  delaiClientFige: number | null,
  delaiTenantDefaut: number | null,
): number | null {
  return delaiClientFige ?? delaiTenantDefaut;
}

/**
 * `dateDocument` (`YYYY-MM-DD`, date MÉTIER/LÉGALE — jamais un horodatage serveur, voir le
 * commentaire de `ReponseDocumentVente.dateDocument`) + `delaiPaiementJours` jours CALENDAIRES.
 * `null` si `delaiPaiementJours` est `null` (aucun délai de paiement — ni client, ni défaut
 * tenant — n'a pu être déterminé) : ne fabrique JAMAIS une échéance plausible à partir d'une
 * valeur par défaut codée en dur côté application (voir l'en-tête de ce fichier — le seul défaut
 * qui existe désormais est en BASE, `tenant.delai_paiement_jours_defaut`, paramétrable, pas un
 * littéral TypeScript).
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
 * Indicateur de retard (colonne « Retard » de l'écran liste des factures) : en retard ⟺ le document
 * est une FACTURE encore `statut = 'emis'`, une échéance existe, elle est STRICTEMENT dépassée à
 * l'instant `maintenant`, ET il reste un solde à encaisser (`soldeCentimes > 0` — jamais négatif,
 * `RF-67` : le trop-perçu vit sur le paiement, pas sur le document). Une facture soldée n'est JAMAIS
 * « en retard » même après son échéance ; une facture sans échéance connue (`dateEcheance = null`)
 * ne l'est jamais non plus — silence plutôt que fausse alerte, même doctrine que
 * `calculerDateEcheance`. Échéance = aujourd'hui : PAS en retard (comparaison stricte `<`, pas
 * `<=` — le client a jusqu'à la fin du jour d'échéance).
 *
 * `statut` DOIT être vérifié explicitement : `date_echeance` est FIGÉE à l'émission et
 * `solde_centimes` n'est dérivé QUE de `imputation_paiement` (paiements réels) — ni l'un ni l'autre
 * n'est nettoyé quand une facture bascule `annule_par_avoir` (RF-32, `service-emission.ts` §6, qui ne
 * touche que `statut`/`annuleParAvoirId`). Sans cette vérification, une facture annulée par avoir,
 * jamais payée, dont l'échéance d'origine est dépassée, resterait « en retard » pour un montant qui
 * n'est plus dû — même garde, pour la même raison, que
 * `relances/regles-planification.ts::factureEligibleRelance`, dont c'est explicitement le rôle
 * (voir son commentaire). Un `devis`/`bon_commande`/`avoir` a de toute façon toujours
 * `dateEcheance = null` (RF-04) : la vérification de `statut` ne change rien pour ces types, elle ne
 * couvre que le cas `facture` + `annule_par_avoir`.
 */
export function calculerRetardDocument(params: {
  readonly statut: string;
  readonly dateEcheance: string | null;
  readonly soldeCentimes: number;
  readonly maintenant: Date;
}): RetardDocument {
  const { statut, dateEcheance, soldeCentimes, maintenant } = params;
  if (statut !== 'emis' || dateEcheance === null || soldeCentimes <= 0) {
    return { enRetard: false, joursRetard: null };
  }

  const aujourdHui = maintenant.toISOString().slice(0, 10);
  if (dateEcheance >= aujourdHui) return { enRetard: false, joursRetard: null };

  const joursRetard = Math.round(
    (Date.parse(`${aujourdHui}T00:00:00.000Z`) - Date.parse(`${dateEcheance}T00:00:00.000Z`)) /
      86_400_000,
  );
  return { enRetard: true, joursRetard };
}
