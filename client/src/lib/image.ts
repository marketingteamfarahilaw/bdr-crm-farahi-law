/** Read an image file, downscale to `max` px on the longest edge, return a PNG data URL. */
export async function fileToResizedDataUrl(file: File, max = 256): Promise<string> {
  const readDataUrl = (f: File) =>
    new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = () => rej(new Error("Could not read file"));
      fr.readAsDataURL(f);
    });
  const loadImg = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("That file isn't a valid image"));
      img.src = src;
    });

  const src = await readDataUrl(file);
  const img = await loadImg(src);
  let { width, height } = img;
  if (width > max || height > max) {
    const scale = Math.min(max / width, max / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}
