# SMS Panic Setup with android-sms-gateway

## Overview

This guide shows how to set up SMS panic alerts using **android-sms-gateway** (capcom6/android-sms-gateway) - an open-source Android app that forwards incoming SMS to a webhook. Perfect for demonstrations, testing, or production use in controlled environments.

**Benefits of this approach:**
- ✅ Zero SMS gateway costs (no Twilio subscription)
- ✅ Works offline for the gateway phone (only needs data/WiFi)
- ✅ Full control over the SMS number
- ✅ Open source and privacy-friendly
- ✅ Easy setup for demos

**Requirements:**
- 1 Android phone (Android 5.0+) to act as the SMS gateway
- The phone needs data/WiFi to forward webhooks
- F-Droid or ability to sideload APKs

## Architecture

```
Tourist's phone (no data, SMS only)
    ↓ SMS "SOS"
Gateway Android phone (with data/WiFi)
    ↓ android-sms-gateway app forwards to webhook
Supabase Edge Function (sms-panic)
    ↓
Existing alert system
```

## Setup Steps

### 1. Deploy Backend Components

```bash
# Navigate to project root
cd "D:\Major Project - Travel Safety"

# Deploy database migration
supabase db push

# Deploy Edge Function
supabase functions deploy sms-panic

# Note the webhook URL (you'll need it in step 3)
# Format: https://<project-ref>.supabase.co/functions/v1/sms-panic
```

### 2. Install android-sms-gateway on Gateway Phone

#### Option A: F-Droid (Recommended)

1. Install F-Droid from https://f-droid.org if not already installed
2. Open F-Droid and search for "SMS Gateway"
3. Install "SMS Gateway for Android" by capcom6

#### Option B: GitHub Release (Direct APK)

1. Go to https://github.com/capcom6/android-sms-gateway/releases
2. Download the latest APK (e.g., `sms-gateway-v1.x.x.apk`)
3. Enable "Install from Unknown Sources" in Android settings
4. Open the APK and install

#### Option C: Build from Source

```bash
git clone https://github.com/capcom6/android-sms-gateway.git
cd android-sms-gateway
./gradlew assembleRelease
# APK will be in app/build/outputs/apk/release/
```

### 3. Configure android-sms-gateway App

1. **Open the app** on your gateway phone

2. **Grant permissions** when prompted:
   - SMS permissions (to read incoming messages)
   - Notification permissions (optional, for status updates)

3. **Configure webhook**:
   - Tap "Settings" or the gear icon
   - Find "Webhooks" or "Server Configuration"
   - Add a new webhook:
     - **URL**: `https://<your-project-ref>.supabase.co/functions/v1/sms-panic`
     - **Method**: POST
     - **Event**: Message Received
     - **Format**: JSON

4. **Optional: Configure filtering**:
   - If the app supports message filtering, you can filter to only forward messages containing "SOS", "HELP", or "EMERGENCY"
   - This reduces unnecessary webhook calls
   - Pattern: `(?i)(SOS|HELP|EMERGENCY)` (case-insensitive regex)

5. **Enable the gateway**:
   - Toggle the main switch to "ON" or "Active"
   - The app should show "Gateway Active" or similar status

6. **Keep app running**:
   - Disable battery optimization for the app (Settings → Apps → SMS Gateway → Battery → Unrestricted)
   - Consider using a dedicated phone that stays plugged in

### 4. Verify Setup

#### Test 1: Check Webhook Configuration

From another device, check if the Edge Function is accessible:

```bash
curl https://<your-project-ref>.supabase.co/functions/v1/sms-panic

# Should return an error (no POST data), but confirms it's reachable
```

#### Test 2: Send Test SMS

1. From any phone (not the gateway phone), send an SMS to the gateway phone's number:
   ```
   SOS
   ```

2. Check the android-sms-gateway app logs:
   - Open the app
   - Look for "Logs" or "Activity" section
   - You should see the incoming SMS and webhook delivery status

3. Check Supabase Edge Function logs:
   ```bash
   supabase functions logs sms-panic --tail
   ```
   - Should show the incoming webhook request
   - Should show either success or error with details

