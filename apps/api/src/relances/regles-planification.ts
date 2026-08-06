/**
 * Logique métier PURE des relances de facturation (rappel #2, Famille A) — aucune dépendance à
 * Nest, Drizzle ou une transaction : chaque fonction reçoit ses données déjà chargées et rend une
 * décision, jamais un accès base. C'est ce qui les rend testables en `--project unitaire` sans
 * base réelle (voir `regles-planification.spec.ts`) — `service-relances-facture.ts` est la SEULE
 * couche qui les enchaîne avec de vraies requêtes.
 *
 * `docs/specification-relances-automatiques.md` — RA-03, RA-05, RA-08, RA-11, RA-12, RA-14, §4.
 */

import type {
  CanalMessageClient,
  ContenuMessageClient,
  Langue,
  StatutDocumentVente,
  StatutReglementDocument,
} from '@dfa/shared';
import type { RaisonAnnulationRelance, StatutRelancePlanifiee } from '@dfa/shared';

/** Un palier configuré devenu dû à `maintenant` — sortie de `calculerPaliersDus`. */
export interface PalierDu {
  readonly palier: number;
  readonly echeancePrevue: Date;
}

/**
 * §4 : les paliers sont des jours après l'échéance de référence (`dateEcheance`, la date
 * d'échéance de LA FACTURE, pas la date d'émission). `delaisJours[0]` est le palier 1 — jamais un
 * tri implicite : l'ORDRE du tableau EST l'ordre des paliers (`regle_relance.delaisJours`, §5).
 *
 * PUR et déterministe : mêmes arguments ⇒ même résultat, exactement ce qu'exige l'idempotence de
 * la planification (§6.1) — la protection PHYSIQUE contre le double-insert reste la contrainte
 * unique en base (RA-05), cette fonction garantit seulement que deux appels calculent la MÊME
 * intention avant d'atteindre cette contrainte.
 */
export function calculerPaliersDus(
  dateEcheance: Date,
  delaisJours: readonly number[],
  maintenant: Date,
): readonly PalierDu[] {
  const resultat: PalierDu[] = [];
  delaisJours.forEach((jours, index) => {
    const echeancePrevue = new Date(dateEcheance.getTime() + jours * 24 * 60 * 60 * 1000);
    if (echeancePrevue.getTime() <= maintenant.getTime()) {
      resultat.push({ palier: index + 1, echeancePrevue });
    }
  });
  return resultat;
}

/** RA-08 — un dossier en contentieux ou déjà réglé sort du calcul, à la PLANIFICATION comme à
 *  L'EXÉCUTION (même fonction utilisée aux deux moments, voir `service-relances-facture.ts`) :
 *  « un dossier en contentieux revient au mandataire, pas à la relance amiable automatique ».
 *
 *  Inclut aussi `statut` (`StatutDocumentVente`) : seule une facture `emis` reste une cible de
 *  relance. Une facture `annule_par_avoir` (RF-32) ne touche ni `statutReglement` (reste
 *  `non_regle`) ni `dateEcheance` — sans cette vérification de `statut`, une facture annulée par
 *  avoir resterait indéfiniment éligible et continuerait à être relancée pour un montant qui
 *  n'est plus dû. Voir l'index partiel canonique du grand livre des débiteurs
 *  (`0010_facturation.sql`, condition `statut = 'emis'`) : même condition, ici dupliquée
 *  volontairement côté application (défense en profondeur : filtre SQL à la planification ET
 *  vérification pure à l'exécution, voir `verifierArretAutomatiqueFacture`). */
export function factureEligibleRelance(document: {
  readonly statut: StatutDocumentVente;
  readonly contentieux: boolean;
  readonly statutReglement: StatutReglementDocument | null;
}): boolean {
  return (
    document.statut === 'emis' && !document.contentieux && document.statutReglement !== 'regle'
  );
}

