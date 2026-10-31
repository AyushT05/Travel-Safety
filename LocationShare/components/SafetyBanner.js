import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import {
  requestSafetyAssessment,
  fetchLatestAssessment,
  reportUnsafeZone,
  SAFETY_CONFIG,
} from '../lib/safetyAssessment';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const REPORT_CATEGORIES = [
  { id: 'suspicious_activity', label: 'Suspicious Activity', icon: 'eye-outline' },
  { id: 'poor_lighting', label: 'Poor Lighting', icon: 'bulb-outline' },
  { id: 'harassment', label: 'Harassment', icon: 'hand-left-outline' },
  { id: 'robbery', label: 'Robbery', icon: 'shield-outline' },
  { id: 'assault', label: 'Assault', icon: 'alert-circle-outline' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

function formatDistance(km) {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function getRiskFactorIcon(type = '') {
  const t = type.toLowerCase();
  if (t.includes('light')) return 'bulb-outline';
  if (t.includes('crime') || t.includes('theft') || t.includes('robbery')) return 'shield-outline';
  if (t.includes('assault') || t.includes('violence') || t.includes('harass')) return 'hand-left-outline';
  if (t.includes('crowd') || t.includes('stampede')) return 'people-outline';
  if (t.includes('isolated') || t.includes('deserted')) return 'walk-outline';
  if (t.includes('traffic') || t.includes('accident')) return 'car-outline';
  if (t.includes('weather') || t.includes('flood') || t.includes('storm')) return 'rainy-outline';
  return 'alert-circle-outline';
}

/**
 * Collapsible safety status banner for the ActiveTracking screen.
 * Shows zone safety, risk factors, heading toward danger alerts,
 * and allows reporting unsafe zones.
 */
export default function SafetyBanner({ lat, lon, user, travelCardId, isSharing }) {
  const [assessment, setAssessment]               = useState(null);
  const [expanded, setExpanded]                   = useState(false);
  const [showReport, setShowReport]               = useState(false);
  const [reporting, setReporting]                 = useState(false);
  const [reportCategory, setReportCategory]       = useState('suspicious_activity');
  const [reportDescription, setReportDescription] = useState('');
  const [isAssessing, setIsAssessing]             = useState(false);

  // Store last 5 location coordinates [{lat, lon}] for heading prediction
  const prevLocationsRef = useRef([]);
  const locationRef      = useRef({ lat, lon });
  const initialAssessed  = useRef(false);

  useEffect(() => {
    locationRef.current = { lat, lon };
    if (lat != null && lon != null) {
      const prev = prevLocationsRef.current;
      const last = prev[prev.length - 1];
      if (!last || last.lat !== lat || last.lon !== lon) {
        prevLocationsRef.current = [...prev, { lat, lon }].slice(-5);
      }
    }
  }, [lat, lon]);

  const assessLocation = useCallback(async (targetLat, targetLon) => {
    const evalLat = targetLat ?? locationRef.current.lat;
    const evalLon = targetLon ?? locationRef.current.lon;
    if (!user?.id || evalLat == null || evalLon == null || !isSharing) return;

    setIsAssessing(true);
    try {
      const networkState = await NetInfo.fetch().catch(() => null);
      const result = await requestSafetyAssessment(
        evalLat,
        evalLon,
        user.id,
        travelCardId,
        0,
        prevLocationsRef.current,
        networkState ? {
          is_connected: networkState.isConnected,
          is_internet_reachable: networkState.isInternetReachable,
          type: networkState.type,
        } : undefined
      );
      if (result && !result.error) {
        setAssessment(result);
      }
    } catch (err) {
      console.warn('Safety assessment request failed:', err);
    } finally {
      setIsAssessing(false);
    }
  }, [user?.id, travelCardId, isSharing]);

  // Initial fetch and Realtime subscription + 30s interval
  useEffect(() => {
    if (!isSharing || !user?.id) return;

    // Load latest known assessment from DB
    fetchLatestAssessment(user.id)
      .then((data) => {
        if (data) setAssessment(data);
      })
      .catch((err) => console.warn('Fetch latest assessment failed:', err));

    // Realtime changes on safety_assessments table
    const channel = supabase
      .channel(`safety_assessments_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'safety_assessments',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new) {
            setAssessment(payload.new);
          }
        }
      )
      .subscribe();

    // 30-second interval polling
    const interval = setInterval(() => {
      assessLocation();
    }, 30000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user?.id, isSharing, assessLocation]);

  // Assess location as soon as valid coordinates are first available
  useEffect(() => {
    if (lat != null && lon != null && isSharing && !initialAssessed.current) {
      initialAssessed.current = true;
      assessLocation(lat, lon);
    }
    if (!isSharing) {
      initialAssessed.current = false;
    }
  }, [lat, lon, isSharing, assessLocation]);

  function toggleExpand() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  }

  function toggleReport() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowReport((v) => !v);
    if (!expanded) {
      setExpanded(true);
    }
  }

  async function handleSubmitReport() {
    if (!user?.id || lat == null || lon == null) return;
    setReporting(true);
    try {
      await reportUnsafeZone({
        lat,
        lon,
        category: reportCategory,
        severity: 'warning',
        description: reportDescription.trim() || undefined,
        userId: user.id,
      });
      Alert.alert(
        'Report Submitted',
        'Thank you. Your report helps alert fellow travelers and authorities.'
      );
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setShowReport(false);
      setReportDescription('');
      setReportCategory('suspicious_activity');
    } catch (err) {
      Alert.alert('Report Failed', err.message || 'Could not submit report. Please try again.');
    } finally {
      setReporting(false);
    }
  }

  // Only render when tracking is active and coordinates are available
  if (!isSharing || lat == null || lon == null) {
    return null;
  }

  const statusKey = (assessment?.status || 'safe').toLowerCase();
  const config = SAFETY_CONFIG[statusKey] || SAFETY_CONFIG.safe;

  // Parse risk factors
  let riskFactors = [];
  if (assessment?.risk_factors) {
    if (Array.isArray(assessment.risk_factors)) {
      riskFactors = assessment.risk_factors;
    } else if (typeof assessment.risk_factors === 'string') {
      try {
        riskFactors = JSON.parse(assessment.risk_factors);
      } catch {
        riskFactors = [];
      }
    }
  }

  const headingDanger = Boolean(
    assessment?.heading_towards_danger ||
    assessment?.heading_danger ||
    assessment?.predicted_risk === 'danger' ||
    assessment?.predicted_risk === 'high' ||
    assessment?.trajectory_warning
  );

  return (
    <View style={[s.card, { borderColor: config.borderColor }]}>
      {/* Main Header / Banner */}
      <TouchableOpacity
        style={[s.header, { backgroundColor: config.bgColor }]}
        onPress={toggleExpand}
        activeOpacity={0.85}
      >
        <View style={s.headerLeft}>
          <View style={[s.statusIconWrap, { backgroundColor: config.borderColor }]}>
            <Ionicons name={config.icon} size={20} color={config.color} />
          </View>
          <View style={s.headerTextWrap}>
            <View style={s.statusTitleRow}>
              <Text style={[s.statusTitle, { color: config.color }]}>
                {assessment?.status_label || config.label}
              </Text>
              {isAssessing && (
                <ActivityIndicator size="small" color={config.color} style={{ marginLeft: 6 }} />
              )}
            </View>
            <Text style={s.statusDesc} numberOfLines={expanded ? undefined : 2}>
              {assessment?.description || config.description}
            </Text>
          </View>
        </View>

        <View style={s.headerRight}>
          <Feather
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={config.color}
          />
        </View>
      </TouchableOpacity>

      {/* Trajectory Alert if moving toward danger */}
      {headingDanger && (
        <View style={s.dangerWarningBox}>
          <Ionicons name="trending-up" size={18} color="#DC2626" />
          <View style={s.dangerWarningContent}>
            <Text style={s.dangerWarningTitle}>Heading Toward Danger</Text>
            <Text style={s.dangerWarningText}>
              {assessment?.heading_warning ||
                assessment?.heading_message ||
                'Trajectory indicates you are heading toward a higher-risk area. Exercise caution.'}
            </Text>
          </View>
        </View>
      )}

      {/* Expandable Section */}
      {expanded && (
        <View style={s.body}>
          {/* Risk Factors List */}
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Risk Factors</Text>
            {riskFactors.length > 0 && (
              <View style={s.riskCountBadge}>
                <Text style={s.riskCountText}>{riskFactors.length}</Text>
              </View>
            )}
          </View>

          {riskFactors.length > 0 ? (
            <View style={s.riskList}>
              {riskFactors.map((factor, index) => {
                const sev = (factor.severity || 'low').toLowerCase();
                const sevStyle =
                  sev === 'high'
                    ? { bg: '#FEE2E2', text: '#DC2626', border: '#FECACA' }
                    : sev === 'medium'
                    ? { bg: '#FEF3C7', text: '#D97706', border: '#FDE68A' }
                    : { bg: '#E0F2FE', text: '#0284C7', border: '#BAE6FD' };

                const icon = getRiskFactorIcon(factor.type);

                return (
                  <View key={index} style={s.riskRow}>
                    <View style={[s.riskIconWrap, { backgroundColor: sevStyle.bg }]}>
                      <Ionicons name={icon} size={15} color={sevStyle.text} />
                    </View>
                    <View style={s.riskInfo}>
                      <Text style={s.riskLabel}>{factor.label || factor.type}</Text>
                      {factor.distance_km != null && (
                        <Text style={s.riskDist}>{formatDistance(factor.distance_km)} away</Text>
                      )}
                    </View>
                    <View
                      style={[
                        s.severityBadge,
                        { backgroundColor: sevStyle.bg, borderColor: sevStyle.border },
                      ]}
                    >
                      <Text style={[s.severityText, { color: sevStyle.text }]}>
                        {sev.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={s.noRisksRow}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#16A34A" />
              <Text style={s.noRisksText}>No critical risk factors detected in your area.</Text>
            </View>
          )}

          {/* Toggle Report Form Button */}
          <TouchableOpacity
            style={s.reportToggleBtn}
            onPress={toggleReport}
            activeOpacity={0.8}
          >
            <Feather
              name={showReport ? 'chevron-up' : 'flag'}
              size={13}
              color="#1B4332"
            />
            <Text style={s.reportToggleText}>
              {showReport ? 'Hide Report Form' : 'Report Unsafe Area'}
            </Text>
          </TouchableOpacity>

          {/* Inline Report Form */}
          {showReport && (
            <View style={s.reportForm}>
              <Text style={s.reportFormTitle}>Flag an Unsafe Area</Text>
              <Text style={s.reportFormSubtitle}>
                Select what best describes the issue at your current coordinates:
              </Text>

              {/* Category Pills */}
              <View style={s.categoriesWrap}>
                {REPORT_CATEGORIES.map((cat) => {
                  const isSelected = reportCategory === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[s.categoryChip, isSelected && s.categoryChipSelected]}
                      onPress={() => setReportCategory(cat.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={cat.icon}
                        size={13}
                        color={isSelected ? '#FFFFFF' : '#1B4332'}
                      />
                      <Text
                        style={[
                          s.categoryChipText,
                          isSelected && s.categoryChipTextSelected,
                        ]}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Optional Description */}
              <Text style={s.inputLabel}>Description (Optional)</Text>
              <TextInput
                style={s.textInput}
                placeholder="Add any helpful details for authorities or fellow travelers..."
                placeholderTextColor="#9E9484"
                value={reportDescription}
                onChangeText={setReportDescription}
                multiline
                numberOfLines={3}
                maxLength={300}
              />

              {/* Submit Button */}
              <TouchableOpacity
                style={[s.submitBtn, reporting && s.submitBtnDisabled]}
                onPress={handleSubmitReport}
                disabled={reporting}
                activeOpacity={0.85}
              >
                {reporting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Feather name="send" size={13} color="#FFFFFF" />
                    <Text style={s.submitBtnText}>Submit Safety Report</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  statusIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  statusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusDesc: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 2,
    lineHeight: 16,
  },
  headerRight: {
    paddingLeft: 8,
  },

  dangerWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  dangerWarningContent: {
    flex: 1,
  },
  dangerWarningTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  dangerWarningText: {
    fontSize: 11,
    color: '#991B1B',
    marginTop: 2,
    lineHeight: 15,
  },

  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F7F5F0',
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  riskCountBadge: {
    backgroundColor: '#F7F5F0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#EAE4D9',
  },
  riskCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1B4332',
  },

  riskList: {
    marginTop: 4,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F7F5F0',
    gap: 10,
  },
  riskIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskInfo: {
    flex: 1,
  },
  riskLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  riskDist: {
    fontSize: 10,
    color: '#9E9484',
    marginTop: 2,
  },
  severityBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  severityText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  noRisksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  noRisksText: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
  },

  reportToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F7F5F0',
    borderWidth: 1,
    borderColor: '#EAE4D9',
  },
  reportToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1B4332',
  },

  reportForm: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FAF9F6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAE4D9',
  },
  reportFormTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  reportFormSubtitle: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    marginBottom: 10,
  },

  categoriesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE4D9',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryChipSelected: {
    backgroundColor: '#1B4332',
    borderColor: '#1B4332',
  },
  categoryChipText: {
    fontSize: 11,
    color: '#1B4332',
    fontWeight: '600',
  },
  categoryChipTextSelected: {
    color: '#FFFFFF',
  },

  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4B5563',
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE4D9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    color: '#1A1A1A',
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 10,
  },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1B4332',
    paddingVertical: 9,
    borderRadius: 8,
  },
  submitBtnDisabled: {
    opacity: 0.65,
  },
  submitBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
