import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ResultatRecherche } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { CONSTRUCTEURS_CHEMIN_RESULTAT } from '@/composants/recherche/chemins-resultats';
import { PanneauResultatsRecherche } from '@/composants/recherche/PanneauResultatsRecherche';
import { useRechercheComptoir } from '@/hooks/recherche/useRechercheComptoir';

/**
 * F1-R2 — écran de recherche comptoir (RM-112, D-08) : le point d'entrée n°1 du produit. Toute la
 * logique réseau/anti-rebond vit dans `useRechercheComptoir` ; cet écran assemble les trois états
 * obligatoires (chargement / vide / erreur) autour de `PanneauResultatsRecherche`, sans en
 * réécrire le contenu.
 *
 * L'état « vide » a deux variantes bien distinctes : rien saisi encore (invite, gérée ICI, sous
 * le panneau) contre aucun résultat pour la saisie courante (géré PAR le panneau lui-même,
 * `recherche:vide.*`) — les confondre ferait passer un garagiste qui vient de commencer à taper
 * pour un échec de recherche.
 */
export function EcranRecherche() {
  const { t } = useTranslation(['recherche', 'commun', 'erreurs']);
  const navigate = useNavigate();
  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // deux onglets sur deux sites différents ne doivent pas se contredire.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { saisie, onSaisieChange, enChargement, reponse, enErreur, erreur, relancer } =
    useRechercheComptoir();

  const saisieNonVide = saisie.trim().length > 0;

  function selectionner(resultat: ResultatRecherche) {
    navigate(CONSTRUCTEURS_CHEMIN_RESULTAT[resultat.type](resultat.id, site));
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{t('commun:titres.recherche')}</h1>

      {enErreur ? (
        <EtatErreur
          titre={
            erreur instanceof ErreurReseau
              ? t('erreurs:reseau.titre')
              : t('erreurs:inattendue.titre')
          }
          description={messageErreur(erreur, t)}
          onReessayer={relancer}
        />
      ) : (
        <>
          <PanneauResultatsRecherche
            valeur={saisie}
            onValeurChange={onSaisieChange}
            reponse={reponse}
            enChargement={enChargement}
            onSelectionner={selectionner}
            onEchap={saisieNonVide ? () => onSaisieChange('') : undefined}
          />
          {!saisieNonVide ? (
            <EtatVide titre={t('recherche:titre')} description={t('recherche:aide')} />
          ) : null}
        </>
      )}
    </div>
  );
}
