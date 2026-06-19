# EmberOS deploy helper (PowerShell)
# Usage:
#   .\scripts\deploy.ps1              # local prod smoke (web only)
#   .\scripts\deploy.ps1 -Target vercel
#   .\scripts\deploy.ps1 -Target railway
#   .\scripts\deploy.ps1 -Target all
#   .\scripts\deploy.ps1 -SetupDb       # push schema + marketing_os SQL

param(
    [ValidateSet("local", "vercel", "railway", "all")]
    [string]$Target = "local",
    [switch]$SetupDb,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Require-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Missing command: $name. Install it first (see README deploy section)."
    }
}

function Sync-EnvFiles {
    Write-Step "Sync env files"
    $src = Join-Path $Root ".env.local"
    if (-not (Test-Path $src)) {
        throw ".env.local not found. Copy .env.example to .env.local and fill secrets."
    }
    Copy-Item $src (Join-Path $Root "apps\web\.env.local") -Force
    Copy-Item $src (Join-Path $Root "apps\worker\.env") -Force
    Write-Host "Copied .env.local -> apps/web/.env.local, apps/worker/.env"
}

function Test-Build {
    if ($SkipBuild) { return }
    Write-Step "Production build (web)"
    pnpm --filter @ceo-agent/web build
    if ($LASTEXITCODE -ne 0) { throw "Web build failed" }
}

function Invoke-SetupDb {
    Write-Step "Database setup"
    Sync-EnvFiles
    pnpm db:marketing-os
    if ($LASTEXITCODE -ne 0) { throw "db:marketing-os failed" }
    Write-Host "Note: db:push may fail on drizzle-kit CHECK bug — use marketing-os SQL + Supabase SQL Editor for rls.sql" -ForegroundColor Yellow
    Write-Host "Run packages/db/sql/rls.sql once in Supabase SQL Editor if not done yet."
}

function Get-EnvForDeploy {
    Sync-EnvFiles
    $lines = Get-Content (Join-Path $Root ".env.local") | Where-Object {
        $_ -match '^\s*[^#]' -and $_ -match '='
    }
    $map = @{}
    foreach ($line in $lines) {
        $idx = $line.IndexOf('=')
        if ($idx -lt 1) { continue }
        $k = $line.Substring(0, $idx).Trim()
        $v = $line.Substring($idx + 1).Trim()
        if ($v -match '^"(.*)"$') { $v = $Matches[1] }
        $map[$k] = $v
    }
    return $map
}

function Deploy-Vercel {
    Write-Step "Deploy Web to Vercel"
    Require-Command "pnpm"
    $envMap = Get-EnvForDeploy

    # npx avoids global install
    npx --yes vercel@latest whoami 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Not logged in. Run: npx vercel login" -ForegroundColor Yellow
        npx --yes vercel@latest login
    }

    Test-Build

    Push-Location (Join-Path $Root "apps\web")
    try {
        # First time: creates project linked to apps/web
        npx --yes vercel@latest deploy --prod
        if ($LASTEXITCODE -ne 0) { throw "Vercel deploy failed" }

        Write-Host "`nSet these in Vercel Project -> Settings -> Environment Variables:" -ForegroundColor Yellow
        @(
            "NEXT_PUBLIC_APP_URL",
            "NEXT_PUBLIC_SUPABASE_URL",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "DATABASE_URL",
            "REDIS_URL",
            "OPENAI_API_KEY",
            "SUPABASE_STORAGE_BUCKET",
            "LLM_BUDGET_PER_TASK_USD",
            "CEO_MAX_RETRIES"
        ) | ForEach-Object { Write-Host "  - $_" }

        if ($envMap["NEXT_PUBLIC_APP_URL"]) {
            Write-Host "`nAfter first deploy, set NEXT_PUBLIC_APP_URL to your Vercel URL and redeploy." -ForegroundColor Yellow
        }
    }
    finally {
        Pop-Location
    }
}

function Deploy-Railway {
    Write-Step "Deploy Worker to Railway"
    Require-Command "pnpm"

    npx --yes @railway/cli@latest whoami 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Not logged in. Run: npx @railway/cli login" -ForegroundColor Yellow
        npx --yes @railway/cli@latest login
    }

    $envMap = Get-EnvForDeploy

    Push-Location $Root
    try {
        if (-not (Test-Path (Join-Path $Root ".railway"))) {
            Write-Host "Link project (first time): npx @railway/cli init" -ForegroundColor Yellow
            npx --yes @railway/cli@latest init
        }

        npx --yes @railway/cli@latest up --detach
        if ($LASTEXITCODE -ne 0) { throw "Railway deploy failed" }

        Write-Host "`nSet Worker env in Railway dashboard (same as .env.local):" -ForegroundColor Yellow
        @(
            "DATABASE_URL",
            "REDIS_URL",
            "OPENAI_API_KEY",
            "NEXT_PUBLIC_SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_STORAGE_BUCKET",
            "FFMPEG_PATH=/usr/bin/ffmpeg",
            "WORKER_CONCURRENCY=2",
            "LLM_BUDGET_PER_TASK_USD",
            "CEO_MAX_RETRIES"
        ) | ForEach-Object { Write-Host "  - $_" }
    }
    finally {
        Pop-Location
    }
}

function Start-LocalProd {
    Write-Step "Local production smoke"
    Sync-EnvFiles
    Test-Build

    Write-Host @"

Start two terminals:

  Terminal 1 (Web):
    cd `"$Root`"
    pnpm --filter @ceo-agent/web start

  Terminal 2 (Worker):
    cd `"$Root`"
    pnpm worker:dev

Then open http://localhost:3000

"@ -ForegroundColor Green
}

if ($SetupDb) {
    Invoke-SetupDb
    if ($Target -eq "local") { exit 0 }
}

switch ($Target) {
    "local"   { Start-LocalProd }
    "vercel"  { Deploy-Vercel }
    "railway" { Deploy-Railway }
    "all"     {
        Deploy-Vercel
        Deploy-Railway
    }
}

Write-Step "Done"
