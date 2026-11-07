import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  BlocCreancier,
  EntreeModificationBlocCreancier,
} from '@/hooks/parametrage/bloc-creancier.api';
import { useModifierBlocCreancier } from '@/hooks/parametrage/useModifierBlocCreancier';

export interface ValeursAdresse {
  readonly rue: string;
  readonly numero: string;
  readonly npa: string;
  readonly localite: string;
  readonly pays: string;
}

const PAYS_ADMIS = ['CH', 'LI'] as const;

/** Rue, N°, NPA, localité et pays sont tous exigés à l'émission d'une QR-facture
 *  (`CHAMPS_REQUIS_BLOC_CREANCIER`) : l'adresse est complète quand les quatre premiers sont remplis
 *  (le pays a toujours une valeur). Lue sur les données serveur, pas sur un formulaire. */
export function adresseGarageComplete(bloc: BlocCreancier): boolean {
  return [bloc.rue, bloc.numero, bloc.npa, bloc.localite].every((v) => (v ?? '').trim() !== '');
}

function versValeurs(bloc: BlocCreancier): ValeursAdresse {
  return {
    rue: bloc.rue ?? '',
    numero: bloc.numero ?? '',
    npa: bloc.npa ?? '',
    localite: bloc.localite ?? '',
    pays: bloc.pays,
  };
}

function versEntree(v: ValeursAdresse): EntreeModificationBlocCreancier {
  const nul = (x: string): string | null => (x.trim() === '' ? null : x.trim());
  return {
    rue: nul(v.rue),
    numero: nul(v.numero),
    npa: nul(v.npa),
    localite: nul(v.localite),
    pays: v.pays,
  };
}

/** Adresse du garage de « Mon garage » : PATCH partiel du bloc créancier (adresse seule). */
export function FormulaireAdresseGarage({
  blocCreancier,
}: {
  readonly blocCreancier: BlocCreancier;
}) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const modifier = useModifierBlocCreancier();
  const [reussi, setReussi] = useState(false);
  const form = useForm<ValeursAdresse>({ defaultValues: versValeurs(blocCreancier) });

  const soumettre = form.handleSubmit((donnees) => {
    setReussi(false);
    modifier.mutate(versEntree(donnees), { onSuccess: () => setReussi(true) });
  });

  const erreur = modifier.error;
  const estReseau = erreur instanceof ErreurReseau;

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-6">
      <SectionAdresseGarage form={form} lectureSeule={modifier.isPending} />
      {erreur ? (
        <Alert variant={estReseau ? 'avertissement' : 'destructive'}>
          <AlertTitle>
            {t(estReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          </AlertTitle>
          <AlertDescription>{messageErreur(erreur, t)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={modifier.isPending}>
          {modifier.isPending ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
        </Button>
        {reussi && !modifier.isPending ? (
          <span className="flex items-center gap-1.5 texte-corps text-foreground">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('parametrage:creancier.enregistrementReussi')}
          </span>
        ) : null}
      </div>
    </form>
  );
}

interface PropsSectionAdresse {
  readonly form: UseFormReturn<ValeursAdresse>;
  readonly lectureSeule: boolean;
}

/** Adresse du garage — rue, numéro, NPA, localité et pays sont tous exigés à l'émission d'une
 *  QR-facture (`CHAMPS_REQUIS_BLOC_CREANCIER`) : étoile visuelle + `aria-required` sur chacun. */
function SectionAdresseGarage({ form, lectureSeule }: PropsSectionAdresse) {
  const { t } = useTranslation(['parametrage']);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('parametrage:creancier.adresse.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bc-rue" requis>
            {t('parametrage:creancier.adresse.rue')}
          </Label>
          <Input
            id="bc-rue"
            maxLength={70}
            readOnly={lectureSeule}
            aria-required="true"
            {...form.register('rue')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bc-numero" requis>
            {t('parametrage:creancier.adresse.numero')}
          </Label>
          <Input
            id="bc-numero"
            maxLength={16}
            readOnly={lectureSeule}
            aria-required="true"
            aria-describedby="bc-numero-aide"
            {...form.register('numero')}
          />
          <p id="bc-numero-aide" className="texte-corps text-muted-foreground">
            {t('parametrage:creancier.adresse.numeroAide')}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="bc-npa" requis>
              {t('parametrage:creancier.adresse.npa')}
            </Label>
            <Input
              id="bc-npa"
              maxLength={16}
              readOnly={lectureSeule}
              aria-required="true"
              {...form.register('npa')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-localite" requis>
              {t('parametrage:creancier.adresse.localite')}
            </Label>
            <Input
              id="bc-localite"
              maxLength={35}
              readOnly={lectureSeule}
              aria-required="true"
              {...form.register('localite')}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bc-pays" requis>
            {t('parametrage:creancier.adresse.pays')}
          </Label>
          <Select
            value={form.watch('pays')}
            onValueChange={(valeur) => form.setValue('pays', valeur)}
            disabled={lectureSeule}
          >
            <SelectTrigger
              id="bc-pays"
              aria-label={t('parametrage:creancier.adresse.pays')}
              aria-required="true"
              className="w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYS_ADMIS.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
