@echo off
REM ============================================================
REM  Apollo 11 Lunar Landing Simulator - one-click Windows build
REM  产物: dist\Apollo11LunarLanding.exe （单文件，免安装）
REM
REM  依赖（仅打包需要；源码运行 python src\run.py 零依赖）：
REM      pip install pyinstaller pywebview
REM
REM  注意：本脚本在仓库根目录执行，源码都在 src\ 下。
REM        如果你想改打包细节，src\Apollo11LunarLanding.spec 是原始配置
REM        （那份 spec 用的是原项目布局，路径需自行调整）。
REM ============================================================
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [X] 找不到 python，请先安装 Python 3.8+ 并加入 PATH。
  pause & exit /b 1
)

echo [1/2] PyInstaller 打包中（约 30 秒）...
python -m PyInstaller --noconfirm --clean --onefile ^
  --name Apollo11LunarLanding ^
  --icon "src\assets\icon.ico" ^
  --add-data "src\apollo11\webdata;apollo11\webdata" ^
  --add-data "src\assets\icon.ico;assets" ^
  --add-data "src\assets\icon.png;assets" ^
  "src\run.py"

if errorlevel 1 (
  echo.
  echo [X] 打包失败。请确认依赖已安装： pip install pyinstaller pywebview
  pause & exit /b 1
)

echo [2/2] 完成，产物：
dir /b dist\Apollo11LunarLanding.exe
echo.
echo 双击 dist\Apollo11LunarLanding.exe 即可运行。
pause
