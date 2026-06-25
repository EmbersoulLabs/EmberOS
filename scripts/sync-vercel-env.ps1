# Sync .env.local -> Vercel production env
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $Root ".env.local"
if (-not (Test-Path $envFile)) { throw ".env.local not found" }

$map = @{}
Get-Content $envFile | Where-Object { $_ -match '^\s*[^#]' -and $_ -match '=' } | ForEach-Object {
  $i = $_.IndexOf('=')
  $k = $_.Substring(0, $i).Trim()
  $v = $_.Substring($i + 1).Trim()
  if ($v -match '^"(.*)"$') { $v = $Matches[1] }
  $map[$k] = $v
}

# Production app URL (not localhost)
$map["NEXT_PUBLIC_APP_URL"] = "https://emberos-kahliantoo-8279s-projects.vercel.app"

$keys = @(
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
)

Push-Location (Join-Path $Root "apps\web")
try {
  foreach ($k in $keys) {
    if (-not $map.ContainsKey($k)) { Write-Host "skip: $k (missing)"; continue }
    Write-Host "set: $k"
    npx.cmd vercel env add $k production --value $map[$k] --force --yes 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to set $k" }
  }
  Write-Host "Done."
}
finally {
  Pop-Location
}
