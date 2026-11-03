# Build the private Whisper worker from verified upstream source.
param([switch]$CpuOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tempRoot = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
$previousSdk = $env:VULKAN_SDK
$work = Join-Path $tempRoot ('vp-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Path $work | Out-Null
function Download-Verified([string]$Url, [string]$Path, [string]$Sha) {
    & curl.exe --fail --location --retry 3 --silent --show-error --output $Path $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha) { throw 'Download checksum mismatch.' }
}
try {
    if (-not $CpuOnly -and (-not $env:VULKAN_SDK -or -not (Test-Path -LiteralPath (Join-Path $env:VULKAN_SDK 'Bin/glslc.exe')))) {
        $sdk = Join-Path $work 'sdk.exe'
        Download-Verified 'https://sdk.lunarg.com/sdk/download/1.4.357.0/windows/vulkansdk-windows-X64-1.4.357.0.exe' $sdk '81f474711e9042f4cd22b31b2f7a8870db2e428b21586fb43dd80150be97310d'
        $sdkRoot = Join-Path $work 'sdk'
        $process = Start-Process -FilePath $sdk -ArgumentList @('--root', ('"' + $sdkRoot + '"'), '--accept-licenses', '--default-answer', '--confirm-command', 'install', 'copy_only=1') -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw 'Could not extract the Vulkan SDK.' }
        $env:VULKAN_SDK = $sdkRoot
    }
    $commit = '60c0be6ac8fa71b1a2ae2dd938a31a34a508e774'
    $archive = Join-Path $work 'source.zip'
    Download-Verified "https://github.com/ggml-org/whisper.cpp/archive/$commit.zip" $archive '67a50b1aa5514745bcbbe49a94c1a554269fd85b8ec5cfda4137f5680513041c'
    Expand-Archive -LiteralPath $archive -DestinationPath $work
    $source = Join-Path $work "whisper.cpp-$commit"
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'whisper-worker.cpp') -Destination (Join-Path $source 'examples/server/server.cpp') -Force
    $build = Join-Path $work 'b'
    $vulkan = if ($CpuOnly) { 'OFF' } else { 'ON' }
    & cmake -S $source -B $build -A x64 "-DGGML_VULKAN=$vulkan" -DGGML_NATIVE=OFF -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_BMI2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_CURL=OFF
    if ($LASTEXITCODE -ne 0) { throw 'Whisper CMake configuration failed.' }
    & cmake --build $build --config Release --target whisper-server --parallel 4
    if ($LASTEXITCODE -ne 0) { throw 'Whisper worker build failed.' }
    $runtime = Join-Path $projectRoot 'src-tauri/runtime'
    $worker = if ($CpuOnly) { 'voice-prompt-whisper.exe' } else { 'voice-prompt-whisper-vulkan.exe' }
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    Copy-Item -LiteralPath (Join-Path $build 'bin/Release/whisper-server.exe') -Destination (Join-Path $runtime $worker) -Force
    Copy-Item -LiteralPath (Join-Path $source 'LICENSE') -Destination (Join-Path $runtime 'LICENSE-whisper.cpp') -Force
} finally {
    $env:VULKAN_SDK = $previousSdk
    $resolved = (Resolve-Path -LiteralPath $work -ErrorAction SilentlyContinue).Path
    if ($resolved -eq $work -and (Split-Path -Parent $resolved) -eq $tempRoot) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
