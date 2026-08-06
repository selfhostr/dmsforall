import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ReponseDepotPneus } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeSaisonPneu } from './BadgeSaisonPneu';
import { BadgeStatutDepotPneu } from './BadgeStatutDepotPneu';

/** Identification du véhicule/client — connue seulement quand la carte vient d'un résultat de
 *  recherche (`useRechercheHangarPneus`, déjà enrichi) ; ABSENTE dans le plan par défaut du
 *  hangar (`GET /sites/{siteId}/hangar-pneus` ne rend que `vehiculeId`, voir le commentaire de
 *  tête de `EcranHangarPneus.tsx` — pas de N+1 systématique sur chaque case du plan). */
export interface IdentificationJeuPneu {
  readonly plaque: string | null;
  readonly designation: string | null;
  readonly clientNom: string | null;
}

interface Props {
  readonly depot: ReponseDepotPneus;
  readonly identification?: IdentificationJeuPneu;
  readonly site?: string;
  readonly peutGerer: boolean;
  readonly onChangerSaison: (depot: ReponseDepotPneus) => void;
  readonly onDeplacer: (depot: ReponseDepotPneus) => void;
  readonly onSortir: (depot: ReponseDepotPneus) => void;
}

/** Une case du hangar — le composant que `EcranHangarPneus` (plan) et `useRechercheHangarPneus`
 *  (résultats de recherche) partagent, pour qu'un jeu ait EXACTEMENT le même rendu qu'on l'ait
 *  trouvé en parcourant le plan ou en tapant une plaque. `codeCase` porte la lecture visuelle
 *  principale (spec §6 : « l'emplacement physique... doit être visible ») — gros, monospace, en
 *  tête de carte, jamais noyé parmi les autres champs. */
export function CarteJeuPneu({
  depot,
  identification,
  site,
  peutGerer,
  onChangerSaison,
  onDeplacer,
  onSortir,
}: Props) {
  const { t } = useTranslation(['pneus', 'commun']);
  const estActif = depot.statut === 'en_depot' || depot.statut === 'monte';

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 texte-corps font-mono text-lg font-semibold text-foreground">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {depot.codeCase ?? (
              <span className="texte-corps font-sans italic text-muted-foreground">
                {t('pneus:jeu.sansRepere')}
              </span>
            )}
          </div>
          <BadgeStatutDepotPneu statut={depot.statut} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BadgeSaisonPneu saison={depot.saison} />
          {depot.dimension ? (
            <span className="texte-libelle text-muted-foreground">{depot.dimension}</span>
          ) : null}
        </div>

        {identification ? (
          <div className="flex flex-col gap-0.5">
            <span className="texte-corps font-medium text-foreground">
              {identification.plaque ?? t('pneus:jeu.plaqueInconnue')}
              {identification.designation ? ` · ${identification.designation}` : ''}
            </span>
            {identification.clientNom ? (
              <span className="texte-libelle text-muted-foreground">
                {identification.clientNom}
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="texte-libelle text-muted-foreground">
          {t('pneus:jeu.dernierMouvement', { date: formaterDate(depot.dernierMouvementLe) })}
        </p>

        {depot.statut === 'a_relancer' ? (
          <p className="texte-libelle text-destructive">{t('pneus:jeu.avertissementRelance')}</p>
        ) : null}
        {depot.statut === 'sorti' && depot.motifSortie ? (
          <p className="texte-libelle text-muted-foreground">
            {t(`pneus:motifSortie.${depot.motifSortie}`)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            to={chemins.vehicules.detail(depot.vehiculeId, site)}
            className="texte-libelle font-medium text-primary underline"
          >
            {t('pneus:jeu.actions.voirVehicule')}
          </Link>
          {peutGerer && estActif ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onChangerSaison(depot)}
            >
              {t('pneus:jeu.actions.changerSaison')}
            </Button>
          ) : null}
          {peutGerer && depot.statut !== 'sorti' ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onDeplacer(depot)}>
              {t('pneus:jeu.actions.deplacer')}
            </Button>
          ) : null}
          {peutGerer && depot.statut !== 'sorti' ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onSortir(depot)}>
              {t('pneus:jeu.actions.sortir')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
