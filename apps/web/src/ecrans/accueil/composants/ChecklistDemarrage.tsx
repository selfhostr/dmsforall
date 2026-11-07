import { peut } from '@/droits';
import { CheckCircle2, Circle, CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { EtapeDemarrage, IdEtapeDemarrage } from '@/hooks/accueil/etapes-demarrage';
import { useEtapesDemarrage } from '@/hooks/accueil/useEtapesDemarrage';
import { useMasquageDemarrage } from '@/hooks/accueil/useMasquageDemarrage';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';
import { cn } from '@/lib/utils';

const LIENS: Readonly<Record<IdEtapeDemarrage, string>> = {
  coordonnees: chemins.parametrage.facturation(),
  compte: chemins.parametrage.facturation(),
  tva: chemins.parametrage.facturation(),
  tauxHoraire: chemins.parametrage.referentiels(),
  motifs: `${chemins.parametrage.atelier()}#motifs-rendez-vous`,
  collaborateur: chemins.parametrage.utilisateurs(),
  borne: chemins.parametrage.utilisateurs(),
};

/**
 * « Démarrer votre garage » — ce qu'il reste à régler pour facturer et planifier sans aide.
 * Affichée à `direction`/`admin` tant que les étapes obligatoires ne sont pas faites ; elle se
 * retire seule une fois tout réglé, ou sur « Ne plus afficher » (préférence locale par
 * utilisateur).
 */
export function ChecklistDemarrage() {
  const { data: session } = useSession();
  const autorise = peut(session?.actions, 'socle.utilisateur.lire');
  const { masque, masquer } = useMasquageDemarrage(autorise ? session?.utilisateur.id : undefined);
  if (!autorise || masque) return null;
  return <CarteDemarrage masquer={masquer} />;
}

function CarteDemarrage({ masquer }: { readonly masquer: () => void }) {
  const { t } = useTranslation('accueil');
  const { etapes, enChargement, complet, reessayer } = useEtapesDemarrage();

  if (complet) return null;

  const total = etapes.filter((e) => !e.facultative).length;
  const faites = etapes.filter((e) => !e.facultative && e.etat === 'fait').length;
  const aVerifier = etapes.some((e) => e.etat === 'inconnu');

  return (
    <Card aria-labelledby="demarrage-titre" role="region" data-demarrage>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle id="demarrage-titre" className="texte-titre-section">
            {t('accueil:demarrage.checklist.titre')}
          </CardTitle>
          {!enChargement ? (
            <p className="texte-corps text-muted-foreground">
              {t('accueil:demarrage.checklist.progression', { faites, total })}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={masquer}>
          {t('accueil:demarrage.checklist.masquer')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {enChargement ? (
          <div
            className="space-y-3"
            role="status"
            aria-label={t('accueil:demarrage.checklist.chargement')}
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {etapes.map((etape) => (
              <LigneEtape key={etape.id} etape={etape} />
            ))}
          </ul>
        )}
        {!enChargement && aVerifier ? (
          <div className="flex items-center gap-3">
            <p className="texte-corps text-muted-foreground">
              {t('accueil:demarrage.checklist.verificationImpossible')}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={reessayer}>
              {t('accueil:demarrage.checklist.reessayer')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LigneEtape({ etape }: { readonly etape: EtapeDemarrage }) {
  const { t } = useTranslation('accueil');
  const fait = etape.etat === 'fait';
  const Icone = fait ? CheckCircle2 : etape.etat === 'inconnu' ? CircleHelp : Circle;
  return (
    <li className="flex items-start gap-3 py-3">
      <Icone className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn('texte-corps font-medium', fait && 'text-muted-foreground')}>
          {t(`accueil:demarrage.etapes.${etape.id}.titre`)}
          <span className="ml-2 texte-libelle font-normal text-muted-foreground">
            {t(`accueil:demarrage.etat.${etape.etat}`)}
            {etape.facultative ? ` · ${t('accueil:demarrage.facultatif')}` : ''}
          </span>
        </p>
        <p className="texte-corps text-muted-foreground">
          {t(`accueil:demarrage.etapes.${etape.id}.pourquoi`)}
        </p>
      </div>
      <Button asChild variant={fait ? 'ghost' : 'outline'} size="sm">
        <Link to={LIENS[etape.id]}>
          {fait ? t('accueil:demarrage.modifier') : t('accueil:demarrage.regler')}
          <span className="sr-only"> — {t(`accueil:demarrage.etapes.${etape.id}.titre`)}</span>
        </Link>
      </Button>
    </li>
  );
}
