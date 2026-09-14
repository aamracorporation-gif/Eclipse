import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, Image, TextInput, Linking, ScrollView, FlatList } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, XCircle, FileText, Image as ImageIcon, ExternalLink, X, Search, Ban, ShieldCheck } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { createSignedUrlDetailed } from '@/lib/storage';
import { useResponsive } from '@/lib/responsive';

type OrganizerRow = {
  id: string;
  full_name: string | null;
  email?: string | null;
  role?: string | null;
  club_name: string | null;
  address: string | null;
  instagram_account: string | null;
  business_email: string | null;
  created_at?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  verification_status?: string | null;
  verification_rejection_reason?: string | null;
  verification_reviewed_at?: string | null;
  is_suspended?: boolean | null;
  suspended_reason?: string | null;
};

type DocsRow = {
  user_id: string;
  business_license_path: string | null;
  tax_id_path: string | null;
  venue_photo_path: string | null;
};

type AuditLogRow = {
  id: string;
  action: string;
  target_user_id: string | null;
  details: any;
  created_at: string;
};

type VerificationActionMode = 'rejected' | 'needs_correction';

const extractMissingColumn = (err: any) => {
  const msg = (err?.message ?? err?.error_description ?? err?.details ?? '').toString();
  const m1 = msg.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (m1?.[1]) return m1[1];
  const m2 = msg.match(/column\s+[a-zA-Z0-9_]+\."?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (m2?.[1]) return m2[1];
  return null;
};

const PAGE_SIZE = 25;
const DEFAULT_ORGANIZER_LIKE_CLAUSE = 'role.eq.organizer,club_name.not.is.null,business_email.not.is.null,instagram_account.not.is.null';

export default function AdminVerificationScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();

  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminDb, setIsAdminDb] = useState(false);

  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    needs_correction: 0,
    verified: 0,
    rejected: 0,
    suspended: 0,
  });

  const [activeFilter, setActiveFilter] = useState<'all' | 'pending_verification' | 'needs_correction' | 'verified' | 'rejected' | 'suspended'>('pending_verification');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  const [organizers, setOrganizers] = useState<OrganizerRow[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const pageRef = useRef(0);
  const listRequestKeyRef = useRef(0);

  const [docsByUser, setDocsByUser] = useState<Record<string, DocsRow>>({});
  const docsByUserRef = useRef<Record<string, DocsRow>>({});
  const docsLoadingRef = useRef<Set<string>>(new Set());
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  const [reviewUserId, setReviewUserId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewMode, setReviewMode] = useState<VerificationActionMode>('rejected');

  const [suspendUserId, setSuspendUserId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [globalMatches, setGlobalMatches] = useState<OrganizerRow[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const logsLoadingRef = useRef(false);
  const missingColumnsRef = useRef<Set<string>>(new Set());

  const buildOrganizerLikeClause = useCallback(() => {
    const missing = missingColumnsRef.current;
    const parts: string[] = [];
    if (!missing.has('role')) parts.push('role.eq.organizer');
    if (!missing.has('club_name')) parts.push('club_name.not.is.null');
    if (!missing.has('business_email')) parts.push('business_email.not.is.null');
    if (!missing.has('instagram_account')) parts.push('instagram_account.not.is.null');
    return parts.length > 0 ? parts.join(',') : 'id.not.is.null';
  }, []);

  const buildProfilesSelect = useCallback(() => {
    const missing = missingColumnsRef.current;
    const cols: string[] = ['id'];
    if (!missing.has('role')) cols.push('role');
    if (!missing.has('full_name')) cols.push('full_name');
    if (!missing.has('email')) cols.push('email');
    if (!missing.has('club_name')) cols.push('club_name');
    if (!missing.has('address')) cols.push('address');
    if (!missing.has('instagram_account')) cols.push('instagram_account');
    if (!missing.has('business_email')) cols.push('business_email');
    if (!missing.has('phone')) cols.push('phone');
    if (!missing.has('city')) cols.push('city');
    if (!missing.has('country')) cols.push('country');
    if (!missing.has('created_at')) cols.push('created_at');
    if (!missing.has('verification_status')) cols.push('verification_status');
    if (!missing.has('verification_rejection_reason')) cols.push('verification_rejection_reason');
    if (!missing.has('verification_reviewed_at')) cols.push('verification_reviewed_at');
    if (!missing.has('is_suspended')) cols.push('is_suspended');
    if (!missing.has('suspended_reason')) cols.push('suspended_reason');
    return cols.join(',');
  }, []);

  const fetchAdminStatus = useCallback(async () => {
    if (!user?.id) return;
    setCheckingAdmin(true);
    try {
      const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (error) throw error;
      const dbAdmin = data?.role === 'admin';
      setIsAdminDb(dbAdmin);
      setIsAdmin(dbAdmin);
    } catch {
      setIsAdminDb(false);
      setIsAdmin(false);
    } finally {
      setCheckingAdmin(false);
    }
  }, [user?.id]);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const missing = missingColumnsRef.current;

      const runOnce = async () => {
        const organizerLikeClause = buildOrganizerLikeClause();
        const base = () =>
          supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .or(organizerLikeClause);

        const total = await base();

        const pending = !missing.has('verification_status')
          ? await supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .or(`and(or(${organizerLikeClause}),or(verification_status.eq.pending_verification,verification_status.is.null))`)
          : { count: 0 } as any;

        const needsCorrection = !missing.has('verification_status')
          ? await supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .or(`and(or(${organizerLikeClause}),verification_status.eq.needs_correction)`)
          : { count: 0 } as any;

        const verified = !missing.has('verification_status')
          ? await supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .or(`and(or(${organizerLikeClause}),verification_status.eq.verified)`)
          : { count: 0 } as any;

        const rejected = !missing.has('verification_status')
          ? await supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .or(`and(or(${organizerLikeClause}),verification_status.eq.rejected)`)
          : { count: 0 } as any;

        const suspended = !missing.has('is_suspended')
          ? await supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .or(`and(or(${organizerLikeClause}),is_suspended.eq.true)`)
          : { count: 0 } as any;

        return { total, pending, needsCorrection, verified, rejected, suspended };
      };

      let result: any;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runOnce();
        const err =
          r.total?.error ||
          r.pending?.error ||
          r.needsCorrection?.error ||
          r.verified?.error ||
          r.rejected?.error ||
          r.suspended?.error;
        if (!err) {
          result = r;
          break;
        }

        const missingCol = extractMissingColumn(err);
        if (missingCol && !missingColumnsRef.current.has(missingCol)) {
          missingColumnsRef.current.add(missingCol);
          continue;
        }

        throw err;
      }

      const { total, pending, needsCorrection, verified, rejected, suspended } = result;

      const next = {
        total: total.count ?? 0,
        pending: pending.count ?? 0,
        needs_correction: needsCorrection.count ?? 0,
        verified: verified.count ?? 0,
        rejected: rejected.count ?? 0,
        suspended: suspended.count ?? 0,
      };
      setStats(next);
    } catch {
      setStats({
        total: 0,
        pending: 0,
        needs_correction: 0,
        verified: 0,
        rejected: 0,
        suspended: 0,
      });
    } finally {
      setLoadingStats(false);
    }
  }, [buildOrganizerLikeClause]);

  const buildProfilesQuery = useCallback((opts: { filter: typeof activeFilter; searchValue: string; pageValue: number }) => {
    const { filter, searchValue, pageValue } = opts;
    const missing = missingColumnsRef.current;
    const organizerLikeClause = buildOrganizerLikeClause();
    const orderColumn = missing.has('created_at') ? 'id' : 'created_at';

    let q = supabase
        .from('profiles')
      .select(buildProfilesSelect(), { count: 'exact' });

    const raw = (searchValue || '').trim();
    const andParts: string[] = organizerLikeClause ? [`or(${organizerLikeClause})`] : [`or(${DEFAULT_ORGANIZER_LIKE_CLAUSE})`];
    if (filter === 'suspended') {
      if (!missing.has('is_suspended')) andParts.push('is_suspended.eq.true');
    } else if (filter === 'pending_verification') {
      if (!missing.has('verification_status')) andParts.push('or(verification_status.eq.pending_verification,verification_status.is.null)');
    } else if (filter !== 'all') {
      if (!missing.has('verification_status')) andParts.push(`verification_status.eq.${filter}`);
    }

    if (raw.length > 0) {
      const safe = raw.replace(/[%]/g, '').replace(/,/g, ' ').slice(0, 64);
      const searchParts: string[] = [];
      if (!missing.has('club_name')) searchParts.push(`club_name.ilike.%${safe}%`);
      if (!missing.has('full_name')) searchParts.push(`full_name.ilike.%${safe}%`);
      if (!missing.has('business_email')) searchParts.push(`business_email.ilike.%${safe}%`);
      if (!missing.has('email')) searchParts.push(`email.ilike.%${safe}%`);
      if (searchParts.length > 0) andParts.push(`or(${searchParts.join(',')})`);
    }

    if (andParts.length === 1) q = q.or(andParts[0]);
    else q = q.or(`and(${andParts.join(',')})`);

    const from = pageValue * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    return q.order(orderColumn, { ascending: false }).range(from, to);
  }, [buildOrganizerLikeClause, buildProfilesSelect]);

  const fetchOrganizers = useCallback(async (opts: { reset: boolean }) => {
    const requestKey = ++listRequestKeyRef.current;
    if (opts.reset) {
      setLoadingList(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const nextPage = opts.reset ? 0 : pageRef.current + 1;
      let data: any;
      let count: any;
      let lastError: any = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await buildProfilesQuery({
          filter: activeFilter,
          searchValue: searchDebounced,
          pageValue: nextPage,
        });
        data = (res as any).data;
        count = (res as any).count;
        const error = (res as any).error;
        if (!error) {
          lastError = null;
          break;
        }

        lastError = error;
        const missingCol = extractMissingColumn(error);
        if (missingCol && !missingColumnsRef.current.has(missingCol)) {
          missingColumnsRef.current.add(missingCol);
          continue;
        }
        break;
      }

      if (lastError) throw lastError;
      if (requestKey !== listRequestKeyRef.current) return;

      const rows = (data ?? []) as OrganizerRow[];
      setTotalCount(count ?? null);
      pageRef.current = nextPage;
      setOrganizers((prev) => (opts.reset ? rows : [...prev, ...rows]));
    } catch (e: any) {
      if (opts.reset) {
        setOrganizers([]);
        setTotalCount(null);
      }
      Alert.alert('Error', e?.message ? `No se pudieron cargar los perfiles.\n\n${e.message}` : 'No se pudieron cargar los perfiles.');
    } finally {
      if (opts.reset) {
        setLoadingList(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [activeFilter, buildProfilesQuery, searchDebounced]);

  const ensureDocsLoaded = async (targetUserId: string) => {
    if (docsByUser[targetUserId]) return;
    try {
      const { data, error } = await supabase
        .from('organizer_verification_documents')
        .select('user_id, business_license_path, tax_id_path, venue_photo_path')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return;
      setDocsByUser((prev) => ({ ...prev, [targetUserId]: data as any }));
    } catch {
      Alert.alert('Error', 'No se pudieron cargar los documentos del organizador.');
    }
  };

  useEffect(() => {
    docsByUserRef.current = docsByUser;
  }, [docsByUser]);

  const prefetchDocsForUsers = useCallback(
    async (userIds: string[]) => {
      if (!isAdminDb) return;

      const unique = Array.from(new Set((userIds || []).filter(Boolean)));
      const toLoad = unique.filter((id) => !docsByUserRef.current[id] && !docsLoadingRef.current.has(id));
      if (toLoad.length === 0) return;

      toLoad.forEach((id) => docsLoadingRef.current.add(id));
      try {
        const { data, error } = await supabase
          .from('organizer_verification_documents')
          .select('user_id, business_license_path, tax_id_path, venue_photo_path')
          .in('user_id', toLoad);
        if (error) throw error;

        const next: Record<string, DocsRow> = {};
        for (const row of (data ?? []) as DocsRow[]) {
          if (row?.user_id) next[row.user_id] = row;
        }
        if (Object.keys(next).length > 0) {
          setDocsByUser((prev) => ({ ...prev, ...next }));
        }
      } catch {
      } finally {
        toLoad.forEach((id) => docsLoadingRef.current.delete(id));
      }
    },
    [isAdminDb]
  );

  useEffect(() => {
    fetchAdminStatus();
  }, [fetchAdminStatus]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (checkingAdmin || !isAdmin) return;
    fetchStats();
    fetchOrganizers({ reset: true });
  }, [checkingAdmin, isAdmin, fetchOrganizers, fetchStats]);

  useEffect(() => {
    if (checkingAdmin || !isAdmin || !isAdminDb) return;
    if (organizers.length === 0) return;
    prefetchDocsForUsers(organizers.map((o) => o.id));
  }, [checkingAdmin, isAdmin, isAdminDb, organizers, prefetchDocsForUsers]);

  const fetchAuditLogs = useCallback(async () => {
    if (!isAdminDb) {
      setAuditLogs([]);
      return;
    }
    if (logsLoadingRef.current) return;
    logsLoadingRef.current = true;
    setLogsLoading(true);
    try {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select('id, action, target_user_id, details, created_at')
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      setAuditLogs((data ?? []) as AuditLogRow[]);
    } catch {
      setAuditLogs([]);
    } finally {
      setLogsLoading(false);
      logsLoadingRef.current = false;
    }
  }, [isAdminDb]);

  const fetchGlobalMatches = useCallback(async () => {
    if (!isAdmin) return;
    const raw = (searchDebounced || '').trim();
    const looksLikeEmail = raw.includes('@');
    if (!looksLikeEmail || raw.length < 3) {
      setGlobalMatches([]);
      return;
    }

    const missing = missingColumnsRef.current;
    const orderColumn = missing.has('created_at') ? 'id' : 'created_at';
    if (missing.has('email') && missing.has('business_email')) {
      setGlobalMatches([]);
      return;
    }
    const safe = raw.replace(/[%]/g, '').replace(/,/g, ' ').slice(0, 96);
    setGlobalLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, full_name, email, club_name, business_email, instagram_account, is_suspended, suspended_reason, verification_status, verification_rejection_reason, created_at')
        .or([
          !missing.has('email') ? `email.ilike.%${safe}%` : null,
          !missing.has('business_email') ? `business_email.ilike.%${safe}%` : null,
        ].filter(Boolean).join(','))
        .order(orderColumn, { ascending: false })
        .limit(12);
      if (error) throw error;
      setGlobalMatches((data ?? []) as any);
    } catch {
      setGlobalMatches([]);
    } finally {
      setGlobalLoading(false);
    }
  }, [isAdmin, searchDebounced]);

  useEffect(() => {
    if (checkingAdmin || !isAdmin) return;
    fetchGlobalMatches();
  }, [checkingAdmin, fetchGlobalMatches, isAdmin]);

  useEffect(() => {
    if (checkingAdmin || !isAdmin) return;
    fetchAuditLogs();
  }, [checkingAdmin, fetchAuditLogs, isAdmin]);

  const approve = async (targetUserId: string) => {
    if (!isAdminDb) {
      Alert.alert('Permisos insuficientes', 'Activa el rol de admin para poder aprobar/rechazar/suspender.');
      return;
    }
    setActionUserId(targetUserId);
    try {
      const { error } = await supabase.rpc('admin_set_organizer_verification', {
        p_user_id: targetUserId,
        p_status: 'verified',
        p_reason: null,
      });
      if (error) throw error;
      await fetchStats();
      await fetchOrganizers({ reset: true });
      await fetchAuditLogs();
    } catch {
      Alert.alert('Error', 'No se pudo aprobar al organizador.');
    } finally {
      setActionUserId(null);
    }
  };

  const submitReview = async () => {
    if (!reviewUserId) return;
    if (!isAdminDb) {
      Alert.alert('Permisos insuficientes', 'Activa el rol de admin para poder aprobar/rechazar/suspender.');
      return;
    }
    setActionUserId(reviewUserId);
    try {
      const { error } = await supabase.rpc('admin_set_organizer_verification', {
        p_user_id: reviewUserId,
        p_status: reviewMode,
        p_reason: reviewReason?.trim() || null,
      });
      if (error) throw error;
      setReviewUserId(null);
      setReviewReason('');
      await fetchStats();
      await fetchOrganizers({ reset: true });
      await fetchAuditLogs();
    } catch (e: any) {
      const msg = (e?.message || e?.details || e?.hint || '').toString().trim();
      Alert.alert('Error', msg ? `No se pudo actualizar la verificación del organizador.\n\n${msg}` : 'No se pudo actualizar la verificación del organizador.');
    } finally {
      setActionUserId(null);
    }
  };

  const setSuspension = async (targetUserId: string, isSuspended: boolean, reason: string | null) => {
    if (!isAdminDb) {
      Alert.alert('Permisos insuficientes', 'Activa el rol de admin para poder aprobar/rechazar/suspender.');
      return;
    }
    setActionUserId(targetUserId);
    try {
      const { error } = await supabase.rpc('admin_set_user_suspension', {
        p_user_id: targetUserId,
        p_is_suspended: isSuspended,
        p_reason: reason,
      });
      if (error) throw error;
      if (isSuspended) {
        const suspensionNote = reason ? `Cuenta suspendida: ${reason}` : 'Cuenta suspendida';
        const r = await supabase.rpc('admin_set_organizer_verification', {
          p_user_id: targetUserId,
          p_status: 'rejected',
          p_reason: suspensionNote,
        });
        if (r.error) throw r.error;
      }
      await fetchStats();
      await fetchOrganizers({ reset: true });
      await fetchAuditLogs();
    } catch (e: any) {
      const msg = (e?.message || e?.details || e?.hint || '').toString().trim();
      Alert.alert('Error', msg ? `No se pudo actualizar el estado de la cuenta.\n\n${msg}` : 'No se pudo actualizar el estado de la cuenta.');
    } finally {
      setActionUserId(null);
    }
  };

  const preview = async (targetUserId: string, kind: keyof Pick<DocsRow, 'business_license_path' | 'tax_id_path' | 'venue_photo_path'>) => {
    await ensureDocsLoaded(targetUserId);
    const path = docsByUser[targetUserId]?.[kind];
    if (!path) {
      Alert.alert('Sin archivo', 'Este organizador no ha subido ese archivo.');
      return;
    }

    const { url, error } = await createSignedUrlDetailed({ bucket: 'organizer_verification', path, expiresInSeconds: 60 * 10 });
    if (!url) {
      Alert.alert('Error', error ? `No se pudo generar el enlace del archivo.\n\n${error}` : 'No se pudo generar el enlace del archivo.');
      return;
    }

    if (path.toLowerCase().endsWith('.pdf')) {
      Linking.openURL(url);
      return;
    }

    setPreviewUrl(url);
  };

  const emptyState = useMemo(() => organizers.length === 0 && !loadingList, [organizers.length, loadingList]);
  const canLoadMore = useMemo(() => {
    if (loadingList || loadingMore) return false;
    if (totalCount === null) return true;
    return organizers.length < totalCount;
  }, [loadingList, loadingMore, totalCount, organizers.length]);

  const filterChips = useMemo(() => ([
    { key: 'pending_verification' as const, label: 'Pendientes', count: stats.pending },
    { key: 'needs_correction' as const, label: 'Corrección', count: stats.needs_correction },
    { key: 'verified' as const, label: 'Verificados', count: stats.verified },
    { key: 'rejected' as const, label: 'Rechazados', count: stats.rejected },
    { key: 'suspended' as const, label: 'Suspendidos', count: stats.suspended },
    { key: 'all' as const, label: 'Todos', count: stats.total },
  ]), [stats]);

  const isOrganizerAccount = useCallback((p: OrganizerRow) => p.role === 'organizer', []);

  const statusLabel = (o: OrganizerRow) => {
    if (o.is_suspended) return 'Suspendido';
    if (o.verification_status === 'verified') return 'Verificado';
    if (o.verification_status === 'needs_correction') return 'Corrección';
    if (o.verification_status === 'rejected') return 'Rechazado';
    return 'Pendiente';
  };

  const statusColor = (o: OrganizerRow) => {
    if (o.is_suspended) return '#ef4444';
    if (o.verification_status === 'verified') return '#22c55e';
    if (o.verification_status === 'needs_correction') return '#f59e0b';
    if (o.verification_status === 'rejected') return '#fb7185';
    return '#60a5fa';
  };

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(tabs)');
  };

  if (checkingAdmin) {
    return (
      <View style={styles.loadingContainer}>
        <DiscoLoader size={120} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={[Colors.dark.background, '#111827']} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={styles.safeArea}>
          <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
            <TouchableOpacity onPress={safeBack} style={styles.backButton}>
              <GlassView intensity={20} style={styles.backButtonContainer}>
                <ArrowLeft size={24} color={Colors.dark.text} />
              </GlassView>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { fontSize: scaleFont(18) }]}>Revisión de Organizadores</Text>
          </View>
          <View style={[styles.centerContent, { paddingHorizontal: horizontalPadding }]}>
            <Text style={styles.deniedTitle}>Acceso denegado</Text>
            <Text style={styles.deniedText}>Solo administradores pueden revisar organizadores.</Text>
            <View style={{ marginTop: 16 }}>
              <ThemedButton title="Volver" onPress={safeBack} />
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#0b1020']} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <GlassView intensity={20} style={styles.backButtonContainer}>
              <ArrowLeft size={24} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { fontSize: scaleFont(18) }]}>Panel de Administración</Text>
            <Text style={styles.headerSubtitle}>Gestión y verificación de organizadores</Text>
          </View>
        </View>

        <ScrollView
          style={[styles.content, { paddingHorizontal: horizontalPadding }]}
          contentContainerStyle={{ alignItems: 'center', paddingBottom: 18 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: '100%', maxWidth: maxContentWidth }}>
            <View style={styles.statsGrid}>
              <GlassView intensity={12} style={styles.statCard}>
                <Text style={styles.statLabel}>Pendientes</Text>
                {loadingStats ? <DiscoLoader size={18} /> : <Text style={styles.statValue}>{stats.pending}</Text>}
              </GlassView>
              <GlassView intensity={12} style={styles.statCard}>
                <Text style={styles.statLabel}>Corrección</Text>
                {loadingStats ? <DiscoLoader size={18} /> : <Text style={styles.statValue}>{stats.needs_correction}</Text>}
              </GlassView>
              <GlassView intensity={12} style={styles.statCard}>
                <Text style={styles.statLabel}>Verificados</Text>
                {loadingStats ? <DiscoLoader size={18} /> : <Text style={styles.statValue}>{stats.verified}</Text>}
              </GlassView>
              <GlassView intensity={12} style={styles.statCard}>
                <Text style={styles.statLabel}>Suspendidos</Text>
                {loadingStats ? <DiscoLoader size={18} /> : <Text style={styles.statValue}>{stats.suspended}</Text>}
              </GlassView>
            </View>

            {(stats.pending > 0 || stats.needs_correction > 0) && (
              <GlassView intensity={10} style={styles.alertCard}>
                <Text style={styles.alertTitle}>Acciones pendientes</Text>
                <Text style={styles.alertText}>
                  {stats.pending} pendientes · {stats.needs_correction} en corrección
                </Text>
              </GlassView>
            )}

            <GlassView intensity={10} style={styles.controlsCard}>
              <View style={styles.searchRow}>
                <View style={styles.searchIcon}>
                  <Search size={16} color="rgba(255,255,255,0.8)" />
                </View>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar por club, nombre o email..."
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {filterChips.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.chip, activeFilter === c.key && styles.chipActive]}
                    onPress={() => {
                      setActiveFilter(c.key);
                      pageRef.current = 0;
                      setOrganizers([]);
                    }}
                  >
                    <Text style={[styles.chipText, activeFilter === c.key && styles.chipTextActive]}>{c.label}</Text>
                    <View style={[styles.chipCount, activeFilter === c.key && styles.chipCountActive]}>
                      <Text style={[styles.chipCountText, activeFilter === c.key && styles.chipCountTextActive]}>{c.count}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </GlassView>

            {searchDebounced.trim().includes('@') && (
              <GlassView intensity={10} style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[styles.cardTitle, { fontSize: 14 }]}>Resultados por email</Text>
                  {globalLoading ? <DiscoLoader size={18} /> : null}
                </View>
                {(!globalLoading && globalMatches.length === 0) ? (
                  <Text style={styles.cardSubtitle}>Sin resultados para ese email.</Text>
                ) : (
                  <View style={{ marginTop: 12 }}>
                    {globalMatches.map((p) => {
                      const busy = actionUserId === p.id;
                      const suspended = !!p.is_suspended;
                      const isOrganizer = isOrganizerAccount(p);

                      return (
                        <GlassView key={p.id} intensity={12} style={[styles.card, { marginBottom: 12 }]}>
                          <View style={styles.cardHeader}>
                            <View style={{ flex: 1 }}>
                              <View style={styles.titleRow}>
                                <Text style={styles.cardTitle}>{p.club_name || p.full_name || p.email || 'Usuario'}</Text>
                                <View style={[styles.badge, { backgroundColor: isOrganizer ? '#60a5fa' : '#94a3b8' }]}>
                                  <Text style={styles.badgeText}>{isOrganizer ? 'Organizador' : 'Usuario'}</Text>
                                </View>
                              </View>
                              <Text style={styles.cardSubtitle}>{p.email || p.business_email || 'Sin email'}</Text>
                              {p.suspended_reason ? (
                                <Text style={styles.reasonText}>Suspensión: {p.suspended_reason}</Text>
                              ) : null}
                            </View>
                          </View>

                          {isOrganizer && (
                            <View style={styles.actionsRow}>
                              <TouchableOpacity
                                style={[styles.approveButton, busy && styles.actionDisabled]}
                                onPress={() => approve(p.id)}
                                disabled={busy}
                              >
                                {busy ? (
                                  <DiscoLoader size={18} />
                                ) : (
                                  <>
                                    <ShieldCheck size={18} color="white" />
                                    <Text style={styles.actionText}>Aprobar</Text>
                                  </>
                                )}
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[styles.correctionButton, busy && styles.actionDisabled]}
                                onPress={() => {
                                  setReviewMode('needs_correction');
                                  setReviewUserId(p.id);
                                  setReviewReason(p.verification_rejection_reason || '');
                                }}
                                disabled={busy}
                              >
                                <Text style={styles.actionText}>Corrección</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[styles.rejectButton, busy && styles.actionDisabled]}
                                onPress={() => {
                                  setReviewMode('rejected');
                                  setReviewUserId(p.id);
                                  setReviewReason(p.verification_rejection_reason || '');
                                }}
                                disabled={busy}
                              >
                                <XCircle size={18} color="white" />
                                <Text style={styles.actionText}>Rechazar</Text>
                              </TouchableOpacity>
                            </View>
                          )}

                          <View style={styles.actionsRow}>
                            {!suspended ? (
                              <TouchableOpacity
                                style={[styles.suspendButton, busy && styles.actionDisabled]}
                                onPress={() => {
                                  setSuspendUserId(p.id);
                                  setSuspendReason('');
                                }}
                                disabled={busy}
                              >
                                <Ban size={18} color="white" />
                                <Text style={styles.actionText}>Suspender</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={[styles.activateButton, busy && styles.actionDisabled]}
                                onPress={() => {
                                  Alert.alert('Activar cuenta', '¿Quieres activar este usuario?', [
                                    { text: 'Cancelar', style: 'cancel' },
                                    { text: 'Activar', style: 'default', onPress: () => setSuspension(p.id, false, null) },
                                  ]);
                                }}
                                disabled={busy}
                              >
                                <Text style={styles.actionText}>Activar</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </GlassView>
                      );
                    })}
                  </View>
                )}
              </GlassView>
            )}

            {loadingList && (
              <View style={{ paddingVertical: 20 }}>
                <DiscoLoader size={120} />
              </View>
            )}

            {emptyState && (
              <GlassView intensity={10} style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No hay resultados</Text>
                <Text style={styles.emptyText}>Ajusta filtros o búsqueda para encontrar organizadores.</Text>
              </GlassView>
            )}

            {!loadingList && (
              <FlatList
                data={organizers}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                renderItem={({ item: o }) => {
                  const docs = docsByUser[o.id];
                  const busy = actionUserId === o.id;
                  const isSuspended = !!o.is_suspended;

                  return (
                    <GlassView key={o.id} intensity={12} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <View style={{ flex: 1 }}>
                          <View style={styles.titleRow}>
                            <Text style={styles.cardTitle}>{o.club_name || o.full_name || 'Organizador'}</Text>
                            <View style={[styles.badge, { backgroundColor: statusColor(o) }]}>
                              <Text style={styles.badgeText}>{statusLabel(o)}</Text>
                            </View>
                          </View>
                          <Text style={styles.cardSubtitle}>{o.business_email || o.email || 'Sin email'}</Text>
                          <Text style={styles.cardSubtitle}>{o.instagram_account ? `Instagram: ${o.instagram_account}` : 'Sin Instagram'}</Text>
                          <Text style={styles.cardSubtitle}>{o.address || 'Sin dirección'}</Text>
                          {(o.city || o.country) ? (
                            <Text style={styles.cardSubtitle}>{[o.city, o.country].filter(Boolean).join(', ')}</Text>
                          ) : null}
                          {o.verification_rejection_reason ? (
                            <Text style={styles.reasonText}>Motivo: {o.verification_rejection_reason}</Text>
                          ) : null}
                          {o.suspended_reason ? (
                            <Text style={styles.reasonText}>Suspensión: {o.suspended_reason}</Text>
                          ) : null}
                        </View>
                      </View>

                      <View style={styles.docsRow}>
                        <TouchableOpacity
                          style={[styles.docButton, !docs?.business_license_path && styles.docButtonDisabled]}
                          onPress={() => preview(o.id, 'business_license_path')}
                        >
                          <FileText size={16} color="white" />
                          <Text style={styles.docText}>Licencia</Text>
                          <ExternalLink size={14} color="rgba(255,255,255,0.75)" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.docButton, !docs?.tax_id_path && styles.docButtonDisabled]}
                          onPress={() => preview(o.id, 'tax_id_path')}
                        >
                          <FileText size={16} color="white" />
                          <Text style={styles.docText}>CIF/NIF</Text>
                          <ExternalLink size={14} color="rgba(255,255,255,0.75)" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.docButton, !docs?.venue_photo_path && styles.docButtonDisabled]}
                          onPress={() => preview(o.id, 'venue_photo_path')}
                        >
                          <ImageIcon size={16} color="white" />
                          <Text style={styles.docText}>Foto</Text>
                          <ExternalLink size={14} color="rgba(255,255,255,0.75)" />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.actionsRow}>
                        <TouchableOpacity
                          style={[styles.approveButton, busy && styles.actionDisabled]}
                          onPress={() => approve(o.id)}
                          disabled={busy}
                        >
                          {busy ? (
                            <DiscoLoader size={18} />
                          ) : (
                            <>
                              <ShieldCheck size={18} color="white" />
                              <Text style={styles.actionText}>Aprobar</Text>
                            </>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.correctionButton, busy && styles.actionDisabled]}
                          onPress={() => {
                            setReviewMode('needs_correction');
                            setReviewUserId(o.id);
                            setReviewReason(o.verification_rejection_reason || '');
                          }}
                          disabled={busy}
                        >
                          <Text style={styles.actionText}>Corrección</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.rejectButton, busy && styles.actionDisabled]}
                          onPress={() => {
                            setReviewMode('rejected');
                            setReviewUserId(o.id);
                            setReviewReason(o.verification_rejection_reason || '');
                          }}
                          disabled={busy}
                        >
                          <XCircle size={18} color="white" />
                          <Text style={styles.actionText}>Rechazar</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.actionsRow}>
                        {!isSuspended ? (
                          <TouchableOpacity
                            style={[styles.suspendButton, busy && styles.actionDisabled]}
                            onPress={() => {
                              setSuspendUserId(o.id);
                              setSuspendReason('');
                            }}
                            disabled={busy}
                          >
                            <Ban size={18} color="white" />
                            <Text style={styles.actionText}>Suspender</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[styles.activateButton, busy && styles.actionDisabled]}
                            onPress={() => {
                              Alert.alert('Activar cuenta', '¿Quieres activar este organizador?', [
                                { text: 'Cancelar', style: 'cancel' },
                                { text: 'Activar', style: 'default', onPress: () => setSuspension(o.id, false, null) },
                              ]);
                            }}
                            disabled={busy}
                          >
                            <Text style={styles.actionText}>Activar</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </GlassView>
                  );
                }}
                ListFooterComponent={() => (
                  <View style={{ paddingBottom: 18 }}>
                    {canLoadMore ? (
                      <TouchableOpacity
                        style={[styles.loadMoreButton, loadingMore && styles.actionDisabled]}
                        onPress={() => fetchOrganizers({ reset: false })}
                        disabled={loadingMore}
                      >
                        {loadingMore ? <DiscoLoader size={18} /> : <Text style={styles.loadMoreText}>Cargar más</Text>}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}
              />
            )}

            <GlassView intensity={10} style={styles.logsCard}>
              <View style={styles.logsHeader}>
                <Text style={styles.logsTitle}>Auditoría (últimas acciones)</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (!logsLoading) fetchAuditLogs();
                  }}
                  style={styles.logsRefresh}
                >
                  {logsLoading ? <DiscoLoader size={18} /> : <Text style={styles.logsRefreshText}>Actualizar</Text>}
                </TouchableOpacity>
              </View>
              {auditLogs.length === 0 ? (
                <Text style={styles.logsEmpty}>Sin registros todavía.</Text>
              ) : (
                auditLogs.slice(0, 8).map((l) => (
                  <View key={l.id} style={styles.logRow}>
                    <Text style={styles.logAction}>{l.action}</Text>
                    <Text style={styles.logMeta}>{new Date(l.created_at).toLocaleString()} · {l.target_user_id ? l.target_user_id.slice(0, 8) : 'N/A'}</Text>
                  </View>
                ))
              )}
            </GlassView>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={!!reviewUserId} transparent animationType="fade" onRequestClose={() => setReviewUserId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{reviewMode === 'needs_correction' ? 'Solicitar correcciones' : 'Rechazar organizador'}</Text>
            <TextInput
              value={reviewReason}
              onChangeText={setReviewReason}
              placeholder="Describe qué debe corregir..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.modalInput}
              multiline
            />
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <ThemedButton title="Cancelar" variant="outline" onPress={() => setReviewUserId(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedButton title="Confirmar" onPress={submitReview} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!suspendUserId} transparent animationType="fade" onRequestClose={() => setSuspendUserId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Suspender organizador</Text>
            <TextInput
              value={suspendReason}
              onChangeText={setSuspendReason}
              placeholder="Motivo de la suspensión..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.modalInput}
              multiline
            />
            <View style={styles.modalButtons}>
              <View style={{ flex: 1 }}>
                <ThemedButton title="Cancelar" variant="outline" onPress={() => setSuspendUserId(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedButton
                  title="Suspender"
                  onPress={async () => {
                    if (!suspendUserId) return;
                    const reason = suspendReason.trim() || null;
                    const targetId = suspendUserId;
                    setSuspendUserId(null);
                    setSuspendReason('');
                    await setSuspension(targetId, true, reason);
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!previewUrl} transparent animationType="fade" onRequestClose={() => setPreviewUrl(null)}>
        <View style={styles.previewBackdrop}>
          <View style={styles.previewCard}>
            <TouchableOpacity onPress={() => setPreviewUrl(null)} style={styles.previewClose}>
              <X size={22} color="white" />
            </TouchableOpacity>
            {previewUrl ? (
              <ScrollView maximumZoomScale={3} minimumZoomScale={1} contentContainerStyle={{ flexGrow: 1 }}>
                <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" />
              </ScrollView>
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
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  backButton: { width: 44, height: 44 },
  backButtonContainer: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: Colors.dark.text, fontWeight: '900' },
  headerSubtitle: { color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: '600' },
  content: { flex: 1, paddingTop: 6 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  statCard: { flexBasis: '48%', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  statLabel: { color: 'rgba(255,255,255,0.7)', fontWeight: '800' },
  statValue: { color: 'white', fontWeight: '900', fontSize: 20, marginTop: 8 },
  alertCard: { borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 12 },
  alertTitle: { color: 'white', fontWeight: '900' },
  alertText: { color: 'rgba(255,255,255,0.7)', marginTop: 6 },
  controlsCard: { borderRadius: 16, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 12, height: 44, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  searchIcon: { width: 22, alignItems: 'center' },
  searchInput: { flex: 1, color: 'white', fontWeight: '700' },
  chipsRow: { gap: 10, paddingTop: 10, paddingBottom: 2 },
  chip: { height: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipActive: { backgroundColor: 'rgba(99,102,241,0.25)', borderColor: 'rgba(99,102,241,0.35)' },
  chipText: { color: 'rgba(255,255,255,0.8)', fontWeight: '900' },
  chipTextActive: { color: 'white' },
  chipCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  chipCountActive: { backgroundColor: 'rgba(99,102,241,0.35)' },
  chipCountText: { color: 'rgba(255,255,255,0.85)', fontWeight: '900', fontSize: 12 },
  chipCountTextActive: { color: 'white' },
  emptyCard: { borderRadius: 18, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  emptyTitle: { color: 'white', fontWeight: '900', fontSize: 16 },
  emptyText: { color: 'rgba(255,255,255,0.65)', marginTop: 6, lineHeight: 18 },
  card: { borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { color: 'white', fontWeight: '900', fontSize: 16 },
  cardSubtitle: { color: 'rgba(255,255,255,0.65)', marginTop: 4 },
  reasonText: { color: 'rgba(255,255,255,0.7)', marginTop: 8, fontWeight: '700' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, height: 24, borderRadius: 999, justifyContent: 'center' },
  badgeText: { color: 'white', fontWeight: '900', fontSize: 12 },
  docsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  docButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  docButtonDisabled: { opacity: 0.35 },
  docText: { color: 'white', fontWeight: '800', fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  approveButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: '#16a34a', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  correctionButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: '#f59e0b', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  rejectButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: '#e11d48', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  suspendButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  activateButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: '#0ea5e9', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  actionText: { color: 'white', fontWeight: '900' },
  actionDisabled: { opacity: 0.6 },
  loadMoreButton: { height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', justifyContent: 'center', alignItems: 'center' },
  loadMoreText: { color: 'white', fontWeight: '900' },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  deniedTitle: { color: 'white', fontWeight: '900', fontSize: 18 },
  deniedText: { color: 'rgba(255,255,255,0.7)', marginTop: 8, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 560, borderRadius: 18, padding: 16, backgroundColor: 'rgba(17,24,39,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modalTitle: { color: 'white', fontWeight: '900', fontSize: 16 },
  modalInput: { marginTop: 12, minHeight: 92, borderRadius: 14, padding: 12, color: 'white', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)' },
  modalButtons: { marginTop: 12, flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  logsCard: { borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 18 },
  logsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  logsTitle: { color: 'white', fontWeight: '900', fontSize: 14 },
  logsRefresh: { height: 30, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)', justifyContent: 'center', alignItems: 'center' },
  logsRefreshText: { color: 'white', fontWeight: '900', fontSize: 12 },
  logsEmpty: { color: 'rgba(255,255,255,0.65)', marginTop: 10 },
  logRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  logAction: { color: 'white', fontWeight: '900' },
  logMeta: { color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: '700' },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  previewCard: { width: '100%', maxWidth: 620, height: 520, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.6)' },
  previewClose: { position: 'absolute', top: 12, right: 12, zIndex: 2, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '100%', height: 520 },
});
