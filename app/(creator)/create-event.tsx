import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, KeyboardAvoidingView, Platform, Modal, Pressable, Keyboard, ActionSheetIOS } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEvents, TicketType } from '@/lib/EventContext';
import { useAuth } from '@/lib/AuthContext';
import { getErrorMessage } from '@/lib/errorHelpers';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Calendar, MapPin, DollarSign, Image as ImageIcon, Tag, Plus, Trash2, Clock, Camera, Search, X, Check, Sparkles, Ticket } from 'lucide-react-native';
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

export default function CreateEventScreen() {
  const router = useRouter();
  const { id, isEditing: isEditingParam } = useLocalSearchParams<{ id: string, isEditing: string }>();
  const { addEvent, updateEvent, getEventById } = useEvents();
  const { user } = useAuth();
  const { language } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';
  const isEditing = isEditingParam === 'true';
  const eventId = id;

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  const [loading, setLoading] = useState(false);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [newTicket, setNewTicket] = useState({ name: '', price: '', quantity: '' });
  const [vipReservados, setVipReservados] = useState<VipReservadoDraft[]>([]);

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
  const [isGeocoding, setIsGeocoding] = useState(false);
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
          'Configuración requerida',
          'Debes completar la configuración de Stripe antes de crear o editar eventos.',
          [{ text: 'Ir al panel', onPress: () => router.replace('/(creator)') }]
        );
      }
    };
    checkStripe();
  }, [user]);

  const addVipReservado = () => {
    setVipReservados((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substr(2, 9),
        name: '',
        description: '',
        basePrice: '',
        capacityPeople: '',
        includedBottles: '',
        extraBottlePrice: '',
        quantityAvailable: '',
      },
    ]);
  };

  const updateVipReservado = (id: string, updates: Partial<VipReservadoDraft>) => {
    setVipReservados((prev) => prev.map((v) => (v.id === id ? { ...v, ...updates } : v)));
  };

  const removeVipReservado = (id: string) => {
    setVipReservados((prev) => prev.filter((v) => v.id !== id));
  };

  const saveVipReservadosIfAny = async (eventIdToLink: string) => {
    const normalized = vipReservados
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

    if (normalized.length === 0) return null;

    const errors: string[] = [];
    const rows: Array<{
      event_id: string;
      name: string;
      description: string;
      base_price: number;
      capacity_people: number;
      included_bottles: number;
      extra_bottle_price: number | null;
      quantity_available: number;
    }> = [];

    normalized.forEach((vip, idx) => {
      const basePrice = parseFloat(vip.basePrice.replace(',', '.'));
      const capacityPeople = parseInt(vip.capacityPeople, 10);
      const includedBottles = vip.includedBottles.length > 0 ? parseInt(vip.includedBottles, 10) : 0;
      const quantityAvailable = vip.quantityAvailable.length > 0 ? parseInt(vip.quantityAvailable, 10) : 0;

      const extraBottlePrice =
        vip.extraBottlePrice.length > 0 ? parseFloat(vip.extraBottlePrice.replace(',', '.')) : null;

      const rowErrors: string[] = [];
      if (!vip.name) rowErrors.push('falta el nombre');
      if (!Number.isFinite(basePrice) || basePrice <= 0) rowErrors.push('precio base inválido');
      if (!Number.isFinite(capacityPeople) || capacityPeople <= 0) rowErrors.push('capacidad inválida');
      if (!Number.isFinite(quantityAvailable) || quantityAvailable < 0) rowErrors.push('cantidad disponible inválida');
      if (!Number.isFinite(includedBottles) || includedBottles < 0) rowErrors.push('botellas incluidas inválidas');
      if (extraBottlePrice !== null && (!Number.isFinite(extraBottlePrice) || extraBottlePrice < 0)) {
        rowErrors.push('precio botella extra inválido');
      }

      if (rowErrors.length > 0) {
        errors.push(`• VIP #${idx + 1}: ${rowErrors.join(', ')}`);
        return;
      }

      rows.push({
        event_id: eventIdToLink,
        name: vip.name,
        description: vip.description || '',
        base_price: basePrice,
        capacity_people: capacityPeople,
        included_bottles: includedBottles,
        extra_bottle_price: extraBottlePrice,
        quantity_available: quantityAvailable,
      });
    });

    if (rows.length === 0) {
      return `Reservados VIP no guardados:\n${errors.join('\n')}`;
    }

    try {
      const delRes = await supabase.from('reservados_vip').delete().eq('event_id', eventIdToLink);
      if (delRes.error) {
        const code = (delRes.error as any)?.code ? String((delRes.error as any).code) : '';
        if (code === 'PGRST205') {
          return "Reservados VIP no guardados:\nFalta la tabla 'reservados_vip' en este proyecto de Supabase. Ejecuta la migración 20260318120000_add_reservados_vip.sql y reinicia el schema cache.";
        }
        return `Reservados VIP no guardados:\n${code ? `${code}: ` : ''}${getErrorMessage(delRes.error)}`;
      }

      const insRes = await supabase.from('reservados_vip').insert(rows);
      if (insRes.error) {
        const code = (insRes.error as any)?.code ? String((insRes.error as any).code) : '';
        if (code === 'PGRST205') {
          return "Reservados VIP no guardados:\nFalta la tabla 'reservados_vip' en este proyecto de Supabase. Ejecuta la migración 20260318120000_add_reservados_vip.sql y reinicia el schema cache.";
        }
        return `Reservados VIP no guardados:\n${code ? `${code}: ` : ''}${getErrorMessage(insRes.error)}`;
      }
      if (errors.length > 0) {
        return `Algunos reservados VIP no se guardaron:\n${errors.join('\n')}`;
      }
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
          setTicketTypes(event.ticketTypes);
        }
      }
    }
  }, [isEditing, eventId]);

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

  const validateDateText = () => {
    // Regex for DD/MM/YYYY
    const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = dateText.match(dateRegex);

    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // Month is 0-indexed
      const year = parseInt(match[3], 10);

      const newDate = new Date(date);
      newDate.setFullYear(year, month, day);

      // Check if date is valid
      if (newDate.getFullYear() === year && newDate.getMonth() === month && newDate.getDate() === day) {
        setDate(newDate);
        setHasDateSelected(true);
        // Format consistently
        setDateText(newDate.toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit', year: 'numeric' }));
        return;
      }
    }
    
    // Invalid date, revert or show error? For now, revert if empty or invalid
    if (hasDateSelected) {
       setDateText(date.toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit', year: 'numeric' }));
    } else {
       // Keep text but it won't submit
    }
  };

  const validateTimeText = () => {
    // Regex for HH:MM
    const timeRegex = /^(\d{1,2}):(\d{2})$/;
    const match = timeText.match(timeRegex);

    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);

      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        const newDate = new Date(date);
        newDate.setHours(hours, minutes);
        setDate(newDate);
        setHasTimeSelected(true);
        setTimeText(newDate.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }));
        return;
      }
    }

    if (hasTimeSelected) {
       setTimeText(date.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }));
    }
  };

  const pickImage = async () => {
    const options = ['Hacer Foto', 'Elegir de Galería', 'Cancelar'];
    const cancelButtonIndex = 2;

    const handleSelection = async (index: number) => {
      if (index === 2) return;

      try {
        let result;
        if (index === 0) {
          // Camera
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permiso denegado', 'Necesitamos acceso a la cámara para hacer fotos.');
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
            Alert.alert('Permiso denegado', 'Necesitamos acceso a la galería para subir fotos.');
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
        Alert.alert('Error', 'No se pudo cargar la imagen');
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
        'Subir Imagen',
        'Elige una opción',
        [
          { text: 'Hacer Foto', onPress: () => handleSelection(0) },
          { text: 'Elegir de Galería', onPress: () => handleSelection(1) },
          { text: 'Cancelar', style: 'cancel' },
        ]
      );
    }
  };

  const pickVenuePlanImage = async () => {
    const options = ['Hacer Foto', 'Elegir de Galería', 'Cancelar'];
    const cancelButtonIndex = 2;

    const handleSelection = async (index: number) => {
      if (index === 2) return;

      try {
        let result;
        if (index === 0) {
          // Camera
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permiso denegado', 'Necesitamos acceso a la cámara para hacer fotos.');
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
            Alert.alert('Permiso denegado', 'Necesitamos acceso a la galería para subir fotos.');
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
        Alert.alert('Error', 'No se pudo cargar la imagen del plano');
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
        'Subir Plano',
        'Elige una opción',
        [
          { text: 'Hacer Foto', onPress: () => handleSelection(0) },
          { text: 'Elegir de Galería', onPress: () => handleSelection(1) },
          { text: 'Cancelar', style: 'cancel' },
        ]
      );
    }
  };

  const handleAddTicket = () => {
    if (!newTicket.name || !newTicket.price || !newTicket.quantity) {
      Alert.alert('Error', 'Completa los datos de la entrada');
      return;
    }

    const price = parseFloat(newTicket.price.replace(',', '.'));
    const quantity = parseInt(newTicket.quantity, 10);

    if (isNaN(price) || isNaN(quantity)) {
      Alert.alert('Error', 'El precio y la cantidad deben ser números válidos');
      return;
    }

    setTicketTypes([...ticketTypes, {
      id: Math.random().toString(36).substr(2, 9),
      name: newTicket.name,
      price: price,
      quantity: quantity,
      sold: 0
    }]);
    setNewTicket({ name: '', price: '', quantity: '' });
  };

  const removeTicket = (ticketId: string) => {
    setTicketTypes(ticketTypes.filter(t => t.id !== ticketId));
  };

  const getTotalCapacity = () => ticketTypes.reduce((acc, t) => acc + t.quantity, 0);
  const getDisplayPrice = () => {
    if (ticketTypes.length === 0) return '0';
    const min = Math.min(...ticketTypes.map(t => t.price));
    return min.toString();
  };

  const handleValidateLocation = async () => {
    // Open Map Modal instead of simple geocoding
    setShowMapModal(true);
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
    
    // Validate manual inputs one last time in case onBlur didn't fire
    let currentHasDate = hasDateSelected;
    let currentHasTime = hasTimeSelected;
    let finalDate = new Date(date);

    // Try to parse date text if not selected yet
    if (!currentHasDate && dateText) {
      const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      const match = dateText.match(dateRegex);
      if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const year = parseInt(match[3], 10);
        finalDate.setFullYear(year, month, day);
        if (finalDate.getFullYear() === year && finalDate.getMonth() === month && finalDate.getDate() === day) {
          currentHasDate = true;
        }
      }
    }

    // Try to parse time text if not selected yet
    if (!currentHasTime && timeText) {
      const timeRegex = /^(\d{1,2}):(\d{2})$/;
      const match = timeText.match(timeRegex);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
          finalDate.setHours(hours, minutes);
          currentHasTime = true;
        }
      }
    }

    // Validation
    const errors: string[] = [];

    if (!formData.title.trim()) errors.push("• Falta el nombre del evento");
    if (!formData.location.trim()) errors.push("• Falta la ubicación");
    if (!formData.imageUrl.trim()) errors.push("• Falta la imagen");
    
    if (ticketTypes.length === 0) {
        if (newTicket.name || newTicket.price || newTicket.quantity) {
             errors.push("• Tienes una entrada escrita pero no añadida. Pulsa el botón '+' para añadirla.");
        } else {
             errors.push("• Añade al menos un tipo de entrada");
        }
    }

    if (!currentHasDate) errors.push("• Selecciona o escribe una fecha válida (DD/MM/AAAA)");
    if (!currentHasTime) errors.push("• Selecciona o escribe una hora válida (HH:MM)");

    if (currentHasDate && currentHasTime) {
        const now = new Date();
        if (finalDate < now) {
             errors.push("• La fecha y hora deben ser en el futuro");
        }
    }

    if (errors.length > 0) {
      Alert.alert(
        "Formulario mal rellenado",
        "Por favor revisa los siguientes campos:\n\n" + errors.join("\n")
      );
      return;
    }

    setLoading(true);
    
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
        vipWarning = await saveVipReservadosIfAny(savedEventId);
      }
      setLoading(false);
      Alert.alert(
        '¡Enhorabuena!', 
        vipWarning ? `Lio creado exitosamente\n\n${vipWarning}` : 'Lio creado exitosamente', 
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
          <Text style={styles.headerTitle}>{isEditing ? 'Editar Fiesta' : 'Crear Nueva Fiesta'}</Text>
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
                  <Text style={styles.premiumTitle}>Información Básica</Text>
                  <Text style={styles.premiumSubtitle}>Datos principales del evento.</Text>
                </View>
              </View>
              
              <ThemedInput
                label="Nombre del Evento"
                placeholder="Ej: Noche de Verano"
                value={formData.title}
                onChangeText={(text) => setFormData({ ...formData, title: text })}
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <ThemedInput
                label="Descripción"
                placeholder="¿De qué va la fiesta?"
                value={formData.description}
                onChangeText={(text) => setFormData({ ...formData, description: text })}
                multiline
                numberOfLines={4}
                containerStyle={{ height: 100 }}
              />

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>Fecha</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.8}>
                  <View pointerEvents="none">
                    <ThemedInput
                      value={dateText}
                      onChangeText={() => {}}
                      editable={false}
                      placeholder="Selecciona fecha"
                      icon={<Calendar size={20} color={Colors.dark.textSecondary} />}
                    />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>Hora</Text>
                <TouchableOpacity onPress={() => setShowTimePicker(true)} activeOpacity={0.8}>
                  <View pointerEvents="none">
                    <ThemedInput
                      value={timeText}
                      onChangeText={() => {}}
                      editable={false}
                      placeholder="Selecciona hora"
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
                          <Text style={styles.modalDoneButton}>Listo</Text>
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
                    <TouchableOpacity onPress={() => setShowMapModal(true)} activeOpacity={0.8}>
                        <View pointerEvents="none">
                            <ThemedInput
                            label="Ubicación"
                            placeholder="Toca para buscar en el mapa"
                            value={formData.location}
                            onChangeText={(text) => setFormData({ ...formData, location: text })}
                            icon={<MapPin size={20} color={Colors.dark.textSecondary} />}
                            editable={false}
                            />
                        </View>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity 
                    onPress={() => setShowMapModal(true)}
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
                        ✓ Ubicación verificada:
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
                                    placeholder="Buscar ciudad, calle..."
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
                                <MapPin size={48} color={Colors.dark.primary} fill="white" />
                            </View>
                            
                            <View style={{ position: 'absolute', bottom: 30, left: 20, right: 20 }}>
                                <ThemedButton 
                                    title="Confirmar Ubicación"
                                    onPress={confirmMapLocation}
                                    icon={<Check size={20} color="white" />}
                                />
                            </View>
                        </View>
                    </SafeAreaView>
                </View>
              </Modal>

              <ThemedInput
                label="Tipo de Música"
                placeholder="Ej: Reggaeton, Techno, Comercial"
                value={formData.theme}
                onChangeText={(text) => setFormData({ ...formData, theme: text })}
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <ThemedInput
                label="Edad Mínima"
                placeholder="Ej: 18"
                value={formData.ageRestriction}
                onChangeText={(text) => setFormData({ ...formData, ageRestriction: text })}
                keyboardType="numeric"
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <ThemedInput
                label="Dress Code"
                placeholder="Ej: Elegante, Casual"
                value={formData.dressCode}
                onChangeText={(text) => setFormData({ ...formData, dressCode: text })}
                icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              />

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>Imagen del Evento</Text>
                {formData.imageUrl ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: formData.imageUrl }} style={styles.imagePreview} resizeMode="cover" />
                    <TouchableOpacity style={styles.removeImageButton} onPress={() => setFormData({ ...formData, imageUrl: '' })}>
                      <GlassView intensity={20} style={styles.removeIconContainer}>
                        <Trash2 size={20} color={Colors.dark.error} />
                      </GlassView>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={pickImage} activeOpacity={0.8}>
                     <GlassView intensity={10} style={styles.uploadPlaceholder}>
                        <Camera size={32} color={Colors.dark.textSecondary} />
                        <Text style={styles.uploadText}>Subir foto o hacer foto</Text>
                     </GlassView>
                  </TouchableOpacity>
                )}
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>Plano de la Discoteca (Opcional)</Text>
                <Text style={styles.inputDescription}>Ayuda a tus clientes a ubicar las mesas VIP</Text>
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
                        <Text style={styles.uploadText}>Subir plano del local</Text>
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
                  <Text style={styles.premiumTitle}>Entradas</Text>
                  <Text style={styles.premiumSubtitle}>Configura tipos de entrada y stock.</Text>
                </View>
              </View>
              
              <View style={styles.ticketForm}>
                <ThemedInput
                  placeholder="Nombre (ej: General)"
                  value={newTicket.name}
                  onChangeText={(text) => setNewTicket({ ...newTicket, name: text })}
                  containerStyle={{ marginBottom: 12 }}
                />
                <View style={styles.row}>
                  <View style={styles.halfWidth}>
                    <ThemedInput
                      placeholder="Precio (€)"
                      value={newTicket.price}
                      onChangeText={(text) => setNewTicket({ ...newTicket, price: text })}
                      keyboardType="numeric"
                      icon={<DollarSign size={16} color={Colors.dark.textSecondary} />}
                    />
                  </View>
                  <View style={styles.halfWidth}>
                    <ThemedInput
                      placeholder="Cantidad"
                      value={newTicket.quantity}
                      onChangeText={(text) => setNewTicket({ ...newTicket, quantity: text })}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                
                <ThemedButton
                  title="Añadir Entrada"
                  onPress={handleAddTicket}
                  variant="outline"
                  style={styles.addTicketButton}
                  icon={<Plus size={20} color={Colors.dark.primary} />}
                />
              </View>

              {ticketTypes.map((ticket) => (
                <View key={ticket.id} style={styles.ticketItem}>
                  <View style={styles.ticketInfo}>
                    <Text style={styles.ticketName}>{ticket.name}</Text>
                    <Text style={styles.ticketDetails}>{ticket.price}€ • {ticket.quantity} uds</Text>
                  </View>
                  <TouchableOpacity onPress={() => removeTicket(ticket.id)} style={styles.deleteButton}>
                    <Trash2 size={20} color={Colors.dark.error} />
                  </TouchableOpacity>
                </View>
              ))}
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
                    <Text style={styles.vipSectionTitle}>Reservados VIP (Opcional)</Text>
                    <Text style={styles.vipSubtitle}>Se guardan aparte y no afectan a las entradas.</Text>
                  </View>
                  <View style={styles.vipBadge}>
                    <Text style={styles.vipBadgeText}>VIP</Text>
                  </View>
                </View>
              </View>

              <ThemedButton
                title="+ Añadir reservado VIP"
                onPress={addVipReservado}
                variant="outline"
                style={styles.vipAddButton}
                icon={<Plus size={20} color={Colors.dark.primary} />}
              />

              <View style={{ height: 16 }} />

              {vipReservados.map((vip, index) => (
                <View key={vip.id} style={styles.vipCard}>
                  <LinearGradient
                    colors={['rgba(124,58,237,0.18)', 'rgba(6,182,212,0.10)', 'rgba(255,255,255,0.03)']}
                    locations={[0, 0.5, 1]}
                    style={StyleSheet.absoluteFill}
                  />

                  <View style={styles.vipCardHeader}>
                    <Text style={styles.vipCardTitle}>Reservado VIP #{index + 1}</Text>
                    <TouchableOpacity onPress={() => removeVipReservado(vip.id)} style={styles.vipRemoveButton}>
                      <Trash2 size={18} color={Colors.dark.error} />
                    </TouchableOpacity>
                  </View>

                  <ThemedInput
                    label="Nombre del reservado"
                    placeholder="Ej: Mesa Oro"
                    value={vip.name}
                    onChangeText={(text) => updateVipReservado(vip.id, { name: text })}
                  />

                  <ThemedInput
                    label="Descripción"
                    placeholder="Detalles, ubicación, condiciones…"
                    value={vip.description}
                    onChangeText={(text) => updateVipReservado(vip.id, { description: text })}
                    multiline
                    numberOfLines={3}
                    containerStyle={{ height: 86 }}
                  />

                  <View style={styles.row}>
                    <View style={styles.halfWidth}>
                      <ThemedInput
                        label="Precio base (€)"
                        placeholder="Ej: 200"
                        value={vip.basePrice}
                        onChangeText={(text) => updateVipReservado(vip.id, { basePrice: text })}
                        keyboardType="numeric"
                        icon={<DollarSign size={16} color={Colors.dark.textSecondary} />}
                      />
                    </View>
                    <View style={styles.halfWidth}>
                      <ThemedInput
                        label="Capacidad"
                        placeholder="Ej: 6"
                        value={vip.capacityPeople}
                        onChangeText={(text) => updateVipReservado(vip.id, { capacityPeople: text })}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  <View style={styles.row}>
                    <View style={styles.halfWidth}>
                      <ThemedInput
                        label="Botellas incluidas"
                        placeholder="Ej: 1"
                        value={vip.includedBottles}
                        onChangeText={(text) => updateVipReservado(vip.id, { includedBottles: text })}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.halfWidth}>
                      <ThemedInput
                        label="Cantidad"
                        placeholder="Ej: 3"
                        value={vip.quantityAvailable}
                        onChangeText={(text) => updateVipReservado(vip.id, { quantityAvailable: text })}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  <ThemedInput
                    label="Precio botella extra (€)"
                    placeholder="Opcional (ej: 120)"
                    value={vip.extraBottlePrice}
                    onChangeText={(text) => updateVipReservado(vip.id, { extraBottlePrice: text })}
                    keyboardType="numeric"
                    icon={<DollarSign size={16} color={Colors.dark.textSecondary} />}
                  />
                </View>
              ))}
            </GlassView>

            <TouchableOpacity 
                style={[styles.directButton, loading && styles.disabledButton, { marginBottom: 40 }]}
                onPress={handleCreate}
                disabled={loading}
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
                    {isEditing ? 'Guardar Cambios' : 'Publicar Evento'}
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
  inputDescription: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 12,
    marginLeft: 4,
    marginTop: -4,
    opacity: 0.7
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
    alignItems: 'center',
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