/** RA-14 — l'interrupteur « plus jamais aucun contact » prime sur tout, Famille A comprise. */
export function clientBloqueContact(client: { readonly plusAucunContact: boolean }): boolean {
  return client.plusAucunContact;
}

export interface CoordonneesClient {
  readonly email: string | null;
  readonly telephoneE164: string | null;
}

/**
 * RA-03 — retient le PREMIER canal de `canaux` (ordre de préférence du tenant, `regle_relance.
 * canaux`) pour lequel le client a une coordonnée valide. `null` si aucun canal configuré n'a de
 * coordonnée exploitable : « pas de coordonnée valide sur le canal ciblé → rappel jamais
 * planifié [envoyé]… jamais une erreur ». Famille A ne consulte JAMAIS `client_consentement`
 * (RA-01) — seule la coordonnée compte ici.
 */
export function choisirCanalEtDestinataire(
  canaux: readonly CanalMessageClient[],
  client: CoordonneesClient,
): { readonly canal: CanalMessageClient; readonly destinataire: string } | null {
  for (const canal of canaux) {
    if (canal === 'email' && client.email) {
      return { canal, destinataire: client.email };
    }
    if (canal === 'sms' && client.telephoneE164) {
      return { canal, destinataire: client.telephoneE164 };
    }
  }
  return null;
}

/** §8 : statut initial d'une ligne `relance_planifiee` fraîchement calculée — `prete` si une
 *  coordonnée exploitable existe déjà (transition immédiate « coordonnée/consentement OK »,
 *  Famille A n'ayant pas de consentement à vérifier), sinon `a_planifier` (visible dans le futur
 *  tableau « non planifiable », RA-03 — jamais une erreur). */
export function statutInitialPlanification(
  destinataireResolu: { readonly canal: CanalMessageClient; readonly destinataire: string } | null,
): Extract<StatutRelancePlanifiee, 'a_planifier' | 'prete'> {
  return destinataireResolu ? 'prete' : 'a_planifier';
}

/** Résultat d'une vérification d'arrêt automatique à l'exécution (RA-07/08/09/14) — `null` si
 *  rien ne s'oppose à l'envoi, une raison sinon. */
export type VerificationArret = { readonly raison: RaisonAnnulationRelance } | null;

/**
 * Vérification À L'EXÉCUTION (RA-08, RA-14), juste avant l'envoi effectif — le même document a
 * pu être réglé, annulé par avoir, ou le client a pu demander l'arrêt de tout contact, dans
 * l'intervalle entre la planification et l'envoi (cas de test §9 n°1 : « facture … payée le jour
 * du palier 3 … rien ne part »). Retourne la PREMIÈRE raison applicable ; RA-14 est vérifiée en
 * premier car elle « prime sur tout » (§9 cas n°8), y compris un dossier par ailleurs encore
 * éligible.
 *
 * `statut` couvre le cas d'une relance déjà `prete`/`a_planifier` dont la facture est annulée par
 * avoir ENTRE la planification et l'envoi (RF-32) : `factureEligibleRelance` rend alors `false`
 * (statut ≠ `emis`) et la raison rendue est `objet_traite`, cohérente avec les autres cas où le
 * dossier est déjà « traité » (contentieux, réglé) — pas une raison distincte.
 */
export function verifierArretAutomatiqueFacture(
  document: {
    readonly statut: StatutDocumentVente;
    readonly contentieux: boolean;
    readonly statutReglement: StatutReglementDocument | null;
  },
  client: { readonly plusAucunContact: boolean },
): VerificationArret {
  if (clientBloqueContact(client)) {
    return { raison: 'client_ne_plus_contacter' };
  }
  if (!factureEligibleRelance(document)) {
    return { raison: 'objet_traite' };
  }
  return null;
}

