# SMS Panic Fallback Setup Guide

## Overview

The SMS panic fallback allows tourists to send emergency alerts via SMS when they have no mobile data or internet connectivity but can still send a basic text message. This is critical for remote/rural areas where cellular coverage exists but data services are unavailable.

## How It Works

```
Tourist sends "SOS" via SMS
    ↓
SMS Gateway/Provider (Twilio, AWS SNS, etc.)
    ↓
Webhook → Supabase Edge Function (sms-panic)
    ↓
1. Identify tourist from phone number (travel_cards table)
2. Retrieve most recent location (locations table)
3. Insert emergency alert (alerts table)
    ↓
Existing dashboard realtime alert flow handles it
```

**Important**: This does NOT create a separate alert system. It reuses the existing `alerts` table, alert UI, realtime subscriptions, acknowledge/resolve flow, and map markers. SMS simply becomes another source of an emergency alert.

## Prerequisites

1. Deployed Supabase project with the following tables:
   - `travel_cards` (contains user profiles with mobile numbers)
   - `locations` (contains GPS tracking data)
   - `alerts` (existing emergency alert system)

2. An SMS gateway provider account (choose one):
   - **Twilio** (recommended, easy setup, global coverage)
   - **AWS SNS** (good for AWS-heavy infrastructure)
   - **Africa's Talking** (good coverage in African regions)
   - **MSG91** (good coverage in India/South Asia)

## Setup Steps

### 1. Deploy the Database Migration

```bash
# Navigate to your project root
cd "D:\Major Project - Travel Safety"

# Apply the migration (creates sms_panic_log table)
supabase db push
```

Or manually run the SQL migration:
```bash
psql -h <your-supabase-host> -U postgres -d postgres -f supabase/migrations/20260902_sms_panic_fallback.sql
```

### 2. Deploy the Edge Function

```bash
# Deploy the SMS panic webhook handler
supabase functions deploy sms-panic

# The deployment will output a webhook URL like:
# https://<project-ref>.supabase.co/functions/v1/sms-panic
```

Save this URL — you'll configure it as the webhook endpoint in your SMS gateway.

### 3. Configure Your SMS Gateway

#### Option A: Twilio (Recommended)

1. **Create a Twilio account** at https://www.twilio.com
2. **Purchase a phone number** with SMS capabilities
3. **Configure the webhook**:
   - Go to Phone Numbers → Manage → Active numbers
   - Select your purchased number
   - Under "Messaging Configuration":
     - Set "A MESSAGE COMES IN" webhook to:
       ```
       https://<project-ref>.supabase.co/functions/v1/sms-panic
       ```
     - Method: `POST`
     - Content-Type: `application/x-www-form-urlencoded`

4. **Test**: Send an SMS with "SOS" to your Twilio number

#### Option B: AWS SNS

1. **Create an SNS Topic** for incoming SMS
2. **Subscribe your Edge Function**:
   - Protocol: HTTPS
   - Endpoint: `https://<project-ref>.supabase.co/functions/v1/sms-panic`
   - Confirm the subscription via the Supabase logs

3. **Create an SMS phone number** and link it to your SNS topic

#### Option C: Other Providers

Most SMS gateways support webhook notifications. Configure:
- **Webhook URL**: Your Edge Function endpoint
- **Method**: POST
- **Format**: JSON or form-encoded

Ensure the webhook payload includes:
- Sender phone number (`from`, `From`, `sender`, etc.)
- Message text (`text`, `Body`, `message`, etc.)

The Edge Function normalizes common formats automatically.

### 4. Update Travel Card Phone Numbers

Ensure all tourist phone numbers in `travel_cards` are stored consistently:

```sql
-- View current phone number formats
SELECT mobile_number, COUNT(*) 
FROM travel_cards 
GROUP BY mobile_number;

-- Recommended format: E.164 (+[country code][number])
-- Examples: +1234567890, +919876543210, +447911123456
-- The Edge Function will do fuzzy matching on the last 10 digits,
-- so exact format isn't critical, but consistency helps.
```

## Testing

### Manual Test via cURL

Simulate an incoming SMS webhook:

```bash
# Generic format
curl -X POST https://<project-ref>.supabase.co/functions/v1/sms-panic \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+1234567890",
    "text": "SOS"
  }'

# Twilio format
curl -X POST https://<project-ref>.supabase.co/functions/v1/sms-panic \
  -H "Content-Type: application/json" \
  -d '{
    "From": "+1234567890",
    "Body": "SOS"
  }'
```

