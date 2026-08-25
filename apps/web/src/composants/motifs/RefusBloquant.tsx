import { Ban } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActionProposee, CodeErreur, ElementBloquant } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { signalerErreur } from '@/observabilite/sentry';
import { cn } from '@/lib/utils';

import { ListeElementsBloquants } from './ListeElementsBloquants';

interface Props {
  readonly code: CodeErreur;
  readonly blocages: readonly ElementBloquant[];
  readonly actionsProposees: readonly ActionProposee[];
  /** `true` pour un refus dont l'état de départ est déjà terminal (`annule`/`cloture`) : le
   *  contrat documente qu'`actionsProposees` y est vide **par construction** (aucune sortie
   *  n'existe), donc le repli d'anomalie ne doit pas se déclencher. Par défaut `false`. */
  readonly estTerminal?: boolean;
  readonly onActionProposee?: (action: ActionProposee) => void;
  readonly onElementBloquantClic?: (element: ElementBloquant) => void;
  readonly className?: string;
}

/**
 * Refus bloquant (invariant n°8, contrat §3.2/§3.4/§4.1) — l'action est impossible en l'état.
 * Encart inline (jamais modal, ne doit pas interrompre le flux), token `--statut-danger`
 * (docs/design-comptoir.md §8), au contraire de `AvertissementConfirmable` (ambre, modal) : les
 * deux restent visuellement distincts à 100 % (§9.5 du document atelier).
 *
 * Rend le message via `erreurs:codes.<CODE>` (jamais `ProblemeDetail.title`/`.detail`, qui ne
 * sont pas destinés à l'affichage), la liste des blocages cliquables, et un bouton par action
 * proposée (`erreurs:actions.<CODE>`). Si `actionsProposees` est vide en dehors d'un contexte
 * terminal, un serveur a oublié le chemin de sortie : ce n'est jamais un cul-de-sac muet, un
 * encart de repli explicite s'affiche et l'anomalie est signalée à l'observabilité.
 */
export function RefusBloquant({
  code,
  blocages,
  actionsProposees,
  estTerminal = false,
  onActionProposee,
  onElementBloquantClic,
  className,
}: Props) {
  const { t } = useTranslation(['erreurs']);
  const aucuneSortie = actionsProposees.length === 0 && !estTerminal;

  useEffect(() => {
    if (!aucuneSortie) return;
    void signalerErreur(
      new Error(`RefusBloquant sans actionsProposees hors contexte terminal (${code})`),
      {
        code,
        nombreBlocages: blocages.length,
      },
    );
    // Signalé une seule fois par occurrence de refus (code+nombre de blocages) : un re-rendu du
    // même refus ne doit pas ré-émettre l'événement à chaque frappe.
  }, [aucuneSortie, code, blocages.length]);

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-groupe rounded-md border border-statut-danger bg-statut-danger-fond p-carte',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Ban aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-danger" />
        <p className="flex-1 texte-corps font-medium text-foreground">
          {t(`erreurs:codes.${code}`)}
        </p>
      </div>

      {blocages.length > 0 ? (
        <ListeElementsBloquants blocages={blocages} onElementClic={onElementBloquantClic} />
      ) : null}

      {actionsProposees.length > 0 ? (
        <div className="flex flex-wrap gap-controles">
          {actionsProposees.map((action) => (
            <Button key={action.code} variant="outline" onClick={() => onActionProposee?.(action)}>
              {t(`erreurs:actions.${action.code}`)}
            </Button>
          ))}
        </div>
      ) : null}

      {aucuneSortie ? <p className="texte-libelle">{t('erreurs:inattendue.description')}</p> : null}
    </div>
  );
}
