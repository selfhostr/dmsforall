import { useTranslation } from 'react-i18next';

import type { ReponseActiviteTableauBord } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Meter, MeterIndicator, MeterTrack } from '@/components/ui/meter';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';

import type { ResultatChiffreTableauBord } from './CarteChiffreRequete';

interface Props {
  readonly resultat: ResultatChiffreTableauBord<ReponseActiviteTableauBord>;
}

/**
 * Répartition des OR par statut — charge de l'atelier, SNAPSHOT (« maintenant », pas borné par une
 * période, voir `ReponseActiviteTableauBord.ordresReparationParStatut`). Réservé au chef d'atelier
 * (`docs/design-tableau-bord-par-role.md` §3.3) : la direction veut un chiffre, pas un histogramme
 * (§3.1, « écarté »). Même doctrine zéro-digne qu'avant (un statut à 0 reste une barre visible, pas
 * un état vide).
 *
 * BARRE RENDUE ACCESSIBLE (démonstration coss/Base UI, cf. CONTRIBUTING.md « Composants d'interface »).
 * L'ancien rendu (`div` avec `style={{ width }}` et `aria-hidden="true"` sur la piste entière)
 * cachait la proportion à tout lecteur d'écran : seuls le libellé et le nombre restaient
 * perceptibles, jamais le rapport visuel entre statuts que la barre existe pour montrer. `Meter`
 * (`components/ui/meter.tsx`, `@base-ui/react/meter`) pose `role="meter"` +
 * `aria-valuenow/min/max/text` sans code supplémentaire ici — le gain n'est pas esthétique, il est
 * dans le rôle ARIA qu'aucune `div` maison ne peut porter.
 */
export function CarteRepartitionStatuts({ resultat }: Props) {
  const { t } = useTranslation(['tableauBord', 'or', 'commun']);
  const { data, isPending, isError, error, refetch } = resultat;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tableauBord:activite.repartitionStatuts.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {isPending ? (
          <EtatChargement lignes={6} />
        ) : isError ? (
          <EtatErreur
            titre={t('tableauBord:activite.erreur.titre')}
            description={messageErreur(error, t)}
            onReessayer={() => void refetch()}
          />
        ) : (
          (() => {
            const lignes = (data as ReponseActiviteTableauBord).ordresReparationParStatut;
            // Dénominateur = somme de TOUS les statuts, pas le plus chargé d'entre eux — sinon le
            // statut majoritaire affiche toujours 100 % quelle que soit la réalité (bug mesuré :
            // `Math.max(...valeurs)` au lieu d'un total). `Math.max(1, total)` protège seulement le
            // cas total nul : la somme de comptages non-négatifs ne peut être nulle que si CHAQUE
            // statut l'est déjà, donc `valeur / 1 = 0` pour tous — aucune barre à 100 %, aucun
            // `NaN` (voir CarteRepartitionStatuts.spec.tsx, cas « total nul »).
            const total = lignes.reduce((somme, ligne) => somme + ligne.nombre, 0);
            const totalPourJauge = Math.max(1, total);
            return lignes.map((ligne) => {
              const libelleStatut = t(
                `or:statuts.${ligne.statut === 'en_cours' ? 'enCours' : ligne.statut}`,
              );
              return (
                <div key={ligne.statut} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 texte-libelle text-muted-foreground">
                    {libelleStatut}
                  </span>
                  <Meter
                    className="flex-1"
                    value={ligne.nombre}
                    min={0}
                    max={totalPourJauge}
                    aria-label={libelleStatut}
                    getAriaValueText={() =>
                      t('tableauBord:activite.repartitionStatuts.valeurAccessible', {
                        count: ligne.nombre,
                      })
                    }
                  >
                    <MeterTrack>
                      <MeterIndicator />
                    </MeterTrack>
                  </Meter>
                  <span className="w-8 shrink-0 text-right tabular-nums texte-libelle font-medium">
                    {ligne.nombre}
                  </span>
                </div>
              );
            });
          })()
        )}
      </CardContent>
    </Card>
  );
}
