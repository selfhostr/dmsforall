import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TYPES_CONSENTEMENT, type TypeConsentement } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useConsentementsClient,
  useCreerConsentementClient,
} from '@/hooks/clients/useConsentementsClient';
import { formaterDateHeure } from '@/lib/formats';

import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
}

/**
 * Onglet « Consentements » (RM-09, nLPD, APPEND-ONLY) — une révocation est une NOUVELLE ligne
 * `accorde: false`, jamais une modification (pas de `PATCH`/`DELETE` au contrat). `type` est
 * restreint aux TROIS valeurs adossées à l'enum Postgres `type_consentement` (arbitrage main,
 * L1-16) : `marketing_email`/`marketing_sms`/`marketing_appel` — un consentement est une preuve
 * juridique, aucune valeur hors contrat n'est proposée ici.
 */
export function OngletConsentements({ clientId }: Props) {
  const { t } = useTranslation(['clients', 'commun']);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="texte-titre-section font-medium text-foreground">
          {t('clients:consentements.titre')}
        </h3>
        <Dialog open={ouvert} onOpenChange={setOuvert}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              {t('clients:consentements.ajouter')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('clients:consentements.ajouter')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="consentement-type">{t('clients:consentements.champs.type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as TypeConsentement)}>
                  <SelectTrigger
                    id="consentement-type"
                    aria-label={t('clients:consentements.champs.type')}
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
        <ul className="space-y-2">
          {lignes.map((consentement) => (
            <li
              key={consentement.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3 texte-corps"
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
  );
}
