import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { schemaCreationPretCourtoisie, type ReponseVehiculeCourtoisie } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelecteurClientVehicule } from '@/ecrans/vehicules/SelecteurClientVehicule';
import { useCreerPretCourtoisie } from '@/hooks/courtoisie/useCourtoisie';

import { datetimeLocal } from './periode';

interface Props {
  readonly vehicule: ReponseVehiculeCourtoisie | null;
  /** Jour affiché (`aaaa-mm-jj`) : proposé comme jour de prêt par défaut. */
  readonly jour: string;
  readonly onFermer: () => void;
  /** Rattachements facultatifs, fournis par l'écran appelant (fiche OR, RDV). */
  readonly clientIdInitial?: string;
  readonly ordreReparationId?: string;
  readonly rendezVousId?: string;
}

/** « Prêter » : client + du/au. Le serveur refuse un chevauchement (409), jamais deux fois la même voiture. */
export function DialogueNouveauPret({
  vehicule,
  jour,
  onFermer,
  clientIdInitial,
  ordreReparationId,
  rendezVousId,
}: Props) {
  const { t } = useTranslation(['courtoisie', 'commun', 'erreurs']);
  const creer = useCreerPretCourtoisie();
  const [clientId, setClientId] = useState<string | null>(clientIdInitial ?? null);
  const [debut, setDebut] = useState(datetimeLocal(jour, '08:00'));
  const [fin, setFin] = useState(datetimeLocal(jour, '18:00'));
  const [kmDepart, setKmDepart] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (!vehicule) return;
    const resultat = schemaCreationPretCourtoisie.safeParse({
      vehiculeCourtoisieId: vehicule.id,
      clientId: clientId ?? undefined,
      ordreReparationId,
      rendezVousId,
      debutLe: debut ? new Date(debut).toISOString() : undefined,
      finPrevueLe: fin ? new Date(fin).toISOString() : undefined,
      kmDepart: kmDepart.trim() === '' ? undefined : Number(kmDepart),
    });
    if (!resultat.success || new Date(fin) <= new Date(debut)) {
      setErreur(t('courtoisie:pret.erreurValidation'));
      return;
    }
    setErreur(null);
    creer.mutate(resultat.data, { onSuccess: onFermer });
  }

  return (
    <Dialog open={vehicule !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <DialogContent>
        <form onSubmit={soumettre} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('courtoisie:pret.titre')}</DialogTitle>
            <DialogDescription>
              {vehicule
                ? `${vehicule.designation}${vehicule.plaque ? ` · ${vehicule.plaque}` : ''}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <SelecteurClientVehicule
            valeur={clientId}
            onChangeValeur={(id) => setClientId(id)}
            libelle={t('courtoisie:pret.client')}
            requis
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pret-debut">{t('courtoisie:pret.du')}</Label>
              <Input
                id="pret-debut"
                type="datetime-local"
                required
                value={debut}
                onChange={(e) => setDebut(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pret-fin">{t('courtoisie:pret.au')}</Label>
              <Input
                id="pret-fin"
                type="datetime-local"
                required
                value={fin}
                onChange={(e) => setFin(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pret-km">{t('courtoisie:pret.kmDepart')}</Label>
            <Input
              id="pret-km"
              inputMode="numeric"
              value={kmDepart}
              onChange={(e) => setKmDepart(e.target.value.replace(/\D/g, ''))}
              placeholder={vehicule?.kilometrage != null ? String(vehicule.kilometrage) : ''}
            />
          </div>

          {erreur || creer.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{erreur ?? messageErreur(creer.error, t)}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('commun:actions.annuler')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={creer.isPending}>
              {t('courtoisie:pret.confirmer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
