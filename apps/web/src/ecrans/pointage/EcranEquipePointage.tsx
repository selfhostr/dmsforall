import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { ReponsePointage } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { useListeOrdresReparation } from '@/hooks/atelier/useListeOrdresReparation';
import {
  centiemesHeureEnSecondes,
  dateJourLocale,
  bornesJourneeLocale,
  formaterDureeLisible,
} from '@/hooks/pointage/temps-pointage';
import { useListePointages } from '@/hooks/pointage/useListePointages';
import { useSession } from '@/hooks/useSession';
import { formaterHeure } from '@/lib/formats';

import { DialogueCorrectionPointage } from './DialogueCorrectionPointage';
import { peutCorrigerPointage } from './droits';
import { libelleCibleEquipePointage } from './libelles';
import { SelecteurSitePointage } from './SelecteurSitePointage';

const DELAI_DEBOUNCE_MS = 300;

type Onglet = 'liste' | 'parOr';

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="texte-libelle text-muted-foreground">
            {t('pointage:equipe.parOr.tempsReel')}
          </p>
          <p className="text-xl font-semibold tabular-nums">
            {formaterDureeLisible(centiemesHeureEnSecondes(tempsReelCentiemes))}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="texte-libelle text-muted-foreground">
            {t('pointage:equipe.parOr.tempsFacture')}
          </p>
          <p className="text-xl font-semibold tabular-nums">
            {formaterDureeLisible(centiemesHeureEnSecondes(tempsFactureCentiemes))}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="texte-libelle text-muted-foreground">{t('pointage:equipe.parOr.ecart')}</p>
          <p
            className={`text-xl font-semibold tabular-nums ${ecartCentiemes > 0 ? 'text-destructive' : ''}`}
          >
            {ecartCentiemes >= 0 ? '+' : ''}
            {formaterDureeLisible(centiemesHeureEnSecondes(Math.abs(ecartCentiemes)))}
          </p>
        </div>
      </div>

      {or.cumulsPointage.parTechnicien.length > 0 ? (
        <div>
          <h3 className="mb-2 texte-titre-section">{t('pointage:equipe.parOr.parTechnicien')}</h3>
          <div className="flex flex-col gap-2">
            {or.cumulsPointage.parTechnicien.map((ligne) => (
              <div
                key={ligne.technicienId}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <span>{ligne.nomAffiche}</span>
                <span className="tabular-nums">
                  {formaterDureeLisible(centiemesHeureEnSecondes(ligne.centiemes))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Écran chef d'atelier — pointages de TOUS les techniciens du site (`atelier.pointage.
 * corriger_autrui`, RM-94/RM-99), avec correction manuelle et vue par OR (temps réellement passé
 * vs temps facturé). Réservé à l'encadrement (`ROLES_POINTAGE_ENCADREMENT`, `droits.ts`).
 */
export function EcranEquipePointage() {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const [searchParams, setSearchParams] = useSearchParams();
  const siteParam = searchParams.get('site') ?? undefined;
  const sitesActifs = (session?.sites ?? []).filter((site) => site.actif);
  const siteId = siteParam ?? (sitesActifs.length === 1 ? sitesActifs[0]?.id : undefined);

  const [onglet, setOnglet] = useState<Onglet>('liste');
  const [pointageACorriger, setPointageACorriger] = useState<ReponsePointage | undefined>(
    undefined,
  );

  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');
  const [orSelectionneId, setOrSelectionneId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

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

  if (!siteId) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pointage:equipe.titre')}</h1>
        <SelecteurSitePointage
          onChoisir={(valeur) => {
            const parametres = new URLSearchParams(searchParams);
            parametres.set('site', valeur);
            setSearchParams(parametres);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pointage:equipe.titre')}</h1>
        <Tabs value={onglet} onValueChange={(valeur) => setOnglet(valeur as Onglet)}>
          <TabsList>
            <TabsTrigger value="liste">{t('pointage:equipe.onglets.liste')}</TabsTrigger>
            <TabsTrigger value="parOr">{t('pointage:equipe.onglets.parOr')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {onglet === 'liste' ? (
        <>
          {requeteListe.isPending ? <EtatChargement lignes={6} /> : null}

          {requeteListe.isError ? (
            <EtatErreur
              titre={t('pointage:equipe.erreur.titre')}
              description={messageErreur(requeteListe.error, t)}
              onReessayer={() => void requeteListe.refetch()}
            />
          ) : null}

          {!requeteListe.isPending && !requeteListe.isError ? (
            requeteListe.pointages.length === 0 ? (
              <EtatVide
                titre={t('pointage:equipe.vide.titre')}
                description={t('pointage:equipe.vide.description')}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left">
                  <thead className="bg-muted/50 texte-libelle">
                    <tr>
                      <th className="p-3">{t('pointage:equipe.colonnes.technicien')}</th>
                      <th className="p-3">{t('pointage:equipe.colonnes.cible')}</th>
                      <th className="p-3">{t('pointage:equipe.colonnes.debut')}</th>
                      <th className="p-3">{t('pointage:equipe.colonnes.fin')}</th>
                      <th className="p-3 text-right">{t('pointage:equipe.colonnes.duree')}</th>
                      <th className="p-3">{t('pointage:equipe.colonnes.statut')}</th>
                      <th className="p-3">{t('pointage:equipe.colonnes.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requeteListe.pointages.map((pointage) => (
                      <tr key={pointage.id} className="border-t">
                        <td className="p-3">{pointage.technicienNomAffiche}</td>
                        <td className="p-3">{libelleCibleEquipePointage(pointage, t)}</td>
                        <td className="p-3 tabular-nums">{formaterHeure(pointage.debutLe)}</td>
                        <td className="p-3 tabular-nums">
                          {pointage.finLe ? formaterHeure(pointage.finLe) : ''}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {pointage.dureeBruteSecondes !== null
                            ? formaterDureeLisible(pointage.dureeBruteSecondes)
                            : ''}
                        </td>
                        <td className="p-3">
                          <Badge variant={pointage.statut === 'en_cours' ? 'secondary' : 'outline'}>
                            {t(`pointage:statuts.${pointage.statut}`)}
                          </Badge>
                          {pointage.anomalie && pointage.anomalie.traiteeLe === null ? (
                            <Badge variant="destructive" className="ml-1">
                              {t('pointage:anomalies.corriger')}
                            </Badge>
                          ) : null}
                        </td>
                        <td className="p-3">
                          {peutCorrigerPointage(role) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPointageACorriger(pointage)}
                            >
                              {t('pointage:equipe.corriger')}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <BoutonChargerPlus
                  aChargerPlus={Boolean(requeteListe.hasNextPage)}
                  enChargement={requeteListe.isFetchingNextPage}
                  onChargerPlus={() => void requeteListe.fetchNextPage()}
                  className="border-t"
                />
              </div>
            )
          ) : null}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('pointage:equipe.onglets.parOr')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="equipe-recherche-or">
                {t('pointage:equipe.parOr.rechercherOrLabel')}
              </Label>
              <Input
                id="equipe-recherche-or"
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
                    className="flex items-center justify-between rounded-md border p-3 text-left hover:bg-muted"
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
      )}

      <DialogueCorrectionPointage
        ouvert={Boolean(pointageACorriger)}
        onOuvertChange={(valeur) => !valeur && setPointageACorriger(undefined)}
        pointage={pointageACorriger}
        onCorrige={() => setPointageACorriger(undefined)}
      />
    </div>
  );
}
