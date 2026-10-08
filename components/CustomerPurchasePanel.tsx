import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, ArrowRight, Check, Lock, Mail, Minus, Plus, Ticket, User } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { theme } from '@/theme/styles';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { offerUnavailableReason } from '@/supabase/functions/_shared/ticketProduct';

type Offer = { id: string; name: string; category?: string | null; price: number; quantity: number; sold?: number; metadata?: Record<string, any> | null };
type Table = { id: string; name: string; description?: string | null; base_price: number; capacity_people: number; included_bottles: number; quantity_available?: number; extra_bottle_price?: number | null };
type Props = {
  event: { event_date: string; ticket_price: number; available_tickets: number; event_ticket_types?: Offer[]; reservados_vip?: Table[] };
  tab: 'tickets' | 'vip'; onTab: (value: 'tickets' | 'vip') => void;
  selectedId: string | null; onSelect: (id: string) => void;
  quantity: number; min: number; max: number; onQuantity: (value: number) => void;
  name: string; email: string; onName: (value: string) => void; onEmail: (value: string) => void;
  subtotal: number; fee: number; total: number; saving: number;
  unavailable: string | null; busy: boolean; authenticated: boolean; onSubmit: () => void;
  coupon: { value: string; onChange: (value: string) => void; apply: () => void; remove: () => void; label?: string; busy: boolean; error?: string };
  wallet: { enabled: boolean; selected: boolean; balance: number; loading: boolean; onChange: (value: boolean) => void };
  loadError?: string | null; locale?: string;
};

