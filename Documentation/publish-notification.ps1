param(
    [Parameter(Mandatory=$true)][string]$Phase,
    [Parameter(Mandatory=$true)][string]$Title,
    [Parameter(Mandatory=$true)][string]$Description
)

if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Error "Defina `$env:SUPABASE_SERVICE_ROLE_KEY antes de rodar este script (Supabase Dashboard -> Settings -> API -> service_role key)."
    exit 1
}

$body = @{ phase_label = $Phase; title = $Title; description = $Description } | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://klimkamnydfnzqetqlqm.supabase.co/rest/v1/app_notifications" `
  -Method POST `
  -Headers @{
      "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
      "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
      "Content-Type"  = "application/json"
      "Prefer"        = "return=representation"
  } `
  -Body $body
