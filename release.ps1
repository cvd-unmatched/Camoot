#!/usr/bin/env pwsh
# Bump VERSION + package.json, commit, annotated tag, push — triggers GitHub Actions -> GHCR.
# Run from repo root: .\release.ps1 [options] <major|minor|patch|rc> [prerelease]

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false, Position = 0)]
  [ValidateSet('major', 'minor', 'patch', 'rc')]
  [string]$Type = 'patch',

  [Parameter(Mandatory = $false, Position = 1)]
  [string]$PreRelease = '',

  [Alias('k')]
  [switch]$KeepBaseVersion
)

$ErrorActionPreference = 'Stop'

Write-Host 'camoot-live — release' -ForegroundColor Cyan
Write-Host '===================================' -ForegroundColor Cyan

$ScriptDir = $PSScriptRoot
Set-Location -LiteralPath $ScriptDir

$VersionPath = Join-Path $ScriptDir 'VERSION'
if (-not (Test-Path -LiteralPath $VersionPath)) {
  Write-Host 'VERSION file not found. Create VERSION with the current version (e.g. 1.0.0)' -ForegroundColor Red
  exit 1
}

$versionContent = Get-Content -LiteralPath $VersionPath -Raw
$versionLines = @($versionContent -split "`r?`n" | Where-Object { $_ -match '\S' })
if ($versionLines.Count -lt 1) {
  Write-Host 'VERSION file is empty. Add a version like 1.0.0 or 1.0.0-rc1' -ForegroundColor Red
  exit 1
}

$currentVersion = ($versionLines[0] | Out-String).Trim()
if ($versionLines.Count -gt 1) {
  Write-Host "Detected extra lines in VERSION; using first line '$currentVersion' and ignoring the rest." -ForegroundColor Yellow
}

if ($currentVersion -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
  Write-Host "Invalid version format in VERSION file: $currentVersion" -ForegroundColor Red
  Write-Host 'Use MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-prerelease' -ForegroundColor Red
  exit 1
}

function Get-NextPrerelease {
  param([string]$Existing, [string]$DefaultPrefix = 'rc')

  if ([string]::IsNullOrWhiteSpace($Existing)) {
    return "$($DefaultPrefix)1"
  }

  if ($Existing -match '^([A-Za-z]+)\.?([0-9]+)$') {
    $prefix = $Matches[1]
    $num = [int]$Matches[2]
    return "$prefix$($num + 1)"
  }

  return "$($Existing)1"
}

$currentPrerelease = ''
if ($currentVersion -match '^\d+\.\d+\.\d+-(.+)$') {
  $currentPrerelease = $Matches[1]
}

if ($Type -eq 'rc') {
  $KeepBaseVersion = $true
  if (-not $PreRelease) {
    $PreRelease = Get-NextPrerelease -Existing $currentPrerelease -DefaultPrefix 'rc'
    Write-Host "Auto-incremented prerelease to '$PreRelease'" -ForegroundColor Yellow
  }
}

if ($KeepBaseVersion -and -not $PreRelease) {
  $PreRelease = Get-NextPrerelease -Existing $currentPrerelease -DefaultPrefix 'rc'
  Write-Host "Auto-incremented prerelease to '$PreRelease'" -ForegroundColor Yellow
}

$baseVersion = $currentVersion.Split('-')[0]
$versionParts = $baseVersion -split '\.'
[int]$major = $versionParts[0]
[int]$minor = $versionParts[1]
[int]$patch = $versionParts[2]

function Get-ReleaseInfo {
  param([string]$ReleaseType)

  $newMajor = $major
  $newMinor = $minor
  $newPatch = $patch

  if ($KeepBaseVersion -or $ReleaseType -eq 'rc') {
    $releaseTypeName = 'Prerelease'
    $newVersion = $baseVersion
    if ($PreRelease) {
      $newVersion = "$baseVersion-$PreRelease"
    }
  }
  else {
    switch ($ReleaseType) {
      'major' {
        $newMajor++
        $newMinor = 0
        $newPatch = 0
        $releaseTypeName = 'Major'
      }
      'minor' {
        $newMinor++
        $newPatch = 0
        $releaseTypeName = 'Minor'
      }
      'patch' {
        $newPatch++
        $releaseTypeName = 'Patch'
      }
      Default { throw "Invalid release type: $ReleaseType" }
    }

    $newVersion = "$newMajor.$newMinor.$newPatch"
    if ($PreRelease) {
      $newVersion = "$newVersion-$PreRelease"
    }
  }

  $tag = "v$newVersion"

  return @{
    Major   = $newMajor
    Minor   = $newMinor
    Patch   = $newPatch
    Version = $newVersion
    Tag     = $tag
    Type    = $releaseTypeName
  }
}

