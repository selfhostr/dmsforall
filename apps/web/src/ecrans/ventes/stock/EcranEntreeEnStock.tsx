import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { VehiculeResume } from '@dfa/shared';

import { useSession } from '@/hooks/useSession';

import { cheminsStockVentes } from './_composants/chemins-locaux';
import { FormulaireEntreeEnStock } from './_composants/FormulaireEntreeEnStock';
import { SelecteurVehiculeExistant } from './_composants/SelecteurVehiculeExistant';

/**
 * Entrée en stock (`POST /vehicules/{vehiculeId}/stock`, RV-01, écran 3 du brief) — formulaire en
 * DEUX temps, jamais un formulaire de création de véhicule : `POST /vehicules/{id}/stock`
 * RÉFÉRENCE un véhicule déjà créé (étape 1). Premier temps : rechercher/choisir un véhicule
 * existant (`SelecteurVehiculeExistant`, lien vers `chemins.vehicules.nouveau()` si le véhicule
 * n'existe pas encore, ex. un VN en commande jamais saisi). Second temps : la fiche de mise en
 * stock elle-même (`FormulaireEntreeEnStock`), avec `Idempotency-Key` (un double-clic comptoir
 * ne doit jamais produire deux fiches de coût pour le même véhicule).
 */
export function EcranEntreeEnStock() {
  const { t } = useTranslation(['ventes', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [vehiculeChoisi, setVehiculeChoisi] = useState<VehiculeResume | null>(null);

  const sites = session?.sites ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('ventes:stock.entree.titre')}</h1>

      {vehiculeChoisi === null ? (
        <SelecteurVehiculeExistant onChoisir={setVehiculeChoisi} />
      ) : (
        <FormulaireEntreeEnStock
          vehicule={vehiculeChoisi}
          sites={sites}
          onRetour={() => setVehiculeChoisi(null)}
          onMisEnStock={(vehiculeId) => navigate(cheminsStockVentes.detail(vehiculeId, site))}
        />
      )}
    </div>
  );
}
