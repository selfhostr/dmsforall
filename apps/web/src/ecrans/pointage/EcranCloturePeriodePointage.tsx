import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useQueries } from '@tanstack/react-query';

import type { ReponsePointage } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { clesPointage } from '@/hooks/pointage/cles';
import { obtenirPointage } from '@/hooks/pointage/pointage.api';
import { dateJourLocale } from '@/hooks/pointage/temps-pointage';
import { useArreterPointage } from '@/hooks/pointage/useArreterPointage';
import {
  useDeverrouillerPeriodePointage,
  useVerrouillerPeriodePointage,
} from '@/hooks/pointage/useVerrouillagePeriode';
import { useSession } from '@/hooks/useSession';

import { SelecteurSitePointage } from './SelecteurSitePointage';

/**
 * Défaut 4 — le corps `409` renvoyé par `POST /pointages/verrouiller-periode` quand un pointage
 * `en_cours` tombe dans la plage réutilise le code `CONFLIT` du socle (`contrats/probleme.ts`),
 * PARTAGÉ avec le conflit de verrouillage optimiste générique — `messageErreur` seul ne peut donc
 * pas les distinguer (les deux se traduisent en `erreurs:codes.CONFLIT`, message trompeur ici :
 * « Cet élément a été modifié entre-temps. Rechargez la page. », alors qu'il n'y a rien à
 * recharger). On distingue par la FORME du corps, pas seulement le code : un blocage nommé de
 * `type: 'pointage'` PLUS l'action proposée `ARRETER_POINTAGES` (§3.3 du contrat d'erreur) —
 * un conflit optimiste générique n'a ni l'un ni l'autre. Retourne la liste des identifiants de
 * pointage bloquants (potentiellement vide, jamais l'UUID affiché tel quel : ces `id` ne servent
 * qu'à charger le VRAI pointage via `GET /pointages/{id}`, qui porte `technicienNomAffiche`).
 */
function idsPointagesBlocantsVerrouillage(erreur: unknown): readonly string[] {
  if (!(erreur instanceof ErreurApi)) return [];
  if (erreur.probleme.code !== 'CONFLIT') return [];
  if (!erreur.actionsProposees.some((action) => action.code === 'ARRETER_POINTAGES')) return [];
  return erreur.blocages
    .filter((blocage) => blocage.type === 'pointage')
    .map((blocage) => blocage.id);
}

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
 * `en_cours` tombe dans la plage — jamais fermé de force (RM-113). CORRIGÉ (défaut 4) : ce `409`
 * partage son `code` avec le conflit de verrouillage optimiste générique du socle, donc
 * `messageErreur` seul y répond par un message FAUX (« Cet élément a été modifié entre-temps.
 * Rechargez la page. » — il n'y a rien à recharger, un pointage tourne encore). Ce module
 * distingue le cas précis (`idsPointagesBlocantsVerrouillage` ci-dessus), résout le(s)
 * technicien(s) concerné(s) en chargeant NOMMÉMENT les pointages bloquants (`blocages[].id`, un
 * `GET /pointages/{id}` par élément — jamais une liste large du site), et propose l'action que le
 * serveur indique explicitement (`actionsProposees: [{ code: 'ARRETER_POINTAGES' }]`) via
 * `useArreterPointage`, déjà utilisé ailleurs dans ce domaine pour la même transition.
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
  const arreterPointageBlocant = useArreterPointage();

  const [resultatVerrouillage, setResultatVerrouillage] = useState<number | undefined>(undefined);
  const [resultatDeverrouillage, setResultatDeverrouillage] = useState<number | undefined>(
    undefined,
  );

  // Défaut 4 : quand `verrouiller.error` est précisément le conflit « pointages en cours »
  // (`idsPointagesBlocantsVerrouillage` ci-dessus, distinct du conflit optimiste générique), on
  // charge les pointages bloquants NOMMÉMENT (`GET /pointages/{id}`, jamais une liste large du
  // site) pour résoudre leur `technicienNomAffiche` et permettre de les arrêter d'un geste.
  const idsBlocants = verrouiller.isError
    ? idsPointagesBlocantsVerrouillage(verrouiller.error)
    : [];
  const estConflitPointagesEnCours = idsBlocants.length > 0;
  const requetesPointagesBlocants = useQueries({
    queries: idsBlocants.map((id) => ({
      queryKey: clesPointage.detail(id),
      queryFn: () => obtenirPointage(id),
      enabled: estConflitPointagesEnCours,
    })),
  });
  const pointagesBlocantsCharges = requetesPointagesBlocants
    .map((requete) => requete.data)
    .filter((pointage): pointage is ReponsePointage => pointage !== undefined);
  const nomsTechniciensBlocants = Array.from(
    new Set(pointagesBlocantsCharges.map((pointage) => pointage.technicienNomAffiche)),
  );

  const [arretEnCours, setArretEnCours] = useState(false);
  const [arretErreur, setArretErreur] = useState<string | undefined>(undefined);
  const [arretReussi, setArretReussi] = useState(false);

  async function handleArreterPointagesBlocants() {
    setArretErreur(undefined);
    setArretReussi(false);
    setArretEnCours(true);
    try {
      await Promise.all(
        pointagesBlocantsCharges.map((pointage) =>
          arreterPointageBlocant.mutateAsync({
            id: pointage.id,
            technicienId: pointage.technicienId,
            siteId: pointage.siteId,
            entree: { finLe: new Date().toISOString() },
            idempotencyKey: genererCleIdempotence(),
          }),
        ),
      );
      setArretReussi(true);
      // L'alerte de blocage devient obsolète dès l'arrêt réussi — la retirer plutôt que de la
      // laisser affichée à côté du message de succès.
      verrouiller.reset();
    } catch (erreur) {
      setArretErreur(messageErreur(erreur, t));
    } finally {
      setArretEnCours(false);
    }
  }

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
    setArretReussi(false);
    setArretErreur(undefined);
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
                  <AlertDescription>
                    {estConflitPointagesEnCours
                      ? nomsTechniciensBlocants.length > 0
                        ? t('pointage:periode.verrouiller.blocageAvecTechniciens', {
                            liste: nomsTechniciensBlocants.join(', '),
                          })
                        : t('pointage:periode.verrouiller.blocage')
                      : messageErreur(verrouiller.error, t)}
                  </AlertDescription>
                  {estConflitPointagesEnCours ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      disabled={
                        arretEnCours ||
                        requetesPointagesBlocants.some((requete) => requete.isPending)
                      }
                      onClick={() => void handleArreterPointagesBlocants()}
                    >
                      {arretEnCours
                        ? t('pointage:periode.verrouiller.arretEnCours')
                        : t('pointage:periode.verrouiller.arreterPointages')}
                    </Button>
                  ) : null}
                </Alert>
              ) : null}

              {arretErreur ? (
                <Alert variant="destructive">
                  <AlertDescription>{arretErreur}</AlertDescription>
                </Alert>
              ) : null}

              {arretReussi ? (
                <Alert>
                  <AlertDescription>
                    {t('pointage:periode.verrouiller.arretReussi')}
                  </AlertDescription>
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
                  aria-describedby={
                    formDeverrouiller.formState.errors.motif
                      ? 'deverrouiller-motif-erreur'
                      : undefined
                  }
                  {...formDeverrouiller.register('motif', {
                    required: true,
                    validate: (valeur) => valeur.trim().length > 0,
                  })}
                />
                {formDeverrouiller.formState.errors.motif ? (
                  <p id="deverrouiller-motif-erreur" className="texte-libelle text-destructive">
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
