// The production form renders a native HTML date input on web. Mobile pickers
// are excluded from this browser-only harness, and verified by the Expo export.
export default function DateTimePicker(){return null;}
export const DateTimePickerAndroid={open(){throw Error('Android-only picker in web preview');}};
