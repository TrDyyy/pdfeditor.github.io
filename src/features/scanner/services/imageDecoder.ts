import type { ScannerAsset } from '../types/scanner.types'

const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp']

export async function decodeScanImage(file: File): Promise<ScannerAsset> {
  if (!SUPPORTED.includes(file.type)) throw new Error('Chỉ hỗ trợ ảnh JPG, PNG và WebP.')
  if (file.size > 35 * 1024 * 1024) throw new Error('Ảnh vượt quá giới hạn 35 MB.')
  const sourceUrl = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Không thể giải mã ảnh.'))
      image.src = sourceUrl
    })
    if (image.naturalWidth < 200 || image.naturalHeight < 200) throw new Error('Ảnh quá nhỏ để nhận diện tài liệu đáng tin cậy.')
    return { id: crypto.randomUUID(), file, sourceUrl, image }
  } catch (error) {
    URL.revokeObjectURL(sourceUrl)
    throw error
  }
}
