@echo off
title IAPS Dev Server

echo Starting MongoDB...
sc query MongoDB >nul 2>&1
if %errorlevel% == 0 (
    net start MongoDB >nul 2>&1
    echo MongoDB service started.
) else (
    echo MongoDB service not found, starting manually...
    start "MongoDB" "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --config "C:\Users\Sadhana\mongod.cfg"
    timeout /t 4 /nobreak >nul
    echo MongoDB started.
)

echo Starting Flask...
cd /d "C:\Users\Sadhana\Projects\IAPS\iaps-backend"
start "Flask - IAPS Backend" "C:\Users\Sadhana\Projects\IAPS\.venv\Scripts\python.exe" app.py

echo.
echo Both services are running.
echo  - MongoDB : localhost:27017
echo  - Flask   : http://localhost:5001
echo.
pause
