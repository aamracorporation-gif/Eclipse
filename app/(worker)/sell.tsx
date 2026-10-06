import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { ChevronLeft, DollarSign, Plus, Minus, Share, User, Mail, Calendar, Tag } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as MailComposer from 'expo-mail-composer';
import QRCodeSVG from 'qrcode-svg';
import * as Sharing from 'expo-sharing';
import { useBoxOfficeAccess } from '@/hooks/useBoxOfficeAccess';
// import * as MailComposer from 'expo-mail-composer';

export default function WorkerSell() {
  const { workerProfile } = useAuth();
  const boxOffice = useBoxOfficeAccess(workerProfile?.organizer_id);
  const router = useRouter();
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [ticketTypes, setTicketTypes] = useState<any[]>([]);
  const [quantities, setQuantities] = useState<{[key: string]: number}>({});
  const [vipReservados, setVipReservados] = useState<any[]>([]);
  const [vipQty, setVipQty] = useState(0);
  const [selectedVipId, setSelectedVipId] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const [processing, setProcessing] = useState(false);
  const [lastSaleTickets, setLastSaleTickets] = useState<any[] | null>(null);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(worker)');
  };

  // Buyer Details
  const [buyerDetails, setBuyerDetails] = useState({
    name: '',
    email: '',
    age: ''
  });

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));

  const buyerErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const name = String(buyerDetails.name || '').trim();
    const email = String(buyerDetails.email || '').trim();
    const ageRaw = String(buyerDetails.age || '').trim();
    const ageRestriction = Number((selectedEvent as any)?.age_restriction || 0);

    const isAllowed = (s: string) => /^[\p{L}\p{N}\s.,'’"-]*$/u.test(s) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);

    if (!name) errors.name = 'Obligatorio.';
    else if (name.length < 2 || name.length > 80) errors.name = 'Entre 2 y 80 caracteres.';
    else if (!isAllowed(name)) errors.name = 'Caracteres no permitidos.';

    if (!email) errors.email = 'Obligatorio.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Formato de email inválido.';

    if (!ageRaw) errors.age = 'Obligatorio.';
    else if (!/^\d+$/.test(ageRaw)) errors.age = 'Introduce un número entero válido.';
    else {
      const age = Number(ageRaw);
      if (!Number.isFinite(age) || age < 1) errors.age = 'Debe ser un entero positivo.';
      else if (Number.isFinite(ageRestriction) && ageRestriction > 0 && age < ageRestriction) {
        errors.age = `Edad mínima: ${ageRestriction}.`;
      }
    }

    return errors;
  }, [buyerDetails, selectedEvent]);

  const selectEvent = useCallback(async (event: any) => {
    setSelectedEvent(event);
    setTicketTypes([]);
    setQuantities({});
    setVipReservados([]);
    setVipQty(0);
    setSelectedVipId(null);
    setBuyerDetails({ name: '', email: '', age: '' });
    setSubmitAttempted(false);
    setTouched({});

    try {
      const { data, error } = await supabase
        .from('event_ticket_types')
        .select('*')
        .eq('event_id', event.id);

      if (error) throw error;

      if (data && data.length > 0) {
        const activeTypes = (data as any[]).filter((t) => !t?.deleted_at && (t?.is_active ?? true));
        // Inventory counts sale units. A four-person pack is still one sold unit.
        setTicketTypes(activeTypes);
        const initialQty: any = {};
        data.forEach((t: any) => (initialQty[t.id] = 0));
        setQuantities(initialQty);
      } else {
        Alert.alert("Aviso", "Este evento no tiene tipos de entrada definidos.");
        setTicketTypes([]);
      }

      const fetchVip = async (withSoftDeleteCols: boolean) => {
        const q = supabase
          .from('reservados_vip')
          .select('*')
          .eq('event_id', event.id)
          .order('base_price', { ascending: true });
        return withSoftDeleteCols ? q.eq('is_active', true).is('deleted_at', null) : q;
      };

      let vipRes: any = await fetchVip(true);
      if (vipRes.error?.code === '42703' && String(vipRes.error?.message || '').match(/is_active|deleted_at/i)) {
        vipRes = await fetchVip(false);
      }

      if (!vipRes.error && Array.isArray(vipRes.data)) {
        setVipReservados(vipRes.data);
        const firstAvailable = vipRes.data.find((v: any) => (v.quantity_available ?? 0) > 0) || vipRes.data[0];
        setSelectedVipId(firstAvailable?.id ?? null);
      }
    } catch (e) {
      console.error("Error fetching ticket types:", e);
      Alert.alert("Error", "No se pudieron cargar los tipos de entrada.");
    }
  }, []);

  const fetchAssignedEvents = useCallback(async () => {
    if (!workerProfile) return;
    try {
      const { data: assignments, error } = await supabase
        .from('worker_event_assignments')
        .select('events!inner (id,title,event_date,end_datetime,poster_url,age_restriction,creator_id,venues(name))')
        .eq('worker_id', workerProfile.id).eq('status', 'active')
        .eq('events.creator_id', workerProfile.organizer_id);

      if (error) throw error;

      const data = (assignments || []).map((a: any) => a.events).filter((event: any) => event &&
        new Date(event.end_datetime || new Date(new Date(event.event_date).getTime() + 5*3600000)).getTime() > Date.now())
        .sort((a: any,b: any) => String(a.event_date).localeCompare(String(b.event_date)));
      if (data) {
        setEvents(data);
        if (data.length > 0) {
          selectEvent(data[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  }, [selectEvent, workerProfile]);

  useEffect(() => {
    fetchAssignedEvents();
  }, [fetchAssignedEvents]);

  const updateQuantity = (typeId: string, delta: number) => {
    setQuantities(prev => {
      const current = prev[typeId] || 0;
      const tt = ticketTypes.find((t) => t.id === typeId);
      const available = tt ? Math.max((Number(tt.quantity) || 0) - (Number(tt.sold) || 0), 0) : Number.MAX_SAFE_INTEGER;
      const newValue = Math.max(0, Math.min(available, current + delta));
      return { ...prev, [typeId]: newValue };
    });
  };

  const calculateTotal = () => {
    const ticketsTotal = ticketTypes.reduce((total, type) => {
      return total + (type.price * (quantities[type.id] || 0));
    }, 0);
    const vip = vipReservados.find((v) => v.id === selectedVipId);
    const vipTotal = vip && vipQty > 0 ? vip.base_price * vipQty : 0;
    return ticketsTotal + vipTotal;
  };

  const handleSale = async () => {
    if (!boxOffice.can_sell) {
      Alert.alert('Venta no disponible', 'El organizador debe tener Taquilla Premium activa y autorizarte para vender. Puedes seguir escaneando entradas.');
      return;
    }
    const total = calculateTotal();
    setSubmitAttempted(true);
    touch('buyer.name');
    touch('buyer.email');
    touch('buyer.age');
    if (total === 0) {
      Alert.alert('Error', 'Selecciona al menos una entrada');
      return;
    }

    if (Object.keys(buyerErrors).length > 0) {
      console.warn('[worker_sale_validation_failed]', JSON.stringify({ buyerErrors }));
      Alert.alert('Revisa los datos', 'Corrige los campos marcados en rojo para continuar.');
      return;
    }

    const invalidQty = ticketTypes.some((tt) => {
      const qty = quantities[tt.id] || 0;
      const available = Math.max((Number(tt.quantity) || 0) - (Number(tt.sold) || 0), 0);
      return qty > available;
    });
    if (invalidQty) {
      Alert.alert('No hay stock suficiente', 'Algún tipo de entrada no tiene suficientes unidades disponibles.');
      return;
    }

    Alert.alert(
      'Confirmar Venta',
      `Total a cobrar: ${total}€\n\n¿Confirmar pago en efectivo?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: processSale }
      ]
    );
  };

  const generateAndSharePDF = async (tickets: any[]) => {
    if (!selectedEvent) return;

    try {
      const buyer = tickets[0];
      // Build QR SVG for each ticket (pure SVG, no canvas)
      const qrSvgs: Record<string, string> = {};
      for (const ticket of tickets) {
        const token = ticket.qr_token || ticket.qr_code || '';
        const svg = new QRCodeSVG({
          content: token,
          padding: 0,
          width: 160,
          height: 160,
          color: '#000',
          background: '#fff'
        }).svg();
        qrSvgs[token] = svg;
      }

      const html = `
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #333; }
              .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
              .title { font-size: 24px; font-weight: bold; color: #000; margin-bottom: 5px; }
              .subtitle { font-size: 14px; color: #666; }
              .ticket { border: 1px dashed #ccc; padding: 20px; margin-bottom: 20px; border-radius: 8px; background: #f9f9f9; page-break-inside: avoid; }
              .ticket-header { display: flex; justify-content: space-between; border-bottom: 1px solid #ddd; padding-bottom: 10px; margin-bottom: 10px; }
              .event-name { font-size: 18px; font-weight: bold; }
              .ticket-type { font-size: 16px; font-weight: bold; color: #2563eb; }
              .details { font-size: 14px; line-height: 1.6; }
              .qr-code { text-align: center; margin-top: 15px; }
              .footer { text-align: center; font-size: 10px; color: #999; margin-top: 40px; }
              .poster { text-align: center; margin-bottom: 15px; }
            </style>
          </head>
          <body>
            <div class="header">
              ${selectedEvent.poster_url ? `<div class="poster"><img src="${selectedEvent.poster_url}" style="max-width:100%;height:160px;object-fit:cover;" /></div>` : ''}
              <div class="title">Recibo de Compra</div>
              <div class="subtitle">Fecha: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
              <div class="subtitle">Vendido por: ${workerProfile?.name}</div>
              <div class="subtitle"><strong>Comprador: ${buyer.attendee_name || buyer.buyer_name}</strong></div>
              <div class="subtitle">Email: ${buyer.attendee_email || buyer.buyer_email}</div>
            </div>

            ${tickets.map(ticket => `
              <div class="ticket">
                <div class="ticket-header">
                  <span class="event-name">${selectedEvent.title}</span>
                  <span class="ticket-type">${ticket.ticket_type}</span>
                </div>
                <div class="details">
                  <div><strong>Precio:</strong> ${ticket.price}€</div>
                  <div><strong>ID Entrada:</strong> ${ticket.id?.substring(0, 8) || 'PENDING'}</div>
                  <div><strong>Asistente:</strong> ${ticket.attendee_name || ticket.buyer_name}</div>
                  <div><strong>Estado:</strong> Pagado (Efectivo)</div>
                </div>
                <div class="qr-code">
                  ${qrSvgs[ticket.qr_token || ticket.qr_code || ''] || '<div style="font-size:12px;color:#999">QR no disponible</div>'}
                  <div style="font-size: 10px; margin-top: 5px;">Código QR</div>
                </div>
              </div>
            `).join('')}

            <div class="footer">
              <p>Gracias por tu compra. Presenta este recibo en la entrada.</p>
              <p>Este documento es válido como entrada.</p>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });

      const buyerEmail = tickets[0].attendee_email || tickets[0].buyer_email;
      const isMailAvailable = await MailComposer.isAvailableAsync();
      if (isMailAvailable) {
        await MailComposer.composeAsync({
          recipients: buyerEmail ? [buyerEmail] : [],
          subject: `Tu entrada para ${selectedEvent.title}`,
          body: `Hola ${tickets[0].attendee_name || 'Asistente'},\n\nAdjunto encontrarás tu entrada para ${selectedEvent.title}.\n\nGracias por tu compra.`,
          attachments: [uri],
          isHtml: true,
        });
      } else {
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      Alert.alert('Error', 'No se pudo generar el PDF');
    }
  };

  // Process Sale
  const processSale = async () => {
    if (!workerProfile || !selectedEvent || submittingRef.current) return;
    submittingRef.current = true;
    setProcessing(true);

    try {
      const saleItems = ticketTypes
        .map((type) => ({
          ticket_type_id: type.id,
          quantity: quantities[type.id] || 0,
        }))
        .filter((item) => item.quantity > 0);

      const payload = {
        p_worker_id: workerProfile.id, p_event_id: selectedEvent.id, p_items: saleItems,
        p_vip_id: selectedVipId, p_vip_quantity: vipQty,
        p_buyer_name: buyerDetails.name.trim(), p_buyer_email: buyerDetails.email.trim(),
        p_buyer_age: parseInt(buyerDetails.age, 10),
      };
      const storageKey = `manual-sale:${workerProfile.id}`;
      const serialized = JSON.stringify(payload);
      const saved = await AsyncStorage.getItem(storageKey);
      const prior = saved ? JSON.parse(saved) : null;
      // Persist before sending: a lost response or process restart can replay safely.
      const requestKey = prior?.payload === serialized ? prior.key
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      await AsyncStorage.setItem(storageKey, JSON.stringify({ key: requestKey, payload: serialized }));
      const { data: saleResult, error: saleError } = await supabase.rpc('sell_manual_order', {
        ...payload, p_request_key: requestKey,
      });
      if (saleError) throw saleError;
      if (!saleResult?.success || !Array.isArray(saleResult.tickets)) throw new Error('Respuesta de venta inválida');
      const allTickets = saleResult.tickets;
      setQuantities({});
      setVipQty(0);
      setSelectedVipId(null);
      // The sale is confirmed even if local cleanup fails.
      await AsyncStorage.removeItem(storageKey).catch(() => {});

      setLastSaleTickets(allTickets);
      
      Alert.alert(
        'Venta Exitosa',
        `La venta a ${buyerDetails.name} se ha registrado correctamente.`,
        [
          { 
            text: 'Enviar por Gmail', 
            onPress: () => generateAndSharePDF(allTickets) 
          },
          { 
            text: 'Nueva Venta', 
            style: 'cancel',
            onPress: () => {
              setQuantities({});
              setBuyerDetails({ name: '', email: '', age: '' });
              setLastSaleTickets(null);
            }
          }
        ]
      );

    } catch (error: any) {
      console.error('Error processing sale:', JSON.stringify(error, null, 2));
      Alert.alert('Error', 'No se pudo registrar la venta: ' + (error.message || 'Error desconocido') + (error.details ? `\n\n${error.details}` : ''));
    } finally {
      submittingRef.current = false;
      setProcessing(false);
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
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>Vender en taquilla</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Event Selector */}
          <Text style={styles.sectionTitle}>Evento</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.eventScroll}>
            {events.map(event => (
              <TouchableOpacity 
                key={event.id} 
                onPress={() => selectEvent(event)}
                activeOpacity={0.8}
              >
                <GlassView 
                  intensity={selectedEvent?.id === event.id ? 40 : 10} 
                  style={[
                    styles.eventCard,
                    selectedEvent?.id === event.id && styles.selectedEvent
                  ]}
                >
                  <Text style={styles.eventName}>{event.title}</Text>
                  <Text style={styles.eventDate}>
                    {new Date(event.event_date).toLocaleDateString()}
                  </Text>
                </GlassView>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Ticket Types */}
          {selectedEvent && (
            <>
              <Text style={styles.sectionTitle}>Entradas</Text>
              {ticketTypes.length === 0 ? (
                <GlassView intensity={10} style={styles.emptyCard}>
                  <View style={styles.emptyIcon}>
                    <Tag size={24} color={Colors.dark.textSecondary} />
                  </View>
                  <Text style={styles.emptyText}>No hay entradas disponibles para este evento.</Text>
                </GlassView>
              ) : ticketTypes.map(type => (
                <GlassView key={type.id} intensity={15} style={styles.ticketRow}>
                  <View>
                    <Text style={styles.ticketName}>{type.name}</Text>
                    <Text style={styles.ticketPrice}>{type.price}€</Text>
                  </View>
                  
                  <View style={styles.quantityControl}>
                    <TouchableOpacity 
                      onPress={() => updateQuantity(type.id, -1)}
                      style={styles.qtyButton}
                    >
                      <Minus size={20} color="white" />
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{quantities[type.id] || 0}</Text>
                    <TouchableOpacity 
                      onPress={() => updateQuantity(type.id, 1)}
                      style={[styles.qtyButton, { backgroundColor: Colors.dark.primary }]}
                    >
                      <Plus size={20} color="white" />
                    </TouchableOpacity>
                  </View>
                </GlassView>
              ))}

              {vipReservados.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Reservados VIP</Text>
                  <GlassView intensity={12} style={styles.vipCard}>
                    <Text style={styles.vipLabel}>Reservado</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vipChips}>
                      {vipReservados.map((vip) => {
                        const isSelected = selectedVipId === vip.id;
                        const available = vip.quantity_available ?? 0;
                        return (
                          <TouchableOpacity
                            key={vip.id}
                            onPress={() => setSelectedVipId(vip.id)}
                            activeOpacity={0.85}
                            style={[
                              styles.vipChip,
                              isSelected && styles.vipChipActive,
                              available <= 0 && styles.vipChipDisabled,
                            ]}
                            disabled={available <= 0}
                          >
                            <Text style={[styles.vipChipText, isSelected && styles.vipChipTextActive]} numberOfLines={1}>
                              {vip.name}
                            </Text>
                            <Text style={styles.vipChipSub} numberOfLines={1}>
                              {available > 0 ? `${available} disponibles` : 'Agotado'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {selectedVipId ? (
                      <View style={styles.vipRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ticketName}>
                            {vipReservados.find((v) => v.id === selectedVipId)?.name || 'VIP'}
                          </Text>
                          <Text style={styles.ticketPrice}>
                            {vipReservados.find((v) => v.id === selectedVipId)?.base_price ?? 0}€
                          </Text>
                        </View>
                        <View style={styles.quantityControl}>
                          <TouchableOpacity
                            onPress={() => setVipQty((q) => Math.max(0, q - 1))}
                            style={styles.qtyButton}
                          >
                            <Minus size={20} color="white" />
                          </TouchableOpacity>
                          <Text style={styles.qtyText}>{vipQty}</Text>
                          <TouchableOpacity
                            onPress={() => {
                              const available = vipReservados.find((v) => v.id === selectedVipId)?.quantity_available ?? 0;
                              setVipQty((q) => Math.min(available, q + 1));
                            }}
                            style={[styles.qtyButton, { backgroundColor: Colors.dark.primary }]}
                          >
                            <Plus size={20} color="white" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : null}
                  </GlassView>
                </>
              )}

              {/* Buyer Details Form - Only show if tickets selected */}
              {calculateTotal() > 0 && (
                <View style={{ marginTop: 10, marginBottom: 20 }}>
                   <Text style={styles.sectionTitle}>Datos del Comprador</Text>
                   <GlassView intensity={10} style={{ padding: 15, borderRadius: 16 }}>
                      <ThemedInput
                        label="Nombre Completo"
                        placeholder="Ej: Juan Pérez"
                        value={buyerDetails.name}
                        onChangeText={(text) => setBuyerDetails(prev => ({...prev, name: text}))}
                        onBlur={() => touch('buyer.name')}
                        error={((submitAttempted || touched['buyer.name']) && buyerErrors.name) || undefined}
                        containerStyle={{ marginBottom: 15 }}
                        icon={<User size={20} color={Colors.dark.textSecondary} />}
                      />
                      <ThemedInput
                        label="Email (para envío de entrada)"
                        placeholder="juan@ejemplo.com"
                        value={buyerDetails.email}
                        onChangeText={(text) => setBuyerDetails(prev => ({...prev, email: text}))}
                        onBlur={() => touch('buyer.email')}
                        error={((submitAttempted || touched['buyer.email']) && buyerErrors.email) || undefined}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        containerStyle={{ marginBottom: 15 }}
                        icon={<Mail size={20} color={Colors.dark.textSecondary} />}
                      />
                      <ThemedInput
                        label="Edad"
                        placeholder="Ej: 25"
                        value={buyerDetails.age}
                        onChangeText={(text) => setBuyerDetails(prev => ({...prev, age: text}))}
                        onBlur={() => touch('buyer.age')}
                        error={((submitAttempted || touched['buyer.age']) && buyerErrors.age) || undefined}
                        keyboardType="numeric"
                        containerStyle={{ marginBottom: 5 }}
                        icon={<Calendar size={20} color={Colors.dark.textSecondary} />}
                      />
                   </GlassView>
                </View>
              )}

              {/* Total */}
              <View style={styles.totalContainer}>
                <Text style={styles.totalLabel}>Total a Cobrar:</Text>
                <Text style={styles.totalValue}>{calculateTotal()}€</Text>
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {lastSaleTickets ? (
            <View style={styles.successActions}>
              <ThemedButton
                title="Compartir/Imprimir Entradas"
                onPress={() => generateAndSharePDF(lastSaleTickets)}
                icon={<Share size={20} color="white" />}
                style={{ marginBottom: 10 }}
              />
              <ThemedButton
                title="Nueva Venta"
                onPress={() => {
                  setQuantities({});
                  setLastSaleTickets(null);
                }}
                variant="outline"
                icon={<Plus size={20} color={Colors.dark.primary} />}
              />
            </View>
          ) : (
            <ThemedButton
              title={processing ? "Procesando..." : "Confirmar Venta (Efectivo)"}
              onPress={handleSale}
              disabled={processing || calculateTotal() === 0 || Object.keys(buyerErrors).length > 0}
              icon={<DollarSign size={20} color="white" />}
            />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  backButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  content: {
    padding: 20,
  },
  sectionTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  eventScroll: {
    marginBottom: 30,
    maxHeight: 100,
  },
  eventCard: {
    padding: 15,
    borderRadius: 16,
    marginRight: 15,
    width: 160,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  selectedEvent: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  eventName: {
    color: 'white',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  eventDate: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderRadius: 16,
    marginBottom: 15,
  },
  vipCard: {
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
  },
  vipLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  vipChips: {
    gap: 10,
    paddingBottom: 10,
  },
  vipChip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    minWidth: 140,
  },
  vipChipActive: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(251,191,36,0.12)',
  },
  vipChipDisabled: {
    opacity: 0.5,
  },
  vipChipText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '800',
  },
  vipChipTextActive: {
    color: Colors.dark.primary,
  },
  vipChipSub: {
    marginTop: 4,
    color: Colors.dark.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  vipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  emptyCard: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 18,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    marginBottom: 12,
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  ticketName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  ticketPrice: {
    color: '#4ade80',
    fontSize: 18,
    fontWeight: 'bold',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  qtyButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    width: 30,
    textAlign: 'center',
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
  },
  totalLabel: {
    color: 'white',
    fontSize: 18,
  },
  totalValue: {
    color: '#4ade80',
    fontSize: 32,
    fontWeight: 'bold',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  successActions: {
    gap: 10,
  }
});
