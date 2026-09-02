# SMS Panic Fallback - Quick Start

## For Tourists

### How to use SMS SOS

**If you have no internet but can still send text messages:**

1. Send an SMS with one of these words to **[YOUR-SMS-NUMBER-HERE]**:
   - `SOS`
   - `HELP`
   - `EMERGENCY`

2. Your last known location will be sent to the safety dashboard

3. Emergency services will be notified

### Requirements

- You must have created a travel card in the mobile app
- You must have shared your location at least once
- The phone number you're texting from must match the one in your travel card

### Important Notes

- ⚠️ **SMS SOS uses your last known GPS location** — it may be outdated if you haven't shared location recently
- 📍 For the most accurate emergency response, try to share your location via the app before losing connectivity
- 🆘 If you can't send SMS either, call local emergency services directly

---

## For Administrators

### Quick Deploy

```bash
# 1. Apply database migration
supabase db push

# 2. Deploy Edge Function
supabase functions deploy sms-panic

# 3. Note the webhook URL (output from step 2)
# https://<project-ref>.supabase.co/functions/v1/sms-panic

# 4. Configure your SMS gateway to POST incoming SMS to that URL
```

### Quick Test

```bash
# Send a test SMS via API
curl -X POST https://<your-project>.supabase.co/functions/v1/sms-panic \
  -H "Content-Type: application/json" \
  -d '{"from": "+1234567890", "text": "SOS"}'

# Expected: Alert appears in dashboard
```

### Quick Troubleshooting

```bash
# View recent SMS events
supabase db execute "SELECT * FROM sms_panic_log ORDER BY created_at DESC LIMIT 10"

# View Edge Function logs
supabase functions logs sms-panic --tail

# Check if phone number exists
supabase db execute "SELECT mobile_number FROM travel_cards WHERE mobile_number ILIKE '%[last-4-digits]%'"
```

### Common Issues

| Error | Fix |
|-------|-----|
| "Phone number not registered" | Add the phone number to a travel card in the mobile app |
| "No recent location found" | User must share location at least once via the app |
| Webhook not triggering | Verify SMS gateway webhook URL and test with cURL |
| Alert not showing in dashboard | Check `alerts` table directly, verify realtime subscription |

---

## SMS Gateway URLs

**Your deployment:**
- SMS Panic Webhook: `https://<project-ref>.supabase.co/functions/v1/sms-panic`
- Project Dashboard: `[your-dashboard-url]`
- SOS Phone Number: `[your-sms-number]`

**Fill these in and share with your team!**