function Confirm-Release {
  param([string]$ReleaseType)

  $releaseInfo = Get-ReleaseInfo $ReleaseType

  Write-Host 'Release Information:' -ForegroundColor Yellow
  Write-Host "  Current Version: $currentVersion" -ForegroundColor White
  Write-Host "  Release Type: $($releaseInfo.Type)" -ForegroundColor White
  Write-Host "  New Version: $($releaseInfo.Version)" -ForegroundColor Green
  Write-Host "  Tag: $($releaseInfo.Tag)" -ForegroundColor Cyan
  if ($PreRelease) {
    Write-Host "  Pre-Release: $PreRelease" -ForegroundColor Cyan
  }
  Write-Host ''

  $existingTags = git tag -l
  if ($existingTags -contains $releaseInfo.Tag) {
    Write-Host "Tag $($releaseInfo.Tag) already exists" -ForegroundColor Red
    return $false
  }

  Write-Host "Do you want to create $($releaseInfo.Type) release $($releaseInfo.Version)? (y/N)" -ForegroundColor Yellow
  $response = Read-Host

  if ($response -match '^[Yy]$') {
    return $releaseInfo
  }

  return $false
}

$status = git -C $ScriptDir status --porcelain
if ($status) {
  Write-Host 'You have uncommitted changes' -ForegroundColor Yellow
  Write-Host 'Please commit or stash your changes before creating a release.' -ForegroundColor Yellow
  exit 1
}

if (-not $KeepBaseVersion -and $Type -ne 'rc') {
  $releaseTypes = @('patch', 'minor', 'major')
  $currentIndex = 0

  for ($i = 0; $i -lt $releaseTypes.Length; $i++) {
    if ($releaseTypes[$i] -eq $Type) {
      $currentIndex = $i
      break
    }
  }

  $releaseInfo = $null
  for ($i = $currentIndex; $i -lt $releaseTypes.Length; $i++) {
    $releaseType = $releaseTypes[$i]
    $releaseInfo = Confirm-Release $releaseType

    if ($releaseInfo) {
      $Type = $releaseType
      break
    }

    if ($i -lt $releaseTypes.Length - 1) {
      Write-Host 'Trying next release type...' -ForegroundColor Cyan
    }
    else {
      Write-Host 'Release cancelled' -ForegroundColor Yellow
      exit 0
    }
  }

  if (-not $releaseInfo) {
    Write-Host 'Release cancelled' -ForegroundColor Yellow
    exit 0
  }
}
else {
  $releaseInfo = Confirm-Release $Type
  if (-not $releaseInfo) {
    Write-Host 'Release cancelled' -ForegroundColor Yellow
    exit 0
  }
}

$releaseInfo = Get-ReleaseInfo $Type

Write-Host 'Updating VERSION file...' -ForegroundColor Yellow
[System.IO.File]::WriteAllText($VersionPath, "$($releaseInfo.Version)`n", [System.Text.UTF8Encoding]::new($false))

Write-Host 'Updating package.json version...' -ForegroundColor Yellow
$pkgPath = Join-Path $ScriptDir 'package.json'
$pkgJson = Get-Content -LiteralPath $pkgPath -Raw
$pkgNew = $pkgJson -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$($releaseInfo.Version)`""
[System.IO.File]::WriteAllText($pkgPath, $pkgNew, [System.Text.UTF8Encoding]::new($false))

Write-Host 'Committing version update...' -ForegroundColor Yellow
git add VERSION
git add package.json
git commit -m "Bump version to $($releaseInfo.Version)"

Write-Host "Creating tag $($releaseInfo.Tag)..." -ForegroundColor Yellow
git tag -a $releaseInfo.Tag -m "$($releaseInfo.Type) release version $($releaseInfo.Version)"

if ($LASTEXITCODE -ne 0) {
  Write-Host 'Failed to create tag' -ForegroundColor Red
  exit 1
}

$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Pushing branch '$currentBranch' and tag to origin..." -ForegroundColor Yellow
git push origin $currentBranch
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Failed to push branch' -ForegroundColor Red
  exit 1
}

git push origin $releaseInfo.Tag
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Failed to push tag' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host "$($releaseInfo.Type) release $($releaseInfo.Version) created and pushed successfully!" -ForegroundColor Green
Write-Host ''
Write-Host 'What happens next (GitHub Actions):' -ForegroundColor Cyan
Write-Host '  1. Workflow runs on tag push (Release)'
Write-Host '  2. Docker image is pushed to GitHub Container Registry (ghcr.io)'
Write-Host '  3. After the job succeeds, pull with:'
Write-Host ''

$remote = ''
try { $remote = (git config --get remote.origin.url).Trim() } catch { $remote = '' }

$owner = ''
$repo = ''
if ($remote -match 'git@github\.com:([^/]+)/([^/.]+)(\.git)?$') {
  $owner = $Matches[1]
  $repo = $Matches[2] -replace '\.git$', ''
}
elseif ($remote -match 'github\.com[:/]([^/]+)/([^/.]+)(\.git)?$') {
  $owner = $Matches[1]
  $repo = $Matches[2] -replace '\.git$', ''
}

if ($owner -and $repo) {
  $ghRepoLc = "$owner/$repo".ToLowerInvariant()
  $imageName = "ghcr.io/$ghRepoLc"
}
else {
  $imageName = 'ghcr.io/<owner>/<repo>'
}

Write-Host "     docker pull ${imageName}:$($releaseInfo.Tag)" -ForegroundColor DarkGray
Write-Host "     docker pull ${imageName}:latest" -ForegroundColor DarkGray
Write-Host ''
if ($owner -and $repo) {
  $repoLc = $repo.ToLowerInvariant()
  Write-Host "Packages: https://github.com/$owner/$repo/pkgs/container/$repoLc" -ForegroundColor Cyan
}
Write-Host ''
