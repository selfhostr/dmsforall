import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { RoleUtilisateur } from '@dfa/shared';

import { useSession } from '@/hooks/useSession';

import { SelecteurSiteTableauBord } from './SelecteurSiteTableauBord';
import { TableauBordAdmin } from './TableauBordAdmin';
import { TableauBordChefAtelier } from './TableauBordChefAtelier';
import { TableauBordComptable } from './TableauBordComptable';
import { TableauBordDirection } from './TableauBordDirection';
import { TableauBordMagasinier } from './TableauBordMagasinier';
import { TableauBordReceptionnaire } from './TableauBordReceptionnaire';
import { TableauBordTechnicien } from './TableauBordTechnicien';
import { TableauBordVendeurIndisponible } from './TableauBordVendeurIndisponible';

/**
 * Tableau de bord fusionné — écran d'ATTERRISSAGE des rôles de pilotage (direction, comptable,
 * chef d'atelier, réceptionnaire, arbitrage de @laupernoe du 10.08.2026, voir `routes/atterrissage.ts`),
 * atteignable en un clic pour tout le monde d'autre (sauf `poste_atelier`, jamais concerné — la
 * garde de route `ROLES_TABLEAU_BORD_ACTIVITE` l'exclut déjà, `routes/routeur.tsx`).
 *
 * Remplace DEUX écrans distincts (`EcranAccueil` + l'ancien `EcranTableauBord` à deux blocs figés
 * identiques pour tous, `docs/design-tableau-bord-par-role.md` §0/§2) : ce composant hôte ne rend
 * plus de contenu lui-même — il lit `session.utilisateur.role` UNE FOIS et délègue à un composant
 * de dashboard PAR RÔLE, plafonné à 5 blocs chacun (§6 du design : « une fonction de sélection de
 * blocs par rôle, pas neuf écrans séparés » — au sens SÉMANTIQUE : neuf compositions différentes
 * des mêmes sous-blocs réutilisables, pas neuf implémentations indépendantes).
 *
 * SÉPARATION DES POUVOIRS (RF-115, le point le plus important de cet écran, INCHANGÉ depuis
 * l'ancienne version) : aucun montant n'atteint le DOM pour `admin` — `TableauBordAdmin` ne
 * contient structurellement aucun accès au bloc financier, jamais un composant masqué/grisé à sa
 * place. Verrouillé par `EcranTableauBord.spec.tsx` (test F8, non-fuite).
 *
 * Site PARTAGÉ par tous les rôles (`SelecteurSiteTableauBord`, en-tête commune, §2 du design) —
 * synchronisé avec `?site=` comme le reste de l'app. Le sélecteur de PÉRIODE, en revanche, N'EST
 * PLUS générique : seuls Direction et Comptable en ont un, scopé à leur propre bloc CA/encaissements
 * (voir `TableauBordDirection`/`TableauBordComptable`) — un sélecteur unique au-dessus de blocs à
 * sémantique de date différente (« sorties du jour » vs « CA du mois ») serait trompeur.
 */
export function EcranTableauBord() {
  const { t } = useTranslation('tableauBord');
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const siteId = searchParams.get('site') ?? undefined;

  function changerSite(nouveauSiteId: string | undefined) {
    const parametres = new URLSearchParams(searchParams);
    if (nouveauSiteId) {
      parametres.set('site', nouveauSiteId);
    } else {
      parametres.delete('site');
    }
    setSearchParams(parametres);
  }

  const role: RoleUtilisateur | undefined = session?.utilisateur.role;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="texte-titre-page font-semibold text-foreground">{t('tableauBord:titre')}</h1>

      <SelecteurSiteTableauBord
        sites={session?.sites ?? []}
        siteId={siteId}
        onChange={changerSite}
      />

      {(() => {
        switch (role) {
          case 'direction':
            return <TableauBordDirection site={siteId} />;
          case 'comptable':
            return <TableauBordComptable site={siteId} />;
          case 'chef_atelier':
            return <TableauBordChefAtelier site={siteId} />;
          case 'receptionnaire':
            return <TableauBordReceptionnaire site={siteId} />;
          case 'magasinier':
            return <TableauBordMagasinier site={siteId} sites={session?.sites ?? []} />;
          case 'technicien':
            return <TableauBordTechnicien site={siteId} />;
          case 'admin':
            return <TableauBordAdmin site={siteId} />;
          case 'vendeur':
            return <TableauBordVendeurIndisponible site={siteId} />;
          // `poste_atelier` et `undefined` (session pas encore résolue — improbable ici, la
          // garde de route attend déjà `data !== null`) : rien à rendre, la route elle-même ferme
          // déjà `poste_atelier` (`ROLES_TABLEAU_BORD_ACTIVITE`, `routes/routeur.tsx`).
          default:
            return null;
        }
      })()}
    </div>
  );
}
