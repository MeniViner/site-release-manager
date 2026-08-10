@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo =====================================================
echo  Site Release Manager - Create IIS deployment package
echo =====================================================
echo.
node scripts\verify-iis-package.mjs
if errorlevel 1 goto :fail
node scripts\create-iis-package.mjs
if errorlevel 1 goto :fail
echo.
echo Done. The .7z file was created next to the project folder.
pause
exit /b 0
:fail
echo.
echo ERROR: IIS package was not created.
pause
exit /b 1
