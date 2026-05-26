import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Calendar, MapPin, Ticket, Edit, Trash2, BarChart2, Plus, Search, ShieldCheck } from '@/lib/icons';
import { useRouter } from 'expo-router';
import { useEvents } from '@/lib/EventContext';
import { useAuth } from '@/lib/AuthContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';

export default function ManageEventsScreen() {
  const router = useRouter();
  const { events, deleteEvent } = useEvents();
  const { user } = useAuth();
  const { t } = useTranslation();

  const [profileRole, setProfileRole] = useState<'organizer' | 'admin' | 'attendee' | null>(null);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');
  const [query, setQuery] = useState('');
  const listRef = useRef<FlatList<any> | null>(null);
  const searchRef = useRef<TextInput | null>(null);

  const adminEmail = ((process.env.EXPO_PUBLIC_ADMIN_EMAIL as any) ?? '').toString().trim().toLowerCase() || 'aamracorporation@gmail.com';
  const isAdminEmail = !!user?.email && user.email.toLowerCase() === adminEmail;
  const metadataRole = useMemo(() => ((user?.user_metadata as any)?.role as any) ?? null, [user?.user_metadata]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (error) throw error;
        setProfileRole(((data as any)?.role as any) ?? null);
      } catch {
        setProfileRole(metadataRole);
      }
    })();
  }, [metadataRole, user?.id]);

  const isAdminDb = profileRole === 'admin';
  const isAdmin = isAdminDb || isAdminEmail;

  const createEventLabel = useMemo(() => {
    const translated = String(t('creator.create_event.create_cta', { defaultValue: 'Crear evento' }) || '').trim();
    return translated || 'Crear evento';
  }, [t]);

  const CreateEventCta = ({ compact }: { compact?: boolean }) => (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => router.push('/(creator)/create-event')}
      style={[compact ? styles.createCtaCompact : styles.createCta]}
    >
      <View style={styles.createCtaSurface}>
        <View style={styles.createCtaIcon}>
          <Plus size={18} color={Colors.dark.primary} />
        </View>
        <View style={styles.createCtaTextWrap}>
          <Text style={styles.createCtaLabel}>{createEventLabel}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const baseEvents = useMemo(() => {
    if (isAdminDb) return events;
    return events.filter((e) => e.creatorId === user?.id);
  }, [events, isAdminDb, user?.id]);

  const filteredEvents = useMemo(() => {
    const now = new Date();
    const q = query.trim().toLowerCase();
    return baseEvents
      .filter((e) => {
        if (filter === 'all') return true;
        const startsAt = e.startsAt ? new Date(e.startsAt) : new Date(`${e.date}T${e.time}`);
        if (Number.isNaN(startsAt.getTime())) return true;
        return filter === 'upcoming' ? startsAt >= now : startsAt < now;
      })
      .filter((e) => {
        if (!q) return true;
        const fields = [
          e.title,
          e.location,
          e.creatorProfile?.club_name,
          e.creatorProfile?.full_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return fields.includes(q);
      });
  }, [baseEvents, filter, query]);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  const handleDelete = (id: string) => {
    if (isAdminEmail && !isAdminDb) {
      Alert.alert(t('creator.manage_events.insufficient_permissions_title'), t('creator.manage_events.insufficient_permissions_body'));
      return;
    }
    Alert.alert(
      t('creator.manage_events.delete_title'),
      t('creator.manage_events.delete_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.delete_account_confirm'),
          style: 'destructive',
          onPress: () => {
            deleteEvent(id);
            // Alert.alert('Eliminado', 'El evento ha sido cancelado');
          },
        },
      ]
    );
  };

  const renderEventItem = ({ item }: { item: any }) => (
    <GlassView intensity={15} style={styles.card}>
      <Image 
        source={{ uri: item.imageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg' }} 
        style={styles.cardImage} 
      />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <View style={[styles.statusBadge, { backgroundColor: item.sold >= item.capacity ? Colors.dark.error : Colors.dark.success }]}>
            <Text style={styles.statusText}>
              {item.sold >= item.capacity ? t('creator.manage_events.status_sold_out') : t('creator.manage_events.status_active')}
            </Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Calendar size={14} color={Colors.dark.textSecondary} />
          <Text style={styles.infoText}>{item.date}</Text>
        </View>
        
        <View style={[styles.infoRow, { minWidth: 0 }]}>
          <MapPin size={14} color={Colors.dark.textSecondary} />
          <Text style={[styles.infoText, { flex: 1, flexShrink: 1 }]} numberOfLines={2} ellipsizeMode="tail">
            {item.location}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ticket size={16} color={Colors.dark.primary} />
            <Text style={styles.statText}>
              <Text style={styles.statValue}>{item.sold}</Text> / {item.capacity}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          {!isAdmin && (
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={() => router.push({
                pathname: '/(creator)/create-event',
                params: {
                  id: item.id,
                  isEditing: 'true'
                }
              })}>
              <Edit size={18} color={Colors.dark.secondary} />
              <Text style={[styles.actionText, { color: Colors.dark.secondary }]}>{t('creator.manage_events.actions.edit')}</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={() => router.push({
              pathname: '/(creator)/event-stats/[id]',
              params: { id: item.id }
            })}>
            <BarChart2 size={18} color={Colors.dark.primary} />
            <Text style={[styles.actionText, { color: Colors.dark.primary }]}>{t('creator.manage_events.actions.stats')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleDelete(item.id)}
          >
            <Trash2 size={18} color={Colors.dark.error} />
            <Text style={[styles.actionText, { color: Colors.dark.error }]}>{t('creator.manage_events.actions.delete')}</Text>
          </TouchableOpacity>

        </View>
      </View>
    </GlassView>
  );

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.background, '#1e1b4b']}
        style={StyleSheet.absoluteFill}
      />
      
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <GlassView intensity={20} style={styles.backButtonContainer}>
              <ArrowLeft size={24} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{isAdmin ? t('creator.manage_events.title_admin') : t('creator.manage_events.title_organizer')}</Text>
            {isAdmin && (
              <View style={styles.adminPill}>
                <ShieldCheck size={12} color="#4ade80" />
                <Text style={styles.adminPillText}>{t('creator.manage_events.admin_badge')}</Text>
              </View>
            )}
          </View>
        </View>

        {isAdminEmail && !isAdminDb && (
          <GlassView intensity={16} style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(96, 165, 250, 0.28)' }}>
            <Text style={{ color: 'white', fontWeight: '800' }}>{t('creator.manage_events.admin_pending_title')}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>
              {t('creator.manage_events.admin_pending_body')}
            </Text>
            <View style={{ marginTop: 12 }}>
              <ThemedButton title={t('creator.manage_events.admin_pending_cta')} onPress={() => router.push('/(creator)/admin-verification')} />
            </View>
          </GlassView>
        )}

        <GlassView intensity={18} style={styles.controlsCard}>
          <View style={styles.searchRow}>
            <View style={styles.searchIcon}>
              <Search size={16} color="rgba(255,255,255,0.65)" />
            </View>
            <TextInput
              ref={(r) => { searchRef.current = r; }}
              value={query}
              onChangeText={setQuery}
              placeholder={isAdmin ? t('creator.manage_events.search_placeholder_admin') : t('creator.manage_events.search_placeholder')}
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.searchInput}
            />
          </View>
          <View style={styles.filterRow}>
            {(['upcoming', 'past', 'all'] as const).map((k) => (
              <TouchableOpacity
                key={k}
                activeOpacity={0.8}
                onPress={() => setFilter(k)}
                style={[styles.filterChip, filter === k && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, filter === k && styles.filterChipTextActive]}>
                  {k === 'upcoming' ? t('creator.manage_events.filters.upcoming') : k === 'past' ? t('creator.manage_events.filters.past') : t('creator.manage_events.filters.all')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </GlassView>

        <FlatList
          ref={(r) => { listRef.current = r; }}
          data={filteredEvents}
          renderItem={renderEventItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            !isAdmin ? (
              <View style={{ paddingBottom: 14 }}>
                <GlassView intensity={16} style={styles.dashboardCard}>
                  <Text style={styles.dashboardTitle}>{t('creator.manage_events.title_organizer', { defaultValue: 'Mis eventos' })}</Text>
                  <Text style={styles.dashboardSubtitle}>
                    {t('creator.organizer.actions.my_events_desc', { defaultValue: 'Centraliza la creación y la gestión de tus eventos.' })}
                  </Text>
                  <View style={styles.dashboardActionsRow}>
                    <CreateEventCta compact />
                    <ThemedButton
                      title={t('creator.organizer.actions.my_events_title', { defaultValue: 'Mis eventos' })}
                      onPress={() => {
                        listRef.current?.scrollToOffset({ offset: 0, animated: true });
                        searchRef.current?.focus();
                      }}
                      icon={<Calendar size={20} color={Colors.dark.text} />}
                      style={styles.dashboardActionBtn}
                      variant="outline"
                    />
                  </View>
                </GlassView>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <GlassView intensity={10} style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{isAdmin ? t('creator.manage_events.empty_admin') : t('creator.manage_events.empty_organizer')}</Text>
              {!isAdmin && (
                <CreateEventCta />
              )}
            </GlassView>
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
    paddingBottom: 12,
  },
  backButton: {
    marginRight: 16,
  },
  backButtonContainer: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 0,
  },
  headerTitle: {
    fontSize: 24,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
  },
  adminPill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 22,
    borderRadius: 999,
    backgroundColor: 'rgba(74, 222, 128, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.22)',
  },
  adminPillText: {
    color: '#4ade80',
    fontSize: 11,
    fontFamily: 'RussoOne_400Regular',
  },
  controlsCard: {
    marginHorizontal: 24,
    marginBottom: 12,
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  searchIcon: {
    width: 18,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    color: 'white',
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  filterChip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: 'rgba(99,102,241,0.22)',
    borderColor: 'rgba(99,102,241,0.30)',
  },
  filterChipText: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: 'RussoOne_400Regular',
    fontSize: 12,
  },
  filterChipTextActive: {
    color: 'white',
  },
  dashboardCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  dashboardTitle: {
    color: 'white',
    fontFamily: 'RussoOne_400Regular',
    fontSize: 18,
  },
  dashboardSubtitle: {
    color: 'rgba(255,255,255,0.70)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
    lineHeight: 18,
  },
  dashboardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  dashboardActionBtn: {
    flex: 1,
  },
  createCta: {
    width: '100%',
  },
  createCtaCompact: {
    flex: 1,
  },
  createCtaSurface: {
    width: '100%',
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  createCtaTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  createCtaIcon: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  createCtaLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
    flexShrink: 1,
    lineHeight: 18,
  },
  listContent: {
    padding: 24,
    paddingBottom: 100,
  },
  card: {
    borderRadius: 24,
    marginBottom: 20,
    overflow: 'hidden',
    padding: 0,
  },
  cardImage: {
    width: '100%',
    height: 140,
  },
  cardContent: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    color: 'white',
    fontSize: 10,
    fontFamily: 'RussoOne_400Regular',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  infoText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  statValue: {
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    gap: 6,
  },
  deleteButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  actionText: {
    fontSize: 12,
    fontFamily: 'RussoOne_400Regular',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    borderRadius: 24,
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    marginBottom: 24,
    textAlign: 'center',
    fontSize: 16,
  },
  createButton: {
    width: '100%',
  }
});
