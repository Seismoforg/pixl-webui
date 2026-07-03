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
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

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
function New-Venv {
    Write-Step "Creating Python virtual environment"
    if (Test-Path $venv) {
        if ($Force) {
            Write-Info "Removing existing .venv (-Force)"
            Remove-Item -Recurse -Force $venv
        }
        else {
            Write-Info ".venv already exists (use -Force to rebuild)"
        }
    }
    if (-not (Test-Path $venv)) { & python -m venv $venv }
    & $venvPython -m pip install --upgrade pip --quiet
}

# --- PyTorch ----------------------------------------------------------------
function Install-Torch($gpu) {
    Write-Step "Installing PyTorch for '$($gpu.Vendor)'"
    switch ($gpu.Vendor) {
        "nvidia" {
            & $venvPython -m pip install torch torchvision --index-url $CudaIndex
        }
        "amd" {
            $gfx = Get-GfxArch $gpu.Name
            if (-not $gfx) { Fail "Could not map AMD GPU '$($gpu.Name)' to a gfx architecture. See rocm-torch-windows for supported cards." }
            Write-Info "Using ROCm multi-arch build for $gfx (rocm-torch-windows)"
            & $venvPython -m pip install --index-url $RocmIndex "rocm[libraries,device-$gfx]" "torch[device-$gfx]"
        }
        default {
            Write-Info "No supported GPU detected - installing CPU-only PyTorch (slow)."
            & $venvPython -m pip install torch torchvision --index-url $CpuIndex
        }
    }
}

# --- Dependencies -----------------------------------------------------------
function Install-Backend {
    Write-Step "Installing backend dependencies"
    & $venvPython -m pip install -e (Join-Path $root "backend")
}

function Install-Frontend {
    Write-Step "Installing frontend dependencies (npm install)"
    Push-Location (Join-Path $root "frontend")
    try { & npm install }
    finally { Pop-Location }
}

# --- Run --------------------------------------------------------------------
Test-Python
Test-Node
$gpu = Get-GpuVendor
New-Venv
Install-Torch $gpu
Install-Backend
Install-Frontend

Write-Host "`nInstallation complete." -ForegroundColor Green
Write-Host "Start the app with:  .\start.bat" -ForegroundColor Green
