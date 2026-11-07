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
  /** Clés i18n complètes (namespace compris) — même donnée, texte différent selon qui regarde
   *  (« sorties du jour » chef d'atelier, « sorties du soir » direction, §5 du design : « Même
   *  endpoint, même composant, prop de fenêtre différente »). */
  readonly titreCle: string;
  readonly descriptionCle: string;
  readonly videTitreCle: string;
  readonly videDescriptionCle: string;
}

/**
 * Restitutions promises AUJOURD'HUI (fenêtre resserrée à un jour) — même source que
 * `ecrans/accueil/composants/CalendrierEcheances.tsx` (`GET /ordres-reparation`, bornes
 * `restitutionPromiseDu`/`Au`), reprise pour Direction, Chef d'atelier ET Réceptionnaire (§ constat
 * @laupernoe du 12.08.2026 : son ancien bloc « calendrier de la semaine » ne répondait pas à « qu'est-ce
 * qui sort AUJOURD'HUI ») — même endpoint, même composant, prop de fenêtre différente. Liste plutôt
 * que grille de 7 colonnes : un seul jour n'a pas besoin du gabarit hebdomadaire.
 *
 * Marque un OR `enRetard` (`OrdreReparationResume.enRetard`, calculé UNE SEULE FOIS côté serveur —
 * jamais rederivé ici, voir sa doc dans `contrats/atelier/ordre-reparation.ts`) d'un tag distinct,
 * ACCOLÉ au badge de statut, jamais une variante de couleur du badge lui-même (même doctrine que
 * `IndicateurRetard`, `ecrans/facturation/`).
 */
export function CarteRestitutionsJour({
  site,
  titreCle,
  descriptionCle,
  videTitreCle,
  videDescriptionCle,
}: Props) {
  const { t } = useTranslation(['accueil', 'or', 'commun', 'erreurs', 'tableauBord']);
  const aujourdhui = useMemo(() => versDateIsoLocale(new Date()), []);

  const requete = useEcheancesOr({
    restitutionPromiseDu: aujourdhui,
    restitutionPromiseAu: aujourdhui,
    siteId: site,
  });

  const ordres = requete.data?.donnees ?? [];
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
    contenu = <EtatVide titre={t(videTitreCle)} description={t(videDescriptionCle)} />;
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
                {or.enRetard ? (
                  <BadgeStatut icone={AlertTriangle} token="danger" forme="contour">
                    {t('tableauBord:activite.enRetard')}
                  </BadgeStatut>
                ) : null}
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
        <CardTitle>{t(titreCle)}</CardTitle>
        <CardDescription>{t(descriptionCle)}</CardDescription>
      </CardHeader>
      <div className="px-carte pb-carte">{contenu}</div>
    </Card>
  );
}
