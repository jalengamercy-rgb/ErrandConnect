import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { api } from './api';
import type { UploadedDocument } from './types';

/** Asks for permission and returns the phone's current position. */
export async function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission is needed. You can allow it in your phone settings.');
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

/**
 * Lets the user take or choose a photo, then uploads it as a document.
 * Returns null if they cancelled.
 */
export async function pickAndUploadDocument(type: string, source: 'camera' | 'library'): Promise<UploadedDocument | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Camera permission is needed to take the photo.');
  }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const form = new FormData();
  form.append('type', type);
  if (Platform.OS === 'web') {
    // On the web the picker returns a blob: URL; send the actual file contents.
    const blob = await (await fetch(asset.uri)).blob();
    form.append('file', blob, asset.fileName ?? 'photo.jpg');
  } else {
    // React Native's FormData accepts a { uri, name, type } file reference.
    form.append('file', { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg' } as unknown as Blob);
  }
  return api.post<UploadedDocument>('/documents', form);
}
