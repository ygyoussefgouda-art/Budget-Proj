@echo off
setlocal enabledelayedexpansion
rem Downloads portable Node.js 22 (latest LTS patch) into D:\devtools and verifies its SHA-256.
set DEST=D:\devtools
if not exist %DEST% mkdir %DEST%
cd /d %DEST%
curl.exe -sSfL --max-time 60 -o SHASUMS256.txt https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt || (echo FAILED: checksum list & exit /b 1)
for /f "tokens=1,2" %%a in ('findstr /c:"-win-x64.zip" SHASUMS256.txt') do (set SUM=%%a& set FILE=%%b)
if "%FILE%"=="" (echo FAILED: could not find win-x64 zip & exit /b 1)
echo Downloading %FILE% ...
set TRY=0
:dl
set /a TRY+=1
curl.exe -sSfL --max-time 600 -C - -o %FILE% https://nodejs.org/dist/latest-v22.x/%FILE% && goto dlok
if %TRY% GEQ 8 (echo FAILED: download after %TRY% tries & exit /b 1)
echo   retry %TRY% ...
timeout /t 3 /nobreak >nul
goto dl
:dlok
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile %FILE% SHA256') do (if not defined GOT set GOT=%%h)
set GOT=%GOT: =%
if /i not "%GOT%"=="%SUM%" (echo FAILED: checksum mismatch & del %FILE% & exit /b 1)
echo Checksum OK
tar -xf %FILE% || (echo FAILED: extract & exit /b 1)
del %FILE% SHASUMS256.txt
for /d %%d in (node-v22*-win-x64) do echo NODE_DIR=%DEST%\%%d
echo DONE
