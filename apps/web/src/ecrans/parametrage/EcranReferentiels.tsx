import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
 */
export function EcranReferentiels() {
  const { t } = useTranslation('parametrage');
  const { data: session } = useSession();
  const [onglet, setOnglet] = useState<Onglet>('tauxHoraires');

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="texte-titre font-semibold text-foreground">{t('parametrage:referentiels.titre')}</h1>
      <p className="texte-corps text-muted-foreground">{t('parametrage:referentiels.introduction')}</p>

      <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as Onglet)}>
        <TabsList>
          <TabsTrigger value="tauxHoraires">{t('parametrage:referentiels.tauxHoraires.onglet')}</TabsTrigger>
          <TabsTrigger value="prestations">{t('parametrage:referentiels.prestations.onglet')}</TabsTrigger>
        </TabsList>
        <TabsContent value="tauxHoraires" className="pt-4">
          <OngletTauxHoraires role={session?.utilisateur.role} />
        </TabsContent>
        <TabsContent value="prestations" className="pt-4">
          <OngletPrestations role={session?.utilisateur.role} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default EcranReferentiels;