/** Presentation only. Prices and payment handlers are supplied by the event checkout. */
export function CustomerPurchasePanel(p: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [attempted, setAttempted] = useState(false);
  const emailRef = useRef<TextInput>(null);
  useEffect(() => { setStep(1); setAttempted(false); }, [p.tab]);
  const mesa = p.tab === 'vip';
  const money = (value: number) => new Intl.NumberFormat(p.locale || 'es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value);
  const offers = mesa ? (p.event.reservados_vip || []).map(table => ({
    id: table.id, name: table.name, price: table.base_price, stock: table.quantity_available || 0,
    unit: 'mesa completa', capacity: table.capacity_people, min: 1, max: 1,
    details: [table.description, `${table.capacity_people} personas · ${table.included_bottles} ${table.included_bottles === 1 ? 'botella incluida' : 'botellas incluidas'}`, table.extra_bottle_price != null ? `Botella adicional: ${money(table.extra_bottle_price)}` : null].filter(Boolean) as string[],
    reason: offerUnavailableReason({ ...table, category: 'table', quantity: table.quantity_available || 0, sold: 0, event_date: p.event.event_date }, 1),
  })) : (p.event.event_ticket_types?.length ? p.event.event_ticket_types : [{ id: 'general', name: 'Entrada general', price: p.event.ticket_price, quantity: p.event.available_tickets }]).map(offer => {
    const meta = offer.metadata || {};
    const capacity = Number(meta.admissionsPerUnit || 1);
    const deadline = meta.entryDeadlineMinutes ? new Date(new Date(p.event.event_date).getTime() + Number(meta.entryDeadlineMinutes) * 60000) : null;
    return {
      id: offer.id, name: String(offer.name || 'Entrada').replace(/^Premium · /i, ''), price: offer.price,
      stock: Math.max(0, offer.quantity - Number(offer.sold || 0)), capacity,
      unit: capacity > 1 ? `pack de ${capacity} personas` : 'por persona', min: Number(meta.minPerOrder || 1), max: Number(meta.maxPerOrder || 10),
      details: [
        Number(meta.includedDrinks) > 0 ? `${meta.includedDrinks} ${Number(meta.includedDrinks) === 1 ? 'consumición' : 'consumiciones'} por persona` : null,
        capacity > 1 ? 'Acceso general · Sin mesa reservada' : null,
        capacity > 1 ? 'Acceso conjunto: un QR por pack' : null,
        deadline ? `Acceso antes de ${deadline.toLocaleString(p.locale || 'es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : null,
        meta.benefits, meta.accessZone ? `Zona ${meta.accessZone}` : null,
        meta.dedicatedLane ? 'Carril prioritario' : null, meta.numberedSeat ? 'Asiento numerado' : null,
        meta.earlyEntryMinutes ? `Acceso ${meta.earlyEntryMinutes} min antes` : null,
        meta.backstageHost ? `Meet & Greet con ${meta.backstageHost}` : null,
      ].filter(Boolean) as string[],
      phase: meta.salePhase as string | undefined,
      reason: offerUnavailableReason({ ...offer, event_date: p.event.event_date }, Number(meta.minPerOrder || 1)),
    };
  });
  const selected = offers.find(offer => offer.id === p.selectedId) || (p.selectedId == null && !p.event.event_ticket_types?.length ? offers[0] : undefined);
  const maxQuantity = Math.min(p.max, selected?.stock || 0);
  const disabled = p.busy || p.coupon.busy || !!p.unavailable || !selected || selected.stock <= 0 || (p.wallet.selected && p.wallet.loading);
  const couponLocked = p.busy || p.coupon.busy;
  const applyCoupon = () => {
    if (!couponLocked && p.coupon.value.trim() && !p.coupon.label) p.coupon.apply();
  };
  const nameError = attempted && !p.name.trim();
  const emailError = attempted && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim());
  const advance = () => {
    if (disabled) return;
    if (!p.authenticated) { p.onSubmit(); return; }
    if (step === 1) { setStep(2); return; }
    setAttempted(true);
    if (p.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) p.onSubmit();
  };
  const buttonTitle = !p.authenticated ? 'Iniciar sesión para continuar' : step === 1 ? 'Continuar' : p.total === 0 ? 'Obtener entrada' : p.wallet.selected ? 'Confirmar compra' : 'Ir al pago seguro';

  return <GlassView intensity={22} style={s.panel} contentContainerStyle={s.panelContent}>
    <LinearGradient colors={[Colors.dark.primarySoft, 'transparent']} start={{x:0,y:0}} end={{x:1,y:.8}} style={StyleSheet.absoluteFill} pointerEvents="none"/>
    <View style={s.masthead}><View style={s.brandDot}/><Text style={s.eyebrow}>ECLIPSE / ACCESO</Text><Text style={s.pageNumber}>0{step} — 02</Text></View>
    <View style={s.intro}><Text accessibilityRole="header" style={s.title}>{step === 1 ? 'Tu noche.\nTu entrada.' : 'Casi dentro.'}</Text><Text style={s.subtitle}>{step === 1 ? 'Elige cómo quieres vivirla.' : 'Tu entrada llegará a este correo.'}</Text></View>
    <View style={s.progress}><View style={s.progressActive}/><View style={[s.progressLine, step === 2 && s.progressActive]}/></View>
    <View style={s.steps}><Text style={[s.stepText, step === 1 && s.stepActive]}>01  Elige tu acceso</Text><Text style={[s.stepText, step === 2 && s.stepActive]}>02  Datos y pago</Text></View>
    {!!p.loadError && <Text accessibilityRole="alert" style={s.error}>No se han podido cargar los reservados. Vuelve a intentarlo.</Text>}

    {step === 1 ? <>
      {!!p.event.reservados_vip?.length && <View accessibilityRole="tablist" style={s.tabs}>{(['tickets', 'vip'] as const).map(tab => <TouchableOpacity key={tab} accessibilityRole="tab" accessibilityState={{ selected: p.tab === tab }} onPress={() => p.onTab(tab)} style={[s.tab, p.tab === tab && s.tabSelected]}><Text style={[s.tabText, p.tab === tab && s.tabTextSelected]}>{tab === 'tickets' ? 'Entradas' : 'Mesas VIP'}</Text></TouchableOpacity>)}</View>}
      <View style={s.offers}>{offers.map(offer => {
        const active = selected?.id === offer.id;
        return <TouchableOpacity key={offer.id} accessibilityRole="radio" accessibilityState={{ checked: active, disabled: !!offer.reason }} accessibilityLabel={`${offer.name}, ${money(offer.price)}, ${offer.unit}${offer.reason ? ', ' + offer.reason : ''}`} disabled={!!offer.reason || p.busy} onPress={() => p.onSelect(offer.id)} activeOpacity={0.8} style={[s.offer, active && s.offerSelected, !!offer.reason && s.offerDisabled]}>
          <View style={s.offerMain}><View style={[s.radio, active && s.radioActive]}>{active && <Check size={12} color={Colors.dark.text}/>}</View><View style={s.offerCopy}><Text style={s.offerName}>{offer.name}</Text><Text style={s.offerUnit}>{offer.unit}</Text></View><Text style={s.offerPrice}>{offer.price === 0 ? 'Gratis' : money(offer.price)}</Text></View>
          {active && <View style={s.offerDetails}>{offer.details.map((detail, i) => <Text key={i} style={s.detail}>{detail}</Text>)}</View>}
          <View style={s.offerFoot}><Text style={s.stock}>{offer.reason || `${offer.stock} disponibles`}</Text>{'phase' in offer && !!offer.phase && <Text style={s.phase}>{String(offer.phase)}</Text>}{mesa && <Text style={s.phase}>Reservado de mesa</Text>}</View>
        </TouchableOpacity>;
      })}</View>
      {!mesa && selected && <View style={s.quantityRow}><View style={s.offerCopy}><Text style={s.quantityLabel}>{selected.capacity > 1 ? 'Packs' : 'Entradas'}</Text><Text style={s.offerUnit}>{selected.capacity > 1 ? `${p.quantity * selected.capacity} personas en total` : p.quantity === 1 ? 'Para una persona' : `Para ${p.quantity} personas`}</Text></View><View style={s.stepper}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Reducir cantidad" disabled={p.quantity <= p.min || disabled} onPress={() => p.onQuantity(Math.max(p.min, p.quantity - 1))} style={[s.stepperButton, (p.quantity <= p.min || disabled) && s.muted]}><Minus size={17} color={Colors.dark.text}/></TouchableOpacity><Text accessibilityLiveRegion="polite" style={s.quantity}>{p.quantity}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Aumentar cantidad" disabled={p.quantity >= maxQuantity || disabled} onPress={() => p.onQuantity(Math.min(maxQuantity, p.quantity + 1))} style={[s.stepperButton, (p.quantity >= maxQuantity || disabled) && s.muted]}><Plus size={17} color={Colors.dark.text}/></TouchableOpacity></View></View>}
    </> : <>
      <View style={s.selection}><View style={s.receiptIcon}><Ticket size={22} color={Colors.dark.secondary}/></View><View style={s.offerCopy}><Text style={s.selectionName}>{selected?.name}</Text><Text style={s.offerUnit}>{mesa ? `${selected?.capacity} personas · mesa completa` : `${p.quantity} ${selected && selected.capacity > 1 ? p.quantity === 1 ? 'pack' : 'packs' : p.quantity === 1 ? 'entrada' : 'entradas'}`}</Text></View><TouchableOpacity accessibilityRole="button" onPress={() => setStep(1)} style={s.change}><Text style={s.link}>Cambiar</Text></TouchableOpacity></View>
      <View style={s.form}>
        <ThemedInput label="Nombre y apellidos" value={p.name} onChangeText={p.onName} placeholder="Nombre completo" icon={User} autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} containerStyle={s.inputWrapper} editable={!p.busy} error={nameError ? 'Introduce el nombre del titular.' : undefined}/>
        <ThemedInput ref={emailRef} label="Correo electrónico" value={p.email} onChangeText={p.onEmail} placeholder="tu@email.com" icon={Mail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" returnKeyType="done" containerStyle={s.inputWrapper} editable={!p.busy} error={emailError ? 'Introduce un correo válido para recibir tu entrada.' : undefined}/>
        <Text style={s.fieldHint}>La encontrarás también en Mis entradas.</Text>
      </View>
      {p.wallet.enabled && <View style={s.wallet}><View style={s.row}><Text style={s.detail}>Usar saldo de Eclipse</Text><Switch accessibilityLabel="Usar saldo de Eclipse" value={p.wallet.selected} onValueChange={p.wallet.onChange} disabled={p.wallet.loading} trackColor={{ true: Colors.dark.primary }}/></View><Text style={s.fieldHint}>{p.wallet.loading ? 'Cargando saldo…' : `${money(p.wallet.balance)} disponibles`}</Text></View>}
    </>}

    {<View style={s.coupon}>
      <ThemedInput
        label="Código de descuento (opcional)"
        accessibilityLabel="Código de descuento"
        value={p.coupon.value}
        maxLength={64}
        error={p.coupon.error}
        onChangeText={value => p.coupon.onChange(value.toUpperCase())}
        placeholder="Introduce tu código"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        editable={!couponLocked && !p.coupon.label}
        success={!!p.coupon.label}
        onSubmitEditing={applyCoupon}
        containerStyle={s.couponField}
        rightIcon={<TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={p.coupon.label ? 'Quitar descuento' : 'Aplicar descuento'}
          accessibilityState={{ disabled: couponLocked || (!p.coupon.label && !p.coupon.value.trim()), busy: p.coupon.busy }}
          disabled={couponLocked || (!p.coupon.label && !p.coupon.value.trim())}
          onPress={p.coupon.label ? () => { if (!couponLocked) p.coupon.remove(); } : applyCoupon}
          style={[s.couponApply, (couponLocked || (!p.coupon.label && !p.coupon.value.trim())) && s.muted]}
        ><Text style={s.couponAction}>{p.coupon.busy ? 'Validando…' : p.coupon.label ? 'Quitar' : 'Aplicar'}</Text></TouchableOpacity>}
      />
      <Text accessibilityLiveRegion="polite" style={p.coupon.label ? s.saving : s.fieldHint}>{p.coupon.label ? `Aplicado · ${p.coupon.label}` : 'Si tienes un código del organizador, añádelo aquí.'}</Text>
    </View>}

    <View style={s.summary}>
      <View style={s.row}><Text style={s.summaryLabel}>{mesa ? 'Mesa completa' : `${p.quantity} ${selected && selected.capacity > 1 ? p.quantity === 1 ? 'pack' : 'packs' : p.quantity === 1 ? 'entrada' : 'entradas'}`}</Text><Text style={s.summaryValue}>{money(p.subtotal)}</Text></View>
      {p.saving > 0 && <View style={s.row}><Text style={s.saving}>Descuento aplicado</Text><Text style={s.saving}>−{money(p.saving)}</Text></View>}
      <View style={s.row}><Text style={s.summaryLabel}>Gastos de gestión</Text><Text style={s.summaryValue}>{money(p.fee)}</Text></View>
      <View style={s.totalRow}><Text style={s.totalLabel}>Total</Text><Text accessibilityLiveRegion="polite" style={s.total}>{money(p.total)}</Text></View>
      {p.wallet.enabled && p.wallet.selected && p.wallet.balance < p.total && <Text style={s.fieldHint}>Saldo: {money(Math.min(Math.max(p.wallet.balance, 0), Math.max(0, p.subtotal - p.saving)))} · Tarjeta: {money(p.total - Math.min(Math.max(p.wallet.balance, 0), Math.max(0, p.subtotal - p.saving)))}</Text>}
      {!!p.unavailable && <Text accessibilityRole="alert" style={s.error}>{p.unavailable}</Text>}
      <ThemedButton title={buttonTitle} accessibilityLabel={buttonTitle} disabled={disabled} onPress={advance} loading={p.busy} icon={<ArrowRight size={20} color={Colors.dark.text}/>} iconPosition="right"/>
      <View style={s.assurance}><Lock size={11} color={Colors.dark.textSecondary}/><Text style={s.assuranceText}>{step === 1 ? 'Verás el resumen antes de pagar' : p.total === 0 ? 'Recibirás tu QR al confirmar' : 'Pago seguro · Entrada con QR'}</Text></View>
      {step === 2 && <TouchableOpacity accessibilityRole="button" onPress={() => setStep(1)} style={s.back}><ArrowLeft size={13} color={Colors.dark.textSecondary}/><Text style={s.summaryLabel}>Volver a elegir</Text></TouchableOpacity>}
    </View>
  </GlassView>;
}

const s = StyleSheet.create({
  panel:{backgroundColor:Colors.dark.surface,borderRadius:theme.radius.lg,borderWidth:theme.components.card.borderWidth,borderColor:Colors.dark.border,overflow:'hidden'},panelContent:{padding:theme.space[6]},inputWrapper:{marginBottom:theme.space[3]},
  masthead:{flexDirection:'row',alignItems:'center',gap:8},brandDot:{width:7,height:7,borderRadius:4,backgroundColor:Colors.dark.secondary},eyebrow:{fontSize:11,fontWeight:'700',letterSpacing:2,color:Colors.dark.textSecondary,flex:1},pageNumber:{fontSize:12,color:Colors.dark.textSecondary,fontVariant:['tabular-nums']},
  intro:{paddingTop:26,paddingBottom:26,gap:10},title:{color:Colors.dark.text,fontFamily:theme.typography.fontFamily.display,fontSize:theme.typography.size['3xl'],lineHeight:35,fontWeight:theme.typography.weight.black,letterSpacing:-.5},subtitle:{color:Colors.dark.textSecondary,fontSize:theme.typography.size.sm,lineHeight:21},
  progress:{flexDirection:'row',gap:5},progressLine:{height:2,flex:1,backgroundColor:'#302839'},progressActive:{height:2,flex:1,backgroundColor:Colors.dark.secondary},steps:{flexDirection:'row',justifyContent:'space-between',paddingTop:12,paddingBottom:24},stepText:{fontSize:12,color:Colors.dark.textSecondary},stepActive:{color:Colors.dark.text},
  tabs:{flexDirection:'row',gap:4,padding:4,backgroundColor:Colors.dark.surfaceStrong,borderRadius:10,marginBottom:20},tab:{flex:1,paddingVertical:12,alignItems:'center',borderRadius:7},tabSelected:{backgroundColor:Colors.dark.primarySoft},tabText:{fontSize:12,fontWeight:'600',color:Colors.dark.textSecondary},tabTextSelected:{color:Colors.dark.text},
  offers:{gap:10},offer:{borderWidth:1,borderColor:Colors.dark.border,borderRadius:theme.radius.md,padding:theme.space[4],backgroundColor:Colors.dark.surfaceSubtle},offerSelected:{borderColor:Colors.dark.primary,backgroundColor:Colors.dark.primarySoft},offerDisabled:{opacity:0.45},offerMain:{flexDirection:'row',alignItems:'center',gap:11},radio:{width:18,height:18,borderRadius:9,borderWidth:1,borderColor:Colors.dark.borderStrong,alignItems:'center',justifyContent:'center'},radioActive:{backgroundColor:Colors.dark.primary,borderColor:Colors.dark.primary},offerCopy:{flex:1,minWidth:0,gap:4},offerName:{color:Colors.dark.text,fontSize:theme.typography.size.md,lineHeight:22,fontWeight:theme.typography.weight.semibold},offerUnit:{fontSize:12,lineHeight:15,color:Colors.dark.textSecondary},offerPrice:{fontSize:18,color:Colors.dark.text,fontWeight:'600',letterSpacing:-0.5,fontVariant:['tabular-nums'],maxWidth:'34%'},offerDetails:{paddingTop:13,paddingLeft:29,gap:6},detail:{fontSize:theme.typography.size.xs,lineHeight:18,color:Colors.dark.textSecondary},offerFoot:{flexDirection:'row',justifyContent:'space-between',flexWrap:'wrap',gap:6,paddingTop:12,marginTop:12,borderTopWidth:1,borderTopColor:Colors.dark.border},stock:{fontSize:11,lineHeight:14,color:Colors.dark.textSecondary},phase:{fontSize:11,lineHeight:14,color:Colors.dark.secondary},
  quantityRow:{flexDirection:'row',alignItems:'center',paddingVertical:23,gap:12},quantityLabel:{color:Colors.dark.text,fontSize:12,fontWeight:'600'},stepper:{flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:Colors.dark.border,borderRadius:9},stepperButton:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},quantity:{color:Colors.dark.text,fontSize:14,fontWeight:'600',minWidth:26,textAlign:'center',fontVariant:['tabular-nums']},muted:{opacity:0.4},
  selection:{flexDirection:'row',alignItems:'center',gap:12,paddingBottom:24,borderBottomWidth:1,borderBottomColor:Colors.dark.border},receiptIcon:{width:44,height:50,alignItems:'center',justifyContent:'center',borderRadius:8,backgroundColor:Colors.dark.primarySoft},selectionName:{fontSize:13,fontWeight:'600',color:Colors.dark.text,lineHeight:19},change:{minHeight:44,justifyContent:'center',paddingLeft:8},link:{color:Colors.dark.secondary,fontSize:11,fontWeight:'600'},
  form:{paddingTop:20,gap:10},label:{color:Colors.dark.text,fontSize:11,fontWeight:'600',marginTop:4},input:{borderRadius:theme.components.input.borderRadius,borderWidth:1,borderColor:Colors.dark.border,backgroundColor:Colors.dark.surfaceSubtle,paddingHorizontal:14,minHeight:theme.components.input.minHeight,color:Colors.dark.text,fontSize:15},inputError:{borderColor:Colors.dark.error},fieldHint:{color:Colors.dark.textSecondary,fontSize:12,lineHeight:16},error:{color:Colors.dark.error,fontSize:11,lineHeight:18,marginVertical:8},
  coupon:{marginTop:8,marginBottom:24,gap:8},couponField:{marginBottom:0},couponApply:{paddingHorizontal:4,minWidth:56,minHeight:44,justifyContent:'center',alignItems:'center'},couponAction:{color:Colors.dark.secondary,fontSize:12,fontWeight:'600'},wallet:{paddingVertical:16,gap:8},
  summary:{paddingTop:21,borderTopWidth:1,borderTopColor:Colors.dark.border,gap:10},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},summaryLabel:{color:Colors.dark.textSecondary,fontSize:11,lineHeight:17},summaryValue:{color:Colors.dark.textSecondary,fontSize:12,fontVariant:['tabular-nums']},saving:{color:Colors.dark.success,fontSize:11},totalRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',paddingTop:10,paddingBottom:12},totalLabel:{color:Colors.dark.text,fontSize:14,fontWeight:'600'},total:{color:Colors.dark.text,fontSize:theme.typography.size['3xl'],fontWeight:'600',letterSpacing:-1,fontVariant:['tabular-nums']},cta:{backgroundColor:Colors.dark.primary,borderRadius:10,minHeight:54,paddingHorizontal:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},ctaText:{color:Colors.dark.text,fontSize:13,fontWeight:'700',flex:1},assurance:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingTop:3},assuranceText:{color:Colors.dark.textSecondary,fontSize:11,lineHeight:15},back:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:5,minHeight:44},
});
