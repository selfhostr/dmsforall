-- =============================================================================================
-- 0009_ligne_or_annulation_precoce.sql — comble la lacune connue de 0003 §5.2 : `ligne_or` ne
-- pouvait pas être annulée depuis `proposee` ni `a_valider`.
--
-- CONSTAT (signalé pendant l'implémentation, vérifié avant d'écrire cette migration) :
-- `transition_autorisee` (0003 §5.2, voir son commentaire « LACUNE CONNUE, remontée et non
-- comblée d'autorité ») ne contient AUCUNE sortie vers `annulee` depuis `proposee` ou
-- `a_valider`. Conséquence en base : `verifier_transition()` refuse ces deux transitions
-- (ZDFA1), et `ligne_or` n'a par ailleurs aucun GRANT DELETE (RM-71, `ligne_or_interdire_
-- suppression` posé par 0008) — une ligne saisie par erreur au comptoir (mauvais véhicule,
-- doublon, prestation choisie de travers) reste donc DÉFINITIVEMENT sur l'OR, jusque sur le
-- devis présenté au client puis sur la facture. Aggravant découvert en relisant
-- `service-transitions.ts` (I-08, `verifierLignesAValider`) : une ligne bloquée en `a_valider`
-- empêche aussi l'OR de sortir de `ouvert`/`en_cours` vers `controle`/`termine` — ce n'était donc
-- pas seulement une ligne fantôme sur un devis, mais un blocage potentiel de l'OR entier.
--
-- DÉCISION : combler UNIQUEMENT ces deux sorties, pas davantage.
--   - `proposee  -> annulee` : la ligne n'a encore été montrée à personne (aucun devis envoyé,
--     aucun accord demandé). L'annuler revient à corriger une saisie, pas à revenir sur un
--     engagement pris envers le client.
--   - `a_valider -> annulee` : la ligne est en attente d'une décision d'accord (plafond dépassé
--     ou devis complémentaire en cours) qui n'a PAS ENCORE été rendue. L'annuler retire une
--     question posée avant sa réponse — distinct de `a_valider -> refusee` (déjà dans le
--     référentiel depuis 0003), qui enregistre une réponse EFFECTIVEMENT REÇUE du client
--     (CT-33) : les deux transitions coexistent et signifient des choses différentes.
--   Aucune sortie supplémentaire n'est ajoutée depuis `validee`, `en_cours` ou `realisee` : ces
--   trois transitions vers `annulee` existent déjà (0003) et ne changent pas de comportement —
--   une ligne VALIDÉE a déjà été acceptée par le client ou n'attendait aucun accord (RM-54), une
--   ligne EN_COURS ou RÉALISÉE a mobilisé un technicien et potentiellement des pièces sorties du
--   stock : annuler un travail déjà engagé ou déjà fait n'a pas le même poids qu'annuler une
--   ligne qui n'a encore rien engagé. `facturee` reste un état terminal sans aucune sortie (une
--   ligne facturée se corrige par avoir, jamais par annulation, RM-71/I-15) : ni cette migration
--   ni aucune future ne doit y toucher, exactement comme `cloture`/`annule` restent terminaux
--   pour `ordre_reparation` (I-05, I-06).
--
-- MOTIF OBLIGATOIRE (`exige_motif = true`) sur les DEUX nouvelles transitions, par symétrie avec
-- les trois annulations déjà en place (`validee|en_cours|realisee -> annulee`, toutes
-- `exige_motif = true` depuis 0003) : une ligne annulée sans trace est une ligne qui n'a jamais
-- existé, et l'atelier a besoin de savoir pourquoi une prestation a disparu d'un OR — y compris
-- quand elle n'a jamais été montrée au client. Ce n'est d'ailleurs pas une garde nouvelle : le
-- contrat API (`schemaAnnulationLignes`, packages/shared/src/contrats/atelier/ligne.ts) exige
-- déjà `motif: schemaMotif` NON OPTIONNEL sur `POST /ordres-reparation/{orId}/annuler-lignes`
-- (contrat gelé, hors périmètre de cette migration), et la contrainte
-- `ligne_or_annulation_motif_chk` (0008) refuse déjà `statut = 'annulee'` sans
-- `motif_annulation` renseigné, quelle que soit la transition empruntée. `exige_motif` sur ces
-- deux lignes fait donc concorder le référentiel avec ce que le reste du système impose déjà —
-- il ne s'agit pas d'ouvrir une garde plus large que celle qui existe pour les trois annulations
-- historiques.
--
-- CE QUI RESTE HORS PÉRIMÈTRE, VOLONTAIREMENT : aucune règle n'est ajoutée ici pour interdire
-- d'annuler une ligne `a_valider` déjà rattachée à un devis complémentaire ENVOYÉ mais pas
-- encore répondu (`devis_complementaire_ligne`). Le devis garde sa propre trace, immuable après
-- réponse (RM-79, `devis_complementaire_verrouiller_apres_reponse`, 0008) ; la ligne annulée
-- sort du calcul de `attente_accord` au prochain recalcul de drapeaux, sans code supplémentaire
-- (trigger déjà posé par 0008, `ligne_or_recalculer_drapeaux` : l'agrégat exclut déjà `statut in
-- ('facturee', 'annulee', 'refusee')`). Si l'atelier veut un jour EMPÊCHER l'annulation d'une
-- ligne dont le devis est en attente de réponse, c'est une garde CONDITIONNELLE de service
-- (couche 4 de la machine à états, cf. 0008 §0), pas une règle structurelle de cette table — et
-- donc hors périmètre d'une migration qui ne touche que le référentiel.
--
-- Réversible : migrations/down/0009_ligne_or_annulation_precoce.down.sql — supprime les deux
-- lignes ajoutées ici, rien d'autre. Testé up → down → up (test/integration/migrations.spec.ts).
-- =============================================================================================

insert into public.transition_autorisee (entite, statut_depuis, statut_vers, exige_motif) values
  ('ligne_or', 'proposee',  'annulee', true),
  ('ligne_or', 'a_valider', 'annulee', true);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
declare
  n integer;
begin
  -- Volume : 11 (0003) + 2 (ici) = 13. Une insertion perdue dans un conflit de fusion se voit ici.
  select count(*) into n from public.transition_autorisee where entite = 'ligne_or';
  if n <> 13 then
    raise exception 'transition_autorisee : % transitions pour ligne_or après 0009, 13 attendues.', n;
  end if;

  if not exists (
    select 1 from public.transition_autorisee
     where entite = 'ligne_or' and statut_depuis = 'proposee' and statut_vers = 'annulee'
       and exige_motif
  ) then
    raise exception '0009 : proposee -> annulee absente, ou exige_motif=false, après insertion.';
  end if;

  if not exists (
    select 1 from public.transition_autorisee
     where entite = 'ligne_or' and statut_depuis = 'a_valider' and statut_vers = 'annulee'
       and exige_motif
  ) then
    raise exception '0009 : a_valider -> annulee absente, ou exige_motif=false, après insertion.';
  end if;

  -- Ceinture et bretelles : `facturee` doit rester un état terminal — cette migration ne doit
  -- rien y avoir ajouté, directement ou par un copier-coller fautif.
  if exists (
    select 1 from public.transition_autorisee where entite = 'ligne_or' and statut_depuis = 'facturee'
  ) then
    raise exception '0009 : une sortie existe depuis « facturee » — état terminal violé (RM-71/I-15).';
  end if;
end
$$;
