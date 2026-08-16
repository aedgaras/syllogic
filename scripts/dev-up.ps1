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
$ComposeArgs = @()
if (Test-Path $EnvFile) {
    $ComposeArgs += @("--env-file", $EnvFile)
}

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
Write-Host ""
Write-Host "Logs: docker compose -f docker-compose.yml logs -f frontend backend" -ForegroundColor Cyan
