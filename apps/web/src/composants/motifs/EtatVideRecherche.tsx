import { EtatVide } from '@/composants/commun/EtatVide';

interface Props {
  readonly titre: string;
  readonly description: string;
}

/** État vide « recherche » — une recherche texte libre (`q`) est active et ne remonte aucun
 *  résultat. Pas d'action par défaut : la sortie naturelle est de modifier la recherche, pas de
 *  cliquer un bouton (docs/design-comptoir.md §4). */
export function EtatVideRecherche({ titre, description }: Props) {
  return <EtatVide titre={titre} description={description} />;
}
