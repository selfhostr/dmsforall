import { useTranslation } from 'react-i18next';

import type { SessionCourante } from '@dfa/shared';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const VALEUR_TOUS_LES_SITES = 'tous';

interface Props {
  readonly sites: SessionCourante['sites'];
  readonly siteId: string | undefined;
  readonly onChange: (siteId: string | undefined) => void;
}

/**
 * Filtre de site du tableau de bord — OPTIONNEL, contrairement à `SelecteurSiteRequis` (module
 * pièces) qui force un choix : `siteId` absent est un état légitime ici (agrège TOUS les sites du
 * tenant, `ReponseActiviteTableauBord.siteId: string | null`), pas un blocage à lever. Même patron
 * que `EnTete.tsx` (« Tous les sites » comme option EXPLICITE, jamais une valeur devinée) et que le
 * filtre type véhicule d'`EcranListeVehiculesStock.tsx` (sentinelle non vide, Radix Select
 * n'accepte pas `value=""`). Ne liste que les sites ACTIFS de la session.
 */
export function SelecteurSiteTableauBord({ sites, siteId, onChange }: Props) {
  const { t } = useTranslation('navigation');
  const sitesActifs = sites.filter((site) => site.actif);

  return (
    <Select
      value={siteId ?? VALEUR_TOUS_LES_SITES}
      onValueChange={(valeur) => onChange(valeur === VALEUR_TOUS_LES_SITES ? undefined : valeur)}
    >
      <SelectTrigger aria-label={t('navigation:entete.tousLesSites')} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={VALEUR_TOUS_LES_SITES}>{t('navigation:entete.tousLesSites')}</SelectItem>
        {sitesActifs.map((site) => (
          <SelectItem key={site.id} value={site.id}>
            {site.nom}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
