// Shared by every "upload a photo" form in the app (Settings' own profile card,
// team/page.tsx's edit-a-member form) - this app has no file storage (see
// server/services/user.service.ts's own comment), so a chosen photo is resized/compressed
// client-side into a small data: URI, which becomes the value actually stored.

const MAX_AVATAR_DIMENSION = 256;

/** Reads an image file, downsizes it to at most `MAX_AVATAR_DIMENSION` on its longest edge, and
 *  re-encodes it as a JPEG data URI - plenty for an avatar shown at a few dozen px across, and
 *  comfortably under the server's own sanity cap on how large that column's value can be. */
export function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That does not look like an image.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process that image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
