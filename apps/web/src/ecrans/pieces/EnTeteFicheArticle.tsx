import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponseArticle, StatutArticle } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formaterDate, formaterMontant, formaterPourmille } from '@/lib/formats';

import { texteOuVide } from './utils';

const VARIANTE_BADGE_STATUT: Record<StatutArticle, 'default' | 'secondary' | 'outline'> = {
  actif: 'default',
  obsolete: 'secondary',
  desactive: 'outline',
};

interface Props {
  readonly article: ReponseArticle;
  readonly peutEcrire: boolean;
  readonly onModifier: () => void;
  readonly onMarquerObsolete: () => void;
  readonly onDesactiver: () => void;
  readonly onReactiver: () => void;
}

/** En-tête de la fiche article — identité, statut, prix, et le menu d'actions de transition
 *  (RP-04, §6.1). Chaque action de transition n'est proposée QUE depuis l'état qui l'autorise
 *  (obsolète/désactiver depuis `actif`, réactiver depuis `obsolete`/`desactive`) — même discipline
 *  que `PanneauActionsOr` (atelier) : ne jamais proposer un bouton dont le clic échouerait à coup
 *  sûr côté serveur. */
export function EnTeteFicheArticle({ article, peutEcrire, onModifier, onMarquerObsolete, onDesactiver, onReactiver }: Props) {
  const { t } = useTranslation(['pieces', 'commun']);

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{article.designation}</h1>
          <Badge variant={VARIANTE_BADGE_STATUT[article.statut]}>{t(`pieces:articles.statuts.${article.statut}`)}</Badge>
        </div>
        <p className="texte-corps text-muted-foreground">{t('pieces:articles.numero', { numero: article.numeroArticle })}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 texte-corps sm:grid-cols-3">
          <div>
            <dt className="texte-libelle text-muted-foreground">{t('pieces:articles.reference')}</dt>
            <dd className="font-mono">{article.referencePrincipale}</dd>
          </div>
          <div>
            <dt className="texte-libelle text-muted-foreground">{t('pieces:articles.marque')}</dt>
            <dd>{texteOuVide(article.marque)}</dd>
          </div>
          <div>
            <dt className="texte-libelle text-muted-foreground">{t('pieces:articles.categorie')}</dt>
            <dd>{t(`pieces:articles.categories.${article.categorie}`)}</dd>
          </div>
          <div>
            <dt className="texte-libelle text-muted-foreground">{t('pieces:articles.prix.vente')}</dt>
            <dd className="tabular-nums font-medium">{formaterMontant(article.prixVenteTtcCentimes)}</dd>
          </div>
          <div>
            <dt className="texte-libelle text-muted-foreground">{t('pieces:articles.tva')}</dt>
            <dd className="tabular-nums">{formaterPourmille(article.tauxTvaPourmille)}</dd>
          </div>
          {article.estEchangeStandard && article.montantConsigneTtcCentimes !== null ? (
            <div>
              <dt className="texte-libelle text-muted-foreground">{t('pieces:articles.montantConsigne')}</dt>
              <dd className="tabular-nums">{formaterMontant(article.montantConsigneTtcCentimes)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-1 texte-libelle text-muted-foreground">
          {t('pieces:articles.fiche.creeLe')} {formaterDate(article.creeLe)} · {t('pieces:articles.fiche.modifieLe')} {formaterDate(article.modifieLe)}
        </p>
      </div>

      {peutEcrire ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              {t('commun:actions.modifier')}
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onModifier}>{t('pieces:articles.actions.modifier')}</DropdownMenuItem>
            {article.statut === 'actif' ? (
              <DropdownMenuItem onSelect={onMarquerObsolete}>{t('pieces:articles.actions.marquerObsolete')}</DropdownMenuItem>
            ) : null}
            {article.statut === 'actif' ? (
              <DropdownMenuItem onSelect={onDesactiver}>{t('pieces:articles.actions.desactiver')}</DropdownMenuItem>
            ) : null}
            {article.statut !== 'actif' ? (
              <DropdownMenuItem onSelect={onReactiver}>{t('pieces:articles.actions.reactiver')}</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
