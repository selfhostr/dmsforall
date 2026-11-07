import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EtatMappingExport } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useEnregistrerMapping,
  useMappingExport,
} from '@/hooks/facturation/export-fiduciaire.hooks';
import type { FormatExport } from '@/hooks/facturation/export-fiduciaire.api';

import {
  appliquerValeursProposees,
  brouillonInitial,
  cleCodeTva,
  cleCompte,
  construireMiseAJour,
  nbValeursProposables,
  type BrouillonMapping,
  type ErreursMapping,
} from './mapping';
import { nomCodeTva, nomPosteCompte } from './postes';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly cible: FormatExport;
}

/** « Comptes comptables » : à quel compte (et code TVA) de la fiduciaire chaque poste part. */
export function MappingComptes({ ouvert, onOuvertChange, cible }: Props) {
  const { t } = useTranslation(['export', 'commun', 'erreurs']);
  const mapping = useMappingExport(cible, ouvert);
  const enregistrer = useEnregistrerMapping();
  const [brouillon, setBrouillon] = useState<BrouillonMapping>({});
  const [erreurs, setErreurs] = useState<ErreursMapping>({});
  const [initialiseDepuis, setInitialiseDepuis] = useState<EtatMappingExport | undefined>();

  // Le brouillon part de l'état serveur à l'ouverture, puis n'est plus écrasé : la saisie ne se
  // perd pas si la requête se rafraîchit en arrière-plan.
  useEffect(() => {
    if (ouvert && mapping.data && initialiseDepuis === undefined) {
      setBrouillon(brouillonInitial(mapping.data));
      setInitialiseDepuis(mapping.data);
    }
    if (!ouvert) setInitialiseDepuis(undefined);
  }, [ouvert, mapping.data, initialiseDepuis]);

  const etat = mapping.data;

  function enregistrerLesComptes() {
    if (!etat) return;
    const resultat = construireMiseAJour(cible, etat, brouillon);
    if (resultat.ok) {
      setErreurs({});
      enregistrer.mutate(resultat.entree, { onSuccess: () => onOuvertChange(false) });
    } else {
      setErreurs(resultat.erreurs);
      if (resultat.rien) onOuvertChange(false);
    }
  }

  function saisir(cle: string, valeur: string) {
    setBrouillon((b) => ({ ...b, [cle]: valeur }));
    setErreurs((e) => {
      if (!e[cle]) return e;
      const { [cle]: _retire, ...reste } = e;
      return reste;
    });
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('export:mapping.titre')}</DialogTitle>
          <DialogDescription>{t('export:mapping.description')}</DialogDescription>
        </DialogHeader>

        <p className="rounded-md bg-muted p-3">{t('export:mapping.aValider')}</p>

        {mapping.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : mapping.isError ? (
          <Alert variant="destructive">
            <p className="font-medium">{t('export:mapping.erreurLecture')}</p>
            <p>{messageErreur(mapping.error, t)}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => void mapping.refetch()}
            >
              {t('export:erreur.reessayer')}
            </Button>
          </Alert>
        ) : etat ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground">
                {etat.complet
                  ? t('export:mapping.complet')
                  : t('export:mapping.manquants', { count: etat.nbPostesManquants })}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={nbValeursProposables(etat, brouillon) === 0}
                onClick={() => setBrouillon(appliquerValeursProposees(etat, brouillon))}
              >
                {t('export:mapping.utiliserProposees')}
              </Button>
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-2 font-medium">{t('export:mapping.comptes')}</legend>
              {etat.comptes.map((c) => {
                const cle = cleCompte(c.usage, c.categorie);
                const id = `mapping-${cle}`;
                return (
                  <Poste
                    key={cle}
                    id={id}
                    libelle={nomPosteCompte(t, c.usage, c.categorie)}
                    requis={c.requis}
                    propose={c.compteParDefaut}
                    valeur={brouillon[cle] ?? ''}
                    invalide={erreurs[cle] === true}
                    onChange={(v) => saisir(cle, v)}
                  />
                );
              })}
            </fieldset>

            {etat.codesTva.length > 0 ? (
              <fieldset className="space-y-3">
                <legend className="mb-2 font-medium">{t('export:mapping.codesTva')}</legend>
                {etat.codesTva.map((c) => {
                  const cle = cleCodeTva(c.regimeTva, c.tauxPourmille);
                  return (
                    <Poste
                      key={cle}
                      id={`mapping-${cle}`}
                      libelle={nomCodeTva(t, c.regimeTva, c.tauxPourmille)}
                      requis={c.requis}
                      propose={c.codeParDefaut}
                      valeur={brouillon[cle] ?? ''}
                      invalide={erreurs[cle] === true}
                      onChange={(v) => saisir(cle, v)}
                    />
                  );
                })}
              </fieldset>
            ) : null}
          </div>
        ) : null}

        {enregistrer.isError ? (
          <Alert variant="destructive" role="alert">
            <p className="font-medium">{t('export:mapping.erreurEnregistrement')}</p>
            <p>{messageErreur(enregistrer.error, t)}</p>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOuvertChange(false)}>
            {t('commun:actions.annuler')}
          </Button>
          <Button
            type="button"
            disabled={!etat || enregistrer.isPending}
            onClick={enregistrerLesComptes}
          >
            {enregistrer.isPending
              ? t('export:mapping.enregistrement')
              : t('export:mapping.enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PosteProps {
  readonly id: string;
  readonly libelle: string;
  readonly requis: boolean;
  readonly propose: string | null;
  readonly valeur: string;
  readonly invalide: boolean;
  readonly onChange: (valeur: string) => void;
}

function Poste({ id, libelle, requis, propose, valeur, invalide, onChange }: PosteProps) {
  const { t } = useTranslation(['export']);
  return (
    <div className="grid items-start gap-1 sm:grid-cols-[1fr_12rem] sm:gap-4">
      <div>
        <Label htmlFor={id}>
          {libelle}
          {requis ? null : (
            <span className="ml-2 text-muted-foreground">{t('export:mapping.facultatif')}</span>
          )}
        </Label>
        <p className="text-muted-foreground">
          {propose
            ? t('export:mapping.propose', { valeur: propose })
            : t('export:mapping.aucuneProposition')}
        </p>
      </div>
      <div className="space-y-1">
        <Input
          id={id}
          value={valeur}
          inputMode="text"
          autoComplete="off"
          aria-invalid={invalide || undefined}
          aria-describedby={invalide ? `${id}-erreur` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {invalide ? (
          <p id={`${id}-erreur`} role="alert" className="text-destructive">
            {t('export:mapping.valeurInvalide')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
