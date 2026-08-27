/**
 * Contenu du courriel « voici votre facture » (`POST /documents-vente/{id}/envoyer-courriel`,
 * déclenché par un utilisateur habilité). MÊME DOCTRINE que
 * `relances/regles-planification.ts::construireContenuRappelFacture` (modèle) : textes minimaux
 * FR/DE/IT écrits en dur, PAS un moteur de gabarit (`regle_relance.texteModeleId` reste `null`,
 * aucune table de modèles n'existe — hors périmètre de cette tâche). Dupliqué ici plutôt
 * qu'importé depuis `relances/` : aucune dépendance de compilation entre modules d'experts
 * parallèles (même doctrine que `enumerer-tenants-actifs-relances.ts` vis-à-vis de
 * `enumerer-tenants-actifs-pointage.ts`), et le texte lui-même diffère (pas un rappel d'échéance,
 * l'envoi initial de la facture).
 *
 * Langue : `document.clientLangue`, FIGÉE À L'ÉMISSION (`facturation/documents/mappeurs.ts`) —
 * jamais une relecture de la fiche client courante, même doctrine que le reste d'un document émis
 * (« un document émis ne va rien chercher ailleurs pour s'afficher »,
 * `packages/shared/src/contrats/facturation/document.ts`).
 */
import type { Langue } from '@dfa/shared';

export interface ParametresContenuEnvoiFacture {
  readonly numero: string;
  /** `undefined` si le principal n'a pas le droit de voir les montants — ne devrait jamais se
   *  produire ici (même droit `facturation.document.imprimer` que la génération du PDF lui-même,
   *  voir `roleVoitLesMontants`), mais le texte reste correct sans montant plutôt que de planter. */
  readonly totalTtcCentimes: number | undefined;
  readonly langue: Langue;
}

function formaterMontantChf(centimes: number): string {
  const entiers = Math.floor(centimes / 100);
  const centimesRestants = String(centimes % 100).padStart(2, '0');
  const entiersGroupes = entiers.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${entiersGroupes}.${centimesRestants}`;
}

export interface ContenuEnvoiFacture {
  readonly sujet: string;
  readonly texte: string;
}

export function construireContenuEnvoiFacture(
  p: ParametresContenuEnvoiFacture,
): ContenuEnvoiFacture {
  const montant = p.totalTtcCentimes !== undefined ? formaterMontantChf(p.totalTtcCentimes) : null;

  const sujets: Record<Langue, string> = {
    fr: `Facture ${p.numero}`,
    de: `Rechnung ${p.numero}`,
    it: `Fattura ${p.numero}`,
  };

  const textesAvecMontant: Record<Langue, string> = {
    fr: `Veuillez trouver ci-joint la facture ${p.numero}, d'un montant de CHF ${montant ?? ''}.`,
    de: `Anbei erhalten Sie die Rechnung ${p.numero} über CHF ${montant ?? ''}.`,
    it: `In allegato trovate la fattura ${p.numero}, di importo CHF ${montant ?? ''}.`,
  };
  const textesSansMontant: Record<Langue, string> = {
    fr: `Veuillez trouver ci-joint la facture ${p.numero}.`,
    de: `Anbei erhalten Sie die Rechnung ${p.numero}.`,
    it: `In allegato trovate la fattura ${p.numero}.`,
  };

  return {
    sujet: sujets[p.langue],
    texte: (montant !== null ? textesAvecMontant : textesSansMontant)[p.langue],
  };
}
