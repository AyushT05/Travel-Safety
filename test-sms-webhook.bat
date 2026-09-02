@echo off
REM SMS Panic Webhook Test Script (Windows)
REM Tests the sms-panic Edge Function with android-sms-gateway format

setlocal enabledelayedexpansion

REM Configuration
set EDGE_FUNCTION_URL=%1
set TEST_PHONE=%2
set TEST_MESSAGE=%3

if "%EDGE_FUNCTION_URL%"=="" set EDGE_FUNCTION_URL=https://your-project-ref.supabase.co/functions/v1/sms-panic
if "%TEST_PHONE%"=="" set TEST_PHONE=+1234567890
if "%TEST_MESSAGE%"=="" set TEST_MESSAGE=SOS

echo ==========================================
echo SMS Panic Webhook Test
echo ==========================================
echo Edge Function: %EDGE_FUNCTION_URL%
echo Test Phone: %TEST_PHONE%
echo Message: %TEST_MESSAGE%
echo ==========================================
echo.

REM Get current timestamp in ISO format
for /f "tokens=1-6 delims=:.-, " %%a in ("%date% %time%") do (
  set timestamp=%%c-%%a-%%b^T%%d:%%e:%%fZ
)

REM Send test webhook
echo Sending test webhook...
curl -s -X POST "%EDGE_FUNCTION_URL%" ^
  -H "Content-Type: application/json" ^
  -d "{\"phoneNumber\": \"%TEST_PHONE%\", \"message\": \"%TEST_MESSAGE%\", \"receivedAt\": \"%timestamp%\", \"simNumber\": 1}"

echo.
echo.
echo ==========================================
echo Additional checks:
echo ==========================================
echo.
echo View Edge Function logs:
echo   supabase functions logs sms-panic --tail
echo.
echo View recent SMS events:
echo   supabase db execute "SELECT * FROM sms_panic_log ORDER BY created_at DESC LIMIT 5"
echo.
echo View recent alerts:
echo   supabase db execute "SELECT id, user_id, type, severity, message, created_at FROM alerts ORDER BY created_at DESC LIMIT 5"
echo.

endlocal
