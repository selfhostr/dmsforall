import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { EtatVide } from '@/composants/commun/EtatVide';
import { chemins } from '@/routes/chemins';

interface Props {
  readonly site: string | undefined;
}

/**
 * Vendeur — AUCUN bloc construit, DÉLIBÉRÉMENT (`docs/design-tableau-bord-par-role.md` §3.6).
 * `FiltresDossiersVente` (`packages/shared/src/contrats/ventes/...`) n'a ni `vendeurId` ni
 * `responsableId`, et `ReponseDossierVente` ne porte aucun vendeur responsable — vérifié dans ce
 * lot, pas seulement recopié du design : sans ce filtre, un tableau de bord vendeur montrerait
 * TOUS les dossiers du site, pas « SES » dossiers, ce qui contredirait le principe même de la
 * demande de @laupernoe (un tableau de bord adapté au rôle). Un bloc à moitié construit serait pire que
 * rien : cet écran l'annonce honnêtement plutôt que de fabriquer un widget bancal, et renvoie vers
 * son vrai plan de travail (`routes/atterrissage.ts` l'y fait déjà atterrir, inchangé).
 *
 * Rôle atteint UNIQUEMENT en visitant `/tableau-bord` explicitement (il n'y atterrit jamais) —
 * §1 de l'arbitrage : les rôles d'exécution gardent leur écran de travail comme atterrissage.
 */
export function TableauBordVendeurIndisponible({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);

  return (
    <EtatVide
      titre={t('tableauBord:vendeur.indisponible.titre')}
      description={t('tableauBord:vendeur.indisponible.description')}
      action={
        <Button asChild>
          <Link to={chemins.ventes.dossiers.liste(site)}>
            {t('tableauBord:vendeur.indisponible.lien')}
          </Link>
        </Button>
      }
    />
  );
}
