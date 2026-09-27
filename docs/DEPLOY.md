# Deploying GigaGarageSale

Every merge to `main` deploys the app to https://gigagaragesale.socha3.com/ through
`.github/workflows/deploy.yml`. You can also start a deploy by hand from the Actions tab.

| Piece | Value |
| --- | --- |
| Public URL | https://gigagaragesale.socha3.com/ (Cloudflare → IIS/ARR → Node) |
| App folder | `C:\WebApps\GigaGarageSale` |
| Node | `localhost:3106` (`PORT` env), WinSW service `GigaGarageSaleNode` |
| Health check | http://localhost:3106/api/health |
| Backups | `C:\WebApps\_deploy-backups\GigaGarageSale\<timestamp>` (last 5 kept) |
| Runner | self-hosted Windows runner on the server in `C:\actions-runner-gigagaragesale`, labels `self-hosted, windows, gigagaragesale` |

## How it works

1. **Build and test** (GitHub-hosted `ubuntu-latest`):
   - installs dependencies and builds the Angular UI in production mode
   - runs the unit tests, but they **don't block the deploy yet**, because several specs already fail on `main` due to missing test providers
   - starts the API with the built UI and checks `/api/health` and `/`
   - uploads a package: the repo files at that commit plus the built UI in `api/public/spa`
   - if the commit doesn't contain the hosted app (no `/api/health` in `api/src/index.ts`, or no `scripts/ci-deploy.ps1`), it builds only and skips the deploy
2. **Deploy** (the self-hosted runner on the server) downloads the package and runs `scripts/ci-deploy.ps1`, which:
   1. backs up the current code and `api\node_modules`
   2. stops `GigaGarageSaleNode` and makes sure nothing is still listening on port 3106
   3. syncs the code folders (`api\src`, `api\public`, `shared`, `scripts`, `ui\src`, `ui\public`) and the top-level files. It never touches `web.config`, `.env` files, `data\`, `logs\` or anything else outside those folders.
   4. runs `npm ci` for the API on the server, and makes sure `data\` and `web.config` exist (it creates `web.config` from `web.config.example` only if it's missing)
   5. starts the service and polls http://localhost:3106/api/health (plus `/`) for up to 90 seconds
   6. if anything fails after the service was stopped, it restores the backup, restarts the service, checks health again, and **fails the job**

   Deploys never overlap (`concurrency: deploy-production`). A newer run waits for the current one to finish.

The deploy uses no repository secrets. The runner connects out to GitHub, so nothing on the server has to be opened to the internet.

`scripts/post-deploy.ps1` is still there for a fully manual deploy (it builds the UI on the server).

## One-time setup on the Windows server

Run these in an **elevated** Windows PowerShell on the server.

### 1. Create the runner's service account

The runner needs to:

- write to `C:\WebApps\GigaGarageSale` and `C:\WebApps\_deploy-backups`
- start and stop the `GigaGarageSaleNode` service

A dedicated, non-administrator local account keeps that access to exactly these two things.

```powershell
# Account (not an administrator)
$pw = Read-Host "Password for gha-gigagaragesale" -AsSecureString
New-LocalUser -Name "gha-gigagaragesale" -Password $pw -PasswordNeverExpires `
  -UserMayNotChangePassword -Description "GitHub Actions runner - GigaGarageSale deploys"

# Folder rights: app folder and backup folder (Modify, inherited)
New-Item -ItemType Directory -Force "C:\WebApps\_deploy-backups" | Out-Null
icacls "C:\WebApps\GigaGarageSale" /grant "gha-gigagaragesale:(OI)(CI)M" /T
icacls "C:\WebApps\_deploy-backups" /grant "gha-gigagaragesale:(OI)(CI)M" /T

# Service rights: query, start, stop GigaGarageSaleNode (back up the original SDDL first)
$sid  = (New-Object System.Security.Principal.NTAccount "gha-gigagaragesale").Translate(
          [System.Security.Principal.SecurityIdentifier]).Value
$sddl = (sc.exe sdshow GigaGarageSaleNode | Where-Object { $_ }) -join ""
Set-Content "C:\WebApps\_deploy-backups\GigaGarageSaleNode-sddl-original.txt" $sddl
$new  = $sddl.Insert($sddl.IndexOf("D:") + 2, "(A;;CCLCSWRPWPLORC;;;$sid)")
sc.exe sdset GigaGarageSaleNode $new
```

Check it by running `sc.exe sdshow GigaGarageSaleNode`. The output should now include an ACE with the account's SID.

On socha3 the ACE actually granted is `(A;;CCLCSWRPWPLORC;;;SID)`: query config/status, enumerate dependents, start, stop, interrogate and read permissions only, with no pause/continue or custom controls. That is all the deploy needs (`Get-Service`, `Stop-Service`, `Start-Service` and waiting for the status). The original SDDL is backed up at `C:\WebApps\_deploy-backups\GigaGarageSaleNode-sddl-original.txt`. To undo the grant, run `sc.exe sdset GigaGarageSaleNode (Get-Content C:\WebApps\_deploy-backups\GigaGarageSaleNode-sddl-original.txt)`.

Node (`C:\Program Files\nodejs`) and WinSW (`C:\Tools\WinSW`) only need the default read/execute access for users.

*Simpler but more powerful alternative:* skip this step and use `NT AUTHORITY\SYSTEM` as the service account in step 2. That works without granting any rights, but then any code that reaches the runner has full control of the server.

### 2. Install and register the runner as a service

