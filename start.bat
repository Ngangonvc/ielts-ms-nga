@echo off
title IELTS Ms Nga - Writing Task 1 Examination
color 0b

echo ===================================================================
echo     DANG KHOI DONG HE THONG IELTS MS NGA WRITING TASK 1...
echo ===================================================================
echo.

set PATH=C:\Users\Nga Ngo\.gemini\antigravity\scratch\ielts-writing-classroom\bin;C:\Users\Nga Ngo\.gemini\antigravity\tools\node-v20.18.0-win-x64;%PATH%
cd /d "C:\Users\Nga Ngo\.gemini\antigravity\scratch\ielts-writing-classroom"

echo [*] Dang khoi dong may chu tai cong 5000...
echo [*] Trinh duyet se tu dong mo sau 2 giay...
echo.

:: Tu dong mo trinh duyet sau khi may chu san sang
start /min cmd /c "timeout /t 2 /nobreak > nul & start http://localhost:5000/#/teacher"

:: Chay may chu Node.js
node server/server.js

echo.
echo [!] May chu da dung lai.
pause
