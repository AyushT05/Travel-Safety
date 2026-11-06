"""Offline tests: every network call is replaced by a fake. Run: python -m unittest discover -s tests -v"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import safety_engine as se  # noqa: E402

HOUSE = (12.2958, 76.6394)


def counts(*totals):
    return {"elements": [{"type": "count", "tags": {"total": str(t)}} for t in totals]}


def weather(code=0, rain=0.0, gust=10.0, temp=28.0, is_day=1, hour="2026-11-01T12:00", vis=20000, ahead=None):
    return {"current": {"weather_code": code, "precipitation": rain, "wind_speed_10m": gust / 2, "wind_gusts_10m": gust,
                        "temperature_2m": temp, "apparent_temperature": temp, "visibility": vis, "is_day": is_day, "time": hour},
            "hourly": {"weather_code": [code] + (ahead or [0, 0, 0]), "wind_gusts_10m": [gust, 5, 5, 5]}}


class Fake:
    def __init__(self, overpass_fn, wx, geo_places=None, geo_emergency=None):
        self.overpass_fn, self.wx, self.geo_places, self.geo_emergency = overpass_fn, wx, geo_places, geo_emergency

    def install(self):
        se._cache = se.TTLCache()
        se._last.clear()
        se.SUPABASE_URL = ""
        se.GEOAPIFY_API_KEY = "x" if (self.geo_places is not None or self.geo_emergency is not None) else ""
        se.overpass = lambda q, timeout=25: self.overpass_fn(q)

        def http(url, data=None, headers=None, timeout=10, method=None):
            if "open-meteo.com/v1/forecast" in url:
                return self.wx
            if "air-quality" in url:
                return {"current": {"us_aqi": 60}}
            if "geoapify" in url and "circle" in url and "service.police" in url or "service.police" in url:
                return {"features": self.geo_emergency or []}
            if "geoapify" in url:
                return {"features": [{}] * (self.geo_places or 0)}
            raise OSError("unexpected " + url)
        se._http_json = http


def dense_overpass(q):
    if "amenity\"~\"^(hospital|police|fire_station)" in q:
        return {"elements": [{"type": "node", "lat": HOUSE[0] + .01, "lon": HOUSE[1], "tags": {"amenity": "police"}},
                             {"type": "node", "lat": HOUSE[0], "lon": HOUSE[1] + .01, "tags": {"amenity": "hospital"}}]}
    if "primary|secondary" in q:                       # infrastructure
        return counts(60, 400, 40, 50, 3, 10)
    if "protected_area" in q:                          # terrain
        return counts(0, 0, 0, 0, 0)
    return {"elements": []}


def runtime_error_overpass(q):
    return {"elements": [], "remark": "runtime error: Query timed out in \"query\" at line 3 after 26 seconds."}


def sparse_overpass(q):
    if "amenity\"~\"^(hospital|police|fire_station)" in q:
        return {"elements": [{"type": "node", "lat": HOUSE[0] + .2, "lon": HOUSE[1], "tags": {"amenity": "hospital"}}]}
    if "primary|secondary" in q:
        return counts(1, 0, 0, 0, 0, 0)
    if "protected_area" in q:
        return counts(0, 1, 0, 1, 0)
    return {"elements": []}


class SafetyEngineTests(unittest.TestCase):
    def assess(self, fake, **kw):
        fake.install()
        return se.compute_assessment(*HOUSE, "u1", "c1", [], kw.get("network"), 0)

    def factor(self, a, key):
        return next(f for f in a["score_breakdown"] if f["key"] == key)

    def test_dense_area_is_safe_and_not_isolated(self):
        a = self.assess(Fake(dense_overpass, weather()))
        self.assertEqual(a["safety_status"], "safe")
        self.assertEqual(a["isolation_score"], 0.0)
        self.assertFalse([r for r in a["risk_factors"] if r["type"] == "isolation"])

    def test_overpass_runtime_error_is_unknown_not_isolated(self):
        # The old code read this 200-with-remark response as "nothing nearby" => "isolated".
        a = self.assess(Fake(runtime_error_overpass, weather()))
        f = self.factor(a, "infrastructure")
        self.assertFalse(f["available"])
        self.assertIsNone(a["isolation_score"])
        self.assertFalse([r for r in a["risk_factors"] if r["type"] == "isolation"])
        self.assertNotEqual(a["safety_status"], "unsafe")
        self.assertIn(a["data_quality"], ("partial", "poor"))

    def test_sparse_osm_alone_is_not_confirmed_isolation(self):
        a = self.assess(Fake(sparse_overpass, weather()))
        f = self.factor(a, "infrastructure")
        self.assertLess(f["score"], 0.5)                       # single source: "possibly", unverified
        self.assertLess(f["confidence"], 0.6)

    def test_sparse_osm_but_geoapify_shows_shops_is_populated(self):
        a = self.assess(Fake(sparse_overpass, weather(), geo_places=60))
        self.assertEqual(self.factor(a, "infrastructure")["score"], 0.0)

    def test_two_sources_agree_remote_is_isolated(self):
        a = self.assess(Fake(sparse_overpass, weather(), geo_places=1, geo_emergency=[]))
        f = self.factor(a, "infrastructure")
        self.assertEqual(f["evidence"]["assessment"], "isolated")
        self.assertGreaterEqual(f["score"], 0.7)

    def test_remote_at_night_with_no_signal_escalates(self):
        night = weather(is_day=0, hour="2026-11-01T23:40")
        net = {"is_connected": False, "type": "none"}
        a = self.assess(Fake(sparse_overpass, night, geo_places=1, geo_emergency=[]), network=net)
        self.assertEqual(a["safety_status"], "unsafe")
        self.assertTrue(self.factor(a, "synergy")["evidence"]["reasons"])

    def test_thunderstorm_raises_risk_in_a_dense_area(self):
        clear = self.assess(Fake(dense_overpass, weather()))
        storm = self.assess(Fake(dense_overpass, weather(code=95, rain=15, gust=80)))
        self.assertGreater(storm["risk_score"], clear["risk_score"] + 0.2)
        self.assertEqual(clear["safety_status"], "safe")
        self.assertEqual(storm["safety_status"], "caution")        # sheltering is possible: services are close
        self.assertTrue([r for r in storm["risk_factors"] if r["type"] == "weather"])

    def test_storm_in_a_remote_area_is_unsafe(self):
        a = self.assess(Fake(sparse_overpass, weather(code=95, rain=15, gust=80), geo_places=1, geo_emergency=[]))
        self.assertEqual(a["safety_status"], "unsafe")

    def test_risk_escalates_immediately_but_relaxes_gradually(self):
        bad = self.assess(Fake(dense_overpass, weather(code=95, rain=15, gust=80)))
        fake = Fake(dense_overpass, weather())
        fake.install()
        se._last["u1"] = (bad["risk_score"], *HOUSE, __import__("time").time())
        better = se.compute_assessment(*HOUSE, "u1", "c1", [], None, 0)
        self.assertGreater(better["risk_score"], 0.12)             # not an instant drop back to "clear"

    def test_dense_area_with_offline_phone_is_only_caution_at_most(self):
        a = self.assess(Fake(dense_overpass, weather()), network={"is_connected": False, "type": "none"})
        self.assertIn(a["safety_status"], ("safe", "caution"))
        self.assertTrue([r for r in a["risk_factors"] if r["type"] == "connectivity"])

    def test_unavailable_sources_do_not_add_risk(self):
        def boom(q):
            raise se.OverpassError("down")
        f = Fake(boom, weather())
        f.install()
        se._http_json = lambda *a, **k: (_ for _ in ()).throw(OSError("offline"))
        a = se.compute_assessment(*HOUSE, "u2", None, [], None, 0)
        self.assertEqual(a["safety_status"], "safe")
        self.assertEqual(a["data_quality"], "poor")
        self.assertEqual(a["confidence"] < 0.5, True)

    def test_point_in_polygon_hazard(self):
        sq = {"type": "Polygon", "coordinates": [[[76.60, 12.20], [76.70, 12.20], [76.70, 12.40], [76.60, 12.40], [76.60, 12.20]]]}
        self.assertTrue(se._in_geometry(*HOUSE, sq, 0))
        self.assertFalse(se._in_geometry(13.5, 76.65, sq, 0))

    def test_write_falls_back_to_legacy_columns(self):
        import io
        from urllib import error
        calls = []

        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b""

        def urlopen(req, timeout=0):
            calls.append(req.data)
            if len(calls) == 1:
                raise error.HTTPError(req.full_url, 400, "bad", {}, io.BytesIO(b'{"code":"PGRST204","message":"Could not find the \'weather\' column"}'))
            return R()
        se.SUPABASE_URL, se.SUPABASE_SERVICE_KEY = "https://x.supabase.co", "k"
        orig = se.request.urlopen
        se.request.urlopen = urlopen
        try:
            ok, detail = se.write_assessment({"user_id": "u", "lat": 1, "lon": 2, "safety_status": "safe", "risk_score": 0.1,
                                              "assessed_at": "t", "weather": {"a": 1}, "score_breakdown": []})
        finally:
            se.request.urlopen = orig
        self.assertTrue(ok)
        self.assertNotIn(b"weather", calls[1])


if __name__ == "__main__":
    unittest.main()
