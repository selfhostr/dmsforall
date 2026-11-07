import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { LONGUEUR_MAX_RAISON_SOCIALE } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { useBlocCreancier } from '@/hooks/parametrage/useBlocCreancier';
import { useModifierBlocCreancier } from '@/hooks/parametrage/useModifierBlocCreancier';
import { useModifierParametresEntreprise } from '@/hooks/parametrage/useModifierParametresEntreprise';
import { useParametresEntreprise } from '@/hooks/parametrage/useParametresEntreprise';
import { validerNumeroTva } from '@/ecrans/parametrage/numero-tva';

import { champsAdresseManquants, LONGUEURS_ADRESSE, type ChampAdresse } from '../adresse';
import { ChampAssistant } from '../ChampAssistant';
import { useMemoireEtape } from '../memoire-etapes';
import { PiedEtape } from '../PiedEtape';
import type { PropsEtape } from '../types-etape';

type Assujetti = 'oui' | 'non' | undefined;

interface Saisie {
  readonly raisonSociale: string;
  readonly rue: string;
  readonly numero: string;
  readonly npa: string;
  readonly localite: string;
  readonly assujetti: Assujetti;
  readonly numeroTva: string;
}

/**
 * Étape 1 — « Votre garage ». Adresse -> bloc créancier (`PATCH /parametres-facturation/creancier`),
 * raison sociale et n° TVA -> `PATCH /parametres-entreprise` (un seul appel, seulement si l'un des
 * deux a changé). Le n° TVA est facultatif : « non assujetti » l'efface.
 */
