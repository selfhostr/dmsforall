import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  schemaCreationFournisseur,
  schemaModificationFournisseur,
  type ReponseFournisseur,
} from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { ChampTelephone } from '@/composants/comptoir/ChampTelephone';
import { useCreerFournisseur } from '@/hooks/pieces/useCreerFournisseur';
import { useModifierFournisseur } from '@/hooks/pieces/useTransitionsFournisseur';

import { messageErreurMutation } from './messages-erreur-mutation';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** `undefined` => création. Fourni => modification. */
  readonly fournisseur?: ReponseFournisseur;
  readonly onCree?: (fournisseur: ReponseFournisseur) => void;
}

interface ValeursFormulaireFournisseur {
  readonly nom: string;
  readonly email: string;
  readonly telephone: string;
  readonly delaiHabituelJours: string;
}

const VALEURS_VIDES: ValeursFormulaireFournisseur = {
  nom: '',
  email: '',
  telephone: '',
  delaiHabituelJours: '',
};

function versValeursFormulaire(
  fournisseur: ReponseFournisseur | undefined,
): ValeursFormulaireFournisseur {
  if (!fournisseur) return VALEURS_VIDES;
  return {
    nom: fournisseur.nom,
    email: fournisseur.email ?? '',
    telephone: fournisseur.telephone ?? '',
    delaiHabituelJours:
      fournisseur.delaiHabituelJours === null ? '' : String(fournisseur.delaiHabituelJours),
  };
}

/**
 * Création/modification d'un fournisseur (RP-26, §1) — un seul dialogue pour les deux gestes,
 * même patron que `FormulaireArticle`. Pas d'`Idempotency-Key` (aucune numérotation serveur,
 * `schemaCreationFournisseur` — un doublon de nom n'est pas une collision technique).
 */
export function FormulaireFournisseur({ ouvert, onOuvertChange, fournisseur, onCree }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'validation', 'erreurs']);
  const estModification = fournisseur !== undefined;
  const creer = useCreerFournisseur();
  const modifier = useModifierFournisseur(fournisseur?.id ?? '');
  const enCours = creer.isPending || modifier.isPending;

  const [valeurs, setValeurs] = useState<ValeursFormulaireFournisseur>(VALEURS_VIDES);
  const [erreurNom, setErreurNom] = useState(false);
  const [erreurDelai, setErreurDelai] = useState(false);

  useEffect(() => {
    if (ouvert) {
      setValeurs(versValeursFormulaire(fournisseur));
      setErreurNom(false);
      setErreurDelai(false);
    }
  }, [ouvert, fournisseur]);

  function soumettre() {
    setErreurNom(false);
    setErreurDelai(false);

    const delaiSaisi = valeurs.delaiHabituelJours.trim();
    const delaiHabituelJours = delaiSaisi === '' ? null : Number.parseInt(delaiSaisi, 10);
    if (
      delaiSaisi !== '' &&
      (delaiHabituelJours === null || Number.isNaN(delaiHabituelJours) || delaiHabituelJours < 0)
    ) {
      setErreurDelai(true);
      return;
    }

    const objetNu = {
      nom: valeurs.nom.trim(),
      email: valeurs.email.trim() === '' ? null : valeurs.email.trim(),
      telephone: valeurs.telephone.trim() === '' ? null : valeurs.telephone.trim(),
      delaiHabituelJours,
    };

    if (estModification && fournisseur) {
      const resultat = schemaModificationFournisseur.safeParse(objetNu);
      if (!resultat.success) {
        if (resultat.error.issues.some((probleme) => probleme.path[0] === 'nom'))
          setErreurNom(true);
        return;
      }
      modifier.mutate(resultat.data, { onSuccess: () => onOuvertChange(false) });
      return;
    }

    const resultat = schemaCreationFournisseur.safeParse(objetNu);
    if (!resultat.success) {
      if (resultat.error.issues.some((probleme) => probleme.path[0] === 'nom')) setErreurNom(true);
      return;
    }
    creer.mutate(resultat.data, {
      onSuccess: (reponse) => {
        onOuvertChange(false);
        onCree?.(reponse.donnees);
      },
    });
  }

  const erreur = estModification ? modifier.error : creer.error;

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={
        estModification
          ? t('pieces:fournisseurs.actions.modifier')
          : t('pieces:fournisseurs.actions.ajouter')
      }
      pied={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={enCours}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="formulaire-fournisseur" disabled={enCours}>
            {enCours ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
          </Button>
        </>
      }
    >
      <form
        id="formulaire-fournisseur"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          soumettre();
        }}
        noValidate
        className="flex flex-col gap-groupe"
      >
        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        <div className="flex flex-col gap-champ">
          <Label htmlFor="fourn-nom" requis>
            {t('pieces:fournisseurs.nom')}
          </Label>
          <Input
            id="fourn-nom"
            required
            readOnly={enCours}
            aria-invalid={erreurNom ? true : undefined}
            value={valeurs.nom}
            onChange={(evenement) => setValeurs((v) => ({ ...v, nom: evenement.target.value }))}
          />
          {erreurNom ? (
            <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-champ">
          <Label htmlFor="fourn-email">{t('pieces:fournisseurs.email')}</Label>
          <Input
            id="fourn-email"
            type="email"
            readOnly={enCours}
            value={valeurs.email}
            onChange={(evenement) => setValeurs((v) => ({ ...v, email: evenement.target.value }))}
          />
        </div>

        <ChampTelephone
          id="fourn-telephone"
          label={t('pieces:fournisseurs.telephone')}
          disabled={enCours}
          valeur={valeurs.telephone}
          onChangeValeur={(valeur) => setValeurs((v) => ({ ...v, telephone: valeur }))}
        />

        <div className="flex flex-col gap-champ">
          <Label htmlFor="fourn-delai">{t('pieces:fournisseurs.delaiHabituelJours')}</Label>
          <Input
            id="fourn-delai"
            type="number"
            min={0}
            inputMode="numeric"
            readOnly={enCours}
            aria-invalid={erreurDelai ? true : undefined}
            value={valeurs.delaiHabituelJours}
            onChange={(evenement) =>
              setValeurs((v) => ({ ...v, delaiHabituelJours: evenement.target.value }))
            }
          />
          {erreurDelai ? (
            <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
          ) : null}
        </div>

        {erreur ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreurMutation(erreur, t)}
          </p>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
