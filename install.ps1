<#
.SYNOPSIS
    Pixl WebUI installer (Windows).

.DESCRIPTION
    Detects the GPU vendor and installs the matching PyTorch build, then installs
    the Python backend and the Node.js frontend dependencies.

      NVIDIA -> PyTorch CUDA wheels
      AMD    -> ROCm PyTorch via the rocm-torch-windows multi-arch index
      other  -> CPU-only PyTorch

    Node.js is checked and installed automatically (winget) if missing or too old.

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
$RocmIndex = "https://rocm.nightlies.amd.com/whl-multi-arch/"

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
function Test-Python {
    Write-Step "Checking Python (3.10 - 3.13)"
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { Fail "Python not found on PATH. Install Python 3.10-3.13 (winget install Python.Python.3.12)." }
    $version = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
    $parts = $version.Split(".")
    if ([int]$parts[0] -ne 3 -or [int]$parts[1] -lt 10 -or [int]$parts[1] -gt 13) {
        Fail "Python $version is not supported. Need 3.10 - 3.13."
    }
    Write-Info "Python $version OK"
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

# Map an AMD GPU name to a rocm-torch-windows gfx architecture.
function Get-GfxArch($name) {
    switch -Regex ($name) {
        "RX\s*90[7-9]0" { return "gfx1201" }
        "RX\s*90[0-6]0" { return "gfx1200" }
        "RX\s*7900"     { return "gfx1100" }
        "RX\s*7[78]00"  { return "gfx1101" }
        "RX\s*7600"     { return "gfx1102" }
        "RX\s*6\d{3}"   { return "gfx1030" }
        default          { return $null }
    }
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
    if (-not (Test-Path $venv)) { & python -m venv $venv }
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
            $gfx = Get-GfxArch $gpu.Name
            if (-not $gfx) { Fail "Could not map AMD GPU '$($gpu.Name)' to a gfx architecture. See rocm-torch-windows for supported cards." }
            Write-Info "Using ROCm multi-arch build for $gfx (rocm-torch-windows)"
            # torchvision from the SAME ROCm index (matches the torch ABI). It must be
            # installed here so the later backend install finds it already satisfied and
            # does NOT pull a mismatched CPU/CUDA torchvision from PyPI (which would break
            # the ROCm torch). torchvision is required by spandrel (Real-ESRGAN upscaler).
            Invoke-Pip install --index-url $RocmIndex "rocm[libraries,device-$gfx]" "torch[device-$gfx]" "torchvision[device-$gfx]"
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
Test-Python
Test-Node
$gpu = Get-GpuVendor
New-Venv
Install-Torch $gpu
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
