import { useTranslation } from 'react-i18next';

import type { RoleUtilisateur } from '@dfa/shared';

import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { ActionsRapidesAccueil } from '@/ecrans/accueil/composants/ActionsRapidesAccueil';
import { AFaireAujourdhui } from '@/ecrans/accueil/composants/AFaireAujourdhui';
import { ChecklistDemarrage } from '@/ecrans/accueil/composants/ChecklistDemarrage';
import { estRoleAccueilBureau, voitAFaireAujourdhui } from '@/ecrans/accueil/droits';
import { useSitePrincipal } from '@/hooks/site/useSitePrincipal';
import { useSession } from '@/hooks/useSession';

import { BandeauPrioriteTableauBord } from './composants/BandeauPrioriteTableauBord';
import { TableauBordAdmin } from './TableauBordAdmin';
import { TableauBordMagasinier } from './TableauBordMagasinier';
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
 * AUCUN filtre de site : l'accueil montre toujours l'entreprise entière. Le sélecteur de PÉRIODE, en revanche, N'EST
 * PLUS générique : seuls Direction et Comptable en ont un, scopé à leur propre bloc CA/encaissements
 * (voir `TableauBordDirection`/`TableauBordComptable`) — un sélecteur unique au-dessus de blocs à
 * sémantique de date différente (« sorties du jour » vs « CA du mois ») serait trompeur.
 */
export function EcranTableauBord() {
  const { t } = useTranslation('tableauBord');
  const { data: session } = useSession();
  // Accueil = l'entreprise entière : aucun filtre de site (décision produit). Les blocs
  // personnels (mes RDV, mes tâches) se filtrent par la personne connectée, pas par site.
  const sitePrincipal = useSitePrincipal();

  const role: RoleUtilisateur | undefined = session?.utilisateur.role;
  const accueilBureau = estRoleAccueilBureau(role);

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
    <GabaritEcran
      titre={t('tableauBord:titre')}
      titreVisible={false}
      className="group/accueil densite-dense"
    >
      {/* Bandeau de priorité (lot « bandeau haut », 26.08.2026) — PLEINE LARGEUR, commun à tous les
          rôles, posé AVANT le contenu par rôle ci-dessous (donc avant lui à la tabulation). Absent
          de lui-même (`null`) tant qu'aucun OR en retard ni aucune facture impayée n'est confirmé
          pour le rôle courant — voir la doc de tête de `BandeauPrioriteTableauBord.tsx` pour le
          détail du choix des deux compteurs (zéro nouvel appel réseau : réutilise à l'identique des
          requêtes déjà déclenchées plus bas dans l'arbre par rôle). */}
      {/* Accueil orienté tâche (rôles de bureau) : taper une plaque, un nom ou un n° d'OR, puis les
          gestes qui lancent la journée, AVANT tout chiffre. Le tableau de bord par rôle (chiffres,
          état du parc) suit plus bas. */}
      {accueilBureau ? (
        <div className="flex flex-col gap-groupe">
          <ActionsRapidesAccueil site={undefined} />
        </div>
      ) : null}

      <ChecklistDemarrage />

      <BandeauPrioriteTableauBord role={role} site={undefined} />

      {voitAFaireAujourdhui(role) ? (
        <AFaireAujourdhui role={role} actions={session?.actions} site={undefined} />
      ) : null}

      {(() => {
        switch (role) {
          // Direction, comptable, chef d'atelier, réceptionnaire : l'accueil ne montre que les
          // tâches du jour (`AFaireAujourdhui`). Leurs chiffres (CA, encours, répartition par
          // statut) ont quitté l'accueil : Facturation > Chiffres (`ecrans/facturation/chiffres`).
          case 'magasinier':
            return <TableauBordMagasinier site={sitePrincipal} sites={session?.sites ?? []} />;
          case 'technicien':
            return <TableauBordTechnicien site={undefined} />;
          case 'admin':
            return <TableauBordAdmin site={undefined} />;
          case 'vendeur':
            return <TableauBordVendeurIndisponible site={undefined} />;
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
