import { z } from 'zod';

import { schemaDateJour, schemaIdentifiant } from '../atelier/primitives';

/**
 * Filtre commun aux deux endpoints du tableau de bord (`GET /tableau-bord/activite`,
 * `GET /tableau-bord/financier`) — voir `contrats/tableau-bord/index.ts` pour le contexte général.
 *
 * `du`/`au` OPTIONNELS, bornes INCLUSES : absents, le serveur retient le **mois civil UTC
 * courant** (1er du mois → aujourd'hui, tous deux en UTC) — voir `resoudrePeriodeTableauBord`
 * côté API (`apps/api/src/tableau-bord/periode.ts`) pour l'implémentation exacte. Choix motivé :
 * un garagiste consulte ce tableau au quotidien, un jour seul est trop bruyant pour juger
 * l'activité (surtout un petit garage), une année entière dilue le sens de « aujourd'hui » — le
 * mois est le rythme métier naturel (planning, relances, rapprochement).
 *
 * `siteId` OPTIONNEL : absent, les indicateurs agrègent TOUS les sites du tenant ; présent,
 * restreint à ce site. Aucune vérification que `siteId` appartienne au tenant courant n'est faite
 * ICI — `tenant_id` est de toute façon posé sur CHAQUE sous-requête (RLS + scoping explicite,
 * CONTRIBUTING.md), un `siteId` étranger au tenant ne peut donc jamais faire fuir une seule ligne, il
 * rend simplement des indicateurs à zéro (comportement sûr, pas un 404 — cohérent avec le principe
 * « période vide = zéro, jamais une erreur »).
 */
export const schemaFiltreTableauBord = z
  .object({
    siteId: schemaIdentifiant.optional(),
    du: schemaDateJour.optional(),
    au: schemaDateJour.optional(),
  })
  .refine((valeur) => !valeur.du || !valeur.au || valeur.du <= valeur.au, {
    message: '`du` doit être antérieur ou égal à `au`.',
    path: ['du'],
  });
export type FiltreTableauBord = z.infer<typeof schemaFiltreTableauBord>;

/** Période EFFECTIVEMENT appliquée, toujours renvoyée en écho dans la réponse (bornes résolues,
 *  même si `du`/`au` étaient absents de la requête — le client ne doit jamais avoir à deviner ce
 *  que le serveur a choisi par défaut). */
export interface PeriodeResolueTableauBord {
  readonly du: string;
  readonly au: string;
}
