import { View, Text, StyleSheet, TouchableOpacity, Image, Alert, Linking, Modal, ScrollView } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { FileText, Image as ImageIcon, Upload, X, LogOut } from 'lucide-react-native';
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
    if (verificationStatus === 'verified') return 'VERIFICADO';
    if (verificationStatus === 'needs_correction') return 'CORRECCIÓN';
    if (verificationStatus === 'rejected') return 'RECHAZADO';
    return 'PENDIENTE';
  }, [verificationStatus]);

  const statusColor = useMemo(() => {
    if (verificationStatus === 'verified') return '#4ade80';
    if (verificationStatus === 'needs_correction') return '#f59e0b';
    if (verificationStatus === 'rejected') return '#fb7185';
    return '#f59e0b';
  }, [verificationStatus]);

  const fetchData = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      let { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
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
          const { data: updatedProfile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
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
        .eq('user_id', user.id)
        .maybeSingle();
      if (docsError) throw docsError;
      setDocs(docsData ?? null);
    } catch (e: any) {
      setDocs(null);
      setVerificationStatus('pending_verification');
      setRejectionReason(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`organizer-profile-verification-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
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
  }, [user?.id]);

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
      Alert.alert('Verificación requerida', 'Primero debes tener verificados los documentos para poder conectar Stripe.');
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
        throw new Error('Stripe no devolvió el enlace de onboarding.');
      }
      const can = await Linking.canOpenURL(url);
      if (!can) {
        throw new Error('No se pudo abrir el enlace de Stripe en este dispositivo.');
      }
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo iniciar la conexión con Stripe.');
    } finally {
      setStripeLoading(false);
    }
  };

  const refreshStripe = async () => {
    if (!user?.id) return;
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
      Alert.alert('Error', e?.message || 'No se pudo actualizar el estado de Stripe.');
    } finally {
      setStripeLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    if (verificationStatus !== 'verified') return;
    if (!stripeStatus.stripe_account_id) return;
    if (stripeStatus.stripe_onboarding_completed) return;
    refreshStripe();
  }, [user?.id, verificationStatus, stripeStatus.stripe_account_id, stripeStatus.stripe_onboarding_completed]);

  const pickBusinessDoc = async (kind: 'business_license' | 'tax_id') => {
    if (!canUpload) {
      Alert.alert('Envío deshabilitado', 'Tu estado actual no permite volver a enviar documentos.');
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
      Alert.alert('Envío deshabilitado', 'Tu estado actual no permite volver a enviar documentos.');
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería para subir una foto del local.');
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
      Alert.alert('Error', error ? `No se pudo generar el enlace del documento.\n\n${error}` : 'No se pudo generar el enlace del documento.');
      return;
    }
    setPreviewUrl(url);
  };

  const openExternal = async (path: string) => {
    const { url, error } = await createSignedUrlDetailed({ bucket: 'organizer_verification', path, expiresInSeconds: 60 * 10 });
    if (!url) {
      Alert.alert('Error', error ? `No se pudo generar el enlace del documento.\n\n${error}` : 'No se pudo generar el enlace del documento.');
      return;
    }
    Linking.openURL(url);
  };

  const save = async () => {
    if (!user?.id) return;
    if (!canUpload) {
      Alert.alert('Envío deshabilitado', 'Tu estado actual no permite volver a enviar la solicitud.');
      return;
    }

    if (!pickedBusinessLicense && !pickedTaxId && !pickedVenuePhoto) {
      Alert.alert('Sin cambios', 'Selecciona al menos un documento o foto para subir.');
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
        if (!upload) throw new Error('El documento de licencia no es válido o supera el tamaño permitido.');
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
        if (!upload) throw new Error('El documento CIF/NIF no es válido o supera el tamaño permitido.');
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
        if (!upload) throw new Error('La foto del local no es válida o supera el tamaño permitido.');
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

      Alert.alert('Enviado', 'Documentos subidos. Nuestro equipo revisará tu solicitud.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron subir los documentos.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <DiscoLoader size={150} label="Cargando verificación…" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#050510', '#0b1020', '#111b3a']} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
          <View style={styles.headerTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { fontSize: scaleFont(22) }]}>Verificación</Text>
              <Text style={styles.headerSubtitle}>Identidad de organizador</Text>
            </View>

            <TouchableOpacity onPress={handleSignOut} style={styles.logoutButton}>
              <GlassView intensity={22} style={styles.logoutButtonContainer}>
                <LogOut size={18} color={Colors.dark.text} />
              </GlassView>
            </TouchableOpacity>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.statusPill, { borderColor: statusColor }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {verificationStatus === 'pending_verification' && (
              <Text style={styles.pendingText}>Sube tus documentos. Revisamos tu solicitud lo antes posible.</Text>
            )}
            {verificationStatus === 'needs_correction' && (
              <Text style={styles.correctionText}>
                {rejectionReason ? `Corrección: ${rejectionReason}` : 'Tu solicitud requiere correcciones. Sube los documentos corregidos y envía de nuevo.'}
              </Text>
            )}
            {verificationStatus === 'rejected' && (
              <Text style={styles.rejectedText}>
                {rejectionReason ? `Motivo: ${rejectionReason}` : 'Tu verificación fue rechazada.'} No puedes volver a enviar la solicitud.
              </Text>
            )}
            {verificationStatus === 'verified' && <Text style={styles.verifiedText}>Cuenta lista. Configura Stripe para empezar a cobrar.</Text>}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding, alignItems: 'center' }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: '100%', maxWidth: maxContentWidth }}>
            <GlassView intensity={10} style={styles.card}>
              <Text style={[styles.sectionTitle, { fontSize: scaleFont(16) }]}>Documentos</Text>

              <View style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <FileText size={18} color={Colors.dark.text} />
                  <View>
                    <Text style={styles.itemTitle}>Licencia de actividad</Text>
                    <Text style={styles.itemSubtitle}>
                      {pickedBusinessLicense?.name || (docs?.business_license_path ? 'Subido' : 'PDF o imagen')}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    onPress={() => pickBusinessDoc('business_license')}
                    style={[styles.smallButton, (!canUpload || saving) && { opacity: 0.45 }]}
                    disabled={!canUpload || saving}
                  >
                    <Upload size={18} color="white" />
                  </TouchableOpacity>
                  {docs?.business_license_path && (
                    <TouchableOpacity onPress={() => openExternal(docs.business_license_path!)} style={styles.smallButtonOutline}>
                      <Text style={styles.smallButtonText}>Ver</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <FileText size={18} color={Colors.dark.text} />
                  <View>
                    <Text style={styles.itemTitle}>CIF / NIF</Text>
                    <Text style={styles.itemSubtitle}>
                      {pickedTaxId?.name || (docs?.tax_id_path ? 'Subido' : 'PDF o imagen')}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    onPress={() => pickBusinessDoc('tax_id')}
                    style={[styles.smallButton, (!canUpload || saving) && { opacity: 0.45 }]}
                    disabled={!canUpload || saving}
                  >
                    <Upload size={18} color="white" />
                  </TouchableOpacity>
                  {docs?.tax_id_path && (
                    <TouchableOpacity onPress={() => openExternal(docs.tax_id_path!)} style={styles.smallButtonOutline}>
                      <Text style={styles.smallButtonText}>Ver</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <ImageIcon size={18} color={Colors.dark.text} />
                  <View>
                    <Text style={styles.itemTitle}>Foto del local</Text>
                    <Text style={styles.itemSubtitle}>
                      {pickedVenuePhoto?.name || (docs?.venue_photo_path ? 'Subido' : 'Imagen')}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    onPress={pickVenuePhoto}
                    style={[styles.smallButton, (!canUpload || saving) && { opacity: 0.45 }]}
                    disabled={!canUpload || saving}
                  >
                    <Upload size={18} color="white" />
                  </TouchableOpacity>
                  {docs?.venue_photo_path && (
                    <TouchableOpacity onPress={() => openDoc(docs.venue_photo_path!)} style={styles.smallButtonOutline}>
                      <Text style={styles.smallButtonText}>Ver</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={{ marginTop: 16 }}>
                <ThemedButton
                  title={saving ? 'Subiendo...' : canUpload ? 'Guardar y enviar' : 'Envío deshabilitado'}
                  onPress={save}
                  disabled={saving || !canUpload}
                  icon={<Upload size={18} color="white" />}
                />
              </View>
            </GlassView>

            {verificationStatus === 'verified' && (
              <GlassView intensity={10} style={[styles.card, { marginTop: 14 }]}>
                <Text style={[styles.sectionTitle, { fontSize: scaleFont(16) }]}>Pagos (Stripe)</Text>

                <View style={[styles.itemRow, { borderTopWidth: 0 }]}>
                  <View style={styles.itemLeft}>
                    <View>
                      <Text style={styles.itemTitle}>Estado</Text>
                      <Text style={styles.itemSubtitle}>
                        {stripeStatus.stripe_onboarding_completed
                          ? 'Listo para recibir pagos'
                          : stripeStatus.stripe_account_id
                            ? 'Conexión pendiente'
                            : 'No conectado'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.itemActions}>
                    <TouchableOpacity
                      onPress={refreshStripe}
                      style={styles.smallButtonOutline}
                      disabled={stripeLoading || !stripeStatus.stripe_account_id}
                    >
                      <Text style={styles.smallButtonText}>Actualizar</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <ThemedButton
                    title={
                      stripeLoading
                        ? 'Cargando...'
                        : stripeStatus.stripe_onboarding_completed
                          ? 'Stripe conectado'
                          : stripeStatus.stripe_account_id
                            ? 'Completar onboarding'
                            : 'Conectar Stripe'
                    }
                    onPress={connectStripe}
                    disabled={stripeLoading || stripeStatus.stripe_onboarding_completed}
                  />
                </View>
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  pendingText: { flex: 1, color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '600' },
  correctionText: { flex: 1, color: 'rgba(245,158,11,0.95)', fontSize: 12, fontWeight: '700' },
  rejectedText: { flex: 1, color: 'rgba(251,113,133,0.9)', fontSize: 12, fontWeight: '600' },
  verifiedText: { flex: 1, color: 'rgba(74,222,128,0.85)', fontSize: 12, fontWeight: '700' },
  logoutButton: { width: 44, height: 44 },
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
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sectionTitle: { color: Colors.dark.text, fontWeight: '900', marginBottom: 12, letterSpacing: -0.2 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  itemTitle: { color: Colors.dark.text, fontWeight: '900', letterSpacing: -0.2 },
  itemSubtitle: { color: 'rgba(255,255,255,0.55)', marginTop: 2, fontSize: 12 },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallButton: {
    width: 44,
    height: 44,
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
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  smallButtonText: { color: 'white', fontWeight: '800', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { width: '100%', maxWidth: 520, aspectRatio: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalClose: { position: 'absolute', top: 12, right: 12, zIndex: 2, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '100%', height: '100%' },
});
