@echo off
chcp 65001 > nul
title IELTS Ms Nga - Đẩy Mã Nguồn Lên GitHub Miễn Phí
color 0b

echo ===================================================================
echo     IELTS MS NGA - ĐẨY DỰ ÁN LÊN GITHUB ĐỂ TRIỂN KHAI RENDER
echo ===================================================================
echo.
echo Công cụ này giúp Cô Nga đưa toàn bộ ứng dụng lên GitHub cá nhân hoàn toàn miễn phí.
echo Sau đó kết nối với Render để chạy vĩnh viễn trên Internet mà không cần bật máy tính.
echo.

set PATH=C:\Users\Nga Ngo\.gemini\antigravity\tools\git\cmd;%PATH%
cd /d "C:\Users\Nga Ngo\.gemini\antigravity\scratch\ielts-writing-classroom"

echo Nhập đường link GitHub Repository của Cô (Ví dụ: https://github.com/username/ielts-ms-nga.git):
set /p REPO_URL=">> Đường link GitHub: "

if "%REPO_URL%"=="" (
    echo [X] Cô chưa nhập đường link. Hãy mở lại file này khi đã tạo Repository trên GitHub.
    pause
    exit /b 1
)

echo.
echo [*] Đang thiết lập kết nối với GitHub: %REPO_URL% ...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%
git branch -M main

echo [*] Đang đẩy toàn bộ mã nguồn lên GitHub...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===================================================================
    echo  [THANH CONG] ĐÃ ĐẨY DỰ ÁN LÊN GITHUB HOÀN TẤT!
    echo ===================================================================
    echo Bây giờ cô chỉ cần vào Render.com:
    echo 1. Bấm New + -> Web Service (hoặc Blueprint)
    echo 2. Chọn repository này và bấm Deploy!
    echo 3. Render sẽ tự động dựng website HTTPS vĩnh viễn cho cô!
) else (
    echo.
    echo [!] Quá trình đẩy lên GitHub gặp trục trặc (có thể do chưa đăng nhập GitHub).
    echo Cô hãy kiểm tra lại quyền truy cập hoặc tài khoản GitHub nhé.
)

echo.
pause
