import { BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { peutLireDepotPneus } from '@/ecrans/pneus/droits';
import { useJeuxARelancer } from '@/hooks/pneus/useJeuxARelancer';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

interface Props {
  readonly site: string | undefined;
}

const MAX_LIGNES = 5;

/**
 * Échéances à venir — @laupernoe a demandé expertises MFK, garanties ET jeux de pneus à relancer.
 * SEUL le troisième est câblable aujourd'hui :
 *  - jeux de pneus à relancer : `GET /depots-pneus/a-relancer` (RPP-04) rend une date réelle
 *    (`dernierMouvementLe`) — câblé ci-dessous via `useJeuxARelancer`, déjà utilisé par
 *    `EcranHangarPneus`.
 *  - expertises MFK : `GET /vehicules` sait TRIER par `prochaineExpertiseLe:asc`
 *    (`TRIS_VEHICULES`), mais `VehiculeResume` (packages/shared/src/contrats/atelier/vehicule.ts)
 *    n'expose PAS cette date — le tri existe, la valeur à afficher n'existe pas. Afficher une
 *    liste de véhicules « bientôt en expertise » sans jamais pouvoir dire QUAND serait la même
 *    faute que le calendrier fantaisiste que ce widget s'interdit ailleurs.
 *  - garanties : `garantieConstructeur.finLe` n'existe que sur la fiche d'UN véhicule
 *    (`GET /vehicules/{id}`) — aucun endpoint n'agrège « garanties expirant bientôt » sur le
 *    tenant. Signalé, pas inventé.
 * Les deux manques sont un gap de CONTRAT (`@dfa/shared`/API), pas un oubli d'écran — un futur
 * endpoint agrégé rejoindrait cette liste sans changer sa forme.
 */
export function EcheancesAVenir({ site }: Props) {
  const { t } = useTranslation(['accueil', 'pneus', 'commun', 'erreurs']);
  const { data: session, isLoading: sessionEnChargement } = useSession();
  const actions = session?.actions;
  const peutLire = peutLireDepotPneus(actions);

  const requete = useJeuxARelancer(
    { siteId: site, tri: 'dernierMouvementLe:asc' },
    { enabled: peutLire },
  );

  const jeux = requete.depots.slice(0, MAX_LIGNES);
  const surplus = requete.depots.length - jeux.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <CardTitle>{t('accueil:echeances.titre')}</CardTitle>
        </div>
        <CardDescription>{t('accueil:echeances.description')}</CardDescription>
      </CardHeader>
      <div className="px-carte pb-carte">
        {sessionEnChargement ? (
          <EtatChargement lignes={3} />
        ) : !peutLire ? (
          <p className="texte-corps text-muted-foreground" role="status">
            {t('accueil:echeances.droitRequis')}
          </p>
        ) : requete.isPending ? (
          <EtatChargement lignes={3} />
        ) : requete.isError ? (
          <EtatErreur
            titre={t(
              requete.error instanceof ErreurReseau
                ? 'erreurs:reseau.titre'
                : 'erreurs:inattendue.titre',
            )}
            description={messageErreur(requete.error, t)}
            onReessayer={() => void requete.refetch()}
          />
        ) : jeux.length === 0 ? (
          <EtatVide
            titre={t('accueil:echeances.vide.titre')}
            description={t('accueil:echeances.vide.description')}
          />
        ) : (
          <ul className="flex flex-col divide-y">
            {jeux.map((depot) => (
              <li key={depot.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate texte-corps font-medium text-foreground">
                    {t(`pneus:saison.${depot.saison}`)} ·{' '}
                    {depot.codeCase ?? t('pneus:jeu.sansRepere')}
                  </p>
                  <p className="texte-libelle text-muted-foreground">
                    {t('accueil:echeances.depuisLe', {
                      date: formaterDate(depot.dernierMouvementLe),
                    })}
                  </p>
                </div>
                <Link
                  to={chemins.vehicules.detail(depot.vehiculeId, site)}
                  className="shrink-0 texte-libelle font-medium text-primary underline"
                >
                  {t('pneus:jeu.actions.voirVehicule')}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {peutLire && !requete.isPending && !requete.isError && jeux.length > 0 ? (
          // DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : ce filet sépare la
          // liste des échéances (données) du pied de carte (lien « voir tout »), même rôle
          // qu'un filet de pied de tableau, pas un simple regroupement de contenu.
          <div className="mt-3 flex flex-col gap-1 border-t pt-3">
            {surplus > 0 ? (
              <span className="texte-libelle text-muted-foreground">
                {t('accueil:echeances.autres', { count: surplus })}
              </span>
            ) : null}
            <Link
              to={chemins.pneus.aRelancer(site)}
              className="texte-libelle font-medium text-primary underline"
            >
              {t('accueil:echeances.voirTout')}
            </Link>
          </div>
        ) : null}
        <p className="mt-3 texte-libelle text-muted-foreground">{t('accueil:echeances.aVenir')}</p>
      </div>
    </Card>
  );
}
