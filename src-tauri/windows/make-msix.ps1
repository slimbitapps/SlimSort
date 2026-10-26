# Baut aus der fertigen slimsort.exe ein Paket für den Microsoft Store (.msix).
# Unsigniert – der Store signiert es selbst beim Hochladen.
# Die Werte für Identity/Publisher stehen im Partner Center unter „Produktidentität“
# und werden in src-tauri/windows/store.json eingetragen.
param([string]$Out = 'release/SlimSort-Store.msix')
$ErrorActionPreference = 'Stop'

$cfg = Get-Content 'src-tauri/windows/store.json' -Raw | ConvertFrom-Json
$ver = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
$ver4 = "$ver.0"

$dir = 'msix-layout'
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory "$dir/Assets" | Out-Null
Copy-Item 'src-tauri/target/release/slimsort.exe' "$dir/SlimSort.exe"
Copy-Item 'build/appx/*.png' "$dir/Assets/"

@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="$($cfg.identityName)" Publisher="$($cfg.publisher)" Version="$ver4" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>SlimSort</DisplayName>
    <PublisherDisplayName>$($cfg.publisherDisplayName)</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="de-DE" />
    <Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="SlimSort" Executable="SlimSort.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="SlimSort" Description="SlimSort" BackgroundColor="#14161a"
        Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" Square310x310Logo="Assets\Square310x310Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@ | Set-Content "$dir/AppxManifest.xml" -Encoding UTF8

$makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' | Sort-Object FullName | Select-Object -Last 1
New-Item -ItemType Directory (Split-Path $Out) -Force | Out-Null
& $makeappx.FullName pack /o /d $dir /p $Out
if ($LASTEXITCODE -ne 0) { throw "makeappx fehlgeschlagen" }
