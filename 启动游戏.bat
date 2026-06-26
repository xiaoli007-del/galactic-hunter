@echo off
echo 正在启动银河猎手本地服务器...
echo 浏览器将自动打开游戏
echo.
echo 按 Ctrl+C 可以停止服务器
echo.
cd /d "%~dp0"
npx serve -l 3000
pause
