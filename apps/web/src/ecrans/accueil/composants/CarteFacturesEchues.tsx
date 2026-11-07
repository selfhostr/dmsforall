import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import { useFacturesEchues } from '@/hooks/accueil/useFacturesEchues';
import { chemins } from '@/routes/chemins';

import { CarteListeAFaire } from './CarteListeAFaire';

interface Props {
  readonly site: string | undefined;
}

/** Factures émises dont l'échéance est dépassée : qui doit encore combien, et depuis quand. */
export function CarteFacturesEchues({ site }: Props) {
  const { t } = useTranslation('accueil');
  const requete = useFacturesEchues(site);
  const factures = requete.data?.donnees ?? [];

  return (
    <CarteListeAFaire
      titre={t('aFaire.facturesEchues.titre')}
      description={t('aFaire.facturesEchues.description')}
      videTitre={t('aFaire.facturesEchues.vide.titre')}
      videDescription={t('aFaire.facturesEchues.vide.description')}
      requete={requete}
      lienToutVoir={
        requete.data?.curseurSuivant
          ? { to: chemins.facturation.liste(site), texte: t('aFaire.toutVoir') }
          : undefined
      }
      lignes={factures.map((facture) => (
        <Link
          key={facture.id}
          to={chemins.facturation.detail(facture.id, site)}
          className="flex min-h-11 items-center justify-between gap-3 rounded p-1.5 py-2 hover:bg-muted"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate texte-corps font-medium text-foreground">
              {facture.clientDesignation}
            </span>
            <span className="texte-libelle text-muted-foreground">{facture.numero}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {facture.joursRetard ? (
              <BadgeStatut icone={AlertTriangle} token="danger" forme="contour">
                {t('aFaire.facturesEchues.retard', { count: facture.joursRetard })}
              </BadgeStatut>
            ) : null}
          </span>
        </Link>
      ))}
    />
  );
}
