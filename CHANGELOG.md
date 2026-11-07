# Changelog

All notable changes to dmsforall are recorded here, for people who run it and for people who use it. Each entry says what changes for you. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) until 1.0.

## [Non publié]

### Ajouté

- **Tableau de bord.** « Aujourd'hui » devient « Tableau de bord ». L'accueil ne garde que les tâches du jour ; les chiffres sont dans Facturation › Chiffres.
- **Plusieurs sites.** Chaque collaborateur a un site principal. Chaque site a un code court. Les écrans ont un filtre de site compact.
- **Modules activables.** Réglages › Modules : retirez les modules que votre garage n'utilise pas. Ils disparaissent du menu.
- **Signaler un problème.** Un bouton envoie un diagnostic anonymisé. Le garage peut activer ou désactiver ce bouton dans ses réglages.
- **Mon garage.** Réglages › Mon garage regroupe les coordonnées, l'adresse et le statut TVA. Le premier collaborateur devient facultatif.
- **Garage non assujetti à la TVA.** Répondez « Non » dans Mon garage. Vos factures, devis et ordres de réparation sont alors émis sans TVA, et les PDF portent la mention « Non assujetti à la TVA ». Un garage assujetti doit saisir son numéro de TVA avant d'émettre une facture.
- **Corriger une facture.** Une facture émise ne se modifie pas. « Corriger » crée un avoir total et un nouveau brouillon pré-rempli, à reprendre et à émettre.
- **Menu du compte et recherche.** Réglages, thème, taille du texte et langue sont dans le menu du compte. La recherche est une entrée du menu.
- **Jeu de démonstration complet.** Un jeu de données de démonstration couvre tout l'écran du garage. On peut le recharger à volonté.

### Modifié

- **Interface uniforme.** En-têtes, filtres sur une seule ligne, tri par icône, saisies dans un panneau latéral, badges de statut communs, et un bouton « ? » pour l'aide de chaque écran.
- **Pointage.** Le code PIN ne sert qu'à la borne de pointage, pas à l'écran de l'atelier.
- **Droits par rôle.** L'accueil, la borne, le logo et le pointage ne montrent et n'appellent que ce que votre rôle permet.

### Corrigé

- Les titres des listes sont visibles. Les mises en page du stock VO, du planning et de la fiche facture sont corrigées.
- Le régime TVA et les modules sont lisibles par tous les rôles.
- La checklist de démarrage demande le numéro de rue, comme l'émission d'une facture.

### Mise à jour

- Les garages existants sont marqués assujettis à la TVA : rien ne change en silence. Un garage assujetti sans numéro de TVA ne peut plus émettre de facture tant qu'il ne l'a pas saisi, ou tant qu'il ne répond pas « Non ».

### Technique

- Migrations 0089 à 0093, réversibles (`down/`) : `entite_auditee.tenant` (audit de la raison sociale), `tenant.assujetti_tva`, site principal et code court par site, `tenant.modules_desactives`, `tenant.mode_signalement`.

## 0.2.0 (2026-11-07)

This release fixes the repair order invoicing problem found in 0.1.0, and adds quotes, courtesy cars and an accounting export for your fiduciary. Read the upgrade notes before you update.

### Fixed

- **Repair orders can be invoiced.** The "mark as done" action on repair order lines is now wired, so a repair order can move on to invoicing. Every line type can be marked done, including labour and flat-rate lines, without a time-clock entry. Refusals say which status blocks the action and what to do.
- **Cash payments round to 5 centimes in both directions.** A balance ending in 3, 4, 8 or 9 centimes rounds up as well as down. The difference is recorded as a rounding entry, not as a customer advance.
- **First document number is safe.** Creating the first document of a kind at the same moment as someone else no longer fails with a server error.
- **Hourly rate history is kept.** A new rate starts on its date and closes the previous period. A closed period cannot be changed.
- **Accounting role cannot change the creditor IBAN.** It can still read it.
- **WinBIZ export errors are explained** in the screen, in French, German or Italian.
- **Single-site garages** are no longer asked which site to use, and saving an employee keeps their existing site assignments.
- **Error messages** say what blocks and what to do, in French, German and Italian. Status refusals name the current and the requested status.
- **Terminal refusals** name the site where the repair order is.
- **Dates in search results** follow the Swiss format (dd.mm.yyyy).
- **Uploaded files are backed up.** Nightly backups and restores include invoice PDFs, repair order photos and resignation exports, next to the database.
- **Error logs hide values.** Query parameters and database values appear as `[masqué]` in logs.
- **Account actions respect rank.** You cannot deactivate, reactivate or reset the access of yourself, or of someone with more rights than you. Only an admin can act on an admin. The last owner (patron) of a garage cannot be removed, even when two changes happen at the same time.
- **VAT number and garage header on every document.** The VAT number from your settings was not printed anywhere. The garage name, address and VAT number now appear on invoices, quotes, additional quotes and repair order sheets, including garages without bank details.

### Added

