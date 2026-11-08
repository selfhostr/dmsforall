import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FiltreSite as EtatFiltreSite } from '@/hooks/site/useFiltreSite';
import { TOUS_LES_SITES } from '@/hooks/site/sites';

interface Props {
  readonly filtre: EtatFiltreSite;
  readonly className?: string;
}

/**
 * Filtre de site compact d'un écran : toujours une liste déroulante étroite affichant le code court
 * (« MART », « SION »), quel que soit le nombre de sites. Masqué d'office avec un seul site actif. Le choix est mémorisé par
 * écran (`useFiltreSite`) ; l'option « Tous » n'apparaît que si les droits le permettent.
 */
export function FiltreSite({ filtre, className }: Props): ReactElement | null {
  const { t } = useTranslation('commun');
  if (!filtre.visible) return null;

  const options = [
    ...(filtre.tousPropose
      ? [
          {
            valeur: TOUS_LES_SITES as string,
            libelle: t('commun:filtreSite.tous'),
            titre: t('commun:filtreSite.titreTous'),
          },
        ]
      : []),
    ...filtre.sites.map((site) => ({
      valeur: site.id,
      libelle: site.codeCourt,
      titre: site.nom,
    })),
  ];
  const valeur = filtre.siteId ?? TOUS_LES_SITES;
  const changer = (v: string) => filtre.choisir(v === TOUS_LES_SITES ? undefined : v);

  return (
    <div className={className} data-testid="filtre-site">
      <Select value={valeur} onValueChange={changer}>
        <SelectTrigger
          aria-label={t('commun:filtreSite.libelle')}
          className="w-auto min-w-24 gap-2"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.valeur} value={option.valeur} title={option.titre}>
              {option.libelle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
