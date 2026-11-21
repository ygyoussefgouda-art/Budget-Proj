/** Receipt files: shrink photos on the phone before upload so they are quick and small. */
import { t } from './i18n';

export const RECEIPT_ACCEPT = 'image/*,application/pdf';
const MAX_BYTES = 6 * 1024 * 1024; // server limit
const MAX_SIDE = 1600; // px, plenty to read a receipt

export async function prepareReceipt(file: File): Promise<Blob> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error(t('That PDF is too big (max 6 MB).'));
    return file;
  }
  if (!file.type.startsWith('image/')) throw new Error(t('Receipts must be a photo or a PDF.'));
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#fff'; // transparent PNGs get a white background
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (blob && blob.size < file.size) return blob;
  } catch {
    /* the browser cannot decode it (e.g. HEIC on some phones): send the original */
  }
  if (file.size > MAX_BYTES) throw new Error(t('That photo is too big (max 6 MB).'));
  return file;
}
