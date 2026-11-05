import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { RoleUtilisateur } from '@dfa/shared';

import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useSession } from '@/hooks/useSession';

import { BandeauPrioriteTableauBord } from './composants/BandeauPrioriteTableauBord';
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
 * chef d'atelier, réceptionnaire, choix produit du 10.08.2026, voir `routes/atterrissage.ts`),
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
  const { definirPreferenceSite } = useSiteCourant();

  // DÉFAUT MESURÉ CORRIGÉ (lot « bandeau haut », 26.08.2026) : avant ce lot, AUCUN choix fait ici
  // — site précis ou « Tous les sites » — ne synchronisait `ContexteSiteCourant`, contrairement à
  // `SelecteurSiteEntete.tsx` (le sélecteur global du chrome), seul autre point d'écriture de la
  // préférence. Conséquence observée : choisir un site B ici pendant que la préférence globale
  // valait encore A, puis revenir à « Tous les sites » (qui retire `?site=` de l'URL), faisait
  // retomber le CHROME (et donc la navigation suivante d'un clic de menu) sur l'ANCIEN site A —
  // jamais B, jamais signalé. Corrigé en synchronisant la préférence dès qu'un site PRÉCIS est
  // choisi ICI, exactement comme le fait déjà le sélecteur global. « Tous les sites » reste
  // volontairement NON persisté (doctrine inchangée de `ContexteSiteCourant.tsx`) : un survol
  // furtif sur l'agrégat ne doit pas écraser le dernier site réel de travail, dont dépendent des
  // écrans qui EXIGENT un site (pièces, ventes) — seul un choix EXPLICITE d'un site précis doit
  // devenir le nouveau défaut.
  function changerSite(nouveauSiteId: string | undefined) {
    const parametres = new URLSearchParams(searchParams);
    if (nouveauSiteId) {
      parametres.set('site', nouveauSiteId);
      definirPreferenceSite(nouveauSiteId);
    } else {
      parametres.delete('site');
    }
    setSearchParams(parametres);
  }

  const role: RoleUtilisateur | undefined = session?.utilisateur.role;

  return (
    // `densite-dense` (index.css) : écran de pilotage lu à distance sur un poste de bureau, jamais
    // sur la tablette d'atelier (`docs/design-tableau-bord-par-role.md`) — le même gabarit de
    // densité que « comptoir » (`components/ui/card.tsx`), qui resserre le rembourrage des cartes
    // (24→16px), l'échelle typographique (titres/corps/chiffre géant) et les espacements
    // sémantiques (`gap-section`/`gap-groupe` ci-dessous dans chaque `TableauBord<Role>`) sans
    // toucher aux CIBLES TACTILES : `Button`/`SelectTrigger`/`DateInput` posent une hauteur fixe
    // (`h-11`, 44px) indépendante de ces tokens (vérifié dans leurs fichiers respectifs), donc aucun
    // contrôle interactif de cet écran ne rétrécit sous 44px. Chantier « tableau de bord tient sans
    // défilement » (retour produit du 16.08.2026, périmètre `ecrans/tableau-bord/**`).
    <GabaritEcran titre={t('tableauBord:titre')} className="densite-dense">
      <SelecteurSiteTableauBord
        sites={session?.sites ?? []}
        siteId={siteId}
        onChange={changerSite}
      />

      {/* Bandeau de priorité (lot « bandeau haut », 26.08.2026) — PLEINE LARGEUR, commun à tous les
          rôles, posé AVANT le contenu par rôle ci-dessous (donc avant lui à la tabulation). Absent
          de lui-même (`null`) tant qu'aucun OR en retard ni aucune facture impayée n'est confirmé
          pour le rôle courant — voir la doc de tête de `BandeauPrioriteTableauBord.tsx` pour le
          détail du choix des deux compteurs (zéro nouvel appel réseau : réutilise à l'identique des
          requêtes déjà déclenchées plus bas dans l'arbre par rôle). */}
      <BandeauPrioriteTableauBord role={role} site={siteId} />

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
    </GabaritEcran>
  );
}
