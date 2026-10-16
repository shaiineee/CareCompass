$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskOutput = Split-Path $taskRoot -Parent
function New-CareCompassArchive([string]$ArchiveName, [bool]$IncludeDependencies) {
    $taskArchivePath = Join-Path $taskOutput $ArchiveName
    if (Test-Path -LiteralPath $taskArchivePath) { throw "Archive already exists: $taskArchivePath. Keep it or choose a different name." }
    $taskStream = [IO.File]::Open($taskArchivePath, [IO.FileMode]::CreateNew)
    $taskArchive = [IO.Compression.ZipArchive]::new($taskStream, [IO.Compression.ZipArchiveMode]::Create)
    $taskCount = 0
    try {
        foreach ($taskFile in Get-ChildItem -LiteralPath $taskRoot -File -Recurse -Force) {
            $taskRelative = [IO.Path]::GetRelativePath($taskRoot, $taskFile.FullName).Replace('\', '/')
            if ($taskRelative -match '^(data|artifacts|\.git)/' -or $taskRelative -match '^\.env($|\.(?!example$))' -or $taskRelative -match '\.log$') { continue }
            if (-not $IncludeDependencies -and $taskRelative -match '^(node_modules|\.cache)/') { continue }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive, $taskFile.FullName, "CareCompass-Ready/$taskRelative", [IO.Compression.CompressionLevel]::Optimal) | Out-Null
            $taskCount++
        }
    } finally { $taskArchive.Dispose(); $taskStream.Dispose() }
    $taskVerify = [IO.Compression.ZipFile]::OpenRead($taskArchivePath)
    try {
        if ($taskVerify.Entries.FullName -match '^CareCompass-Ready/(data|artifacts|\.git)/|^CareCompass-Ready/\.env$') { throw 'Private runtime data found in archive.' }
        foreach ($taskRequired in @('app.js', 'public/index.html', 'START-HERE.md', 'Start-CareCompass.cmd', 'package-lock.json')) {
            if (-not $taskVerify.GetEntry("CareCompass-Ready/$taskRequired")) { throw "Missing file: $taskRequired" }
        }
        if ($IncludeDependencies -and (-not $taskVerify.GetEntry('CareCompass-Ready/node_modules/express/package.json') -or -not $taskVerify.GetEntry('CareCompass-Ready/.cache/eng.traineddata'))) { throw 'Ready archive is missing bundled dependencies or English OCR data.' }
    } finally { $taskVerify.Dispose() }
    Get-Item -LiteralPath $taskArchivePath | Select-Object Name, Length
    Write-Output "$taskCount files packaged; private runtime data excluded."
}
New-CareCompassArchive 'CareCompass-Ready.zip' $true
New-CareCompassArchive 'CareCompass-GitHub-Source.zip' $false
