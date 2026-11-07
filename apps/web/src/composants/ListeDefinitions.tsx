import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ElementDefinition {
  /** Clé stable (jamais l'index). */
  readonly cle: string;
  readonly libelle: ReactNode;
  readonly valeur: ReactNode;
  /** Identifiant long (IBAN, VIN, référence QR) : police mono, coupure à n'importe quel
   *  caractère. */
  readonly mono?: boolean;
  /** Prend toute la ligne de la grille (valeur longue, ex. adresse). */
  readonly pleineLargeur?: boolean;
}

interface Props {
  readonly elements: readonly ElementDefinition[];
  /** Nombre de colonnes à partir de la largeur `sm` : 2 à 4 (défaut 3). Une colonne en dessous. */
  readonly colonnes?: 2 | 3 | 4;
  readonly className?: string;
}

const CLASSES_COLONNES = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const;

/**
 * Liste de définitions (libellé / valeur) sur une grille stable. Chaque paire `dt`/`dd` est
 * ENVELOPPÉE dans sa propre `div` : sans enveloppe, une grille place les `dt` et les `dd` comme
 * autant de cellules indépendantes et les valeurs se retrouvent dans la mauvaise colonne (défaut
 * relevé sur la fiche OR, le dossier de vente et le bulletin de versement). Les valeurs longues
 * se coupent proprement (`break-words`, `min-w-0`) au lieu de déborder de la carte.
 *
 * Valeur absente : passer `null`/`undefined` rend un tiret long, jamais une cellule vide — « pas
 * de donnée » reste lisible.
 */
export function ListeDefinitions({ elements, colonnes = 3, className }: Props) {
  return (
    <dl className={cn('grid gap-x-4 gap-y-3 texte-corps', CLASSES_COLONNES[colonnes], className)}>
      {elements.map((element) => (
        <div
          key={element.cle}
          className={cn('min-w-0', element.pleineLargeur && 'sm:col-span-full')}
        >
          <dt className="texte-libelle text-muted-foreground">{element.libelle}</dt>
          <dd className={cn('min-w-0 break-words', element.mono && 'break-all font-mono')}>
            {element.valeur ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
