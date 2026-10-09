import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User, MapPin, Calendar, Building2, PartyPopper, Edit2, RefreshCw, Check, Building, CreditCard } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '@/constants/Colors';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { calculateAgeFromDate, getPasswordRequirements, isPasswordStrong, isSafeAddressText, isSafeOrgText, isValidIbanES, isValidPersonName, isValidSpanishTaxId, normalizeWhitespaceForInput } from '@/lib/validators';
import { useAppDialog } from '@/components/ui/AppDialog';
import { VenueLocationPicker } from '@/components/ui/VenueLocationPicker';

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const { show: showDialog } = useAppDialog();
  
  // Steps:
  // 1. Role Selection
  // 2. Personal/Club Info (Name, Location)
  // 3. Specific Info (Attendee: DOB, Organizer: Legal/Tax)
  // 4. Account (Email, Password)
  // 5. Email verification
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Date Picker State
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [responsibleBirthDate, setResponsibleBirthDate] = useState<Date | null>(null);
  const [activeDateField, setActiveDateField] = useState<'attendee' | 'responsible'>('attendee');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerDraft, setDatePickerDraft] = useState<Date>(new Date(2000, 0, 1));

  // Location State
  const [locationStatus, setLocationStatus] = useState<'idle' | 'detecting' | 'success' | 'error'>('idle');
  const [manualLocation, setManualLocation] = useState(false);
  const [showVenueMap, setShowVenueMap] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedLicenses, setAcceptedLicenses] = useState(false);
  const [emailConfirmedLoading, setEmailConfirmedLoading] = useState(false);

  // Form Data
  const [formData, setFormData] = useState({
    role: 'attendee' as 'attendee' | 'organizer',
    // Account
    email: '',
    password: '',
    confirmPassword: '',
    // Personal (Attendee)
    firstName: '',
    lastName: '',
    // Personal (Organizer)
    clubName: '',
    venueAddress: '',
    fiscalAddress: '',
    postalCode: '',
    responsibleName: '',
    iban: '',
    // Common
    city: '',
    country: '',
    // Stripe Connect / Business
    legalName: '',
    taxIdNumber: '',
    businessType: 'individual' as 'individual' | 'company',
  });

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (key: string) => setTouched((prev) => ({ ...prev, [key]: true }));

  const [clubNameUnavailable, setClubNameUnavailable] = useState<string | null>(null);

  const passwordRequirements = useMemo(() => getPasswordRequirements(formData.password), [formData.password]);
  const passwordStrong = useMemo(() => isPasswordStrong(formData.password), [formData.password]);
  const passwordHasInvalidChars = useMemo(() => !!formData.password && !passwordRequirements.onlyAllowedChars, [formData.password, passwordRequirements.onlyAllowedChars]);
  const passwordAllowedSpecials = `!@#$%^&*(),.?":{}|<>`;

  const clearSensitiveFields = useCallback(() => {
    setShowPassword(false);
    setSubmitAttempted(false);
    setTouched({});
    setFormData((prev) => ({
      ...prev,
      password: '',
      confirmPassword: '',
    }));
  }, []);

  const setRole = useCallback(
    (nextRole: 'attendee' | 'organizer') => {
      clearSensitiveFields();
      setBirthDate(null);
      setResponsibleBirthDate(null);
      setAcceptedLicenses(false);
      setAcceptedTerms(false);
      setAcceptedPrivacy(false);
      setClubNameUnavailable(null);
      setManualLocation(false);
      setLocationStatus('idle');
      setFormData((prev) => ({
        ...prev,
        role: nextRole,
        ...(nextRole === 'organizer'
          ? { firstName: '', lastName: '' }
          : { clubName: '', venueAddress: '', fiscalAddress: '', postalCode: '', responsibleName: '', iban: '', legalName: '', taxIdNumber: '' }),
      }));
    },
    [clearSensitiveFields]
  );

  const sanitizeByAllowed = (text: string, allowed: RegExp) => {
    const raw = String(text || '');
    let out = '';
    for (const ch of raw) {
      if (allowed.test(ch)) out += ch;
    }
    return out;
  };

  const sanitizeNameText = (text: string) => sanitizeByAllowed(text, /^[\p{L}\s]$/u);
  const sanitizeCityCountryText = (text: string) => sanitizeByAllowed(text, /^[\p{L}\s]$/u);
  const sanitizeOrgText = (text: string) => sanitizeByAllowed(text, /^[\p{L}\p{N}\s.&'’"\-()/#]$/u);
  const sanitizeAddressText = (text: string) => sanitizeByAllowed(text, /^[\p{L}\p{N}\s.,'’"\-#/ºª]$/u);
  const sanitizePostalCode = (text: string) => String(text || '').replace(/[^\d]/g, '').slice(0, 5);
  const sanitizeIban = (text: string) => String(text || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const sanitizeTaxId = (text: string) => String(text || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

  const updateForm = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const setField = (key: string, value: string) => {
    touch(key);
    if (key === 'firstName' || key === 'lastName' || key === 'responsibleName') {
      updateForm(key, normalizeWhitespaceForInput(sanitizeNameText(value)));
      return;
    }
    if (key === 'city' || key === 'country') {
      updateForm(key, normalizeWhitespaceForInput(sanitizeCityCountryText(value)));
      return;
    }
    if (key === 'clubName' || key === 'legalName') {
      setClubNameUnavailable(null);
      updateForm(key, normalizeWhitespaceForInput(sanitizeOrgText(value)));
      return;
    }
    if (key === 'venueAddress' || key === 'fiscalAddress') {
      updateForm(key, normalizeWhitespaceForInput(sanitizeAddressText(value)));
      return;
    }
    if (key === 'postalCode') {
      updateForm(key, sanitizePostalCode(value));
      return;
    }
    if (key === 'iban') {
      updateForm(key, sanitizeIban(value));
      return;
    }
    if (key === 'taxIdNumber') {
      updateForm(key, sanitizeTaxId(value));
      return;
    }
    updateForm(key, value);
  };

  const detectLocation = useCallback(async () => {
    setLocationStatus('detecting');
    setManualLocation(false);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationStatus('error');
        setManualLocation(true);
        showDialog({
          title: 'GPS desactivado',
          message: 'Activa la ubicación en tu dispositivo para usar el GPS, o escribe la ubicación manualmente.',
        });
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('error');
        setManualLocation(true);
        showDialog({
          title: 'Permiso requerido',
          message: 'Necesitamos permiso de ubicación para rellenar ciudad y país automáticamente.',
        });
        return;
      }

      const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 120 });
      const location =
        last ||
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }));

      const geocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const address = geocode && geocode.length > 0 ? geocode[0] : null;
      const city =
        normalizeWhitespaceForInput(String(address?.city || '')) ||
        normalizeWhitespaceForInput(String(address?.subregion || '')) ||
        normalizeWhitespaceForInput(String((address as any)?.district || '')) ||
        normalizeWhitespaceForInput(String(address?.region || ''));
      const country =
        normalizeWhitespaceForInput(String(address?.country || '')) ||
        normalizeWhitespaceForInput(String((address as any)?.isoCountryCode || ''));

      if (!city && !country) {
        setLocationStatus('error');
        setManualLocation(true);
        showDialog({
          title: 'No se pudo detectar',
          message: 'No pudimos obtener tu ciudad/país con el GPS. Intenta de nuevo o escríbelo manualmente.',
        });
        return;
      }

      setFormData((prev) => ({
        ...prev,
        city: city || prev.city,
        country: country || prev.country,
      }));
      setLocationStatus('success');
    } catch {
      console.warn('No se pudo obtener la ubicación durante el registro.');
      setLocationStatus('error');
      setManualLocation(true);
      showDialog({
        title: 'Error de ubicación',
        message: 'No pudimos obtener tu ubicación. Revisa permisos, GPS y conexión, o escribe la ubicación manualmente.',
      });
    }
  }, [showDialog]);

  // Auto-detect location when entering Step 2
  useEffect(() => {
    if (step === 2 && formData.role !== 'organizer' && locationStatus === 'idle') {
      detectLocation();
    }
  }, [detectLocation, locationStatus, step, formData.role]);

  const onDateChange = (_event: any, selectedDate?: Date) => {
    if (!selectedDate) return;
    if (Platform.OS === 'ios') {
      setDatePickerDraft(selectedDate);
      return;
    }
    setShowDatePicker(false);
    if (activeDateField === 'attendee') {
      touch('birthDate');
      setBirthDate(selectedDate);
    } else {
      touch('responsibleBirthDate');
      setResponsibleBirthDate(selectedDate);
    }
  };

  const openDatePicker = (field: 'attendee' | 'responsible') => {
    setActiveDateField(field);
    const current = field === 'attendee' ? birthDate : responsibleBirthDate;
    setDatePickerDraft(current || new Date(2000, 0, 1));
    if (field === 'attendee') touch('birthDate');
    else touch('responsibleBirthDate');
    setShowDatePicker(true);
  };

  const confirmIOSDate = () => {
    setShowDatePicker(false);
    if (activeDateField === 'attendee') {
      touch('birthDate');
      setBirthDate(datePickerDraft);
    } else {
      touch('responsibleBirthDate');
      setResponsibleBirthDate(datePickerDraft);
    }
  };

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const role = formData.role === 'organizer' ? 'organizer' : 'attendee';

    const required = (key: string, value: string, msg: string) => {
      if (!String(value || '').trim()) errors[key] = msg;
    };

    if (step === 2) {
      if (formData.country.trim() && !isValidPersonName(formData.country)) errors.country = 'Solo letras y espacios. Sin emojis.';
      if (role === 'attendee') {
        required('firstName', formData.firstName, 'El nombre es obligatorio.');
        if (formData.firstName.trim() && !isValidPersonName(formData.firstName)) errors.firstName = 'Solo letras y espacios. Sin emojis.';

        required('lastName', formData.lastName, 'Los apellidos son obligatorios.');
        if (formData.lastName.trim() && !isValidPersonName(formData.lastName)) errors.lastName = 'Solo letras y espacios. Sin emojis.';
      } else {
        required('clubName', formData.clubName, 'El nombre del local es obligatorio.');
        if (formData.clubName.trim() && !isSafeOrgText(formData.clubName)) errors.clubName = 'No se permiten emojis ni caracteres especiales.';
        if (clubNameUnavailable) errors.clubName = clubNameUnavailable;

        required('venueAddress', formData.venueAddress, 'La dirección del local es obligatoria.');
        if (formData.venueAddress.trim() && !isSafeAddressText(formData.venueAddress)) errors.venueAddress = 'No se permiten emojis ni caracteres especiales.';

        required('city', formData.city, 'La ciudad es obligatoria.');
        if (formData.city.trim() && !isValidPersonName(formData.city)) errors.city = 'Solo letras y espacios. Sin emojis.';

        required('postalCode', formData.postalCode, 'El código postal es obligatorio.');
        if (formData.postalCode.trim() && !/^\d{5}$/.test(formData.postalCode)) errors.postalCode = 'Formato inválido. Ejemplo: 28001';
      }
    }

    if (step === 3) {
      if (role === 'attendee') {
        if (!birthDate) errors.birthDate = 'Selecciona tu fecha de nacimiento.';
        else if (calculateAgeFromDate(birthDate) < 18) errors.birthDate = 'Debes ser mayor de 18 años.';
      } else {
        required('legalName', formData.legalName, 'El nombre legal es obligatorio.');
        if (formData.legalName.trim() && !isSafeOrgText(formData.legalName)) errors.legalName = 'No se permiten emojis ni caracteres especiales.';

        required('taxIdNumber', formData.taxIdNumber, 'El CIF/NIF es obligatorio.');
        if (formData.taxIdNumber.trim() && !isValidSpanishTaxId(formData.taxIdNumber)) errors.taxIdNumber = 'Ingresa un CIF/NIF/NIE válido.';

        required('responsibleName', formData.responsibleName, 'El nombre del responsable es obligatorio.');
        if (formData.responsibleName.trim() && !isValidPersonName(formData.responsibleName)) errors.responsibleName = 'Solo letras y espacios. Sin emojis.';

        if (!responsibleBirthDate) errors.responsibleBirthDate = 'Selecciona la fecha de nacimiento del responsable.';
        else if (calculateAgeFromDate(responsibleBirthDate) < 18) errors.responsibleBirthDate = 'El responsable debe ser mayor de 18 años.';

        required('fiscalAddress', formData.fiscalAddress, 'La dirección fiscal es obligatoria.');
        if (formData.fiscalAddress.trim() && !isSafeAddressText(formData.fiscalAddress)) errors.fiscalAddress = 'No se permiten emojis ni caracteres especiales.';

        required('iban', formData.iban, 'El IBAN es obligatorio.');
        if (formData.iban.trim() && !isValidIbanES(formData.iban)) errors.iban = 'Ingresa un IBAN válido de España.';

        if (!acceptedLicenses) errors.acceptedLicenses = 'Debes declarar que dispones de las licencias necesarias.';
      }
    }

    if (step === 4) {
      required('email', formData.email, 'El email es obligatorio.');
      if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.email)) errors.email = 'Formato de email inválido.';

      required('password', formData.password, 'La contraseña es obligatoria.');
      if (formData.password && !passwordStrong) errors.password = 'La contraseña debe cumplir todos los requisitos.';

      required('confirmPassword', formData.confirmPassword, 'Confirma la contraseña.');
      if (formData.confirmPassword && formData.password !== formData.confirmPassword) errors.confirmPassword = 'Las contraseñas no coinciden.';

      if (!acceptedTerms) errors.acceptedTerms = 'Debes aceptar los Términos y Condiciones.';
      if (!acceptedPrivacy) errors.acceptedPrivacy = 'Debes aceptar la Política de Privacidad.';
    }

    return errors;
  }, [
    step,
    formData,
    birthDate,
    responsibleBirthDate,
    acceptedLicenses,
    acceptedTerms,
    acceptedPrivacy,
    clubNameUnavailable,
    passwordStrong,
  ]);

  const showFieldError = (key: string) => (submitAttempted || touched[key]) ? fieldErrors[key] : undefined;
  const showFieldSuccess = (key: string) =>
    !!touched[key] && !fieldErrors[key] && !!String((formData as any)[key] || '').trim();

  const validateStep = async () => {
    if (step === 1) return true;
    setSubmitAttempted(true);

    // Step 2: Basic Info (Name/Club + Location)
    if (step === 2) {
      if (formData.role === 'attendee') {
        touch('firstName');
        touch('lastName');
        if (fieldErrors.firstName || fieldErrors.lastName) return false;
      } else {
        touch('clubName');
        touch('venueAddress');
        touch('city');
        touch('postalCode');
        if (fieldErrors.clubName || fieldErrors.venueAddress || fieldErrors.city || fieldErrors.postalCode) return false;
        
        setLoading(true);
        try {
          const { data } = await (supabase as any)
            .from('public_profile_cards')
            .select('id')
            .ilike('club_name', formData.clubName.trim())
            .maybeSingle();

          if (data) {
            setClubNameUnavailable('Ya existe un local con este nombre.');
            setLoading(false);
            return false;
          }
        } catch { /* ignore */ }
        setLoading(false);
      }
      return true;
    }

    // Step 3: Specific Info
    if (step === 3) {
      if (formData.role === 'attendee') {
        if (fieldErrors.birthDate) return false;
      } else {
        touch('legalName');
        touch('taxIdNumber');
        touch('responsibleName');
        touch('fiscalAddress');
        touch('iban');
        if (
          fieldErrors.legalName ||
          fieldErrors.taxIdNumber ||
          fieldErrors.responsibleName ||
          fieldErrors.responsibleBirthDate ||
          fieldErrors.fiscalAddress ||
          fieldErrors.iban ||
          fieldErrors.acceptedLicenses
        ) return false;
      }
      return true;
    }

    if (step === 4) {
      touch('email');
      touch('password');
      touch('confirmPassword');
      if (fieldErrors.email || fieldErrors.password || fieldErrors.confirmPassword || fieldErrors.acceptedTerms || fieldErrors.acceptedPrivacy) return false;
      return true;
    }

    return true;
  };

  const handleNextStep = async () => {
    if (await validateStep()) {
      if (step < 4) {
        setStep(prev => prev + 1);
      } else {
        handleRegister();
      }
    }
  };

  const handleRegister = async () => {
    const { email, password, confirmPassword, role } = formData;
    const safeRole = role === 'organizer' ? 'organizer' : 'attendee';

    if (!email.trim()) {
      showDialog({ title: 'Faltan datos', message: 'Ingresa tu correo electrónico.' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showDialog({ title: 'Email inválido', message: 'Por favor ingresa un correo válido.' });
      return;
    }

    if (password !== confirmPassword) {
      showDialog({ title: 'Error', message: 'Las contraseñas no coinciden.' });
      return;
    }

    if (!passwordStrong) {
      showDialog({ title: 'Contraseña insegura', message: 'La contraseña debe cumplir todos los requisitos de seguridad.' });
      return;
    }

    if (!acceptedTerms || !acceptedPrivacy) {
      showDialog({
        title: 'Requisitos legales',
        message: 'Debes aceptar los Términos y Condiciones y la Política de Privacidad para registrarte.',
      });
      return;
    }

    setLoading(true);

    try {
      const age = birthDate ? calculateAgeFromDate(birthDate) : 0;
      const acceptedAt = new Date().toISOString();
      
      const metadata = {
        role: safeRole,
        full_name: safeRole === 'organizer' ? formData.clubName : `${formData.firstName} ${formData.lastName}`,
        email: email,
        club_name: formData.clubName,
        address: formData.venueAddress,
        legal_name: formData.legalName,
        tax_id_number: formData.taxIdNumber,
        business_type: formData.businessType,
        first_name: formData.firstName,
        last_name: formData.lastName,
        age: age,
        city: formData.city,
        country: formData.country,
        organizer_venue_address: formData.venueAddress,
        organizer_fiscal_address: formData.fiscalAddress,
        organizer_postal_code: formData.postalCode,
        organizer_responsible_name: formData.responsibleName,
        organizer_responsible_birthdate: responsibleBirthDate ? responsibleBirthDate.toISOString().slice(0, 10) : null,
        organizer_iban: formData.iban,
        organizer_licenses_declared_at: safeRole === 'organizer' ? acceptedAt : null,
        accepted_terms_at: acceptedAt,
        accepted_privacy_at: acceptedAt
      };

      const { error } = await signUp(email, password, metadata);

      if (error) throw error;

      showDialog({
        title: 'Confirma tu email',
        message: 'Te enviamos un enlace de confirmación. Revisa tu correo electrónico y confirma tu cuenta para continuar.',
        actions: [{ label: 'Continuar', onPress: () => setStep(5), variant: 'primary' }],
      });

    } catch (error: any) {
      const msg = error?.message ? String(error.message) : 'Ocurrió un error.';
      const lower = msg.toLowerCase();
      if (lower.includes('error sending confirmation email') || lower.includes('error sending email') || lower.includes('smtp')) {
        showDialog({
          title: 'No se pudo enviar el correo de confirmación',
          message: 'Hay un problema con el servicio de correo. Tus datos siguen en el formulario. Inténtalo cuando el servicio esté restablecido; no necesitas rellenarlo de nuevo.',
        });
        return;
      }
      const isEmailRateLimit = lower.includes('email rate limit') || lower.includes('rate limit exceeded');
      if (isEmailRateLimit) {
        showDialog({
          title: 'Límite de emails alcanzado',
          message:
            'El servicio de correo ha alcanzado temporalmente su límite. Espera unos minutos y vuelve a intentarlo. La cuenta nunca se activará sin verificar el email.',
        });
        return;
      }
      const hint = msg.includes('Database error saving new user')
        ? '\n\nSuele indicar que falló un trigger/migración en Supabase (creación de profile/wallet). Aplica las migraciones y refresca el schema cache.'
        : '';
      showDialog({ title: 'Error de Registro', message: `${msg}${hint}` });
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>¿Cómo quieres usar la app?</Text>
      
      <TouchableOpacity 
        style={[styles.roleCard, formData.role === 'attendee' && styles.activeRoleCard]}
        onPress={() => setRole('attendee')}
      >
        <PartyPopper size={40} color={formData.role === 'attendee' ? Colors.dark.primary : '#ccc'} />
        <Text style={[styles.roleTitle, formData.role === 'attendee' && styles.activeRoleText]}>Soy Fiestero</Text>
        <Text style={styles.roleDesc}>Quiero descubrir eventos y comprar entradas</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.roleCard, formData.role === 'organizer' && styles.activeRoleCard]}
        onPress={() => setRole('organizer')}
      >
        <Building2 size={40} color={formData.role === 'organizer' ? Colors.dark.primary : '#ccc'} />
        <Text style={[styles.roleTitle, formData.role === 'organizer' && styles.activeRoleText]}>Soy Organizador</Text>
        <Text style={styles.roleDesc}>Tengo una discoteca o evento y quiero vender entradas</Text>
      </TouchableOpacity>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>
        {formData.role === 'organizer' ? 'Datos del Local y Fiscales' : 'Información Personal'}
      </Text>

      {formData.role === 'organizer' ? (
        <>
          <ThemedInput
            placeholder="Nombre comercial del local"
            value={formData.clubName}
            onChangeText={(t) => setField('clubName', t)}
            onBlur={() => touch('clubName')}
            error={showFieldError('clubName')}
            success={showFieldSuccess('clubName')}
            icon={Building2}
          />
          <ThemedInput
            placeholder="Dirección física del local"
            value={formData.venueAddress}
            onChangeText={(t) => setField('venueAddress', t)}
            onBlur={() => touch('venueAddress')}
            error={showFieldError('venueAddress')}
            success={showFieldSuccess('venueAddress')}
            icon={MapPin}
          />
          {Platform.OS !== 'web' && <>
            <TouchableOpacity accessibilityRole="button" onPress={() => setShowVenueMap(true)} style={styles.retryLocation}>
              <MapPin size={20} color={Colors.dark.primary} />
              <Text style={{ color: Colors.dark.primary, marginLeft: 8 }}>Elegir la calle en el mapa</Text>
            </TouchableOpacity>
            {showVenueMap && <VenueLocationPicker
              initialAddress={[formData.venueAddress, formData.city].filter(Boolean).join(', ')}
              onClose={() => setShowVenueMap(false)}
              onSelect={location => {
                setField('venueAddress', location.address);
                setField('city', location.city);
                setField('postalCode', location.postalCode);
                if (location.country) setField('country', location.country);
                setShowVenueMap(false);
              }}
            />}
          </>}
          <ThemedInput
            placeholder="Ciudad"
            value={formData.city}
            onChangeText={(t) => setField('city', t)}
            onBlur={() => touch('city')}
            error={showFieldError('city')}
            success={showFieldSuccess('city')}
            icon={MapPin}
          />
          <ThemedInput
            placeholder="Código postal"
            value={formData.postalCode}
            onChangeText={(t) => setField('postalCode', t)}
            onBlur={() => touch('postalCode')}
            error={showFieldError('postalCode')}
            success={showFieldSuccess('postalCode')}
            icon={MapPin}
            keyboardType="number-pad"
          />
        </>
      ) : (
        <>
          <ThemedInput
            placeholder="Nombre"
            value={formData.firstName}
            onChangeText={(t) => setField('firstName', t)}
            onBlur={() => touch('firstName')}
            error={showFieldError('firstName')}
            success={showFieldSuccess('firstName')}
            icon={User}
          />
          <ThemedInput
            placeholder="Apellidos"
            value={formData.lastName}
            onChangeText={(t) => setField('lastName', t)}
            onBlur={() => touch('lastName')}
            error={showFieldError('lastName')}
            success={showFieldSuccess('lastName')}
            icon={User}
          />
        </>
      )}

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Ubicación</Text>
        {!manualLocation && (locationStatus === 'detecting' || locationStatus === 'success') ? (
            <GlassView style={styles.locationCard}>
                {locationStatus === 'detecting' ? (
                    <View style={styles.locationRow}>
                        <DiscoLoader size={18} />
                        <Text style={styles.locationText}>Detectando ubicación...</Text>
                    </View>
                ) : (
                    <View style={styles.locationRow}>
                        <MapPin size={20} color={Colors.dark.success} />
                        <Text style={styles.locationText}>{formData.city}, {formData.country}</Text>
                        <TouchableOpacity onPress={() => { setManualLocation(true); setLocationStatus('idle'); }}>
                            <Edit2 size={16} color={Colors.dark.textSecondary} />
                        </TouchableOpacity>
                    </View>
                )}
            </GlassView>
        ) : (
            <View style={styles.manualLocationContainer}>
                <ThemedInput
                  placeholder="Ciudad"
                  value={formData.city}
                  onChangeText={(t) => setField('city', t)}
                  onBlur={() => touch('city')}
                  error={showFieldError('city')}
                  success={showFieldSuccess('city')}
                  icon={MapPin}
                />
                <ThemedInput
                  placeholder="País"
                  value={formData.country}
                  onChangeText={(t) => setField('country', t)}
                  onBlur={() => touch('country')}
                  error={showFieldError('country')}
                  success={showFieldSuccess('country')}
                  icon={Building}
                />
                <TouchableOpacity style={styles.retryLocation} onPress={() => { void detectLocation(); }}>
                    <RefreshCw size={16} color={Colors.dark.primary} />
                    <Text style={styles.retryText}>Usar GPS</Text>
                </TouchableOpacity>
            </View>
        )}
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>
        {formData.role === 'organizer' ? 'Datos legales y contacto' : 'Datos personales'}
      </Text>
      
      {formData.role === 'organizer' ? (
        <>
          <ThemedInput
            placeholder="Razón social o nombre legal"
            value={formData.legalName}
            onChangeText={(t) => setField('legalName', t)}
            onBlur={() => touch('legalName')}
            error={showFieldError('legalName')}
            success={showFieldSuccess('legalName')}
            icon={Building2}
          />
          <ThemedInput
            placeholder="CIF/NIF (España)"
            value={formData.taxIdNumber}
            onChangeText={(t) => setField('taxIdNumber', t)}
            onBlur={() => touch('taxIdNumber')}
            error={showFieldError('taxIdNumber')}
            success={showFieldSuccess('taxIdNumber')}
            autoCapitalize="characters"
            icon={Check}
          />
          <ThemedInput
            placeholder="Nombre del responsable"
            value={formData.responsibleName}
            onChangeText={(t) => setField('responsibleName', t)}
            onBlur={() => touch('responsibleName')}
            error={showFieldError('responsibleName')}
            success={showFieldSuccess('responsibleName')}
            icon={User}
          />

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Fecha de nacimiento del responsable</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => {
                openDatePicker('responsible');
              }}
            >
                <Calendar size={20} color={Colors.dark.textSecondary} />
                <Text style={[styles.dateText, !responsibleBirthDate && { color: '#666' }]}>
                  {responsibleBirthDate ? responsibleBirthDate.toLocaleDateString() : 'Seleccionar fecha'}
                </Text>
            </TouchableOpacity>
            {(submitAttempted || touched['responsibleBirthDate']) && fieldErrors.responsibleBirthDate ? (
              <Text style={styles.errorText}>{fieldErrors.responsibleBirthDate}</Text>
            ) : null}
            {showDatePicker && activeDateField === 'responsible' && Platform.OS !== 'ios' && (
              <DateTimePicker
                value={responsibleBirthDate || new Date(1990, 0, 1)}
                mode="date"
                display="spinner"
                positiveButton={{ label: "Aceptar" }}
                negativeButton={{ label: "Cancelar" }}
                onChange={onDateChange}
                maximumDate={new Date()}
              />
            )}
          </View>

          <ThemedInput
            placeholder="Dirección fiscal"
            value={formData.fiscalAddress}
            onChangeText={(t) => setField('fiscalAddress', t)}
            onBlur={() => touch('fiscalAddress')}
            error={showFieldError('fiscalAddress')}
            success={showFieldSuccess('fiscalAddress')}
            icon={MapPin}
          />
          <ThemedInput
            placeholder="IBAN"
            value={formData.iban}
            onChangeText={(t) => setField('iban', t)}
            onBlur={() => touch('iban')}
            error={showFieldError('iban')}
            success={showFieldSuccess('iban')}
            autoCapitalize="characters"
            icon={CreditCard}
          />

          <TouchableOpacity activeOpacity={0.8} style={styles.legalRow} onPress={() => setAcceptedLicenses(v => !v)}>
            <View style={[styles.checkbox, acceptedLicenses && styles.checkboxChecked]}>
              {acceptedLicenses && <Check size={16} color="#fff" />}
            </View>
            <Text style={styles.legalText}>Declaro que dispongo de las licencias necesarias</Text>
          </TouchableOpacity>
          {submitAttempted && fieldErrors.acceptedLicenses ? <Text style={styles.errorText}>{fieldErrors.acceptedLicenses}</Text> : null}
        </>
      ) : (
        <>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Fecha de Nacimiento</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => {
                openDatePicker('attendee');
              }}
            >
                <Calendar size={20} color={Colors.dark.textSecondary} />
                <Text style={[styles.dateText, !birthDate && { color: '#666' }]}>{birthDate ? birthDate.toLocaleDateString() : 'Seleccionar fecha'}</Text>
            </TouchableOpacity>
            {(submitAttempted || touched['birthDate']) && fieldErrors.birthDate ? (
              <Text style={styles.errorText}>{fieldErrors.birthDate}</Text>
            ) : null}
            {showDatePicker && activeDateField === 'attendee' && Platform.OS !== 'ios' && (
              <DateTimePicker
                value={birthDate || new Date(2000, 0, 1)}
                mode="date"
                display="spinner"
                positiveButton={{ label: "Aceptar" }}
                negativeButton={{ label: "Cancelar" }}
                onChange={onDateChange}
                maximumDate={new Date()}
              />
            )}
          </View>
        </>
      )}
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Cuenta y Seguridad</Text>
      
      <ThemedInput
        placeholder="Correo electrónico"
        value={formData.email}
        onChangeText={(t) => setField('email', t)}
        onBlur={() => touch('email')}
        error={showFieldError('email')}
        success={showFieldSuccess('email')}
        keyboardType="email-address"
        autoCapitalize="none"
        icon={Mail}
      />
      <ThemedInput placeholder="Contraseña" value={formData.password} onChangeText={(t) => { touch('password'); updateForm('password', t); }} onBlur={() => touch('password')} error={showFieldError('password')} secureTextEntry={!showPassword} icon={Lock} rightIcon={
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          {showPassword ? <EyeOff size={20} color="#ccc" /> : <Eye size={20} color="#ccc" />}
        </TouchableOpacity>
      } />
      <View style={styles.passwordReqCard}>
        <Text style={styles.passwordReqTitle}>Requisitos de seguridad</Text>
        <View style={styles.passwordReqRow}>
          {passwordRequirements.minLength ? <Check size={16} color={Colors.dark.success} /> : <Text style={styles.passwordReqBullet}>•</Text>}
          <Text style={[styles.passwordReqText, passwordRequirements.minLength && styles.passwordReqTextOk]}>Mínimo 6 caracteres</Text>
        </View>
        <View style={styles.passwordReqRow}>
          {passwordRequirements.hasUpper ? <Check size={16} color={Colors.dark.success} /> : <Text style={styles.passwordReqBullet}>•</Text>}
          <Text style={[styles.passwordReqText, passwordRequirements.hasUpper && styles.passwordReqTextOk]}>Al menos una mayúscula</Text>
        </View>
        <View style={styles.passwordReqRow}>
          {passwordRequirements.hasLower ? <Check size={16} color={Colors.dark.success} /> : <Text style={styles.passwordReqBullet}>•</Text>}
          <Text style={[styles.passwordReqText, passwordRequirements.hasLower && styles.passwordReqTextOk]}>Al menos una minúscula</Text>
        </View>
        <View style={styles.passwordReqRow}>
          {passwordRequirements.hasNumber ? <Check size={16} color={Colors.dark.success} /> : <Text style={styles.passwordReqBullet}>•</Text>}
          <Text style={[styles.passwordReqText, passwordRequirements.hasNumber && styles.passwordReqTextOk]}>Al menos un número</Text>
        </View>
        <View style={styles.passwordReqRow}>
          {passwordRequirements.hasSpecial ? <Check size={16} color={Colors.dark.success} /> : <Text style={styles.passwordReqBullet}>•</Text>}
          <Text style={[styles.passwordReqText, passwordRequirements.hasSpecial && styles.passwordReqTextOk]}>
            Al menos un carácter especial ({passwordAllowedSpecials})
          </Text>
        </View>
        {passwordHasInvalidChars ? (
          <Text style={styles.passwordReqWarn}>
            No se permiten emojis ni símbolos fuera de la lista.
          </Text>
        ) : null}
      </View>
      <ThemedInput placeholder="Confirmar contraseña" value={formData.confirmPassword} onChangeText={(t) => { touch('confirmPassword'); updateForm('confirmPassword', t); }} onBlur={() => touch('confirmPassword')} error={showFieldError('confirmPassword')} secureTextEntry={!showPassword} icon={Lock} rightIcon={
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          {showPassword ? <EyeOff size={20} color="#ccc" /> : <Eye size={20} color="#ccc" />}
        </TouchableOpacity>
      } />

      <View style={styles.legalBox}>
        <TouchableOpacity activeOpacity={0.8} style={styles.legalRow} onPress={() => setAcceptedTerms(v => !v)}>
          <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
            {acceptedTerms && <Check size={16} color="#fff" />}
          </View>
          <Text style={styles.legalText}>
            Acepto los{' '}
            <Text style={styles.legalLink} onPress={() => router.push('/legal/terminos')}>Términos y Condiciones</Text>
          </Text>
        </TouchableOpacity>
        {submitAttempted && fieldErrors.acceptedTerms ? <Text style={styles.errorText}>{fieldErrors.acceptedTerms}</Text> : null}
        <TouchableOpacity activeOpacity={0.8} style={styles.legalRow} onPress={() => setAcceptedPrivacy(v => !v)}>
          <View style={[styles.checkbox, acceptedPrivacy && styles.checkboxChecked]}>
            {acceptedPrivacy && <Check size={16} color="#fff" />}
          </View>
          <Text style={styles.legalText}>
            Acepto la{' '}
            <Text style={styles.legalLink} onPress={() => router.push('/legal/privacidad')}>Política de Privacidad</Text>
          </Text>
        </TouchableOpacity>
        {submitAttempted && fieldErrors.acceptedPrivacy ? <Text style={styles.errorText}>{fieldErrors.acceptedPrivacy}</Text> : null}
      </View>
    </View>
  );

  const handleEmailConfirmed = async () => {
    if (emailConfirmedLoading) return;
    setEmailConfirmedLoading(true);

    let signInOk = false;
    let finalRole: string | null = formData.role === 'organizer' ? 'organizer' : 'attendee';

    try {
      const { error: signInError, data: signInData } = await supabase.auth.signInWithPassword({
        email: formData.email.trim(),
        password: formData.password,
      });

      if (signInError) {
        const msg = String(signInError?.message || '');
        const lower = msg.toLowerCase();
        if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed') || lower.includes('confirm your email')) {
          showDialog({
            title: 'Aún no verificado',
            message: 'Parece que tu email aún no está confirmado. Abre tu correo y pulsa en el enlace de verificación que te enviamos. Si no lo encuentras, revisa la carpeta de Spam o pide reenviarlo desde la pantalla de login.',
          });
          return;
        }
        if (lower.includes('invalid login credentials')) {
          showDialog({
            title: 'Datos incorrectos',
            message: 'No se pudo comprobar la cuenta. Revisa la contraseña o regístrate de nuevo si la cuenta no existe.',
          });
          return;
        }
        throw signInError;
      }

      signInOk = true;

      const uid = signInData?.user?.id;
      if (uid) {
        try {
          const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
          if (profile?.role) finalRole = profile.role as string;
        } catch {}
      }

      try {
        await invokeEdgeFunction('record-legal-acceptance', {});
      } catch (e) {
        console.warn('[register-step5] record-legal-acceptance failed (non-blocking):', e);
      }

      if (finalRole === 'admin') {
        router.replace('/(creator)');
      } else if (finalRole === 'organizer') {
        router.replace('/(creator)/verification');
      } else {
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      if (!signInOk) {
        const msg = String(e?.message || e || 'Ocurrió un error.');
        showDialog({
          title: 'Error al comprobar la cuenta',
          message: msg,
        });
        return;
      }
      console.warn('[register-step5] login OK but post-step failed (non-blocking):', e);
      if (finalRole === 'admin') {
        router.replace('/(creator)');
      } else if (finalRole === 'organizer') {
        router.replace('/(creator)/verification');
      } else {
        router.replace('/(tabs)');
      }
    } finally {
      setEmailConfirmedLoading(false);
    }
  };

  const renderStep5 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Verifica tu email</Text>
      <Text style={styles.roleDesc}>
        Te enviamos un enlace de confirmación. Abre tu correo y confirma tu cuenta para poder continuar.{'\n\n'}
        • Haz clic en el enlace del email: la app se abrirá sola y te llevará directamente a tu panel.{'\n'}
        • O bien, confirma el email y luego pulsa el botón de abajo.
      </Text>
      <ThemedButton
        title={emailConfirmedLoading ? 'Comprobando…' : 'Ya confirmé mi email'}
        onPress={handleEmailConfirmed}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={Colors.dark.backgroundGradient} style={StyleSheet.absoluteFill} />

      {showDatePicker && Platform.OS === 'ios' ? (
        <Modal transparent visible animationType="fade" onRequestClose={confirmIOSDate}>
          <View style={styles.iosDateBackdrop}>
            <View style={styles.iosDateCard}>
              <View style={styles.iosDateHeader}>
                <Text style={styles.iosDateTitle}>
                  {activeDateField === 'attendee' ? 'Fecha de nacimiento' : 'Nacimiento del responsable'}
                </Text>
                <TouchableOpacity onPress={confirmIOSDate} activeOpacity={0.85}>
                  <Text style={styles.iosDateDone}>Hecho</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={datePickerDraft}
                mode="date"
                display="spinner"
                onChange={onDateChange}
                maximumDate={new Date()}
                themeVariant="dark"
                textColor={Colors.dark.text as any}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Registro</Text>
            <View style={styles.progressContainer}>
                {[1, 2, 3, 4, 5].map(i => (
                    <View key={i} style={[styles.progressDot, i <= step ? styles.activeDot : styles.inactiveDot]} />
                ))}
            </View>
            <Text style={styles.subtitle}>Paso {step} de 5</Text>
          </View>

          <GlassView style={styles.formCard}>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
            {step === 5 && renderStep5()}

            <View style={styles.buttonsContainer}>
              {step > 1 && step < 5 && <ThemedButton title="Atrás" onPress={() => setStep(step - 1)} variant="outline" style={{ flex: 1, marginRight: 10 }} />}
              {step < 5 && (
                <ThemedButton
                  title={loading ? 'Procesando...' : (step === 4 ? 'Crear Cuenta' : 'Siguiente')}
                  onPress={handleNextStep}
                  disabled={loading || (step >= 2 && step <= 4 && Object.keys(fieldErrors).length > 0)}
                  icon={!loading && step < 4 ? <ArrowRight size={20} color="white" /> : undefined}
                  iconPosition="right"
                  style={{ flex: 1 }}
                />
              )}
            </View>

            <View style={styles.loginLink}>
              <Text style={styles.loginText}>¿Ya tienes cuenta? </Text>
              <TouchableOpacity onPress={() => { clearSensitiveFields(); router.push('/(auth)/login'); }}><Text style={styles.loginLinkText}>Inicia Sesión</Text></TouchableOpacity>
            </View>
          </GlassView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 20, paddingBottom: 40 },
  header: { marginBottom: 20, alignItems: 'center' },
  title: { fontSize: 32, fontWeight: 'bold', color: Colors.dark.text, marginBottom: 10 },
  progressContainer: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  activeDot: { backgroundColor: Colors.dark.primary, width: 16 },
  inactiveDot: { backgroundColor: 'rgba(255,255,255,0.2)' },
  subtitle: { fontSize: 14, color: Colors.dark.textSecondary },
  formCard: { padding: 24, borderRadius: 24, width: '100%', maxWidth: 500, alignSelf: 'center' },
  stepContainer: { gap: 16, marginBottom: 20 },
  stepTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', textAlign: 'center' },
  roleCard: { backgroundColor: Colors.dark.surfaceSubtle, padding: 20, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: Colors.dark.border },
  activeRoleCard: { backgroundColor: Colors.dark.primarySoft, borderColor: Colors.dark.primary },
  roleTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.dark.text, marginTop: 10 },
  activeRoleText: { color: Colors.dark.primary },
  roleDesc: { fontSize: 14, color: '#ccc', textAlign: 'center', marginTop: 5 },
  buttonsContainer: { flexDirection: 'row', marginTop: 10 },
  loginLink: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  loginText: { color: Colors.dark.textSecondary },
  loginLinkText: { color: Colors.dark.primary, fontWeight: 'bold' },
  inputContainer: { marginBottom: 10 },
  label: { color: Colors.dark.textSecondary, marginBottom: 8, fontSize: 14, marginLeft: 4 },
  errorText: { color: Colors.dark.error, fontSize: 12, marginTop: 6, marginLeft: 4 },
  dateButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  dateText: { color: 'white', marginLeft: 10, fontSize: 16 },
  locationCard: { padding: 16, borderRadius: 12, backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locationText: { color: 'white', flex: 1, marginLeft: 10, fontWeight: '500' },
  manualLocationContainer: { gap: 10 },
  retryLocation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  retryText: { color: Colors.dark.primary, marginLeft: 5, fontWeight: '600' },
  passwordReqCard: {
    marginTop: -6,
    marginBottom: 6,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  passwordReqTitle: {
    color: 'rgba(255,255,255,0.90)',
    fontWeight: '800',
    fontSize: 13,
    marginBottom: 10,
  },
  passwordReqRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  passwordReqBullet: { color: 'rgba(255,255,255,0.35)', fontSize: 16, width: 16, textAlign: 'center' },
  passwordReqText: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', fontSize: 12, flex: 1 },
  passwordReqTextOk: { color: 'rgba(255,255,255,0.95)' },
  passwordReqWarn: { color: Colors.dark.error, fontSize: 12, marginTop: 2, fontWeight: '700' },
  genresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  genreChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  activeGenreChip: { backgroundColor: Colors.dark.primary, borderColor: Colors.dark.primary },
  genreText: { color: Colors.dark.textSecondary, marginLeft: 6, fontSize: 13 },
  activeGenreText: { color: 'white', fontWeight: 'bold' },
  typeSelector: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  activeTypeSelector: { borderColor: Colors.dark.primary, backgroundColor: 'rgba(124, 58, 237, 0.15)' },
  typeSelectorText: { color: Colors.dark.textSecondary, fontWeight: '600' },
  activeTypeSelectorText: { color: Colors.dark.primary },
  legalBox: {
    marginTop: 8,
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 14,
  },
  legalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: Colors.dark.primary, borderColor: Colors.dark.primary },
  legalText: { flex: 1, color: 'rgba(255,255,255,0.86)', fontSize: 13, lineHeight: 18 },
  legalLink: { color: Colors.dark.primary, fontWeight: '700' },
  iosDateBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 18 },
  iosDateCard: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#0B0B0F', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  iosDateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)' },
  iosDateTitle: { color: 'rgba(255,255,255,0.9)', fontWeight: '800' },
  iosDateDone: { color: Colors.dark.primary, fontWeight: '900' },
});
