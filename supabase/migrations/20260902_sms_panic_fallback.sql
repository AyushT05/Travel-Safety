-- SMS Panic Fallback Migration
-- Created: 2026-09-02
--
-- Adds support for SMS-based emergency alerts in zero-connectivity areas.
-- Tourists can send "SOS" via SMS even without mobile data, and it enters
-- the same emergency alert pipeline as the existing panic button.

-- Optional audit log table for SMS panic events
-- Tracks every SMS SOS received, even if it doesn't result in an alert
-- (e.g., phone number not found, no recent location, etc.)
CREATE TABLE IF NOT EXISTS sms_panic_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- SMS metadata
  phone_number TEXT NOT NULL,
  message_text TEXT NOT NULL,

  -- User association (NULL if phone number wasn't found in travel_cards)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Alert reference (NULL if alert creation failed or was skipped)
  alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,

  -- How stale the location was when the alert was created (in seconds)
  -- Helps identify cases where we're working with very old location data
  location_age_seconds INTEGER,

  -- Processing result
  status TEXT DEFAULT 'processed' CHECK (status IN ('processed', 'failed', 'rejected')),
  error_message TEXT
);

-- Index for looking up SMS events by phone number
CREATE INDEX IF NOT EXISTS idx_sms_panic_log_phone
  ON sms_panic_log(phone_number);

-- Index for looking up SMS events by user
CREATE INDEX IF NOT EXISTS idx_sms_panic_log_user
  ON sms_panic_log(user_id) WHERE user_id IS NOT NULL;

-- Index for looking up SMS events by timestamp (for recent activity queries)
CREATE INDEX IF NOT EXISTS idx_sms_panic_log_created
  ON sms_panic_log(created_at DESC);

-- Enable RLS on the SMS panic log (admin/system only)
ALTER TABLE sms_panic_log ENABLE ROW LEVEL SECURITY;

-- Only system/service role can insert SMS logs (from the Edge Function)
-- This policy is permissive since the Edge Function uses the service role key
CREATE POLICY sms_panic_log_service_insert
  ON sms_panic_log FOR INSERT
  WITH CHECK (true);

-- Admins can view all SMS panic logs for monitoring and auditing
-- Note: You'll need to add an admin role check here based on your auth setup
-- Example: CREATE POLICY sms_panic_log_admin_select ON sms_panic_log FOR SELECT USING (auth.jwt()->>'role' = 'admin');
CREATE POLICY sms_panic_log_admin_select
  ON sms_panic_log FOR SELECT
  USING (true); -- Replace with proper admin check

-- Optional: Add a 'source' column to the alerts table to distinguish SMS vs app panic
-- Uncomment if you want to track the alert source explicitly
-- ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'app' CHECK (source IN ('app', 'sms', 'manual', 'system'));

-- Optional: Add an index on alerts.user_id for faster lookups when processing SMS
-- (likely already exists, but adding for completeness)
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);

-- Comments for documentation
COMMENT ON TABLE sms_panic_log IS
  'Audit log for SMS-based panic alerts. Records every SMS SOS received, including failed/rejected attempts.';

COMMENT ON COLUMN sms_panic_log.phone_number IS
  'Sender phone number from SMS gateway webhook (E.164 format preferred)';

COMMENT ON COLUMN sms_panic_log.location_age_seconds IS
  'How many seconds old the location data was when the alert was created. High values indicate stale location data.';

COMMENT ON COLUMN sms_panic_log.status IS
  'Processing outcome: processed (alert created), failed (system error), rejected (phone not found, no location, invalid message)';
