import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LegendeChampsObligatoires } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useSession } from '@/hooks/useSession';

import { OngletPrestations } from './OngletPrestations';
import { OngletTauxHoraires } from './OngletTauxHoraires';

type Onglet = 'tauxHoraires' | 'prestations';

/**
 * Écran des référentiels tarifaires — taux horaires (RM-65) et catalogue de prestations (§7.9).
 * LE bloquant du produit : sans ces deux référentiels remplis, aucune ligne d'OR ne peut être
 * chiffrée (`atelier.ligne.creer` a besoin d'un `tauxHoraireCode` ou d'une `prestationId` valide
 * portant un prix). Un garage qui vient d'être migré ouvre cet écran EN PREMIER.
 *
 * Deux onglets plutôt que deux écrans séparés : les deux référentiels se lisent ensemble (le
 * `tauxHoraireCode` d'une prestation de type `main_oeuvre_temps_reel` doit exister côté taux
 * horaires) — `OngletPrestations` réutilise d'ailleurs le cache TanStack Query de
 * `useListeTauxHoraires` pour peupler son select, sans second appel réseau si l'onglet Taux
 * horaires a déjà été visité.
 *
 * Lecture ouverte à tout rôle authentifié (`parametrage.referentiel.lire`) ; écriture réservée à
 * `chef_atelier`/`direction` (voir `droits.ts`) — les actions de création/modification se grisent
 * pour les autres rôles plutôt que de les laisser remplir un formulaire qui échouera en `403`.
 *
 * Le choix de langue n'est plus ici : il vit dans le menu du compte (`SelecteurLangueMenu`).
 */
export function EcranReferentiels() {
  const { t } = useTranslation(['parametrage', 'commun']);
  const { data: session } = useSession();
  const [onglet, setOnglet] = useState<Onglet>('tauxHoraires');

  return (
    <GabaritEcran titre={t('parametrage:referentiels.titre')}>
      <LegendeChampsObligatoires>{t('parametrage:obligatoire.legende')}</LegendeChampsObligatoires>

      <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as Onglet)}>
        <TabsList>
          <TabsTrigger value="tauxHoraires">
            {t('parametrage:referentiels.tauxHoraires.onglet')}
            <span aria-hidden="true" className="ml-0.5">
              *
            </span>
          </TabsTrigger>
          <TabsTrigger value="prestations">
            {t('parametrage:referentiels.prestations.onglet')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tauxHoraires" className="pt-4">
          <OngletTauxHoraires actions={session?.actions} />
        </TabsContent>
        <TabsContent value="prestations" className="pt-4">
          <OngletPrestations actions={session?.actions} />
        </TabsContent>
      </Tabs>
    </GabaritEcran>
  );
}
