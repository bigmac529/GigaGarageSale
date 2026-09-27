## GigaGarageSale - Final Project

#### SEIS622 Web Development - Spring 2025

![Demo](GigaGarageSale.gif)

## socha3 hosting

| Piece | Value |
| --- | --- |
| Public URL | https://gigagaragesale.socha3.com/ |
| Content | `C:\WebApps\GigaGarageSale` |
| Node listen | `127.0.0.1:3106` (`PORT` env) |
| WinSW | `GigaGarageSaleNode` (runs `api` via ts-node) |
| IIS | Site/pool `GigaGarageSale`, ARR to Node |

Deploy: copy repo to `C:\WebApps\GigaGarageSale` (preserve `web.config`, `data\`, `logs\`), then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\post-deploy.ps1 -AppRoot C:\WebApps\GigaGarageSale
```
