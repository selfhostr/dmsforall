import { useTranslation } from 'react-i18next';

import type { RoleUtilisateur } from '@dfa/shared';

import { peutLireEcheancesOr } from '@/ecrans/accueil/droits';
import {
  peutEmettreFacture,
  peutEncaisser,
  peutVoirMontantsFacturation,
} from '@/ecrans/facturation/droits';
import { peutLireRendezVous } from '@/ecrans/rendez-vous/droits';
import { CarteOrEnRetard } from '@/ecrans/tableau-bord/composants/CarteOrEnRetard';
import { CarteRendezVousJour } from '@/ecrans/tableau-bord/composants/CarteRendezVousJour';
import { CarteRestitutionsJour } from '@/ecrans/tableau-bord/composants/CarteRestitutionsJour';

import { CarteFacturesEchues } from './CarteFacturesEchues';
import { CarteOrAFaire } from './CarteOrAFaire';

interface Props {
  readonly role: RoleUtilisateur | undefined;
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
export function AFaireAujourdhui({ role, site }: Props) {
  const { t } = useTranslation('accueil');
  const cles = (role && CLES_RESTITUTIONS[role]) ?? CLES_RESTITUTIONS.receptionnaire;

  return (
    <section aria-labelledby="accueil-a-faire-titre" className="flex flex-col gap-groupe">
      <h2 id="accueil-a-faire-titre" className="texte-titre-section font-semibold text-foreground">
        {t('aFaire.titre')}
      </h2>
      <div className="grid items-start gap-groupe lg:grid-cols-2">
        {peutLireRendezVous(role) ? <CarteRendezVousJour site={site} /> : null}
        {peutLireEcheancesOr(role) ? (
          <CarteRestitutionsJour
            site={site}
            titreCle={`${cles}.titre`}
            descriptionCle={`${cles}.description`}
            videTitreCle={`${cles}.vide.titre`}
            videDescriptionCle={`${cles}.vide.description`}
          />
        ) : null}
        {peutLireEcheancesOr(role) ? <CarteOrEnRetard site={site} /> : null}
        {peutEmettreFacture(role) ? (
          <CarteOrAFaire
            site={site}
            filtre={{ statut: 'termine' }}
            cle="aFacturer"
            destination="facturer"
          />
        ) : null}
        {peutEncaisser(role) && peutVoirMontantsFacturation(role) ? (
          <CarteFacturesEchues site={site} />
        ) : null}
        {peutLireEcheancesOr(role) ? (
          <CarteOrAFaire
            site={site}
            filtre={{ attente: 'accord' }}
            cle="accordClient"
            destination="fiche"
          />
        ) : null}
      </div>
    </section>
  );
}
