// Read a File/Blob as a base64 data URL. Shared by every upload handler (the reframe/
// inpaint/upscale/edit source pickers + the reference-image picker) so the FileReader
// boilerplate lives in one place.
export const readFileAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
