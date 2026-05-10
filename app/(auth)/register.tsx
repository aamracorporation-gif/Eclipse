import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useMemo, useState, useEffect } from 'react';
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
import { calculateAgeFromDate, isSafeAddressText, isSafeOrgText, isValidIbanES, isValidPersonName, isValidSpanishTaxId, normalizeWhitespace } from '@/lib/validators';

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  
  // Steps:
  // 1. Role Selection
  // 2. Personal/Club Info (Name, Location)
  // 3. Specific Info (Attendee: DOB, Organizer: Legal/Tax)
  // 4. Account (Email, Password)
  // 5. Email verification
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Date Picker State
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [responsibleBirthDate, setResponsibleBirthDate] = useState<Date | null>(null);
  const [activeDateField, setActiveDateField] = useState<'attendee' | 'responsible'>('attendee');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Location State
  const [locationStatus, setLocationStatus] = useState<'idle' | 'detecting' | 'success' | 'error'>('idle');
  const [manualLocation, setManualLocation] = useState(false);
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
      updateForm(key, normalizeWhitespace(sanitizeNameText(value)));
      return;
    }
    if (key === 'city' || key === 'country') {
      updateForm(key, normalizeWhitespace(sanitizeCityCountryText(value)));
      return;
    }
    if (key === 'clubName' || key === 'legalName') {
      setClubNameUnavailable(null);
      updateForm(key, normalizeWhitespace(sanitizeOrgText(value)));
      return;
    }
    if (key === 'venueAddress' || key === 'fiscalAddress') {
      updateForm(key, normalizeWhitespace(sanitizeAddressText(value)));
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

  // Auto-detect location when entering Step 2
  useEffect(() => {
    if (step === 2 && locationStatus === 'idle') {
      detectLocation();
    }
  }, [step]);

  const detectLocation = async () => {
    setLocationStatus('detecting');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('error');
        setManualLocation(true);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const geocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });

      if (geocode && geocode.length > 0) {
        const address = geocode[0];
        setFormData(prev => ({
          ...prev,
          city: address.city || address.subregion || '',
          country: address.country || ''
        }));
        setLocationStatus('success');
      } else {
        setLocationStatus('error');
        setManualLocation(true);
      }
    } catch (error) {
      console.log('Location error:', error);
      setLocationStatus('error');
      setManualLocation(true);
    }
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      if (activeDateField === 'attendee') {
        touch('birthDate');
        setBirthDate(selectedDate);
      } else {
        touch('responsibleBirthDate');
        setResponsibleBirthDate(selectedDate);
      }
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
      if (formData.password && formData.password.length < 6) errors.password = 'Mínimo 6 caracteres.';

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
          const { data } = await supabase
            .from('profiles')
            .select('id')
            .ilike('club_name', formData.clubName.trim())
            .maybeSingle();

          if (data) {
            setClubNameUnavailable('Ya existe un local con este nombre.');
            setLoading(false);
            return false;
          }
        } catch (e) { /* ignore */ }
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
        Alert.alert('Faltan datos', 'Ingresa tu correo electrónico.');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        Alert.alert('Email inválido', 'Por favor ingresa un correo válido.');
        return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Las contraseñas no coinciden.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (!acceptedTerms || !acceptedPrivacy) {
      Alert.alert('Requisitos legales', 'Debes aceptar los Términos y Condiciones y la Política de Privacidad para registrarte.');
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

      const { data, error } = await signUp(email, password, metadata);
      console.log('Register result:', { data, error });

      if (error) throw error;

      Alert.alert(
        'Confirma tu email',
        'Te enviamos un enlace de confirmación. Revisa tu correo electrónico y confirma tu cuenta para continuar.',
        [{ text: 'Continuar', onPress: () => setStep(5) }]
      );

    } catch (error: any) {
      console.log('Register error raw:', error);
      const msg = error?.message ? String(error.message) : 'Ocurrió un error.';
      const lower = msg.toLowerCase();
      const isEmailRateLimit = lower.includes('email rate limit') || lower.includes('rate limit exceeded');
      if (isEmailRateLimit) {
        const allowDevBypass = __DEV__ && String(process.env.EXPO_PUBLIC_DEV_BYPASS_EMAIL_RATE_LIMIT || '') === '1';
        if (!allowDevBypass) {
          Alert.alert(
            'Límite de emails alcanzado',
            'Supabase ha bloqueado temporalmente el envío de emails de confirmación (rate limit). Para poder registrar más cuentas debes:\n\n- Esperar y reintentar más tarde, o\n- Configurar un proveedor SMTP propio en Supabase (Auth → Email) para aumentar límites.\n\nEn desarrollo puedes activar un bypass con EXPO_PUBLIC_DEV_BYPASS_EMAIL_RATE_LIMIT=1.'
          );
          return;
        }

        try {
          const age = birthDate ? calculateAgeFromDate(birthDate) : 0;
          const acceptedAt = new Date().toISOString();
          const metadata = {
            role: safeRole,
            full_name: safeRole === 'organizer' ? formData.clubName : `${formData.firstName} ${formData.lastName}`,
            email: formData.email.trim(),
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
            accepted_privacy_at: acceptedAt,
          };

          const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
          const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
          if (!supabaseUrl || !anonKey) throw new Error('Falta configuración de Supabase (URL/ANON KEY).');

          const endpoint = `${supabaseUrl}/functions/v1/register-user-fallback`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: anonKey,
            },
            body: JSON.stringify({ email: formData.email, password: formData.password, metadata }),
          });

          const text = await res.text().catch(() => '');
          let json: any = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }

          if (!res.ok || json?.ok === false) {
            throw new Error(String(json?.error || json?.message || text || 'No se pudo crear la cuenta.'));
          }

          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: formData.email.trim(),
            password: formData.password,
          });
          if (signInError) throw signInError;

          await invokeEdgeFunction('record-legal-acceptance', {});

          Alert.alert(
            'Cuenta creada (DEV)',
            'Por límite de emails, en desarrollo se creó la cuenta sin enviar el email de confirmación. En producción el email será obligatorio.'
          );
          router.replace(formData.role === 'organizer' ? '/(creator)/verification' : '/(tabs)');
          return;
        } catch (e: any) {
          Alert.alert('Error de Registro', String(e?.message || 'No se pudo registrar por bypass DEV.'));
          return;
        }
      }
      const hint = msg.includes('Database error saving new user')
        ? '\n\nSuele indicar que falló un trigger/migración en Supabase (creación de profile/wallet). Aplica las migraciones y refresca el schema cache.'
        : '';
      Alert.alert('Error de Registro', `${msg}${hint}`);
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>¿Cómo quieres usar la app?</Text>
      
      <TouchableOpacity 
        style={[styles.roleCard, formData.role === 'attendee' && styles.activeRoleCard]}
        onPress={() => updateForm('role', 'attendee')}
      >
        <PartyPopper size={40} color={formData.role === 'attendee' ? Colors.dark.primary : '#ccc'} />
        <Text style={[styles.roleTitle, formData.role === 'attendee' && styles.activeRoleText]}>Soy Fiestero</Text>
        <Text style={styles.roleDesc}>Quiero descubrir eventos y comprar entradas</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.roleCard, formData.role === 'organizer' && styles.activeRoleCard]}
        onPress={() => updateForm('role', 'organizer')}
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
        {!manualLocation && locationStatus !== 'idle' ? (
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
                        <TouchableOpacity onPress={() => setManualLocation(true)}>
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
                <TouchableOpacity style={styles.retryLocation} onPress={() => { setManualLocation(false); detectLocation(); }}>
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
                setActiveDateField('responsible');
                touch('responsibleBirthDate');
                setShowDatePicker(true);
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
            {showDatePicker && activeDateField === 'responsible' && (
                <DateTimePicker value={responsibleBirthDate || new Date(1990, 0, 1)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onDateChange} maximumDate={new Date()} />
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
                setActiveDateField('attendee');
                touch('birthDate');
                setShowDatePicker(true);
              }}
            >
                <Calendar size={20} color={Colors.dark.textSecondary} />
                <Text style={[styles.dateText, !birthDate && { color: '#666' }]}>{birthDate ? birthDate.toLocaleDateString() : 'Seleccionar fecha'}</Text>
            </TouchableOpacity>
            {(submitAttempted || touched['birthDate']) && fieldErrors.birthDate ? (
              <Text style={styles.errorText}>{fieldErrors.birthDate}</Text>
            ) : null}
            {showDatePicker && activeDateField === 'attendee' && (
                <DateTimePicker value={birthDate || new Date(2000, 0, 1)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onDateChange} maximumDate={new Date()} />
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
      <ThemedInput placeholder="Confirmar contraseña" value={formData.confirmPassword} onChangeText={(t) => { touch('confirmPassword'); updateForm('confirmPassword', t); }} onBlur={() => touch('confirmPassword')} error={showFieldError('confirmPassword')} secureTextEntry={!showConfirmPassword} icon={Lock} />

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

  const renderStep5 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Verifica tu email</Text>
      <Text style={styles.roleDesc}>
        Te enviamos un enlace de confirmación. Abre tu correo y confirma tu cuenta para poder continuar.
      </Text>
      <ThemedButton
        title={emailConfirmedLoading ? 'Comprobando…' : 'Ya confirmé mi email'}
        onPress={async () => {
          if (emailConfirmedLoading) return;
          setEmailConfirmedLoading(true);
          try {
            const { error: signInError } = await supabase.auth.signInWithPassword({
              email: formData.email.trim(),
              password: formData.password,
            });
            if (signInError) throw signInError;
            await invokeEdgeFunction('record-legal-acceptance', {});
            router.replace(formData.role === 'organizer' ? '/(creator)/verification' : '/(tabs)');
          } catch (e: any) {
            Alert.alert('Aún no verificado', 'Confirma el email y vuelve a intentarlo.');
          } finally {
            setEmailConfirmedLoading(false);
          }
        }}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1a1a2e']} style={StyleSheet.absoluteFill} />
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
              <TouchableOpacity onPress={() => router.push('/(auth)/login')}><Text style={styles.loginLinkText}>Inicia Sesión</Text></TouchableOpacity>
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
  title: { fontSize: 32, fontWeight: 'bold', color: 'white', marginBottom: 10 },
  progressContainer: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  activeDot: { backgroundColor: Colors.dark.primary, width: 16 },
  inactiveDot: { backgroundColor: 'rgba(255,255,255,0.2)' },
  subtitle: { fontSize: 14, color: Colors.dark.textSecondary },
  formCard: { padding: 24, borderRadius: 24, width: '100%', maxWidth: 500, alignSelf: 'center' },
  stepContainer: { gap: 16, marginBottom: 20 },
  stepTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', textAlign: 'center' },
  roleCard: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 20, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  activeRoleCard: { backgroundColor: 'rgba(124, 58, 237, 0.15)', borderColor: Colors.dark.primary },
  roleTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', marginTop: 10 },
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
  legalLink: { color: Colors.dark.primary, fontWeight: '700' }
});
