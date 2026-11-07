import type { ActionsSession } from '@/droits';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RoleUtilisateur } from '@dfa/shared';

import { peutLireEcheancesOr } from '@/ecrans/accueil/droits';
import { peutEmettreFacture, peutEncaisser } from '@/ecrans/facturation/droits';
import { peutLireRendezVous } from '@/ecrans/rendez-vous/droits';
import { CarteOrEnRetard } from '@/ecrans/tableau-bord/composants/CarteOrEnRetard';
import { CarteRendezVousJour } from '@/ecrans/tableau-bord/composants/CarteRendezVousJour';
import { CarteRestitutionsJour } from '@/ecrans/tableau-bord/composants/CarteRestitutionsJour';

import { CarteFacturesEchues } from './CarteFacturesEchues';
import { CarteOrAFaire } from './CarteOrAFaire';

/**
 * Cellule de la grille « à faire » : la carte qu'elle contient prend toute la hauteur de la rangée
 * (deux cartes voisines ont donc la même hauteur, quel que soit le nombre de lignes de chacune) et
 * défile à l'intérieur d'elle-même au-delà d'un plafond, plutôt que d'étirer toute la rangée.
 */
function CelluleCarte({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col [&>*]:h-full [&>*]:max-h-[26rem] [&>*]:overflow-y-auto">
      {children}
    </div>
  );
}

interface Props {
  readonly role: RoleUtilisateur | undefined;
  readonly actions: ActionsSession;
  readonly site: string | undefined;
}

/** Titres de la carte « restitutions du jour » : le même composant, le vocabulaire du rôle. */
const CLES_RESTITUTIONS: Readonly<Record<string, string>> = {
  direction: 'tableauBord:direction.sortiesDuSoir',
  chef_atelier: 'tableauBord:chefAtelier.sortiesDuJour',
  receptionnaire: 'tableauBord:receptionnaire.restitutionsJour',
};

/**
 * « À faire aujourd'hui » : ce qu'il faut traiter avant ce soir, dans l'ordre où le garagiste y
 * pense — qui arrive (rendez-vous, téléphone sous la main), qui repart ou est en retard, ce qui est
 * terminé et pas encore facturé, ce que les clients doivent, et les travaux qui attendent leur
 * accord. Chaque bloc n'apparaît que pour les rôles qui peuvent agir dessus ; les cartes de
 * rendez-vous, de restitution et de retard sont celles que les tableaux de bord par rôle
 * affichaient déjà (aucun bloc perdu, seulement remonté ici).
 */
export function AFaireAujourdhui({ role, actions, site }: Props) {
  const { t } = useTranslation('accueil');
  const cles = (role && CLES_RESTITUTIONS[role]) ?? CLES_RESTITUTIONS.receptionnaire;

  return (
    <section aria-labelledby="accueil-a-faire-titre" className="flex flex-col gap-groupe">
      {/* Titre lu par les lecteurs d'écran, visible seulement quand la carte « Démarrer votre
          garage » (`data-demarrage`) est affichée au-dessus : il sépare alors les deux blocs. */}
      <h2
        id="accueil-a-faire-titre"
        className="sr-only texte-titre-section font-semibold text-foreground group-has-[[data-demarrage]]/accueil:not-sr-only"
      >
        {t('aFaire.titre')}
      </h2>
      <div className="grid grid-cols-1 items-stretch gap-groupe md:grid-cols-2">
        {peutLireRendezVous(actions) ? (
          <CelluleCarte>
            <CarteRendezVousJour site={site} />
          </CelluleCarte>
        ) : null}
        {peutLireEcheancesOr(actions) ? (
          <CelluleCarte>
            <CarteRestitutionsJour
              site={site}
              titreCle={`${cles}.titre`}
              descriptionCle={`${cles}.description`}
              videTitreCle={`${cles}.vide.titre`}
              videDescriptionCle={`${cles}.vide.description`}
            />
          </CelluleCarte>
        ) : null}
        {peutLireEcheancesOr(actions) ? (
          <CelluleCarte>
            <CarteOrEnRetard site={site} />
          </CelluleCarte>
        ) : null}
        {peutEmettreFacture(actions) ? (
          <CelluleCarte>
            <CarteOrAFaire
              site={site}
              filtre={{ statut: 'termine' }}
              cle="aFacturer"
              destination="facturer"
            />
          </CelluleCarte>
        ) : null}
        {peutEncaisser(actions) ? (
          <CelluleCarte>
            <CarteFacturesEchues site={site} />
          </CelluleCarte>
        ) : null}
        {peutLireEcheancesOr(actions) ? (
          <CelluleCarte>
            <CarteOrAFaire
              site={site}
              filtre={{ attente: 'accord' }}
              cle="accordClient"
              destination="fiche"
            />
          </CelluleCarte>
        ) : null}
      </div>
    </section>
  );
}
