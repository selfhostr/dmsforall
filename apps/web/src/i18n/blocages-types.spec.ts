/**
 * `packages/shared/src/contrats/probleme.ts` documente `TYPES_ELEMENT_BLOQUANT` comme le
 * « miroir exact des clés `erreurs:blocages.<type>` » des trois `erreurs.json` — mais rien ne
 * gardait cette affirmation. Elle a déjà divergé une fois silencieusement (`document_vente` et
 * `ligne_document` ajoutés côté contrat sans leurs clés i18n).
 *
 * Ce test vérifie le sens qui casse réellement l'UI : chaque type émis par l'API doit avoir sa
 * traduction dans les trois langues, sinon `erreurs:blocages.<type>` s'affiche tel quel à
 * l'écran. Le sens inverse (clé i18n sans type dans le contrat) n'est volontairement pas gardé
 * ici : une clé en avance sur le contrat peut être légitime (type prévu, pas encore émis) et
 * relève d'un arbitrage métier, pas d'un défaut mécanique.
 */
import { describe, it, expect } from 'vitest';
import { TYPES_ELEMENT_BLOQUANT } from '@dfa/shared';

import frErreurs from './locales/fr/erreurs.json';
import deErreurs from './locales/de/erreurs.json';
import itErreurs from './locales/it/erreurs.json';

describe('Miroir TYPES_ELEMENT_BLOQUANT -> erreurs:blocages.<type>', () => {
  const langues = { fr: frErreurs, de: deErreurs, it: itErreurs } as const;
  const LANGUES_LISTE = Object.keys(langues) as Array<keyof typeof langues>;

  it.each(TYPES_ELEMENT_BLOQUANT)(
    'la clé blocages.%s existe dans erreurs.json pour fr, de et it',
    (type) => {
      const manquantes = LANGUES_LISTE.filter(
        (langue) => !(type in (langues[langue].blocages as Record<string, unknown>)),
      );

      expect(
        manquantes,
        `il manque blocages.${type} en ${manquantes.join(', ') || 'aucune langue (ne devrait pas s\'afficher)'}`,
      ).toHaveLength(0);
    },
  );
});
