import { registerPlugin } from '@capacitor/core';
import { downloadedSong } from './download-job-state';
import { nativeDownloadRequest, authorizeNativeUpload as authorizeUpload } from './native-download-request';

export const NativeDownloads = registerPlugin('NativeDownloads');
export const nativeDownloadSong = downloadedSong;
export const authorizeNativeUpload = authorizeUpload;

export async function requestNativeDownload(route, data, method) {
  return nativeDownloadRequest(NativeDownloads, route, data, method);
}
