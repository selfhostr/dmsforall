import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import type { ReponseParametresEntreprise } from '@/hooks/parametrage/entreprise.api';
import { useModifierParametresEntreprise } from '@/hooks/parametrage/useModifierParametresEntreprise';
import { useParametresEntreprise } from '@/hooks/parametrage/useParametresEntreprise';

import { validerNumeroTva } from './numero-tva';

/**
 * Identité fiscale du garage (`GET|PATCH /parametres-entreprise`) : raison sociale en lecture
 * seule (elle vient de la création du garage), n° TVA modifiable. Le numéro est imprimé sur les
 * factures émises ; une faute de frappe est refusée ICI (format + clé de contrôle) avant l'appel.
 */
export function SectionEntreprise() {
  const { t } = useTranslation(['parametrage', 'erreurs']);
  const requete = useParametresEntreprise();

  if (requete.isPending) return <EtatChargement lignes={3} />;
  if (requete.isError) {
    return (
      <EtatErreur
        titre={t('parametrage:entreprise.erreur.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }
  return <FormulaireEntreprise donnees={requete.data} />;
}

function FormulaireEntreprise({ donnees }: { readonly donnees: ReponseParametresEntreprise }) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const modifier = useModifierParametresEntreprise();
  const [saisie, setSaisie] = useState(donnees.numeroTva ?? '');
  const [raisonErreur, setRaisonErreur] = useState<'format' | 'cle' | undefined>(undefined);
  const [enregistre, setEnregistre] = useState(false);

  function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnregistre(false);
    const resultat = validerNumeroTva(saisie);
    if (!resultat.ok) {
      setRaisonErreur(resultat.raison);
      return;
    }
    setRaisonErreur(undefined);
    modifier.mutate(
      { numeroTva: resultat.valeur },
      {
        onSuccess: (reponse) => {
          setSaisie(reponse.numeroTva ?? '');
          setEnregistre(true);
        },
      },
    );
  }

  return (
    <form onSubmit={soumettre} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('parametrage:entreprise.titre')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:entreprise.explication')}
          </p>

          <div className="space-y-2">
            <Label htmlFor="ent-raison-sociale">{t('parametrage:entreprise.raisonSociale')}</Label>
            <Input id="ent-raison-sociale" value={donnees.raisonSociale} readOnly />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ent-tva">{t('parametrage:entreprise.numeroTva')}</Label>
            <Input
              id="ent-tva"
              className="max-w-xs font-mono"
              autoComplete="off"
              placeholder="CHE-123.456.789 TVA"
              value={saisie}
              readOnly={modifier.isPending}
              aria-invalid={raisonErreur ? true : undefined}
              aria-describedby={raisonErreur ? 'ent-tva-aide ent-tva-erreur' : 'ent-tva-aide'}
              onChange={(e) => {
                setSaisie(e.target.value);
                setRaisonErreur(undefined);
                setEnregistre(false);
              }}
            />
            <p id="ent-tva-aide" className="texte-corps text-muted-foreground">
              {t('parametrage:entreprise.numeroTvaAide')}
            </p>
            {raisonErreur ? (
              <p id="ent-tva-erreur" className="texte-corps text-destructive" role="alert">
                {t(`parametrage:entreprise.erreurTva.${raisonErreur}`)}
              </p>
            ) : null}
          </div>

          {modifier.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{messageErreur(modifier.error, t)}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={modifier.isPending}>
              {modifier.isPending
                ? t('commun:chargement.enCours')
                : t('parametrage:entreprise.enregistrer')}
            </Button>
            {enregistre && !modifier.isPending ? (
              <span className="flex items-center gap-1.5 texte-corps text-foreground">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {t('parametrage:entreprise.enregistrementReussi')}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
