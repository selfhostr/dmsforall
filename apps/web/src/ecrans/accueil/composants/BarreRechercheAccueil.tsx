import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { ResultatRecherche } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { CONSTRUCTEURS_CHEMIN_RESULTAT } from '@/composants/recherche/chemins-resultats';
import { PanneauResultatsRecherche } from '@/composants/recherche/PanneauResultatsRecherche';
import { ActionsCreerOrRecherche } from '@/ecrans/recherche/ActionsCreerOrRecherche';
import { useRechercheComptoir } from '@/hooks/recherche/useRechercheComptoir';

interface Props {
  readonly site: string | undefined;
}

/**
 * Premier geste de la journée : taper une plaque, un nom ou un n° d'OR. Même moteur que la
 * recherche Ctrl+K (`useRechercheComptoir`, `PanneauResultatsRecherche`), mais posé dans la page
 * plutôt que dans une surimpression — le garagiste voit tout de suite où écrire. Sous les
 * résultats : « Créer un OR » pour le véhicule ou le client trouvé, ou pour la saisie si rien ne
 * correspond.
 */
export function BarreRechercheAccueil({ site }: Props) {
  const { t } = useTranslation(['accueil', 'erreurs']);
  const navigate = useNavigate();
  const { saisie, onSaisieChange, enChargement, reponse, enErreur, erreur, relancer } =
    useRechercheComptoir();

  function selectionner(resultat: ResultatRecherche) {
    navigate(CONSTRUCTEURS_CHEMIN_RESULTAT[resultat.type](resultat.id, site));
  }

  if (enErreur) {
    return (
      <EtatErreur
        titre={t(
          erreur instanceof ErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre',
        )}
        description={messageErreur(erreur, t)}
        onReessayer={relancer}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <PanneauResultatsRecherche
        valeur={saisie}
        onValeurChange={onSaisieChange}
        reponse={reponse}
        enChargement={enChargement}
        onSelectionner={selectionner}
        onEchap={saisie.trim() === '' ? undefined : () => onSaisieChange('')}
        placeholder={t('accueil:recherche.placeholder')}
      />
      {enChargement ? null : (
        <ActionsCreerOrRecherche saisie={saisie} reponse={reponse} site={site} />
      )}
    </div>
  );
}
