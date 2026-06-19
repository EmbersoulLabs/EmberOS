# Sync .env.local -> Vercel production env (non-interactive)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $Root ".env.local"
if (-not (Test-Path $envFile)) { throw ".env.local not found" }

Push-Location (Join-Path $Root "apps\web")
try {
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
  $map = @{}
  Get-Content $envFile | Where-Object { $_ -match '^\s*[^#]' -and $_ -match '=' } | ForEach-Object {
    $i = $_.IndexOf('=')
    $k = $_.Substring(0, $i).Trim()
    $v = $_.Substring($i + 1).Trim()
    if ($v -match '^"(.*)"$') { $v = $Matches[1] }
    $map[$k] = $v
  }
  foreach ($k in $keys) {
    if (-not $map.ContainsKey($k)) { continue }
    $v = $map[$k]
    Write-Host "Setting $k ..."
    npx.cmd vercel env add $k production --value $v --force --yes 2>&1 | Out-Null
  }
  Write-Host "Done. Redeploy: npx vercel deploy --prod --yes"
}
finally {
  Pop-Location
}
