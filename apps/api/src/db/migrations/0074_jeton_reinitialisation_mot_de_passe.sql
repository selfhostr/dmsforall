-- =============================================================================================
-- 0074_jeton_reinitialisation_mot_de_passe.sql — socle base de données de la réinitialisation de
-- mot de passe en LIBRE-SERVICE (« mot de passe oublié »), périmètre `apps/api/src/auth/`.
--
-- NUMÉROTATION : 0073 est la dernière migration existante au moment où cette tâche démarre
-- (`0073_index_listes_clients_vehicules.sql`) — vérifié en exécution juste avant d'écrire ce
-- fichier. Cette migration prend 0074.
--
-- LE BESOIN, EN UNE PHRASE : aujourd'hui, seul un admin/direction peut générer un mot de passe
-- temporaire (`socle/service-utilisateur.ts::reinitialiserAcces`) — un garagiste qui oublie son
-- mot de passe un samedi matin est bloqué jusqu'à ce que quelqu'un le débloque. Cette migration
-- pose la SEULE table neuve dont a besoin `auth/services/reinitialisation-mot-de-passe.service.ts`.
--
-- POURQUOI TENANT-SCOPÉE ET PAS UNE 7e OPÉRATION D'AMORÇAGE : contrairement à `session`
-- (résolue hors-tenant par `amorcage.session_par_empreinte`, le tenant n'étant pas encore connu),
-- le flux de réinitialisation résout le tenant AVANT de toucher cette table, via
-- `amorcage.utilisateur_par_email` — déjà l'une des 6 opérations d'amorçage existantes, réutilisée
-- telle quelle (même chemin que la connexion). Le jeton est ensuite vérifié DANS ce tenant, en
-- écriture normale (`AccesBase.enTenant`). « Les 6 SEULES opérations hors contexte tenant »
-- (`db/db.types.ts`) reste donc un invariant intact, pas une exception de plus. Voir le
-- commentaire de tête de `db/schema/jeton-reinitialisation-mot-de-passe.ts` pour le détail complet,
-- et celui de `schemaConfirmationReinitialisationMotDePasse` (`@dfa/shared`, `contrats/auth.ts`)
-- pour pourquoi le corps de la confirmation redemande l'email en plus du jeton.
--
-- SÉCURITÉ DES ÉVÉNEMENTS DE JOURNAL : `type_evenement_securite` (0000/0001) reçoit 3 valeurs
-- neuves (`reinitialisation_demandee`, `reinitialisation_echouee`, `reinitialisation_reussie`),
-- ajoutées ici pour rester dans la MÊME migration que la table qui en a l'usage — voir le
-- commentaire de tête de `packages/shared/src/contrats/enums.ts` (`TYPES_EVENEMENT_SECURITE`)
-- pour la doctrine (deux issues par étape, la raison précise vit dans `details` JSONB).
-- `ALTER TYPE ... ADD VALUE` seul, JAMAIS suivi d'un INSERT utilisant la valeur ajoutée DANS
-- CETTE MÊME migration (`unsafe use of new value` — constat déjà fait par 0023/0031) : cette
-- migration ne fait QUE déclarer les valeurs, aucune ligne n'est écrite ici. Sûr.
--
-- Réversible : migrations/down/0074_jeton_reinitialisation_mot_de_passe.down.sql — PARTIELLEMENT
-- (voir son en-tête : `ALTER TYPE ... ADD VALUE` n'a AUCUN `DROP VALUE` en PostgreSQL, même
-- limite que 0010/0016/0022/0023/.../0055 — enregistrée dans
-- scripts/verifier-reversibilite-migrations.sh (`obtenir_exception_down_partiel`), la table, elle,
-- se défait intégralement.
-- =============================================================================================

alter type public.type_evenement_securite add value if not exists 'reinitialisation_demandee';
alter type public.type_evenement_securite add value if not exists 'reinitialisation_echouee';
alter type public.type_evenement_securite add value if not exists 'reinitialisation_reussie';

create table public.jeton_reinitialisation_mot_de_passe (
  id              uuid        not null default gen_random_uuid(),
  tenant_id       uuid        not null,
  utilisateur_id  uuid        not null,
  empreinte_jeton bytea       not null,
  expire_le       timestamptz not null,
  utilise_le      timestamptz null,
  revoque_le      timestamptz null,
  ip              inet        null,
  user_agent      text        null,
  cree_le         timestamptz not null default now(),

  constraint jeton_reinitialisation_mot_de_passe_pk primary key (id),
  constraint jeton_reinitialisation_mot_de_passe_empreinte_uk unique (empreinte_jeton),

  constraint jeton_reinitialisation_mot_de_passe_fk_tenant
    foreign key (tenant_id) references public.tenant (id) on delete restrict,
  constraint jeton_reinitialisation_mot_de_passe_fk_utilisateur
    foreign key (tenant_id, utilisateur_id)
    references public.utilisateur (tenant_id, id) on delete cascade,

  constraint jeton_reinitialisation_mot_de_passe_empreinte_taille_chk
    check (octet_length(empreinte_jeton) = 32),
  constraint jeton_reinitialisation_mot_de_passe_expire_le_coherent_chk
    check (expire_le > cree_le)
);

comment on table public.jeton_reinitialisation_mot_de_passe is
  'Réinitialisation de mot de passe en libre-service (« mot de passe oublié »). Jeton en clair '
  'jamais stocké — seule son empreinte SHA-256. Usage unique (utilise_le) et court (expire_le, '
  'voir DUREE_JETON_REINITIALISATION_MINUTES) ; revoque_le marque un jeton invalidé sans avoir '
  'servi (demande plus récente, ou reprise de main par un admin via reinitialiserAcces).';

create index jeton_reinitialisation_mot_de_passe_tenant_utilisateur_idx
  on public.jeton_reinitialisation_mot_de_passe (tenant_id, utilisateur_id);
create index jeton_reinitialisation_mot_de_passe_expire_le_idx
  on public.jeton_reinitialisation_mot_de_passe (expire_le);

revoke all                    on public.jeton_reinitialisation_mot_de_passe from dfa_app;
grant  select, insert, update on public.jeton_reinitialisation_mot_de_passe to   dfa_app;

alter table public.jeton_reinitialisation_mot_de_passe enable row level security;
alter table public.jeton_reinitialisation_mot_de_passe force  row level security;

create policy jeton_reinitialisation_mot_de_passe_isolation_tenant
  on public.jeton_reinitialisation_mot_de_passe
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy jeton_reinitialisation_mot_de_passe_migrator
  on public.jeton_reinitialisation_mot_de_passe
  to dfa_migrator
  using (true) with check (true);
