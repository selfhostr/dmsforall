import type { ActionsSession } from '@/droits';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponsePointage } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { useListeOrdresReparation } from '@/hooks/atelier/useListeOrdresReparation';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import {
  centiemesHeureEnSecondes,
  dateJourLocale,
  bornesJourneeLocale,
  formaterDureeLisible,
} from '@/hooks/pointage/temps-pointage';
import { useListePointages } from '@/hooks/pointage/useListePointages';
import { formaterHeure } from '@/lib/formats';

import { DialogueCloturePeriode } from './DialogueCloturePeriode';
import { DialogueCorrectionPointage } from './DialogueCorrectionPointage';
import { peutCorrigerPointage, peutVerrouillerPeriode } from './droits';
import { libelleCiblePointage } from './libelles';

const DELAI_DEBOUNCE_MS = 300;

type Onglet = 'liste' | 'parOr';

interface Props {
  /** Résolu par l'appelant (`EcranPointage`) — cette vue ne gère plus sa propre gate de site,
   *  consolidée une seule fois au niveau de l'écran (voir l'en-tête d'`EcranPointage.tsx`). */
  readonly siteId: string;
  readonly actions: ActionsSession;
}

function CarteParOr({ orId }: { readonly orId: string }) {
  const { t } = useTranslation(['pointage', 'commun']);
  const requete = useOrdreReparation(orId);

  if (requete.isPending) return <EtatChargement lignes={4} />;
  if (requete.isError) {
    return (
      <EtatErreur
        titre={t('pointage:equipe.erreur.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }

  const or = requete.data;
  const tempsReelCentiemes = or.cumulsPointage.totalCentiemes;
  const tempsFactureCentiemes = or.lignes.reduce(
    (total, ligne) => total + (ligne.tempsBaremeCentiemes ?? 0),
    0,
  );
  const ecartCentiemes = tempsReelCentiemes - tempsFactureCentiemes;

  if (or.cumulsPointage.parTechnicien.length === 0 && tempsReelCentiemes === 0) {
    return <EtatVide titre={t('pointage:equipe.parOr.aucunPointage')} description="" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* `items-start` obligatoire avec `compact` (DESIGN.md) : sans lui, CSS Grid étire chaque
          carte à la hauteur de la plus haute et le padding réduit ne se voit plus. Trois cartes
          chiffrées (un chiffre, un libellé) — candidat exact du levier `compact` (DESIGN.md
          « candidats évidents… une carte, un chiffre, un libellé »). */}
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
        <Card compact>
          <CardContent>
            <p className="texte-libelle text-muted-foreground">
              {t('pointage:equipe.parOr.tempsReel')}
            </p>
            <p className="texte-titre-page font-semibold tabular-nums">
              {formaterDureeLisible(centiemesHeureEnSecondes(tempsReelCentiemes))}
            </p>
          </CardContent>
        </Card>
        <Card compact>
          <CardContent>
            <p className="texte-libelle text-muted-foreground">
              {t('pointage:equipe.parOr.tempsFacture')}
            </p>
            <p className="texte-titre-page font-semibold tabular-nums">
              {formaterDureeLisible(centiemesHeureEnSecondes(tempsFactureCentiemes))}
            </p>
          </CardContent>
        </Card>
        <Card compact>
          <CardContent>
            <p className="texte-libelle text-muted-foreground">
              {t('pointage:equipe.parOr.ecart')}
            </p>
            <p
              className={`texte-titre-page font-semibold tabular-nums ${ecartCentiemes > 0 ? 'text-destructive' : ''}`}
            >
              {ecartCentiemes >= 0 ? '+' : ''}
              {formaterDureeLisible(centiemesHeureEnSecondes(Math.abs(ecartCentiemes)))}
            </p>
          </CardContent>
        </Card>
      </div>

      {or.cumulsPointage.parTechnicien.length > 0 ? (
        <div>
          <h3 className="mb-2 texte-titre-section">{t('pointage:equipe.parOr.parTechnicien')}</h3>
          {/* Filet seul entre les lignes (pattern Carbon, comme le tableau `contenuListe` plus bas)
              plutôt qu'un contour complet par ligne : un seul cadre (`rounded-lg border`) porte la
              séparation avec le fond, `divide-y` sépare les lignes entre elles. */}
          <ul className="flex flex-col divide-y divide-border rounded-lg border">
            {or.cumulsPointage.parTechnicien.map((ligne) => (
              <li key={ligne.technicienId} className="flex items-center justify-between p-3">
                <span>{ligne.nomAffiche}</span>
                <span className="tabular-nums">
                  {formaterDureeLisible(centiemesHeureEnSecondes(ligne.centiemes))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Vue « Équipe » de l'écran de pointage (Lot D, `docs/refonte-navigation.md`) — pointages de TOUS
 * les techniciens du site (`atelier.pointage.corriger_autrui`, RM-94/RM-99), avec correction
 * manuelle et vue par OR (temps réellement passé vs temps facturé). N'est montée par `EcranPointage`
 * que pour l'encadrement (`peutVoirEquipePointage`) — ce composant ne revérifie donc pas l'accès à
 * la vue elle-même, seulement les actions internes (`peutCorrigerPointage`, `peutVerrouillerPeriode`),
 * par défense en profondeur et parce que ces deux fonctions ont un périmètre plus étroit que
 * `peutVoirEquipePointage` pourrait un jour en avoir (voir la note d'INFÉRENCE dans `droits.ts`).
 *
 * Lot E : la clôture de période (RM-95, anciennement `EcranCloturePeriodePointage`) est désormais
 * une action « en tête de la vue équipe » (bouton -> `DialogueCloturePeriode`) plutôt qu'un écran
 * séparé — « on clôture ce qu'on regarde ».
 *
 * Anciennement `EcranEquipePointage` — voir l'en-tête d'`EcranPointage.tsx` pour la fusion.
 */
export function VueEquipePointage({ siteId, actions }: Props) {
  const { t } = useTranslation(['pointage', 'commun']);

  const [onglet, setOnglet] = useState<Onglet>('liste');
  const [pointageACorriger, setPointageACorriger] = useState<ReponsePointage | undefined>(
    undefined,
  );
  const [cloturePeriodeOuverte, setCloturePeriodeOuverte] = useState(false);

  const [qSaisie, setQSaisie] = useState('');
  const [q] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);
  const [orSelectionneId, setOrSelectionneId] = useState<string | undefined>(undefined);

  const bornes = useMemo(() => bornesJourneeLocale(dateJourLocale()), []);
  const filtresListe = useMemo(
    () => ({
      siteId,
      debutDu: bornes.debutDu,
      debutAu: bornes.debutAu,
      tri: 'debutLe:desc' as const,
    }),
    [siteId, bornes],
  );
  const requeteListe = useListePointages(filtresListe, {
    enabled: Boolean(siteId) && onglet === 'liste',
  });

  const requeteOrdres = useListeOrdresReparation({ q, siteId, tri: 'ouvertLe:desc' });

  const contenuListe = requeteListe.isPending ? (
    <EtatChargement lignes={6} />
  ) : requeteListe.isError ? (
    <EtatErreur
      titre={t('pointage:equipe.erreur.titre')}
      description={messageErreur(requeteListe.error, t)}
      onReessayer={() => void requeteListe.refetch()}
    />
  ) : requeteListe.pointages.length === 0 ? (
    <EtatVide
      titre={t('pointage:equipe.vide.titre')}
      description={t('pointage:equipe.vide.description')}
    />
  ) : (
    <div className="flex flex-col">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('pointage:equipe.colonnes.technicien')}</TableHead>
            <TableHead>{t('pointage:equipe.colonnes.cible')}</TableHead>
            <TableHead>{t('pointage:equipe.colonnes.debut')}</TableHead>
            <TableHead>{t('pointage:equipe.colonnes.fin')}</TableHead>
            <TableHead className="text-right">{t('pointage:equipe.colonnes.duree')}</TableHead>
            <TableHead>{t('pointage:equipe.colonnes.statut')}</TableHead>
            <TableHead>{t('pointage:equipe.colonnes.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requeteListe.pointages.map((pointage) => (
            <TableRow key={pointage.id}>
              <TableCell>{pointage.technicienNomAffiche}</TableCell>
              <TableCell>{libelleCiblePointage(pointage, t)}</TableCell>
              <TableCell className="tabular-nums">{formaterHeure(pointage.debutLe)}</TableCell>
              <TableCell className="tabular-nums">
                {pointage.finLe ? formaterHeure(pointage.finLe) : ''}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {pointage.dureeBruteSecondes !== null
                  ? formaterDureeLisible(pointage.dureeBruteSecondes)
                  : ''}
              </TableCell>
              <TableCell>
                <Badge variant={pointage.statut === 'en_cours' ? 'secondary' : 'outline'}>
                  {t(`pointage:statuts.${pointage.statut}`)}
                </Badge>
                {pointage.anomalie && pointage.anomalie.traiteeLe === null ? (
                  <Badge variant="destructive" className="ml-1">
                    {t('pointage:anomalies.corriger')}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                {peutCorrigerPointage(actions) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPointageACorriger(pointage)}
                  >
                    {t('pointage:equipe.corriger')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <BoutonChargerPlus
        aChargerPlus={Boolean(requeteListe.hasNextPage)}
        enChargement={requeteListe.isFetchingNextPage}
        onChargerPlus={() => void requeteListe.fetchNextPage()}
        className="border-t"
      />
    </div>
  );

  const contenuParOr = (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('pointage:equipe.onglets.parOr')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Input
            id="equipe-recherche-or"
            aria-label={t('pointage:equipe.parOr.rechercherOrLabel')}
            value={qSaisie}
            onChange={(evenement) => setQSaisie(evenement.target.value)}
            placeholder={t('pointage:equipe.parOr.rechercherOrPlaceholder')}
          />
        </div>

        {requeteOrdres.isPending ? <EtatChargement lignes={3} /> : null}
        {requeteOrdres.isError ? (
          <EtatErreur
            titre={t('pointage:equipe.erreur.titre')}
            description={messageErreur(requeteOrdres.error, t)}
            onReessayer={() => void requeteOrdres.refetch()}
          />
        ) : null}

        {!requeteOrdres.isPending && !requeteOrdres.isError ? (
          <div className="flex flex-col gap-2">
            {requeteOrdres.ordres.map((or) => (
              <button
                key={or.id}
                type="button"
                onClick={() => setOrSelectionneId(or.id)}
                // Bordure conservée : carte cliquable d'une liste de sélection (choisir un OR),
                // zone d'action réelle (DESIGN.md). `anneau-focus` remplace l'anneau natif du
                // navigateur pour rester sur le mécanisme de focus standard du dépôt.
                className="flex items-center justify-between rounded-md border p-3 text-left hover:bg-muted anneau-focus"
              >
                <span className="font-medium">{or.numero}</span>
                <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />
              </button>
            ))}
          </div>
        ) : null}

        {orSelectionneId ? (
          <CarteParOr orId={orSelectionneId} />
        ) : (
          <EtatVide titre={t('pointage:equipe.parOr.choisirOr')} description="" />
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="texte-titre-section">{t('pointage:equipe.titre')}</h2>
        {peutVerrouillerPeriode(actions) ? (
          <Button variant="outline" onClick={() => setCloturePeriodeOuverte(true)}>
            {t('pointage:equipe.clotureAction')}
          </Button>
        ) : null}
      </div>

      <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as Onglet)}>
        <TabsList>
          <TabsTrigger value="liste">{t('pointage:equipe.onglets.liste')}</TabsTrigger>
          <TabsTrigger value="parOr">{t('pointage:equipe.onglets.parOr')}</TabsTrigger>
        </TabsList>
        <TabsContent value="liste" className="pt-4">
          {contenuListe}
        </TabsContent>
        <TabsContent value="parOr" className="pt-4">
          {contenuParOr}
        </TabsContent>
      </Tabs>

      <DialogueCorrectionPointage
        ouvert={Boolean(pointageACorriger)}
        onOuvertChange={(valeur) => !valeur && setPointageACorriger(undefined)}
        pointage={pointageACorriger}
        onCorrige={() => setPointageACorriger(undefined)}
      />

      <DialogueCloturePeriode
        ouvert={cloturePeriodeOuverte}
        onOuvertChange={setCloturePeriodeOuverte}
        siteId={siteId}
      />
    </div>
  );
}