/**
 * Nombre maximal de TENTATIVES d'envoi pour une même ligne `relance_planifiee` avant de la
 * marquer `echouee` définitivement (§6.1, §8 : « echouee ─(retry)→ prete … (retry épuisés) →
 * echouee (définitif) »). Valeur fixe assumée en l'absence de toute table de paramétrage dédiée
 * dans ce lot — à rendre configurable par tenant le jour où un besoin réel l'exige (même réserve
 * que `DELAI_RELANCE_MOIS_DEFAUT`, `pneus/service-depot-pneus.ts`).
 */
export const NOMBRE_MAX_TENTATIVES_ENVOI = 3;

/** §8 : après un échec d'ENVOI (jamais un `annulee` — cette fonction ne s'applique qu'aux échecs
 *  transitoires côté connecteur), retour à `prete` s'il reste des tentatives, `echouee`
 *  (définitif) sinon. */
export function statutApresEchecEnvoi(
  tentative: number,
): Extract<StatutRelancePlanifiee, 'prete' | 'echouee'> {
  return tentative < NOMBRE_MAX_TENTATIVES_ENVOI ? 'prete' : 'echouee';
}

/** Formatage suisse (1'234.50) — jamais un float dans la logique de montant elle-même (les
 *  centimes restent des `bigint`/`number` entiers jusqu'ici), seulement dans le TEXTE affiché au
 *  client. Voir CONTRIBUTING.md : « formats 1'234.50 ». */
export function formaterMontantChf(centimes: number): string {
  const negatif = centimes < 0;
  const absolu = Math.abs(centimes);
  const entiers = Math.floor(absolu / 100);
  const centimesRestants = String(absolu % 100).padStart(2, '0');
  const entiersGroupes = entiers.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${negatif ? '-' : ''}${entiersGroupes}.${centimesRestants}`;
}

export interface ParametresContenuRappelFacture {
  readonly palier: number;
  readonly numero: string;
  readonly totalTtcCentimes: number;
  readonly soldeCentimes: number;
  readonly dateEcheance: Date;
  readonly langue: Langue;
  readonly canal: CanalMessageClient;
  readonly destinataire: string;
}

/**
 * RA-11 (langue lue à l'envoi) + RA-12 (contenu figé une fois construit) — textes minimaux FR/DE/
 * IT, PAS un moteur de gabarit (`regle_relance.texteModeleId` reste `null` tant qu'aucune table
 * de modèles n'existe, voir `contrats/relances/regle-relance.ts`). Une VALEUR ASSUMÉE de ce lot,
 * à confirmer avec @laupernoe : la spec ne fixe aucun texte, seulement le déclencheur et le canal.
 */
export function construireContenuRappelFacture(
  p: ParametresContenuRappelFacture,
): ContenuMessageClient {
  const montant = formaterMontantChf(p.soldeCentimes > 0 ? p.soldeCentimes : p.totalTtcCentimes);
  const dateEcheanceTexte = p.dateEcheance.toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const textes: Record<Langue, string> = {
    fr: `Rappel ${p.palier} : la facture ${p.numero} de CHF ${montant} est échue depuis le ${dateEcheanceTexte}. Merci de régulariser dans les meilleurs délais.`,
    de: `Mahnung ${p.palier}: Die Rechnung ${p.numero} über CHF ${montant} ist seit dem ${dateEcheanceTexte} fällig. Bitte begleichen Sie den Betrag umgehend.`,
    it: `Sollecito ${p.palier}: la fattura ${p.numero} di CHF ${montant} è scaduta dal ${dateEcheanceTexte}. Vi preghiamo di regolarizzare al più presto.`,
  };
  const texte = textes[p.langue];

  if (p.canal === 'sms') {
    return { canal: 'sms', destinataire: p.destinataire, texte };
  }
  const sujets: Record<Langue, string> = {
    fr: `Rappel de paiement — facture ${p.numero}`,
    de: `Zahlungserinnerung — Rechnung ${p.numero}`,
    it: `Sollecito di pagamento — fattura ${p.numero}`,
  };
  return {
    canal: 'email',
    destinataire: p.destinataire,
    sujet: sujets[p.langue],
    texte,
    html: null,
  };
}
