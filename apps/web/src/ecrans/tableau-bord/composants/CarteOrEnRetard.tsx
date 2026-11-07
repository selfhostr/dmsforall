import { AlertTriangle } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { Plaque } from '@/composants/identite/Plaque';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { versDateIsoLocale } from '@/ecrans/accueil/semaine';
import { useEcheancesOr } from '@/hooks/accueil/useEcheancesOr';
import { chemins } from '@/routes/chemins';

const MAX_LIGNES = 5;

interface Props {
  readonly site: string | undefined;
}

/**
 * Issue #112 (test terrain, verbatim : « aucune vue en retard », « le tableau du matin ne montre
 * que les sorties du jour ») — `CarteRestitutionsJour` (même dossier) reste bornée à la fenêtre
 * du jour (`restitutionPromiseDu = restitutionPromiseAu = aujourd'hui`), donc un OR promis HIER et
 * toujours pas restitué n'y apparaît jamais. Cette carte-ci interroge SANS borne basse
 * (`restitutionPromiseDu` omis, désormais optionnel — `hooks/accueil/echeances-or.api.ts`) :
 * « tout ce qui est promis aujourd'hui ou avant », puis filtre sur `OrdreReparationResume.enRetard`
 * (calculé UNE SEULE FOIS côté serveur, jamais rederivé ici) pour ne garder que ce qui est
 * RÉELLEMENT en retard — un OR promis aujourd'hui mais pas encore en retard reste À
 * `CarteRestitutionsJour`, jamais dupliqué ici.
 *
 * GAP CONNU, signalé plutôt que maquillé (rapport de livraison) : `enRetard` exige une
 * `restitutionPromiseLe` renseignée (« une date promise absente n'est JAMAIS un retard »,
 * `contrats/atelier/ordre-reparation.ts`). La majorité des OR de ce jeu de données n'ont PAS cette
 * date (constat terrain, même issue) — cette carte ne peut donc PAS les faire apparaître : ce
 * serait une autre notion (« OR ouvert depuis longtemps, sans promesse »), qui exigerait un
 * agrégat serveur qui n'existe pas encore (hors périmètre de cet écran, apps/api).
 */
export function CarteOrEnRetard({ site }: Props) {
  const { t } = useTranslation(['accueil', 'tableauBord', 'or', 'commun', 'erreurs']);
  const aujourdhui = useMemo(() => versDateIsoLocale(new Date()), []);

  const requete = useEcheancesOr({
    restitutionPromiseAu: aujourdhui,
    siteId: site,
  });

  const ordres = (requete.data?.donnees ?? []).filter((or) => or.enRetard === true);
  const visibles = ordres.slice(0, MAX_LIGNES);
  const surplus = ordres.length - visibles.length;

  let contenu: ReactNode;
  if (requete.isPending) {
    contenu = <EtatChargement lignes={3} />;
  } else if (requete.isError) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    contenu = (
      <EtatErreur
        titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  } else if (ordres.length === 0) {
    contenu = (
      <EtatVide
        titre={t('tableauBord:activite.enRetardCarte.vide.titre')}
        description={t('tableauBord:activite.enRetardCarte.vide.description')}
      />
    );
  } else {
    contenu = (
      <ul className="flex flex-col divide-y">
        {visibles.map((or) => (
          <li key={or.id}>
            <Link
              to={chemins.atelier.ordresReparation.detail(or.id, site)}
              className="flex items-center justify-between gap-3 rounded p-1.5 py-2 hover:bg-muted"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Plaque canton={or.vehicule.canton} numero={or.vehicule.plaque} taille="sm" />
                <span className="truncate texte-libelle text-muted-foreground">
                  {or.client.nomAffiche}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <BadgeStatut icone={AlertTriangle} token="danger" forme="contour">
                  {t('tableauBord:activite.enRetard')}
                </BadgeStatut>
                <BadgeStatutOr etat={or.etatAffiche} />
              </div>
            </Link>
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
        <CardTitle>{t('tableauBord:activite.enRetardCarte.titre')}</CardTitle>
        <CardDescription>{t('tableauBord:activite.enRetardCarte.description')}</CardDescription>
      </CardHeader>
      <div className="px-carte pb-carte">{contenu}</div>
    </Card>
  );
}