4. Check the dashboard:
   - Open your web dashboard
   - Look for a new alert in the Alerts panel
   - Verify it shows the correct user and location

## android-sms-gateway Webhook Format

The app sends webhooks in this format:

```json
{
  "message": "SOS",
  "phoneNumber": "+1234567890",
  "receivedAt": "2026-09-02T09:45:00Z",
  "simNumber": 1
}
```

Our Edge Function automatically normalizes this to match other SMS gateway formats.

## Configuration Options

### Edge Function Configuration

Edit `supabase/functions/sms-panic/index.ts` if needed:

```typescript
// Maximum location age (default: 24 hours)
const MAX_LOCATION_AGE_SEC = 24 * 60 * 60;

// Trigger words (case-insensitive)
function isSOSTrigger(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return ["SOS", "HELP", "EMERGENCY"].includes(normalized);
}
```

Redeploy after changes:
```bash
supabase functions deploy sms-panic
```

### android-sms-gateway App Settings

**Recommended settings for production:**
- **Auto-start on boot**: Enabled
- **Battery optimization**: Disabled (Unrestricted)
- **Retry failed webhooks**: Enabled
- **Webhook timeout**: 30 seconds
- **Keep logs**: Last 100 messages
- **Notification**: Enabled (to monitor gateway status)

## Usage Instructions for Tourists

Share this with tourists:

---

### 📱 Emergency SMS SOS

**If you have no internet but can send SMS:**

1. Send a text message with the word **SOS** to:
   ```
   [YOUR-GATEWAY-PHONE-NUMBER]
   ```

2. Your last known location will be sent to the emergency dashboard

3. You should receive a confirmation SMS (if auto-reply is configured)

**Important:**
- You must have created a travel card in the app first
- You must have shared your location at least once
- Use the same phone number you registered with

---

## Monitoring and Troubleshooting

### Check Gateway Status

**On the gateway phone:**
1. Open android-sms-gateway app
2. Check status indicator (should show "Active" or green)
3. Review recent logs/activity
4. Verify webhook URL is correct

### Check SMS Processing Logs

```bash
# Real-time Edge Function logs
supabase functions logs sms-panic --tail

# Recent SMS events from database
supabase db execute "
SELECT 
  created_at,
  phone_number,
  message_text,
  status,
  location_age_seconds,
  error_message
FROM sms_panic_log 
ORDER BY created_at DESC 
LIMIT 20
"
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| SMS received but no webhook | App not running or network issue | Check app status, verify WiFi/data connection |
| "Phone number not registered" | Number format mismatch | Check travel_cards table, see Phone Number Matching below |
| "No recent location found" | User hasn't shared location | User must open app and share location at least once |
| Webhook fails with network error | Edge Function URL incorrect | Verify URL in app settings, test with cURL |
| Battery optimization kills app | Android power saving | Disable battery optimization for the app |

### Phone Number Matching

The Edge Function fuzzy-matches phone numbers by the **last 10 digits**. This means:

- `+1234567890` matches `1234567890` matches `(123) 456-7890`
- International format differences are handled automatically

**To check if a number will match:**

```bash
# Replace 1234567890 with last 10 digits of the sender's number
supabase db execute "
SELECT 
  mobile_number, 
  full_name, 
  user_id 
FROM travel_cards 
WHERE mobile_number ILIKE '%1234567890%'
"
```

## Advanced Configuration

### Auto-Reply Confirmation SMS

To send a confirmation SMS back to the tourist, you can:

1. **Use android-sms-gateway's built-in auto-reply**:
   - In the app settings, configure auto-reply rules
   - Rule: If message contains "SOS" → Reply "Your SOS has been received. Help is on the way."

2. **Or implement in Edge Function**:
   - Requires the gateway phone to have an API endpoint
   - android-sms-gateway supports a REST API for sending SMS
   - See "Sending SMS via API" section below

### Sending SMS via API

android-sms-gateway can also *send* SMS via REST API. To enable confirmation messages:

1. Enable the REST API in app settings
2. Note the API URL (usually `http://<phone-ip>:8080`)
3. Generate an API key in the app
4. Add this to the Edge Function after creating an alert:

