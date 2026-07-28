import {
  AlertCircle,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  FileStack,
  FileText,
  PenLine,
  TriangleAlert,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { ORIGINES_LIGNE_OR, type ElementBloquant, type OrigineLigneOr, type TypeElementBloquant } from '@dfa/shared';

import { formaterHeure, formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

/** Icône par type, unique à l'intérieur de sa famille (§5.1 du document atelier). */
const ICONE_PAR_TYPE: Readonly<Record<TypeElementBloquant, LucideIcon>> = {
  ligne_or: Wrench,
  pointage: Clock3,
  technicien: User,
  point_controle: ClipboardCheck,
  devis_complementaire: FileText,
  signature: PenLine,
  travail_reporte: TriangleAlert,
  ressource_planning: CalendarClock,
  ordre_reparation: FileStack,
  champ: AlertCircle,
} as const;

function estOrigineLigneOrConnue(valeur: unknown): valeur is OrigineLigneOr {
  return typeof valeur === 'string' && (ORIGINES_LIGNE_OR as readonly string[]).includes(valeur);
}

/**
 * Détail complémentaire tiré de `donnees` (jamais de `libelle`, banni à l'affichage — voir
 * `RefusBloquant`). Mapping exhaustif sur `TypeElementBloquant` : les types dont la forme de
 * `donnees` n'est pas encore normée par le contrat (`point_controle`, `signature`,
 * `travail_reporte`, `ressource_planning`) se dégradent sur le libellé de base seul, sans jamais
 * inventer un texte non traduit.
 */
function detailElement(element: ElementBloquant, t: TFunction): string | undefined {
  const donnees = element.donnees ?? {};

  switch (element.type) {
    case 'ligne_or': {
      const parties: string[] = [];
      if (typeof donnees.numeroLigne === 'number') parties.push(`#${donnees.numeroLigne}`);
      if (estOrigineLigneOrConnue(donnees.origine)) parties.push(t(`or:lignes.origines.${donnees.origine}`));
      if (typeof donnees.totalTtcCentimes === 'number') parties.push(formaterMontant(donnees.totalTtcCentimes));
      return parties.length > 0 ? parties.join(' · ') : undefined;
    }
    case 'pointage': {
      const parties: string[] = [];
      if (typeof donnees.technicienPrenom === 'string') parties.push(donnees.technicienPrenom);
      if (typeof donnees.debutLe === 'string') parties.push(formaterHeure(donnees.debutLe));
      return parties.length > 0 ? parties.join(' — ') : undefined;
    }
    case 'technicien': {
      if (typeof donnees.nomAffiche === 'string') return donnees.nomAffiche;
      if (typeof donnees.prenom === 'string') return donnees.prenom;
      return undefined;
    }
    case 'devis_complementaire':
      return typeof donnees.numero === 'number' || typeof donnees.numero === 'string'
        ? t('or:devisComplementaire.numero', { numero: donnees.numero })
        : undefined;
    case 'ordre_reparation':
      return typeof donnees.numero === 'string' ? t('or:numero', { numero: donnees.numero }) : undefined;
    case 'champ':
      // `id` = nom du champ pour ce type (contrat `ElementBloquant`) : seul cas où `id` est
      // lui-même la donnée d'affichage.
      return element.id;
    case 'point_controle':
    case 'signature':
    case 'travail_reporte':
    case 'ressource_planning':
      return undefined;
    default: {
      const exhaustif: never = element.type;
      return exhaustif;
    }
  }
}

interface Props {
  readonly blocages: readonly ElementBloquant[];
  readonly onElementClic?: (element: ElementBloquant) => void;
  readonly className?: string;
}

/**
 * Liste des éléments qui bloquent une transition (invariant n°8, contrat §3.2/§3.5). Chaque
 * élément est une ligne cliquable vers sa source. **N'affiche jamais `ElementBloquant.libelle`** :
 * ce champ existe pour le support et les logs (libellé FR stable), pas pour l'écran — le rendu
 * part exclusivement de `type`, `id` et `donnees`, traduits dans la langue de l'utilisateur.
 */
export function ListeElementsBloquants({ blocages, onElementClic, className }: Props) {
  const { t } = useTranslation(['erreurs', 'or']);

  if (blocages.length === 0) {
    return null;
  }

  return (
    <ul className={cn('flex flex-col divide-y divide-border overflow-hidden rounded-md border', className)}>
      {blocages.map((element) => {
        const Icone = ICONE_PAR_TYPE[element.type];
        const libelleBase = t(`erreurs:blocages.${element.type}`, { count: 1 });
        const detail = detailElement(element, t);

        return (
          <li key={`${element.type}-${element.id}`}>
            <button
              type="button"
              className="flex w-full min-h-11 items-center gap-2 px-3 py-2 text-left texte-corps hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onElementClic?.(element)}
            >
              <Icone aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {libelleBase}
                {detail ? <span className="text-muted-foreground"> — {detail}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
