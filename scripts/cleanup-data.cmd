@echo off
REM Clean up data files
echo Cleaning up data files...

where recycle >nul 2>&1
if %errorlevel% equ 0 (
    if exist "%~dp0..\mcp-server\data" recycle /q "%~dp0..\mcp-server\data\*.*"
    if exist "%~dp0..\vox-agents\telemetry" recycle /s /q "%~dp0..\vox-agents\telemetry\*.*"
) else (
    echo recycle is not installed. Deleting permanently instead of sending to the Recycle Bin.
    echo These files will not be recoverable.
    if exist "%~dp0..\mcp-server\data" del /q "%~dp0..\mcp-server\data\*.*"
    if exist "%~dp0..\vox-agents\telemetry" del /s /q "%~dp0..\vox-agents\telemetry\*.*"
)

echo Data files cleaned.