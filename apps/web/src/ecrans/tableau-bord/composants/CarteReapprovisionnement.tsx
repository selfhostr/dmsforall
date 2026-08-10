import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useReapprovisionnement } from '@/hooks/pieces/useReapprovisionnement';
import { chemins } from '@/routes/chemins';

const MAX_LIGNES = 5;

interface Props {
  readonly site: string | undefined;
}

/**
 * Articles sous seuil de réapprovisionnement — LISTE, pas juste le nombre (déjà compté dans le
 * bloc activité générique ; ici on donne au magasinier de quoi agir, `docs/design-tableau-bord-
 * par-role.md` §3.5). `useReapprovisionnement` exige un site RÉEL (`enabled: false` tant que
 * `siteId` est `undefined`) — contrairement au reste du tableau de bord où l'absence de site agrège
 * le tenant : `TableauBordMagasinier` résout donc un site par défaut avant d'appeler ce composant
 * (même repli que l'ancien `EcranAccueil` : premier site actif de la session).
 */
export function CarteReapprovisionnement({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'pieces', 'commun']);
  const requete = useReapprovisionnement(site);

  const visibles = requete.lignes.slice(0, MAX_LIGNES);
  const surplus = requete.lignes.length - visibles.length;

  let contenu: ReactNode;
  if (requete.isPending) {
    contenu = <EtatChargement lignes={4} />;
  } else if (requete.isError) {
    contenu = (
      <EtatErreur
        titre={t('tableauBord:magasinier.reapprovisionnement.erreur')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  } else if (visibles.length === 0) {
    contenu = (
      <EtatVide
        titre={t('tableauBord:magasinier.reapprovisionnement.vide.titre')}
        description={t('tableauBord:magasinier.reapprovisionnement.vide.description')}
      />
    );
  } else {
    contenu = (
      <ul className="flex flex-col divide-y">
        {visibles.map((ligne) => (
          <li key={ligne.articleId} className="flex items-center justify-between gap-3 py-2">
            <Link
              to={chemins.pieces.articleDetail(ligne.articleId, site)}
              className="min-w-0 truncate texte-corps font-medium text-primary underline"
            >
              {ligne.designation}
            </Link>
            <span className="shrink-0 tabular-nums texte-libelle text-muted-foreground">
              {t('tableauBord:magasinier.reapprovisionnement.ecart', {
                ecart: Math.round(ligne.ecartMillieme / 1000),
              })}
            </span>
          </li>
        ))}
        {surplus > 0 ? (
          <li className="pt-2 texte-libelle text-muted-foreground">
            {t('tableauBord:magasinier.reapprovisionnement.autres', { count: surplus })}
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tableauBord:activite.articlesSousSeuil.libelle')}</CardTitle>
      </CardHeader>
      <div className="px-carte pb-carte">{contenu}</div>
    </Card>
  );
}
