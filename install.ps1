<#
.SYNOPSIS
    Pixl WebUI installer (Windows).

.DESCRIPTION
    Detects the GPU vendor and installs the matching PyTorch build, then installs
    the Python backend and the Node.js frontend dependencies.

      NVIDIA -> PyTorch CUDA wheels
      AMD    -> ROCm PyTorch via the fetched rocm-torch-windows module (pinned)
      other  -> CPU-only PyTorch

    Python 3.10-3.13 is used from PATH / the py launcher if present; otherwise a
    pinned project-local CPython (python-build-standalone) is fetched into .python\
    so the system Python is never changed. Node.js is checked and installed
    automatically (winget) if missing or too old.

.PARAMETER Force
    Rebuild the Python virtual environment from scratch.
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$venv = Join-Path $root ".venv"
$venvPython = Join-Path $venv "Scripts\python.exe"

$MinNodeMajor = 18
$CudaIndex = "https://download.pytorch.org/whl/cu124"
$CpuIndex = "https://download.pytorch.org/whl/cpu"

# The AMD/ROCm install is delegated to the rocm-torch-windows PowerShell module,
# fetched from GitHub at a PINNED commit (below). This keeps the GPU->gfx map and
# the ROCm wheel index in one upstream place instead of duplicating them here.
$RocmModuleRepo = "Seismoforg/rocm-torch-windows"
$RocmModuleRef = "20a28c717ceccfdc9bd6419faece9015215ef4d2"
$RocmModuleDir = Join-Path $root ".rocm-module"

# Project-local Python fallback: a PINNED python-build-standalone (astral) CPython
# build, fetched ONLY when no suitable system Python (3.10-3.13) is found — so a
# machine with e.g. only 3.9 installs without touching the system Python. The
# `install_only` archive extracts to `.python\python\python.exe`.
$PyStandaloneVersion = "3.12.13"
$PyStandaloneTag = "20260623"
$PyStandaloneUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/$PyStandaloneTag/cpython-$PyStandaloneVersion+$PyStandaloneTag-x86_64-pc-windows-msvc-install_only.tar.gz"
$PyDir = Join-Path $root ".python"
$PyExe = Join-Path $PyDir "python\python.exe"
# The interpreter used to create the venv — resolved by Resolve-Python.
$script:PythonExe = $null

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Info($msg) { Write-Host "    $msg" -ForegroundColor Gray }
function Write-Warn($msg) { Write-Host "    WARNING: $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# Run pip via the venv Python and STOP on failure. PowerShell does not throw on a
# native command's non-zero exit, so without this a failed pip would silently let
# the install continue into a broken state.
function Invoke-Pip {
    & $venvPython -m pip @args
    if ($LASTEXITCODE -ne 0) { Fail "pip failed (exit $LASTEXITCODE): pip $($args -join ' ')" }
}

# The installed torch version tag (e.g. 2.12.0+rocm7.15...), or $null if torch
# cannot be imported. Used to verify the GPU build survives the backend install.
function Get-TorchTag {
    $tag = & $venvPython -c "import torch; print(torch.__version__)"
    if ($LASTEXITCODE -ne 0) { return $null }
    return "$tag".Trim()
}

# --- Python -----------------------------------------------------------------
# Run a probe command and return its trimmed stdout, or $null on any failure. Native
# tools (python / py) write to stderr and exit non-zero when a runtime is missing;
# under the script's -ErrorAction Stop, PowerShell 5.1 turns that stderr into a
# TERMINATING NativeCommandError that would abort the installer. Relaxing the
# preference locally (function-scoped) + discarding stderr keeps a failed probe soft.
function Get-ProbeOutput($file, [string[]]$probeArgs) {
    $ErrorActionPreference = "SilentlyContinue"
    try {
        $out = & $file @probeArgs 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return "$out".Trim()
    }
    catch { return $null }
}

# True if $exe is a working CPython in the supported 3.10-3.13 range.
function Test-PythonVersion($exe) {
    $v = Get-ProbeOutput $exe @("-c", "import sys; print('%d.%d' % sys.version_info[:2])")
    if (-not $v) { return $false }
    $p = $v.Split(".")
    return ($p.Count -ge 2 -and [int]$p[0] -eq 3 -and [int]$p[1] -ge 10 -and [int]$p[1] -le 13)
}

# Download + extract the pinned project-local Python (once) and return its exe. The
# `install_only` tarball extracts to `.python\python\python.exe`. Uses bsdtar (`tar`,
# bundled in Windows 10 1803+) for the .tar.gz.
function Get-StandalonePython {
    if (Test-Path $PyExe) { return $PyExe }
    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
        Fail "No suitable Python found and 'tar' is unavailable to unpack a local one. Install Python 3.10-3.13 (winget install Python.Python.3.12)."
    }
    Write-Step "Fetching a project-local Python $PyStandaloneVersion (no system Python change)"
    New-Item -ItemType Directory -Force -Path $PyDir | Out-Null
    $tarball = Join-Path $PyDir "python.tar.gz"
    Write-Info "Downloading $PyStandaloneUrl"
    Invoke-WebRequest -Uri $PyStandaloneUrl -OutFile $tarball -Headers @{ "User-Agent" = "pixl-webui-installer" } -UseBasicParsing
    # bsdtar can emit harmless warnings to stderr (PAX headers); relax the preference
    # only around this native call so they don't become a terminating error under Stop.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & tar -xzf $tarball -C $PyDir 2>$null
    $tarExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($tarExit -ne 0) { Fail "Failed to unpack the local Python archive." }
    Remove-Item $tarball -Force
    if (-not (Test-Path $PyExe)) { Fail "Local Python unpack did not produce $PyExe." }
    return $PyExe
}