- **Quotes.** Create a quote, send it as a PDF by e-mail, record the client's acceptance, and create a repair order from the accepted quote, with its lines.
- **Repair order from a quote.** The repair order takes the client, the vehicle and all the quote lines. You can enter the mileage at entry.
- **Language choice in the account menu**: Français, Deutsch or Italiano. Your choice is kept after a reload.
- **Courtesy cars.** A fleet list, loans by period, and a Courtoisie screen under Atelier. A courtesy car can be lent from an appointment.
- **Deferred work.** Note work to do at the next visit from the vehicle page. It is picked up when you add the line to a repair order.
- **Accounting export for your fiduciary.** A screen with preview and history, a WinBIZ export, a generic CSV export and account mapping.
- **Photos on repair order lines.**
- **Invoice and collect payment in one step** from a repair order.
- **Quick repair order creation.** Create the client, the vehicle and the repair order in one action, from a plate.
- **Start-up checklist for a new garage** on the home screen. A new garage gets sensible defaults: workshop settings, an hourly rate, eight appointment reasons, and a VAT number field.
- **Invoices without complete bank details** are issued without a QR-bill, and the screen warns you. Fill in your bank details in the settings before you invoice.
- **Company logo and default payment term**, printed on invoices and quotes.
- **Appointments.** Site and vehicle are preselected. Phone numbers are clickable. Appointments on other sites are shown with a link.
- **Home screen organised by tasks.** Search by plate, client or repair order, quick actions, and a "to do today" list.
- **Success messages with undo** after the main actions.

### Changed

- **Garage vocabulary** in French, German and Italian. For example "Ventes" becomes "Véhicules à vendre", "Parc" becomes "stock", "Verbatim" becomes "Demandes du client", and "Paliers de relance" becomes "Rappels de paiement". On a repair order, "Terminer" becomes "Travaux terminés". The glossary covers OR, MFK, VN, VO, QR-facture and Avoir.
- **Appointment reasons** are deactivated, not deleted.
- **Export screen** shows invoices and credit notes separately, with a preview.
- **Easier to tap on touch screens.** Buttons have 44 px targets, and the density adapts to the device.
- **Lighter repair order list.** The list loads a summary of each order, with fewer queries and less data per page.
- **Rights are set per person.** Each person has a grid of Rien, Voir or Faire over six areas: workshop, reception, invoicing, parts, sales and finance. Roles are now presets you can adjust. The editor is "Qui peut quoi" in Réglages. A cut in rights applies on the next request. You cannot change your own rights, or give rights you do not have.
- **Sent quotes are locked.** A quote cannot be edited once sent, and sending asks you to confirm.
- **People are shown as First Last** (Prénom Nom) everywhere. Search finds them in either order.
- **Italian uses the formal Lei** in full sentences. Short labels keep the standard form.
- **Accounting export proposes WinBIZ values.** Account mapping suggests 3809 for rounding and N81 for 8.1 % VAT. The invoice number is used as the accounting document number. Blocking messages name the invoice, its date and amount.

### Performance

- **Repair order and invoice lists load in batches.** Each page is loaded with one query per table, and pages use keyset pagination. Two new indexes speed up sorting.
- **Screens load when you open them.** Reference lists are kept for five minutes. Translations load per language.
- **Smaller Docker images.** The base images are refreshed, and npm is removed from the runtime image.

### Upgrade notes

- **Migrations 0076 to 0088 run automatically** when you start the stack. Nothing to do.
- **Review rights after you update.** The migration gives each person the grid of their role, with no right lost compared with 0.1.0. Some roles gain rights (stock keeper, accountant, salesperson, workshop manager, technician). Review them in Réglages, "Qui peut quoi", if you want to restrict them.
- **Two new Docker volumes** are created on `docker compose up -d`: `dfa_photos_or` for repair order photos and `dfa_reprise` for archives from your previous software. Do not delete them.
- **If you changed `docker-compose.yml`**, mount the two new volumes in the `backup` service too, read-only, so that the nightly backup includes them.
- **Back up before you upgrade.** See [Back up and restore](https://dmsforall.selfhostr.io/docs/get-started/backup-and-restore/).

The alpha limits in the [README](README.md#limits) apply.

## 0.1.0 (2026-11-06)

This is the first public version of dmsforall. The alpha limits in the [README](README.md#limits) apply.

What it contains:

- **Clients and vehicles**, with owner history, and a global search.
- **Repair orders** with labour, parts and fee lines, appointments and a courtesy car list.
- **Time clocking** on repair orders, from a workshop terminal protected by a PIN.
- **Quotes, invoices, down-payment invoices and credit notes**, with a Swiss QR-bill on invoices and PDF output. An issued invoice is locked. You correct it with a credit note.
- **Payments** recorded per document, and a WinBIZ export.
- **Parts and stock** with stock movements, reservations on repair orders, supplier orders and supplier invoices.
- **New and used car sales**, with sales files, trade-ins and financing or leasing confirmation.
- **Tyre storage** with seasonal sets.
- **Automatic reminders** for overdue invoices, sent by e-mail when the server is configured to send e-mail.
- **Data import** from a Microsoft Access or dBase/FoxPro archive, with a plan to review before anything is written.
- **Interface** in French, German and Italian, with light and dark themes.

Operators who want to try it should read [Back up and restore](https://dmsforall.selfhostr.io/docs/get-started/backup-and-restore/) before they enter real data.
