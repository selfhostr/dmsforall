import { useTranslation } from 'react-i18next';

import type { ReponseActiviteTableauBord } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
 * (§3.1, « écarté »). Barres reprises TELLES QUELLES depuis l'ancien `BlocActiviteTableauBord`
 * (démantelé, §5 du design), seul le titre/l'emballage changent — même rendu, même doctrine
 * zéro-digne (un statut à 0 reste une barre visible, pas un état vide).
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
            const maxParStatut = Math.max(1, ...lignes.map((ligne) => ligne.nombre));
            return lignes.map((ligne) => (
              <div key={ligne.statut} className="flex items-center gap-3">
                <span className="w-28 shrink-0 texte-libelle text-muted-foreground">
                  {t(`or:statuts.${ligne.statut === 'en_cours' ? 'enCours' : ligne.statut}`)}
                </span>
                <div className="h-3 flex-1 rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-3 rounded-full bg-primary"
                    style={{ width: `${(ligne.nombre / maxParStatut) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right tabular-nums texte-libelle font-medium">
                  {ligne.nombre}
                </span>
              </div>
            ));
          })()
        )}
      </CardContent>
    </Card>
  );
}
