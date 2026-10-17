-- Migration: add_safety_zones.sql
-- Creates unsafe_zones and safety_assessments tables, RLS policies, indexes, and tracked_safety_info view.

-- ============================================================================
-- Table 1: unsafe_zones
-- User/admin-reported dangerous areas
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.unsafe_zones (
  id            BIGSERIAL PRIMARY KEY,
  reported_by   UUID NOT NULL REFERENCES auth.users(id),
  category      TEXT NOT NULL CHECK (category IN ('robbery', 'assault', 'harassment', 'poor_lighting', 'suspicious_activity', 'other')),
  severity      TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  description   TEXT,
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  radius_m      INTEGER NOT NULL DEFAULT 500,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'dismissed', 'expired')),
  verified_by   UUID REFERENCES auth.users(id),
  upvotes       INTEGER DEFAULT 0,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for spatial and status lookups
CREATE INDEX IF NOT EXISTS idx_unsafe_zones_lat_lon ON public.unsafe_zones(lat, lon);
CREATE INDEX IF NOT EXISTS idx_unsafe_zones_status ON public.unsafe_zones(status);
CREATE INDEX IF NOT EXISTS idx_unsafe_zones_reported_by ON public.unsafe_zones(reported_by);

-- Enable RLS on unsafe_zones
ALTER TABLE public.unsafe_zones ENABLE ROW LEVEL SECURITY;

-- 1. Everyone authenticated can SELECT (read all zones)
DROP POLICY IF EXISTS unsafe_zones_select_authenticated ON public.unsafe_zones;
CREATE POLICY unsafe_zones_select_authenticated
  ON public.unsafe_zones FOR SELECT
  TO authenticated
  USING (true);

-- 2. Users can INSERT their own reports (reported_by = auth.uid())
DROP POLICY IF EXISTS unsafe_zones_insert_own ON public.unsafe_zones;
CREATE POLICY unsafe_zones_insert_own
  ON public.unsafe_zones FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reported_by);

-- 3. Admins can UPDATE (to verify/dismiss)
DROP POLICY IF EXISTS unsafe_zones_update_admin ON public.unsafe_zones;
CREATE POLICY unsafe_zones_update_admin
  ON public.unsafe_zones FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 4. Admins can DELETE
DROP POLICY IF EXISTS unsafe_zones_delete_admin ON public.unsafe_zones;
CREATE POLICY unsafe_zones_delete_admin
  ON public.unsafe_zones FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 5. Service role full access
DROP POLICY IF EXISTS unsafe_zones_service_role ON public.unsafe_zones;
CREATE POLICY unsafe_zones_service_role
  ON public.unsafe_zones FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- Table 2: safety_assessments
-- Latest safety assessment per user
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.safety_assessments (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  travel_card_id  UUID REFERENCES public.travel_cards(id),
  lat             DOUBLE PRECISION NOT NULL,
  lon             DOUBLE PRECISION NOT NULL,
  safety_status   TEXT NOT NULL DEFAULT 'safe' CHECK (safety_status IN ('safe', 'caution', 'unsafe')),
  risk_score      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  risk_factors    JSONB DEFAULT '[]'::jsonb,
  nearest_police_km   DOUBLE PRECISION,
  nearest_hospital_km DOUBLE PRECISION,
  nearest_fire_km     DOUBLE PRECISION,
  isolation_score     DOUBLE PRECISION DEFAULT 0.0,
  hazard_zones        JSONB DEFAULT '[]'::jsonb,
  matched_unsafe_zones JSONB DEFAULT '[]'::jsonb,
  heading_warning     TEXT,
  assessed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT safety_assessments_unique_user UNIQUE (user_id)
);

-- Index on safety_assessments
CREATE INDEX IF NOT EXISTS idx_safety_assessments_user_id ON public.safety_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_safety_assessments_travel_card_id ON public.safety_assessments(travel_card_id);

-- Enable RLS on safety_assessments
ALTER TABLE public.safety_assessments ENABLE ROW LEVEL SECURITY;

-- 1. SELECT: Users can read own assessment, tracked users' assessments, or admin can read all
DROP POLICY IF EXISTS safety_assessments_select ON public.safety_assessments;
CREATE POLICY safety_assessments_select
  ON public.safety_assessments FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          profiles.role = 'admin'
          OR (profiles.tracked_ids IS NOT NULL AND safety_assessments.user_id::text = ANY(profiles.tracked_ids))
        )
    )
  );

-- 2. Authenticated users can INSERT their own (user_id = auth.uid())
DROP POLICY IF EXISTS safety_assessments_insert_own ON public.safety_assessments;
CREATE POLICY safety_assessments_insert_own
  ON public.safety_assessments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 3. Authenticated users can UPDATE their own (user_id = auth.uid())
DROP POLICY IF EXISTS safety_assessments_update_own ON public.safety_assessments;
CREATE POLICY safety_assessments_update_own
  ON public.safety_assessments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Service role full access (the server writes these)
DROP POLICY IF EXISTS safety_assessments_service_role ON public.safety_assessments;
CREATE POLICY safety_assessments_service_role
  ON public.safety_assessments FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- Enable Realtime
-- ============================================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.safety_assessments;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.unsafe_zones;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;


-- ============================================================================
-- View: tracked_safety_info
-- Lets non-admin users see safety assessments for users in their tracked_ids
-- ============================================================================
CREATE OR REPLACE VIEW public.tracked_safety_info AS
SELECT
  sa.id,
  sa.user_id,
  sa.travel_card_id,
  sa.lat,
  sa.lon,
  sa.safety_status,
  sa.risk_score,
  sa.risk_factors,
  sa.nearest_police_km,
  sa.nearest_hospital_km,
  sa.nearest_fire_km,
  sa.isolation_score,
  sa.hazard_zones,
  sa.matched_unsafe_zones,
  sa.heading_warning,
  sa.assessed_at
FROM public.safety_assessments sa
WHERE EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = auth.uid()
    AND (
      p.role = 'admin'
      OR sa.user_id = auth.uid()
      OR (p.tracked_ids IS NOT NULL AND sa.user_id::text = ANY(p.tracked_ids))
    )
);

GRANT SELECT ON public.tracked_safety_info TO authenticated;
GRANT SELECT ON public.tracked_safety_info TO service_role;
