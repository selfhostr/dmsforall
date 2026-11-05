import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SelecteurLangue } from '@/composants/layout/SelecteurLangue';
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
 * PORTE AUSSI le choix de langue (« Mon compte », carte distincte de la matière tarifaire
 * ci-dessous) — retiré de l'en-tête (décision @laupernoe, 10.08.2026) où il occupait une place
 * permanente pour un réglage qu'on touche une fois. Réglages a cinq onglets (atelier, sites,
 * facturation, tarifs, pièces) mais AUCUN n'est « mon compte » : celui-ci est le seul ouvert à
 * TOUS les rôles authentifiés sans restriction (voir l'en-tête de doc ci-dessus et
 * `ROLES_MENU_PARAMETRAGE_ATELIER`/`ROLES_MENU_FINANCIER`/`ROLES_PARAMETRAGE_PIECES` dans
 * `routes/droits-routes.ts`, qui ferment les quatre autres à des sous-ensembles de rôles). C'est
 * la seule porte de Réglages garantie atteignable par tout utilisateur connecté — y loger la
 * langue est donc la seule façon qu'aucun rôle ne perde la possibilité de la changer après la
 * connexion. Réutilise `SelecteurLangue` tel quel (cibles tactiles ≥44px, `aria-pressed` déjà
 * posés) — pas de second composant.
 */
export function EcranReferentiels() {
  const { t } = useTranslation(['parametrage', 'commun']);
  const { data: session } = useSession();
  const [onglet, setOnglet] = useState<Onglet>('tauxHoraires');

  return (
    <GabaritEcran
      titre={t('parametrage:referentiels.titre')}
      sousTitre={t('parametrage:referentiels.introduction')}
    >
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('parametrage:monCompte.titre')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:monCompte.langue.description')}
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="texte-corps font-medium text-foreground">
              {t('commun:langue.libelle')}
            </span>
            <SelecteurLangue />
          </div>
        </CardContent>
      </Card>

      <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as Onglet)}>
        <TabsList>
          <TabsTrigger value="tauxHoraires">
            {t('parametrage:referentiels.tauxHoraires.onglet')}
          </TabsTrigger>
          <TabsTrigger value="prestations">
            {t('parametrage:referentiels.prestations.onglet')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tauxHoraires" className="pt-4">
          <OngletTauxHoraires role={session?.utilisateur.role} />
        </TabsContent>
        <TabsContent value="prestations" className="pt-4">
          <OngletPrestations role={session?.utilisateur.role} />
        </TabsContent>
      </Tabs>
    </GabaritEcran>
  );
}
