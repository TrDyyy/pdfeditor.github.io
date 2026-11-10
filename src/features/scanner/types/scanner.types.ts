export type ScanRotation = 0 | 90 | 180 | 270
export type DetectionConfidence = 'high' | 'medium' | 'low'

export interface ScanPoint { x: number; y: number }
export type ScanCorners = [ScanPoint, ScanPoint, ScanPoint, ScanPoint]

export interface ScanSettings {
  corners: ScanCorners
  rotation: ScanRotation
  filter: 'original' | 'document' | 'grayscale' | 'black-white'
  brightness: number
  contrast: number
  sharpen: number
  threshold: number
}

export interface ScannerPage {
  id: string
  sourceAssetId: string
  originalWidth: number
  originalHeight: number
  settings: ScanSettings
  order: number
}

export interface ScannerDocument {
  id: string
  name: string
  pages: ScannerPage[]
  createdAt: string
  updatedAt: string
}

export interface ScannerAsset {
  id: string
  file: File
  sourceUrl: string
  image: HTMLImageElement
}

export interface DetectionResult {
  corners: ScanCorners
  confidence: DetectionConfidence
  areaRatio: number
}
