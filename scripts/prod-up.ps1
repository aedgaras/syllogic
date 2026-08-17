#Requires -Version 5.1
<#
.SYNOPSIS
    Start the production stack using prebuilt or locally-built Docker images.

.DESCRIPTION
    Pulls images from GHCR by default. With -Local, builds production images
    from the current checkout and bootstraps a secure local configuration.
    Requires Docker Desktop to be running.

.EXAMPLE
    .\scripts\prod-up.ps1
#>

param(
    [switch]$Help,
    [switch]$Lite,
    [switch]$Local
)

$ErrorActionPreference = "Stop"

function Show-Usage {
    Write-Host "Usage: prod-up.ps1 [-Local] [-Lite]"
    Write-Host ""
    Write-Host "Starts the production Docker Compose stack."
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Help    Show this help message"
    Write-Host "  -Local   Build production images from the current checkout"
    Write-Host "  -Lite    Use one worker/scheduler and omit the MCP container"
}

function New-RandomHexSecret {
    $keyBytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($keyBytes)
    } finally {
        $generator.Dispose()
    }
    return (-join ($keyBytes | ForEach-Object { $_.ToString("x2") }))
}

function Ensure-Secret {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $lines = @(Get-Content -Path $Path)
    $configuredValue = $lines |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
        ForEach-Object { ($_ -split '=', 2)[1].Trim() } |
        Select-Object -Last 1
    if ($null -ne $configuredValue -and $configuredValue.Length -gt 0 -and $configuredValue -ne "change-me") {
        return
    }

    $generatedValue = New-RandomHexSecret
    $updatedLines = New-Object System.Collections.Generic.List[string]
    $written = $false
    foreach ($line in $lines) {
        if ($line -match "^\s*#?\s*$([regex]::Escape($Name))\s*=") {
            if (-not $written) {
                $updatedLines.Add("$Name=$generatedValue")
                $written = $true
            }
            continue
        }
        $updatedLines.Add($line)
    }
    if (-not $written) {
        $updatedLines.Add("$Name=$generatedValue")
    }
    Set-Content -Path $Path -Value $updatedLines -Encoding ASCII
}

function Get-EnvironmentSetting {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    Get-Content -Path $Path |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
        ForEach-Object { ($_ -split '=', 2)[1].Trim() } |
        Select-Object -Last 1
}

function Ensure-EnvironmentSetting {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $configuredValue = Get-EnvironmentSetting -Path $Path -Name $Name
    if ($null -ne $configuredValue -and $configuredValue.Length -gt 0) {
        return
    }
    Add-Content -Path $Path -Value "$Name=$Value" -Encoding ASCII
}

function Initialize-LocalEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExamplePath
    )

    if (-not (Test-Path $Path)) {
        Copy-Item -Path $ExamplePath -Destination $Path
        Write-Host "Created deploy\compose\.env from the local production defaults." -ForegroundColor Green
    }
    Ensure-EnvironmentSetting -Path $Path -Name "APP_URL" -Value "http://localhost:8080"
    Ensure-EnvironmentSetting -Path $Path -Name "CADDY_ADDRESS" -Value ":80"
    Ensure-EnvironmentSetting -Path $Path -Name "HTTP_PORT" -Value "8080"
    Ensure-EnvironmentSetting -Path $Path -Name "POSTGRES_IMAGE" -Value "postgres:16-alpine"
    Ensure-EnvironmentSetting -Path $Path -Name "POSTGRES_USER" -Value "financeuser"
    Ensure-EnvironmentSetting -Path $Path -Name "POSTGRES_DB" -Value "finance_db"
    Ensure-Secret -Path $Path -Name "POSTGRES_PASSWORD"
    Ensure-Secret -Path $Path -Name "BETTER_AUTH_SECRET"
    Ensure-Secret -Path $Path -Name "INTERNAL_AUTH_SECRET"
    Ensure-Secret -Path $Path -Name "DATA_ENCRYPTION_KEY_CURRENT"
    $postgresUser = Get-EnvironmentSetting -Path $Path -Name "POSTGRES_USER"
    $postgresPassword = Get-EnvironmentSetting -Path $Path -Name "POSTGRES_PASSWORD"
    $postgresDatabase = Get-EnvironmentSetting -Path $Path -Name "POSTGRES_DB"
    Ensure-EnvironmentSetting -Path $Path -Name "DATABASE_URL" -Value "postgresql://${postgresUser}:${postgresPassword}@postgres:5432/${postgresDatabase}"
    Ensure-EnvironmentSetting -Path $Path -Name "REDIS_URL" -Value "redis://redis:6379/0"
    Ensure-EnvironmentSetting -Path $Path -Name "BACKEND_URL" -Value "http://backend:8000"
}

