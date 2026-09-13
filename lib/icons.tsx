import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';

export type AppIconProps = {
  size?: number;
  color?: string;
  style?: any;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
};

export type AppIconComponent = React.ComponentType<AppIconProps>;

type IconSpec = {
  ion: string;
};

const makeIcon = (spec: IconSpec): AppIconComponent => {
  const Icon: AppIconComponent = ({ size = 24, color = Colors.dark.text, style }) => (
    <Ionicons name={spec.ion as any} size={size} color={color} style={style} />
  );
  return Icon;
};

export const Activity = makeIcon({ ion: 'pulse-outline' });
export const AlertCircle = makeIcon({ ion: 'alert-circle-outline' });
export const AlertTriangle = makeIcon({ ion: 'warning-outline' });
export const ArrowDownLeft = makeIcon({ ion: 'arrow-down-left-box-outline' });
export const ArrowDownRight = makeIcon({ ion: 'arrow-down-right-box-outline' });
export const ArrowLeft = makeIcon({ ion: 'chevron-back' });
export const ArrowRight = makeIcon({ ion: 'chevron-forward' });
export const ArrowUpRight = makeIcon({ ion: 'arrow-up-right-box-outline' });
export const Ban = makeIcon({ ion: 'ban-outline' });
export const BarChart2 = makeIcon({ ion: 'bar-chart-outline' });
export const BarChart3 = makeIcon({ ion: 'bar-chart-outline' });
export const Bell = makeIcon({ ion: 'notifications-outline' });
export const Building = makeIcon({ ion: 'business-outline' });
export const Building2 = makeIcon({ ion: 'business-outline' });
export const Calendar = makeIcon({ ion: 'calendar-outline' });
export const Camera = makeIcon({ ion: 'camera-outline' });
export const Check = makeIcon({ ion: 'checkmark' });
export const CheckCheck = makeIcon({ ion: 'checkmark-done-outline' });
export const CheckCircle = makeIcon({ ion: 'checkmark-circle-outline' });
export const CheckCircle2 = makeIcon({ ion: 'checkmark-circle-outline' });
export const ChevronDown = makeIcon({ ion: 'chevron-down' });
export const ChevronUp = makeIcon({ ion: 'chevron-up' });
export const ChevronLeft = makeIcon({ ion: 'chevron-back' });
export const ChevronRight = makeIcon({ ion: 'chevron-forward' });
export const Clock = makeIcon({ ion: 'time-outline' });
export const CreditCard = makeIcon({ ion: 'card-outline' });
export const DollarSign = makeIcon({ ion: 'cash-outline' });
export const Download = makeIcon({ ion: 'download-outline' });
export const Edit = makeIcon({ ion: 'pencil-outline' });
export const Edit2 = makeIcon({ ion: 'pencil-outline' });
export const Euro = makeIcon({ ion: 'cash-outline' });
export const ExternalLink = makeIcon({ ion: 'open-outline' });
export const Eye = makeIcon({ ion: 'eye-outline' });
export const EyeOff = makeIcon({ ion: 'eye-off-outline' });
export const FileText = makeIcon({ ion: 'document-text-outline' });
export const Filter = makeIcon({ ion: 'filter-outline' });
export const Flame = makeIcon({ ion: 'flame-outline' });
export const Home = makeIcon({ ion: 'home-outline' });
export const Keyboard = makeIcon({ ion: 'keypad-outline' });
export const Image = makeIcon({ ion: 'image-outline' });
export const Info = makeIcon({ ion: 'information-circle-outline' });
export const LineChart = makeIcon({ ion: 'stats-chart-outline' });
export const Lock = makeIcon({ ion: 'lock-closed-outline' });
export const LogIn = makeIcon({ ion: 'log-in-outline' });
export const LogOut = makeIcon({ ion: 'log-out-outline' });
export const Mail = makeIcon({ ion: 'mail-outline' });
export const MessageCircle = makeIcon({ ion: 'chatbubble-ellipses-outline' });
export const Map = makeIcon({ ion: 'map-outline' });
export const MapPin = makeIcon({ ion: 'location-outline' });
export const Menu = makeIcon({ ion: 'menu-outline' });
export const Minus = makeIcon({ ion: 'remove-outline' });
export const Music = makeIcon({ ion: 'musical-notes-outline' });
export const Navigation = makeIcon({ ion: 'navigate-outline' });
export const PartyPopper = makeIcon({ ion: 'sparkles-outline' });
export const Pencil = makeIcon({ ion: 'pencil-outline' });
export const PieChart = makeIcon({ ion: 'pie-chart-outline' });
export const Plus = makeIcon({ ion: 'add-outline' });
export const QrCode = makeIcon({ ion: 'qr-code-outline' });
export const RefreshCw = makeIcon({ ion: 'refresh-outline' });
export const Repeat = makeIcon({ ion: 'repeat-outline' });
export const ScanLine = makeIcon({ ion: 'scan-outline' });
export const Search = makeIcon({ ion: 'search-outline' });
export const Share = makeIcon({ ion: 'share-outline' });
export const ShoppingBag = makeIcon({ ion: 'bag-outline' });
export const Share2 = makeIcon({ ion: 'share-outline' });
export const Shield = makeIcon({ ion: 'shield-outline' });
export const ShieldCheck = makeIcon({ ion: 'shield-checkmark-outline' });
export const Shirt = makeIcon({ ion: 'shirt-outline' });
export const SlidersHorizontal = makeIcon({ ion: 'options-outline' });
export const Sparkles = makeIcon({ ion: 'sparkles-outline' });
export const Tag = makeIcon({ ion: 'pricetag-outline' });
export const Ticket = makeIcon({ ion: 'ticket-outline' });
export const Trash2 = makeIcon({ ion: 'trash-outline' });
export const TrendingUp = makeIcon({ ion: 'trending-up-outline' });
export const Upload = makeIcon({ ion: 'cloud-upload-outline' });
export const User = makeIcon({ ion: 'person-outline' });
export const UserPlus = makeIcon({ ion: 'person-add-outline' });
export const Users = makeIcon({ ion: 'people-outline' });
export const Wallet = makeIcon({ ion: 'wallet-outline' });
export const X = makeIcon({ ion: 'close' });
export const XCircle = makeIcon({ ion: 'close-circle-outline' });
