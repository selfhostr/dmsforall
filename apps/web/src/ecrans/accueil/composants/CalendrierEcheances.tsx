import { CalendarClock } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { OrdreReparationResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { Plaque } from '@/composants/identite/Plaque';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { peutLireEcheancesOr } from '@/ecrans/accueil/droits';
import { construireFenetreSemaine, versDateIsoLocale } from '@/ecrans/accueil/semaine';
import { useEcheancesOr } from '@/hooks/accueil/useEcheancesOr';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

interface Props {
  readonly site: string | undefined;
}

/** Nombre d'OR affichés par jour avant repli sur un simple compteur — un jour chargé ne doit pas
 *  faire déborder la carte hors de son gabarit. */
const MAX_PAR_JOUR = 4;

/**
 * PRÉVERSION du calendrier de prise de rendez-vous (@laupernoe, 10.08.2026) : aucune table
 * `rendez_vous` ni route de prise de RDV n'existe à ce jour dans ce dépôt — vérifié, pas de
 * fausse donnée à inventer ici. Ce widget montre donc ce qui EXISTE réellement et ressemble le
 * plus à un engagement pris avec un client : la date de restitution promise (`restitutionPromiseLe`,
 * RM-56) des ordres de réparation ouverts cette semaine — `GET /ordres-reparation`, filtres
 * `restitutionPromiseDu`/`Au` (§6.2). Ce n'est pas un rendez-vous, et le libellé le dit
 * explicitement (`accueil:calendrier.apercu`) plutôt que de laisser croire à une fonctionnalité
 * qui n'existe pas encore.
 */
export function CalendrierEcheances({ site }: Props) {
  const { t, i18n } = useTranslation(['accueil', 'or', 'commun', 'erreurs']);
  const { data: session, isLoading: sessionEnChargement } = useSession();
  const role = session?.utilisateur.role;
  const peutLire = peutLireEcheancesOr(role);

  // Nom du jour de semaine dépendant de la LANGUE d'interface (contrairement aux dates chiffrées
  // du produit, toujours 'de-CH' — voir lib/formats.ts) : « lun. » n'a de sens que traduit.
  const formateurJour = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric' }),
    [i18n.language],
  );

  const jours = useMemo(() => construireFenetreSemaine(new Date()), []);
  const premierJour = jours[0];
  const dernierJour = jours[jours.length - 1];

  const requete = useEcheancesOr(
    {
      restitutionPromiseDu: premierJour?.dateIso ?? '',
      restitutionPromiseAu: dernierJour?.dateIso ?? '',
      siteId: site,
    },
    { enabled: peutLire },
  );

  const parJour = useMemo(() => {
    const carte = new Map<string, OrdreReparationResume[]>();
    for (const or of requete.data?.donnees ?? []) {
      if (!or.restitutionPromiseLe) continue;
      const cle = versDateIsoLocale(new Date(or.restitutionPromiseLe));
      const liste = carte.get(cle) ?? [];
      liste.push(or);
      carte.set(cle, liste);
    }
    return carte;
  }, [requete.data]);

  const totalSemaine = [...parJour.values()].reduce((somme, liste) => somme + liste.length, 0);

  let contenu: ReactNode;
  if (sessionEnChargement) {
    contenu = (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    );
  } else if (!peutLire) {
    contenu = (
      <p className="texte-corps text-muted-foreground" role="status">
        {t('accueil:calendrier.droitRequis')}
      </p>
    );
  } else if (requete.isPending) {
    contenu = (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    );
  } else if (requete.isError) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    contenu = (
      <EtatErreur
        titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  } else if (totalSemaine === 0) {
    contenu = (
      <EtatVide
        titre={t('accueil:calendrier.vide.titre')}
        description={t('accueil:calendrier.vide.description')}
      />
    );
  } else {
    contenu = (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {jours.map((jour) => {
          const ordresJour = parJour.get(jour.dateIso) ?? [];
          const visibles = ordresJour.slice(0, MAX_PAR_JOUR);
          const surplus = ordresJour.length - visibles.length;
          return (
            <div key={jour.dateIso} className="flex min-w-0 flex-col gap-2 rounded-md border p-2">
              <p className="texte-libelle font-medium capitalize text-foreground">
                {formateurJour.format(jour.date)}
              </p>
              {visibles.length === 0 ? (
                <span aria-hidden className="texte-libelle text-muted-foreground">
                  —
                </span>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {visibles.map((or) => (
                    <li key={or.id}>
                      <Link
                        to={chemins.atelier.ordresReparation.detail(or.id, site)}
                        className="flex flex-col gap-1 rounded border border-transparent p-1 hover:border-input hover:bg-muted"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <Plaque
                            canton={or.vehicule.canton}
                            numero={or.vehicule.plaque}
                            taille="sm"
                          />
                          <BadgeStatutOr etat={or.etatAffiche} />
                        </div>
                        <span className="truncate texte-libelle text-muted-foreground">
                          {or.client.nomAffiche}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {surplus > 0 ? (
                <span className="texte-libelle text-muted-foreground">
                  {t('accueil:calendrier.autres', { count: surplus })}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <CardTitle>{t('accueil:calendrier.titre')}</CardTitle>
        </div>
        <CardDescription>{t('accueil:calendrier.apercu')}</CardDescription>
      </CardHeader>
      <div className="px-carte pb-carte">{contenu}</div>
    </Card>
  );
}
