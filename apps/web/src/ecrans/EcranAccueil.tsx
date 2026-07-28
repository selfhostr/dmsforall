import { Car, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

/**
 * Point de départ réel pour un réceptionnaire qui ouvre l'application le matin — l'étape 1
 * (Atelier + Clients) est livrée, ce n'est plus un état vide à annoncer (voir git blame de ce
 * fichier pour l'ancienne version « votre espace est prêt »).
 *
 * La recherche est mise en avant en premier : c'est le geste le plus fréquent au comptoir (une
 * plaque, un châssis, un nom de client, un numéro de téléphone). Les raccourcis clients/véhicules
 * suivent, sobres — AUCUN chiffre ni tableau de bord inventé : l'étape 1 n'expose aucun endpoint
 * d'agrégat (nombre de clients, d'OR en cours, etc.), et un compteur non fiable serait pire
 * qu'une absence de compteur.
 *
 * `session` est garanti non-null ici : ce composant ne rend que sous `RouteProtegee` (voir
 * routes/RouteProtegee.tsx), qui a déjà écarté les cas `isPending`/`isError`/`data===null`.
 */
export function EcranAccueil() {
  const { t } = useTranslation(['accueil', 'navigation', 'commun', 'recherche']);
  const { data: session } = useSession();
  const site = session?.sites.find((candidat) => candidat.actif)?.id ?? session?.sites[0]?.id;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('accueil:demarrage.titre')}</h1>

      <Link to={chemins.recherche.globale(site)} className="block">
        <Card className="border-primary/40 transition-colors hover:border-primary">
          <CardHeader className="flex-row items-center gap-4 space-y-0">
            <Search className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <CardTitle>{t('commun:actions.rechercher')}</CardTitle>
              <CardDescription>{t('recherche:aide')}</CardDescription>
            </div>
          </CardHeader>
        </Card>
      </Link>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link to={chemins.clients.liste(site)} className="block">
          <Card className="h-full transition-colors hover:border-primary">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <Users className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base">{t('navigation:liens.clients')}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
        <Link to={chemins.vehicules.liste(site)} className="block">
          <Card className="h-full transition-colors hover:border-primary">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <Car className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base">{t('navigation:liens.vehicules')}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
