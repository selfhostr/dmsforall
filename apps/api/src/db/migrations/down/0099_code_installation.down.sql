-- Inverse de 0099 : retire la table du code d'installation. Sans perte : le code se regenere au
-- demarrage suivant tant qu'aucun garage n'existe.
drop table amorcage.code_installation;
