$rustupUrl = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'
$outPath = "$env:TEMP\rustup-init.exe"

Write-Output "Downloading rustup-init.exe ..."
Invoke-WebRequest -Uri $rustupUrl -OutFile $outPath -UseBasicParsing
Write-Output "Download complete. Installing Rust (default stable) ..."

Start-Process -FilePath $outPath -ArgumentList '-y','--default-toolchain','stable' -Wait -NoNewWindow
Write-Output "Rust installation finished."

# Verify
$cargoPath = "$env:USERPROFILE\.cargo\bin"
$env:PATH = "$cargoPath;$env:PATH"
& "$cargoPath\rustc.exe" --version
& "$cargoPath\cargo.exe" --version