```typescript
// Send confirmation SMS back to tourist
await fetch('http://<gateway-phone-ip>:8080/message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': Deno.env.get('SMS_GATEWAY_API_KEY')!
  },
  body: JSON.stringify({
    message: 'Your SOS has been received. Help is on the way. Stay safe.',
    phoneNumbers: [from]
  })
});
```

**Note**: The gateway phone must be accessible from your Supabase Edge Function (same network, or use a tunnel like ngrok).

### Rate Limiting

To prevent SMS spam, add rate limiting to the Edge Function:

```typescript
// At the start of Deno.serve(), after normalizing payload:
const recentSMS = await supabase
  .from('sms_panic_log')
  .select('id')
  .eq('phone_number', from)
  .gte('created_at', new Date(Date.now() - 3600000).toISOString());

if (recentSMS.data && recentSMS.data.length >= 3) {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded: max 3 SOS per hour' }),
    { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  );
}
```

### Multiple Gateway Phones

For redundancy or load distribution:

1. Install android-sms-gateway on multiple phones
2. Configure all to use the same webhook URL
3. Give tourists all gateway phone numbers
4. The Edge Function will handle duplicates (same user, within a short time window)

To deduplicate in the Edge Function:

```typescript
// Check for recent alerts from this user (within last 5 minutes)
const { data: recentAlerts } = await supabase
  .from('alerts')
  .select('id')
  .eq('user_id', card.user_id)
  .eq('type', 'panic')
  .gte('created_at', new Date(Date.now() - 300000).toISOString());

if (recentAlerts && recentAlerts.length > 0) {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Duplicate SOS ignored (alert already exists)',
      alert_id: recentAlerts[0].id
    }),
    { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  );
}
```

## Network Configuration

### For Local Testing (Gateway Phone on Same WiFi)

If your Supabase project is local or the gateway phone is on the same network:

```bash
# Get your local IP
ipconfig  # Windows
ifconfig  # Mac/Linux

# Use local Supabase CLI URL in app settings
# http://<your-local-ip>:54321/functions/v1/sms-panic
```

### For Production (Gateway Phone on Cellular/Remote WiFi)

Use the public Supabase Edge Function URL:
```
https://<project-ref>.supabase.co/functions/v1/sms-panic
```

The gateway phone just needs any internet connection (WiFi or mobile data).

### Using a Dynamic DNS / Tunnel (Optional)

If you want to host the webhook on your own server:

1. Use ngrok, Cloudflare Tunnel, or similar:
   ```bash
   ngrok http 54321
   ```

2. Update the webhook URL in android-sms-gateway app to the ngrok URL

3. This is useful for local development/testing without deploying to Supabase

## Cost Comparison

| Approach | Setup Cost | Monthly Cost | Pros | Cons |
|----------|------------|--------------|------|------|
| **android-sms-gateway** | $0 (use existing phone) | $0 (or carrier SMS plan) | Zero gateway fees, full control, privacy-friendly | Need to keep gateway phone running, limited to one number per phone |
| **Twilio** | $0 | ~$2-5 (number + per-SMS fees) | Reliable, scalable, multiple numbers | Recurring costs, vendor lock-in |
| **AWS SNS** | $0 | ~$1-3 (per-SMS fees) | AWS ecosystem integration | More complex setup, costs scale with usage |

**For demos and small deployments, android-sms-gateway is ideal.**

## Security Considerations

### Gateway Phone Security

- **Physical security**: Keep the gateway phone in a secure location
- **Lock screen**: Enable PIN/pattern/biometric lock
- **App password**: android-sms-gateway supports password-protecting settings
- **Network**: Use secure WiFi (WPA2/WPA3), avoid public WiFi
- **Updates**: Keep Android OS and app updated

### Webhook Security

The Edge Function is publicly accessible. To add authentication:

