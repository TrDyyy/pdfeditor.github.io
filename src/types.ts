import type { PDFPageProxy } from 'pdfjs-dist'

export interface OverlayImage {
  id: string
  name: string
  source: string
  mimeType: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
  naturalWidth: number
  naturalHeight: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export type TextAlign = 'left' | 'center' | 'right'
export type FontFamily = 'Be Vietnam Pro' | 'DejaVu Sans' | 'Times New Roman'

export interface TextObject {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fontFamily: FontFamily
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
  align: TextAlign
  lineHeight: number
}

export type GraphicKind = 'signature' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'whiteout' | 'stamp' | 'highlight'

interface GraphicBase {
  id: string
  kind: GraphicKind
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export interface SignatureGraphic extends GraphicBase {
  kind: 'signature'
  assetId: string
}

export interface ShapeGraphic extends GraphicBase {
  kind: 'rectangle' | 'ellipse' | 'line' | 'arrow'
  fill: string
  stroke: string
  strokeWidth: number
}

export interface WhiteoutGraphic extends GraphicBase {
  kind: 'whiteout'
}

export interface StampGraphic extends GraphicBase {
  kind: 'stamp'
  label: 'APPROVED' | 'DRAFT' | 'CONFIDENTIAL' | 'REVIEWED'
  color: string
}

export interface HighlightGraphic extends GraphicBase {
  kind: 'highlight'
  color: string
}

export type GraphicObject = SignatureGraphic | ShapeGraphic | WhiteoutGraphic | StampGraphic | HighlightGraphic

export interface BinaryAsset {
  id: string
  name: string
  source: string
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

export interface PageModel {
  page: PDFPageProxy
  width: number
  height: number
  rotation: number
  overlays: OverlayImage[]
  texts: TextObject[]
  graphics: GraphicObject[]
}
