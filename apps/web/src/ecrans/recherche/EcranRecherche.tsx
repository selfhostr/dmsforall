import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ResultatRecherche, TypeResultatRecherche } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { PanneauResultatsRecherche } from '@/composants/recherche/PanneauResultatsRecherche';
import { useRechercheComptoir } from '@/hooks/recherche/useRechercheComptoir';
import { chemins } from '@/routes/chemins';

/** `chemins.ts` (routes/) n'a pas encore d'entrée Atelier — module en cours de câblage par un
 *  autre agent (périmètre disjoint). Même sémantique que `construireChemin` : le site n'est
 *  ajouté que s'il est déjà défini, jamais inventé — répété ici (comme dans EcranFicheClient.tsx)
 *  plutôt que d'éditer un fichier hors périmètre. */
function cheminOr(id: string, site: string | undefined): string {
  return site ? `/ordres-reparation/${id}?site=${encodeURIComponent(site)}` : `/ordres-reparation/${id}`;
}

/** Même raison que `cheminOr` ci-dessus : `chemins.ts` n'a pas encore d'entrée Facturation
 *  (module hors périmètre ici). Route confirmée par `routes/routeur.tsx` : `factures/:id`
 *  (`EcranFicheFacture` lit `useParams<{ id: string }>()`, pas `:factureId`). */
function cheminFacture(id: string, site: string | undefined): string {
  return site ? `/factures/${id}?site=${encodeURIComponent(site)}` : `/factures/${id}`;
}

/**
 * Destination d'un résultat sélectionné, par nature. `Record` exhaustif sur `TypeResultatRecherche`
 * (§ enums.ts) : l'ajout d'une nature de résultat future casserait la compilation ici plutôt que
 * de silencieusement ne rien faire au clic. Les OR n'ont pas encore de chemin dans
 * `routes/chemins.ts` (module Atelier en cours de câblage ailleurs) — slug local aligné sur celui
 * déjà utilisé par l'API (`/ordres-reparation/{id}`, voir `client.ts`). Même chose pour
 * `document_vente` : `/factures/{id}` (voir `cheminFacture` ci-dessus, `routes/routeur.tsx`).
 *
 * Le site sélectionné (`?site=` de l'URL courante) est propagé vers CHAQUE destination — perdre le
 * site en sortant de la recherche romprait le même contrat que perdre `?site=` en sortant de la
 * liste clients/véhicules (routes/chemins.ts).
 */
const CONSTRUCTEURS_CHEMIN: Record<TypeResultatRecherche, (id: string, site: string | undefined) => string> = {
  vehicule: (id, site) => chemins.vehicules.detail(id, site),
  client: (id, site) => chemins.clients.detail(id, site),
  ordre_reparation: (id, site) => cheminOr(id, site),
  document_vente: (id, site) => cheminFacture(id, site),
};

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
  const { saisie, onSaisieChange, enChargement, reponse, enErreur, erreur, relancer } = useRechercheComptoir();

  const saisieNonVide = saisie.trim().length > 0;

  function selectionner(resultat: ResultatRecherche) {
    navigate(CONSTRUCTEURS_CHEMIN[resultat.type](resultat.id, site));
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{t('commun:titres.recherche')}</h1>

      {enErreur ? (
        <EtatErreur
          titre={erreur instanceof ErreurReseau ? t('erreurs:reseau.titre') : t('erreurs:inattendue.titre')}
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
          {!saisieNonVide ? <EtatVide titre={t('recherche:titre')} description={t('recherche:aide')} /> : null}
        </>
      )}
    </div>
  );
}
