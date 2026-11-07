import { Check } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModeSignalement } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { URL_NOUVELLE_FICHE, MAX_ATTENDU, MAX_CONSTAT, MAX_ETAPES } from '@/diagnostic/rapport';
import { useSignalement } from '@/hooks/signalement/useSignalement';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** `via_site` ou `copie_seule` (en `desactive`, le panneau n'est pas monté). */
  readonly mode: Exclude<ModeSignalement, 'desactive'>;
  readonly nbSites: number;
}

/**
 * « Signaler un problème » : prépare un signalement au diagnostic anonymisé. L'application ne
 * poste rien : le bouton ouvre le site, qui termine l'envoi (sans compte GitHub). Ce que
 * l'aperçu montre est exactement ce qui part.
 */
export function PanneauSignalement({ ouvert, onOuvertChange, mode, nbSites }: Props) {
  const { t } = useTranslation(['signalement', 'commun']);
  const s = useSignalement(ouvert, nbSites);
  const champConstat = useRef<HTMLTextAreaElement>(null);
  const viaSite = mode === 'via_site';

  function continuer() {
    if (!s.continuerSurLeSite()) champConstat.current?.focus();
  }

  async function copier() {
    await s.copierLeRapport();
    if (!s.constatRenseigne) champConstat.current?.focus();
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('signalement:titre')}
      pied={
        <>
          <Button
            type="button"
            variant={viaSite ? 'outline' : 'default'}
            onClick={() => void copier()}
          >
            {t('signalement:actions.copier')}
          </Button>
          {viaSite ? (
            <Button type="button" onClick={continuer}>
              {t('signalement:actions.continuer')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="texte-corps text-muted-foreground">{t('signalement:intro')}</p>

        <div className="space-y-2">
          <Label htmlFor="sig-constat" requis>
            {t('signalement:champs.constat')}
          </Label>
          <Textarea
            id="sig-constat"
            ref={champConstat}
            value={s.constat}
            maxLength={MAX_CONSTAT}
            aria-required="true"
            aria-invalid={s.erreurConstat ? true : undefined}
            aria-describedby={s.erreurConstat ? 'sig-constat-erreur' : undefined}
            onChange={(e) => s.definirConstat(e.target.value)}
          />
          {s.erreurConstat ? (
            <p id="sig-constat-erreur" className="texte-corps text-destructive" role="alert">
              {t('signalement:erreurs.constat')}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="sig-etapes">{t('signalement:champs.etapes')}</Label>
          <Textarea
            id="sig-etapes"
            value={s.etapes}
            maxLength={MAX_ETAPES}
            onChange={(e) => s.definirEtapes(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sig-attendu">{t('signalement:champs.attendu')}</Label>
          <Textarea
            id="sig-attendu"
            value={s.attendu}
            maxLength={MAX_ATTENDU}
            onChange={(e) => s.definirAttendu(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Checkbox
              id="sig-joindre"
              checked={s.joindre}
              onCheckedChange={(v) => s.definirJoindre(v === true)}
            />
            <Label htmlFor="sig-joindre">{t('signalement:diagnostic.joindre')}</Label>
          </div>
          <details className="texte-corps">
            <summary className="cursor-pointer font-medium text-foreground">
              {t('signalement:diagnostic.apercu')}
            </summary>
            <p className="mt-2 text-muted-foreground">{t('signalement:diagnostic.apercuAide')}</p>
            <pre
              tabIndex={0}
              aria-label={t('signalement:diagnostic.apercuAria')}
              className="mt-2 max-h-72 overflow-auto rounded-md border p-3 texte-libelle"
            >
              {s.apercuJson}
            </pre>
          </details>
        </div>

        <div className="space-y-2 texte-corps text-muted-foreground" aria-live="polite">
          <p>{viaSite ? t('signalement:envoi.explication') : t('signalement:envoi.copieSeule')}</p>
          {s.etatCopie === 'copie' ? (
            <p className="flex items-center gap-1.5 text-foreground">
              <Check className="h-4 w-4" aria-hidden="true" />
              {t('signalement:copie.reussie')}
            </p>
          ) : null}
          {s.etatCopie === 'echec' ? (
            <>
              <p className="text-foreground">{t('signalement:copie.echec')}</p>
              <Textarea
                readOnly
                value={s.texteACopier}
                aria-label={t('signalement:copie.rapport')}
                onFocus={(e) => e.currentTarget.select()}
              />
            </>
          ) : null}
          <p>
            {t('signalement:copie.fiche')}{' '}
            <a
              href={URL_NOUVELLE_FICHE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              {t('signalement:copie.lien')}
            </a>
          </p>
        </div>
      </div>
    </PanneauLateral>
  );
}
