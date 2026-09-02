#!/bin/bash

# SMS Panic Webhook Test Script
# Tests the sms-panic Edge Function with android-sms-gateway format

# Configuration
EDGE_FUNCTION_URL="${1:-https://your-project-ref.supabase.co/functions/v1/sms-panic}"
TEST_PHONE="${2:-+1234567890}"
TEST_MESSAGE="${3:-SOS}"

echo "=========================================="
echo "SMS Panic Webhook Test"
echo "=========================================="
echo "Edge Function: $EDGE_FUNCTION_URL"
echo "Test Phone: $TEST_PHONE"
echo "Message: $TEST_MESSAGE"
echo "=========================================="
echo ""

# Send test webhook (android-sms-gateway format)
echo "Sending test webhook..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$EDGE_FUNCTION_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "'"$TEST_PHONE"'",
    "message": "'"$TEST_MESSAGE"'",
    "receivedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
    "simNumber": 1
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo ""
echo "Response (HTTP $HTTP_CODE):"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "✅ SUCCESS! Alert created."
  echo ""
  echo "Next steps:"
  echo "1. Check your dashboard for the new alert"
  echo "2. Verify the alert shows correct user and location"
  echo "3. Test acknowledge/resolve flow"
elif [ "$HTTP_CODE" -eq 404 ]; then
  echo "❌ Phone number not found or no location data"
  echo ""
  echo "Troubleshooting:"
  echo "1. Ensure a travel card exists with this phone number"
  echo "2. Ensure the user has shared location at least once"
  echo "3. Check: supabase db execute \"SELECT mobile_number FROM travel_cards WHERE mobile_number ILIKE '%${TEST_PHONE: -10}%'\""
elif [ "$HTTP_CODE" -eq 400 ]; then
  echo "❌ Bad request (likely invalid trigger word)"
  echo ""
  echo "Valid trigger words: SOS, HELP, EMERGENCY"
else
  echo "❌ Unexpected error"
fi

echo ""
echo "=========================================="
echo "Additional checks:"
echo "=========================================="
echo ""
echo "View Edge Function logs:"
echo "  supabase functions logs sms-panic --tail"
echo ""
echo "View recent SMS events:"
echo "  supabase db execute \"SELECT * FROM sms_panic_log ORDER BY created_at DESC LIMIT 5\""
echo ""
echo "View recent alerts:"
echo "  supabase db execute \"SELECT id, user_id, type, severity, message, created_at FROM alerts ORDER BY created_at DESC LIMIT 5\""
echo ""
