# What to watch

Random film picker for your Letterboxd watchlist. Filter by year, genre and language.

## Setup
1. Create a GitHub repo and upload all of these files (keep the `.github` folder).
2. **Settings > Pages**: Source = *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. **Settings > Secrets and variables > Actions > Variables**: add a variable `LB_USER` with your Letterboxd username.
4. **Actions** tab > *Update watchlist* > **Run workflow**. This fills `data/watchlist.json`.
5. Open `https://<you>.github.io/<repo>/`.

## How "live" works
Letterboxd has no public API, so a GitHub Action reads your public watchlist every hour and commits
`data/watchlist.json` if films were added or removed. The site loads that file on every visit.
To refresh immediately after editing your watchlist, run the workflow by hand (step 4).

Your watchlist must be public. If Letterboxd blocks GitHub's servers, run it on your own computer instead:
`LB_USER=yourname node scripts/update.mjs`, then commit and push `data/watchlist.json` (Node 18+).
