@echo off
chcp 65001 > nul
title IELTS Ms Nga - Complete Test Suite
color 0b

echo ===================================================================
echo   IELTS Ms Nga - KIỂM THỬ TẤT CẢ CÁC KỊCH BẢN THI WRITING TASK 1
echo ===================================================================
echo.

set PATH=C:\Users\Nga Ngo\.gemini\antigravity\tools\node-v20.18.0-win-x64;%PATH%
cd /d "C:\Users\Nga Ngo\.gemini\antigravity\scratch\ielts-writing-classroom"

echo [1/2] Đang chạy kiểm thử 14 kịch bản quy chuẩn IELTS Ms Nga...
node test/test-all-14-scenarios.js
if %ERRORLEVEL% NEQ 0 (
    echo [X] Kiểm thử 14 kịch bản thất bại!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Đang chạy kiểm thử tải và quy trình rút gọn...
node test/test-simplified-upgrade.js
if %ERRORLEVEL% NEQ 0 (
    echo [X] Kiểm thử quy trình rút gọn thất bại!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Đang chạy kiểm thử hồi quy 27 kịch bản chi tiết...
node test/test-suite.js
if %ERRORLEVEL% NEQ 0 (
    echo [X] Kiểm thử hồi quy thất bại!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================================
echo   TẤT CẢ CÁC KỊCH BẢN KIỂM THỬ ĐÃ VƯỢT QUA 100%% THÀNH CÔNG!
echo ===================================================================
pause
