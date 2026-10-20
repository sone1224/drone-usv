# 지상통제소 시뮬레이터 원본(이 프로젝트의 상위 폴더)을 public/sim 으로 복사한다.
# 시뮬레이터를 고친 뒤 배포 전에 실행: powershell -ExecutionPolicy Bypass -File scripts/sync-sim.ps1
param([string]$From = (Join-Path $PSScriptRoot '..\..'))
$to = Join-Path $PSScriptRoot '..\public\sim'
$From = (Resolve-Path $From).Path
if (-not (Test-Path (Join-Path $From 'js\sim.js'))) { throw "시뮬레이터 원본을 찾을 수 없습니다: $From" }
New-Item -ItemType Directory -Force $to | Out-Null
foreach ($h in 'index.html', 'busan.html') { Copy-Item (Join-Path $From $h) $to -Force }
foreach ($d in 'css', 'js') {
  New-Item -ItemType Directory -Force (Join-Path $to $d) | Out-Null
  Copy-Item (Join-Path $From "$d\*") (Join-Path $to $d) -Force
}
Write-Host "시뮬레이터 동기화 완료: $From -> $to"
