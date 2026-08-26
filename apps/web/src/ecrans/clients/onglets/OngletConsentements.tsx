import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TYPES_CONSENTEMENT, type TypeConsentement } from '@dfa/shared';

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
import {
  useArreterContactClient,
  useReprendreContactClient,
} from '@/hooks/clients/useArreterContactClient';
import {
  useConsentementsClient,
  useCreerConsentementClient,
} from '@/hooks/clients/useConsentementsClient';
import { formaterDateHeure } from '@/lib/formats';
import { cn } from '@/lib/utils';

import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
  /** RA-14 — `ReponseClient.plusAucunContact` (`EcranFicheClient`, propriétaire de la fiche
   *  complète). Passé en prop plutôt que relu ici : un seul `GET /clients/{id}` par affichage de
   *  fiche, pas un second appel réseau redondant pour ce seul drapeau. */
  readonly plusAucunContact: boolean;
  /** `ReponseClient.motif` — raison COURANTE du drapeau, `null` tant qu'il n'est pas posé. */
  readonly motifContact: string | null;
}

/** Issue #133 — RA-14 (« arrêt de tout contact ») existe déjà côté serveur
 *  (`client.plusAucunContact`/`client.motif`, `POST /clients/{id}/arreter-contact`,
 *  `.../reprendre-contact`) mais n'était appelé par AUCUN écran : le seul contournement était une
 *  note libre, invisible pour une purge marketing automatisée. Bandeau + dialogue de bascule
 *  ajoutés ICI (onglet « Consentements », pas un module séparé) parce que c'est le même terrain
 *  que les trois opt-in marketing juste en dessous — la même question du garagiste, « puis-je
 *  contacter ce client ? », avec une portée plus large (RA-14 prime sur tout consentement,
 *  y compris pour une relance de facture impayée). */
