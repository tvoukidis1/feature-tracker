# Feature Tracker

A simple team tool for logging feature requests: who asked for it, which developer owns it,
its status (Request → Accepted → In Development → Complete) and its expected completion date.
The **Overview** tab shows open requests live as a timeline (expected start → completion) or a status board. The **Export** button shows the current (filtered) list as a **timeline** or a **status board**,
and downloads either as PNG or PDF.

Static site (plain HTML/CSS/JS) hosted on GitHub Pages, with shared data in Supabase.

## One-time setup

1. **Database** – in Supabase open *SQL Editor → New query*, paste `supabase-setup.sql`, click *Run*.
2. **Lock sign-ups** – *Authentication → Sign In / Providers → Email*: keep Email enabled,
   turn **off** "Allow new users to sign up".
3. **Redirect URL** – *Authentication → URL Configuration*: set *Site URL* to
   `https://tvoukidis1.github.io/feature-tracker/` and add the same address under *Redirect URLs*.
4. **GitHub Pages** – in the repo: *Settings → Pages → Build and deployment*, Source
   "Deploy from a branch", branch `main`, folder `/ (root)`, Save. The site appears at
   `https://tvoukidis1.github.io/feature-tracker/` within a minute or two.

## Updating an existing database

If you set up the database before the *Expected start* date existed, run
`supabase-migration-002-start-date.sql` once in the Supabase SQL Editor.

## Import from email (optional AI setup)

The **Import from email** button lets you paste a coworker's email; it splits it into separate
requests and walks you through each one (description, developer, status, date) before saving.

It works straight away in *basic mode* (it picks up bullet / numbered lists and request-like sentences).
For smarter extraction with Claude, deploy the included Edge Function. The API key stays in Supabase,
never in this repo or the page:

1. Create an API key at <https://console.anthropic.com> (Settings → API keys).
2. Supabase → *Edge Functions → Secrets* → add `ANTHROPIC_API_KEY` with that key.
3. Supabase → *Edge Functions → Deploy a new function → Via Editor*. Name it exactly
   `extract-requests`, replace the sample code with `supabase/functions/extract-requests/index.ts`, Deploy.
   Leave "Verify JWT" on so only signed-in teammates can use it.

The wizard shows an **AI** badge when the function is working, or **basic mode** when it falls back.

## Adding teammates

Supabase → *Authentication → Users → Add user → Send invitation*, enter their email.
They click the invite, then click **Set password** in the tracker so later sign-ins use email + password.
Supabase's built-in email sender only allows a few emails per hour; for more, add custom SMTP under *Authentication → Emails → SMTP Settings*.
You can also create a teammate directly with a password: *Authentication → Users → Add user → Create new user* (tick *Auto confirm*).

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout |
| `styles.css` | Look and feel (status colours are at the top) |
| `app.js` | All behaviour: sign-in, add/edit/delete, filters, export |
| `config.js` | Supabase URL + **publishable** key. Never put a secret key here. |
| `supabase-setup.sql` | Database table and security rules |
| `supabase-migration-002-start-date.sql` | One-time update adding the expected start date |
| `supabase/functions/extract-requests/index.ts` | Optional AI email-extraction function (runs in Supabase) |
