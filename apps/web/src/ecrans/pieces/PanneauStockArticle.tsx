import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SiteResume, StockResumeArticle } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useDisponibiliteArticle } from '@/hooks/pieces/useDisponibiliteArticle';
import { useModifierStockSite } from '@/hooks/pieces/useModifierStockSite';

import { messageErreurMutation } from './messages-erreur-mutation';
import { formaterDateHeure } from '@/lib/formats';

import {
  DialogueEmplacementStockArticle,
  type CasierAModifier,
} from './DialogueEmplacementStockArticle';
import {
  formaterQuantiteMillieme,
  saisieVersSeuilMillieme,
  texteEmplacementComplet,
} from './utils';

interface Props {
  readonly articleId: string;
  readonly stocksResume: readonly StockResumeArticle[];
  readonly sites: readonly SiteResume[];
  /** `pieces.stock.modifier` (`ecrans/pieces/droits.ts::peutEcrireStockSite`) — sans ce droit, ni
   *  la saisie du seuil de réapprovisionnement (RP-12, #121) ni celle du casier (0056) ne sont
   *  proposées : MÊME droit sous-jacent, ces deux réglages de site partagent le même
   *  `PATCH /articles/{id}/stock/{siteId}`. */
  readonly peutModifierStock: boolean;
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
export function PanneauStockArticle({ articleId, stocksResume, sites, peutModifierStock }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const [siteDeplie, setSiteDeplie] = useState<string | null>(null);
  const [casierOuvert, setCasierOuvert] = useState<CasierAModifier | null>(null);

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
      <CardContent className="flex flex-col gap-groupe">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pieces:stock.site')}</TableHead>
              <TableHead className="text-right">{t('pieces:stock.quantites.physique')}</TableHead>
              <TableHead className="text-right">{t('pieces:stock.quantites.disponible')}</TableHead>
              <TableHead>{t('pieces:stock.quantites.emplacement')}</TableHead>
              {peutModifierStock ? <TableHead /> : null}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stocksResume.map((stock) => {
              const emplacementComplet = texteEmplacementComplet(t, stock);
              return (
                <TableRow key={stock.siteId}>
                  <TableCell>{nomSite(sites, stock.siteId)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formaterQuantiteMillieme(stock.quantitePhysiqueMillieme)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formaterQuantiteMillieme(stock.quantiteDisponibleMillieme)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {emplacementComplet !== null ? (
                        <span className="texte-libelle">{emplacementComplet}</span>
                      ) : (
                        <span className="texte-libelle text-muted-foreground">
                          {t('pieces:emplacement.aucun')}
                        </span>
                      )}
                      {peutModifierStock ? (
                        <button
                          type="button"
                          className="w-fit texte-libelle text-primary underline-offset-2 hover:underline"
                          onClick={() =>
                            setCasierOuvert({
                              articleId,
                              siteId: stock.siteId,
                              nomSite: nomSite(sites, stock.siteId),
                              rayon: stock.rayon,
                              tiroir: stock.tiroir,
                              emplacement: stock.emplacement,
                            })
                          }
                        >
                          {t('pieces:emplacement.modifier')}
                        </button>
                      ) : null}
                    </div>
                  </TableCell>
                  {peutModifierStock ? (
                    <TableCell className="text-right">
                      <ActionSeuilSite
                        articleId={articleId}
                        siteId={stock.siteId}
                        nomSite={nomSite(sites, stock.siteId)}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setSiteDeplie(siteDeplie === stock.siteId ? null : stock.siteId)
                      }
                    >
                      {t('pieces:reservations.disponibilite.titre')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {siteDeplie ? (
          <DetailDisponibilite
            articleId={articleId}
            siteId={siteDeplie}
            nomSite={nomSite(sites, siteDeplie)}
          />
        ) : null}
      </CardContent>

      <DialogueEmplacementStockArticle
        casier={casierOuvert}
        onFerme={() => setCasierOuvert(null)}
      />
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
            <li
              key={reservation.reservationId}
              className="flex items-center justify-between gap-controles texte-corps"
            >
              <span>
                {reservation.numeroOrdreReparation} · {reservation.clientNomAffichage}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formaterQuantiteMillieme(reservation.quantiteMillieme)} ·{' '}
                {formaterDateHeure(reservation.reserveeLe)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PropsActionSeuilSite {
  readonly articleId: string;
  readonly siteId: string;
  readonly nomSite: string;
}

/**
 * Pose/retrait du seuil de réapprovisionnement (#121), DEUXIÈME point de saisie — justifié en
 * plus de `EcranReapprovisionnement.CelluleSeuil` (qui ne couvre que les articles DÉJÀ sous leur
 * seuil) : ici, un magasinier configure le seuil d'un article qui a encore largement de stock,
 * AVANT qu'il ne manque, pour n'importe quel site.
 *
 * ACTION D'ÉCRITURE, PAS D'ÉDITION — différence délibérée avec `CelluleSeuil` : aucun `GET` du
 * contrat n'expose `stockMinimumMillieme` en dehors de `LigneReapprovisionnement` (limitée aux
 * lignes déjà sous seuil) et de la réponse d'un `PATCH` lui-même (`ReponseStockArticle`, vérifié
 * dans `contrats/pieces/stock.ts`/`stock.controller.ts` — aucune route `GET
 * /articles/{id}/stock/{siteId}`). Pré-remplir ce champ avec la valeur ACTUELLE est donc
 * IMPOSSIBLE sans deviner : le champ part toujours VIDE, jamais un « 0 » ou une valeur plausible
 * qui ferait croire à une lecture réelle. Conséquence directe : un champ vide + « Enregistrer » ne
 * retire JAMAIS le seuil silencieusement (contrairement à `CelluleSeuil`, où le vide est un état
 * connu) — retirer exige le bouton dédié, toujours actif. La confirmation affichée après succès
 * (`modifier.data.stockMinimumMillieme`) est la VRAIE valeur renvoyée par le serveur, pas une
 * supposition.
 */
function ActionSeuilSite({ articleId, siteId, nomSite }: PropsActionSeuilSite) {
  const { t } = useTranslation(['pieces', 'commun']);
  const modifier = useModifierStockSite();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null);

  function gererOuverture(prochainEtat: boolean) {
    setOuvert(prochainEtat);
    if (prochainEtat) {
      setSaisie('');
      setErreurSaisie(null);
      modifier.reset();
    }
  }

  function retirer() {
    setErreurSaisie(null);
    modifier.mutate({ articleId, siteId, entree: { stockMinimumMillieme: null } });
  }

  function enregistrer() {
    const resultat = saisieVersSeuilMillieme(saisie);
    if (resultat.genre === 'absence') {
      setErreurSaisie(t('pieces:stock.seuilSite.erreurVide'));
      return;
    }
    if (resultat.genre === 'invalide') {
      setErreurSaisie(t('pieces:stock.seuilSite.erreurInvalide'));
      return;
    }
    setErreurSaisie(null);
    modifier.mutate({
      articleId,
      siteId,
      entree: { stockMinimumMillieme: resultat.millieme },
    });
  }

  const champId = `seuil-site-${articleId}-${siteId}`;
  const succes = modifier.isSuccess ? modifier.data.stockMinimumMillieme : null;

  return (
    <Popover open={ouvert} onOpenChange={gererOuverture}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('pieces:stock.seuilSite.actionAria', { nomSite })}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t('pieces:stock.seuilSite.action')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        {modifier.isSuccess ? (
          <div className="flex flex-col gap-controles">
            <p className="texte-corps text-foreground">
              {succes === null
                ? t('pieces:stock.seuilSite.confirmationRetiree')
                : t('pieces:stock.seuilSite.confirmationPosee', {
                    valeur: formaterQuantiteMillieme(succes),
                  })}
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setOuvert(false)}>
                {t('commun:actions.fermer')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-controles">
            <div className="flex flex-col gap-champ">
              <Label htmlFor={champId}>{t('pieces:stock.seuilSite.champ')}</Label>
              <Input
                id={champId}
                type="text"
                inputMode="decimal"
                value={saisie}
                disabled={modifier.isPending}
                onChange={(evenement) => setSaisie(evenement.target.value)}
                aria-invalid={erreurSaisie ? true : undefined}
                aria-describedby={`${champId}-aide`}
              />
              <p id={`${champId}-aide`} className="texte-libelle text-muted-foreground">
                {t('pieces:stock.seuilSite.champAide')}
              </p>
            </div>

            {erreurSaisie ? (
              <p className="texte-libelle text-destructive" role="alert">
                {erreurSaisie}
              </p>
            ) : null}
            {modifier.isError ? (
              <p className="texte-libelle text-destructive" role="alert">
                {messageErreurMutation(modifier.error, t)}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={modifier.isPending}
                onClick={retirer}
              >
                {t('pieces:stock.seuilSite.retirer')}
              </Button>
              <Button type="button" size="sm" disabled={modifier.isPending} onClick={enregistrer}>
                {modifier.isPending
                  ? t('commun:chargement.enCours')
                  : t('commun:actions.enregistrer')}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
