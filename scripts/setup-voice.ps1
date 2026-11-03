param([ValidateSet('small', 'large-v3-turbo-q5_0')][string]$Model = 'small', [switch]$RuntimeOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot 'src-tauri/runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$models = @{
  'small' = '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
  'large-v3-turbo-q5_0' = '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
}
function Get-VerifiedFile([string]$Url, [string]$Destination, [string]$Hash) {
  if ((Test-Path -LiteralPath $Destination) -and ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Hash)) { return }
  $partial = "$Destination.partial"
  & curl.exe --fail --location --retry 3 --silent --show-error --output $partial $Url
  if ($LASTEXITCODE -ne 0) { throw "Download falhou: $Url. Execute novamente para tentar de novo." }
  if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $Hash) { throw "SHA256 incorreto: $Destination. O arquivo nao sera usado." }
  Move-Item -LiteralPath $partial -Destination $Destination -Force
}
& (Join-Path $PSScriptRoot 'build-vulkan.ps1') -CpuOnly
Get-VerifiedFile 'https://raw.githubusercontent.com/openai/whisper/main/LICENSE' (Join-Path $runtimePath 'LICENSE-whisper') 'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d'
if ($RuntimeOnly) { Write-Host 'Speech runtime ready (models downloaded by the app).'; return }
Write-Host "Baixando modelo $Model. O primeiro download pode levar alguns minutos..."
$modelFile = "ggml-$Model.bin"
Get-VerifiedFile "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelFile" (Join-Path $runtimePath $modelFile) $models[$Model]
@{ file = $modelFile; sha256 = $models[$Model]; runtime = 'Voice Prompt Whisper worker'; backend = 'cpu' } | ConvertTo-Json | Set-Content -Encoding ascii -LiteralPath (Join-Path $runtimePath 'model.json')
Write-Host 'Voz local pronta. Inicie com npm run desktop ou gere o instalador com npm run package.'
