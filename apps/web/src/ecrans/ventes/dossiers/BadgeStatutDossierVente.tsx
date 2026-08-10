import {
  Ban,
  FileCheck,
  KeyRound,
  Lock,
  PackageCheck,
  Search,
  UserX,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutDossierVente } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut du dossier de vente (`STATUTS_DOSSIER_VENTE`, §6.2, machine à états GELÉE) —
 * même patron que `BadgeStatutOr` (étape 1) : forme + icône + mot, jamais la couleur seule
 * (vérification daltonisme). Le rendu et les classes des tokens `--statut-*` sont désormais
 * factorisés dans `BadgeStatut` (`composants/identite/`), partagé avec `BadgeStatutOr` et
 * `BadgeStatutVehiculeStock` — seul le mapping métier `STATUTS_DOSSIER_VENTE -> {icone, token,
 * forme}` reste local à ce sous-domaine. Doctrine encore appliquée par
 * `BadgeTypeDocument`/`BadgeEtatDocument`, locaux à `ecrans/facturation/` (hors périmètre de cette
 * factorisation).
 */
interface EntreeStatut {
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutDossierVente, EntreeStatut>> = {
  prospection: { cle: 'prospection', icone: Search, token: 'neutre', forme: 'contour' },
  engage: { cle: 'engage', icone: FileCheck, token: 'info', forme: 'plein' },
  en_preparation: { cle: 'enPreparation', icone: Wrench, token: 'info', forme: 'plein' },
  pret_a_livrer: { cle: 'pretALivrer', icone: PackageCheck, token: 'succes', forme: 'plein' },
  livre: { cle: 'livre', icone: KeyRound, token: 'succes', forme: 'plein' },
  clos: { cle: 'clos', icone: Lock, token: 'terminal', forme: 'contour' },
  // `Ban`/`UserX`, jamais une icône de suppression — même doctrine que `BadgeStatutOr`.
  annule: { cle: 'annule', icone: Ban, token: 'danger', forme: 'contour' },
  abandonne: { cle: 'abandonne', icone: UserX, token: 'danger', forme: 'contour' },
};

interface Props {
  readonly statut: StatutDossierVente;
  readonly className?: string;
}

export function BadgeStatutDossierVente({ statut, className }: Props) {
  const { t } = useTranslation('ventes');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`ventes:dossier.statuts.${config.cle}`)}
    </BadgeStatut>
  );
}
