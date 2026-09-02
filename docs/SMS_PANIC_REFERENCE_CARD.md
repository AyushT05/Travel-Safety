# 🆘 SMS Panic - Quick Reference Card

## For Tourists

### How to Send SOS via SMS

**When you have NO internet/data but can send SMS:**

📱 **Text one of these words to: `[GATEWAY-PHONE-NUMBER]`**

```
SOS
HELP
EMERGENCY
```

✅ Your last known location will be sent to emergency services  
✅ Help will be dispatched to your location

---

### Requirements

Before traveling:
- ✅ Create a travel card in the mobile app
- ✅ Share your location at least once via the app
- ✅ Use the same phone number you registered with

⚠️ **SMS SOS uses your LAST KNOWN GPS location** — keep location sharing on when possible!

---

## For Gateway Phone Operator

### Daily Checklist

- [ ] Gateway phone powered on and charged
- [ ] android-sms-gateway app shows "Active" status
- [ ] WiFi/data connection working
- [ ] Check logs for any failed deliveries

### If SMS Not Working

1. Check app status indicator (should be green/active)
2. Verify webhook URL in app settings
3. Check phone has data/WiFi connection
4. Review app logs for errors
5. Test with: `./test-sms-webhook.sh`

---

## For Dashboard Operators

### When an SMS Alert Arrives

1. **Acknowledge** the alert immediately (status → "acknowledged")
2. Check location age (shown in alert message)
3. Contact tourist via phone if needed
4. Dispatch help to coordinates shown
5. **Resolve** when situation handled (status → "resolved")

### SMS Alert Indicators

- Type: "Panic button" (same as app panic)
- Message: "SMS SOS received from [name] ([phone]). Last known location from [timestamp]."
- Severity: "critical" (red)

---

## Contact Information

| Service | Contact |
|---------|---------|
| Gateway Phone Number | `[YOUR-PHONE-NUMBER]` |
| Dashboard URL | `[YOUR-DASHBOARD-URL]` |
| Edge Function | `[YOUR-EDGE-FUNCTION-URL]` |
| Emergency Services | 911 / 100 / [LOCAL-NUMBER] |

---

## Troubleshooting Quick Fixes

| Problem | Quick Fix |
|---------|-----------|
| SMS sent but no alert | Check gateway phone is on and connected |
| "Phone not registered" | Tourist must create travel card first |
| "No location found" | Tourist must share location in app once |
| Alert not showing | Refresh dashboard, check internet |
| Gateway app stopped | Reopen app, disable battery optimization |

---

## Test Commands (For Admins)

```bash
# Test webhook
./test-sms-webhook.sh <edge-url> <phone> SOS

# View logs
supabase functions logs sms-panic --tail

# Check recent SMS
supabase db execute "SELECT * FROM sms_panic_log ORDER BY created_at DESC LIMIT 10"
```

---

**📖 Full Documentation**: See `docs/SMS_PANIC_ANDROID_GATEWAY_SETUP.md`

**Updated**: 2026-09-02
