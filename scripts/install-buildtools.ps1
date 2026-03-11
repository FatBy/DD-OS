[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$outPath = "$env:TEMP\vs_BuildTools.exe"
Write-Output "Downloading VS Build Tools to $outPath ..."
Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile $outPath -UseBasicParsing
Write-Output "Download complete. Starting silent install..."

Start-Process -FilePath $outPath -ArgumentList '--quiet','--wait','--norestart','--add','Microsoft.VisualStudio.Workload.VCTools','--includeRecommended' -Wait -NoNewWindow
Write-Output "VS Build Tools installation finished."
