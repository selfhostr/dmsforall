import { CalendarClock } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { MomentRendezVous, ReponseRendezVous } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { libelleMotif } from '@/composants/rendez-vous/types';
import { BadgeStatutRendezVous } from '@/composants/rendez-vous/BadgeStatutRendezVous';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { Plaque } from '@/composants/identite/Plaque';
import { versDateIsoLocale } from '@/ecrans/accueil/semaine';
import { useAgendaRendezVous } from '@/hooks/rendez-vous/useAgendaRendezVous';
import { useLangue } from '@/hooks/useLangue';
import { chemins } from '@/routes/chemins';

interface Props {
  readonly site: string | undefined;
}

const MAX_LIGNES = 6;

/** Ordre d'affichage d'un jour d'agenda — matin puis après-midi puis toute la journée, jamais
 *  l'ordre de création renvoyé par défaut par `GET /rendez-vous` (`creeLe:desc`). */
const ORDRE_MOMENT: Readonly<Record<MomentRendezVous, number>> = {
  matin: 0,
  apres_midi: 1,
  toute_journee: 2,
};

function comparerRendezVous(a: ReponseRendezVous, b: ReponseRendezVous): number {
  const parMoment = ORDRE_MOMENT[a.moment] - ORDRE_MOMENT[b.moment];
  if (parMoment !== 0) return parMoment;
  if (a.heureSouhaitee && b.heureSouhaitee) return a.heureSouhaitee.localeCompare(b.heureSouhaitee);
  if (a.heureSouhaitee) return -1;
  if (b.heureSouhaitee) return 1;
  return 0;
}

/**
 * Rendez-vous du jour — LE bloc qui manquait au réceptionnaire (constat terrain, 12.08.2026 : son
 * écran du lundi matin affichait trois fois « Aucun… » et un zéro, aucun d'eux ne répondant à « qui
 * est attendu aujourd'hui »). `GET /rendez-vous?du=&au=&siteId=` (domaine `rendez-vous`, livré ce
 * lot) résolu sur la journée courante (calendaire LOCAL, `versDateIsoLocale` — même doctrine que
 * `CalendrierEcheances`).
 *
 * `site` absent (cas de l'accueil) : les rendez-vous du jour de TOUS les sites du garage. Seul
 * l'agenda du planning reste scopé à un site (RV-06, capacité calculée site par site).
 *
 * Tous les statuts de la journée sont affichés (`confirme`/`honore`/`absent`/`annule`), badge à
 * l'appui — masquer les rendez-vous déjà honorés ou annulés donnerait au réceptionnaire une image
 * incomplète de sa matinée, exactement le défaut reproché à l'ancien widget.
 */
export function CarteRendezVousJour({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'planning', 'accueil', 'commun', 'erreurs']);
  const { langue } = useLangue();
  const aujourdhui = useMemo(() => versDateIsoLocale(new Date()), []);

  // Sans site : tous les sites du garage (l'accueil montre l'entreprise entière).
  const filtres = { du: aujourdhui, au: aujourdhui, siteId: site };
  const requete = useAgendaRendezVous(filtres);

  const rendezVous = useMemo(
    () => [...(requete.data?.donnees ?? [])].sort(comparerRendezVous),
    [requete.data],
  );
  const visibles = rendezVous.slice(0, MAX_LIGNES);
  const surplus = rendezVous.length - visibles.length;

  let contenu: ReactNode;
  if (requete.isPending) {
    contenu = <EtatChargement lignes={3} />;
  } else if (requete.isError) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    contenu = (
      <EtatErreur
        titre={t(
          estErreurReseau
            ? 'erreurs:reseau.titre'
            : 'tableauBord:receptionnaire.rendezVousJour.erreur.titre',
        )}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  } else if (rendezVous.length === 0) {
    contenu = (
      <EtatVide
        titre={t('tableauBord:receptionnaire.rendezVousJour.vide.titre')}
        description={t('tableauBord:receptionnaire.rendezVousJour.vide.description')}
      />
    );
  } else {
    contenu = (
      <ul className="flex flex-col divide-y">
        {visibles.map((rdv) => (
          <li key={rdv.id} className="flex items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-14 shrink-0 texte-libelle font-semibold tabular-nums text-foreground">
                {rdv.heureSouhaitee
                  ? rdv.heureSouhaitee.slice(0, 5)
                  : t(`planning:moments.${rdv.moment}`)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {rdv.vehicule ? (
                    <Plaque canton={rdv.vehicule.canton} numero={rdv.vehicule.plaque} taille="sm" />
                  ) : (
                    <span className="texte-libelle text-muted-foreground">
                      {t('tableauBord:receptionnaire.rendezVousJour.vehiculeInconnu')}
                    </span>
                  )}
                  <span className="truncate texte-corps font-medium text-foreground">
                    {rdv.client.nomAffiche}
                  </span>
                </div>
                <span className="truncate texte-libelle text-muted-foreground">
                  {libelleMotif(rdv.motif, langue)}
                </span>
              </div>
            </div>
            <BadgeStatutRendezVous statut={rdv.statut} className="shrink-0" />
          </li>
        ))}
        {surplus > 0 ? (
          <li className="pt-2 texte-libelle text-muted-foreground">
            {t('accueil:calendrier.autres', { count: surplus })}
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <CardTitle>{t('tableauBord:receptionnaire.rendezVousJour.titre')}</CardTitle>
        </div>
        <CardDescription>
          {t('tableauBord:receptionnaire.rendezVousJour.description')}
        </CardDescription>
      </CardHeader>
      <div className="px-carte pb-carte">
        {contenu}
        {site && !requete.isPending && !requete.isError && rendezVous.length > 0 ? (
          <Link
            to={chemins.atelier.rendezVous.agenda(site)}
            className="mt-3 inline-block texte-libelle font-medium text-primary underline"
          >
            {t('tableauBord:receptionnaire.rendezVousJour.voirAgenda')}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
