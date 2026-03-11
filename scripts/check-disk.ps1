Get-PSDrive -PSProvider FileSystem | ForEach-Object {
    $freeGB = [math]::Round($_.Free / 1GB, 2)
    $usedGB = [math]::Round($_.Used / 1GB, 2)
    Write-Output "$($_.Name): Free=$freeGB GB, Used=$usedGB GB"
}
