export interface PreparedImage {
  source: string
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

function readFile(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer()
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Không thể đọc ảnh này.'))
    image.src = source
  })
}

async function webpToPng(file: File): Promise<{ bytes: Uint8Array; source: string }> {
  const temporaryUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(temporaryUrl)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d')?.drawImage(image, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Không thể chuyển WebP sang PNG.')), 'image/png'),
    )
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return { bytes, source: URL.createObjectURL(blob) }
  } finally {
    URL.revokeObjectURL(temporaryUrl)
  }
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const supported = ['image/png', 'image/jpeg', 'image/webp']
  if (!supported.includes(file.type)) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG và WebP.')

  const converted = file.type === 'image/webp' ? await webpToPng(file) : null
  const bytes = converted?.bytes ?? new Uint8Array(await readFile(file))
  const source = converted?.source ?? URL.createObjectURL(file)
  const image = await loadImage(source)
  return {
    source,
    bytes,
    mimeType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    width: image.naturalWidth,
    height: image.naturalHeight,
  }
}