**Expected response on success**:
```json
{
  "success": true,
  "alert_id": "uuid-here",
  "user": {
    "id": "user-uuid",
    "name": "John Doe",
    "phone": "+1234567890"
  },
  "location": {
    "lat": 25.2048,
    "lon": 55.2708,
    "accuracy": 20,
    "age_seconds": 45
  },
  "message": "Emergency alert created successfully"
}
```

**Expected response on failure** (phone not found):
```json
{
  "error": "Phone number not registered",
  "from": "+1234567890",
  "hint": "Tourist must create a travel card with this mobile number in the app first"
}
```

### End-to-End Test

1. **Set up a test user**:
   - Create a travel card in the mobile app
   - Start location sharing (send at least one location update)
   - Note the phone number used

2. **Send SMS**: Text "SOS" from that phone number to your SMS gateway number

3. **Verify on dashboard**:
   - Open the web dashboard
   - Check the Alerts panel for a new panic alert
   - Verify it shows:
     - Alert type: "Panic button"
     - User name from travel card
     - Location marker on map
     - Status: "open"

4. **Test acknowledge/resolve flow**:
   - Click "Acknowledge" (status → "acknowledged")
   - Click "Resolve" (status → "resolved")

## Trigger Words

The Edge Function recognizes these trigger words (case-insensitive):
- `SOS`
- `HELP`
- `EMERGENCY`

Any SMS containing exactly one of these words (trimmed) will create an alert.

## Configuration Options

Edit `supabase/functions/sms-panic/index.ts` to customize:

```typescript
// How far back to look for the user's last location (default: 24 hours)
const MAX_LOCATION_AGE_SEC = 24 * 60 * 60;

// Add more trigger words
function isSOSTrigger(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return ["SOS", "HELP", "EMERGENCY", "PANIC"].includes(normalized);
}

// Phone number fuzzy matching (default: last 10 digits)
const last10 = cleanFrom.slice(-10);
// Change to last 8 digits for shorter country codes:
// const last8 = cleanFrom.slice(-8);
```

Redeploy after changes:
```bash
supabase functions deploy sms-panic
```

## Monitoring and Audit

### View SMS Panic Logs

All SMS events (successful and failed) are logged to `sms_panic_log`:

```sql
-- Recent SMS panic events
SELECT 
  created_at,
  phone_number,
  message_text,
  status,
  location_age_seconds,
  error_message
FROM sms_panic_log
ORDER BY created_at DESC
LIMIT 50;

-- SMS events by user
SELECT 
  u.email,
  tc.full_name,
  spl.created_at,
  spl.phone_number,
  spl.status,
  spl.location_age_seconds
FROM sms_panic_log spl
LEFT JOIN travel_cards tc ON tc.user_id = spl.user_id
LEFT JOIN auth.users u ON u.id = spl.user_id
WHERE spl.user_id IS NOT NULL
ORDER BY spl.created_at DESC;

-- Failed/rejected SMS attempts (troubleshooting)
SELECT *
FROM sms_panic_log
WHERE status != 'processed'
ORDER BY created_at DESC;
```

### View Edge Function Logs

```bash
# Real-time logs
supabase functions logs sms-panic --tail

# Search logs for errors
supabase functions logs sms-panic | grep -i error
```

### Dashboard Monitoring

The dashboard's existing alerts panel will show SMS-triggered alerts with:
- Message: "SMS SOS received from [name] ([phone]). Last known location from [timestamp]."
- Type: "Panic button" (same as app panic button)
- Severity: "critical"

## Troubleshooting

### "Phone number not registered"

**Cause**: The sender's phone number doesn't match any `mobile_number` in `travel_cards`.

**Fix**:
1. Check the phone number format in the database:
   ```sql
   SELECT mobile_number FROM travel_cards WHERE mobile_number ILIKE '%1234%';
   ```
2. The Edge Function matches on the last 10 digits, so "+1234567890" will match "1234567890", "(123) 456-7890", etc.
3. If still not working, temporarily log the normalized phone number:
   ```typescript
   console.log("Searching for phone:", cleanFrom, "last 10:", last10);
   ```

### "No recent location found"

**Cause**: The user hasn't shared their location in the last 24 hours (default).

**Fix**:
1. Increase `MAX_LOCATION_AGE_SEC` in the Edge Function if tourists typically share location less frequently
2. Or prompt tourists to enable background location tracking in the mobile app
3. Check the locations table:
   ```sql
   SELECT created_at, lat, lon 
   FROM locations 
   WHERE user_id = 'user-uuid-here' 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```

