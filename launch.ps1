Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "   KIRO-Connect: LAN Mixture-of-Agents Inference Swarm" -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Magenta

$VenvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Host "Error: Virtual environment python not found at $VenvPython" -ForegroundColor Red
    exit 1
}

# Set PYTHONPATH to project root for all subprocesses
$env:PYTHONPATH = $PSScriptRoot

# Clean up any leftover processes on swarm ports before starting
$ports = @(8000, 8081, 8082)
foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($conn in $conns) {
            $processId = $conn.OwningProcess
            if ($processId -and $processId -ne 0 -and $processId -ne $PID) {
                Write-Host "Freeing occupied port $port (PID: $processId)..." -ForegroundColor Yellow
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# Check if Microsoft C++ Linker (link.exe) is available for Tauri Rust compilation
$hasLinker = $null -ne (Get-Command "link.exe" -ErrorAction SilentlyContinue)

if (-not $hasLinker) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($vsInstall) {
            $vcvars = Join-Path $vsInstall "VC\Auxiliary\Build\vcvars64.bat"
            if (Test-Path $vcvars) {
                Write-Host "Auto-configuring MSVC C++ Build Tools environment from $vsInstall..." -ForegroundColor Cyan
                cmd /c "`"$vcvars`" && set" | ForEach-Object {
                    if ($_ -match '^(.*?)=(.*)$') {
                        Set-Item -Path "env:\$($matches[1])" -Value $matches[2] -ErrorAction SilentlyContinue
                    }
                }
                $hasLinker = $null -ne (Get-Command "link.exe" -ErrorAction SilentlyContinue)
            }
        }
    }
}

if ($hasLinker) {
    Write-Host "1. Starting Swarm Gateway & Discovery Daemon..." -ForegroundColor Cyan
    $gatewayProc = Start-Process -FilePath $VenvPython -ArgumentList "service/run_server.py", "--port", "8000" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden

    Start-Sleep -Seconds 2
    Write-Host "2. Gateway running (PID: $($gatewayProc.Id))." -ForegroundColor Green
    Write-Host "3. Booting Tauri Desktop App (Always-Dark Theme)..." -ForegroundColor Cyan

    try {
        npm run tauri dev
    } finally {
        Write-Host "`nStopping Swarm Gateway..." -ForegroundColor Yellow
        Stop-Process -Id $gatewayProc.Id -ErrorAction SilentlyContinue
        Write-Host "KIRO-Connect shutdown complete." -ForegroundColor Green
    }
} else {
    Write-Host "`n[Notice] Microsoft C++ Build Tools (link.exe) not detected for Tauri Rust compilation." -ForegroundColor Yellow
    Write-Host "Launching KIRO-Connect Native Desktop App directly via Edge WebView2 container..." -ForegroundColor Green
    Write-Host "Window: 1320x860 Always-Dark K-C Monogram Interface (port 8000)" -ForegroundColor Cyan
    
    & $VenvPython "desktop_app.py"
}