if ($Help) {
    Show-Usage
    exit 0
}

# Resolve paths
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $RootDir "deploy\compose\.env"
$ComposeFile = Join-Path $RootDir "deploy\compose\docker-compose.yml"
$LocalComposeFile = Join-Path $RootDir "deploy\compose\docker-compose.local.yml"
$LiteComposeFile = Join-Path $RootDir "deploy\compose\docker-compose.lite.yml"
$ExampleEnvFile = Join-Path $RootDir "deploy\compose\.env.example"

if ($Local) {
    Initialize-LocalEnvironment -Path $EnvFile -ExamplePath $ExampleEnvFile
}

# Check for .env file
if (-not (Test-Path $EnvFile)) {
    Write-Host "Missing $EnvFile." -ForegroundColor Red
    Write-Host "Copy deploy\compose\.env.example to deploy\compose\.env and edit it first."
    exit 1
}

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

# Check APP_VERSION
$AppVersion = "edge"
$EnvContent = Get-Content $EnvFile -ErrorAction SilentlyContinue
foreach ($line in $EnvContent) {
    if ($line -match "^APP_VERSION=(.*)$") {
        $AppVersion = $Matches[1].Trim()
    }
}

if (-not $Local -and $AppVersion -eq "edge") {
    Write-Host "WARNING: APP_VERSION=edge is intended for development/testing." -ForegroundColor Yellow
    Write-Host "For production, pin APP_VERSION to a release tag (for example vX.Y.Z)." -ForegroundColor Yellow
    Write-Host ""
}

# Build Compose arguments. Lite mode names services explicitly so the separate
# Beat and MCP services are not started.
$ComposeArgs = @("compose", "--env-file", $EnvFile, "-f", $ComposeFile)
if ($Local) {
    $ComposeArgs += @("-f", $LocalComposeFile)
}
$Services = @()
$ModeName = "full"
if ($Lite) {
    $ComposeArgs += @("-f", $LiteComposeFile)
    $Services = @("postgres", "redis", "uploads-init", "migrate", "backend", "worker", "app", "caddy")
    $ModeName = "lite"
}

# Pull images unless the production images are being built locally.
if (-not $Local) {
    Write-Host "Pulling prebuilt images (GHCR) for $ModeName mode..." -ForegroundColor Cyan
    & docker @ComposeArgs pull @Services
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to pull images." -ForegroundColor Red
        exit 1
    }
}

if ($Lite) {
    # Avoid duplicate schedules when switching an existing full stack to lite.
    & docker compose --env-file $EnvFile -f $ComposeFile rm -s -f beat mcp
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to remove full-mode Beat/MCP containers." -ForegroundColor Red
        exit 1
    }
}

# Start stack
$SourceName = if ($Local) { "local" } else { "prebuilt" }
$UpArgs = @("up", "-d")
if ($Local) {
    $UpArgs += "--build"
}
Write-Host "Starting production stack in $ModeName mode from $SourceName images..." -ForegroundColor Cyan
& docker @ComposeArgs @UpArgs @Services
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start stack." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "The app should be available at the URL configured in APP_URL (default: http://localhost:8080)"
