# Type Beat

Scout YouTube for type beats by artist, see which ones have free download links and what their license allows, and keep a crate of the beats you like.

**Live app:** https://anewbyss.github.io/type-beat-app/

## What it does

- **Scout:** search YouTube for "[artist] type beat" with filters (free download, free for profit, this week, this month, newest first). Every result's description is read automatically.
- **Description reader:** finds download links (Hypeddit, BeatStars, Google Drive, Dropbox, and more) and flags the license: free for profit, non-profit only, or lease needed, plus whether the producer asks for credit. Picks up BPM and key when listed.
- **Crate:** save beats with producer, BPM, key, mood tags, project, notes, and a 1–5 rating. Search, filter, sort, and preview videos inline.
- **Backup:** export and import your crate as a JSON file from Settings.
- **Installable:** add it to your phone's home screen and it opens like an app.

The app never downloads or converts audio. It points you to the download links producers share themselves.

## Setup

1. **Turn on GitHub Pages:** repo Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save. The app appears at the link above within a minute or two.
2. **Get a YouTube API key:** Google Cloud Console → create a project → APIs & Services → Library → enable **YouTube Data API v3** → Credentials → Create credentials → API key.
3. **Restrict the key:** on the key's page, set *API restrictions* to YouTube Data API v3 only, and add `https://anewbyss.github.io/*` under *Website restrictions*.
4. **Add the key in the app:** open the app → Settings → paste the key → Save and test.

The key is stored only in your browser on your device. It is never committed to this repo.

## Quota

The free YouTube quota is 10,000 units a day. Each Scout or "Load more" costs about 101 units (100 for the search, 1 to read descriptions), so you get roughly 95 searches a day. It resets at midnight Pacific time.

## Getting an Android APK (optional)

The app is a Progressive Web App, so you can wrap it as an APK without writing any Android code:

1. Go to https://www.pwabuilder.com and enter the live app link.
2. Choose **Android** → **Generate Package** and download the zip.
3. Install the `.apk` from the zip on your phone (you may need to allow installs from your browser or file manager).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Look and feel, light and dark |
| `app.js` | YouTube search, description reader, crate |
| `manifest.webmanifest`, `icons/` | Home-screen install |
| `sw.js` | Lets the app open offline |
