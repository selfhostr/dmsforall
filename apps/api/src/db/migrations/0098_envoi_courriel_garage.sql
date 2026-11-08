-- =============================================================================================
-- 0098_envoi_courriel_garage.sql -- reglage d'envoi des e-mails PROPRE a chaque garage.
--
-- Avant : un seul expediteur technique pour toute l'instance (variables SMTP_*). Desormais chaque
-- garage peut regler son propre serveur d'envoi depuis l'application ; sans reglage, l'instance
-- garde son serveur de repli (SMTP_*), et sans l'un ni l'autre l'envoi est « non configure ».
--
-- `mot_de_passe_chiffre` : AES-256-GCM applicatif (`v1.<iv>.<tag>.<chiffre>`, base64url), lie au
-- tenant par donnees authentifiees. Jamais le mot de passe en clair, jamais renvoye par l'API.
-- Une ligne par tenant (cle primaire = tenant_id). dfa_app peut supprimer la ligne : c'est le geste
-- « revenir au serveur de l'instance » (aucune autre table n'y fait reference).
-- =============================================================================================

create type public.securite_smtp as enum ('tls_implicite', 'starttls', 'aucune');

create type public.cause_echec_envoi_courriel as enum
  ('authentification', 'connexion', 'tls', 'refuse', 'hote_interdit', 'inconnue');

create table public.parametre_envoi_courriel (
  tenant_id            uuid                              not null,
  hote                 text                              not null,
  port                 integer                           not null,
  securite             public.securite_smtp              not null,
  utilisateur          text                              null,
  mot_de_passe_chiffre text                              null,
  adresse_expediteur   text                              not null,
  nom_affiche          text                              null,
  adresse_reponse      text                              null,
  dernier_test_le      timestamptz                       null,
  dernier_test_succes  boolean                           null,
  dernier_test_cause   public.cause_echec_envoi_courriel null,
  cree_le              timestamptz                       not null default now(),
  modifie_le           timestamptz                       not null default now(),

  constraint parametre_envoi_courriel_pk primary key (tenant_id),
  constraint parametre_envoi_courriel_fk_tenant foreign key (tenant_id)
    references public.tenant (id) on delete restrict,
  constraint parametre_envoi_courriel_port_chk check (port between 1 and 65535),
  constraint parametre_envoi_courriel_hote_chk check (length(hote) between 1 and 253),
  constraint parametre_envoi_courriel_secret_sans_utilisateur_chk
    check (mot_de_passe_chiffre is null or utilisateur is not null),
  constraint parametre_envoi_courriel_test_coherent_chk
    check ((dernier_test_le is null) = (dernier_test_succes is null)
           and (dernier_test_succes is distinct from true or dernier_test_cause is null))
);

comment on table public.parametre_envoi_courriel is
  'Serveur d''envoi des e-mails d''un garage (0098). Absence de ligne = le garage utilise le serveur de l''instance (SMTP_*) ou n''envoie pas. mot_de_passe_chiffre : AES-256-GCM, jamais en clair. '
  '[dfa:suppression-physique] « Supprimer ce réglage » (DELETE /parametres-entreprise/envoi-courriel) détruit la ligne et le mot de passe chiffré : un secret ne se conserve pas une fois abandonné, et aucune autre table ne la référence.';
comment on column public.parametre_envoi_courriel.mot_de_passe_chiffre is
  'v1.<iv>.<tag>.<chiffre> (base64url), lie au tenant (AAD). Exclu des exports.';

create trigger parametre_envoi_courriel_touche_modifie_le
  before update on public.parametre_envoi_courriel
  for each row execute function public.touche_modifie_le();

revoke all on public.parametre_envoi_courriel from dfa_app;
grant select, insert, update, delete on public.parametre_envoi_courriel to dfa_app;

alter table public.parametre_envoi_courriel enable row level security;
alter table public.parametre_envoi_courriel force  row level security;

create policy parametre_envoi_courriel_isolation_tenant on public.parametre_envoi_courriel
  to dfa_app
  using      (tenant_id = public.tenant_courant())
  with check (tenant_id = public.tenant_courant());

create policy parametre_envoi_courriel_migrator on public.parametre_envoi_courriel
  to dfa_migrator
  using (true) with check (true);