# Resolve the interpreter used to build the venv, into $script:PythonExe. Prefers an
# existing suitable Python (so nothing is downloaded when one is present); falls back
# to the pinned project-local build otherwise.
function Resolve-Python {
    Write-Step "Checking Python (3.10 - 3.13)"
    # 1) `python` on PATH
    $onPath = Get-Command python -ErrorAction SilentlyContinue
    if ($onPath -and (Test-PythonVersion $onPath.Source)) {
        $script:PythonExe = $onPath.Source
        Write-Info "Using system Python on PATH ($($onPath.Source))"
        return
    }
    # 2) the Windows `py` launcher, newest supported first (a missing version is a soft
    #    miss via Get-ProbeOutput, not a fatal NativeCommandError)
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in "3.13", "3.12", "3.11", "3.10") {
            $exe = Get-ProbeOutput "py" @("-$v", "-c", "import sys; print(sys.executable)")
            if ($exe -and (Test-Path $exe)) {
                $script:PythonExe = $exe
                Write-Info "Using Python $v via the py launcher"
                return
            }
        }
    }
    # 3) pinned project-local Python (system Python is missing or out of range)
    Write-Info "No suitable system Python (3.10-3.13) found; using a project-local build."
    $script:PythonExe = Get-StandalonePython
    Write-Info "Using project-local Python ($script:PythonExe)"
}

# --- Node.js ----------------------------------------------------------------
function Get-NodeMajor {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return $null }
    $raw = (& node -v).TrimStart("v")   # e.g. 20.11.1
    return [int]$raw.Split(".")[0]
}

function Install-Node {
    Write-Info "Installing Node.js LTS via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "Node.js >= $MinNodeMajor is required but winget is unavailable. Install Node.js LTS from https://nodejs.org and re-run."
    }
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    # Refresh PATH so node/npm are usable in this session.
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Get-NodeMajor)) {
        Fail "Node.js was installed but is not on PATH yet. Close and reopen the terminal, then re-run install.ps1."
    }
}

function Test-Node {
    Write-Step "Checking Node.js (>= $MinNodeMajor)"
    $major = Get-NodeMajor
    if ($null -eq $major) {
        Write-Info "Node.js not found."
        Install-Node
        $major = Get-NodeMajor
    }
    elseif ($major -lt $MinNodeMajor) {
        Write-Info "Node.js $major is too old."
        Install-Node
        $major = Get-NodeMajor
    }
    Write-Info "Node.js v$major OK"
}

# --- GPU detection ----------------------------------------------------------
function Get-GpuVendor {
    Write-Step "Detecting GPU"
    $gpus = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
    foreach ($name in $gpus) { Write-Info $name }

    $amd = $gpus | Where-Object { $_ -match "AMD|Radeon" } | Select-Object -First 1
    $nvidia = $gpus | Where-Object { $_ -match "NVIDIA" } | Select-Object -First 1

    if ($nvidia) { return @{ Vendor = "nvidia"; Name = $nvidia } }
    if ($amd) { return @{ Vendor = "amd"; Name = $amd } }
    return @{ Vendor = "cpu"; Name = ($gpus | Select-Object -First 1) }
}