export function EtapeGarage(props: PropsEtape) {
  const { t } = useTranslation(['assistant', 'erreurs', 'commun']);
  const entreprise = useParametresEntreprise();
  const creancier = useBlocCreancier();

  if (entreprise.isPending || creancier.isPending) {
    return (
      <div role="status" aria-label={t('assistant:chargement')} className="space-y-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (entreprise.isError || creancier.isError) {
    return (
      <EtatErreur
        titre={t('assistant:erreur.titre')}
        description={messageErreur(entreprise.error ?? creancier.error, t)}
        onReessayer={() => {
          void entreprise.refetch();
          void creancier.refetch();
        }}
      />
    );
  }

  return (
    <FormulaireGarage
      {...props}
      raisonSocialeActuelle={entreprise.data.raisonSociale}
      nomCreancier={creancier.data.nom}
      initial={{
        raisonSociale: entreprise.data.raisonSociale,
        rue: creancier.data.rue ?? '',
        numero: creancier.data.numero ?? '',
        npa: creancier.data.npa ?? '',
        localite: creancier.data.localite ?? '',
        assujetti: entreprise.data.numeroTva ? 'oui' : undefined,
        numeroTva: entreprise.data.numeroTva ?? '',
      }}
    />
  );
}

function FormulaireGarage({
  memoire,
  onSuivant,
  raisonSocialeActuelle,
  nomCreancier,
  initial,
}: PropsEtape & {
  readonly raisonSocialeActuelle: string;
  readonly nomCreancier: string | null;
  readonly initial: Saisie;
}) {
  const { t } = useTranslation(['assistant', 'erreurs', 'commun']);
  const [saisie, setSaisie] = useMemoireEtape<Saisie>(memoire, 'garage', initial);
  const [manquants, setManquants] = useState<readonly ChampAdresse[]>([]);
  const [raisonSocialeVide, setRaisonSocialeVide] = useState(false);
  const [raisonTva, setRaisonTva] = useState<'format' | 'cle' | undefined>(undefined);
  const [erreurEnvoi, setErreurEnvoi] = useState<unknown>(undefined);
  const modifierCreancier = useModifierBlocCreancier();
  const modifierEntreprise = useModifierParametresEntreprise();
  const enCours = modifierCreancier.isPending || modifierEntreprise.isPending;

  function maj(patch: Partial<Saisie>) {
    setSaisie((s) => ({ ...s, ...patch }));
  }

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreurEnvoi(undefined);
    const absents = champsAdresseManquants(saisie);
    setManquants(absents);
    const raisonSociale = saisie.raisonSociale.trim();
    setRaisonSocialeVide(raisonSociale === '');
    const tva = saisie.assujetti === 'oui' ? validerNumeroTva(saisie.numeroTva) : undefined;
    setRaisonTva(tva && !tva.ok ? tva.raison : undefined);
    if (raisonSociale === '' || absents.length > 0 || (tva && !tva.ok)) return;
    try {
      await modifierCreancier.mutateAsync({
        nom: (nomCreancier?.trim() || raisonSociale).slice(0, 70),
        rue: saisie.rue.trim(),
        numero: saisie.numero.trim() === '' ? null : saisie.numero.trim(),
        npa: saisie.npa.trim(),
        localite: saisie.localite.trim(),
      });
      const changements: { raisonSociale?: string; numeroTva?: string | null } = {};
      if (raisonSociale !== raisonSocialeActuelle) changements.raisonSociale = raisonSociale;
      if (saisie.assujetti === 'non') {
        changements.numeroTva = null;
      } else if (tva?.ok && tva.valeur !== null) {
        changements.numeroTva = tva.valeur;
      }
      if (Object.keys(changements).length > 0) {
        await modifierEntreprise.mutateAsync(changements);
      }
      onSuivant();
    } catch (erreur) {
      setErreurEnvoi(erreur);
    }
  }

  const erreurChamp = (champ: ChampAdresse, cle: string) =>
    manquants.includes(champ) ? t(cle) : undefined;

  return (
    <form onSubmit={(e) => void soumettre(e)} noValidate className="flex flex-col gap-5">
      <ChampAssistant
        libelle={t('assistant:garage.raisonSociale')}
        autoComplete="organization"
        maxLength={LONGUEUR_MAX_RAISON_SOCIALE}
        value={saisie.raisonSociale}
        onChange={(e) => {
          maj({ raisonSociale: e.target.value });
          setRaisonSocialeVide(false);
        }}
        erreur={raisonSocialeVide ? t('assistant:garage.erreurRaisonSociale') : undefined}
      />

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <ChampAssistant
            libelle={t('assistant:garage.rue')}
            autoComplete="address-line1"
            maxLength={LONGUEURS_ADRESSE.rue}
            value={saisie.rue}
            onChange={(e) => maj({ rue: e.target.value })}
            erreur={erreurChamp('rue', 'assistant:garage.erreurRue')}
          />
          <ChampAssistant
            libelle={t('assistant:garage.numero')}
            maxLength={LONGUEURS_ADRESSE.numero}
            value={saisie.numero}
            onChange={(e) => maj({ numero: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <ChampAssistant
            libelle={t('assistant:garage.npa')}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={LONGUEURS_ADRESSE.npa}
            value={saisie.npa}
            onChange={(e) => maj({ npa: e.target.value })}
            erreur={erreurChamp('npa', 'assistant:garage.erreurNpa')}
          />
          <ChampAssistant
            libelle={t('assistant:garage.localite')}
            autoComplete="address-level2"
            maxLength={LONGUEURS_ADRESSE.localite}
            value={saisie.localite}
            onChange={(e) => maj({ localite: e.target.value })}
            erreur={erreurChamp('localite', 'assistant:garage.erreurLocalite')}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="texte-libelle mb-2 font-medium">
          {t('assistant:garage.tva.question')}
        </legend>
        <div className="flex gap-6">
          {(['oui', 'non'] as const).map((valeur) => (
            <label key={valeur} className="flex min-h-11 items-center gap-2 texte-corps">
              <input
                type="radio"
                name="assujetti-tva"
                className="h-5 w-5 accent-[var(--marque)]"
                checked={saisie.assujetti === valeur}
                onChange={() => maj({ assujetti: valeur })}
              />
              {t(`assistant:garage.tva.${valeur}`)}
            </label>
          ))}
        </div>
        {saisie.assujetti === 'oui' ? (
          <ChampAssistant
            libelle={t('assistant:garage.tva.numero')}
            className="font-mono"
            autoComplete="off"
            placeholder="CHE-123.456.789 TVA"
            value={saisie.numeroTva}
            onChange={(e) => {
              maj({ numeroTva: e.target.value });
              setRaisonTva(undefined);
            }}
            erreur={
              raisonTva === 'format'
                ? t('assistant:garage.tva.erreurFormat')
                : raisonTva === 'cle'
                  ? t('assistant:garage.tva.erreurCle')
                  : undefined
            }
          />
        ) : null}
      </fieldset>

      {erreurEnvoi !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('assistant:erreur.enregistrement')} {messageErreur(erreurEnvoi, t)}
          </AlertDescription>
        </Alert>
      ) : null}

      <PiedEtape enCours={enCours} />
    </form>
  );
}
