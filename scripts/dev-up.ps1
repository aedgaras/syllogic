#Requires -Version 5.1
<#
.SYNOPSIS
    Start the development environment.

.DESCRIPTION
    Starts the full Docker local development stack, or pulls prebuilt images.

.PARAMETER Mode
    - local: Start the full Docker local development stack (default)
    - prebuilt: Pull GHCR images via deploy/compose

.EXAMPLE
    .\scripts\dev-up.ps1
    .\scripts\dev-up.ps1 -Mode local
    .\scripts\dev-up.ps1 -Mode prebuilt
#>

param(
    [ValidateSet("local", "prebuilt")]
    [string]$Mode = "local",
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Usage {
    Write-Host "Usage: dev-up.ps1 [-Mode local|prebuilt]"
    Write-Host ""
    Write-Host "  -Mode local     Start the full Docker local development stack (default)"
    Write-Host "  -Mode prebuilt  Pull GHCR images via deploy/compose"
    Write-Host "  -Help           Show this help message"
}

function Ensure-LocalEncryptionKey {
    param([Parameter(Mandatory = $true)][string]$Path)

    $lines = @()
    if (Test-Path $Path) {
        $lines = @(Get-Content -Path $Path)
        $configuredValue = $lines |
            Where-Object { $_ -match '^\s*DATA_ENCRYPTION_KEY_CURRENT\s*=' } |
            ForEach-Object { ($_ -split '=', 2)[1].Trim() } |
            Where-Object { $_.Length -gt 0 } |
            Select-Object -Last 1
        if ($null -ne $configuredValue) {
            return
        }
    } else {
        $parent = Split-Path -Parent $Path
        $null = New-Item -ItemType Directory -Path $parent -Force
    }

    $keyBytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($keyBytes)
    } finally {
        $generator.Dispose()
    }
    $generatedKey = -join ($keyBytes | ForEach-Object { $_.ToString("x2") })

    $updatedLines = New-Object System.Collections.Generic.List[string]
    $written = $false
    foreach ($line in $lines) {
        if ($line -match '^\s*DATA_ENCRYPTION_KEY_CURRENT\s*=') {
            if (-not $written) {
                $updatedLines.Add("DATA_ENCRYPTION_KEY_CURRENT=$generatedKey")
                $written = $true
            }
            continue
        }
        $updatedLines.Add($line)
    }
    if (-not $written) {
        $updatedLines.Add("DATA_ENCRYPTION_KEY_CURRENT=$generatedKey")
    }

    Set-Content -Path $Path -Value $updatedLines -Encoding ASCII
    Write-Host "Generated the local data-encryption key in deploy\compose\.env." -ForegroundColor Green
}

if ($Help) {
    Show-Usage
    exit 0
}

# Resolve paths
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $RootDir "deploy\compose\.env"
$ComposeFile = Join-Path $RootDir "deploy\compose\docker-compose.yml"
$LocalComposeFile = Join-Path $RootDir "docker-compose.yml"

# Check for Docker (installed and running)
try {
    $null = docker version 2>&1
} catch {
    Write-Host "Docker is not installed or not in PATH." -ForegroundColor Red
    exit 1
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker is not running. Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}

if ($Mode -eq "prebuilt") {
    # Prebuilt mode - same as prod-up
    if (-not (Test-Path $EnvFile)) {
        Write-Host "Missing $EnvFile." -ForegroundColor Red
        Write-Host "Copy deploy\compose\.env.example to deploy\compose\.env and edit it first."
        exit 1
    }

    Write-Host "Pulling prebuilt images (GHCR)..." -ForegroundColor Cyan
    docker compose --env-file $EnvFile -f $ComposeFile pull
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to pull images." -ForegroundColor Red
        exit 1
    }

    Write-Host "Starting prebuilt stack..." -ForegroundColor Cyan
    docker compose --env-file $EnvFile -f $ComposeFile up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to start stack." -ForegroundColor Red
        exit 1
    }

    Write-Host "Done." -ForegroundColor Green
    exit 0
}

# Local mode - uses development defaults from docker-compose.yml
Ensure-LocalEncryptionKey -Path $EnvFile
$ComposeArgs = @("--env-file", $EnvFile)

Write-Host "Starting local development stack..." -ForegroundColor Cyan
docker compose @ComposeArgs -f $LocalComposeFile up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start local development stack." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Open http://localhost:3000" -ForegroundColor Gray
Write-Host "Backend API: http://localhost:8000" -ForegroundColor Gray
Write-Host "Add your OpenAI API key in Settings > Preferences when you need AI categorization." -ForegroundColor Gray
Write-Host ""
Write-Host "Logs: docker compose -f docker-compose.yml logs -f frontend backend" -ForegroundColor Cyan
