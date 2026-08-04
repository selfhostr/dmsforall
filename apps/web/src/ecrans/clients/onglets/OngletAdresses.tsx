import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TYPES_ADRESSE, type TypeAdresse } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdressesClient, useCreerAdresseClient } from '@/hooks/clients/useAdressesClient';

import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
}

/** Onglet « Adresses » (RM-03) — une seule adresse `principale`/`facturation` active à la fois
 *  (contrainte serveur, `service-client-sous-collections.ts`). */
export function OngletAdresses({ clientId }: Props) {
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const requete = useAdressesClient(clientId);
  const creerAdresse = useCreerAdresseClient(clientId);

  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState<TypeAdresse>('principale');
  const [rue, setRue] = useState('');
  const [npa, setNpa] = useState('');
  const [localite, setLocalite] = useState('');

  const lignes = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  const reinitialiser = () => {
    setType('principale');
    setRue('');
    setNpa('');
    setLocalite('');
  };

  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    if (!rue.trim() || !npa.trim() || !localite.trim()) return;
    creerAdresse.mutate(
      { type, rue: rue.trim(), npa: npa.trim(), localite: localite.trim(), pays: 'CH' },
      {
        onSuccess: () => {
          setOuvert(false);
          reinitialiser();
        },
      },
    );
  };

  const changerOuvert = (valeur: boolean) => {
    setOuvert(valeur);
    // Efface une erreur affichée lors d'une tentative précédente : sans ça, rouvrir le dialogue
    // pour une NOUVELLE saisie afficherait encore l'échec de la fois d'avant.
    if (valeur) creerAdresse.reset();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="texte-titre-section font-medium text-foreground">
          {t('clients:adresses.titre')}
        </h3>
        <Dialog open={ouvert} onOpenChange={changerOuvert}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              {t('clients:adresses.ajouter')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('clients:adresses.ajouter')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={soumettre} noValidate className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="adresse-type">{t('clients:adresses.champs.type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as TypeAdresse)}>
                  <SelectTrigger id="adresse-type" aria-label={t('clients:adresses.champs.type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES_ADRESSE.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`clients:adresses.types.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="adresse-rue">{t('clients:adresses.champs.rue')}</Label>
                <Input
                  id="adresse-rue"
                  value={rue}
                  onChange={(e) => setRue(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="adresse-npa">{t('clients:adresses.champs.npa')}</Label>
                  <Input
                    id="adresse-npa"
                    value={npa}
                    onChange={(e) => setNpa(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adresse-localite">{t('clients:adresses.champs.localite')}</Label>
                  <Input
                    id="adresse-localite"
                    value={localite}
                    onChange={(e) => setLocalite(e.target.value)}
                    required
                  />
                </div>
              </div>
              {creerAdresse.isError ? (
                <p className="texte-libelle text-destructive" role="alert">
                  {messageErreur(creerAdresse.error, t)}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={
                    creerAdresse.isPending || !rue.trim() || !npa.trim() || !localite.trim()
                  }
                >
                  {t('commun:actions.ajouter')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <EtatSousCollection
        enChargement={requete.isLoading}
        erreur={requete.error}
        onReessayer={() => void requete.refetch()}
        vide={lignes.length === 0}
        texteVide={t('clients:adresses.vide')}
      >
        <ul className="space-y-2">
          {lignes.map((adresse) => (
            <li key={adresse.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="texte-libelle rounded-full border px-2 py-0.5 text-muted-foreground">
                  {t(`clients:adresses.types.${adresse.type}`)}
                </span>
                {!adresse.actif ? (
                  <span className="texte-libelle text-muted-foreground">
                    {t('clients:liste.statuts.inactif')}
                  </span>
                ) : null}
              </div>
              <p className="texte-corps text-foreground">
                {adresse.rue}
                {adresse.complement ? `, ${adresse.complement}` : ''}
              </p>
              <p className="texte-corps text-foreground">
                {adresse.npa} {adresse.localite}
              </p>
            </li>
          ))}
        </ul>
      </EtatSousCollection>
    </div>
  );
}