function BandeauContact({
  clientId,
  plusAucunContact,
  motifContact,
}: Pick<Props, 'clientId' | 'plusAucunContact' | 'motifContact'>) {
  const { t } = useTranslation(['clients', 'commun', 'erreurs', 'validation']);
  const arreterContact = useArreterContactClient(clientId);
  const reprendreContact = useReprendreContactClient(clientId);
  const mutation = plusAucunContact ? reprendreContact : arreterContact;

  const [ouvert, setOuvert] = useState(false);
  const [motifSaisi, setMotifSaisi] = useState('');

  const changerOuvert = (valeur: boolean) => {
    setOuvert(valeur);
    if (valeur) {
      arreterContact.reset();
      reprendreContact.reset();
      setMotifSaisi('');
    }
  };

  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    const motif = motifSaisi.trim();
    if (motif.length < 3) return;
    mutation.mutate({ motif }, { onSuccess: () => setOuvert(false) });
  };

  return (
    <div className="space-y-2">
      <h3 className="texte-titre-section font-medium text-foreground">
        {t('clients:contact.titre')}
      </h3>
      {/* Bordure structurelle : bloc qui affiche l'état RGPD du contact ET porte l'action
       *  arrêter/reprendre (DialogTrigger juste en dessous) — pas un simple groupe de contenu. */}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-md border p-3',
          plusAucunContact && 'border-statut-attention bg-statut-attention-fond',
        )}
      >
        <div>
          <p className="texte-corps font-medium text-foreground">
            {plusAucunContact
              ? t('clients:contact.statutArrete')
              : t('clients:contact.statutActif')}
          </p>
          {plusAucunContact && motifContact ? (
            <p className="texte-libelle text-muted-foreground">{motifContact}</p>
          ) : null}
        </div>
        <Dialog open={ouvert} onOpenChange={changerOuvert}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              {plusAucunContact
                ? t('clients:contact.reprendreAction')
                : t('clients:contact.arreterAction')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {plusAucunContact
                  ? t('clients:contact.reprendreTitre')
                  : t('clients:contact.arreterTitre')}
              </DialogTitle>
            </DialogHeader>
            <p className="texte-corps text-muted-foreground">
              {plusAucunContact
                ? t('clients:contact.reprendreDescription')
                : t('clients:contact.arreterDescription')}
            </p>
            <LegendeChampsObligatoires>
              {t('commun:formulaires.champsObligatoiresLegende')}
            </LegendeChampsObligatoires>
            <form onSubmit={soumettre} noValidate className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="contact-motif" requis>
                  {t('clients:contact.motifLabel')}
                </Label>
                <Textarea
                  id="contact-motif"
                  value={motifSaisi}
                  onChange={(e) => setMotifSaisi(e.target.value)}
                  readOnly={mutation.isPending}
                  required
                />
                <p className="texte-libelle text-muted-foreground">
                  {t('validation:longueurMin', { min: 3 })}
                </p>
              </div>
              {mutation.isError ? (
                <p className="texte-libelle text-destructive" role="alert">
                  {messageErreur(mutation.error, t)}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={mutation.isPending || motifSaisi.trim().length < 3}>
                  {plusAucunContact
                    ? t('clients:contact.reprendreAction')
                    : t('clients:contact.arreterAction')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

/**
 * Onglet « Consentements » (RM-09, nLPD, APPEND-ONLY) — une révocation est une NOUVELLE ligne
 * `accorde: false`, jamais une modification (pas de `PATCH`/`DELETE` au contrat). `type` est
 * restreint aux TROIS valeurs adossées à l'enum Postgres `type_consentement` (arbitrage main,
 * L1-16) : `marketing_email`/`marketing_sms`/`marketing_appel` — un consentement est une preuve
 * juridique, aucune valeur hors contrat n'est proposée ici.
 */
export function OngletConsentements({ clientId, plusAucunContact, motifContact }: Props) {
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const requete = useConsentementsClient(clientId);
  const creerConsentement = useCreerConsentementClient(clientId);

  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState<TypeConsentement>('marketing_email');

  const lignes = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  const accorder = () => {
    creerConsentement.mutate(
      { type, accorde: true, recueilliLe: new Date().toISOString() },
      { onSuccess: () => setOuvert(false) },
    );
  };

  const changerOuvert = (valeur: boolean) => {
    setOuvert(valeur);
    // Efface l'erreur ET LA SÉLECTION d'une tentative précédente : sans ce second geste, rouvrir
    // le dialogue pour une NOUVELLE saisie laisse le type précédemment choisi en place (le
    // dialogue n'est pas garanti démonté entre deux ouvertures). Même défaut, même correctif que
    // `FormulaireNouveauClient` (défaut 1, corruption de saisie constatée en base).
    if (valeur) {
      creerConsentement.reset();
      setType('marketing_email');
    }
  };

  return (
    <div className="space-y-6">
      <BandeauContact
        clientId={clientId}
        plusAucunContact={plusAucunContact}
        motifContact={motifContact}
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="texte-titre-section font-medium text-foreground">
            {t('clients:consentements.titre')}
          </h3>
          <Dialog open={ouvert} onOpenChange={changerOuvert}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                {t('clients:consentements.ajouter')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('clients:consentements.ajouter')}</DialogTitle>
              </DialogHeader>
              <LegendeChampsObligatoires>
                {t('commun:formulaires.champsObligatoiresLegende')}
              </LegendeChampsObligatoires>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="consentement-type" requis>
                    {t('clients:consentements.champs.type')}
                  </Label>
                  <Select value={type} onValueChange={(v) => setType(v as TypeConsentement)}>
                    <SelectTrigger
                      id="consentement-type"
                      aria-label={t('clients:consentements.champs.type')}
                      aria-required="true"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES_CONSENTEMENT.map((valeur) => (
                        <SelectItem key={valeur} value={valeur}>
                          {t(`clients:consentements.types.${valeur}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {creerConsentement.isError ? (
                  <p className="texte-libelle text-destructive" role="alert">
                    {messageErreur(creerConsentement.error, t)}
                  </p>
                ) : null}
                <DialogFooter>
                  <Button type="button" onClick={accorder} disabled={creerConsentement.isPending}>
                    {t('commun:actions.ajouter')}
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <EtatSousCollection
          enChargement={requete.isLoading}
          erreur={requete.error}
          onReessayer={() => void requete.refetch()}
          vide={lignes.length === 0}
          texteVide={t('clients:consentements.vide')}
        >
          {/* `divide-y` (filet seul entre lignes), pas de cadre par ligne — même motif que
           *  `PanneauTravauxReportes.tsx` (vehicules/), DESIGN.md « bordure structurelle
           *  uniquement ». */}
          <ul className="divide-y">
            {lignes.map((consentement) => (
              <li
                key={consentement.id}
                className="flex items-center justify-between gap-3 py-3 texte-corps"
              >
                <span>{t(`clients:consentements.types.${consentement.type}`)}</span>
                <span className="text-right text-muted-foreground">
                  {consentement.accorde
                    ? t('clients:consentements.champs.accorde')
                    : t('clients:consentements.champs.revoque')}
                  {' · '}
                  {formaterDateHeure(consentement.recueilliLe)}
                </span>
              </li>
            ))}
          </ul>
        </EtatSousCollection>
      </div>
    </div>
  );
}
