import { AlertTriangle, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { estRefusDroitLogo } from '@/hooks/parametrage/logo-entreprise.api';
import {
  useDeposerLogoEntreprise,
  useLogoEntreprise,
  useSupprimerLogoEntreprise,
} from '@/hooks/parametrage/useLogoEntreprise';

import { verifierFichierLogo, type RefusLogo } from './logo-entreprise';

/**
 * Logo imprimé sur les factures (`PUT|GET|DELETE /parametres-entreprise/logo`). Aperçu, remplacement,
 * suppression. Sans droit de lecture du bloc créancier, le bloc ne s'affiche pas.
 */
export function BlocLogoEntreprise() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const idChamp = useId();
  const requete = useLogoEntreprise();
  const deposer = useDeposerLogoEntreprise();
  const supprimer = useSupprimerLogoEntreprise();
  const entree = useRef<HTMLInputElement>(null);
  const [refus, setRefus] = useState<RefusLogo | null>(null);
  const [typeDepose, setTypeDepose] = useState<string | null>(null);

  const logo = requete.data ?? null;
  const urlApercu = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);
  useEffect(() => {
    return () => {
      if (urlApercu) URL.revokeObjectURL(urlApercu);
    };
  }, [urlApercu]);

  if (requete.isError && estRefusDroitLogo(requete.error)) return null;

  function choisir(fichier: File | undefined) {
    if (!fichier) return;
    const probleme = verifierFichierLogo(fichier);
    setRefus(probleme);
    if (probleme) {
      if (entree.current) entree.current.value = '';
      return;
    }
    deposer.mutate(fichier, {
      onSuccess: (reponse) => setTypeDepose(reponse.typeMime),
      onSettled: () => {
        if (entree.current) entree.current.value = '';
      },
    });
  }

  const occupe = deposer.isPending || supprimer.isPending;
  const estSvg = (logo?.type ?? typeDepose) === 'image/svg+xml';
  const erreur = deposer.isError ? deposer.error : supprimer.isError ? supprimer.error : null;

  return (
    <section className="space-y-3" aria-labelledby={`${idChamp}-titre`}>
      <h3 id={`${idChamp}-titre`} className="texte-corps font-medium text-foreground">
        {t('parametrage:entreprise.logo.titre')}
      </h3>

      {requete.isPending ? (
        <Skeleton className="h-24 w-48" />
      ) : requete.isError ? (
        <div className="flex items-center gap-3">
          <p role="alert" className="texte-corps text-destructive">
            {messageErreur(requete.error, t)}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void requete.refetch()}>
            {t('commun:actions.reessayer')}
          </Button>
        </div>
      ) : urlApercu ? (
        <img
          src={urlApercu}
          alt={t('parametrage:entreprise.logo.alt')}
          className="max-h-24 max-w-48 rounded-md bg-muted object-contain p-2"
        />
      ) : (
        <p className="texte-corps text-muted-foreground">
          {t('parametrage:entreprise.logo.aucun')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={entree}
          id={idChamp}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('parametrage:entreprise.logo.choisir')}
          accept="image/png,image/jpeg,image/svg+xml"
          disabled={occupe}
          onChange={(e) => choisir(e.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          disabled={occupe}
          onClick={() => entree.current?.click()}
        >
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {deposer.isPending
            ? t('commun:chargement.enCours')
            : logo
              ? t('parametrage:entreprise.logo.remplacer')
              : t('parametrage:entreprise.logo.choisir')}
        </Button>
        {logo ? (
          <Button
            type="button"
            variant="outline"
            disabled={occupe}
            onClick={() => supprimer.mutate()}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('parametrage:entreprise.logo.supprimer')}
          </Button>
        ) : null}
      </div>

      <p className="texte-corps text-muted-foreground">{t('parametrage:entreprise.logo.aide')}</p>
      {estSvg ? (
        <p role="status" className="flex items-start gap-1.5 texte-corps text-statut-attention">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('parametrage:entreprise.logo.svgNonImprime')}
        </p>
      ) : null}
      {refus ? (
        <p role="alert" className="texte-corps text-destructive">
          {t(`parametrage:entreprise.logo.refus.${refus}`)}
        </p>
      ) : null}
      {erreur ? (
        <Alert variant="destructive">
          <AlertDescription>{messageErreur(erreur, t)}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
