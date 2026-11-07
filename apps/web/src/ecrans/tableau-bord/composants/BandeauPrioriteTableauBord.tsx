import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { RoleUtilisateur } from '@dfa/shared';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import { versDateIsoLocale } from '@/ecrans/accueil/semaine';
import { useEcheancesOr } from '@/hooks/accueil/useEcheancesOr';
import { chemins } from '@/routes/chemins';

/** Rôles dont l'accueil monte DÉJÀ `CarteOrEnRetard` (mêmes filtres `useEcheancesOr`) : seuls
 *  ceux-là déclenchent ici la requête « OR en retard », qui partage la MÊME clé TanStack Query que
 *  la carte (une seule requête réseau). Élargir cette liste à un rôle sans cette carte ajouterait
 *  un vrai appel réseau. */
const ROLES_OR_EN_RETARD: readonly RoleUtilisateur[] = [
  'chef_atelier',
  'direction',
  'receptionnaire',
];

const ID_TITRE = 'bandeau-priorite-tableau-bord-titre';

interface Props {
  readonly role: RoleUtilisateur | undefined;
  readonly site: string | undefined;
}

/**
 * Bandeau de priorité — pleine largeur, au-dessus des tâches du jour. Porte ce qui exige une
 * action AUJOURD'HUI : les OR en retard. Absent (`null`, jamais un espace réservé ni un skeleton)
 * tant qu'aucun OR en retard n'est confirmé.
 *
 * Les factures impayées n'y figurent plus : un montant n'a pas sa place sur l'accueil (il vit dans
 * Facturation > Chiffres), et la carte « Factures échues » liste déjà les clients à relancer.
 *
 * PAS d'état de chargement ni d'erreur dédié : la requête réutilisée alimente aussi `CarteOrEnRetard`,
 * qui affiche déjà l'erreur avec réessai sur le même résultat.
 */
export function BandeauPrioriteTableauBord({ role, site }: Props) {
  const { t } = useTranslation('tableauBord');
  const aujourdhui = useMemo(() => versDateIsoLocale(new Date()), []);

  const orEnRetardActif = role !== undefined && ROLES_OR_EN_RETARD.includes(role);
  const echeances = useEcheancesOr(
    { restitutionPromiseAu: aujourdhui, siteId: site },
    { enabled: orEnRetardActif },
  );
  const nombreOrEnRetard =
    orEnRetardActif && echeances.isSuccess
      ? echeances.data.donnees.filter((or) => or.enRetard === true).length
      : 0;

  if (nombreOrEnRetard === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-labelledby={ID_TITRE}
      className="flex flex-col gap-2 rounded-lg border border-statut-danger bg-card p-carte-compacte sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
    >
      <span id={ID_TITRE} className="texte-libelle font-semibold text-statut-danger">
        {t('tableauBord:bandeauPriorite.titre')}
      </span>

      <Link
        to={chemins.atelier.ordresReparation.liste(site)}
        className="anneau-focus inline-flex rounded-md"
      >
        <BadgeStatut icone={AlertTriangle} token="danger" forme="plein">
          {t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: nombreOrEnRetard })}
        </BadgeStatut>
      </Link>
    </div>
  );
}
