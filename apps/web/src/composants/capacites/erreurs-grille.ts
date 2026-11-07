import type { TFunction } from 'i18next';

import { depassementsDeGrille, type GrilleCapacites } from '@dfa/shared';

import { ErreurApi, messageErreurChamp } from '@/api/erreurs';

const CHAMPS_GRILLE = /^(niveaux\.[a-z]+|encadrer|gererEmployes|options\.[A-Za-z]+)$/;

/** Erreurs du serveur (403 `erreurs[].champ`) rangées par champ de la grille. */
export function erreursGrilleDuServeur(erreur: unknown, t: TFunction): Record<string, string> {
  const resultat: Record<string, string> = {};
  if (!(erreur instanceof ErreurApi)) return resultat;
  for (const ec of erreur.erreursChamp) {
    if (CHAMPS_GRILLE.test(ec.champ)) resultat[ec.champ] = messageErreurChamp(ec, t);
  }
  return resultat;
}

/** `true` si l'erreur porte au moins un champ de la grille (le bandeau général est alors superflu). */
export function erreurPorteSurLaGrille(erreur: unknown): boolean {
  return (
    erreur instanceof ErreurApi && erreur.erreursChamp.some((ec) => CHAMPS_GRILLE.test(ec.champ))
  );
}

/** Dépassements détectés avant l'envoi : « on ne coche pas ce qu'on n'a pas soi-même ». */
export function depassementsAvantEnvoi(
  acteur: GrilleCapacites | undefined,
  cible: GrilleCapacites | undefined,
  t: TFunction,
): Record<string, string> {
  const resultat: Record<string, string> = {};
  if (!acteur || !cible) return resultat;
  for (const champ of depassementsDeGrille(acteur, cible)) {
    if (CHAMPS_GRILLE.test(champ)) resultat[champ] = t('capacites:editeur.incoherence.depassement');
  }
  return resultat;
}
