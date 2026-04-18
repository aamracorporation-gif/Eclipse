declare module 'expo-file-system/legacy' {
  export const documentDirectory: string | null;
  export enum EncodingType {
    Base64 = 'base64',
    UTF8 = 'utf8',
  }
  export function getInfoAsync(
    fileUri: string,
    options?: Record<string, unknown>
  ): Promise<{ exists: boolean; isDirectory?: boolean; uri: string } & Record<string, unknown>>;
  export function readAsStringAsync(
    fileUri: string,
    options?: { encoding?: EncodingType }
  ): Promise<string>;
  export function writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { encoding?: EncodingType }
  ): Promise<void>;
}
