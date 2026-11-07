import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import {
  calculerCumulsParTechnicien,
  calculerCumulTotal,
} from '@/hooks/pointage/agregats-pointage';
import {
  bornesJourneeLocale,
  bornesSemaineLocale,
  dateJourLocale,
  formaterDureeLisible,
} from '@/hooks/pointage/temps-pointage';
import { useListePointages } from '@/hooks/pointage/useListePointages';
import { useSession } from '@/hooks/useSession';

import { BadgeAnomaliePointage, BadgeEnCoursPointage } from './BadgeStatutPointage';
import { peutVoirEquipePointage } from './droits';

type Periode = 'jour' | 'semaine';

interface Props {
  /** Résolu par l'appelant (`EcranPointage`) — cette vue ne gère plus sa propre gate de site,
   *  consolidée une seule fois au niveau de l'écran (voir l'en-tête d'`EcranPointage.tsx`). */
  readonly siteId: string;
}

/**
 * Vue « Journal » de l'écran de pointage (Lot D, `docs/refonte-navigation.md`) — jour/semaine,
 * pointages cumulés par technicien. Un rôle sans vue équipe (technicien, magasinier) ne voit QUE
 * ses propres cumuls (restriction appliquée côté SERVEUR sur `GET /pointages` — voir l'en-tête de
 * `pointage.api.ts` — ce filtre `technicienId` explicite est un confort qui n'ouvre AUCUNE donnée
 * que le serveur n'aurait déjà retenue).
 *
 * `GET /pointages/indicateurs` (RM-99) n'existe pas côté serveur à ce jour — voir l'en-tête
 * d'`agregats-pointage.ts` : les cumuls ci-dessous sont calculés côté client à partir de la
 * collection `GET /pointages`, en SECONDES brutes, jamais arrondis.
 *
 * Anciennement `EcranJournalPointage` — voir l'en-tête d'`EcranPointage.tsx` pour la fusion.
 */
export function VueJournalPointage({ siteId }: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session } = useSession();
  const actions = session?.actions;
  const technicienId = session?.utilisateur.id;

  const [periode, setPeriode] = useState<Periode>('jour');

  const bornes = useMemo(() => {
    const aujourdHui = dateJourLocale();
    return periode === 'jour' ? bornesJourneeLocale(aujourdHui) : bornesSemaineLocale(aujourdHui);
  }, [periode]);

  const vueEquipe = peutVoirEquipePointage(actions);

  const filtres = useMemo(
    () => ({
      siteId,
      technicienId: vueEquipe ? undefined : technicienId,
      debutDu: bornes.debutDu,
      debutAu: bornes.debutAu,
      tri: 'debutLe:desc' as const,
    }),
    [siteId, vueEquipe, technicienId, bornes],
  );

  const requete = useListePointages(filtres, { enabled: Boolean(siteId) });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = requete;

  // Une vue de cumul a besoin de la collection ENTIÈRE de la période, pas d'une page à la fois —
  // charge le reste en tâche de fond dès qu'une page supplémentaire est annoncée.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const titre = periode === 'jour' ? t('pointage:jour.titre') : t('pointage:jour.titreSemaine');

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h2 className="texte-titre-section">{titre}</h2>
        <EtatChargement lignes={5} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h2 className="texte-titre-section">{titre}</h2>
        <EtatErreur
          titre={t('pointage:jour.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const cumuls = calculerCumulsParTechnicien(requete.pointages);
  const total = calculerCumulTotal(requete.pointages);

  const tableau =
    cumuls.length === 0 ? (
      <EtatVide
        titre={t('pointage:jour.vide.titre')}
        description={t('pointage:jour.vide.description')}
      />
    ) : (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left">
          <thead className="bg-muted/50 texte-libelle">
            <tr>
              <th className="p-3">{t('pointage:jour.colonnes.technicien')}</th>
              <th className="p-3 text-right">{t('pointage:jour.colonnes.productif')}</th>
              <th className="p-3 text-right">{t('pointage:jour.colonnes.indirect')}</th>
              <th className="p-3 text-right">{t('pointage:jour.colonnes.presence')}</th>
              <th className="p-3 text-right">{t('pointage:jour.colonnes.anomalies')}</th>
            </tr>
          </thead>
          <tbody>
            {cumuls.map((cumul) => (
              <tr key={cumul.technicienId} className="border-t">
                <td className="p-3">
                  <span className="font-medium">{cumul.technicienNomAffiche}</span>
                  {cumul.enCours ? (
                    <BadgeEnCoursPointage className="ml-2" />
                  ) : null}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {formaterDureeLisible(cumul.productifSecondes)}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {formaterDureeLisible(cumul.indirectSecondes)}
                </td>
                <td className="p-3 text-right font-medium tabular-nums">
                  {formaterDureeLisible(cumul.presenceSecondes)}
                </td>
                <td className="p-3 text-right">
                  {cumul.nombreAnomalies > 0 ? (
                    <BadgeAnomaliePointage>{cumul.nombreAnomalies}</BadgeAnomaliePointage>
                  ) : null}
                </td>
              </tr>
            ))}
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="p-3">{t('pointage:jour.total')}</td>
              <td className="p-3 text-right tabular-nums">
                {formaterDureeLisible(total.productifSecondes)}
              </td>
              <td className="p-3 text-right tabular-nums">
                {formaterDureeLisible(total.indirectSecondes)}
              </td>
              <td className="p-3 text-right tabular-nums">
                {formaterDureeLisible(total.presenceSecondes)}
              </td>
              <td className="p-3 text-right">
                {total.nombreAnomalies > 0 ? (
                  <BadgeAnomaliePointage>{total.nombreAnomalies}</BadgeAnomaliePointage>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <h2 className="texte-titre-section">{titre}</h2>
      {/* `Tabs` sert ici de simple bascule (le contenu ne diffère pas structurellement entre
       *  « jour » et « semaine », seule la période interrogée change) — même contenu déposé dans
       *  les DEUX `TabsContent` : Radix ne monte que celui du panneau actif, donc pas de double
       *  rendu simultané, et le panneau visible reste correctement associé à son onglet
       *  (`role="tabpanel"`, `aria-labelledby`) plutôt que rendu hors de toute structure Tabs. */}
      <Tabs value={periode} onValueChange={(valeur) => setPeriode(valeur as Periode)}>
        <TabsList>
          <TabsTrigger value="jour">{t('pointage:jour.filtres.jour')}</TabsTrigger>
          <TabsTrigger value="semaine">{t('pointage:jour.filtres.semaine')}</TabsTrigger>
        </TabsList>
        <TabsContent value="jour" className="pt-4">
          {tableau}
        </TabsContent>
        <TabsContent value="semaine" className="pt-4">
          {tableau}
        </TabsContent>
      </Tabs>
    </div>
  );
}
