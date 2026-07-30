function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('image_encode_failed'))),
      type,
      quality,
    );
  });
}

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw(context, ...args) {
        context.drawImage(bitmap, ...args);
      },
      close() {
        bitmap.close();
      },
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  await image.decode();
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw(context, ...args) {
      context.drawImage(image, ...args);
    },
    close() {
      URL.revokeObjectURL(objectUrl);
    },
  };
}

export async function compressImage(file, { maxSize = 1200, quality = 0.8 } = {}) {
  if (!(file instanceof Blob) || !file.type.startsWith('image/')) {
    throw new TypeError('invalid_image');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new RangeError('image_too_large');
  }

  const source = await loadImage(file);
  try {
    const cropSize = Math.min(source.width, source.height);
    const sourceX = Math.round((source.width - cropSize) / 2);
    const sourceY = Math.round((source.height - cropSize) / 2);
    const outputSize = Math.min(maxSize, cropSize);
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;

    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputSize, outputSize);
    source.draw(
      context,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      outputSize,
      outputSize,
    );

    const blob = await canvasToBlob(canvas, 'image/webp', quality);
    return {
      kind: 'local',
      dataUrl: await blobToDataUrl(blob),
      type: 'image/webp',
      name: `${(file.name || 'prodotto').replace(/\.[^.]+$/, '')}.webp`,
      width: outputSize,
      height: outputSize,
      size: blob.size,
    };
  } finally {
    source.close();
  }
}

export function dataUrlToBlob(dataUrl) {
  const [meta, encoded] = String(dataUrl).split(',');
  const mime = meta?.match(/^data:([^;]+);base64$/)?.[1];
  if (!mime || !encoded) throw new TypeError('invalid_data_url');

  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}
