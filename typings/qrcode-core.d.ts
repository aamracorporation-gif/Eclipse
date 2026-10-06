declare module 'qrcode/lib/core/qrcode' {
  export { create } from 'qrcode';
}
declare module 'qrcode/lib/renderer/svg-tag' {
  import { QRCode, QRCodeToStringOptions } from 'qrcode';
  export function render(qr: QRCode, options: QRCodeToStringOptions): string;
}