# Fetch the rocm-torch-windows module (RocmVenv) from GitHub at the pinned commit
# and return the path to import. Cached under .rocm-module/ and only re-downloaded
# when the pinned ref changes. No offline fallback: the install needs network for
# the ROCm wheels regardless, so a failed fetch fails the whole install loudly.
function Get-RocmModule {
    $moduleDir = Join-Path $RocmModuleDir "RocmVenv"
    $stamp = Join-Path $RocmModuleDir ".ref"
    if ((Test-Path $moduleDir) -and (Test-Path $stamp) -and
        ((Get-Content -Raw $stamp).Trim() -eq $RocmModuleRef)) {
        return $moduleDir   # cache hit
    }

    Write-Step "Fetching rocm-torch-windows module ($RocmModuleRef)"
    $tmpZip = Join-Path ([System.IO.Path]::GetTempPath()) ("rocm-module-$RocmModuleRef.zip")
    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("rocm-module-$RocmModuleRef")
    $url = "https://codeload.github.com/$RocmModuleRepo/zip/$RocmModuleRef"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url -OutFile $tmpZip -Headers @{ "User-Agent" = "pixl-webui-installer" } -UseBasicParsing
        if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
        Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
        # The zip extracts to a single <repo>-<ref>/ folder containing RocmVenv/.
        $extracted = Get-ChildItem -Path $tmpDir -Directory | Select-Object -First 1
        $src = Join-Path $extracted.FullName "RocmVenv"
        if (-not (Test-Path $src)) { throw "RocmVenv folder not found in the downloaded archive." }
        if (Test-Path $RocmModuleDir) { Remove-Item -Recurse -Force $RocmModuleDir }
        New-Item -ItemType Directory -Path $RocmModuleDir | Out-Null
        Copy-Item -Path $src -Destination $moduleDir -Recurse
        Set-Content -Path $stamp -Value $RocmModuleRef -Encoding ASCII
    }
    catch {
        Fail ("Could not fetch the rocm-torch-windows module from GitHub ($url): " +
            "$($_.Exception.Message). Check your internet connection and re-run:  .\install.ps1")
    }
    finally {
        Remove-Item -Path $tmpZip -ErrorAction SilentlyContinue
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Info "Module ready at $moduleDir"
    return $moduleDir
}

# --- Virtual environment ----------------------------------------------------

# Best-effort: stop any process running from inside the venv (e.g. a still-running
# backend/uvicorn) so its loaded .pyd/.dll files unlock and the venv can be removed.
function Stop-VenvProcesses {
    $prefix = $venv + [System.IO.Path]::DirectorySeparatorChar
    try {
        Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } |
            ForEach-Object {
                Write-Info "Stopping process using the venv: $($_.Name) (PID $($_.ProcessId))"
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
        Start-Sleep -Milliseconds 500
    }
    catch { Write-Warn "Could not enumerate processes to stop ($($_.Exception.Message))." }
}

# Remove the venv robustly: a running server locks .pyd/.dll files, and a plain
# recursive delete would abort part-way and leave a broken venv. So we stop venv
# processes first and retry a few times before failing with a clear instruction.
function Remove-Venv {
    if (-not (Test-Path $venv)) { return }
    Write-Info "Removing existing .venv (-Force)"
    Stop-VenvProcesses
    for ($i = 1; $i -le 3; $i++) {
        try {
            Remove-Item -Recurse -Force $venv -ErrorAction Stop
            return
        }
        catch {
            if ($i -eq 3) {
                Fail ("Could not remove .venv - a program is still using it. Close the running app " +
                    "(the 'Pixl Backend' / 'Pixl Frontend' windows, or any python.exe from this .venv), " +
                    "then re-run:  .\install.ps1 -Force")
            }
            Write-Info "  .venv is locked, retrying ($i/3)..."
            Start-Sleep -Seconds 1
        }
    }
}

function New-Venv {
    Write-Step "Creating Python virtual environment"
    if (Test-Path $venv) {
        if ($Force) {
            Remove-Venv
        }
        else {
            Write-Info ".venv already exists (use -Force to rebuild)"
        }
    }
    if (-not (Test-Path $venv)) { & $script:PythonExe -m venv $venv }
    if (-not (Test-Path $venvPython)) { Fail "Virtual environment creation failed ($venvPython missing)." }
    Invoke-Pip install --upgrade pip --quiet
}

