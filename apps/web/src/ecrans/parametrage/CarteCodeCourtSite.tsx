import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { schemaCodeCourtSite } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModifierSite } from '@/hooks/parametres/useModifierSite';

const schemaFormulaire = z.object({ codeCourt: schemaCodeCourtSite });
type ValeursCodeCourt = z.input<typeof schemaFormulaire>;

interface Props {
  readonly siteId: string;
  readonly codeCourt: string;
  readonly peutEcrire: boolean;
}

/** Code court d'un site (« MART ») : l'étiquette des filtres de site. Saisie en majuscules. */
export function CarteCodeCourtSite({ siteId, codeCourt, peutEcrire }: Props) {
  const { t } = useTranslation(['parametrage', 'erreurs']);
  const modifier = useModifierSite();
  const [enregistre, setEnregistre] = useState(false);
  const form = useForm<ValeursCodeCourt>({
    resolver: zodResolver(schemaFormulaire),
    defaultValues: { codeCourt },
  });

  // Le code vient de la session : on resynchronise quand il change (enregistrement, autre site).
  useEffect(() => {
    form.reset({ codeCourt });
  }, [codeCourt]);

  const soumettre = form.handleSubmit((valeurs) => {
    setEnregistre(false);
    modifier.mutate(
      { siteId, entree: { codeCourt: valeurs.codeCourt } },
      { onSuccess: () => setEnregistre(true) },
    );
  });

  const erreurChamp = form.formState.errors.codeCourt;
  const codeDejaPris =
    modifier.error instanceof ErreurApi &&
    modifier.error.champErreur('codeCourt')?.code === 'code_court_deja_utilise';
  const erreurServeur = modifier.isError
    ? codeDejaPris
      ? t('parametrage:sites.codeCourt.dejaPris')
      : messageErreur(modifier.error, t)
    : undefined;
  const idErreur = 'ps-code-court-erreur';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('parametrage:sites.codeCourt.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={soumettre} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ps-code-court">{t('parametrage:sites.codeCourt.champ')}</Label>
            <Input
              id="ps-code-court"
              maxLength={5}
              autoComplete="off"
              className="max-w-40 uppercase"
              disabled={!peutEcrire}
              aria-invalid={erreurChamp || erreurServeur ? true : undefined}
              aria-describedby={erreurChamp || erreurServeur ? idErreur : undefined}
              {...form.register('codeCourt', {
                onChange: () => {
                  setEnregistre(false);
                  modifier.reset();
                },
              })}
            />
            <p className="texte-libelle text-muted-foreground">
              {t('parametrage:sites.codeCourt.aide')}
            </p>
            {erreurChamp ? (
              <p id={idErreur} role="alert" className="texte-libelle text-destructive">
                {t('parametrage:sites.codeCourt.format')}
              </p>
            ) : erreurServeur ? (
              <p id={idErreur} role="alert" className="texte-libelle text-destructive">
                {erreurServeur}
              </p>
            ) : null}
          </div>
          {peutEcrire ? (
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                enChargement={modifier.isPending}
                disabled={form.watch('codeCourt').trim().toUpperCase() === codeCourt}
              >
                {t('parametrage:sites.codeCourt.enregistrer')}
              </Button>
              {enregistre ? (
                <p role="status" className="texte-libelle text-muted-foreground">
                  {t('parametrage:sites.codeCourt.enregistre')}
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
