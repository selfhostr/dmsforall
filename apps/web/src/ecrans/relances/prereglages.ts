import type { EntreeUpsertRegleRelance } from '@dfa/shared';

/**
 * Préréglage recommandé du rappel de facture échue (§4 de la spec, « un clic »).
 *
 * SOURCE DE VÉRITÉ CÔTÉ FRONT, PAR NÉCESSITÉ — SIGNALÉ : le contrat
 * (`packages/shared/src/contrats/relances/regle-relance.ts`) renvoie vers
 * `apps/api/src/relances/regles-planification.ts::PREREGLAGES_RELANCE` pour les valeurs proposées,
 * mais cette constante N'EXISTE PAS dans le module livré (vérifié le 05.08.2026 : aucune occurrence
 * de `PREREGLAGE` dans `apps/api/src/relances/`), et le service d'upsert n'écrit pas
 * `prereglageAppliqueLe`. L'API n'expose donc aucune valeur de préréglage. Ces délais sont un
 * choix métier raisonnable pour un garage suisse (1er rappel, 2e rappel, sommation), défini ici en
 * attendant que le serveur porte la référence — appliqués via le même `PUT /relances/regles/...`
 * que la modification manuelle (§4 : « pas un mode magique séparé »), donc entièrement modifiables
 * ensuite. §4 ne fixe pas de valeur pour la facture (contrairement à devis/pneus/MFK) : ce choix
 * assume ce vide sans inventer une donnée serveur.
 *
 * `PALIERS_PREREGLAGE_FACTURE` est exporté séparément pour que le libellé i18n du bouton
 * (« 1er rappel à 10 jours… ») interpole ces mêmes nombres, sans les recopier dans la traduction.
 */
export const PALIERS_PREREGLAGE_FACTURE = [10, 20, 30] as const;

export const PREREGLAGE_FACTURE_ECHUE: EntreeUpsertRegleRelance = {
  actif: true,
  delaisJours: [...PALIERS_PREREGLAGE_FACTURE],
  canaux: ['email'],
};
