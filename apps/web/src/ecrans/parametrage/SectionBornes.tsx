import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BorneResume, ReponseCreationBorne } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
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
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useBasculerBorne,
  useCreerBorne,
  useListeBornes,
  useReinitialiserAccesBorne,
} from '@/hooks/parametrage/useBornes';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useSession } from '@/hooks/useSession';

import { DialogueConfirmationEmploye } from './DialogueConfirmationEmploye';

type ActionEnAttente = {
  readonly type: 'desactiver' | 'reactiver' | 'reinitialiser';
  readonly borne: BorneResume;
};

interface Acces {
  readonly identifiant: string;
  readonly motDePasse: string;
}

/**
 * Bornes d'atelier (tablettes murales de pointage) — créées et gérées par le garage lui-même
 * (`POST /bornes`, droits `socle.borne.*`, direction/admin). Le mot de passe n'est montré qu'une
 * fois, à la création ou au renouvellement.
 */
export function SectionBornes() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const { data: session } = useSession();
  const { estMonoSite, siteId: siteImplicite } = useSiteImplicite();
  const requete = useListeBornes();
  const creer = useCreerBorne();
  const desactiver = useBasculerBorne('desactiver');
  const reactiver = useBasculerBorne('reactiver');
  const reinitialiser = useReinitialiserAccesBorne();

  const [creationOuverte, setCreationOuverte] = useState(false);
  const [nom, setNom] = useState('');
  const [siteId, setSiteId] = useState('');
  const [enAttente, setEnAttente] = useState<ActionEnAttente | null>(null);
  const [acces, setAcces] = useState<Acces | null>(null);

  const sites = session?.sites ?? [];
  // Garage mono-site : le site est implicite, jamais demandé.
  const siteIdEffectif = estMonoSite && siteImplicite ? siteImplicite : siteId;
  const lignes = requete.data?.pages.flatMap((p) => p.donnees) ?? [];

  function fermerCreation() {
    setCreationOuverte(false);
    setNom('');
    setSiteId('');
    creer.reset();
  }

  function soumettreCreation() {
    creer.mutate(
      { nom: nom.trim(), siteId: siteIdEffectif },
      {
        onSuccess: (r: ReponseCreationBorne) => {
          setAcces({ identifiant: r.borne.identifiant, motDePasse: r.acces.motDePasseTemporaire });
          fermerCreation();
        },
      },
    );
  }

  function confirmer() {
    if (!enAttente) return;
    const { type, borne } = enAttente;
    if (type === 'reinitialiser') {
      reinitialiser.mutate(borne.id, {
        onSuccess: (r) => {
          setEnAttente(null);
          setAcces({ identifiant: borne.identifiant, motDePasse: r.motDePasseTemporaire });
        },
      });
    } else {
      (type === 'desactiver' ? desactiver : reactiver).mutate(borne.id, {
        onSuccess: () => setEnAttente(null),
      });
    }
  }

  const mutation =
    enAttente?.type === 'desactiver'
      ? desactiver
      : enAttente?.type === 'reactiver'
        ? reactiver
        : reinitialiser;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="titre-bornes">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="titre-bornes" className="texte-titre-section">
            {t('parametrage:utilisateurs.bornes.titre')}
          </h2>
          <p className="texte-libelle text-muted-foreground">
            {t('parametrage:utilisateurs.bornes.description')}
          </p>
        </div>
        <Button type="button" onClick={() => setCreationOuverte(true)}>
          {t('parametrage:utilisateurs.bornes.nouveau')}
        </Button>
      </div>

      {requete.isError ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(requete.error, t)}
        </p>
      ) : null}

      {!requete.isPending && !requete.isError && lignes.length === 0 ? (
        <p className="texte-corps text-muted-foreground">
          {t('parametrage:utilisateurs.bornes.vide')}
        </p>
      ) : null}

      {lignes.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('parametrage:utilisateurs.bornes.colNom')}</TableHead>
              <TableHead>{t('parametrage:utilisateurs.bornes.colIdentifiant')}</TableHead>
              <TableHead>{t('parametrage:utilisateurs.bornes.colSite')}</TableHead>
              <TableHead>{t('parametrage:utilisateurs.bornes.colStatut')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('parametrage:utilisateurs.bornes.colActions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lignes.map((borne) => (
              <TableRow key={borne.id}>
                <TableCell>{borne.nom}</TableCell>
                <TableCell className="font-mono">{borne.identifiant}</TableCell>
                <TableCell>{borne.site.nom}</TableCell>
                <TableCell>
                  <Badge variant={borne.statut === 'actif' ? 'secondary' : 'outline'}>
                    {t(`parametrage:utilisateurs.statut.${borne.statut}`)}
                  </Badge>
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEnAttente({ type: 'reinitialiser', borne })}
                  >
                    {t('parametrage:utilisateurs.bornes.reinitialiser')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEnAttente({
                        type: borne.statut === 'actif' ? 'desactiver' : 'reactiver',
                        borne,
                      })
                    }
                  >
                    {borne.statut === 'actif'
                      ? t('parametrage:utilisateurs.bornes.desactiver')
                      : t('parametrage:utilisateurs.bornes.reactiver')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={creationOuverte} onOpenChange={(o) => !o && fermerCreation()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('parametrage:utilisateurs.bornes.nouveau')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <LegendeChampsObligatoires>
              {t('parametrage:obligatoire.legende')}
            </LegendeChampsObligatoires>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nouvelle-borne-nom" requis>
                {t('parametrage:utilisateurs.bornes.champNom')}
              </Label>
              <Input
                id="nouvelle-borne-nom"
                aria-required="true"
                value={nom}
                maxLength={100}
                onChange={(e) => setNom(e.target.value)}
              />
            </div>
            {estMonoSite ? null : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nouvelle-borne-site" requis>
                  {t('parametrage:utilisateurs.bornes.champSite')}
                </Label>
                <Select value={siteId} onValueChange={setSiteId}>
                  <SelectTrigger id="nouvelle-borne-site" aria-required="true">
                    <SelectValue
                      placeholder={t('parametrage:utilisateurs.bornes.placeholderSite')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {creer.error ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreur(creer.error, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={fermerCreation}>
              {t('commun:actions.annuler')}
            </Button>
            <Button
              type="button"
              disabled={nom.trim() === '' || siteIdEffectif === '' || creer.isPending}
              onClick={soumettreCreation}
            >
              {creer.isPending
                ? t('commun:chargement.enCours')
                : t('parametrage:utilisateurs.bornes.creer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DialogueConfirmationEmploye
        ouvert={enAttente !== null}
        titre={
          enAttente
            ? t(
                `parametrage:utilisateurs.bornes.${enAttente.type === 'reinitialiser' ? 'reinitialiser' : enAttente.type}Titre`,
                { nom: enAttente.borne.nom },
              )
            : ''
        }
        description={
          enAttente ? t(`parametrage:utilisateurs.bornes.${enAttente.type}Description`) : ''
        }
        libelleConfirmer={enAttente ? t(`parametrage:utilisateurs.bornes.${enAttente.type}`) : ''}
        variantConfirmer={enAttente?.type === 'desactiver' ? 'destructive' : 'default'}
        enCours={mutation.isPending}
        erreur={mutation.error}
        onConfirmer={confirmer}
        onAnnuler={() => setEnAttente(null)}
      />

      <Dialog open={acces !== null}>
        <DialogContent
          className="[&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t('parametrage:utilisateurs.bornes.acces')}</DialogTitle>
            <DialogDescription>
              {t('parametrage:utilisateurs.bornes.accesDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="borne-acces-identifiant">
                {t('parametrage:utilisateurs.bornes.identifiantLabel')}
              </Label>
              <Input
                id="borne-acces-identifiant"
                readOnly
                className="font-mono"
                value={acces?.identifiant ?? ''}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="borne-acces-mdp">
                {t('parametrage:utilisateurs.bornes.motDePasseLabel')}
              </Label>
              <Input
                id="borne-acces-mdp"
                readOnly
                className="font-mono"
                value={acces?.motDePasse ?? ''}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setAcces(null)}>
              {t('parametrage:utilisateurs.bornes.fermer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
