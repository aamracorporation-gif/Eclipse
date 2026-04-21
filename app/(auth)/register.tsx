import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User, MapPin, Phone, Calendar, Building2, PartyPopper, Edit2, RefreshCw, Check, Building, CreditCard } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '@/constants/Colors';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { calculateAgeFromDate, isValidIbanES, isValidSpanishTaxId, normalizePhoneEsE164 } from '@/lib/validators';

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  
  // Steps:
  // 1. Role Selection
  // 2. Personal/Club Info (Name, Location)
  // 3. Specific Info (Attendee: DOB/Music, Organizer: Legal/Tax/Phone)
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
    phone: '',
    city: '',
    country: '',
    // Stripe Connect / Business
    legalName: '',
    taxIdNumber: '',
    businessType: 'individual' as 'individual' | 'company',
  });

  const updateForm = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
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
      if (activeDateField === 'attendee') setBirthDate(selectedDate);
      else setResponsibleBirthDate(selectedDate);
    }
  };

  const validateStep = async () => {
    if (step === 1) return true;

    // Step 2: Basic Info (Name/Club + Location)
    if (step === 2) {
      if (formData.role === 'attendee') {
        if (!formData.firstName.trim() || !formData.lastName.trim()) {
          Alert.alert('Faltan datos', 'Por favor ingresa tu nombre y apellidos.');
          return false;
        }
      } else {
        if (!formData.clubName.trim()) {
          Alert.alert('Faltan datos', 'Ingresa el nombre de tu local u organización.');
          return false;
        }
        if (!formData.venueAddress.trim()) {
          Alert.alert('Faltan datos', 'Ingresa la dirección del local.');
          return false;
        }
        if (!formData.city.trim()) {
          Alert.alert('Faltan datos', 'Ingresa la ciudad.');
          return false;
        }
        if (!formData.postalCode.trim()) {
          Alert.alert('Faltan datos', 'Ingresa el código postal.');
          return false;
        }
        
        setLoading(true);
        try {
          const { data } = await supabase
            .from('profiles')
            .select('id')
            .ilike('club_name', formData.clubName.trim())
            .maybeSingle();

          if (data) {
            Alert.alert('Nombre no disponible', 'Ya existe un local con este nombre.');
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
      if (!formData.phone.trim()) {
        Alert.alert('Faltan datos', 'Por favor ingresa un número de teléfono móvil.');
        return false;
      }

      if (formData.role === 'attendee') {
        if (!birthDate) {
          Alert.alert('Faltan datos', 'Por favor selecciona tu fecha de nacimiento.');
          return false;
        }
        const age = calculateAgeFromDate(birthDate);
        if (age < 18) {
          Alert.alert('Edad inválida', 'Debes ser mayor de 18 años para registrarte en la Plataforma conforme a nuestros Términos y Condiciones.');
          return false;
        }
      } else {
        if (!formData.legalName.trim()) {
          Alert.alert('Faltan datos', 'Ingresa el Nombre Legal o Razón Social.');
          return false;
        }
        if (!formData.taxIdNumber.trim()) {
          Alert.alert('Faltan datos', 'Ingresa el CIF/NIF para configurar los pagos.');
          return false;
        }
        if (!isValidSpanishTaxId(formData.taxIdNumber)) {
          Alert.alert('CIF/NIF inválido', 'Ingresa un CIF/NIF/NIE válido de España.');
          return false;
        }
        if (!formData.responsibleName.trim()) {
          Alert.alert('Faltan datos', 'Ingresa el nombre del responsable.');
          return false;
        }
        if (!responsibleBirthDate) {
          Alert.alert('Faltan datos', 'Selecciona la fecha de nacimiento del responsable.');
          return false;
        }
        if (calculateAgeFromDate(responsibleBirthDate) < 18) {
          Alert.alert('Edad inválida', 'Debes ser mayor de 18 años para registrarte en la Plataforma conforme a nuestros Términos y Condiciones.');
          return false;
        }
        if (!formData.fiscalAddress.trim()) {
          Alert.alert('Faltan datos', 'Ingresa la dirección fiscal.');
          return false;
        }
        if (!formData.iban.trim()) {
          Alert.alert('Faltan datos', 'Ingresa el IBAN.');
          return false;
        }
        if (!isValidIbanES(formData.iban)) {
          Alert.alert('IBAN inválido', 'Ingresa un IBAN válido de España.');
          return false;
        }
        if (!acceptedLicenses) {
          Alert.alert('Requisito', 'Debes declarar que dispones de las licencias necesarias.');
          return false;
        }
      }
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
      const phoneE164 = normalizePhoneEsE164(formData.phone);
      
      const metadata = {
        role: safeRole,
        full_name: safeRole === 'organizer' ? formData.clubName : `${formData.firstName} ${formData.lastName}`,
        email: email,
        club_name: formData.clubName,
        address: formData.venueAddress,
        phone: phoneE164,
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
          const phoneE164 = normalizePhoneEsE164(formData.phone);
          const metadata = {
            role: safeRole,
            full_name: safeRole === 'organizer' ? formData.clubName : `${formData.firstName} ${formData.lastName}`,
            email: formData.email.trim(),
            club_name: formData.clubName,
            address: formData.venueAddress,
            phone: phoneE164,
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
            onChangeText={(t) => updateForm('clubName', t)}
            icon={Building2}
          />
          <ThemedInput
            placeholder="Dirección física del local"
            value={formData.venueAddress}
            onChangeText={(t) => updateForm('venueAddress', t)}
            icon={MapPin}
          />
          <ThemedInput placeholder="Ciudad" value={formData.city} onChangeText={(t) => updateForm('city', t)} icon={MapPin} />
          <ThemedInput placeholder="Código postal" value={formData.postalCode} onChangeText={(t) => updateForm('postalCode', t)} icon={MapPin} keyboardType="number-pad" />
        </>
      ) : (
        <>
          <ThemedInput
            placeholder="Nombre"
            value={formData.firstName}
            onChangeText={(t) => updateForm('firstName', t)}
            icon={User}
          />
          <ThemedInput
            placeholder="Apellidos"
            value={formData.lastName}
            onChangeText={(t) => updateForm('lastName', t)}
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
                <ThemedInput placeholder="Ciudad" value={formData.city} onChangeText={(t) => updateForm('city', t)} icon={MapPin} />
                <ThemedInput placeholder="País" value={formData.country} onChangeText={(t) => updateForm('country', t)} icon={Building} />
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
          <ThemedInput placeholder="Razón social o nombre legal" value={formData.legalName} onChangeText={(t) => updateForm('legalName', t)} icon={Building2} />
          <ThemedInput placeholder="CIF/NIF (España)" value={formData.taxIdNumber} onChangeText={(t) => updateForm('taxIdNumber', t)} autoCapitalize="characters" icon={Check} />
          <ThemedInput placeholder="Nombre del responsable" value={formData.responsibleName} onChangeText={(t) => updateForm('responsibleName', t)} icon={User} />

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Fecha de nacimiento del responsable</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => {
                setActiveDateField('responsible');
                setShowDatePicker(true);
              }}
            >
                <Calendar size={20} color={Colors.dark.textSecondary} />
                <Text style={[styles.dateText, !responsibleBirthDate && { color: '#666' }]}>
                  {responsibleBirthDate ? responsibleBirthDate.toLocaleDateString() : 'Seleccionar fecha'}
                </Text>
            </TouchableOpacity>
            {showDatePicker && activeDateField === 'responsible' && (
                <DateTimePicker value={responsibleBirthDate || new Date(1990, 0, 1)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onDateChange} maximumDate={new Date()} />
            )}
          </View>

          <ThemedInput placeholder="Dirección fiscal" value={formData.fiscalAddress} onChangeText={(t) => updateForm('fiscalAddress', t)} icon={MapPin} />
          <ThemedInput placeholder="IBAN" value={formData.iban} onChangeText={(t) => updateForm('iban', t)} autoCapitalize="characters" icon={CreditCard} />
          <ThemedInput placeholder="Teléfono móvil" value={formData.phone} onChangeText={(t) => updateForm('phone', t)} icon={Phone} keyboardType="phone-pad" />

          <TouchableOpacity activeOpacity={0.8} style={styles.legalRow} onPress={() => setAcceptedLicenses(v => !v)}>
            <View style={[styles.checkbox, acceptedLicenses && styles.checkboxChecked]}>
              {acceptedLicenses && <Check size={16} color="#fff" />}
            </View>
            <Text style={styles.legalText}>Declaro que dispongo de las licencias necesarias</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Fecha de Nacimiento</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => {
                setActiveDateField('attendee');
                setShowDatePicker(true);
              }}
            >
                <Calendar size={20} color={Colors.dark.textSecondary} />
                <Text style={[styles.dateText, !birthDate && { color: '#666' }]}>{birthDate ? birthDate.toLocaleDateString() : 'Seleccionar fecha'}</Text>
            </TouchableOpacity>
            {showDatePicker && activeDateField === 'attendee' && (
                <DateTimePicker value={birthDate || new Date(2000, 0, 1)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onDateChange} maximumDate={new Date()} />
            )}
          </View>
          <ThemedInput placeholder="Teléfono móvil" value={formData.phone} onChangeText={(t) => updateForm('phone', t)} icon={Phone} keyboardType="phone-pad" />
        </>
      )}
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Cuenta y Seguridad</Text>
      
      <ThemedInput placeholder="Correo electrónico" value={formData.email} onChangeText={(t) => updateForm('email', t)} keyboardType="email-address" autoCapitalize="none" icon={Mail} />
      <ThemedInput placeholder="Contraseña" value={formData.password} onChangeText={(t) => updateForm('password', t)} secureTextEntry={!showPassword} icon={Lock} rightIcon={
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          {showPassword ? <EyeOff size={20} color="#ccc" /> : <Eye size={20} color="#ccc" />}
        </TouchableOpacity>
      } />
      <ThemedInput placeholder="Confirmar contraseña" value={formData.confirmPassword} onChangeText={(t) => updateForm('confirmPassword', t)} secureTextEntry={!showConfirmPassword} icon={Lock} />

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
        <TouchableOpacity activeOpacity={0.8} style={styles.legalRow} onPress={() => setAcceptedPrivacy(v => !v)}>
          <View style={[styles.checkbox, acceptedPrivacy && styles.checkboxChecked]}>
            {acceptedPrivacy && <Check size={16} color="#fff" />}
          </View>
          <Text style={styles.legalText}>
            Acepto la{' '}
            <Text style={styles.legalLink} onPress={() => router.push('/legal/privacidad')}>Política de Privacidad</Text>
          </Text>
        </TouchableOpacity>
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
                  disabled={loading}
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
