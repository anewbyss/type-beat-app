# Type Beat

Scout YouTube for type beats by artist, see which ones have free download links and what their license allows, and keep a crate of the beats you like.

**Live app:** https://anewbyss.github.io/type-beat-app/

## What it does

- **Scout:** search YouTube for "[artist] type beat" with filters (free download, free for profit, this week, this month, newest first). Every result's description is read automatically.
- **Description reader:** finds download links (Hypeddit, BeatStars, Google Drive, Dropbox, and more) and flags the license: free for profit, non-profit only, or lease needed, plus whether the producer asks for credit. Picks up BPM and key when listed.
- **Crate:** save beats with producer, BPM, key, mood tags, project, notes, and a 1–5 rating. Search, filter, sort, and preview videos inline.
- **BPM tracker:** tap along while a beat plays and the app works out the tempo, then saves it to the beat. Use ÷2 or ×2 if you tapped half- or double-time. Filter your crate by a BPM range, or tap a tempo to find beats near it.
- **Google sign-in:** scan your liked videos, playlists, and the channels you follow for free downloads, and keep your crate synced to a private YouTube playlist called "Type Beat Crate".
- **Backup:** export and import your crate as a JSON file from Settings.
- **Installable:** add it to your phone's home screen and it opens like an app.

The app never downloads or converts audio. It points you to the download links producers share themselves.

## Setup

1. **Turn on GitHub Pages:** repo Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save. The app appears at the link above within a minute or two.
2. **Get a YouTube API key:** Google Cloud Console → create a project → APIs & Services → Library → enable **YouTube Data API v3** → Credentials → Create credentials → API key.
3. **Restrict the key:** on the key's page, set *API restrictions* to YouTube Data API v3 only, and add `https://anewbyss.github.io/*` under *Website restrictions*.
4. **Add the key in the app:** open the app → Settings → paste the key → Save and test.

The key is stored only in your browser on your device. It is never committed to this repo.

### Google sign-in (optional)

Sign-in is needed for scanning your own account and the playlist sync. Do this in the same Google Cloud project as the API key:

1. **Google Auth Platform → Branding:** fill in an app name (Type Beat) and your email. Save.
2. **Audience:** choose *External*, leave it in *Testing*, and under *Test users* add the Gmail address of your YouTube account.
3. **Data access:** *Add or remove scopes* → tick `.../auth/youtube` (Manage your YouTube account) → Update → Save.
4. **Clients:** *Create client* → type *Web application* → under *Authorized JavaScript origins* add `https://anewbyss.github.io` (no slash or path at the end) → Create. Copy the **Client ID**.
5. In the app: Settings → paste the Client ID → *Save and sign in*.

Google will warn that the app isn't verified. That's expected for a personal app in testing mode: tap *Continue*. Sign-in lasts about an hour per session; tap *Sign in with Google* again when it expires.

Signing in uses your project's quota like the key does. Scanning likes, playlists, or a channel's uploads costs about 2 units per 50 videos. Adding a beat to the playlist costs 50 units, so about 200 additions a day.

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
