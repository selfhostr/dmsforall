import { AlertTriangle, Receipt } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { RoleUtilisateur } from '@dfa/shared';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import { versDateIsoLocale } from '@/ecrans/accueil/semaine';
import { useEcheancesOr } from '@/hooks/accueil/useEcheancesOr';
import { useFinancierTableauBord } from '@/hooks/tableau-bord/useFinancierTableauBord';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

/** Rôles dont le tableau de bord monte DÉJÀ `CarteOrEnRetard` (`TableauBordDirection`/
 *  `TableauBordChefAtelier`/`TableauBordReceptionnaire`, mêmes filtres `useEcheancesOr` — voir plus
 *  bas) : seuls ceux-là déclenchent ici la requête « OR en retard ». contrainte produit (« aucune
 *  requête API supplémentaire ») : réutiliser EXACTEMENT le même hook, les mêmes paramètres et donc
 *  la MÊME clé TanStack Query que la carte descendante fait que les deux composants (ce bandeau,
 *  monté juste au-dessus, et la carte, montée juste en dessous dans le même commit React) PARTAGENT
 *  une seule requête réseau — comportement de déduplication documenté de TanStack Query, pas un
 *  bricolage. Élargir cette liste à un rôle dont AUCUN descendant ne fait déjà cet appel
 *  déclencherait un VRAI appel réseau supplémentaire : ne pas le faire sans en reparler à @laupernoe. */
const ROLES_OR_EN_RETARD: readonly RoleUtilisateur[] = [
  'chef_atelier',
  'direction',
  'receptionnaire',
];

/** Rôles autorisés sur `GET /tableau-bord/financier` (RF-115) — CE SONT AUSSI, aujourd'hui, exactement les deux rôles dont le
 *  tableau de bord monte déjà `useFinancierTableauBord` avec le même filtre `{ siteId }` par défaut
 *  (`TableauBordDirection`/`TableauBordComptable`), donc même déduplication que ci-dessus. Jamais
 *  `admin` : séparation des pouvoirs délibérée, verrouillée par `EcranTableauBord.spec.tsx` (test
 *  F8, non-fuite — un `CHF` dans le DOM d'admin fait échouer ce test). */
const ROLES_FACTURES_IMPAYEES: readonly RoleUtilisateur[] = ['direction', 'comptable'];

const ID_TITRE = 'bandeau-priorite-tableau-bord-titre';

interface Props {
  readonly role: RoleUtilisateur | undefined;
  readonly site: string | undefined;
}

/**
 * Bandeau de priorité — pleine largeur, monté par `EcranTableauBord` juste au-dessus du contenu
 * par rôle (avant lui dans le flux DOM, donc avant lui à la tabulation). Porte ce qui exige une
 * action AUJOURD'HUI : les OR en retard, les factures impayées. Absent — `null`, jamais un
 * espace réservé ni un skeleton — tant qu'aucune des deux valeurs n'est confirmée strictement
 * positive : ni un bandeau « tout va bien » quand tout est à zéro, ni un bandeau qui clignote
 * pendant le chargement pour finalement disparaître.
 *
 * ZÉRO NOUVEL APPEL RÉSEAU (contrainte produit explicite) — les deux compteurs réutilisent, à
 * l'identique, des requêtes que CE MÊME ÉCRAN déclenche déjà pour le rôle courant :
 *  - « OR en retard » : `useEcheancesOr` avec les MÊMES paramètres (`restitutionPromiseAu`
 *    = aujourd'hui, `siteId`) que `CarteOrEnRetard.tsx`, filtré sur `enRetard === true` — calculé
 *    UNE SEULE FOIS côté serveur, jamais rederivé ici (même doctrine que `CarteOrEnRetard`).
 *  - « Factures impayées » : `encoursClientsCentimes` de `useFinancierTableauBord` — SNAPSHOT déjà
 *    lu par `TableauBordDirection`/`TableauBordComptable` sous le libellé « Encours clients »
 *    (`Σ document_vente.soldeCentimes` des factures ÉMISES encore dues). Un MONTANT, pas un compte
 *    de documents : le compte exact « à relancer » (`FILTRE_A_RELANCER`,
 *    `useListeDocumentsVente`) n'est aujourd'hui interrogé QUE par `TableauBordComptable`, jamais
 *    par `TableauBordDirection` — le reprendre ici pour `direction` aurait donc été un VRAI nouvel
 *    appel pour ce rôle, exactement le cas que @laupernoe a demandé de signaler plutôt que d'ajouter de
 *    soi-même. `encoursClientsCentimes`, disponible identiquement aux DEUX rôles financiers dès le
 *    premier rendu (même filtre par défaut `{ siteId }`, sans `du`/`au`), est la seule donnée qui
 *    satisfait la contrainte pour les deux à la fois — voir le rapport de livraison pour le détail.
 *
 * Conséquence assumée de cette contrainte : la ligne « OR en retard » ne s'affiche jamais pour
 * `comptable` (son tableau de bord ne monte pas `CarteOrEnRetard`), et la ligne « factures
 * impayées » ne s'affiche jamais pour `chef_atelier`/`receptionnaire` (aucun droit financier,
 * RF-115) ni pour `magasinier`/`technicien`/`vendeur`/`admin` (aucune des deux données n'est
 * fetchée par leur tableau de bord aujourd'hui). Un rôle sans AUCUNE des deux ne monte donc AUCUNE
 * requête depuis ce composant — vérifié par les tests de non-fuite existants
 * (`EcranTableauBord.spec.tsx`, Admin/Vendeur/Magasinier/Technicien).
 *
 * PAS d'état de chargement ni d'erreur dédié ici (délibéré, cohérent avec « pas un espace
 * réservé ») : les DEUX requêtes réutilisées alimentent aussi une carte de la grille rendue juste
 * en dessous (`CarteOrEnRetard`/`CarteChiffreRequete`), qui affiche déjà l'erreur avec réessai sur
 * le MÊME résultat de requête (même `queryKey`) — dupliquer ce message ici serait redondant, pas
 * plus honnête.
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
      : undefined;

  const facturesImpayeesActif = role !== undefined && ROLES_FACTURES_IMPAYEES.includes(role);
  const financier = useFinancierTableauBord({ siteId: site }, facturesImpayeesActif);
  const encoursClientsCentimes =
    facturesImpayeesActif && financier.isSuccess
      ? financier.data.encoursClientsCentimes
      : undefined;

  const afficherOrEnRetard = (nombreOrEnRetard ?? 0) > 0;
  const afficherFacturesImpayees = (encoursClientsCentimes ?? 0) > 0;

  if (!afficherOrEnRetard && !afficherFacturesImpayees) {
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

      {afficherOrEnRetard ? (
        <Link
          to={chemins.atelier.ordresReparation.liste(site)}
          className="anneau-focus inline-flex rounded-md"
        >
          <BadgeStatut icone={AlertTriangle} token="danger" forme="plein">
            {t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: nombreOrEnRetard })}
          </BadgeStatut>
        </Link>
      ) : null}

      {afficherFacturesImpayees ? (
        <Link to={chemins.facturation.liste(site)} className="anneau-focus inline-flex rounded-md">
          <BadgeStatut icone={Receipt} token="danger" forme="plein">
            {t('tableauBord:bandeauPriorite.facturesImpayees.libelle', {
              montant: `CHF ${formaterMontant(encoursClientsCentimes ?? 0)}`,
            })}
          </BadgeStatut>
        </Link>
      ) : null}
    </div>
  );
}
