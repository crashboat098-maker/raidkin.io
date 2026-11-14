# Putting RAIDKIN.IO online (Render + Squarespace)

One Render web service does everything: it serves the game page and runs the
multiplayer server. Your Squarespace page then shows that game page in a frame.

```
terravela.tech (Squarespace page)
   └─ <iframe>  ──>  https://raidkin-io-1.onrender.com   (game page + multiplayer)
```

The live service on Render is **raidkin.io-1** (`https://raidkin-io-1.onrender.com`),
on a paid instance (0.5 CPU, 512 MB). An older duplicate, `raidkin-online`, is
suspended and not used.

If the server can't be reached, the game still works: the start screen says
`PRACTICE VS BOTS` and you play against bots in your own browser.

## 1. Create the service on Render (once)

1. Push this repository to GitHub (the `main` branch).
2. In Render, choose **New > Blueprint**, connect your GitHub account if asked,
   and pick the `raidkin.io` repository. Render reads [render.yaml](render.yaml)
   and proposes a web service called **raidkin-online**.
3. Click **Apply**. The first build takes a few minutes.
4. When it shows **Live**, open the service's address (something like
   `https://raidkin-online.onrender.com`). You should see the start screen
   saying `ONLINE - 0 PLAYING`.

From then on, every push to `main` redeploys automatically.

Settings Render uses (already in `render.yaml`, in case you set it up by hand
with **New > Web Service** instead):

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build:online` (or simply `npm install && npm run build`) |
| Start command | `npm start` |
| Root directory | leave empty |
| Health check path | `/healthz` |
| Environment variable | `NODE_VERSION` = `22` |

If a deploy fails with `Cannot find module .../server/dist/server.mjs`, the
build command didn't build the server: open the service's **Settings**, set the
build command above, and choose **Manual Deploy > Deploy latest commit**.

Optional environment variables:

| Variable | What it does |
|---|---|
| `MAX_PLAYERS` | Most people playing at once (default 40). |
| `ALLOWED_ORIGINS` | Comma-separated page addresses allowed to connect, e.g. `https://raidkin-io-1.onrender.com,https://terravela.tech`. Empty means any. |

**Free plan note:** a free Render service goes to sleep after about 15 minutes
with no visitors. The next visitor waits up to a minute while it wakes up, and
the battlefield starts fresh. A paid instance stays awake.

## 2. Add the game to your Squarespace page

1. Edit the page on terravela.tech where the game should go.
2. Add a **Code** block (the same kind you used for the old game).
3. Paste this, replacing the address with your Render service's address:

```html
<div style="position:relative;width:100%;max-width:1280px;margin:0 auto;aspect-ratio:16/9;background:#050605;border-radius:12px;overflow:hidden">
  <iframe
    src="https://raidkin-io-1.onrender.com/"
    title="RAIDKIN.IO"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    allow="fullscreen; gamepad"
    allowfullscreen
    loading="lazy"></iframe>
</div>
```

4. Save and publish. Players click inside the game once so it receives the
   keyboard (SPACE to split, Q to surrender).

The game is designed for a wide screen. On phones it shows the touch joystick
and buttons, and works best with the phone turned sideways.

## Running it on your own computer

```bash
npm run build:online
```

```bash
npm start
```

Then open http://localhost:8787. For development with instant reloads, run
`npm run dev-nolog` and `npm start` side by side, and open
http://localhost:8080/?server=ws://localhost:8787 to play the dev build
against your local server.
