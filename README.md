# Bone Brigade Toon Town

A public page comparing the Bone Brigade's World of Warcraft: Forever characters: level, item level, gear, professions, and talents.

## How it works

- Every 3 hours a GitHub Action runs `scripts/fetch.mjs`. It reads each character's public page on the WoW Forever Armory, saves the results to `docs/data.json`, and commits the file only when something changed.
- The same Action publishes `docs/` to GitHub Pages. The page is plain HTML and JavaScript with no build step.

There's no API key. Blizzard hasn't documented a Forever API yet, but every Armory page embeds the full character profile as JSON, and the script reads that. If Blizzard changes the page and every character fails, the Action fails (GitHub emails you) and the site keeps showing the last good data.

The Armory updates when a character logs out, and a character only appears once it reaches level 10.

## Managing characters

The character list is a repository variable, so it's changed in the repo settings rather than in any file:

1. **Settings → Secrets and variables → Actions → Variables**, and edit `CHARACTERS`.
2. List in-game names (first name and surname), separated by commas or new lines:
   ```
   Stardew Honeymelon, Corener Hardboiled, Trandy Reid
   ```
3. **Actions → Update and deploy → Run workflow** to update the page now. Otherwise the change shows up at the next scheduled update, within 3 hours.

From a terminal: `gh variable set CHARACTERS --body "Stardew Honeymelon, Corener Hardboiled, Trandy Reid"`, then `gh workflow run update.yml`.

If `CHARACTERS` is ever deleted or left empty, the update keeps refreshing the characters already on the page instead of wiping it.

The page title is in `config.json`.

## One-time GitHub setup

1. Push this folder to a new public repo.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Add the `CHARACTERS` variable as above.
4. **Actions → Update and deploy → Run workflow** to publish the first time.

GitHub pauses scheduled workflows on repos with no activity for 60 days. If updates stop, re-enable the workflow on the Actions tab.

## Run it locally

```bash
CHARACTERS="Stardew Honeymelon, Corener Hardboiled, Trandy Reid" node scripts/fetch.mjs
npm run serve   # then open http://localhost:8080
```

Without `CHARACTERS`, `node scripts/fetch.mjs` refreshes whoever is already in `docs/data.json`.
