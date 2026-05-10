import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { SymbolView } from 'expo-symbols';

export type AppIconProps = {
  size?: number;
  color?: string;
  style?: any;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
};

export type AppIconComponent = React.ComponentType<AppIconProps>;

type IconSpec = {
  sf: string;
  fallback: string;
  type?: 'monochrome' | 'hierarchical' | 'palette' | 'multicolor';
  weight?: string;
  scale?: string;
};

const makeIcon = (spec: IconSpec): AppIconComponent => {
  const Icon: AppIconComponent = ({ size = 24, color = Colors.dark.text, style }) => (
    <SymbolView
      name={spec.sf as any}
      size={size}
      tintColor={color}
      type={(spec.type ?? 'hierarchical') as any}
      weight={(spec.weight ?? 'regular') as any}
      scale={(spec.scale ?? 'unspecified') as any}
      style={[{ width: size, height: size }, style]}
      fallback={
        <MaterialCommunityIcons
          name={spec.fallback as any}
          size={size}
          color={color}
          style={style}
        />
      }
    />
  );
  return Icon;
};

export const Activity = makeIcon({ sf: 'waveform.path.ecg', fallback: 'pulse' });
export const AlertCircle = makeIcon({ sf: 'exclamationmark.circle', fallback: 'alert-circle-outline', type: 'monochrome' });
export const AlertTriangle = makeIcon({ sf: 'exclamationmark.triangle', fallback: 'alert-outline', type: 'monochrome' });
export const ArrowDownLeft = makeIcon({ sf: 'arrow.down.left', fallback: 'arrow-bottom-left', type: 'monochrome' });
export const ArrowDownRight = makeIcon({ sf: 'arrow.down.right', fallback: 'arrow-bottom-right', type: 'monochrome' });
export const ArrowLeft = makeIcon({ sf: 'chevron.left', fallback: 'chevron-left', type: 'monochrome' });
export const ArrowRight = makeIcon({ sf: 'chevron.right', fallback: 'chevron-right', type: 'monochrome' });
export const ArrowUpRight = makeIcon({ sf: 'arrow.up.right', fallback: 'arrow-top-right', type: 'monochrome' });
export const Ban = makeIcon({ sf: 'nosign', fallback: 'cancel', type: 'monochrome' });
export const BarChart2 = makeIcon({ sf: 'chart.bar', fallback: 'chart-bar' });
export const BarChart3 = makeIcon({ sf: 'chart.bar.xaxis', fallback: 'chart-bar' });
export const Bell = makeIcon({ sf: 'bell', fallback: 'bell-outline' });
export const Building = makeIcon({ sf: 'building.2', fallback: 'office-building-outline' });
export const Building2 = makeIcon({ sf: 'building.2', fallback: 'office-building-outline' });
export const Calendar = makeIcon({ sf: 'calendar', fallback: 'calendar-month-outline' });
export const Camera = makeIcon({ sf: 'camera', fallback: 'camera-outline' });
export const Check = makeIcon({ sf: 'checkmark', fallback: 'check', type: 'monochrome' });
export const CheckCheck = makeIcon({ sf: 'checkmark.circle', fallback: 'check-all', type: 'monochrome' });
export const CheckCircle = makeIcon({ sf: 'checkmark.circle', fallback: 'check-circle-outline', type: 'monochrome' });
export const CheckCircle2 = makeIcon({ sf: 'checkmark.circle', fallback: 'check-circle-outline', type: 'monochrome' });
export const ChevronDown = makeIcon({ sf: 'chevron.down', fallback: 'chevron-down', type: 'monochrome' });
export const ChevronLeft = makeIcon({ sf: 'chevron.left', fallback: 'chevron-left', type: 'monochrome' });
export const ChevronRight = makeIcon({ sf: 'chevron.right', fallback: 'chevron-right', type: 'monochrome' });
export const Clock = makeIcon({ sf: 'clock', fallback: 'clock-outline' });
export const CreditCard = makeIcon({ sf: 'creditcard', fallback: 'credit-card-outline' });
export const DollarSign = makeIcon({ sf: 'eurosign', fallback: 'currency-eur', type: 'monochrome' });
export const Download = makeIcon({ sf: 'arrow.down.to.line', fallback: 'download', type: 'monochrome' });
export const Edit = makeIcon({ sf: 'pencil', fallback: 'pencil-outline', type: 'monochrome' });
export const Edit2 = makeIcon({ sf: 'pencil', fallback: 'pencil-outline', type: 'monochrome' });
export const Euro = makeIcon({ sf: 'eurosign', fallback: 'currency-eur', type: 'monochrome' });
export const ExternalLink = makeIcon({ sf: 'arrow.up.right.square', fallback: 'open-in-new', type: 'monochrome' });
export const Eye = makeIcon({ sf: 'eye', fallback: 'eye-outline', type: 'monochrome' });
export const EyeOff = makeIcon({ sf: 'eye.slash', fallback: 'eye-off-outline', type: 'monochrome' });
export const FileText = makeIcon({ sf: 'doc.text', fallback: 'file-document-outline' });
export const Filter = makeIcon({ sf: 'line.3.horizontal.decrease.circle', fallback: 'filter-variant', type: 'monochrome' });
export const Flame = makeIcon({ sf: 'flame', fallback: 'fire' });
export const Home = makeIcon({ sf: 'house', fallback: 'home-outline' });
export const Image = makeIcon({ sf: 'photo', fallback: 'image-outline' });
export const Info = makeIcon({ sf: 'info.circle', fallback: 'information-outline', type: 'monochrome' });
export const LineChart = makeIcon({ sf: 'chart.line.uptrend.xyaxis', fallback: 'chart-line' });
export const Lock = makeIcon({ sf: 'lock', fallback: 'lock-outline', type: 'monochrome' });
export const LogIn = makeIcon({ sf: 'rectangle.portrait.and.arrow.right', fallback: 'login', type: 'monochrome' });
export const LogOut = makeIcon({ sf: 'rectangle.portrait.and.arrow.left', fallback: 'logout', type: 'monochrome' });
export const Mail = makeIcon({ sf: 'envelope', fallback: 'email-outline', type: 'monochrome' });
export const Map = makeIcon({ sf: 'map', fallback: 'map-outline' });
export const MapPin = makeIcon({ sf: 'mappin.and.ellipse', fallback: 'map-marker-outline', type: 'monochrome' });
export const Menu = makeIcon({ sf: 'line.3.horizontal', fallback: 'menu', type: 'monochrome' });
export const Minus = makeIcon({ sf: 'minus', fallback: 'minus', type: 'monochrome' });
export const Music = makeIcon({ sf: 'music.note', fallback: 'music-note', type: 'monochrome' });
export const Navigation = makeIcon({ sf: 'location.north', fallback: 'navigation-variant-outline', type: 'monochrome' });
export const PartyPopper = makeIcon({ sf: 'sparkles', fallback: 'party-popper' });
export const Pencil = makeIcon({ sf: 'pencil', fallback: 'pencil-outline', type: 'monochrome' });
export const PieChart = makeIcon({ sf: 'chart.pie', fallback: 'chart-pie' });
export const Plus = makeIcon({ sf: 'plus', fallback: 'plus', type: 'monochrome' });
export const QrCode = makeIcon({ sf: 'qrcode', fallback: 'qrcode', type: 'monochrome' });
export const RefreshCw = makeIcon({ sf: 'arrow.clockwise', fallback: 'refresh', type: 'monochrome' });
export const Repeat = makeIcon({ sf: 'repeat', fallback: 'repeat', type: 'monochrome' });
export const ScanLine = makeIcon({ sf: 'qrcode.viewfinder', fallback: 'qrcode-scan', type: 'monochrome' });
export const Search = makeIcon({ sf: 'magnifyingglass', fallback: 'magnify', type: 'monochrome' });
export const Share = makeIcon({ sf: 'square.and.arrow.up', fallback: 'share-variant-outline', type: 'monochrome' });
export const Share2 = makeIcon({ sf: 'square.and.arrow.up', fallback: 'share-variant-outline', type: 'monochrome' });
export const Shield = makeIcon({ sf: 'shield', fallback: 'shield-outline', type: 'monochrome' });
export const ShieldCheck = makeIcon({ sf: 'checkmark.shield', fallback: 'shield-check-outline', type: 'monochrome' });
export const Shirt = makeIcon({ sf: 'tshirt', fallback: 'tshirt-crew-outline', type: 'monochrome' });
export const SlidersHorizontal = makeIcon({ sf: 'slider.horizontal.3', fallback: 'tune-variant', type: 'monochrome' });
export const Sparkles = makeIcon({ sf: 'sparkles', fallback: 'sparkles' });
export const Tag = makeIcon({ sf: 'tag', fallback: 'tag-outline', type: 'monochrome' });
export const Ticket = makeIcon({ sf: 'ticket', fallback: 'ticket-confirmation-outline' });
export const Trash2 = makeIcon({ sf: 'trash', fallback: 'trash-can-outline', type: 'monochrome' });
export const TrendingUp = makeIcon({ sf: 'chart.line.uptrend.xyaxis', fallback: 'trending-up' });
export const Upload = makeIcon({ sf: 'arrow.up.to.line', fallback: 'upload', type: 'monochrome' });
export const User = makeIcon({ sf: 'person.crop.circle', fallback: 'account-outline' });
export const UserPlus = makeIcon({ sf: 'person.badge.plus', fallback: 'account-plus-outline' });
export const Users = makeIcon({ sf: 'person.2', fallback: 'account-group-outline' });
export const Wallet = makeIcon({ sf: 'wallet.pass', fallback: 'wallet-outline' });
export const X = makeIcon({ sf: 'xmark', fallback: 'close', type: 'monochrome' });
export const XCircle = makeIcon({ sf: 'xmark.circle', fallback: 'close-circle-outline', type: 'monochrome' });
