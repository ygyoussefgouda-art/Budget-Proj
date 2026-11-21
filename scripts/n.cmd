@echo off
rem Runs a command with the portable Node.js on PATH, e.g.:  scripts\n.cmd npm --prefix server test
set "PATH=D:\devtools\node-v22.23.5-win-x64;%PATH%"
rem This network resets bursts of parallel connections: keep npm gentle.
set npm_config_maxsockets=2
set npm_config_fetch_retries=10
set npm_config_fetch_retry_mintimeout=5000
set npm_config_fetch_retry_maxtimeout=60000
set npm_config_audit=false
set npm_config_fund=false
%*
