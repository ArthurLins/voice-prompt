# Build-only tooling. Installed users need only a Vulkan-capable graphics driver.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
# Keep MSVC's nested shader build paths below the Windows path limit.
$work = Join-Path ([System.IO.Path]::GetTempPath()) 'vp-vk19'
New-Item -ItemType Directory -Force -Path $work | Out-Null
function Download-Verified([string]$Url, [string]$Path, [string]$Sha) {
    if ((Test-Path -LiteralPath $Path) -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Sha) { return }
    & curl.exe --fail --location --retry 3 --silent --show-error --output "$Path.partial" $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    if ((Get-FileHash -LiteralPath "$Path.partial" -Algorithm SHA256).Hash -ne $Sha) { throw 'Download checksum mismatch.' }
    Move-Item -LiteralPath "$Path.partial" -Destination $Path -Force
}
if (-not $env:VULKAN_SDK -or -not (Test-Path -LiteralPath (Join-Path $env:VULKAN_SDK 'Bin/glslc.exe'))) {
    $sdk = Join-Path $work 'sdk.exe'
    Download-Verified 'https://sdk.lunarg.com/sdk/download/1.4.357.0/windows/vulkansdk-windows-X64-1.4.357.0.exe' $sdk '81f474711e9042f4cd22b31b2f7a8870db2e428b21586fb43dd80150be97310d'
    $sdkRoot = Join-Path $work 'sdk'
    if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'Bin/glslc.exe'))) {
        # LunarG copy_only mode avoids registry, global PATH and layer changes.
        $process = Start-Process -FilePath $sdk -ArgumentList @('--root', ('"' + $sdkRoot + '"'), '--accept-licenses', '--default-answer', '--confirm-command', 'install', 'copy_only=1') -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw 'Could not extract the Vulkan SDK.' }
    }
    $env:VULKAN_SDK = $sdkRoot
}
$commit = '306c88f4d1286aec1bf96e544632897886af5501' # whisper.cpp v1.9.2
$archive = Join-Path $work 'source.zip'
Download-Verified "https://github.com/ggml-org/whisper.cpp/archive/$commit.zip" $archive '0f4b46f1ae9e26666139bfc15b61a3e77b43809da89e0072969144801c05db36'
$source = Join-Path $work "whisper.cpp-$commit"
if (-not (Test-Path -LiteralPath (Join-Path $source 'CMakeLists.txt'))) {
    Expand-Archive -LiteralPath $archive -DestinationPath $work -Force
}
$build = Join-Path $work 'b'
& cmake -S $source -B $build -A x64 -DGGML_VULKAN=ON -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_CURL=OFF
if ($LASTEXITCODE -ne 0) { throw 'Vulkan CMake configuration failed.' }
& cmake --build $build --config Release --target whisper-server --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'Vulkan Whisper build failed.' }
$runtime = Join-Path $projectRoot 'src-tauri/runtime/vulkan'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'bin/Release/whisper-server.exe') -Destination (Join-Path $runtime 'whisper-server.exe') -Force
Write-Host 'Vulkan server ready. CPU fallback remains installed separately.'