# --- PyTorch ----------------------------------------------------------------
function Install-Torch($gpu) {
    Write-Step "Installing PyTorch for '$($gpu.Vendor)'"
    switch ($gpu.Vendor) {
        "nvidia" {
            Invoke-Pip install torch torchvision --index-url $CudaIndex
        }
        "amd" {
            # Delegate to the rocm-torch-windows module: it detects the gfx target
            # (data-driven map), installs rocm + torch + torchvision + torchaudio from
            # TheRock index, and verifies GPU visibility. It reuses the venv we already
            # created (New-Venv). torchvision comes from the SAME ROCm index so the later
            # backend install finds it satisfied and does NOT pull a mismatched CPU/CUDA
            # torchvision from PyPI (required by spandrel, the Real-ESRGAN upscaler).
            # bitsandbytes IS installed (no -SkipBitsAndBytes): the module matches a
            # community ROCm/Windows wheel to (rocm major.minor, gfx arch, py) and enables
            # on-the-fly NF4/int8 quantization (FLUX + LoRAs in ~16 GB). No matching wheel
            # -> the module warns and continues; the feature degrades to fp16-only.
            $mod = Get-RocmModule
            Import-Module $mod -Force
            Write-Info "Delegating ROCm/PyTorch (+ bitsandbytes) install to rocm-torch-windows"
            try {
                Initialize-RocmVenv -VenvPath $venv | Out-Null
            }
            catch {
                Write-Warn ("ROCm bitsandbytes install failed ($($_.Exception.Message)); " +
                    "retrying without it - quantization will fall back to fp16-only.")
                Initialize-RocmVenv -VenvPath $venv -SkipBitsAndBytes | Out-Null
            }
        }
        default {
            Write-Info "No supported GPU detected - installing CPU-only PyTorch (slow)."
            Invoke-Pip install torch torchvision --index-url $CpuIndex
        }
    }

    # Verify torch actually imports, and that a GPU build was installed when a GPU
    # was detected — so we fail loudly here rather than later. (Note: no `return`
    # here — pip's stdout would otherwise be captured by the caller; the tag is
    # read separately via Get-TorchTag.)
    $tag = Get-TorchTag
    if (-not $tag) { Fail "PyTorch failed to import after installation." }
    Write-Info "PyTorch $tag"
    if ($gpu.Vendor -eq "amd" -and $tag -notmatch "rocm") {
        Write-Warn "Expected a ROCm build but got '$tag'. The GPU may not be usable."
    }
    elseif ($gpu.Vendor -eq "nvidia" -and $tag -notmatch "cu\d") {
        Write-Warn "Expected a CUDA build but got '$tag'. The GPU may not be usable."
    }
}

# --- bitsandbytes (on-the-fly NF4/int8 quantization) ------------------------
# AMD/ROCm bnb is handled by the rocm-torch-windows module (above). CUDA gets the
# stock PyPI wheel; CPU has no benefit, so it's skipped. Best-effort everywhere: a
# failure warns and continues, and the backend degrades to fp16-only (the quant path
# is guarded by services.quantize.available()).
function Install-Quantization($gpu) {
    if ($gpu.Vendor -eq "nvidia") {
        Write-Step "Installing bitsandbytes (CUDA quantization)"
        Invoke-Pip install bitsandbytes
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "bitsandbytes install failed - NF4/int8 quantization will be unavailable (fp16-only)."
        }
    }
    elseif ($gpu.Vendor -ne "amd") {
        Write-Info "No GPU - skipping bitsandbytes (quantization has no CPU benefit)."
    }
}

# --- Dependencies -----------------------------------------------------------
function Test-Import($module) {
    & $venvPython -c "import $module"
    return ($LASTEXITCODE -eq 0)
}

function Install-Backend {
    Write-Step "Installing backend dependencies"
    # only-if-needed keeps pip from upgrading already-satisfied packages (torch/
    # torchvision), so the GPU build installed above is left untouched where possible.
    Invoke-Pip install --upgrade-strategy only-if-needed -e (Join-Path $root "backend")
}

function Install-Frontend {
    Write-Step "Installing frontend dependencies (npm install)"
    Push-Location (Join-Path $root "frontend")
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { Fail "npm install failed (exit $LASTEXITCODE)." }
    }
    finally { Pop-Location }
}

# --- Run --------------------------------------------------------------------
Resolve-Python
Test-Node
$gpu = Get-GpuVendor
New-Venv
Install-Torch $gpu
Install-Quantization $gpu
$torchTag = Get-TorchTag
Install-Backend

# Failsafe: installing the backend (which requires torchvision via spandrel) must
# not have swapped out the GPU torch/torchvision for a mismatched PyPI build. If it
# did, restore the correct build from the vendor index and re-verify.
Write-Step "Verifying the PyTorch install survived the backend install"
$after = Get-TorchTag
$tvOk = Test-Import "torchvision"
if ($after -ne $torchTag -or -not $tvOk) {
    Write-Warn "torch/torchvision changed during the backend install; restoring the GPU build."
    Install-Torch $gpu | Out-Null
    $after = Get-TorchTag
    $tvOk = Test-Import "torchvision"
    if ($after -ne $torchTag -or -not $tvOk) {
        Fail "Could not restore a working torch/torchvision. Re-run:  .\install.ps1 -Force"
    }
}
if (-not (Test-Import "spandrel")) {
    Fail "spandrel failed to import (Real-ESRGAN upscaler). Re-run:  .\install.ps1 -Force"
}
Write-Info "torch/torchvision/spandrel OK ($after)"

Install-Frontend

Write-Host "`nInstallation complete." -ForegroundColor Green
Write-Host "Start the app with:  .\start.bat" -ForegroundColor Green