1. **Option A: API Key in android-sms-gateway**
   - Set a custom header in the app (if supported)
   - Validate in Edge Function:
     ```typescript
     const apiKey = req.headers.get('X-API-Key');
     if (apiKey !== Deno.env.get('SMS_WEBHOOK_SECRET')) {
       return new Response('Unauthorized', { status: 401 });
     }
     ```

2. **Option B: IP Allowlist**
   - Not practical for mobile gateway phones (dynamic IPs)
   - Could work if gateway phone is on a static network

3. **Option C: Request Signing**
   - Implement HMAC signature validation
   - android-sms-gateway would need to support this (check app capabilities)

### Privacy

- SMS content is logged in `sms_panic_log` for audit purposes
- Consider GDPR/privacy implications if deploying in EU
- Add retention policy to auto-delete old logs:
  ```sql
  -- Delete SMS logs older than 90 days
  DELETE FROM sms_panic_log 
  WHERE created_at < NOW() - INTERVAL '90 days';
  ```
- Run this periodically via a cron job or Supabase Edge Function on a schedule

## Production Deployment Checklist

- [ ] Gateway phone has android-sms-gateway installed and configured
- [ ] Gateway phone battery optimization disabled for the app
- [ ] Gateway phone set to auto-start app on boot
- [ ] Webhook URL verified and accessible from gateway phone
- [ ] Edge Function deployed and tested with cURL
- [ ] Database migration applied
- [ ] End-to-end test completed (send SMS → alert appears in dashboard)
- [ ] Gateway phone number shared with tourists
- [ ] Backup power for gateway phone (UPS or battery bank)
- [ ] Monitoring set up (check gateway status daily)
- [ ] Rate limiting configured in Edge Function
- [ ] Auto-reply confirmation SMS configured (optional)
- [ ] SMS log retention policy configured
- [ ] Documentation shared with operations team

## Alternatives and Future Enhancements

### RCS (Rich Communication Services)

If tourists have RCS-enabled phones, you could:
- Use RCS APIs for richer messages (location attachments, delivery receipts)
- Still fallback to SMS if RCS unavailable
- Google Messages API supports this

### Satellite SMS

For truly remote areas:
- Some newer phones support satellite connectivity (e.g., iPhone 14+ Emergency SOS)
- Satellite SMS gateways (expensive but work anywhere)
- Starlink SMS (when available)

### Mesh Networks

For group travel in remote areas:
- Mesh networking apps (Briar, Bridgefy)
- One person's phone with connectivity becomes the gateway for the group
- More complex setup but higher reliability

## Support and Resources

- **android-sms-gateway GitHub**: https://github.com/capcom6/android-sms-gateway
- **F-Droid Listing**: Search "SMS Gateway" in F-Droid app
- **App Documentation**: https://github.com/capcom6/android-sms-gateway/wiki
- **Edge Function Logs**: `supabase functions logs sms-panic --tail`
- **SMS Event Logs**: Query `sms_panic_log` table in Supabase dashboard

## Quick Test Script

Save this as `test-sms-webhook.sh` for quick testing:

```bash
#!/bin/bash

# Configuration
EDGE_FUNCTION_URL="https://your-project-ref.supabase.co/functions/v1/sms-panic"
TEST_PHONE="+1234567890"  # Must exist in travel_cards
TEST_MESSAGE="SOS"

# Send test webhook (android-sms-gateway format)
curl -X POST "$EDGE_FUNCTION_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "'"$TEST_PHONE"'",
    "message": "'"$TEST_MESSAGE"'",
    "receivedAt": "'"$(date -Iseconds)"'",
    "simNumber": 1
  }'

echo -e "\n\nTest sent! Check:"
echo "1. Dashboard for new alert"
echo "2. Edge Function logs: supabase functions logs sms-panic --tail"
echo "3. SMS log: supabase db execute 'SELECT * FROM sms_panic_log ORDER BY created_at DESC LIMIT 5'"
```

Make executable and run:
```bash
chmod +x test-sms-webhook.sh
./test-sms-webhook.sh
```

---

**You're now ready to demo SMS panic fallback with zero monthly costs!** 🎉
