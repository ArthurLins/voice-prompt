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
Write-Host 'Preparando Whisper.cpp v1.9.2 para Windows x64 (CPU, sem CUDA)...'
Get-VerifiedFile 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.2/LICENSE' (Join-Path $runtimePath 'LICENSE-whisper.cpp') '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d'
Get-VerifiedFile 'https://raw.githubusercontent.com/openai/whisper/main/LICENSE' (Join-Path $runtimePath 'LICENSE-whisper') 'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d'
$archivePath = Join-Path $runtimePath 'whisper-bin-x64.zip'
Get-VerifiedFile 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip' $archivePath '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a'
$unpackPath = Join-Path $runtimePath 'unpacked'
Expand-Archive -LiteralPath $archivePath -DestinationPath $unpackPath -Force
$server = Get-ChildItem -LiteralPath $unpackPath -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1
if (-not $server) { throw 'whisper-server.exe nao encontrado no pacote oficial.' }
Get-ChildItem -LiteralPath $server.DirectoryName -File | Where-Object { $_.Extension -in '.dll', '.exe' } | Copy-Item -Destination $runtimePath -Force
if ($RuntimeOnly) { Write-Host 'Speech runtime ready (models downloaded by the app).'; return }
Write-Host "Baixando modelo $Model. O primeiro download pode levar alguns minutos..."
$modelFile = "ggml-$Model.bin"
Get-VerifiedFile "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelFile" (Join-Path $runtimePath $modelFile) $models[$Model]
@{ file = $modelFile; sha256 = $models[$Model]; runtime = 'whisper.cpp v1.9.2'; backend = 'cpu' } | ConvertTo-Json | Set-Content -Encoding ascii -LiteralPath (Join-Path $runtimePath 'model.json')
Write-Host 'Voz local pronta. Inicie com npm run desktop ou gere o instalador com npm run package.'
