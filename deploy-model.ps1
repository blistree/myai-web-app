# Deploy Modelfile to Private Model Server on Google Cloud VM
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  MYAi: Deploying Modelfile to Sovereign VM Server" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$ModelfilePath = Join-Path $PSScriptRoot "Modelfile"
if (-not (Test-Path $ModelfilePath)) {
    Write-Error "Modelfile not found at $ModelfilePath"
    exit 1
}

Write-Host "[1/3] Reading local Modelfile..." -ForegroundColor Yellow
$content = Get-Content -Path $ModelfilePath -Raw -Encoding UTF8
$base64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($content))

Write-Host "[2/3] Uploading and compiling 'myai-sovereign' on Mumbai VM..." -ForegroundColor Yellow
gcloud compute ssh myai-model-server --zone=asia-south1-c --project=ai-projects-ca4cf --command="echo $base64 | base64 -d > /tmp/Modelfile && ollama create myai-sovereign -f /tmp/Modelfile"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to compile model on VM."
    exit 1
}

Write-Host "[3/3] Pre-warming and pinning 'myai-sovereign' in RAM..." -ForegroundColor Yellow
$warmupBody = @{
    model = "myai-sovereign"
    keep_alive = -1
} | ConvertTo-Json

try {
    $res = Invoke-RestMethod -Uri "http://34.93.230.99:11434/api/generate" -Method Post -Body $warmupBody -ContentType "application/json"
    Write-Host "`nSUCCESS: Modelfile deployed! 'myai-sovereign' is active and pinned in RAM." -ForegroundColor Green
} catch {
    Write-Warning "Model compiled, but warm-up ping returned: $_"
}