The runner lives in `C:\actions-runner-gigagaragesale`, not the default `C:\actions-runner`: the server hosts runners for several apps, so each one gets its own folder.

1. Get a registration token: GitHub → **bigmac529/GigaGarageSale → Settings → Actions → Runners → New self-hosted runner → Windows**. Copy the token from the `config.cmd` line; it's valid for 1 hour. From any machine with the GitHub CLI you can use `gh api -X POST repos/bigmac529/GigaGarageSale/actions/runners/registration-token --jq .token` instead.
2. Download and unpack the runner. The same page shows the current version and its SHA-256 checksum.

   ```powershell
   [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
   New-Item -ItemType Directory -Force C:\actions-runner-gigagaragesale | Out-Null
   Set-Location C:\actions-runner-gigagaragesale
   $ver = "2.337.0"
   Invoke-WebRequest -UseBasicParsing -OutFile "runner.zip" `
     "https://github.com/actions/runner/releases/download/v$ver/actions-runner-win-x64-$ver.zip"
   Add-Type -AssemblyName System.IO.Compression.FileSystem
   [System.IO.Compression.ZipFile]::ExtractToDirectory("C:\actions-runner-gigagaragesale\runner.zip", "C:\actions-runner-gigagaragesale")
   ```

3. Configure it as a Windows service with the `gigagaragesale` label. `self-hosted`, `Windows` and `X64` are added automatically.

   ```powershell
   .\config.cmd --url https://github.com/bigmac529/GigaGarageSale --token <TOKEN> `
     --name socha3-gigagaragesale --labels gigagaragesale --work _work --runasservice
   ```

   When it asks for the service account, enter `.\gha-gigagaragesale` and its password. Leaving `--unattended` off means the password isn't kept in your shell history.

   For an unattended setup, add `--unattended --windowslogonaccount ".\gha-gigagaragesale" --windowslogonpassword "<password>"`.

   `config.cmd` gives the account the "Log on as a service" right and access to `C:\actions-runner-gigagaragesale`.
4. Verify:
   - `Get-Service "actions.runner.bigmac529-GigaGarageSale.*"` shows it **Running**. The other apps' runners have their own `actions.runner.*` services.
   - GitHub → Settings → Actions → Runners shows `socha3-gigagaragesale` as **Idle**, with labels `self-hosted`, `Windows`, `X64`, `gigagaragesale`.

### 3. Lock down Actions (the repository is public)

A self-hosted runner on a public repo must never run code from strangers' pull requests.

- GitHub → Settings → Actions → General → *Approval for running fork pull request workflows*: choose **Require approval for all external contributors**.
- Keep `pull_request` / `pull_request_target` triggers out of any workflow whose jobs use `runs-on: [self-hosted, ...]`.
- Optional: Settings → Environments → **production** → Deployment branches → *Selected branches* → `main`. The environment is created by the first deploy.

### 4. Switch the live IIS proxy to `localhost` (manual, one time)

The deploy never overwrites the live `C:\WebApps\GigaGarageSale\web.config`, so edit it once by hand. Do this **after** the first deploy that includes the localhost/dual-stack Node binding, so Node already answers on both `::1` and the IPv4 loopback. Change the rewrite target to:

```xml
<action type="Rewrite" url="http://localhost:3106/{R:1}" />
```

IIS picks up `web.config` changes automatically. Then check that https://gigagaragesale.socha3.com/api/health responds.

## First deploy

The app code that serves `/api/health` and the built UI arrives on `main` with PR #3 (`mobile-friendly`). Until that is merged, runs on `main` build and then skip the deploy with a warning.

1. Finish the server setup above and confirm the runner shows as Idle.
2. Merge PR #3, then this workflow's PR, in either order. Each merge starts the **Deploy** workflow.
3. Or start it by hand: GitHub → **Actions → Deploy → Run workflow → Branch: main**. From a terminal:

   ```bash
   gh workflow run deploy.yml --ref main
   gh run watch
   ```

If the runner is offline, the deploy job waits in the queue (for up to 24 hours) and starts as soon as the runner comes online.

After a deploy, `C:\WebApps\GigaGarageSale\DEPLOYED_COMMIT` contains the commit SHA that is live.

## Rolling back

- A failed deploy rolls itself back automatically and the run is marked failed.
- To go back to an earlier version later, revert the PR on GitHub and merge the revert; that deploys the previous code.
- Manual restore from a backup:

  ```powershell
  $b = "C:\WebApps\_deploy-backups\GigaGarageSale\<timestamp>"
  Stop-Service GigaGarageSaleNode
  foreach ($d in "api\src","api\public","api\node_modules","shared","scripts","ui\src","ui\public") {
    robocopy "$b\$d" "C:\WebApps\GigaGarageSale\$d" /MIR
  }
  Start-Service GigaGarageSaleNode
  Invoke-WebRequest http://localhost:3106/api/health -UseBasicParsing
  ```

## Troubleshooting

- **Deploy job stuck on "Waiting for a runner"**: the runner service is stopped, or its labels don't include `gigagaragesale`.
- **Access denied** on robocopy, npm or the service: recheck the `icacls` and `sc.exe sdset` steps for the runner account.
- **"Port 3106 is still in use"**: a stray `node.exe` is holding the port. Find it with `Get-NetTCPConnection -LocalPort 3106 -State Listen` and stop it, then re-run the deploy.
- **Logs**: the Actions run log, the WinSW service logs, and `C:\actions-runner-gigagaragesale\_diag` for the runner itself.
