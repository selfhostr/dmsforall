import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaCreationFinancement,
  TYPES_FINANCEMENT_VENTE,
  type ReponseFinancement,
  type TypeFinancementVente,
} from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { SelecteurOrganismeVente } from '@/ecrans/ventes/reprises/SelecteurOrganismeVente';
import { useCreerFinancement } from '@/hooks/ventes/financements/useTransitionsFinancement';

interface Props {
  readonly dossierVenteId: string;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** Voir `CarteFinancement` : l'intégrateur (fiche dossier) doit invalider/recharger sa requête
   *  dossier dans ce callback — `financements`/`financement` n'existent QUE là (aucun cache propre
   *  à ce module, voir l'en-tête de `hooks/ventes/financements/financement.api.ts`). */
  readonly onCree: (financement: ReponseFinancement) => void;
}

/**
 * Proposition d'un financement (§9.3 du design) — `type` (`Select`), organisme (recherche
 * client/tiers, obligatoire ET affiché UNIQUEMENT pour `credit`/`leasing`, masqué pour
 * `comptant`), référence de contrat optionnelle. `comptant` se confirme immédiatement côté
 * serveur — le dialog l'annonce avant soumission.
 */
export function DialogueCreationFinancement({
  dossierVenteId,
  ouvert,
  onOuvertChange,
  onCree,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'validation', 'erreurs']);
  const idempotence = useCleIdempotence();
  const creer = useCreerFinancement(dossierVenteId);

  const [type, setType] = useState<TypeFinancementVente>('comptant');
  const [organismeId, setOrganismeId] = useState<string | null>(null);
  const [referenceContrat, setReferenceContrat] = useState('');
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({});

  useEffect(() => {
    if (ouvert) {
      setType('comptant');
      setOrganismeId(null);
      setReferenceContrat('');
      setErreursChamps({});
      creer.reset();
      idempotence.regenerer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  const erreurActive = creer.error instanceof ErreurApi ? creer.error : null;
  const organismeRequis = type === 'credit' || type === 'leasing';

  function soumettre() {
    setErreursChamps({});
    const resultat = schemaCreationFinancement.safeParse({
      type,
      organismeId: organismeRequis ? organismeId : null,
      referenceContrat: referenceContrat.trim() === '' ? null : referenceContrat.trim(),
    });
    if (!resultat.success) {
      const erreurs: Record<string, string> = {};
      for (const probleme of resultat.error.issues) {
        const champ = String(probleme.path[0] ?? '');
        if (champ && !erreurs[champ]) erreurs[champ] = t('validation:requis');
      }
      setErreursChamps(erreurs);
      return;
    }
    if (organismeRequis && !organismeId) {
      setErreursChamps({ organismeId: t('validation:requis') });
      return;
    }

    creer.mutate(
      { entree: resultat.data, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          onCree(reponse.donnees);
          onOuvertChange(false);
        },
      },
    );
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('ventes:financement.proposer.titre')}
      pied={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={creer.isPending}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="financement-creation" disabled={creer.isPending}>
            {creer.isPending
              ? t('commun:chargement.enCours')
              : t('ventes:financement.proposer.bouton')}
          </Button>
        </>
      }
    >
      <form
        id="financement-creation"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          soumettre();
        }}
      >
        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="financement-type" requis>
            {t('ventes:financement.proposer.champType')}
          </Label>
          <Select value={type} onValueChange={(valeur) => setType(valeur as TypeFinancementVente)}>
            <SelectTrigger id="financement-type" aria-required="true">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES_FINANCEMENT_VENTE.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`ventes:financement.types.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {type === 'comptant' ? (
          <p className="texte-libelle text-muted-foreground">
            {t('ventes:financement.proposer.aideComptant')}
          </p>
        ) : (
          <SelecteurOrganismeVente
            label={t('ventes:financement.proposer.champOrganisme')}
            placeholder={t('ventes:financement.proposer.champOrganismePlaceholder')}
            obligatoire
            valeur={organismeId}
            onChangeValeur={setOrganismeId}
            erreur={erreursChamps.organismeId}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="financement-reference">
            {t('ventes:financement.proposer.champReferenceContrat')}
          </Label>
          <Input
            id="financement-reference"
            value={referenceContrat}
            onChange={(evenement) => setReferenceContrat(evenement.target.value)}
          />
        </div>

        {erreurActive ? (
          <RefusBloquant
            code={erreurActive.probleme.code}
            blocages={erreurActive.blocages}
            actionsProposees={erreurActive.actionsProposees}
          />
        ) : creer.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(creer.error, t)}
          </p>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
