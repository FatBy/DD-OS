$env:RUSTUP_HOME = 'D:\rust\rustup'
$env:CARGO_HOME = 'D:\rust\cargo'

$rustupInit = "$env:TEMP\rustup-init.exe"
if (-not (Test-Path $rustupInit)) {
    Write-Output "Downloading rustup-init.exe ..."
    Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $rustupInit -UseBasicParsing
}

Write-Output "Installing Rust to D:\rust\ ..."
Write-Output "  RUSTUP_HOME = $env:RUSTUP_HOME"
Write-Output "  CARGO_HOME  = $env:CARGO_HOME"

Start-Process -FilePath $rustupInit -ArgumentList '-y','--default-toolchain','stable' -Wait -NoNewWindow

Write-Output "Setting permanent environment variables..."
[System.Environment]::SetEnvironmentVariable('RUSTUP_HOME', 'D:\rust\rustup', 'User')
[System.Environment]::SetEnvironmentVariable('CARGO_HOME', 'D:\rust\cargo', 'User')

$currentPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
if ($currentPath -notlike '*D:\rust\cargo\bin*') {
    [System.Environment]::SetEnvironmentVariable('PATH', "D:\rust\cargo\bin;$currentPath", 'User')
    Write-Output "Added D:\rust\cargo\bin to user PATH"
}

$env:PATH = "D:\rust\cargo\bin;$env:PATH"
& 'D:\rust\cargo\bin\rustc.exe' --version
& 'D:\rust\cargo\bin\cargo.exe' --version
Write-Output "Done."
