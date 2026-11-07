import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ReponseRecherche } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { texteResume } from '@/composants/recherche/resume';
import { peutCreerOrdreReparation } from '@/ecrans/atelier/droits';
import { useSession } from '@/hooks/useSession';
import { formaterPlaque } from '@/lib/plaque';
import { chemins } from '@/routes/chemins';

const MAX_PROPOSITIONS = 3;

interface Props {
  readonly saisie: string;
  readonly reponse: ReponseRecherche | null;
  readonly site: string | undefined;
}

/**
 * « Créer un OR » depuis la recherche : sur le véhicule ou le client trouvé (écran prérempli), et
 * pour la saisie elle-même quand rien ne correspond (plaque inconnue -> l'écran crée le véhicule et
 * le client). Masqué aux rôles sans `atelier.or.creer`. Vit sous le panneau de résultats
 * (`PanneauResultatsRecherche`, partagé) plutôt que dedans : aucune ligne de ce composant partagé
 * ne change.
 */
export function ActionsCreerOrRecherche({ saisie, reponse, site }: Props) {
  const { t } = useTranslation('recherche');
  const { data: session } = useSession();
  if (!peutCreerOrdreReparation(session?.utilisateur.role)) return null;
  if (saisie.trim() === '' || reponse === null) return null;

  const vehicules = reponse.resultats
    .filter((r) => r.type === 'vehicule')
    .slice(0, MAX_PROPOSITIONS);
  const clients = reponse.resultats.filter((r) => r.type === 'client').slice(0, MAX_PROPOSITIONS);

  return (
    <section aria-label={t('creerOr.titre')} className="mt-groupe flex flex-col gap-2">
      <h2 className="texte-libelle font-semibold text-foreground">{t('creerOr.titre')}</h2>
      <ul className="flex flex-col gap-2">
        {vehicules.map((resultat) => {
          const plaque = texteResume(resultat.resume.plaque);
          const designation = texteResume(resultat.resume.designation) ?? '';
          return (
            <li key={`v-${resultat.id}`}>
              <Button asChild variant="outline" className="h-auto min-h-11 w-full justify-start">
                <Link
                  to={chemins.atelier.ordresReparation.depuisPlaque({
                    site,
                    vehiculeId: resultat.id,
                  })}
                >
                  <Wrench aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {t('creerOr.pourVehicule', {
                      vehicule: [plaque ? formaterPlaque(plaque) : null, designation]
                        .filter(Boolean)
                        .join(' · '),
                    })}
                  </span>
                </Link>
              </Button>
            </li>
          );
        })}
        {clients.map((resultat) => (
          <li key={`c-${resultat.id}`}>
            <Button asChild variant="outline" className="h-auto min-h-11 w-full justify-start">
              <Link
                to={chemins.atelier.ordresReparation.depuisPlaque({ site, clientId: resultat.id })}
              >
                <Wrench aria-hidden className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">
                  {t('creerOr.pourClient', { client: texteResume(resultat.resume.nom) ?? '' })}
                </span>
              </Link>
            </Button>
          </li>
        ))}
        <li>
          <Button asChild variant="outline" className="h-auto min-h-11 w-full justify-start">
            <Link to={chemins.atelier.ordresReparation.depuisPlaque({ site, plaque: saisie })}>
              <Wrench aria-hidden className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">
                {t('creerOr.pourSaisie', { saisie: saisie.trim() })}
              </span>
            </Link>
          </Button>
        </li>
      </ul>
    </section>
  );
}
