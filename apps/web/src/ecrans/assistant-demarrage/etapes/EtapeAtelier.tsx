import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { Langue } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { formaterMontant } from '@/lib/formats';
import { centimesVersSaisie, francsVersCentimes } from '@/lib/montants';
import { useCreerMotifRendezVous } from '@/hooks/parametrage/useMotifsRendezVousGestion';
import { useCreerTauxHoraire } from '@/hooks/parametrage/useCreerTauxHoraire';
import { useListeTauxHoraires } from '@/hooks/parametrage/useListeTauxHoraires';
import { useModifierParametresSite } from '@/hooks/parametres/useModifierParametresSite';
import { useParametresSite } from '@/hooks/parametres/useParametresSite';
import { useMotifsRendezVous } from '@/hooks/rendez-vous/useMotifsRendezVous';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';

import { ChampAssistant } from '../ChampAssistant';
import { useMemoireEtape } from '../memoire-etapes';
import { MOTIFS_PROPOSES, motifsACreer } from '../motifs-proposes';
import { PiedEtape } from '../PiedEtape';
import type { PropsEtape } from '../types-etape';

const TAUX_DEFAUT_CENTIMES = 14000;
const CODE_TAUX = 'MAIN-OEUVRE';
const LIBELLE_TAUX = "Main-d'œuvre";

interface Saisie {
  readonly taux: string;
  readonly ouverture: string;
  readonly fermeture: string;
  readonly motifs: readonly string[];
}

/**
 * Étape 3 — Atelier. Taux horaire (`POST /referentiels/taux-horaires`, seulement si aucun n'existe),
 * heures d'ouverture (`PATCH /sites/{id}/parametres-atelier`, garage mono-site), motifs de
 * rendez-vous (`POST /motifs-rendez-vous`, seulement ceux qui n'existent pas).
 */
