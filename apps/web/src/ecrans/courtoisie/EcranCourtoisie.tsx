import { CheckCircle2, CircleSlash, Clock, Plus, Wrench, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  DisponibiliteCourtoisie,
  ReponsePretCourtoisie,
  ReponseVehiculeCourtoisie,
} from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BadgeAttribut } from '@/composants/identite/BadgeAttribut';
import {
  useAnnulerPretCourtoisie,
  useRemettrePretCourtoisie,
  useVehiculesCourtoisie,
} from '@/hooks/courtoisie/useCourtoisie';
import { useSession } from '@/hooks/useSession';
import { formaterDateHeure } from '@/lib/formats';

import { DialogueNouveauPret } from './DialogueNouveauPret';
import { DialogueNouveauVehicule } from './DialogueNouveauVehicule';
import { DialogueRetourPret } from './DialogueRetourPret';
import { peutGererParcCourtoisie, peutPreterCourtoisie } from './droits';
import { bornesDuJour, jourLocal } from './periode';

/** Forme + icône + mot (DESIGN.md) : jamais la couleur seule. */
const CONFIG_DISPONIBILITE: Record<
  DisponibiliteCourtoisie,
  { readonly icone: LucideIcon; readonly accentue: boolean }
> = {
  libre: { icone: CheckCircle2, accentue: false },
  occupe: { icone: Clock, accentue: true },
  indisponible: { icone: Wrench, accentue: true },
};

/**
 * Véhicules de courtoisie : « avez-vous une voiture libre jeudi ? ». Le jour choisi borne la
 * période testée côté serveur ; « Prêter » ouvre le prêt (client, du/au), « Rendu » le clôt.
 */
export function EcranCourtoisie() {
  const { t } = useTranslation(['courtoisie', 'commun', 'erreurs']);
  const session = useSession();
  const actions = session.data?.actions;
  const [jour, setJour] = useState(() => jourLocal(new Date()));
  const { du, au } = bornesDuJour(jour);
  const requete = useVehiculesCourtoisie(du, au);
  const remettre = useRemettrePretCourtoisie();
  const annuler = useAnnulerPretCourtoisie();

  const [aPreter, setAPreter] = useState<ReponseVehiculeCourtoisie | null>(null);
  const [aRendre, setARendre] = useState<ReponsePretCourtoisie | null>(null);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);

  const peutPreter = peutPreterCourtoisie(actions);
  const peutGererParc = peutGererParcCourtoisie(actions);
  const vehicules = requete.data?.vehicules ?? [];
  const nbLibres = vehicules.filter((v) => v.disponibilite === 'libre').length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="texte-titre-page">{t('courtoisie:titre')}</h1>
          <p className="texte-libelle text-muted-foreground">{t('courtoisie:sousTitre')}</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="courtoisie-jour">{t('courtoisie:jour')}</Label>
            <Input
              id="courtoisie-jour"
              type="date"
              value={jour}
              onChange={(e) => e.target.value && setJour(e.target.value)}
            />
          </div>
          {peutGererParc ? (
            <Button type="button" variant="outline" onClick={() => setAjoutOuvert(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              {t('courtoisie:parc.ajouter')}
            </Button>
          ) : null}
        </div>
      </header>

      {remettre.isError || annuler.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{messageErreur(remettre.error ?? annuler.error, t)}</AlertDescription>
        </Alert>
      ) : null}

      {requete.isPending ? <EtatChargement lignes={3} /> : null}
      {requete.isError ? (
        <EtatErreur
          titre={t(
            requete.error instanceof ErreurReseau ? 'erreurs:reseau.titre' : 'courtoisie:erreur',
          )}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : null}
      {requete.isSuccess && vehicules.length === 0 ? (
        <EtatVide
          titre={t('courtoisie:vide.titre')}
          description={t('courtoisie:vide.description')}
        />
      ) : null}

      {requete.isSuccess && vehicules.length > 0 ? (
        <>
          <p className="texte-corps font-medium" role="status">
            {t('courtoisie:resume', { libres: nbLibres, total: vehicules.length })}
          </p>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {vehicules.map((v) => {
              const config = CONFIG_DISPONIBILITE[v.disponibilite];
              const Icone =
                v.disponibilite === 'indisponible' && v.etat === 'hors_service'
                  ? CircleSlash
                  : config.icone;
              const pret = v.pretSurPeriode;
              return (
                <li key={v.id}>
                  <Card>
                    <CardContent className="flex flex-col gap-3 pt-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="texte-corps font-semibold">{v.designation}</p>
                          {v.plaque ? (
                            <p className="texte-libelle text-muted-foreground">{v.plaque}</p>
                          ) : null}
                        </div>
                        <BadgeAttribut
                          icone={<Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                          accentue={config.accentue}
                        >
                          {v.disponibilite === 'indisponible'
                            ? t(`courtoisie:etat.${v.etat}`)
                            : t(`courtoisie:disponibilite.${v.disponibilite}`)}
                        </BadgeAttribut>
                      </div>

                      {pret ? (
                        <div className="texte-libelle text-muted-foreground">
                          <p className="font-medium text-foreground">{pret.clientNom}</p>
                          <p>
                            {formaterDateHeure(pret.debutLe)} →{' '}
                            {formaterDateHeure(pret.finPrevueLe)}
                          </p>
                          {pret.enRetard ? (
                            <p className="font-semibold text-foreground">
                              {t('courtoisie:enRetard')}
                            </p>
                          ) : null}
                          {pret.statut === 'reserve' ? <p>{t('courtoisie:reserve')}</p> : null}
                        </div>
                      ) : null}

                      {peutPreter ? (
                        <div className="flex flex-wrap gap-2">
                          {v.disponibilite === 'libre' ? (
                            <Button type="button" size="sm" onClick={() => setAPreter(v)}>
                              {t('courtoisie:actions.preter')}
                            </Button>
                          ) : null}
                          {pret?.statut === 'en_cours' ? (
                            <Button type="button" size="sm" onClick={() => setARendre(pret)}>
                              {t('courtoisie:actions.rendu')}
                            </Button>
                          ) : null}
                          {pret?.statut === 'reserve' ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={remettre.isPending}
                              onClick={() => remettre.mutate(pret.id)}
                            >
                              {t('courtoisie:actions.remettre')}
                            </Button>
                          ) : null}
                          {pret ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={annuler.isPending}
                              onClick={() => annuler.mutate(pret.id)}
                            >
                              {t('courtoisie:actions.annuler')}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <DialogueNouveauPret
        key={aPreter?.id ?? 'aucun'}
        vehicule={aPreter}
        jour={jour}
        onFermer={() => setAPreter(null)}
      />
      <DialogueRetourPret pret={aRendre} onFermer={() => setARendre(null)} />
      <DialogueNouveauVehicule ouvert={ajoutOuvert} onFermer={() => setAjoutOuvert(false)} />
    </div>
  );
}
