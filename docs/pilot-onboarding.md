# Onboarding a pilot firm

A checklist for bringing a law firm onto Kleidi during the pilot. It takes about two weeks from signing to first live case.

## Before the firm starts

- [ ] **Paperwork.** Sign the pilot agreement and the data processing agreement (DPA). Kleidi processes client data on the firm's behalf, so the DPA must be in place before any real client data is entered.
- [ ] **Firm admin.** Agree who at the firm will be the admin, normally a partner or the office manager.
- [ ] **Approve the admin's email.** Add it to `FIRM_CREATORS` and deploy. Only approved emails can create a firm in production.
- [ ] **Languages.** Agree which language the firm's emails go out in by default, and which languages its clients will need.
- [ ] **Pilot cases.** Pick two to five live sales to run in Kleidi. Choose ones expected to move forward in the next two months.

## Day one: set-up session with the admin (one hour)

1. The admin signs up at the app address and confirms their email.
2. They set up two-factor sign-in with an authenticator app and save their backup codes somewhere safe.
3. They create the firm. Its name appears in emails to clients, so use the name clients know.
4. They invite their colleagues under **Team**, choosing a role for each:
   - **Firm admin** manages the team and can reopen closed cases.
   - **Lawyer** runs cases.
   - **Staff** support the lawyers.
5. Each colleague accepts the emailed invitation, confirms their email and sets up two-factor sign-in.

## Week one: the first case together (one hour, with the lawyers)

1. Open the first pilot case with its property, buyer and seller.
2. Walk through the checklist for the current stage, uploading documents the firm already has.
3. Add the key deadlines with reminders, for example the stamp duty payment and the date the contract must be deposited.
4. Add the buyer's mobile number, then invite them to the portal in their language.
5. Use **Ask client** on one item the buyer must supply, and show the lawyers what the buyer sees.

## Weeks two to eight: running the pilot

- **Weekly check-in (15 minutes)** with the admin: what got in the way, and what was missing.
- **What we watch:**
  - cases opened;
  - documents uploaded, and how many came from clients;
  - deadlines met or missed;
  - portal sign-ins;
  - how long the case stages take compared with the firm's usual.
- **Support:** an email address for the pilot, answered on the same working day. For problems with sign-in or uploads, see `docs/runbook.md`.

## At the end of the pilot

- A review meeting covering what the firm would pay for, and what must change before a wider launch.
- The firm decides whether to continue. If it doesn't, export its data to the firm and delete it from Kleidi, as the DPA requires.

## Known limits to tell the firm

- **Greek and Russian wording is a draft.** Professional translation is pending, so ask the firm to send corrections.
- **Agents and banks can't see anything yet.** Clients can already grant them access, but their view of the case is not built.
