# Μονοπάτι (Monopati) — project context for Claude Code

## Owner & working style
- Owner: Iasonas. Communicates in **Greek**; reply in Greek.
- Makes many small, precise UI/text requests. **Keep any text he sends exactly as written** (wording, punctuation, emoji). Change only what is asked.
- Never remove existing features when editing (a past rebuild lost profile photo upload, bio, the DM icon and onboarding icons — don't repeat that).
- Explain what changed in 1–3 short lines; no long recaps.

## What the app is
Commercial Greek-language web app: burnout-aware goal planning (Action mode) + relaxation (Rest mode), with community features and a Mentor role (psychologists).

## Stack
- `backend/server.js`: Node.js + Express, port 3001. **In-memory `db`** (profiles, goals, relaxationSessions, forumPosts, messages) — data is lost on restart. Claude API via `@anthropic-ai/sdk`, model `claude-sonnet-5`. Profile scoping via `x-profile-id` header (no real auth yet). CORS open. `express.json({limit:"25mb"})`, 413 handler.
- `backend/.env` (not in repo): `ANTHROPIC_API_KEY=...` — see `.env.example`. **Never commit, print or move the key to the frontend.**
- `frontend/`: plain HTML/CSS/JS. `index.html` (23 `<section id="screen-…">` screens), `app.js`, `style.css`, `assets/` (leaf PNGs, `dm-icon.png`), `landing.html` (marketing page, hosted separately on Netlify as `index.html`).
- `app.js`: `PRODUCTION_API_BASE = null` → falls back to `${location.protocol}//${location.hostname}:3001/api`. Set it after the backend is deployed.
- CDNs: Tabler Icons, Nunito (Google Fonts, headings via `--font-heading`), pdf.js 3.11.174, mammoth 1.6.0, tesseract.js@5.

## Key features (keep working)
- Profiles: username (case-insensitive unique), photo or emoji avatar, bio, role User/Mentor (**not preselected** at creation). Username/avatar changes cascade to forum posts.
- Goals: AI plan (WBS + SMART, easy→medium→hard), file attachments read by the AI (txt/md/csv/json, PDF ≤20 pages, DOCX, images via OCR `eng+ell`, 6000 chars each), subgoal toggle with celebration message.
- Rest: 3 breathing techniques ("Πάτα Έναρξη" label fits in the circle), PMR with click-to-jump on body regions (`<g class="pmr-hit" data-region>` with transparent hit rects), self-massage with "Επόμενο" button, music (Heart Beat / Alpha / Theta / Binaural — YouTube + Spotify embeds in `MUSIC_CATEGORIES`).
- Community: forum boards `a`="Learn" (mentor-only write, incl. replies) and `b`="Get involved" (open); mentor search; read-only profile view; DMs with 3s polling.
- Burnout Info: 5 texts written by the owner — do not rewrite.
- Mobile fixes in place: button reset (`-webkit-appearance:none; color:inherit`) to avoid blue text, no `100dvh` on normal screens (keyboard instability), file input via `<label>` only (no extra JS `.click()`).

## Agreed launch plan (not started)
1. Put the code in a **private GitHub repo** (first step).
2. **Supabase** (EU region): Postgres + Auth with **Google sign-in only** (owner doesn't want to store passwords). Optional later: email magic link.
   - First login → choose username, role, bio, photo.
   - Row Level Security so users see only their own goals/messages.
3. **Before any public deploy** (mandatory): auth check on every API route (identity from Supabase JWT, not `x-profile-id`), per-user rate limit on `/api/plan`, CORS restricted to own domain, attachment size limits. Owner sets an Anthropic spend limit.
4. Backend → **Render** (secrets in Render env vars). Frontend → **Netlify** connected to GitHub. Staging/preview before production.
5. Domain to be bought later (.gr and/or .com).
6. Optional: admin page (forum moderation, mentor approval, user counts).
- Owner does the account setups (Supabase, Google Cloud OAuth, Render, Netlify) and enters secrets himself. Only the Supabase Project URL and anon key may be shared in chat.

## Business context (for reference)
- Pricing idea (not final): basic relaxation + burnout info always free; premium (AI plans, attachments, music, DMs, stats) with 14-day trial, then subscription (~4–6 €/month or ~30–45 €/year, student discount). Early sign-ups from the landing page get **1 year free**.
- B2B: per employee per year, free pilot first; employer sees only anonymous aggregate stats.
- Legal/tax: privacy policy & terms via a lawyer (GDPR, mental-health data); business registration only before first revenue (accountant).

## Landing page (`frontend/landing.html`)
- Flashcards with real screenshots, feedback form (1–10 first impression, 1–10 likelihood, "Θα πρόσθετες κάτι;", "Σε ενδιαφέρει;" Ναι/Ίσως/Όχι), email signup (1 year free).
- Formspree actions are still placeholders: `https://formspree.io/f/YOUR_FORM_ID`, `https://formspree.io/f/YOUR_SIGNUP_FORM_ID`.
- Live (older copy) at https://vermillion-custard-dc5bcb.netlify.app
- **Do not bring up the QR code** unless the owner asks.

## Run locally
```
cd backend && npm install && cp .env.example .env   # then put the API key in .env
node server.js                                       # API on :3001
# open frontend/index.html, or serve frontend/ (e.g. npx serve frontend)
```
