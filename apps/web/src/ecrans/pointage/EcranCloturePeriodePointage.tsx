import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { dateJourLocale } from '@/hooks/pointage/temps-pointage';
import {
  useDeverrouillerPeriodePointage,
  useVerrouillerPeriodePointage,
} from '@/hooks/pointage/useVerrouillagePeriode';
import { useSession } from '@/hooks/useSession';

import { SelecteurSitePointage } from './SelecteurSitePointage';

interface ValeursVerrouillage {
  readonly jusquauLe: string;
  readonly motif: string;
}

/**
 * Clôture de période (RM-95) — verrouiller/déverrouiller les pointages d'un site jusqu'à une date
 * donnée. Réservé à l'encadrement (`ROLES_POINTAGE_ENCADREMENT`) : `comptable` en est explicitement
 * écarté des deux actions (arbitrage documenté dans `droits.ts` — clore/rouvrir une période de
 * pointage est une décision d'atelier, pas un geste comptable).
 *
 * `POST /pointages/verrouiller-periode` REFUSE l'opération entière (`409 CONFLIT`) si un pointage
 * `en_cours` tombe dans la plage — jamais fermé de force (RM-113). Le message d'erreur générique
 * (`messageErreur`) suffit à l'exposer ; ce module n'essaie pas de lister les pointages bloquants
 * un par un (`blocages[]` existe dans le contrat mais n'apporte rien de plus qu'un chef d'atelier
 * ne sache déjà — il vient de voir tourner les chronos de son équipe).
 */
export function EcranCloturePeriodePointage() {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session } = useSession();

  const [searchParams, setSearchParams] = useSearchParams();
  const siteParam = searchParams.get('site') ?? undefined;
  const sitesActifs = (session?.sites ?? []).filter((site) => site.actif);
  const siteId = siteParam ?? (sitesActifs.length === 1 ? sitesActifs[0]?.id : undefined);

  const verrouiller = useVerrouillerPeriodePointage();
  const deverrouiller = useDeverrouillerPeriodePointage();

  const [resultatVerrouillage, setResultatVerrouillage] = useState<number | undefined>(undefined);
  const [resultatDeverrouillage, setResultatDeverrouillage] = useState<number | undefined>(
    undefined,
  );

  const formVerrouiller = useForm<ValeursVerrouillage>({
    defaultValues: { jusquauLe: dateJourLocale(), motif: '' },
  });
  const formDeverrouiller = useForm<ValeursVerrouillage>({
    defaultValues: { jusquauLe: dateJourLocale(), motif: '' },
  });

  if (!siteId) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pointage:periode.titre')}</h1>
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

  const soumettreVerrouillage = formVerrouiller.handleSubmit((valeurs) => {
    setResultatVerrouillage(undefined);
    verrouiller.mutate(
      {
        siteId,
        jusquauLe: valeurs.jusquauLe,
        motif: valeurs.motif.trim() === '' ? undefined : valeurs.motif.trim(),
      },
      { onSuccess: (reponse) => setResultatVerrouillage(reponse.pointagesVerrouilles) },
    );
  });

  const soumettreDeverrouillage = formDeverrouiller.handleSubmit((valeurs) => {
    setResultatDeverrouillage(undefined);
    deverrouiller.mutate(
      { siteId, jusquauLe: valeurs.jusquauLe, motif: valeurs.motif.trim() },
      { onSuccess: (reponse) => setResultatDeverrouillage(reponse.pointagesDeverrouilles) },
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('pointage:periode.titre')}</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('pointage:periode.verrouiller.titre')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={soumettreVerrouillage} noValidate className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">
                {t('pointage:periode.verrouiller.description')}
              </p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="verrouiller-jusquau">
                  {t('pointage:periode.verrouiller.jusquau')}
                </Label>
                <Input
                  id="verrouiller-jusquau"
                  type="date"
                  {...formVerrouiller.register('jusquauLe', { required: true })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="verrouiller-motif">{t('pointage:periode.verrouiller.motif')}</Label>
                <Textarea id="verrouiller-motif" {...formVerrouiller.register('motif')} />
              </div>

              {verrouiller.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{messageErreur(verrouiller.error, t)}</AlertDescription>
                </Alert>
              ) : null}

              {resultatVerrouillage !== undefined ? (
                <Alert>
                  <AlertDescription>
                    {t('pointage:periode.verrouiller.resultat', { count: resultatVerrouillage })}
                  </AlertDescription>
                </Alert>
              ) : null}

              <Button type="submit" disabled={verrouiller.isPending}>
                {t('pointage:periode.verrouiller.action')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('pointage:periode.deverrouiller.titre')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={soumettreDeverrouillage} noValidate className="flex flex-col gap-4">
              <p className="texte-corps text-muted-foreground">
                {t('pointage:periode.deverrouiller.description')}
              </p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deverrouiller-jusquau">
                  {t('pointage:periode.deverrouiller.jusquau')}
                </Label>
                <Input
                  id="deverrouiller-jusquau"
                  type="date"
                  {...formDeverrouiller.register('jusquauLe', { required: true })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deverrouiller-motif">
                  {t('pointage:periode.deverrouiller.motif')}
                </Label>
                <Textarea
                  id="deverrouiller-motif"
                  aria-invalid={formDeverrouiller.formState.errors.motif ? true : undefined}
                  {...formDeverrouiller.register('motif', {
                    required: true,
                    validate: (valeur) => valeur.trim().length > 0,
                  })}
                />
                {formDeverrouiller.formState.errors.motif ? (
                  <p className="texte-libelle text-destructive">
                    {t('pointage:periode.deverrouiller.motifRequis')}
                  </p>
                ) : null}
              </div>

              {deverrouiller.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{messageErreur(deverrouiller.error, t)}</AlertDescription>
                </Alert>
              ) : null}

              {resultatDeverrouillage !== undefined ? (
                <Alert>
                  <AlertDescription>
                    {t('pointage:periode.deverrouiller.resultat', {
                      count: resultatDeverrouillage,
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}

              <Button type="submit" variant="destructive" disabled={deverrouiller.isPending}>
                {t('pointage:periode.deverrouiller.action')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
