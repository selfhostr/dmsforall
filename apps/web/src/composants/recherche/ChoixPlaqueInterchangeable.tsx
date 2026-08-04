import { useTranslation } from 'react-i18next';

import type { ResultatRecherche } from '@dfa/shared';

import { ResultatVehicule } from './ResultatVehicule';

export interface ProprietesChoixPlaqueInterchangeable {
  /** Exactement les véhicules retournés par le serveur pour cette plaque partagée — le serveur
   *  ne choisit jamais à sa place (§6.9, RM-18) ; ce composant ne réordonne ni ne présélectionne
   *  rien non plus. */
  readonly vehicules: readonly ResultatRecherche[];
  readonly onChoisir: (resultat: ResultatRecherche) => void;
}

/**
 * RM-18 / §6.9 : une plaque interchangeable est portée par DEUX véhicules à la fois — collision
 * légitime. Les deux sont montrés à poids visuel STRICTEMENT égal (mêmes classes, même ordre que
 * la réponse serveur, aucun `autoFocus`, aucun badge « recommandé ») : de vrais `<button>` en
 * ordre de tabulation naturel, volontairement HORS du mécanisme de sélection active de `cmdk`
 * (qui, lui, surligne automatiquement un premier élément — l'exact contraire de l'exigence).
 */
export function ChoixPlaqueInterchangeable({
  vehicules,
  onChoisir,
}: ProprietesChoixPlaqueInterchangeable) {
  const { t } = useTranslation('recherche');

  return (
    <div className="flex flex-col gap-2">
      <p className="texte-libelle font-medium text-muted-foreground">
        {t('details.plaqueInterchangeable', { count: vehicules.length })}
      </p>
      <div className="flex flex-col gap-2">
        {vehicules.map((vehicule) => (
          <button
            key={vehicule.id}
            type="button"
            onClick={() => onChoisir(vehicule)}
            className="flex min-h-11 items-center rounded-md border border-input p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ResultatVehicule resultat={vehicule} />
          </button>
        ))}
      </div>
    </div>
  );
}
