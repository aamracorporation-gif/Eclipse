import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, Platform, Modal, Pressable, Keyboard, ActionSheetIOS } from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEvents, TicketType } from '@/lib/EventContext';
import { useAuth } from '@/lib/AuthContext';
import { getErrorMessage } from '@/lib/errorHelpers';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Calendar, MapPin, DollarSign, Image as ImageIcon, Tag, Plus, Trash2, Clock, Camera, Search, X, Check, Sparkles, Ticket, Lock, Info } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, { Marker, Region } from '@/components/ui/Map';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/I18nContext';
import { useTranslation } from 'react-i18next';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';
import { validateEventDraft } from '@/lib/eventFormValidation';

type VipReservadoDraft = {
  id: string;
  name: string;
  description: string;
  basePrice: string;
  capacityPeople: string;
  includedBottles: string;
  extraBottlePrice: string;
  quantityAvailable: string;
};

type NewVipDraft = Omit<VipReservadoDraft, 'id'>;

type TicketTypeDraft = TicketType & { priceText?: string; quantityText?: string };

export default function CreateEventScreen() {
  const router = useRouter();
  const { id, isEditing: isEditingParam } = useLocalSearchParams<{ id: string, isEditing: string }>();
  const { addEvent, updateEvent, getEventById } = useEvents();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { language } = useI18n();
  const { t } = useTranslation();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  const isEditing = isEditingParam === 'true';
  const eventId = id;

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  const [loading, setLoading] = useState(false);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDraft[]>([]);
  const [newTicket, setNewTicket] = useState({ name: '', price: '', quantity: '' });
  const [vipTypes, setVipTypes] = useState<VipReservadoDraft[]>([]);
  const [newVip, setNewVip] = useState<NewVipDraft>({
    name: '',
    description: '',
    basePrice: '',
    capacityPeople: '',
    includedBottles: '',
    extraBottlePrice: '',
    quantityAvailable: '',
  });
  const [removedVipIds, setRemovedVipIds] = useState<string[]>([]);
  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

  // DatePicker states
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [hasDateSelected, setHasDateSelected] = useState(false);
  const [hasTimeSelected, setHasTimeSelected] = useState(false);
  
  // Manual input states
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');

  const [coordinates, setCoordinates] = useState<{latitude: number, longitude: number} | null>(null);
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 40.4168,
    longitude: -3.7038,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingMap, setIsSearchingMap] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    imageUrl: '',
    venuePlanUrl: '',
    theme: '',
    ageRestriction: '18',
    dressCode: '',
    eventType: 'party',
  });

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));

  const draftValidation = useMemo(() => {
    return validateEventDraft({
      title: formData.title,
      description: formData.description,
      location: formData.location,
      imageUrl: formData.imageUrl,
      theme: formData.theme,
      dressCode: formData.dressCode,
      ageRestriction: formData.ageRestriction,
      dateText,
      timeText,
      hasDateSelected,
      hasTimeSelected,
      dateValue: date,
      ticketTypes,
      newTicket,
      vipTypes,
      newVip,
    });
  }, [formData, dateText, timeText, hasDateSelected, hasTimeSelected, date, ticketTypes, newTicket, vipTypes, newVip]);

  const getFieldError = (field: string) => {
    if (!submitAttempted && !touched[field]) return undefined;
    return (draftValidation.fieldErrors as any)?.[field] || undefined;
  };

  // Check Stripe Status
  useEffect(() => {
    const checkStripe = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('stripe_onboarding_completed, role')
        .eq('id', user.id)
        .maybeSingle();
      
      if (data && data.role === 'organizer' && !data.stripe_onboarding_completed) {
        Alert.alert(
          t('creator.create_event.stripe_required_title'),
          t('creator.create_event.stripe_required_body'),
          [{ text: t('creator.create_event.go_to_dashboard'), onPress: () => router.replace('/(creator)') }]
        );
      }
    };
    checkStripe();
  }, [router, t, user]);

  const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const vipDraftHasAny = (v: NewVipDraft) => {
    const fields = [v.name, v.description, v.basePrice, v.capacityPeople, v.includedBottles, v.extraBottlePrice, v.quantityAvailable];
    return fields.some((f) => String(f || '').trim().length > 0);
  };

  const sanitizeIntText = (text: string) => String(text || '').replace(/[^\d]/g, '');
  const sanitizeEuroText = (text: string) => String(text || '').replace(/[^\d.,]/g, '');

  const showVipHelp = (title: string, body: string) => {
    Alert.alert(title, body);
  };

  const touchNewVipAll = () => {
    touch('newVip.name');
    touch('newVip.basePrice');
    touch('newVip.capacityPeople');
    touch('newVip.includedBottles');
    touch('newVip.quantityAvailable');
    touch('newVip.extraBottlePrice');
  };

  const handleAddVip = () => {
    setSubmitAttempted(true);
    touchNewVipAll();
    if (!vipDraftHasAny(newVip)) return;
    const errs = draftValidation.newVipErrors;
    if (errs.name || errs.basePrice || errs.capacityPeople || errs.quantityAvailable || errs.includedBottles || errs.extraBottlePrice) return;

    setVipTypes((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        name: newVip.name,
        description: newVip.description,
        basePrice: newVip.basePrice,
        capacityPeople: newVip.capacityPeople,
        includedBottles: newVip.includedBottles,
        extraBottlePrice: newVip.extraBottlePrice,
        quantityAvailable: newVip.quantityAvailable,
      },
    ]);
    setNewVip({
      name: '',
      description: '',
      basePrice: '',
      capacityPeople: '',
      includedBottles: '',
      extraBottlePrice: '',
      quantityAvailable: '',
    });
    setTouched((prev) => ({
      ...prev,
      'newVip.name': false,
      'newVip.basePrice': false,
      'newVip.capacityPeople': false,
      'newVip.includedBottles': false,
      'newVip.quantityAvailable': false,
      'newVip.extraBottlePrice': false,
    }));
  };

  const removeVipType = (id: string) => {
    Alert.alert('Eliminar VIP', '¿Seguro que quieres eliminar este VIP?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          if (isUuid(id)) setRemovedVipIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
          setVipTypes((prev) => prev.filter((v) => v.id !== id));
        },
      },
    ]);
  };

  const saveVipReservadosIfAny = async (eventIdToLink: string) => {
    const normalized = vipTypes
      .map((v) => ({
        ...v,
        name: v.name.trim(),
        description: v.description.trim(),
        basePrice: v.basePrice.trim(),
        capacityPeople: v.capacityPeople.trim(),
        includedBottles: v.includedBottles.trim(),
        extraBottlePrice: v.extraBottlePrice.trim(),
        quantityAvailable: v.quantityAvailable.trim(),
      }))
      .filter((v) => {
        const fields = [
          v.name,
          v.description,
          v.basePrice,
          v.capacityPeople,
          v.includedBottles,
          v.extraBottlePrice,
          v.quantityAvailable,
        ];
        return fields.some((f) => f.length > 0);
      });

    if (normalized.length === 0 && removedVipIds.length === 0) return null;

    const errors: string[] = [];
    const rowsToUpsert: any[] = [];
    const rowsToInsert: any[] = [];

    normalized.forEach((vip, idx) => {
      const vipErrors = (draftValidation.vipErrors as any)?.[vip.id];
      if (vipErrors && Object.keys(vipErrors).length > 0) {
        errors.push(`• VIP #${idx + 1}: revisa los campos marcados en rojo`);
        return;
      }

      const basePrice = parseFloat(vip.basePrice.replace(',', '.'));
      const capacityPeople = parseInt(vip.capacityPeople, 10);
      const includedBottles = vip.includedBottles.length > 0 ? parseInt(vip.includedBottles, 10) : 0;
      const quantityAvailable = vip.quantityAvailable.length > 0 ? parseInt(vip.quantityAvailable, 10) : 0;
      const extraBottlePrice = vip.extraBottlePrice.length > 0 ? parseFloat(vip.extraBottlePrice.replace(',', '.')) : null;

      const row: any = {
        event_id: eventIdToLink,
        name: vip.name,
        description: vip.description || '',
        base_price: basePrice,
        capacity_people: capacityPeople,
        included_bottles: includedBottles,
        extra_bottle_price: extraBottlePrice,
        quantity_available: quantityAvailable,
      };

      if (isUuid(vip.id)) rowsToUpsert.push({ id: vip.id, ...row });
      else rowsToInsert.push(row);
    });

    if (rowsToUpsert.length === 0 && rowsToInsert.length === 0 && removedVipIds.length === 0) {
      return `Reservados VIP no guardados:\n${errors.join('\n')}`;
    }

    try {
      if (removedVipIds.length > 0) {
        const trySoftDelete = async (withSoftDeleteCols: boolean) => {
          const payload = withSoftDeleteCols ? { is_active: false, deleted_at: new Date().toISOString() } : {};
          const q = withSoftDeleteCols
            ? supabase.from('reservados_vip').update(payload).in('id', removedVipIds).eq('event_id', eventIdToLink)
            : supabase.from('reservados_vip').delete().in('id', removedVipIds).eq('event_id', eventIdToLink);
          return q;
        };

        let delRes: any = await withTimeout(trySoftDelete(true), 12000, 'borrando VIP');
        if (delRes.error?.code === '42703' && String(delRes.error?.message || '').match(/is_active|deleted_at/i)) {
          delRes = await withTimeout(trySoftDelete(false), 12000, 'borrando VIP');
        }
        if (delRes.error) {
          const code = (delRes.error as any)?.code ? String((delRes.error as any).code) : '';
          if (code === 'PGRST205') {
            return "Reservados VIP no guardados:\nFalta la tabla 'reservados_vip' en este proyecto de Supabase. Ejecuta la migración 20260318120000_add_reservados_vip.sql y reinicia el schema cache.";
          }
          return `Reservados VIP no guardados:\n${code ? `${code}: ` : ''}${getErrorMessage(delRes.error)}`;
        }
      }

      if (rowsToUpsert.length > 0) {
        const tryUpsert = async (withSoftDeleteCols: boolean) => {
          const payload = withSoftDeleteCols
            ? rowsToUpsert.map((r) => ({ ...r, is_active: true, deleted_at: null }))
            : rowsToUpsert;
          return supabase.from('reservados_vip').upsert(payload, { onConflict: 'id' });
        };

        let upRes: any = await withTimeout(tryUpsert(true), 12000, 'guardando VIP');
        if (upRes.error?.code === '42703' && String(upRes.error?.message || '').match(/is_active|deleted_at/i)) {
          upRes = await withTimeout(tryUpsert(false), 12000, 'guardando VIP');
        }
        if (upRes.error) {
          const code = (upRes.error as any)?.code ? String((upRes.error as any).code) : '';
          if (code === 'PGRST205') {
            return "Reservados VIP no guardados:\nFalta la tabla 'reservados_vip' en este proyecto de Supabase. Ejecuta la migración 20260318120000_add_reservados_vip.sql y reinicia el schema cache.";
          }
          return `Reservados VIP no guardados:\n${code ? `${code}: ` : ''}${getErrorMessage(upRes.error)}`;
        }
      }

      if (rowsToInsert.length > 0) {
        const tryInsert = async (withSoftDeleteCols: boolean) => {
          const payload = withSoftDeleteCols ? rowsToInsert.map((r) => ({ ...r, is_active: true, deleted_at: null })) : rowsToInsert;
          return supabase.from('reservados_vip').insert(payload);
        };
        let insRes: any = await withTimeout(tryInsert(true), 12000, 'guardando VIP');
        if (insRes.error?.code === '42703' && String(insRes.error?.message || '').match(/is_active|deleted_at/i)) {
          insRes = await withTimeout(tryInsert(false), 12000, 'guardando VIP');
        }
        if (insRes.error) {
          const code = (insRes.error as any)?.code ? String((insRes.error as any).code) : '';
          if (code === 'PGRST205') {
            return "Reservados VIP no guardados:\nFalta la tabla 'reservados_vip' en este proyecto de Supabase. Ejecuta la migración 20260318120000_add_reservados_vip.sql y reinicia el schema cache.";
          }
          return `Reservados VIP no guardados:\n${code ? `${code}: ` : ''}${getErrorMessage(insRes.error)}`;
        }
      }

      setRemovedVipIds([]);

      if (errors.length > 0) return `Algunos reservados VIP no se guardaron:\n${errors.join('\n')}`;
      return null;
    } catch (error: any) {
      const code = (error as any)?.code ? String((error as any).code) : '';
      if (code === 'PGRST205') {
        return "Reservados VIP no guardados:\nFalta la tabla 'reservados_vip' en este proyecto de Supabase. Ejecuta la migración 20260318120000_add_reservados_vip.sql y reinicia el schema cache.";
      }
      return `Reservados VIP no guardados:\n${code ? `${code}: ` : ''}${getErrorMessage(error)}`;
    }
  };

  useEffect(() => {
    if (isEditing && eventId) {
      const event = getEventById(eventId);
      if (event) {
        setRemovedVipIds([]);
        setNewVip({
          name: '',
          description: '',
          basePrice: '',
          capacityPeople: '',
          includedBottles: '',
          extraBottlePrice: '',
          quantityAvailable: '',
        });
        setFormData({
          title: event.title,
          description: event.description,
          location: event.location,
          imageUrl: event.imageUrl,
          venuePlanUrl: event.venuePlanUrl || '',
          theme: event.theme || '',
          ageRestriction: event.ageRestriction || '18',
          dressCode: event.dressCode || '',
          eventType: event.eventType || 'party',
        });
        // Parse date and time strings back to Date object if needed
        if (event.date && event.time) {
          const dateTime = new Date(`${event.date}T${event.time}`);
          if (!isNaN(dateTime.getTime())) {
             setDate(dateTime);
             setHasDateSelected(true);
             setHasTimeSelected(true);
             
             // Init manual inputs
             setDateText(dateTime.toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit', year: 'numeric' }));
             setTimeText(dateTime.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }));
          }
        }
        if (event.ticketTypes) {
          setTicketTypes(event.ticketTypes as any);
        }
      }

      (async () => {
        try {
          const fetchVip = async (withSoftDeleteCols: boolean) => {
            const q = supabase
              .from('reservados_vip')
              .select('*')
              .eq('event_id', eventId)
              .order('created_at', { ascending: true });
            if (withSoftDeleteCols) {
              return q.eq('is_active', true).is('deleted_at', null);
            }
            return q;
          };

          let vipRes: any = await fetchVip(true);
          if (vipRes.error?.code === '42703' && String(vipRes.error?.message || '').match(/is_active|deleted_at/i)) {
            vipRes = await fetchVip(false);
          }

          if (!vipRes.error && Array.isArray(vipRes.data)) {
            const rows = vipRes.data as any[];
            setVipTypes(
              rows.map((r) => ({
                id: String(r.id),
                name: String(r.name ?? ''),
                description: String(r.description ?? ''),
                basePrice: r.base_price != null ? String(r.base_price) : '',
                capacityPeople: r.capacity_people != null ? String(r.capacity_people) : '',
                includedBottles: r.included_bottles != null ? String(r.included_bottles) : '',
                extraBottlePrice: r.extra_bottle_price != null ? String(r.extra_bottle_price) : '',
                quantityAvailable: r.quantity_available != null ? String(r.quantity_available) : '',
              }))
            );
          }
        } catch (e) {
          console.warn('[vip_load_failed]', e);
        }
      })();
    }
  }, [eventId, getEventById, isEditing, localeTag]);

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    
    if (selectedDate) {
      setHasDateSelected(true);
      setDate(currentDate => {
        const newDate = new Date(currentDate);
        newDate.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        setDateText(newDate.toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit', year: 'numeric' }));
        return newDate;
      });
    }
  };

  const onTimeChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
    }
    
    if (selectedDate) {
      setHasTimeSelected(true);
      setDate(currentDate => {
        const newDate = new Date(currentDate);
        newDate.setHours(selectedDate.getHours(), selectedDate.getMinutes());
        setTimeText(newDate.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }));
        return newDate;
      });
    }
  };

  const confirmIOSDate = () => {
    setShowDatePicker(false);
    setShowTimePicker(false);
  };

  const pickImage = async () => {
    const options = [t('creator.create_event.photo.camera'), t('creator.create_event.photo.gallery'), t('common.cancel')];
    const cancelButtonIndex = 2;

    const handleSelection = async (index: number) => {
      if (index === 2) return;

      try {
        let result;
        if (index === 0) {
          // Camera
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(t('common.error'), t('creator.create_event.photo.permission_camera'));
            return;
          }
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: false, // Disabled to prevent crash on low memory devices
            quality: 0.5,
            exif: false,
          });
        } else {
          // Gallery
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(t('common.error'), t('creator.create_event.photo.permission_gallery'));
            return;
          }
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [2, 3],
            quality: 0.8,
          });
        }

        if (!result.canceled) {
          setFormData(prev => ({ ...prev, imageUrl: result.assets[0].uri }));
        }
      } catch (error) {
        console.error('Error picking image:', error);
        Alert.alert(t('common.error'), t('creator.create_event.photo.upload_failed'));
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
        },
        handleSelection
      );
    } else {
      Alert.alert(
        t('creator.create_event.photo.upload_title'),
        t('creator.create_event.photo.choose_option'),
        [
          { text: t('creator.create_event.photo.camera'), onPress: () => handleSelection(0) },
          { text: t('creator.create_event.photo.gallery'), onPress: () => handleSelection(1) },
          { text: t('common.cancel'), style: 'cancel' },
        ]
      );
    }
  };

  const pickVenuePlanImage = async () => {
    const options = [t('creator.create_event.photo.camera'), t('creator.create_event.photo.gallery'), t('common.cancel')];
    const cancelButtonIndex = 2;

    const handleSelection = async (index: number) => {
      if (index === 2) return;

      try {
        let result;
        if (index === 0) {
          // Camera
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(t('common.error'), t('creator.create_event.photo.permission_camera'));
            return;
          }
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: false, // Disabled to prevent crash on low memory devices
            quality: 0.5,
            exif: false,
          });
        } else {
          // Gallery
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(t('common.error'), t('creator.create_event.photo.permission_gallery'));
            return;
          }
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
          });
        }

        if (!result.canceled) {
          setFormData(prev => ({ ...prev, venuePlanUrl: result.assets[0].uri }));
        }
      } catch (error) {
        console.error('Error picking venue plan image:', error);
        Alert.alert(t('common.error'), t('creator.create_event.photo.plan_upload_failed'));
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
        },
        handleSelection
      );
    } else {
      Alert.alert(
        t('creator.create_event.photo.plan_upload_title'),
        t('creator.create_event.photo.choose_option'),
        [
          { text: t('creator.create_event.photo.camera'), onPress: () => handleSelection(0) },
          { text: t('creator.create_event.photo.gallery'), onPress: () => handleSelection(1) },
          { text: t('common.cancel'), style: 'cancel' },
        ]
      );
    }
  };

  const handleAddTicket = () => {
    setSubmitAttempted(true);
    touch('newTicket.name');
    touch('newTicket.price');
    touch('newTicket.quantity');
    if (draftValidation.newTicketErrors.name || draftValidation.newTicketErrors.price || draftValidation.newTicketErrors.quantity) {
      return;
    }

    const price = parseFloat(newTicket.price.replace(',', '.'));
    const quantity = parseInt(newTicket.quantity, 10);

    setTicketTypes([...ticketTypes, {
      id: Math.random().toString(36).substr(2, 9),
      name: newTicket.name,
      price: price,
      quantity: quantity,
      sold: 0
    }]);
    setNewTicket({ name: '', price: '', quantity: '' });
    setTouched((prev) => ({
      ...prev,
      'newTicket.name': false,
      'newTicket.price': false,
      'newTicket.quantity': false,
    }));
  };

  const removeTicket = (ticketId: string) => {
    const current = ticketTypes.find((t) => t.id === ticketId);
    if (!current) return;
    const sold = Number((current as any).sold || 0);
    if (sold > 0) {
      Alert.alert('No se puede eliminar', 'Este tipo de entrada ya tiene ventas. Para no perder el histórico, no se permite eliminarlo.');
      return;
    }
    Alert.alert('Eliminar tipo de entrada', '¿Seguro que quieres eliminar este tipo de entrada?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => setTicketTypes(ticketTypes.filter((t) => t.id !== ticketId)) },
    ]);
  };

  const getTotalCapacity = () => ticketTypes.reduce((acc, t) => acc + t.quantity, 0);
  const getDisplayPrice = () => {
    if (ticketTypes.length === 0) return '0';
    const min = Math.min(...ticketTypes.map(t => t.price));
    return min.toString();
  };

  const handleMapSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearchingMap(true);
    Keyboard.dismiss();
    try {
      const geocodedLocation = await Location.geocodeAsync(searchQuery);
      if (geocodedLocation.length > 0) {
        const { latitude, longitude } = geocodedLocation[0];
        setMapRegion({
          latitude,
          longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      } else {
        Alert.alert('No encontrado', 'No pudimos encontrar esa ubicación.');
      }
    } catch (error) {
      console.error('Map search error:', error);
      Alert.alert('Error', 'Falló la búsqueda de ubicación');
    } finally {
      setIsSearchingMap(false);
    }
  };

  const confirmMapLocation = async () => {
    try {
      setCoordinates({
        latitude: mapRegion.latitude,
        longitude: mapRegion.longitude
      });
      
      // Reverse geocode to get address if possible
      const reverseGeocode = await Location.reverseGeocodeAsync({
        latitude: mapRegion.latitude,
        longitude: mapRegion.longitude
      });

      if (reverseGeocode.length > 0) {
        const addr = reverseGeocode[0];
        const addressString = [addr.street, addr.streetNumber, addr.city].filter(Boolean).join(', ');
        if (addressString) {
          setFormData(prev => ({ ...prev, location: addressString }));
        }
      }
      
      setShowMapModal(false);
    } catch (error) {
      console.error('Reverse geocode error:', error);
      // Even if reverse geocoding fails, we have the coordinates
      setShowMapModal(false);
    }
  };

  const handleCreate = async () => {
    Keyboard.dismiss();
    console.log('handleCreate initiated');
    setSubmitAttempted(true);
    if (!draftValidation.ok || !draftValidation.dateTime) {
      const payload = {
        errors: (draftValidation.errors || []).map((e: any) => ({ field: e.field, code: e.code, message: e.message })),
        fieldErrors: draftValidation.fieldErrors,
        ticketTypeErrors: draftValidation.ticketTypeErrors,
        vipErrors: draftValidation.vipErrors,
      };
      console.warn('[event_form_validation_failed]', JSON.stringify(payload));
      Alert.alert('Revisa el formulario', 'Corrige los campos marcados en rojo para continuar.');
      return;
    }

    setLoading(true);
    const finalDate = draftValidation.dateTime;
    
    // Mock coordinates for venues (around Madrid) - Fallback
    const mockLatitude = 40.4168 + (Math.random() - 0.5) * 0.1;
    const mockLongitude = -3.7038 + (Math.random() - 0.5) * 0.1;
    
    const finalLatitude = coordinates ? coordinates.latitude : mockLatitude;
    const finalLongitude = coordinates ? coordinates.longitude : mockLongitude;

    try {
      const formattedDate = finalDate.toISOString().split('T')[0];
      // Ensure 24-hour format HH:MM
      const hours = finalDate.getHours().toString().padStart(2, '0');
      const minutes = finalDate.getMinutes().toString().padStart(2, '0');
      const formattedTime = `${hours}:${minutes}`;

      if (!user?.id) {
        Alert.alert('Error', 'No se ha podido identificar al usuario. Por favor, inicia sesión de nuevo.');
        setLoading(false);
        return;
      }

      if (!isEditing) {
        let profileData: any = null;
        let profileError: any = null;

        {
          const res = await supabase
            .from('profiles')
            .select('role, verification_status, is_suspended')
            .eq('id', user.id)
            .maybeSingle();
          profileData = res.data as any;
          profileError = res.error as any;
        }

        if (profileError?.code === '42703' && String(profileError?.message || '').includes('is_suspended')) {
          const res = await supabase.from('profiles').select('role, verification_status').eq('id', user.id).maybeSingle();
          profileData = res.data as any;
          profileError = res.error as any;
        }

        if (profileError?.code === '42703' && String(profileError?.message || '').includes('verification_status')) {
          const res = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
          profileData = res.data as any;
          profileError = res.error as any;
        }

        if (profileError) throw profileError;

        const adminEmail = ((process.env.EXPO_PUBLIC_ADMIN_EMAIL as any) ?? '').toString().trim().toLowerCase() || 'aamracorporation@gmail.com';
        const isAdminEmail = !!user?.email && user.email.toLowerCase() === adminEmail;

        if (profileData?.role !== 'organizer') {
          Alert.alert('Acceso denegado', 'Solo los organizadores pueden publicar eventos.');
          setLoading(false);
          router.replace('/(tabs)');
          return;
        }

          if ('is_suspended' in (profileData || {}) && (profileData as any)?.is_suspended) {
            Alert.alert('Cuenta suspendida', 'Tu cuenta está suspendida y no puede publicar eventos.');
            setLoading(false);
            router.replace('/(tabs)');
            return;
          }

        if ('verification_status' in (profileData || {}) && profileData?.verification_status !== 'verified') {
          if (isAdminEmail) {
          } else {
          Alert.alert(
            'Verificación pendiente',
            'Tu cuenta de organizador está pendiente de verificación. Nuestro equipo revisará tus documentos en breve.'
          );
          setLoading(false);
          router.push('/(creator)/verification');
          return;
          }
        }
      }

      // Upload images if they are local URIs
      let finalImageUrl = formData.imageUrl;
      if (formData.imageUrl && (formData.imageUrl.startsWith('file://') || formData.imageUrl.startsWith('content://'))) {
        const uploadedUrl = await uploadImage(formData.imageUrl, 'events');
        if (uploadedUrl) {
          finalImageUrl = uploadedUrl;
        } else {
          setLoading(false);
          Alert.alert('Error', 'No se pudo subir la imagen del evento');
          return;
        }
      }

      let finalVenuePlanUrl = formData.venuePlanUrl;
      if (formData.venuePlanUrl && (formData.venuePlanUrl.startsWith('file://') || formData.venuePlanUrl.startsWith('content://'))) {
        const uploadedUrl = await uploadImage(formData.venuePlanUrl, 'events');
        if (uploadedUrl) {
          finalVenuePlanUrl = uploadedUrl;
        }
      }

      const eventData = {
        ...formData,
        imageUrl: finalImageUrl, // Use the uploaded URL
        venuePlanUrl: finalVenuePlanUrl,
        date: formattedDate,
        time: formattedTime,
        price: getDisplayPrice(),
        capacity: getTotalCapacity(),
        ticketTypes,
        creatorId: user.id,
        venues: {
          latitude: finalLatitude,
          longitude: finalLongitude,
          name: formData.location
        }
      };

      console.log('Sending event data:', eventData);

      let savedEventId: string | null = null;
      if (isEditing && eventId) {
        await updateEvent(eventId, eventData);
        savedEventId = eventId;
      } else {
        savedEventId = await addEvent(eventData);
      }

      console.log('Event created successfully');
      let vipWarning: string | null = null;
      if (savedEventId) {
        try {
          vipWarning = await withTimeout(saveVipReservadosIfAny(savedEventId), 12000, 'guardando reservados VIP');
        } catch (e: any) {
          console.warn('[vip_save_timeout_or_failed]', e);
          vipWarning = `Reservados VIP no guardados:\n${String(e?.message || 'Proceso bloqueado. Vuelve a intentarlo.')}`;
        }
      }
      let dispatchWarning: string | null = null;
      if (isEditing) {
        try {
          const result: any = await withTimeout(
            invokeEdgeFunctionStrict('dispatch-notifications', { limit: 200, eventId: savedEventId, enqueueEventUpdate: true }),
            12000,
            'enviando notificaciones'
          );
          console.log('[dispatch-notifications][creator_save]', JSON.stringify(result));
          const enq = (result as any)?.enqueued_event_update;
          const buyersFound = Number(enq?.buyers_found ?? NaN);
          const inserted = Number(enq?.notifications_inserted ?? NaN);
          if (Number.isFinite(buyersFound) && buyersFound === 0) {
            dispatchWarning = '\n\nAviso notificaciones: no se encontraron compradores previos para este evento.';
          } else if (Number.isFinite(inserted) && inserted === 0) {
            dispatchWarning = '\n\nAviso notificaciones: no se pudo insertar ninguna notificación (revisa logs de Edge Functions).';
          }
        } catch (e) {
          const msg = String((e as any)?.message || e || '');
          dispatchWarning = msg ? `\n\nAviso notificaciones: ${msg}` : '\n\nAviso: no se pudieron enviar notificaciones ahora mismo.';
          console.warn('dispatch-notifications failed after save:', e);
        }
      }
      setLoading(false);
      const successTitle = isEditing ? 'Evento actualizado con éxito' : 'Evento creado con éxito';
      const successBodyBase = isEditing ? 'Evento actualizado con éxito' : 'Evento creado con éxito';
      Alert.alert(
        successTitle,
        (vipWarning ? `${successBodyBase}\n\n${vipWarning}` : successBodyBase) + (dispatchWarning || ''),
        [{ text: 'OK', onPress: safeBack }]
      );
    } catch (error: any) {
      console.error('Error in handleCreate:', error);
      setLoading(false);
      Alert.alert('Error', getErrorMessage(error) || 'Ocurrió un error al crear el evento');
    }
  };

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
          <Text style={styles.headerTitle}>
            {isEditing ? t('creator.create_event.edit_title') : t('creator.create_event.create_title')}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <ScrollView 
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <GlassView intensity={14} style={[styles.formCard, styles.premiumCard]}>
              <View style={styles.premiumHeaderRow}>
                <View style={styles.premiumIconWrap}>
                  <LinearGradient
                    colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                    style={styles.premiumIconRing}
                  >
                    <View style={styles.premiumIconInner}>
                      <Tag size={18} color="white" />
                    </View>
                  </LinearGradient>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.premiumTitle}>{t('creator.create_event.basic_info_title')}</Text>
                  <Text style={styles.premiumSubtitle}>{t('creator.create_event.basic_info_subtitle')}</Text>
                </View>
              </View>
              
              <ThemedInput
                label={t('creator.create_event.event_name_label')}
                placeholder={t('creator.create_event.event_name_placeholder')}
                value={formData.title}
                onChangeText={(text) => setFormData({ ...formData, title: text })}
                onBlur={() => touch('title')}
                error={getFieldError('title')}
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <ThemedInput
                label={t('creator.create_event.description_label')}
                placeholder={t('creator.create_event.description_placeholder')}
                value={formData.description}
                onChangeText={(text) => setFormData({ ...formData, description: text })}
                onBlur={() => touch('description')}
                error={getFieldError('description')}
                multiline
                numberOfLines={4}
                containerStyle={{ height: 100 }}
              />

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>{t('event.details.date')}</Text>
                <TouchableOpacity
                  onPress={() => {
                    touch('date');
                    setShowDatePicker(true);
                  }}
                  activeOpacity={0.8}
                >
                  <View pointerEvents="none">
                    <ThemedInput
                      value={dateText}
                      onChangeText={() => {}}
                      editable={false}
                      placeholder={t('creator.create_event.select_date')}
                      error={getFieldError('date')}
                      icon={<Calendar size={20} color={Colors.dark.textSecondary} />}
                    />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>{t('event.details.time')}</Text>
                <TouchableOpacity
                  onPress={() => {
                    touch('time');
                    setShowTimePicker(true);
                  }}
                  activeOpacity={0.8}
                >
                  <View pointerEvents="none">
                    <ThemedInput
                      value={timeText}
                      onChangeText={() => {}}
                      editable={false}
                      placeholder={t('creator.create_event.select_time')}
                      error={getFieldError('time')}
                      icon={<Clock size={20} color={Colors.dark.textSecondary} />}
                    />
                  </View>
                </TouchableOpacity>
              </View>

              {Platform.OS === 'android' && showDatePicker && (
                <DateTimePicker
                  value={date}
                  mode="date"
                  display="default"
                  onChange={onDateChange}
                />
              )}

              {Platform.OS === 'android' && showTimePicker && (
                <DateTimePicker
                  value={date}
                  mode="time"
                  display="default"
                  onChange={onTimeChange}
                />
              )}

              {Platform.OS === 'ios' && (showDatePicker || showTimePicker) && (
                <Modal
                  transparent={true}
                  animationType="slide"
                  visible={showDatePicker || showTimePicker}
                  onRequestClose={confirmIOSDate}
                >
                  <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                      <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={confirmIOSDate}>
                          <Text style={styles.modalDoneButton}>{t('creator.create_event.done')}</Text>
                        </TouchableOpacity>
                      </View>
                      <DateTimePicker
                  value={date}
                  mode={showDatePicker ? 'date' : 'time'}
                  display="spinner"
                  onChange={showDatePicker ? onDateChange : onTimeChange}
                  textColor={Colors.dark.text}
                  themeVariant="dark"
                />
                    </View>
                  </View>
                </Modal>
              )}

              <View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TouchableOpacity
                      onPress={() => {
                        touch('location');
                        setShowMapModal(true);
                      }}
                      activeOpacity={0.8}
                    >
                        <View pointerEvents="none">
                            <ThemedInput
                            label={t('creator.create_event.location_label')}
                            placeholder={t('creator.create_event.location_placeholder')}
                            value={formData.location}
                            onChangeText={(text) => setFormData({ ...formData, location: text })}
                            icon={<MapPin size={20} color={Colors.dark.textSecondary} />}
                            editable={false}
                            error={getFieldError('location')}
                            />
                        </View>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity 
                    onPress={() => {
                      touch('location');
                      setShowMapModal(true);
                    }}
                    style={{ 
                        marginBottom: 16, 
                        height: 50, 
                        width: 50,
                        backgroundColor: coordinates ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.1)',
                        borderRadius: 12,
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: coordinates ? '#22c55e' : 'rgba(255,255,255,0.1)'
                    }}
                    activeOpacity={0.7}
                  >
                     <MapPin size={24} color={coordinates ? '#22c55e' : Colors.dark.text} />
                  </TouchableOpacity>
                </View>
                {coordinates && (
                  <View style={{ marginTop: 8, marginBottom: 16 }}>
                    <Text style={{ color: Colors.dark.success, fontSize: 12, marginBottom: 8, marginLeft: 4 }}>
                        {t('creator.create_event.location_verified')}
                    </Text>
                    <View style={{ height: 150, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                      <MapView
                        style={{ flex: 1 }}
                        initialRegion={{
                          latitude: coordinates.latitude,
                          longitude: coordinates.longitude,
                          latitudeDelta: 0.005,
                          longitudeDelta: 0.005,
                        }}
                        region={{
                          latitude: coordinates.latitude,
                          longitude: coordinates.longitude,
                          latitudeDelta: 0.005,
                          longitudeDelta: 0.005,
                        }}
                        scrollEnabled={false}
                        zoomEnabled={false}
                        rotateEnabled={false}
                        pitchEnabled={false}
                      >
                        <Marker coordinate={coordinates} />
                      </MapView>
                      <TouchableOpacity 
                        style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' }} 
                        onPress={() => setShowMapModal(true)}
                      />
                    </View>
                  </View>
                )}
              </View>

              <Modal
                visible={showMapModal}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setShowMapModal(false)}
              >
                <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
                    <SafeAreaView style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, zIndex: 10 }}>
                            <TouchableOpacity onPress={() => setShowMapModal(false)} style={{ padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 }}>
                                <X size={24} color="white" />
                            </TouchableOpacity>
                            <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'white', borderRadius: 8, alignItems: 'center', paddingHorizontal: 12, height: 44 }}>
                                <Search size={20} color="#666" />
                                <ThemedInput 
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    placeholder={t('creator.create_event.map_search_placeholder')}
                                    placeholderTextColor="#999"
                                    style={{ height: 44, marginBottom: 0, paddingHorizontal: 8, backgroundColor: 'transparent', borderWidth: 0 }}
                                    inputStyle={{ color: 'black' }}
                                    containerStyle={{ flex: 1, marginBottom: 0 }}
                                    onSubmitEditing={handleMapSearch}
                                    returnKeyType="search"
                                />
                                {isSearchingMap ? <DiscoLoader size={18} /> : null}
                            </View>
                            <TouchableOpacity onPress={handleMapSearch} style={{ padding: 10, backgroundColor: Colors.dark.primary, borderRadius: 8 }}>
                                <Search size={20} color="white" />
                            </TouchableOpacity>
                        </View>
                        
                        <View style={{ flex: 1, position: 'relative' }}>
                            <MapView
                                style={{ flex: 1 }}
                                region={mapRegion}
                                onRegionChangeComplete={setMapRegion}
                                showsUserLocation
                                showsMyLocationButton
                            />
                            <View style={{ position: 'absolute', top: '50%', left: '50%', marginTop: -24, marginLeft: -24, pointerEvents: 'none' }}>
                                <MapPin size={48} color={Colors.dark.primary} />
                            </View>
                            
                            <View style={{ position: 'absolute', bottom: insets.bottom + 30, left: 20, right: 20 }}>
                                <ThemedButton 
                                    title={t('creator.create_event.confirm_location')}
                                    onPress={confirmMapLocation}
                                    icon={<Check size={20} color="white" />}
                                />
                            </View>
                        </View>
                    </SafeAreaView>
                </View>
              </Modal>

              <ThemedInput
                label={t('event.details.music')}
                placeholder={t('creator.create_event.music_placeholder')}
                value={formData.theme}
                onChangeText={(text) => setFormData({ ...formData, theme: text })}
                onBlur={() => touch('theme')}
                error={getFieldError('theme')}
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <ThemedInput
                label={t('creator.create_event.min_age_label')}
                placeholder={t('creator.create_event.min_age_placeholder')}
                value={formData.ageRestriction}
                onChangeText={(text) => setFormData({ ...formData, ageRestriction: text })}
                onBlur={() => touch('ageRestriction')}
                error={getFieldError('ageRestriction')}
                keyboardType="numeric"
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <ThemedInput
                label={t('event.details.dress_code')}
                placeholder={t('creator.create_event.dress_code_placeholder')}
                value={formData.dressCode}
                onChangeText={(text) => setFormData({ ...formData, dressCode: text })}
                onBlur={() => touch('dressCode')}
                error={getFieldError('dressCode')}
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>{t('creator.create_event.event_image_label')}</Text>
                {formData.imageUrl ? (
                  <View style={[styles.imagePreviewContainer, getFieldError('imageUrl') ? styles.fieldErrorBorder : null]}>
                    <Image source={{ uri: formData.imageUrl }} style={styles.imagePreview} resizeMode="cover" />
                    <TouchableOpacity style={styles.removeImageButton} onPress={() => setFormData({ ...formData, imageUrl: '' })}>
                      <GlassView intensity={20} style={styles.removeIconContainer}>
                        <Trash2 size={20} color={Colors.dark.error} />
                      </GlassView>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={pickImage} activeOpacity={0.8}>
                     <GlassView intensity={10} style={[styles.uploadPlaceholder, getFieldError('imageUrl') ? styles.fieldErrorBorder : null]}>
                        <Camera size={32} color={Colors.dark.textSecondary} />
                        <Text style={styles.uploadText}>{t('creator.create_event.event_image_cta')}</Text>
                     </GlassView>
                  </TouchableOpacity>
                )}
                {getFieldError('imageUrl') ? <Text style={styles.fieldErrorText}>{getFieldError('imageUrl')}</Text> : null}
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>{t('creator.create_event.venue_plan_label')}</Text>
                <Text style={styles.inputDescription}>{t('creator.create_event.venue_plan_desc')}</Text>
                {formData.venuePlanUrl ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: formData.venuePlanUrl }} style={styles.imagePreview} resizeMode="contain" />
                    <TouchableOpacity style={styles.removeImageButton} onPress={() => setFormData({ ...formData, venuePlanUrl: '' })}>
                      <GlassView intensity={20} style={styles.removeIconContainer}>
                        <Trash2 size={20} color={Colors.dark.error} />
                      </GlassView>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={pickVenuePlanImage} activeOpacity={0.8}>
                     <GlassView intensity={10} style={styles.uploadPlaceholder}>
                        <ImageIcon size={32} color={Colors.dark.textSecondary} />
                        <Text style={styles.uploadText}>{t('creator.create_event.venue_plan_cta')}</Text>
                     </GlassView>
                  </TouchableOpacity>
                )}
              </View>
            </GlassView>

            <GlassView intensity={14} style={[styles.formCard, styles.premiumCard]}>
              <View style={styles.premiumHeaderRow}>
                <View style={styles.premiumIconWrap}>
                  <LinearGradient
                    colors={['rgba(124,58,237,0.85)', 'rgba(6,182,212,0.55)', 'rgba(255,255,255,0.10)']}
                    style={styles.premiumIconRing}
                  >
                    <View style={styles.premiumIconInner}>
                      <Ticket size={18} color="white" />
                    </View>
                  </LinearGradient>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.premiumTitle}>{t('creator.create_event.tickets.section_title')}</Text>
                  <Text style={styles.premiumSubtitle}>{t('creator.create_event.tickets.section_subtitle')}</Text>
                </View>
              </View>
              
              <View style={styles.ticketForm}>
                <ThemedInput
                  placeholder={t('creator.create_event.tickets.name_placeholder')}
                  value={newTicket.name}
                  onChangeText={(text) => {
                    touch('newTicket.name');
                    setNewTicket({ ...newTicket, name: text });
                  }}
                  onBlur={() => touch('newTicket.name')}
                  error={((submitAttempted || touched['newTicket.name']) && (draftValidation.newTicketErrors as any)?.name) || undefined}
                  success={!!touched['newTicket.name'] && !(draftValidation.newTicketErrors as any)?.name && !!newTicket.name.trim()}
                  containerStyle={{ marginBottom: 12 }}
                />
                <View style={styles.row}>
                  <View style={styles.halfWidth}>
                    <ThemedInput
                      placeholder={t('creator.create_event.tickets.price_placeholder')}
                      value={newTicket.price}
                        onChangeText={(text) => {
                          touch('newTicket.price');
                          setNewTicket({ ...newTicket, price: sanitizeEuroText(text) });
                        }}
                      onBlur={() => touch('newTicket.price')}
                      error={((submitAttempted || touched['newTicket.price']) && (draftValidation.newTicketErrors as any)?.price) || undefined}
                      success={!!touched['newTicket.price'] && !(draftValidation.newTicketErrors as any)?.price && !!newTicket.price.trim()}
                      keyboardType="numeric"
                      icon={<DollarSign size={16} color={Colors.dark.textSecondary} />}
                    />
                  </View>
                  <View style={styles.halfWidth}>
                    <ThemedInput
                      placeholder={t('creator.create_event.tickets.quantity_placeholder')}
                      value={newTicket.quantity}
                        onChangeText={(text) => {
                          touch('newTicket.quantity');
                          setNewTicket({ ...newTicket, quantity: sanitizeIntText(text) });
                        }}
                      onBlur={() => touch('newTicket.quantity')}
                      error={((submitAttempted || touched['newTicket.quantity']) && (draftValidation.newTicketErrors as any)?.quantity) || undefined}
                      success={!!touched['newTicket.quantity'] && !(draftValidation.newTicketErrors as any)?.quantity && !!newTicket.quantity.trim()}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                
                {getFieldError('ticketTypes') ? <Text style={styles.fieldErrorText}>{getFieldError('ticketTypes')}</Text> : null}
                <ThemedButton
                  title={t('creator.create_event.tickets.add_button')}
                  onPress={handleAddTicket}
                  variant="outline"
                  style={styles.addTicketButton}
                  disabled={
                    !!(newTicket.name.trim() || newTicket.price.trim() || newTicket.quantity.trim()) &&
                    Object.values(draftValidation.newTicketErrors || {}).some(Boolean)
                  }
                  icon={<Plus size={20} color={Colors.dark.primary} />}
                />
              </View>

              {ticketTypes.map((ticket) => {
                const sold = Number((ticket as any).sold || 0);
                const ttErr: any = (draftValidation.ticketTypeErrors as any)?.[String(ticket.id)] || {};
                const itemError =
                  ttErr.quantity || ttErr.price || ttErr.name || null;
                return (
                  <View key={ticket.id} style={styles.ticketItem}>
                    <View style={styles.ticketInfo}>
                      <View style={styles.ticketItemHeader}>
                        <Text style={styles.ticketName}>{ticket.name}</Text>
                        <View style={styles.ticketHeaderRight}>
                          <View style={styles.lockedPill}>
                            <Lock size={14} color={Colors.dark.textSecondary} />
                            <Text style={styles.lockedPillText}>Bloqueada</Text>
                          </View>
                          <TouchableOpacity onPress={() => removeTicket(ticket.id)} style={styles.deleteButton}>
                            <Trash2 size={20} color={Colors.dark.error} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <Text style={styles.ticketDetails}>
                        {Number(ticket.price || 0).toFixed(2)}€ • {Number(ticket.quantity || 0)} {t('creator.create_event.tickets.units')}
                      </Text>
                      <Text style={styles.ticketDetails}>
                        Vendidas: {sold} • Restantes: {Math.max((Number(ticket.quantity) || 0) - sold, 0)}
                      </Text>
                      {itemError ? (
                        <Text style={styles.fieldErrorText}>
                          {itemError} Elimina esta entrada y vuelve a crearla.
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </GlassView>

            <GlassView intensity={14} style={[styles.formCard, styles.premiumCard, styles.vipSectionCard]}>
              <View style={styles.vipSectionHeader}>
                <View style={styles.vipSectionTitleRow}>
                  <View style={styles.vipIconWrap}>
                    <LinearGradient
                      colors={['rgba(124,58,237,0.9)', 'rgba(6,182,212,0.65)', 'rgba(255,255,255,0.10)']}
                      style={styles.vipIconRing}
                    >
                      <View style={styles.vipIconInner}>
                        <Sparkles size={18} color="white" />
                      </View>
                    </LinearGradient>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vipSectionTitle}>{t('creator.create_event.vip.section_title')}</Text>
                    <Text style={styles.vipSubtitle}>{t('creator.create_event.vip.section_subtitle')}</Text>
                  </View>
                  <View style={styles.vipBadge}>
                    <Text style={styles.vipBadgeText}>VIP</Text>
                  </View>
                </View>
              </View>

              <View style={styles.ticketForm}>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>Nombre del VIP</Text>
                  <Pressable onPress={() => showVipHelp('Nombre del VIP', 'Nombre visible para el usuario.\nEjemplo: Mesa VIP.\nMínimo 2 caracteres.')}>
                    <Info size={16} color={Colors.dark.textSecondary} />
                  </Pressable>
                </View>
                <ThemedInput
                  placeholder="Ej: Mesa VIP"
                  value={newVip.name}
                  onChangeText={(text) => {
                    touch('newVip.name');
                    setNewVip((prev) => ({ ...prev, name: text }));
                  }}
                  onBlur={() => touch('newVip.name')}
                  error={((submitAttempted || touched['newVip.name']) && draftValidation.newVipErrors.name) || undefined}
                  success={!!touched['newVip.name'] && !draftValidation.newVipErrors.name && !!newVip.name.trim()}
                  containerStyle={{ marginBottom: 12 }}
                />
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>Descripción (opcional)</Text>
                  <Pressable onPress={() => showVipHelp('Descripción', 'Detalles opcionales del VIP.\nEjemplo: Incluye acceso prioritario y botellas.')}>
                    <Info size={16} color={Colors.dark.textSecondary} />
                  </Pressable>
                </View>
                <ThemedInput
                  placeholder="Ej: Incluye acceso prioritario y botellas"
                  value={newVip.description}
                  onChangeText={(text) => {
                    touch('newVip.description');
                    setNewVip((prev) => ({ ...prev, description: text }));
                  }}
                  multiline
                  numberOfLines={3}
                  containerStyle={{ height: 86, marginBottom: 12 }}
                />
                <View style={styles.row}>
                  <View style={styles.halfWidth}>
                    <View style={styles.fieldLabelRow}>
                      <Text style={styles.fieldLabel}>Precio base (€)</Text>
                      <Pressable
                        onPress={() =>
                          showVipHelp(
                            'Precio base (€)',
                            'Precio en euros.\nFormato: 200,00\nMínimo 1,00 € · Máximo 999.999'
                          )
                        }
                      >
                        <Info size={16} color={Colors.dark.textSecondary} />
                      </Pressable>
                    </View>
                    <ThemedInput
                      placeholder="Ej: 200,00"
                      value={newVip.basePrice}
                      onChangeText={(text) => {
                        touch('newVip.basePrice');
                        setNewVip((prev) => ({ ...prev, basePrice: sanitizeEuroText(text) }));
                      }}
                      onBlur={() => touch('newVip.basePrice')}
                      error={((submitAttempted || touched['newVip.basePrice']) && draftValidation.newVipErrors.basePrice) || undefined}
                      success={!!touched['newVip.basePrice'] && !draftValidation.newVipErrors.basePrice && !!newVip.basePrice.trim()}
                      keyboardType="numeric"
                      icon={<DollarSign size={16} color={Colors.dark.textSecondary} />}
                    />
                  </View>
                  <View style={styles.halfWidth}>
                    <View style={styles.fieldLabelRow}>
                      <Text style={styles.fieldLabel}>Capacidad (personas)</Text>
                      <Pressable
                        onPress={() =>
                          showVipHelp('Capacidad (personas)', 'Número de personas incluidas.\nEjemplo: 4\nMínimo 1 · Máximo 999')
                        }
                      >
                        <Info size={16} color={Colors.dark.textSecondary} />
                      </Pressable>
                    </View>
                    <ThemedInput
                      placeholder="Ej: 4"
                      value={newVip.capacityPeople}
                      onChangeText={(text) => {
                        touch('newVip.capacityPeople');
                        setNewVip((prev) => ({ ...prev, capacityPeople: sanitizeIntText(text) }));
                      }}
                      onBlur={() => touch('newVip.capacityPeople')}
                      error={((submitAttempted || touched['newVip.capacityPeople']) && draftValidation.newVipErrors.capacityPeople) || undefined}
                      success={!!touched['newVip.capacityPeople'] && !draftValidation.newVipErrors.capacityPeople && !!newVip.capacityPeople.trim()}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={styles.halfWidth}>
                    <View style={styles.fieldLabelRow}>
                      <Text style={styles.fieldLabel}>Botellas incluidas</Text>
                      <Pressable
                        onPress={() =>
                          showVipHelp('Botellas incluidas', 'Número de botellas incluidas.\nEjemplo: 1\nMínimo 0 · Máximo 99')
                        }
                      >
                        <Info size={16} color={Colors.dark.textSecondary} />
                      </Pressable>
                    </View>
                    <ThemedInput
                      placeholder="Ej: 1"
                      value={newVip.includedBottles}
                      onChangeText={(text) => {
                        touch('newVip.includedBottles');
                        setNewVip((prev) => ({ ...prev, includedBottles: sanitizeIntText(text) }));
                      }}
                      onBlur={() => touch('newVip.includedBottles')}
                      error={((submitAttempted || touched['newVip.includedBottles']) && draftValidation.newVipErrors.includedBottles) || undefined}
                      success={!!touched['newVip.includedBottles'] && !draftValidation.newVipErrors.includedBottles && !!newVip.includedBottles.trim()}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.halfWidth}>
                    <View style={styles.fieldLabelRow}>
                      <Text style={styles.fieldLabel}>Disponibles</Text>
                      <Pressable
                        onPress={() =>
                          showVipHelp('Disponibles', 'Cuántos VIP se pueden vender.\nEjemplo: 2\nMínimo 0 · Máximo 9.999')
                        }
                      >
                        <Info size={16} color={Colors.dark.textSecondary} />
                      </Pressable>
                    </View>
                    <ThemedInput
                      placeholder="Ej: 2"
                      value={newVip.quantityAvailable}
                      onChangeText={(text) => {
                        touch('newVip.quantityAvailable');
                        setNewVip((prev) => ({ ...prev, quantityAvailable: sanitizeIntText(text) }));
                      }}
                      onBlur={() => touch('newVip.quantityAvailable')}
                      error={((submitAttempted || touched['newVip.quantityAvailable']) && draftValidation.newVipErrors.quantityAvailable) || undefined}
                      success={!!touched['newVip.quantityAvailable'] && !draftValidation.newVipErrors.quantityAvailable && !!newVip.quantityAvailable.trim()}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>Precio botella extra (€)</Text>
                  <Pressable
                    onPress={() =>
                      showVipHelp('Precio botella extra (€)', 'Precio opcional por botella extra.\nFormato: 50,00\nMínimo 0,00 € · Máximo 999.999')
                    }
                  >
                    <Info size={16} color={Colors.dark.textSecondary} />
                  </Pressable>
                </View>
                <ThemedInput
                  placeholder="Ej: 50,00"
                  value={newVip.extraBottlePrice}
                  onChangeText={(text) => {
                    touch('newVip.extraBottlePrice');
                    setNewVip((prev) => ({ ...prev, extraBottlePrice: sanitizeEuroText(text) }));
                  }}
                  onBlur={() => touch('newVip.extraBottlePrice')}
                  error={((submitAttempted || touched['newVip.extraBottlePrice']) && draftValidation.newVipErrors.extraBottlePrice) || undefined}
                  success={!!touched['newVip.extraBottlePrice'] && !draftValidation.newVipErrors.extraBottlePrice && !!newVip.extraBottlePrice.trim()}
                  keyboardType="numeric"
                  icon={<DollarSign size={16} color={Colors.dark.textSecondary} />}
                />

                {getFieldError('vipTypes') ? <Text style={styles.fieldErrorText}>{getFieldError('vipTypes')}</Text> : null}
                <ThemedButton
                  title={t('creator.create_event.vip.add_button')}
                  onPress={handleAddVip}
                  variant="outline"
                  style={styles.vipAddButton}
                  disabled={vipDraftHasAny(newVip) && Object.values(draftValidation.newVipErrors).some(Boolean)}
                  icon={<Plus size={20} color={Colors.dark.primary} />}
                />
              </View>

              {vipTypes.map((vip, index) => (
                <View key={vip.id} style={styles.vipCard}>
                  <LinearGradient
                    colors={['rgba(124,58,237,0.18)', 'rgba(6,182,212,0.10)', 'rgba(255,255,255,0.03)']}
                    locations={[0, 0.5, 1]}
                    style={StyleSheet.absoluteFill}
                  />

                  <View style={styles.vipCardHeader}>
                    <View style={styles.lockedHeaderRow}>
                      <Text style={styles.vipCardTitle}>{t('creator.create_event.vip.card_title', { index: index + 1 })}</Text>
                      <View style={styles.lockedPill}>
                        <Lock size={14} color={Colors.dark.textSecondary} />
                        <Text style={styles.lockedPillText}>Bloqueado</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => removeVipType(vip.id)} style={styles.vipRemoveButton}>
                      <Trash2 size={18} color={Colors.dark.error} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.ticketDetails}>{vip.name}</Text>
                  {vip.description ? <Text style={styles.ticketDetails}>{vip.description}</Text> : null}
                  <Text style={styles.ticketDetails}>
                    Precio: {vip.basePrice}€ • Capacidad: {vip.capacityPeople} • Disponibles: {vip.quantityAvailable || '0'}
                  </Text>
                  <Text style={styles.ticketDetails}>
                    Botellas: {vip.includedBottles || '0'} • Extra: {vip.extraBottlePrice ? `${vip.extraBottlePrice}€` : '0€'}
                  </Text>
                </View>
              ))}
            </GlassView>

            <TouchableOpacity 
                style={[styles.directButton, (loading || !draftValidation.ok) && styles.disabledButton, { marginBottom: 40 }]}
                onPress={handleCreate}
                disabled={loading || !draftValidation.ok}
                activeOpacity={0.8}
            >
                <LinearGradient
                  colors={['#7C3AED', '#4C1D95']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.gradientButton}
                  pointerEvents="none"
                >
                  <Text style={styles.buttonText}>
                    {isEditing ? t('creator.create_event.save_changes') : t('creator.create_event.publish')}
                  </Text>
                </LinearGradient>
            </TouchableOpacity>

          </ScrollView>
        </View>
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
  content: {
    padding: 24,
    paddingBottom: 120, // More space for footer
  },
  formCard: {
    padding: 20,
    borderRadius: 24,
    marginBottom: 24,
  },
  premiumCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sectionTitle: {
    fontSize: 18,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 20,
  },
  premiumTitle: {
    fontSize: 18,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 0,
  },
  inputLabel: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    marginLeft: 4,
    marginRight: 4,
  },
  fieldLabel: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  inputDescription: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 12,
    marginLeft: 4,
    marginTop: -4,
    opacity: 0.7
  },
  fieldErrorText: {
    color: Colors.dark.error,
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  fieldErrorBorder: {
    borderColor: Colors.dark.error,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  ticketForm: {
    marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  addTicketButton: {
    marginTop: 8,
  },
  ticketItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  ticketInfo: {
    flex: 1,
  },
  ticketItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  ticketHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  lockedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  lockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  lockedPillText: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  ticketName: {
    color: Colors.dark.text,
    fontSize: 16,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 4,
  },
  ticketDetails: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  deleteButton: {
    padding: 8,
  },
  vipSectionCard: {
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.22)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  vipSectionHeader: {
    marginBottom: 12,
  },
  vipSectionTitle: {
    fontSize: 18,
    color: Colors.dark.text,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 0,
  },
  vipSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  vipSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginTop: 4,
    opacity: 0.8,
  },
  vipBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.35)',
    backgroundColor: 'rgba(6,182,212,0.10)',
  },
  vipBadgeText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontFamily: 'RussoOne_400Regular',
    letterSpacing: 1,
  },
  vipIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  vipIconRing: {
    flex: 1,
    padding: 2,
    borderRadius: 20,
  },
  vipIconInner: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vipAddButton: {
    marginTop: 4,
  },
  vipCard: {
    padding: 16,
    borderRadius: 18,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  vipCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  vipCardTitle: {
    color: Colors.dark.text,
    fontSize: 14,
    fontFamily: 'RussoOne_400Regular',
    opacity: 0.95,
  },
  vipRemoveButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  premiumHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  premiumSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginTop: 4,
    opacity: 0.8,
  },
  premiumIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  premiumIconRing: {
    flex: 1,
    padding: 2,
    borderRadius: 20,
  },
  premiumIconInner: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixedFooter: {
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 0 : 24,
    backgroundColor: Colors.dark.background,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    zIndex: 100,
    elevation: 10, // Ensure it's above other content on Android
  },
  directButton: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 5,
    zIndex: 200,
  },
  disabledButton: {
    opacity: 0.7,
  },
  gradientButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontFamily: 'RussoOne_400Regular',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#1e1b4b', // Dark background matching the theme
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'flex-end',
  },
  modalDoneButton: {
    color: Colors.dark.primary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  imagePreviewContainer: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  removeImageButton: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  removeIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  uploadPlaceholder: {
    width: '100%',
    height: 120,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderStyle: 'dashed',
    gap: 12,
  },
  uploadText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
});
