import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseDepotPneus } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { useDeplacerDepotPneus } from '@/hooks/pneus/useDeplacerDepotPneus';

interface Props {
  readonly depot: ReponseDepotPneus | null;
  readonly onFerme: () => void;
}

/** `POST /depots-pneus/{id}/deplacer` (défaut n°2, RPP-07) — changer le repère de rangement d'un
 *  jeu déjà entré dans le hangar. Pré-rempli avec le repère ACTUEL (pas un champ vide) : le geste
 *  courant est de le CORRIGER, pas de le ressaisir en entier. Champ vide accepté à la confirmation
 *  (case libérée sans nouveau repère connu — même tolérance que `schemaDeplacementDepotPneus`,
 *  `codeCase` nullish). Pas de confirmation à froid, même doctrine que `DialogueChangerSaisonPneu` :
 *  geste fréquent et réversible (redéplacer suffit à corriger une erreur). */
export function DialogueDeplacerDepotPneu({ depot, onFerme }: Props) {
  const { t } = useTranslation(['pneus', 'commun']);
  const deplacer = useDeplacerDepotPneus();
  const [codeCase, setCodeCase] = useState('');

  useEffect(() => {
    if (depot) {
      setCodeCase(depot.codeCase ?? '');
      // Défaut corrigé (même patron que `DialogueChangerSaisonPneu`/`DialogueSortirDepotPneu`) :
      // sans ce `reset()`, une erreur de mutation restée affichée depuis le jeu précédent
      // réapparaissait à l'ouverture du dialogue pour un autre jeu.
      deplacer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- réinitialisation à la réouverture seulement
  }, [depot]);

  function confirmer(evenement?: FormEvent) {
    evenement?.preventDefault();
    if (!depot) return;
    const valeur = codeCase.trim();
    deplacer.mutate(
      { id: depot.id, entree: { codeCase: valeur === '' ? null : valeur } },
      { onSuccess: onFerme },
    );
  }

  return (
    <PanneauLateral
      ouvert={depot !== null}
      onOuvertChange={(ouvert) => !ouvert && onFerme()}
      titre={t('pneus:deplacement.titre')}
      pied={
        <>
          <Button type="button" variant="outline" onClick={onFerme} disabled={deplacer.isPending}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="formulaire-deplacer-depot-pneu" disabled={deplacer.isPending}>
            {deplacer.isPending ? t('commun:chargement.enCours') : t('pneus:jeu.actions.deplacer')}
          </Button>
        </>
      }
    >
      <form
        id="formulaire-deplacer-depot-pneu"
        onSubmit={confirmer}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="depot-pneu-deplacement-code-case">
            {t('pneus:deplacement.champCodeCase')}
          </Label>
          <Input
            id="depot-pneu-deplacement-code-case"
            value={codeCase}
            maxLength={60}
            autoFocus
            placeholder={t('pneus:creation.champCodeCasePlaceholder')}
            readOnly={deplacer.isPending}
            onChange={(evenement) => setCodeCase(evenement.target.value)}
          />
        </div>

        {deplacer.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(deplacer.error, t)}
          </p>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
