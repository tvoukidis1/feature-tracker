# Feature Tracker

A simple team tool for logging feature requests: who asked for it, which developer owns it,
its status (Request → Accepted → In Development → Complete) and its expected completion date.
The **Export** button shows the current (filtered) list as a **timeline** or a **status board**,
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

## Adding teammates

Supabase → *Authentication → Users → Add user → Send invitation*, enter their email.
They click the invite, then sign in on the tracker with their email (a sign-in link is emailed each time).

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout |
| `styles.css` | Look and feel (status colours are at the top) |
| `app.js` | All behaviour: sign-in, add/edit/delete, filters, export |
| `config.js` | Supabase URL + **publishable** key. Never put a secret key here. |
| `supabase-setup.sql` | Database table and security rules |
