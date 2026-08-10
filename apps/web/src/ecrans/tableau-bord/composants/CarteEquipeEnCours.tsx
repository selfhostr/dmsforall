import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useListePointages } from '@/hooks/pointage/useListePointages';
import { chemins } from '@/routes/chemins';

const MAX_TECHNICIENS = 6;

interface Props {
  readonly site: string | undefined;
}

/**
 * « Qui travaille sur quoi maintenant » — chef d'atelier (`docs/design-tableau-bord-par-role.md`
 * §3.3). `GET /pointages?statut=en_cours` (`STATUTS_POINTAGE` inclut `'en_cours'`,
 * `packages/shared/src/contrats/atelier/enums.ts:421`) — regroupé CÔTÉ CLIENT par technicien (pas
 * d'agrégat serveur pour ceci, le design l'assume : « le volume, une équipe d'atelier, le permet
 * sans souci de perf »). Une seule page (`useListePointages` sans `charger plus`) : une équipe
 * d'atelier n'a pas des dizaines de pointages ouverts simultanément.
 */
export function CarteEquipeEnCours({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);

  const requete = useListePointages({
    statut: ['en_cours'],
    siteId: site,
    tri: 'debutLe:desc',
  });

  const parTechnicien = useMemo(() => {
    const vus = new Set<string>();
    // `.filter` plutôt qu'un `push` manuel : `requete.pointages` est un `readonly ReponsePointage[]`
    // (contrat `useListePointages`), un tableau mutable typé à la main dessus ne compile pas.
    return requete.pointages.filter((pointage) => {
      if (vus.has(pointage.technicienId)) return false;
      vus.add(pointage.technicienId);
      return true;
    });
  }, [requete.pointages]);

  const visibles = parTechnicien.slice(0, MAX_TECHNICIENS);
  const surplus = parTechnicien.length - visibles.length;

  let contenu: ReactNode;
  if (requete.isPending) {
    contenu = <EtatChargement lignes={4} />;
  } else if (requete.isError) {
    contenu = (
      <EtatErreur
        titre={t('tableauBord:chefAtelier.equipeEnCours.erreur')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  } else if (visibles.length === 0) {
    contenu = (
      <EtatVide
        titre={t('tableauBord:chefAtelier.equipeEnCours.vide.titre')}
        description={t('tableauBord:chefAtelier.equipeEnCours.vide.description')}
      />
    );
  } else {
    contenu = (
      <ul className="flex flex-col divide-y">
        {visibles.map((pointage) => (
          <li key={pointage.technicienId} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate texte-corps font-medium text-foreground">
              {pointage.technicienNomAffiche}
            </span>
            {pointage.ordreReparationId ? (
              <Link
                to={chemins.atelier.ordresReparation.detail(pointage.ordreReparationId, site)}
                className="shrink-0 texte-libelle font-medium text-primary underline"
              >
                {pointage.ordreReparationNumero}
              </Link>
            ) : (
              <span className="shrink-0 texte-libelle text-muted-foreground">
                {t('tableauBord:chefAtelier.equipeEnCours.activiteIndirecte')}
              </span>
            )}
          </li>
        ))}
        {surplus > 0 ? (
          <li className="pt-2 texte-libelle text-muted-foreground">
            {t('tableauBord:chefAtelier.equipeEnCours.autres', { count: surplus })}
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tableauBord:chefAtelier.equipeEnCours.titre')}</CardTitle>
      </CardHeader>
      <div className="px-carte pb-carte">{contenu}</div>
    </Card>
  );
}
