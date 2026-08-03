import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SiteResume, StockResumeArticle } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useDisponibiliteArticle } from '@/hooks/pieces/useDisponibiliteArticle';
import { formaterDateHeure } from '@/lib/formats';

import { formaterQuantiteMillieme } from './utils';

interface Props {
  readonly articleId: string;
  readonly stocksResume: readonly StockResumeArticle[];
  readonly sites: readonly SiteResume[];
}

function nomSite(sites: readonly SiteResume[], siteId: string): string {
  return sites.find((site) => site.id === siteId)?.nom ?? siteId;
}

/**
 * Stock par site (RP-09 → RP-15) — table des résumés déjà embarqués sur la fiche article
 * (`stocksResume`, un par site où l'article a un mouvement ou un seuil défini), plus un détail de
 * disponibilité déplié à la demande (`GET /articles/{id}/disponibilite`) qui NOMME les réservations
 * actives — le terrain de CP-02 (RP-19), ce que le magasinier doit voir avant de dire « c'est
 * réservé » à un client au comptoir.
 */
export function PanneauStockArticle({ articleId, stocksResume, sites }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const [siteDeplie, setSiteDeplie] = useState<string | null>(null);

  if (stocksResume.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('pieces:stock.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatVide titre={t('pieces:stock.titre')} description={t('pieces:articles.vide')} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('pieces:stock.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pieces:stock.site')}</TableHead>
              <TableHead className="text-right">{t('pieces:stock.quantites.physique')}</TableHead>
              <TableHead className="text-right">{t('pieces:stock.quantites.disponible')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stocksResume.map((stock) => (
              <TableRow key={stock.siteId}>
                <TableCell>{nomSite(sites, stock.siteId)}</TableCell>
                <TableCell className="text-right tabular-nums">{formaterQuantiteMillieme(stock.quantitePhysiqueMillieme)}</TableCell>
                <TableCell className="text-right tabular-nums">{formaterQuantiteMillieme(stock.quantiteDisponibleMillieme)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSiteDeplie(siteDeplie === stock.siteId ? null : stock.siteId)}
                  >
                    {t('pieces:reservations.disponibilite.titre')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {siteDeplie ? <DetailDisponibilite articleId={articleId} siteId={siteDeplie} nomSite={nomSite(sites, siteDeplie)} /> : null}
      </CardContent>
    </Card>
  );
}

interface PropsDetail {
  readonly articleId: string;
  readonly siteId: string;
  readonly nomSite: string;
}

function DetailDisponibilite({ articleId, siteId, nomSite: nom }: PropsDetail) {
  const { t } = useTranslation(['pieces', 'commun']);
  const requete = useDisponibiliteArticle(articleId, siteId);

  if (requete.isPending) {
    return <EtatChargement lignes={3} />;
  }

  if (requete.isError) {
    return (
      <EtatErreur
        titre={t('pieces:articles.fiche.erreurSection.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }

  const disponibilite = requete.data;

  return (
    <div className="rounded-md border p-3">
      <h3 className="texte-libelle font-semibold text-foreground">
        {t('pieces:reservations.disponibilite.titre')} — {nom}
      </h3>
      {disponibilite.reservationsActives.length === 0 ? (
        <p className="mt-2 texte-corps text-muted-foreground">{t('pieces:reservations.vide')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {disponibilite.reservationsActives.map((reservation) => (
            <li key={reservation.reservationId} className="flex items-center justify-between gap-3 texte-corps">
              <span>
                {reservation.numeroOrdreReparation} · {reservation.clientNomAffichage}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formaterQuantiteMillieme(reservation.quantiteMillieme)} · {formaterDateHeure(reservation.reserveeLe)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
