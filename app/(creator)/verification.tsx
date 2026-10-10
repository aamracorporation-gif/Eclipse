import { AppState, View, Text, StyleSheet, TouchableOpacity, Image, Alert, Linking, Modal, ScrollView } from 'react-native';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { FileText, Image as ImageIcon, Upload, X, LogOut } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { createSignedUrlDetailed, uploadOrganizerVerificationFile } from '@/lib/storage';
import { useResponsive } from '@/lib/responsive';
import * as ExpoLinking from 'expo-linking';
import { createStripeConnectAccount, createStripeConnectOnboardingLink, refreshStripeConnectStatus } from '@/lib/payments/api';
import { useTranslation } from 'react-i18next';

type VerificationStatus = 'pending_verification' | 'verified' | 'rejected' | 'needs_correction' | null;

type OrganizerDocumentsRow = {
  user_id: string;
  business_license_path: string | null;
  tax_id_path: string | null;
  venue_photo_path: string | null;
};

type StripeConnectStatus = {
  stripe_account_id: string | null;
  stripe_onboarding_completed: boolean;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
};

type PickedFile = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
};

export default function OrganizerVerificationScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();
  const { t } = useTranslation();
  const userId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [docs, setDocs] = useState<OrganizerDocumentsRow | null>(null);
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatus>({
    stripe_account_id: null,
    stripe_onboarding_completed: false,
    stripe_details_submitted: false,
    stripe_charges_enabled: false,
    stripe_payouts_enabled: false,
  });
  const [stripeLoading, setStripeLoading] = useState(false);

  const [pickedBusinessLicense, setPickedBusinessLicense] = useState<PickedFile | null>(null);
  const [pickedTaxId, setPickedTaxId] = useState<PickedFile | null>(null);
  const [pickedVenuePhoto, setPickedVenuePhoto] = useState<PickedFile | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const canUpload = useMemo(
    () => verificationStatus === 'pending_verification' || verificationStatus === 'needs_correction',
    [verificationStatus]
  );

  const statusLabel = useMemo(() => {
    if (verificationStatus === 'verified') return t('creator.verification.status.verified');
    if (verificationStatus === 'needs_correction') return t('creator.verification.status.needs_correction');
    if (verificationStatus === 'rejected') return t('creator.verification.status.rejected');
    return t('creator.verification.status.pending');
  }, [t, verificationStatus]);

  const statusColor = useMemo(() => {
    if (verificationStatus === 'verified') return '#4ade80';
    if (verificationStatus === 'needs_correction') return '#f59e0b';
    if (verificationStatus === 'rejected') return '#fb7185';
    return '#f59e0b';
  }, [verificationStatus]);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      let { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) throw profileError;

      if (profileData?.role !== 'organizer') {
        router.replace('/(creator)');
        return;
      }

      const currentVerificationStatus = (profileData?.verification_status as any) ?? 'pending_verification';

      if (currentVerificationStatus === 'verified' && profileData && !profileData.stripe_account_id) {
        try {
          await createStripeConnectAccount();
          const { data: updatedProfile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
          if (updatedProfile) profileData = updatedProfile;
        } catch {}
      }

      setVerificationStatus((profileData?.verification_status as any) ?? 'pending_verification');
      setRejectionReason(profileData?.verification_rejection_reason ?? null);
      setStripeStatus({
        stripe_account_id: (profileData as any)?.stripe_account_id ?? null,
        stripe_onboarding_completed: !!(profileData as any)?.stripe_onboarding_completed,
        stripe_details_submitted: !!(profileData as any)?.stripe_details_submitted,
        stripe_charges_enabled: !!(profileData as any)?.stripe_charges_enabled,
        stripe_payouts_enabled: !!(profileData as any)?.stripe_payouts_enabled,
      });

      const { data: docsData, error: docsError } = await supabase
        .from('organizer_verification_documents')
        .select('user_id, business_license_path, tax_id_path, venue_photo_path')
        .eq('user_id', userId)
        .maybeSingle();
      if (docsError) {
        // A document read failure must not undo the authoritative approval state.
        setDocs(null);
        return;
      }
      setDocs(docsData ?? null);
    } catch {
      setDocs(null);
      setVerificationStatus('pending_verification');
      setRejectionReason(null);
    } finally {
      setLoading(false);
    }
  }, [router, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`organizer-profile-verification-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const next = (payload.new as any)?.verification_status ?? null;
          setVerificationStatus(next);
          fetchData();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData, userId]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      router.replace('/(auth)/login');
    }
  };

  const connectStripe = async () => {
    if (!user?.id) return;
    if (verificationStatus !== 'verified') {
      Alert.alert(t('creator.verification.stripe.required_title'), t('creator.verification.stripe.required_body'));
      return;
    }
    setStripeLoading(true);
    try {
      const { stripe_account_id } = await createStripeConnectAccount();
      const return_url = ExpoLinking.createURL('/(creator)/verification', { queryParams: { stripe: 'return' } });
      const refresh_url = ExpoLinking.createURL('/(creator)/verification', { queryParams: { stripe: 'refresh' } });
      const { url } = await createStripeConnectOnboardingLink({ return_url, refresh_url });
      setStripeStatus((prev) => ({ ...prev, stripe_account_id }));
      if (!url || typeof url !== 'string') {
        throw new Error(t('creator.verification.stripe.no_url'));
      }
      const can = await Linking.canOpenURL(url);
      if (!can) {
        throw new Error(t('creator.verification.stripe.cannot_open'));
      }
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('creator.verification.stripe.start_failed'));
    } finally {
      setStripeLoading(false);
    }
  };

  const disconnectStripe = useCallback(async () => {
    if (!userId || !stripeStatus.stripe_account_id) return;
    Alert.alert(
      'Desconectar cuenta',
      'Se eliminará la cuenta de Stripe Connect vinculada. Tendrás que volver a conectarla para cobrar entradas. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setStripeLoading(true);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const jwt = session?.access_token;
              if (!jwt) throw new Error('No session');
              const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
              const res = await fetch(`${supabaseUrl}/functions/v1/stripe-connect-delete-account`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${jwt}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
              });
              const json = await res.json().catch(() => ({}));
              if (!res.ok || !json?.ok) throw new Error(json?.error || 'Error al eliminar');
              setStripeStatus({
                stripe_account_id: null,
                stripe_onboarding_completed: false,
                stripe_details_submitted: false,
                stripe_charges_enabled: false,
                stripe_payouts_enabled: false,
              });
              Alert.alert('Cuenta eliminada', 'La cuenta de Stripe Connect ha sido desconectada correctamente.');
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message || 'No se pudo eliminar la cuenta.');
            } finally {
              setStripeLoading(false);
            }
          },
        },
      ]
    );
  }, [userId, stripeStatus.stripe_account_id, t]);

  const refreshStripe = useCallback(async () => {
    if (!userId) return;
    setStripeLoading(true);
    try {
      const status = await refreshStripeConnectStatus();
      setStripeStatus({
        stripe_account_id: status.stripe_account_id,
        stripe_onboarding_completed: status.stripe_onboarding_completed,
        stripe_details_submitted: status.stripe_details_submitted,
        stripe_charges_enabled: status.stripe_charges_enabled,
        stripe_payouts_enabled: status.stripe_payouts_enabled,
      });
      await fetchData();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('creator.verification.stripe.refresh_failed'));
    } finally {
      setStripeLoading(false);
    }
  }, [fetchData, t, userId]);

  useEffect(() => {
    if (!userId) return;
    if (verificationStatus !== 'verified') return;
    if (!stripeStatus.stripe_account_id) return;
    if (stripeStatus.stripe_onboarding_completed) return;
    refreshStripe();
  }, [refreshStripe, stripeStatus.stripe_account_id, stripeStatus.stripe_onboarding_completed, userId, verificationStatus]);

  useEffect(() => {
    if (verificationStatus !== 'verified' || !stripeStatus.stripe_account_id) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshStripe();
    });
    return () => subscription.remove();
  }, [refreshStripe, stripeStatus.stripe_account_id, verificationStatus]);

  const pickBusinessDoc = async (kind: 'business_license' | 'tax_id') => {
    if (!canUpload) {
      Alert.alert(t('creator.verification.upload_disabled_title'), t('creator.verification.upload_disabled_body_docs'));
      return;
    }
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;

    const picked: PickedFile = {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
    };

    if (kind === 'business_license') setPickedBusinessLicense(picked);
    else setPickedTaxId(picked);
  };

  const pickVenuePhoto = async () => {
    if (!canUpload) {
      Alert.alert(t('creator.verification.upload_disabled_title'), t('creator.verification.upload_disabled_body_docs'));
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('creator.verification.permission_required_title'), t('creator.verification.permission_required_body'));
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });

    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) return;

    setPickedVenuePhoto({
      uri: asset.uri,
      name: asset.fileName ?? null,
      mimeType: asset.mimeType ?? null,
    });
  };

  const openDoc = async (path: string) => {
    const { url, error } = await createSignedUrlDetailed({ bucket: 'organizer_verification', path, expiresInSeconds: 60 * 10 });
    if (!url) {
      Alert.alert(t('common.error'), error ? t('creator.verification.link_failed_with_error', { error }) : t('creator.verification.link_failed'));
      return;
    }
    setPreviewUrl(url);
  };

  const openExternal = async (path: string) => {
    const { url, error } = await createSignedUrlDetailed({ bucket: 'organizer_verification', path, expiresInSeconds: 60 * 10 });
    if (!url) {
      Alert.alert(t('common.error'), error ? t('creator.verification.link_failed_with_error', { error }) : t('creator.verification.link_failed'));
      return;
    }
    Linking.openURL(url);
  };

  const save = async () => {
    if (!user?.id) return;
    if (!canUpload) {
      Alert.alert(t('creator.verification.upload_disabled_title'), t('creator.verification.upload_disabled_body_request'));
      return;
    }

    if (!pickedBusinessLicense && !pickedTaxId && !pickedVenuePhoto) {
      Alert.alert(t('creator.verification.no_changes_title'), t('creator.verification.no_changes_body'));
      return;
    }

    setSaving(true);
    try {
      const updates: Partial<OrganizerDocumentsRow> & { user_id: string } = { user_id: user.id };

      if (pickedBusinessLicense) {
        const upload = await uploadOrganizerVerificationFile({
          uri: pickedBusinessLicense.uri,
          userId: user.id,
          kind: 'business_license',
          fileName: pickedBusinessLicense.name,
          mimeType: pickedBusinessLicense.mimeType,
        });
        if (!upload) throw new Error(t('creator.verification.errors.invalid_business_license'));
        updates.business_license_path = upload.path;
      }

      if (pickedTaxId) {
        const upload = await uploadOrganizerVerificationFile({
          uri: pickedTaxId.uri,
          userId: user.id,
          kind: 'tax_id',
          fileName: pickedTaxId.name,
          mimeType: pickedTaxId.mimeType,
        });
        if (!upload) throw new Error(t('creator.verification.errors.invalid_tax_id'));
        updates.tax_id_path = upload.path;
      }

      if (pickedVenuePhoto) {
        const upload = await uploadOrganizerVerificationFile({
          uri: pickedVenuePhoto.uri,
          userId: user.id,
          kind: 'venue_photo',
          fileName: pickedVenuePhoto.name,
          mimeType: pickedVenuePhoto.mimeType,
        });
        if (!upload) throw new Error(t('creator.verification.errors.invalid_venue_photo'));
        updates.venue_photo_path = upload.path;
      }

      const { error } = await supabase
        .from('organizer_verification_documents')
        .upsert(updates, { onConflict: 'user_id' });

      if (error) throw error;

      setPickedBusinessLicense(null);
      setPickedTaxId(null);
      setPickedVenuePhoto(null);
      await fetchData();

      Alert.alert(t('creator.verification.submitted_title'), t('creator.verification.submitted_body'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('creator.verification.submit_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <DiscoLoader size={150} label={t('creator.verification.loading')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#050510', '#0b1020', '#111b3a']} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
        <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
          <View style={styles.headerTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { fontSize: scaleFont(22) }]}>{t('creator.verification.title')}</Text>
              <Text style={styles.headerSubtitle}>{t('creator.verification.subtitle')}</Text>
            </View>

            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar sesión" onPress={handleSignOut} style={styles.logoutButton}>
              <GlassView intensity={22} style={styles.logoutButtonContainer} contentContainerStyle={{ padding: 0, flex: 1, alignItems: "center", justifyContent: "center" }}>
                <LogOut size={18} color={Colors.dark.text} />
              </GlassView>
            </TouchableOpacity>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.statusPill, { borderColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {verificationStatus === 'pending_verification' && (
              <Text style={styles.pendingText}>{t('creator.verification.status_messages.pending')}</Text>
            )}
            {verificationStatus === 'needs_correction' && (
              <Text style={styles.correctionText}>
                {rejectionReason
                  ? t('creator.verification.status_messages.correction_with_reason', { reason: rejectionReason })
                  : t('creator.verification.status_messages.correction')}
              </Text>
            )}
            {verificationStatus === 'rejected' && (
              <Text style={styles.rejectedText}>
                {rejectionReason
                  ? t('creator.verification.status_messages.rejected_with_reason', { reason: rejectionReason })
                  : t('creator.verification.status_messages.rejected')}
              </Text>
            )}
            {verificationStatus === 'verified' && <Text style={styles.verifiedText}>{t('creator.verification.status_messages.verified')}</Text>}
          </View>
        </View>

          <View style={{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: horizontalPadding }}>
            <GlassView intensity={10} style={styles.card} contentContainerStyle={styles.cardContent}>
              <Text style={[styles.sectionTitle, { fontSize: scaleFont(16) }]}>{t('creator.verification.documents.title')}</Text>

              <View style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <FileText size={18} color={Colors.dark.text} />
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{t('creator.verification.documents.business_license')}</Text>
                    <Text style={styles.itemSubtitle} numberOfLines={2} ellipsizeMode="middle">
                      {pickedBusinessLicense?.name || (docs?.business_license_path ? t('creator.verification.documents.uploaded') : t('creator.verification.documents.pdf_or_image'))}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Adjuntar: ${t('creator.verification.documents.business_license')}`}
                    onPress={() => pickBusinessDoc('business_license')}
                    style={[styles.smallButton, (!canUpload || saving) && { opacity: 0.45 }]}
                    disabled={!canUpload || saving}
                  >
                    <Upload size={18} color="white" />
                  </TouchableOpacity>
                  {docs?.business_license_path && (
                    <TouchableOpacity onPress={() => openExternal(docs.business_license_path!)} style={styles.smallButtonOutline}>
                      <Text style={styles.smallButtonText}>{t('creator.verification.documents.view')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <FileText size={18} color={Colors.dark.text} />
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>CIF / NIF</Text>
                    <Text style={styles.itemSubtitle} numberOfLines={2} ellipsizeMode="middle">
                      {pickedTaxId?.name || (docs?.tax_id_path ? t('creator.verification.documents.uploaded') : t('creator.verification.documents.pdf_or_image'))}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Adjuntar: ${'CIF / NIF'}`}
                    onPress={() => pickBusinessDoc('tax_id')}
                    style={[styles.smallButton, (!canUpload || saving) && { opacity: 0.45 }]}
                    disabled={!canUpload || saving}
                  >
                    <Upload size={18} color="white" />
                  </TouchableOpacity>
                  {docs?.tax_id_path && (
                    <TouchableOpacity onPress={() => openExternal(docs.tax_id_path!)} style={styles.smallButtonOutline}>
                      <Text style={styles.smallButtonText}>{t('creator.verification.documents.view')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <ImageIcon size={18} color={Colors.dark.text} />
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{t('creator.verification.documents.venue_photo')}</Text>
                    <Text style={styles.itemSubtitle} numberOfLines={2} ellipsizeMode="middle">
                      {pickedVenuePhoto?.name || (docs?.venue_photo_path ? t('creator.verification.documents.uploaded') : t('creator.verification.documents.image'))}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Adjuntar: ${t('creator.verification.documents.venue_photo')}`}
                    onPress={pickVenuePhoto}
                    style={[styles.smallButton, (!canUpload || saving) && { opacity: 0.45 }]}
                    disabled={!canUpload || saving}
                  >
                    <Upload size={18} color="white" />
                  </TouchableOpacity>
                  {docs?.venue_photo_path && (
                    <TouchableOpacity onPress={() => openDoc(docs.venue_photo_path!)} style={styles.smallButtonOutline}>
                      <Text style={styles.smallButtonText}>{t('creator.verification.documents.view')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={{ marginTop: 16 }}>
                <ThemedButton
                  title={
                    saving
                      ? t('creator.verification.actions.uploading')
                      : canUpload
                        ? t('creator.verification.actions.save_and_submit')
                        : t('creator.verification.actions.upload_disabled')
                  }
                  onPress={save}
                  disabled={saving || !canUpload}
                  icon={<Upload size={18} color="white" />}
                />
              </View>
            </GlassView>

            {verificationStatus === 'verified' && (
              <GlassView intensity={10} style={[styles.card, { marginTop: 14 }]} contentContainerStyle={styles.cardContent}>
                <Text style={[styles.sectionTitle, { fontSize: scaleFont(16) }]}>{t('creator.verification.stripe.title')}</Text>

                <View style={[styles.itemRow, { borderTopWidth: 0 }]}>
                  <View style={styles.itemLeft}>
                    <View style={styles.itemText}>
                      <Text style={styles.itemTitle}>{t('creator.verification.stripe.status_label')}</Text>
                      <Text style={styles.itemSubtitle}>
                        {stripeStatus.stripe_onboarding_completed
                          ? t('creator.verification.stripe.status_ready')
                          : stripeStatus.stripe_account_id
                            ? t('creator.verification.stripe.status_pending')
                            : t('creator.verification.stripe.status_not_connected')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.itemActions}>
                    <TouchableOpacity
                      onPress={refreshStripe}
                      style={styles.smallButtonOutline}
                      disabled={stripeLoading || !stripeStatus.stripe_account_id}
                    >
                      <Text style={styles.smallButtonText}>{t('creator.verification.stripe.refresh')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <ThemedButton
                    title={
                      stripeLoading
                        ? t('creator.verification.stripe.loading')
                        : stripeStatus.stripe_onboarding_completed
                          ? t('creator.verification.stripe.connected')
                          : stripeStatus.stripe_account_id
                            ? t('creator.verification.stripe.complete_onboarding')
                            : t('creator.verification.stripe.connect')
                    }
                    onPress={connectStripe}
                    disabled={stripeLoading || stripeStatus.stripe_onboarding_completed}
                  />
                </View>
                {stripeStatus.stripe_account_id && (
                  <View style={{ marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={disconnectStripe}
                      disabled={stripeLoading}
                      style={[styles.smallButtonOutline, { borderColor: 'rgba(239,68,68,0.5)', alignItems: 'center' }]}
                    >
                      <Text style={[styles.smallButtonText, { color: '#EF4444' }]}>Eliminar cuenta conectada</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </GlassView>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={!!previewUrl} transparent animationType="fade" onRequestClose={() => setPreviewUrl(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setPreviewUrl(null)} style={styles.modalClose}>
              <X size={22} color="white" />
            </TouchableOpacity>
            {previewUrl ? (
              <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background },
  header: { paddingTop: 10, paddingBottom: 12 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { color: Colors.dark.text, fontWeight: '900', letterSpacing: -0.4 },
  headerSubtitle: { marginTop: 4, color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  statusRow: { alignItems: 'flex-start', gap: 10, marginTop: 12 },
  statusPill: { maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  pendingText: { flexShrink: 1, color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '600' },
  correctionText: { flexShrink: 1, color: 'rgba(245,158,11,0.95)', fontSize: 12, fontWeight: '700' },
  rejectedText: { flexShrink: 1, color: 'rgba(251,113,133,0.9)', fontSize: 12, fontWeight: '600' },
  verifiedText: { flexShrink: 1, color: 'rgba(74,222,128,0.85)', fontSize: 12, fontWeight: '700' },
  logoutButton: { width: 44, height: 44, flexShrink: 0 },
  logoutButtonContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  content: { paddingTop: 10, paddingBottom: 28 },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  cardContent: { padding: 16 },
  itemText: { flex: 1, minWidth: 0 },
  sectionTitle: { color: Colors.dark.text, fontWeight: '900', marginBottom: 12, letterSpacing: -0.2 },
  itemRow: {
    alignItems: 'stretch',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  itemLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 },
  itemTitle: { color: Colors.dark.text, fontWeight: '900', letterSpacing: -0.2 },
  itemSubtitle: { color: 'rgba(255,255,255,0.55)', marginTop: 2, fontSize: 12 },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  smallButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 14,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.dark.primary,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  smallButtonOutline: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    maxWidth: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  smallButtonText: { textAlign: 'center', flexShrink: 1, color: 'white', fontWeight: '800', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { width: '100%', maxWidth: 520, aspectRatio: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalClose: { position: 'absolute', top: 12, right: 12, zIndex: 2, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '100%', height: '100%' },
});
