## GigaGarageSale - Final Project

#### SEIS622 Web Development - Spring 2025

![Demo](GigaGarageSale.gif)

## Local development

Requires Node 20+ (Angular 19). One-time install (or run `install.cmd` on Windows):

```bash
cd api && npm install
cd ../ui && npm install
```

Run the API and the UI in two terminals (or run `start.cmd` on Windows, which opens both):

```bash
# terminal 1: API on http://localhost:3106
cd api
npm start

# terminal 2: UI on http://localhost:4200 (opens it in your browser)
cd ui
npm start
```

`npm start` in `ui` runs `ng serve --open`, which opens http://localhost:4200/ in your default
browser once the build is ready (`start.cmd` does the same). Use `npx ng serve` if you don't want a
browser window.

The UI calls the API with relative URLs (`/api/...`, `/images/...`). In production IIS serves both
from the same site; locally `ng serve` forwards `/api` and `/images` to `http://localhost:3106`
via `ui/proxy.conf.json`, so the browser never makes a cross-origin request and no CORS setup is
needed. The API binds every address `localhost` resolves to (IPv6 `::1` and IPv4 `127.0.0.1`), so the
proxy reaches it whichever one Node picks. If you run the API on another port (`PORT=...`), change
the `target` in `ui/proxy.conf.json` to match.

If you still see requests to `http://localhost:3000` or a CORS error, you are on an old checkout:
`git pull` on `main`, then restart both terminals.

## socha3 hosting

| Piece | Value |
| --- | --- |
| Public URL | https://gigagaragesale.socha3.com/ |
| Content | `C:\WebApps\GigaGarageSale` |
| Node listen | `localhost:3106` (`PORT` / `HOST` env; binds every loopback address `localhost` resolves to, IPv6 and IPv4) |
| WinSW | `GigaGarageSaleNode` (runs `api` via ts-node) |
| IIS | Site/pool `GigaGarageSale`, ARR to Node |

Deploy: copy repo to `C:\WebApps\GigaGarageSale` (preserve `web.config`, `data\`, `logs\`), then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\post-deploy.ps1 -AppRoot C:\WebApps\GigaGarageSale
```
