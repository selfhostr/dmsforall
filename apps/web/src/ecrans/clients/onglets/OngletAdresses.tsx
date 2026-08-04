import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TYPES_ADRESSE, type TypeAdresse } from '@dfa/shared';

import { ErreurApi, messageErreur, messageErreurChamp } from '@/api/erreurs';
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
    // Efface l'erreur ET LES VALEURS d'une tentative précédente : sans `reinitialiser()`, rouvrir
    // le dialogue pour une NOUVELLE saisie laisse les anciennes valeurs en place (le dialogue
    // n'est pas garanti démonté entre deux ouvertures — `DialogContent` de Radix, comme
    // `SheetContent`), et une saisie suivante s'insère dans l'ancienne au lieu de la remplacer.
    // Même défaut, même correctif que `FormulaireNouveauClient` (défaut 1, corruption de saisie
    // constatée en base sur le tiroir « Nouveau client »).
    if (valeur) {
      creerAdresse.reset();
      reinitialiser();
    }
  };

  const erreurServeur = creerAdresse.error instanceof ErreurApi ? creerAdresse.error : null;

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
                  <SelectTrigger
                    id="adresse-type"
                    aria-label={t('clients:adresses.champs.type')}
                    aria-invalid={erreurServeur?.champErreur('type') ? true : undefined}
                  >
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
                {/* Défaut 3 : un doublon d'adresse active (« Une adresse « principale » active
                    existe déjà. ») renvoyait un 400 parfaitement clair, perdu derrière le seul
                    bandeau générique ci-dessous. Affiché ici, sur le champ que le serveur désigne
                    (`erreurs[].champ === 'type'`). */}
                {erreurServeur?.champErreur('type') ? (
                  <p className="text-sm text-destructive">
                    {messageErreurChamp(erreurServeur.champErreur('type')!, t)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="adresse-rue">{t('clients:adresses.champs.rue')}</Label>
                <Input
                  id="adresse-rue"
                  value={rue}
                  onChange={(e) => setRue(e.target.value)}
                  aria-invalid={erreurServeur?.champErreur('rue') ? true : undefined}
                  required
                />
                {erreurServeur?.champErreur('rue') ? (
                  <p className="text-sm text-destructive">
                    {messageErreurChamp(erreurServeur.champErreur('rue')!, t)}
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="adresse-npa">{t('clients:adresses.champs.npa')}</Label>
                  <Input
                    id="adresse-npa"
                    value={npa}
                    onChange={(e) => setNpa(e.target.value)}
                    aria-invalid={erreurServeur?.champErreur('npa') ? true : undefined}
                    required
                  />
                  {erreurServeur?.champErreur('npa') ? (
                    <p className="text-sm text-destructive">
                      {messageErreurChamp(erreurServeur.champErreur('npa')!, t)}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adresse-localite">{t('clients:adresses.champs.localite')}</Label>
                  <Input
                    id="adresse-localite"
                    value={localite}
                    onChange={(e) => setLocalite(e.target.value)}
                    aria-invalid={erreurServeur?.champErreur('localite') ? true : undefined}
                    required
                  />
                  {erreurServeur?.champErreur('localite') ? (
                    <p className="text-sm text-destructive">
                      {messageErreurChamp(erreurServeur.champErreur('localite')!, t)}
                    </p>
                  ) : null}
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
