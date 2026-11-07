import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { Plaque } from '@/composants/identite/Plaque';
import { useOrParFiltre, type FiltreOrAFaire } from '@/hooks/accueil/useOrParFiltre';
import { chemins } from '@/routes/chemins';

import { CarteListeAFaire } from './CarteListeAFaire';

interface Props {
  readonly site: string | undefined;
  readonly filtre: Omit<FiltreOrAFaire, 'siteId'>;
  /** Clé i18n (namespace `accueil`) du bloc : `aFaire.<cle>.titre|description|vide.*`. */
  readonly cle: 'aFacturer' | 'accordClient';
  /** `facturer` mène droit à l'écran de facturation de l'OR ; sinon à sa fiche. */
  readonly destination: 'fiche' | 'facturer';
}

/** Liste courte d'OR à traiter (terminés à facturer, en attente d'accord du client). */
export function CarteOrAFaire({ site, filtre, cle, destination }: Props) {
  const { t } = useTranslation('accueil');
  const requete = useOrParFiltre({ ...filtre, siteId: site });
  const ordres = requete.data?.donnees ?? [];
  const aPlus = Boolean(requete.data?.curseurSuivant);

  return (
    <CarteListeAFaire
      titre={t(`aFaire.${cle}.titre`)}
      description={t(`aFaire.${cle}.description`)}
      videTitre={t(`aFaire.${cle}.vide.titre`)}
      videDescription={t(`aFaire.${cle}.vide.description`)}
      requete={requete}
      lienToutVoir={
        aPlus
          ? { to: chemins.atelier.ordresReparation.liste(site), texte: t('aFaire.toutVoir') }
          : undefined
      }
      lignes={ordres.map((or) => (
        <Link
          key={or.id}
          to={
            destination === 'facturer'
              ? chemins.atelier.ordresReparation.facturer(or.id, site)
              : chemins.atelier.ordresReparation.detail(or.id, site)
          }
          className="flex min-h-11 items-center justify-between gap-3 rounded p-1.5 py-2 hover:bg-muted"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Plaque canton={or.vehicule.canton} numero={or.vehicule.plaque} taille="sm" />
            <span className="truncate texte-libelle text-muted-foreground">
              {or.client.nomAffiche}
            </span>
          </span>
          <BadgeStatutOr etat={or.etatAffiche} />
        </Link>
      ))}
    />
  );
}