### Webhook not triggering

**Cause**: SMS gateway can't reach the Edge Function.

**Fix**:
1. Verify the webhook URL is correct (check for typos)
2. Check Edge Function logs for incoming requests:
   ```bash
   supabase functions logs sms-panic --tail
   ```
3. Test with cURL (see "Testing" section above)
4. Verify your SMS gateway's webhook configuration (HTTP POST, correct content-type)
5. Some providers require webhook verification — check their docs

### Alert created but not showing on dashboard

**Cause**: Dashboard's realtime subscription may not be set up correctly.

**Fix**:
1. Verify the alert was actually created:
   ```sql
   SELECT * FROM alerts ORDER BY created_at DESC LIMIT 5;
   ```
2. Check the dashboard's realtime subscription in `useAlerts.js` — it should be listening to the `alerts` table
3. Check browser console for Supabase connection errors
4. Try refreshing the dashboard (it loads the last 100 alerts on bootstrap)

## Security Considerations

1. **Rate Limiting**: Consider adding rate limiting to prevent SMS spam:
   ```typescript
   // Example: max 3 SMS alerts per user per hour
   const recentAlerts = await supabase
     .from('sms_panic_log')
     .select('id')
     .eq('phone_number', from)
     .gte('created_at', new Date(Date.now() - 3600000).toISOString());
   
   if (recentAlerts.data && recentAlerts.data.length >= 3) {
     return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
   }
   ```

2. **Phone Verification**: Ensure mobile numbers are verified during travel card creation to prevent impersonation.

3. **Webhook Authentication**: Most SMS gateways support webhook signature verification. Add this for production:
   ```typescript
   // Example for Twilio
   import twilio from 'twilio';
   const isValid = twilio.validateRequest(
     Deno.env.get('TWILIO_AUTH_TOKEN')!,
     signature,
     url,
     params
   );
   if (!isValid) return new Response('Forbidden', { status: 403 });
   ```

4. **Service Role Key**: The Edge Function uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. This is necessary to insert alerts on behalf of users, but ensure the Edge Function validates inputs carefully.

## Cost Estimation

### SMS Gateway Costs (Twilio example)
- Phone number: ~$1-2/month
- Incoming SMS: ~$0.0075 per message
- For 100 tourists sending 1 SOS each: ~$1.75/month

### Supabase Edge Function Costs
- Function invocations: ~$2 per million invocations
- For 100 SMS/month: essentially free

**Total estimated cost for small-scale deployment**: ~$2-5/month

## Production Deployment Checklist

- [ ] Database migration applied (`sms_panic_log` table created)
- [ ] Edge Function deployed and accessible
- [ ] SMS gateway configured with webhook URL
- [ ] SMS gateway webhook signature verification enabled (if available)
- [ ] Phone numbers in `travel_cards` are verified and consistent
- [ ] Rate limiting added to Edge Function (optional but recommended)
- [ ] Edge Function logs monitored (set up alerts for errors)
- [ ] End-to-end test completed with a real SMS
- [ ] Dashboard alert flow verified (acknowledge/resolve works)
- [ ] `sms_panic_log` retention policy configured (auto-delete old logs after N days)
- [ ] Documentation shared with operations team
- [ ] Emergency contact list updated to include the SMS SOS number

## Future Enhancements

1. **Auto-reply SMS**: Send a confirmation SMS back to the tourist
   ```typescript
   // After creating alert, send response via SMS gateway
   await fetch('https://api.twilio.com/2010-04-01/Accounts/.../Messages.json', {
     method: 'POST',
     headers: { 'Authorization': 'Basic ...' },
     body: new URLSearchParams({
       To: from,
       From: twilioNumber,
       Body: 'Your SOS has been received. Help is on the way.'
     })
   });
   ```

2. **SMS status updates**: Notify tourist when alert is acknowledged/resolved

3. **Location estimation**: If no recent GPS location exists, use cell tower triangulation or IP geolocation as fallback

4. **Multi-language support**: Recognize SOS keywords in multiple languages (AYUDA, HILFE, मदद, etc.)

5. **Emergency contact cascade**: Automatically SMS the tourist's emergency contacts from their travel card

## Support

For issues or questions:
- Check Edge Function logs: `supabase functions logs sms-panic`
- Review `sms_panic_log` table for processing history
- Test with cURL before debugging SMS gateway integration
- Consult your SMS gateway provider's webhook documentation
