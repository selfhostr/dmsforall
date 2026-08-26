import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NATURES_NOTE, type NatureNote } from '@dfa/shared';

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
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCreerNoteClient, useNotesClient } from '@/hooks/clients/useNotesClient';
import { formaterDateHeure } from '@/lib/formats';

import { texteOuVide } from '../utils';
import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
}

/** Onglet « Notes » (RM-13) — une note `alerte` remonte aussi dans le bandeau sticky de la
 *  fiche (`BandeauAlerteClient`, `client.notesAlerte`) : la création invalide `clients.notes`
 *  **et** `clients.detail` (voir `useCreerNoteClient`), le bandeau se met donc à jour sans
 *  recharger l'écran. */
export function OngletNotes({ clientId }: Props) {
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const requete = useNotesClient(clientId);
  const creerNote = useCreerNoteClient(clientId);

  const [ouvert, setOuvert] = useState(false);
  const [nature, setNature] = useState<NatureNote>('interne');
  const [texte, setTexte] = useState('');

  const lignes = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    if (!texte.trim()) return;
    creerNote.mutate(
      { nature, texte: texte.trim() },
      {
        onSuccess: () => {
          setOuvert(false);
          setNature('interne');
          setTexte('');
        },
      },
    );
  };

  const changerOuvert = (valeur: boolean) => {
    setOuvert(valeur);
    // Efface l'erreur ET LES VALEURS d'une tentative précédente : sans ce second geste, rouvrir
    // le dialogue pour une NOUVELLE saisie laisse l'ancien texte en place (le dialogue n'est pas
    // garanti démonté entre deux ouvertures), et une nouvelle saisie s'insère dans l'ancienne au
    // lieu de la remplacer. Même défaut, même correctif que `FormulaireNouveauClient` (défaut 1,
    // corruption de saisie constatée en base).
    if (valeur) {
      creerNote.reset();
      setNature('interne');
      setTexte('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="texte-titre-section font-medium text-foreground">
          {t('clients:notes.titre')}
        </h3>
        <Dialog open={ouvert} onOpenChange={changerOuvert}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              {t('commun:actions.ajouter')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('clients:notes.titre')}</DialogTitle>
            </DialogHeader>
            <LegendeChampsObligatoires>
              {t('commun:formulaires.champsObligatoiresLegende')}
            </LegendeChampsObligatoires>
            <form onSubmit={soumettre} noValidate className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="note-nature" requis>
                  {t('clients:notes.titre')}
                </Label>
                <Select value={nature} onValueChange={(v) => setNature(v as NatureNote)}>
                  <SelectTrigger
                    id="note-nature"
                    aria-label={t('clients:notes.titre')}
                    aria-required="true"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NATURES_NOTE.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`clients:notes.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="note-texte" requis>
                  {t('clients:notes.champTexte')}
                </Label>
                <Textarea
                  id="note-texte"
                  value={texte}
                  onChange={(e) => setTexte(e.target.value)}
                  required
                />
              </div>
              {creerNote.isError ? (
                <p className="texte-libelle text-destructive" role="alert">
                  {messageErreur(creerNote.error, t)}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={creerNote.isPending || !texte.trim()}>
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
        texteVide={t('clients:notes.vide')}
      >
        {/* `divide-y` (filet seul) entre notes normales — bordure retirée, c'était un simple
         *  groupe de contenu. La note « alerte » garde un remplissage plein (fond + pas de
         *  bordure) : signal structurel volontaire, une note d'alerte n'est pas une ligne comme
         *  les autres (même doctrine que les encarts d'alerte). */}
        <ul className="divide-y">
          {lignes.map((note) => (
            <li
              key={note.id}
              className={note.nature === 'alerte' ? 'rounded-md bg-statut-danger-fond p-3' : 'p-3'}
            >
              <div className="flex items-center justify-between gap-2 texte-libelle text-muted-foreground">
                <span>{t(`clients:notes.${note.nature}`)}</span>
                <span>
                  {texteOuVide(note.auteur?.nomAffiche ?? null)} · {formaterDateHeure(note.creeLe)}
                </span>
              </div>
              <p className="texte-corps text-foreground">{note.texte}</p>
            </li>
          ))}
        </ul>
      </EtatSousCollection>
    </div>
  );
}
