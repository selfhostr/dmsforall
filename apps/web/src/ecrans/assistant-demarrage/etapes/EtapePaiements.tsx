import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { useBlocCreancier } from '@/hooks/parametrage/useBlocCreancier';
import { useModifierBlocCreancier } from '@/hooks/parametrage/useModifierBlocCreancier';

import { ChampAssistant } from '../ChampAssistant';
import { classerCompte, grouperIban } from '../iban';
import { useMemoireEtape } from '../memoire-etapes';
import { PiedEtape } from '../PiedEtape';
import type { PropsEtape } from '../types-etape';

interface Saisie {
  readonly comptantSeulement: boolean;
  readonly iban: string;
}

/** Étape 2 — IBAN / QR-IBAN (`PATCH /parametres-facturation/creancier`). Facultative. */
export function EtapePaiements(props: PropsEtape) {
  const { t } = useTranslation(['assistant', 'erreurs', 'commun']);
  const creancier = useBlocCreancier();
  if (creancier.isPending) {
    return (
      <div role="status" aria-label={t('assistant:chargement')} className="space-y-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (creancier.isError) {
    return (
      <EtatErreur
        titre={t('assistant:erreur.titre')}
        description={messageErreur(creancier.error, t)}
        onReessayer={() => void creancier.refetch()}
      />
    );
  }
  const compte = creancier.data.qrIban ?? creancier.data.iban ?? '';
  return <FormulairePaiements {...props} ibanInitial={compte === '' ? '' : grouperIban(compte)} />;
}

function FormulairePaiements({
  memoire,
  onSuivant,
  onRetour,
  onPasser,
  ibanInitial,
}: PropsEtape & { readonly ibanInitial: string }) {
  const { t } = useTranslation(['assistant', 'erreurs', 'commun']);
  const [saisie, setSaisie] = useMemoireEtape<Saisie>(memoire, 'paiements', {
    comptantSeulement: false,
    iban: ibanInitial,
  });
  const modifier = useModifierBlocCreancier();
  const [erreurEnvoi, setErreurEnvoi] = useState<unknown>(undefined);

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreurEnvoi(undefined);
    const compte = saisie.comptantSeulement ? null : classerCompte(saisie.iban);
    if (compte === null) {
      onSuivant();
      return;
    }
    try {
      await modifier.mutateAsync(
        'qrIban' in compte
          ? { qrIban: compte.qrIban, iban: null }
          : { iban: compte.iban, qrIban: null },
      );
      onSuivant();
    } catch (erreur) {
      setErreurEnvoi(erreur);
    }
  }

  return (
    <form onSubmit={(e) => void soumettre(e)} noValidate className="flex flex-col gap-5">
      <div className="flex items-start gap-1">
        <Checkbox
          id="assistant-comptant"
          checked={saisie.comptantSeulement}
          onCheckedChange={(v) => setSaisie((s) => ({ ...s, comptantSeulement: v === true }))}
        />
        <div className="pt-2.5">
          <Label htmlFor="assistant-comptant">{t('assistant:paiements.comptant')}</Label>
        </div>
      </div>

      <ChampAssistant
        libelle={t('assistant:paiements.iban')}
        className="font-mono"
        autoComplete="off"
        placeholder="CH93 0076 2011 6238 5295 7"
        disabled={saisie.comptantSeulement}
        value={saisie.iban}
        onChange={(e) => setSaisie((s) => ({ ...s, iban: e.target.value }))}
        aide={t('assistant:paiements.ibanAide')}
      />

      {erreurEnvoi !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{messageErreur(erreurEnvoi, t)}</AlertDescription>
        </Alert>
      ) : null}

      <PiedEtape onRetour={onRetour} onPasser={onPasser} enCours={modifier.isPending} />
    </form>
  );
}
