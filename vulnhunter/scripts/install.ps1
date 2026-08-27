# dsh-vulnhunter 零代码安装（P0.5）
#
# 把预设、技能、记忆系统复制进 $DSH_HOME（环境变量 DSH_HOME，默认 ~/.dsh）：
#   presets/vulnhunter -> $DSH_HOME/.agent-presets/vulnhunter   （用户级 agent 预设根）
#   skills/vh-*        -> $DSH_HOME/skills/                     （技能扫描 user-dsh 层）
#   memory/            -> $DSH_HOME/vulnhunter/memory           （vulnmem CLI 固定位置，persona 引用此路径）
#
# 卸载：删除上述三个目标目录即可。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\install.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$dshHome = $env:DSH_HOME
if (-not $dshHome -or -not $dshHome.Trim()) {
    $dshHome = Join-Path $env:USERPROFILE '.dsh'
}
Write-Host "[install] DSH_HOME = $dshHome"

# 1) 预设
$presetDest = Join-Path $dshHome '.agent-presets\vulnhunter'
New-Item -ItemType Directory -Force -Path $presetDest | Out-Null
Copy-Item -Recurse -Force (Join-Path $repoRoot 'presets\vulnhunter\*') $presetDest
Write-Host "[install] preset  -> $presetDest"

# 2) 技能（vh-* 目录逐个覆盖）
$skillsDest = Join-Path $dshHome 'skills'
New-Item -ItemType Directory -Force -Path $skillsDest | Out-Null
Get-ChildItem (Join-Path $repoRoot 'skills') -Directory |
    Where-Object { $_.Name -like 'vh-*' } |
    ForEach-Object {
        Copy-Item -Recurse -Force $_.FullName (Join-Path $skillsDest $_.Name)
    }
Write-Host "[install] skills  -> $skillsDest"

# 3) 记忆系统
$memDest = Join-Path $dshHome 'vulnhunter\memory'
New-Item -ItemType Directory -Force -Path $memDest | Out-Null
Copy-Item -Recurse -Force (Join-Path $repoRoot 'memory\*') $memDest
Write-Host "[install] memory  -> $memDest"

# 4) 构建产物 dist -> $dshHomeulnhunter\dist（预设里 file:///__VULNHUNTER_DIST__/ 指向这里）
if (-not (Test-Path (Join-Path $repoRoot 'dist\index.js'))) {
    Write-Host '[build] dist/ not found - running npm install && npm run build ...'
    Push-Location $repoRoot
    npm install
    npm run build
    Pop-Location
}
$distDest = Join-Path $dshHome 'vulnhunter\dist'
New-Item -ItemType Directory -Force -Path $distDest | Out-Null
Copy-Item -Recurse -Force (Join-Path $repoRoot 'dist\*') $distDest
Write-Host "[install] dist   -> $distDest"

# 5) Rewrite the dist path placeholder in installed presets
#    (file:///__VULNHUNTER_DIST__/ -> the real install location, forward slashes).
$distUrl = ([string] $distDest).Replace('', '/')
if (-not $distUrl.StartsWith('/')) { $distUrl = '/' + $distUrl }
Get-ChildItem $presetDest -Filter 'agent.cordis.yml' -Recurse | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -like '*__VULNHUNTER_DIST__*') {
        $content = $content.Replace('__VULNHUNTER_DIST__', $distUrl)
        Set-Content -Path $_.FullName -Value $content -Encoding UTF8
        Write-Host "[install] preset dist path -> $distUrl ($($_.Name))"
    }
}

Write-Host ''
Write-Host '[done] Restart dsh web - the vulnhunter presets should appear in the roster.'
Write-Host '[hint] Memory system deps: pip install -r $dshHomeulnhunter\memoryequirements.txt'
Write-Host '[hint] Recon CLIs (enscan/amass/gogo/httpx): download separately, put on PATH or set toolsDir in the plugin config.'
Write-Host '[hint] FOFA/Shodan: set env vars FOFA_EMAIL / FOFA_KEY / SHODAN_KEY - never write keys into files.'
