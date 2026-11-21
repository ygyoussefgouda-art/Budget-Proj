@echo off
rem Local run without Docker: API + embedded Postgres (data in server\.pglite) + built web app on http://localhost:3000
rem Open the app and use "Create account" to make your own account.
cd /d %~dp0..\server
set APP_PASSWORD=
set ALLOW_SIGNUP=true
set DB_DRIVER=pglite
set PGLITE_DIR=.pglite
set PUBLIC_DIR=%~dp0..\web\dist
set PORT=3000
call "%~dp0n.cmd" npx tsx src/index.ts