export function EtapeAtelier(props: PropsEtape) {
  const { t } = useTranslation(['assistant', 'erreurs', 'commun']);
  const { estMonoSite, siteId } = useSiteImplicite();
  const taux = useListeTauxHoraires();
  const motifs = useMotifsRendezVous();
  const site = useParametresSite(estMonoSite ? siteId : undefined);

  if (taux.isPending || motifs.isPending || (estMonoSite && site.isPending)) {
    return (
      <div role="status" aria-label={t('assistant:chargement')} className="space-y-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const erreurLecture = taux.error ?? motifs.error ?? (estMonoSite ? site.error : null);
  if (erreurLecture) {
    return (
      <EtatErreur
        titre={t('assistant:erreur.titre')}
        description={messageErreur(erreurLecture, t)}
        onReessayer={() => {
          void taux.refetch();
          void motifs.refetch();
          if (estMonoSite) void site.refetch();
        }}
      />
    );
  }

  const tauxExistant = taux.data?.pages.flatMap((p) => p.donnees)[0];
  const codesExistants = new Set((motifs.data ?? []).map((m) => m.code));
  return (
    <FormulaireAtelier
      {...props}
      siteId={estMonoSite ? siteId : undefined}
      tauxExistantCentimes={tauxExistant?.montantCentimes}
      codesExistants={codesExistants}
      ouvertureInitiale={site.data?.heureOuverture ?? ''}
      fermetureInitiale={site.data?.heureFermeture ?? ''}
    />
  );
}

function FormulaireAtelier({
  memoire,
  onSuivant,
  onRetour,
  onPasser,
  siteId,
  tauxExistantCentimes,
  codesExistants,
  ouvertureInitiale,
  fermetureInitiale,
}: PropsEtape & {
  readonly siteId: string | undefined;
  readonly tauxExistantCentimes: number | undefined;
  readonly codesExistants: ReadonlySet<string>;
  readonly ouvertureInitiale: string;
  readonly fermetureInitiale: string;
}) {
  const { t, i18n } = useTranslation(['assistant', 'erreurs', 'commun']);
  const langue = (
    ['fr', 'de', 'it'].includes(i18n.language.slice(0, 2)) ? i18n.language.slice(0, 2) : 'fr'
  ) as Langue;
  const [saisie, setSaisie] = useMemoireEtape<Saisie>(memoire, 'atelier', {
    taux: centimesVersSaisie(TAUX_DEFAUT_CENTIMES),
    ouverture: ouvertureInitiale,
    fermeture: fermetureInitiale,
    motifs: MOTIFS_PROPOSES.map((m) => m.code),
  });
  const [montantInvalide, setMontantInvalide] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<unknown>(undefined);
  const creerTaux = useCreerTauxHoraire();
  const modifierSite = useModifierParametresSite();
  const creerMotif = useCreerMotifRendezVous();
  const enCours = creerTaux.isPending || modifierSite.isPending || creerMotif.isPending;

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreurEnvoi(undefined);
    const centimes = francsVersCentimes(saisie.taux);
    if (tauxExistantCentimes === undefined && (centimes === null || centimes <= 0)) {
      setMontantInvalide(true);
      return;
    }
    setMontantInvalide(false);
    try {
      if (tauxExistantCentimes === undefined && centimes !== null) {
        await creerTaux.mutateAsync({
          code: CODE_TAUX,
          libelle: LIBELLE_TAUX,
          montantCentimes: centimes,
          valideDuLe: new Date().toISOString().slice(0, 10),
        });
      }
      if (
        siteId &&
        (saisie.ouverture !== ouvertureInitiale || saisie.fermeture !== fermetureInitiale)
      ) {
        await modifierSite.mutateAsync({
          siteId,
          entree: {
            heureOuverture: saisie.ouverture === '' ? null : saisie.ouverture,
            heureFermeture: saisie.fermeture === '' ? null : saisie.fermeture,
          },
        });
      }
      for (const motif of motifsACreer(new Set(saisie.motifs), codesExistants)) {
        await creerMotif.mutateAsync({
          code: motif.code,
          libelleFr: motif.libelle.fr,
          libelleDe: motif.libelle.de,
          libelleIt: motif.libelle.it,
          dureeDefautMinutes: motif.dureeMinutes,
        });
      }
      onSuivant();
    } catch (erreur) {
      setErreurEnvoi(erreur);
    }
  }

  function basculer(code: string, coche: boolean) {
    setSaisie((s) => ({
      ...s,
      motifs: coche ? [...s.motifs, code] : s.motifs.filter((c) => c !== code),
    }));
  }

  return (
    <form onSubmit={(e) => void soumettre(e)} noValidate className="flex flex-col gap-5">
      {tauxExistantCentimes !== undefined ? (
        <p className="texte-corps">
          {t('assistant:atelier.tauxDejaDefini', {
            montant: formaterMontant(tauxExistantCentimes),
          })}
        </p>
      ) : (
        <ChampAssistant
          libelle={t('assistant:atelier.tauxHoraire')}
          classeRacine="max-w-xs"
          inputMode="decimal"
          autoComplete="off"
          value={saisie.taux}
          onChange={(e) => {
            setSaisie((s) => ({ ...s, taux: e.target.value }));
            setMontantInvalide(false);
          }}
          aide={t('assistant:atelier.tauxHoraireAide')}
          erreur={montantInvalide ? t('assistant:atelier.erreurMontant') : undefined}
        />
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="texte-libelle mb-2 font-medium">
          {t('assistant:atelier.horaires')}
        </legend>
        {siteId ? (
          <div className="flex flex-wrap gap-4">
            <ChampAssistant
              libelle={t('assistant:atelier.ouverture')}
              type="time"
              value={saisie.ouverture}
              onChange={(e) => setSaisie((s) => ({ ...s, ouverture: e.target.value }))}
            />
            <ChampAssistant
              libelle={t('assistant:atelier.fermeture')}
              type="time"
              value={saisie.fermeture}
              onChange={(e) => setSaisie((s) => ({ ...s, fermeture: e.target.value }))}
            />
          </div>
        ) : (
          <p className="texte-corps text-muted-foreground">
            {t('assistant:atelier.horairesPlusieursSites')}
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="texte-libelle font-medium">{t('assistant:atelier.motifs')}</legend>
        <p className="texte-libelle mb-1 text-muted-foreground">
          {t('assistant:atelier.motifsAide')}
        </p>
        <ul className="grid gap-x-4 sm:grid-cols-2">
          {MOTIFS_PROPOSES.map((m) => {
            const present = codesExistants.has(m.code);
            const id = `assistant-motif-${m.code}`;
            return (
              <li key={m.code} className="flex items-center gap-1">
                <Checkbox
                  id={id}
                  checked={present || saisie.motifs.includes(m.code)}
                  disabled={present}
                  onCheckedChange={(v) => basculer(m.code, v === true)}
                />
                <Label htmlFor={id} className="font-normal">
                  {m.libelle[langue]}
                  {present ? (
                    <span className="ml-2 text-muted-foreground">
                      ({t('assistant:atelier.motifDejaPresent')})
                    </span>
                  ) : null}
                </Label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {erreurEnvoi !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('assistant:erreur.enregistrement')} {messageErreur(erreurEnvoi, t)}
          </AlertDescription>
        </Alert>
      ) : null}

      <PiedEtape onRetour={onRetour} onPasser={onPasser} enCours={enCours} />
    </form>
  );
}
