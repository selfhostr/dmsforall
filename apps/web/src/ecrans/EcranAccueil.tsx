import { useTranslation } from 'react-i18next';

import { CalendrierEcheances } from '@/ecrans/accueil/composants/CalendrierEcheances';
import { EcheancesAVenir } from '@/ecrans/accueil/composants/EcheancesAVenir';
import { useSession } from '@/hooks/useSession';

/**
 * Point de départ réel pour un réceptionnaire qui ouvre l'application le matin — l'étape 1
 * (Atelier + Clients) est livrée, ce n'est plus un état vide à annoncer (voir git blame de ce
 * fichier pour l'ancienne version « votre espace est prêt »).
 *
 * Consigne @laupernoe (10.08.2026) : la recherche et les raccourcis Clients/Véhicules ont été RETIRÉS
 * d'ici — les trois sont déjà atteignables ailleurs dans le chrome applicatif pour TOUS les rôles
 * qui atterrissent sur cet écran (`direction`, `admin`, `receptionnaire`, `chef_atelier`, voir
 * `routes/atterrissage.ts`) :
 *  - la recherche vit dans `EnTete` (`RechercheGlobale`, `Ctrl+K`), montée SANS condition de rôle
 *    dès qu'une session existe (`composants/layout/EnTete.tsx`) ;
 *  - Clients et Véhicules vivent sous l'entrée permanente de barre latérale « Clients & véhicules »
 *    (`ENTREES_MENU`, id `clientsVehicules`, `composants/layout/navigation-modele.ts`) — ni
 *    l'entrée ni ses deux onglets ne portent de restriction de rôle (`roles` omis = visible à
 *    tous, `estAutorise`), cohérent avec `client.lire`/`vehicule.lire` (`LECTURE_ETENDUE`,
 *    accordés à tous les rôles côté API).
 * Ce qui reste ici sert donc désormais « aujourd'hui » au sens propre : ce qui se passe cette
 * semaine (calendrier) et ce qui approche (échéances) — deux widgets alimentés par de la donnée
 * RÉELLE, jamais un chiffre inventé (voir l'en-tête de chacun des deux composants pour ce qui est
 * et n'est pas câblable aujourd'hui). Conçus pour cohabiter avec le contenu du tableau de bord
 * (fusion prévue dans un chantier séparé, hors périmètre ici) : `flex flex-col gap-6`, pas de
 * grille figée qui présupposerait que ces deux cartes occupent l'écran seules.
 *
 * `session` est garanti non-null ici : ce composant ne rend que sous `RouteProtegee` (voir
 * routes/RouteProtegee.tsx), qui a déjà écarté les cas `isPending`/`isError`/`data===null`.
 */
export function EcranAccueil() {
  const { t } = useTranslation('accueil');
  const { data: session } = useSession();
  const site = session?.sites.find((candidat) => candidat.actif)?.id ?? session?.sites[0]?.id;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('accueil:demarrage.titre')}</h1>

      <CalendrierEcheances site={site} />
      <EcheancesAVenir site={site} />
    </div>
  );
}
