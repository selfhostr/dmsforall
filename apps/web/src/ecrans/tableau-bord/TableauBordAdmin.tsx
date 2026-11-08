import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { chemins } from '@/routes/chemins';

interface Props {
  readonly site: string | undefined;
}

/**
 * Admin — un seul bloc, AUCUN montant ni statistique (RF-115) : rôle technique sans droit métier,
 * « aucun plan métier propre » (`routes/atterrissage.ts`). Des raccourcis vers ses tâches réelles,
 * jamais un pilotage caché. Verrouillé par `EcranTableauBord.spec.tsx` (non-fuite).
 */
export function TableauBordAdmin({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);

  return (
    <div className="grid items-stretch gap-groupe sm:grid-cols-2 lg:grid-cols-3">
      {/* Le design (§3.9) propose aussi « créer un utilisateur » — AUCUNE route/écran de gestion
          des utilisateurs n'existe encore dans ce dépôt (vérifié : `routeur.tsx`/`chemins.ts`
          n'ont aucune entrée `utilisateurs`) ; omis plutôt qu'un lien mort. Les deux raccourcis
          ci-dessous pointent vers des écrans RÉELS. */}
      {/* DESIGN.md « densité » — titre + deux liens : contenu minimal, `compact` comme
          `CarteChiffreRequete`/`CarteAccesRapide`. `<nav>` reste un élément brut (jamais
          `CardContent`, qui rendrait un `<div>` — la sémantique de navigation prime) : le
          rembourrage compact est donc répété ici en dur plutôt que lu depuis le contexte React de
          `Card` (réservé à `CardHeader`/`CardContent`/`CardFooter`). */}
      <Card compact>
        <CardHeader>
          <CardTitle>{t('tableauBord:admin.raccourcis.titre')}</CardTitle>
        </CardHeader>
        <nav
          aria-label={t('tableauBord:admin.raccourcis.titre')}
          className="flex flex-col gap-2 px-carte-compacte pb-carte-compacte"
        >
          <Link
            to={chemins.parametrage.sites(site)}
            className="texte-corps font-medium text-primary underline"
          >
            {t('tableauBord:admin.raccourcis.sites')}
          </Link>
          <Link
            to={chemins.parametrage.atelier(site)}
            className="texte-corps font-medium text-primary underline"
          >
            {t('tableauBord:admin.raccourcis.parametrageAtelier')}
          </Link>
        </nav>
      </Card>
    </div>
  );
}
