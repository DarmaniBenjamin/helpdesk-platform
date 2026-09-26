// Helpers for profile photos

// Biggest file someone can pick (before it's shrunk)
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

// Takes a picked image file, crops it to a square from the middle and
// shrinks it to size x size pixels. Returns it as text (a "data URL")
// that can go straight into an <img src>. Small photos keep the app fast,
// and later this is what gets uploaded to the server.
export function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas.getContext("2d").drawImage(
        img,
        (img.width - side) / 2, // start from the middle
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be opened as an image."));
    };

    img.src = url;
  });
}
