<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef } from 'vue'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import PdfPage from './components/PdfPage.vue'
import SignatureDialog from './components/SignatureDialog.vue'
import { prepareImage } from './imageFiles'
import { exportPdf } from './pdfExport'
import type { BinaryAsset, GraphicKind, GraphicObject, OverlayImage, PageModel, TextObject } from './types'

GlobalWorkerOptions.workerSrc = workerUrl
const ScannerWorkspace = defineAsyncComponent(() => import('./features/scanner/components/ScannerWorkspace.vue'))

const pdfInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const sourcePdf = ref<ArrayBuffer | null>(null)
const originalName = ref('document.pdf')
// Keep PDFPageProxy instances out of Vue's deep proxying; they contain private
// class fields that must retain their original identity.
const pages = shallowRef<PageModel[]>([])
const activePageIndex = ref(0)
const selectedId = ref<string | null>(null)
const cropMode = ref(false)
const editingTextId = ref<string | null>(null)
const signatureOpen = ref(false)
const assets = shallowRef(new Map<string, BinaryAsset>())
const whiteoutWarning = ref(false)
const zoom = ref(1.2)
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const routeHash = ref(globalThis.location.hash)
const scannerMode = computed(() => routeHash.value === '#/scanner')
const hasPdf = computed(() => pages.value.length > 0)
const overlayCount = computed(() => pages.value.reduce((sum, page) => sum + page.overlays.length, 0))
const selectedOverlay = computed(() => {
  for (let pageIndex = 0; pageIndex < pages.value.length; pageIndex += 1) {
    const overlay = pages.value[pageIndex].overlays.find((item) => item.id === selectedId.value)
    if (overlay) return { overlay, pageIndex }
  }
  return null
})
const selectedText = computed(() => {
  for (let pageIndex = 0; pageIndex < pages.value.length; pageIndex += 1) {
    const text = pages.value[pageIndex].texts.find((item) => item.id === selectedId.value)
    if (text) return { text, pageIndex }
  }
  return null
})
const selectedGraphic = computed(() => {
  for (let pageIndex = 0; pageIndex < pages.value.length; pageIndex += 1) {
    const graphic = pages.value[pageIndex].graphics.find((item) => item.id === selectedId.value)
    if (graphic) return { graphic, pageIndex }
  }
  return null
})

function closeToolMenus() {
  document.querySelectorAll<HTMLDetailsElement>('.tool-menu[open]').forEach((menu) => { menu.open = false })
}

function onGlobalPointerDown(event: PointerEvent) {
  if (!(event.target as HTMLElement).closest('.tool-menu')) closeToolMenus()
}

function openScanner() { globalThis.location.hash = '/scanner' }
function closeScanner() { globalThis.location.hash = '' }
function onHashChange() { routeHash.value = globalThis.location.hash }

function releaseImages() {
  for (const page of pages.value) {
    for (const overlay of page.overlays) URL.revokeObjectURL(overlay.source)
  }
}

function releaseAssets() {
  for (const asset of assets.value.values()) URL.revokeObjectURL(asset.source)
  assets.value = new Map()
}

async function loadPdf(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    error.value = 'Vui lòng chọn một file PDF.'
    return
  }

  loading.value = true
  error.value = ''
  try {
    const buffer = await file.arrayBuffer()
    const loadingTask = getDocument({ data: new Uint8Array(buffer.slice(0)) })
    const document = await loadingTask.promise
    const nextPages: PageModel[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      nextPages.push({
        page,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
        overlays: [],
        texts: [],
        graphics: [],
      })
    }
    releaseImages()
    releaseAssets()
    sourcePdf.value = buffer
    originalName.value = file.name
    pages.value = nextPages
    activePageIndex.value = 0
    selectedId.value = null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Không thể mở PDF này.'
  } finally {
    loading.value = false
  }
}

function addGraphic(kind: Exclude<GraphicKind, 'signature'>, label?: 'APPROVED' | 'DRAFT' | 'CONFIDENTIAL' | 'REVIEWED') {
  closeToolMenus()
  const pageIndex = activePageIndex.value
  const page = pages.value[pageIndex]
  if (!page) return
  const base = { id: crypto.randomUUID(), x: page.width * 0.25, y: page.height * 0.25, width: 180, height: 80, rotation: 0, opacity: kind === 'highlight' ? 0.35 : 1 }
  let graphic: GraphicObject
  if (kind === 'whiteout') {
    graphic = { ...base, kind }
    whiteoutWarning.value = true
  } else if (kind === 'stamp') {
    graphic = { ...base, kind, label: label ?? 'APPROVED', color: label === 'DRAFT' ? '#666666' : '#c9362b' }
  } else if (kind === 'highlight') {
    graphic = { ...base, kind, color: '#ffea61', height: 34 }
  } else {
    graphic = { ...base, kind, fill: kind === 'line' || kind === 'arrow' ? 'transparent' : '#ffffff00', stroke: '#d64535', strokeWidth: 3, height: kind === 'line' || kind === 'arrow' ? 2 : 100 }
  }
  pages.value = pages.value.map((item, index) => index === pageIndex ? { ...item, graphics: [...item.graphics, graphic] } : item)
  selectedId.value = graphic.id
  cropMode.value = false
}

async function insertSignature(blob: Blob, name: string) {
  const prepared = await prepareImage(new File([blob], name, { type: blob.type || 'image/png' }))
  const assetId = crypto.randomUUID()
  const asset: BinaryAsset = { id: assetId, name, source: prepared.source, bytes: prepared.bytes, mimeType: prepared.mimeType, width: prepared.width, height: prepared.height }
  assets.value = new Map(assets.value).set(assetId, asset)
  const pageIndex = activePageIndex.value
  const page = pages.value[pageIndex]
  const width = Math.min(220, page.width * 0.4)
  const graphic: GraphicObject = { id: crypto.randomUUID(), kind: 'signature', assetId, x: (page.width - width) / 2, y: page.height * 0.3, width, height: width * prepared.height / prepared.width, rotation: 0, opacity: 1 }
  pages.value = pages.value.map((item, index) => index === pageIndex ? { ...item, graphics: [...item.graphics, graphic] } : item)
  selectedId.value = graphic.id
  signatureOpen.value = false
}

function updateGraphic(pageIndex: number, updated: GraphicObject) {
  pages.value = pages.value.map((page, index) => index === pageIndex ? { ...page, graphics: page.graphics.map((item) => item.id === updated.id ? updated : item) } : page)
}

function patchSelectedGraphic(patch: Partial<GraphicObject>) {
  if (!selectedGraphic.value) return
  updateGraphic(selectedGraphic.value.pageIndex, { ...selectedGraphic.value.graphic, ...patch } as GraphicObject)
}

function duplicateGraphic() {
  if (!selectedGraphic.value) return
  const { graphic, pageIndex } = selectedGraphic.value
  const duplicate = { ...graphic, id: crypto.randomUUID(), x: graphic.x + 15, y: graphic.y + 15 } as GraphicObject
  pages.value = pages.value.map((page, index) => index === pageIndex ? { ...page, graphics: [...page.graphics, duplicate] } : page)
  selectedId.value = duplicate.id
}

function addText() {
  const pageIndex = activePageIndex.value
  const page = pages.value[pageIndex]
  if (!page) return
  const text: TextObject = {
    id: crypto.randomUUID(),
    text: 'Nhập văn bản',
    x: page.width * 0.2,
    y: page.height * 0.2,
    width: Math.min(280, page.width * 0.6),
    height: 60,
    rotation: 0,
    fontFamily: 'Be Vietnam Pro',
    fontSize: 18,
    color: '#111111',
    bold: false,
    italic: false,
    align: 'left',
    lineHeight: 1.25,
  }
  pages.value = pages.value.map((item, index) => index === pageIndex ? { ...item, texts: [...item.texts, text] } : item)
  selectedId.value = text.id
  editingTextId.value = text.id
  cropMode.value = false
}

function updateText(pageIndex: number, updated: TextObject) {
  pages.value = pages.value.map((page, index) => index === pageIndex
    ? { ...page, texts: page.texts.map((item) => item.id === updated.id ? updated : item) }
    : page)
}

function patchSelectedText(patch: Partial<TextObject>) {
  if (!selectedText.value) return
  const current = selectedText.value.text
  const updated = { ...current, ...patch }
  if (patch.fontSize !== undefined || patch.lineHeight !== undefined || patch.text !== undefined) {
    const explicitLines = Math.max(1, updated.text.split('\n').length)
    const approximateCharactersPerLine = Math.max(1, Math.floor(updated.width / (updated.fontSize * 0.58)))
    const wrappedLines = updated.text.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / approximateCharactersPerLine)), 0)
    updated.height = Math.max(updated.height, Math.max(explicitLines, wrappedLines) * updated.fontSize * updated.lineHeight + 8)
  }
  updateText(selectedText.value.pageIndex, updated)
}

function duplicateText() {
  if (!selectedText.value) return
  const { text, pageIndex } = selectedText.value
  const duplicate = { ...text, id: crypto.randomUUID(), x: text.x + 15, y: text.y + 15 }
  pages.value = pages.value.map((page, index) => index === pageIndex ? { ...page, texts: [...page.texts, duplicate] } : page)
  selectedId.value = duplicate.id
}

async function addImage(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || !pages.value[activePageIndex.value]) return
  error.value = ''

  try {
    for (const file of files) {
      const prepared = await prepareImage(file)
      const pageIndex = activePageIndex.value
      const page = pages.value[pageIndex]
      const maxWidth = page.width * 0.35
      const maxHeight = page.height * 0.35
      const scale = Math.min(maxWidth / prepared.width, maxHeight / prepared.height, 1)
      const width = prepared.width * scale
      const height = prepared.height * scale
      const overlay: OverlayImage = {
        id: crypto.randomUUID(),
        name: file.name,
        source: prepared.source,
        bytes: prepared.bytes,
        mimeType: prepared.mimeType,
        naturalWidth: prepared.width,
        naturalHeight: prepared.height,
        cropX: 0,
        cropY: 0,
        cropWidth: prepared.width,
        cropHeight: prepared.height,
        x: (page.width - width) / 2,
        y: (page.height - height) / 2,
        width,
        height,
        rotation: 0,
        opacity: 1,
      }
      pages.value = pages.value.map((item, index) => index === pageIndex
        ? { ...item, overlays: [...item.overlays, overlay] }
        : item)
      selectedId.value = overlay.id
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Không thể thêm ảnh.'
  }
}

function updateOverlay(pageIndex: number, updated: OverlayImage) {
  pages.value = pages.value.map((page, index) => index === pageIndex
    ? { ...page, overlays: page.overlays.map((item) => item.id === updated.id ? updated : item) }
    : page)
}

function moveOverlayToPage(fromPageIndex: number, overlay: OverlayImage, clientX: number, clientY: number) {
  const surfaces = Array.from(document.querySelectorAll<HTMLElement>('.page-surface'))
  const targetPageIndex = surfaces.findIndex((surface) => {
    const rect = surface.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  })
  if (targetPageIndex < 0 || targetPageIndex === fromPageIndex) {
    updateOverlay(fromPageIndex, overlay)
    return
  }
  const rect = surfaces[targetPageIndex].getBoundingClientRect()
  const sourceRect = surfaces[fromPageIndex].getBoundingClientRect()
  const moved = {
    ...overlay,
    x: (sourceRect.left + overlay.x * zoom.value - rect.left) / zoom.value,
    y: (sourceRect.top + overlay.y * zoom.value - rect.top) / zoom.value,
  }
  pages.value = pages.value.map((page, index) => {
    if (index === fromPageIndex) return { ...page, overlays: page.overlays.filter((item) => item.id !== overlay.id) }
    if (index === targetPageIndex) return { ...page, overlays: [...page.overlays, moved] }
    return page
  })
  activePageIndex.value = targetPageIndex
}

function setDimension(axis: 'width' | 'height', rawValue: string) {
  const selected = selectedOverlay.value
  const value = Number(rawValue)
  if (!selected || !Number.isFinite(value) || value < 8) return
  const overlay = selected.overlay
  const ratio = overlay.width / overlay.height
  updateOverlay(selected.pageIndex, axis === 'width'
    ? { ...overlay, width: value, height: value / ratio }
    : { ...overlay, height: value, width: value * ratio })
}

function cropPercent(overlay: OverlayImage, edge: 'left' | 'right' | 'top' | 'bottom') {
  if (edge === 'left') return Math.round((overlay.cropX / overlay.naturalWidth) * 100)
  if (edge === 'right') return Math.round(((overlay.naturalWidth - overlay.cropX - overlay.cropWidth) / overlay.naturalWidth) * 100)
  if (edge === 'top') return Math.round((overlay.cropY / overlay.naturalHeight) * 100)
  return Math.round(((overlay.naturalHeight - overlay.cropY - overlay.cropHeight) / overlay.naturalHeight) * 100)
}

function setCrop(edge: 'left' | 'right' | 'top' | 'bottom', rawValue: string) {
  const selected = selectedOverlay.value
  if (!selected) return
  const overlay = selected.overlay
  const requested = Math.max(0, Math.min(90, Number(rawValue))) / 100
  const old = { x: overlay.cropX, y: overlay.cropY, width: overlay.cropWidth, height: overlay.cropHeight }
  let cropX = old.x
  let cropY = old.y
  let cropWidth = old.width
  let cropHeight = old.height
  if (edge === 'left') {
    cropX = Math.min(overlay.naturalWidth * requested, old.x + old.width - overlay.naturalWidth * 0.05)
    cropWidth = overlay.naturalWidth - cropX - (overlay.naturalWidth - old.x - old.width)
  } else if (edge === 'right') {
    const right = Math.min(overlay.naturalWidth * requested, overlay.naturalWidth - old.x - overlay.naturalWidth * 0.05)
    cropWidth = overlay.naturalWidth - old.x - right
  } else if (edge === 'top') {
    cropY = Math.min(overlay.naturalHeight * requested, old.y + old.height - overlay.naturalHeight * 0.05)
    cropHeight = overlay.naturalHeight - cropY - (overlay.naturalHeight - old.y - old.height)
  } else {
    const bottom = Math.min(overlay.naturalHeight * requested, overlay.naturalHeight - old.y - overlay.naturalHeight * 0.05)
    cropHeight = overlay.naturalHeight - old.y - bottom
  }

  const scaleX = overlay.width / old.width
  const scaleY = overlay.height / old.height
  const localShiftX = (cropX - old.x) * scaleX
  const localShiftY = (cropY - old.y) * scaleY
  const radians = (overlay.rotation * Math.PI) / 180
  const shiftX = localShiftX * Math.cos(radians) - localShiftY * Math.sin(radians)
  const shiftY = localShiftX * Math.sin(radians) + localShiftY * Math.cos(radians)
  updateOverlay(selected.pageIndex, {
    ...overlay,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    x: overlay.x + shiftX,
    y: overlay.y + shiftY,
    width: cropWidth * scaleX,
    height: cropHeight * scaleY,
  })
}

function resetCrop() {
  const selected = selectedOverlay.value
  if (!selected) return
  const overlay = selected.overlay
  const scaleX = overlay.width / overlay.cropWidth
  const scaleY = overlay.height / overlay.cropHeight
  const localShiftX = -overlay.cropX * scaleX
  const localShiftY = -overlay.cropY * scaleY
  const radians = (overlay.rotation * Math.PI) / 180
  updateOverlay(selected.pageIndex, {
    ...overlay,
    cropX: 0,
    cropY: 0,
    cropWidth: overlay.naturalWidth,
    cropHeight: overlay.naturalHeight,
    x: overlay.x + localShiftX * Math.cos(radians) - localShiftY * Math.sin(radians),
    y: overlay.y + localShiftX * Math.sin(radians) + localShiftY * Math.cos(radians),
    width: overlay.naturalWidth * scaleX,
    height: overlay.naturalHeight * scaleY,
  })
}

function deleteSelected() {
  if (!selectedId.value) return
  for (const page of pages.value) {
    const index = page.overlays.findIndex((overlay) => overlay.id === selectedId.value)
    if (index >= 0) {
      URL.revokeObjectURL(page.overlays[index].source)
      pages.value = pages.value.map((item) => item === page
        ? { ...item, overlays: item.overlays.filter((_, overlayIndex) => overlayIndex !== index) }
        : item)
      break
    }
  }
  for (const page of pages.value) {
    const index = page.graphics.findIndex((graphic) => graphic.id === selectedId.value)
    if (index >= 0) {
      pages.value = pages.value.map((item) => item === page ? { ...item, graphics: item.graphics.filter((_, i) => i !== index) } : item)
      break
    }
  }
  for (const page of pages.value) {
    const index = page.texts.findIndex((text) => text.id === selectedId.value)
    if (index >= 0) {
      pages.value = pages.value.map((item) => item === page ? { ...item, texts: item.texts.filter((_, i) => i !== index) } : item)
      break
    }
  }
  selectedId.value = null
  editingTextId.value = null
}

function selectPage(index: number) {
  activePageIndex.value = index
  selectedId.value = null
  cropMode.value = false
  document.querySelector(`[data-page="${index + 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function zoomBy(delta: number) {
  zoom.value = Math.min(2, Math.max(0.5, Number((zoom.value + delta).toFixed(2))))
}

async function downloadPdf() {
  if (!sourcePdf.value) return
  exporting.value = true
  error.value = ''
  try {
    const bytes = await exportPdf(sourcePdf.value, pages.value, assets.value)
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stem = originalName.value.replace(/\.pdf$/i, '')
    link.href = url
    link.download = `${stem}-edited.pdf`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Không thể xuất PDF.'
  } finally {
    exporting.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeToolMenus()
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId.value) {
    event.preventDefault()
    deleteSelected()
  }
}

window.addEventListener('keydown', onKeydown)
window.addEventListener('pointerdown', onGlobalPointerDown)
window.addEventListener('hashchange', onHashChange)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', onGlobalPointerDown)
  window.removeEventListener('hashchange', onHashChange)
  releaseImages()
  releaseAssets()
})
</script>

<template>
  <div class="app-shell">
    <header v-if="!scannerMode" class="topbar">
      <div class="brand">
        <span class="brand-mark">P</span>
        <div><strong>PDF Studio</strong><small>Image overlay editor</small></div>
      </div>
      <div class="top-actions">
        <button class="button ghost" @click="openScanner">Scan tài liệu</button>
        <button class="button ghost" @click="pdfInput?.click()">{{ hasPdf ? 'Đổi PDF' : 'Mở PDF' }}</button>
        <button class="button primary" :disabled="!hasPdf || exporting" @click="downloadPdf">
          {{ exporting ? 'Đang xuất…' : 'Tải PDF' }}
        </button>
      </div>
    </header>

    <input ref="pdfInput" class="visually-hidden" type="file" accept="application/pdf,.pdf" @change="loadPdf" />
    <input ref="imageInput" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple @change="addImage" />

    <ScannerWorkspace v-if="scannerMode" @back="closeScanner" />

    <main v-else-if="hasPdf" class="workspace">
      <aside class="sidebar">
        <div class="sidebar-heading"><span>Trang</span><span>{{ pages.length }}</span></div>
        <button
          v-for="(_, index) in pages"
          :key="index"
          class="page-chip"
          :class="{ active: activePageIndex === index }"
          @click="selectPage(index)"
        >
          <span class="paper-icon">{{ index + 1 }}</span>
          <span>Trang {{ index + 1 }}</span>
        </button>
      </aside>

      <section class="editor">
        <div class="toolbar">
          <button class="button add-image" @click="imageInput?.click()"><span>＋</span> Thêm ảnh</button>
          <button class="button add-text" @click="addText"><span>T</span> Thêm chữ</button>
          <button class="button tool-button" @click="signatureOpen = true">✍ Chữ ký</button>
          <details class="tool-menu"><summary>Hình dạng</summary><div><button @click="addGraphic('rectangle')">▭ Chữ nhật</button><button @click="addGraphic('ellipse')">◯ Elip</button><button @click="addGraphic('line')">― Đường thẳng</button><button @click="addGraphic('arrow')">→ Mũi tên</button></div></details>
          <button class="button tool-button" @click="addGraphic('whiteout')">▱ Che trắng</button>
          <details class="tool-menu"><summary>Con dấu</summary><div><button v-for="stamp in (['APPROVED', 'DRAFT', 'CONFIDENTIAL', 'REVIEWED'] as const)" :key="stamp" @click="addGraphic('stamp', stamp)">{{ stamp }}</button><button @click="closeToolMenus(); imageInput?.click()">Ảnh con dấu tùy chỉnh…</button></div></details>
          <button class="button tool-button" @click="addGraphic('highlight')">▰ Tô sáng</button>
          <div class="toolbar-divider" />
          <button class="icon-button" title="Thu nhỏ" @click="zoomBy(-0.1)">−</button>
          <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
          <button class="icon-button" title="Phóng to" @click="zoomBy(0.1)">＋</button>
          <div class="toolbar-spacer" />
          <span class="status-text">{{ overlayCount }} ảnh</span>
          <button v-if="selectedText" class="button crop-button" @click="duplicateText">Nhân đôi</button>
          <button v-if="selectedGraphic" class="button crop-button" @click="duplicateGraphic">Nhân đôi</button>
          <button v-if="selectedOverlay" class="button crop-button" :class="{ active: cropMode }" @click="cropMode = !cropMode">
            {{ cropMode ? 'Xong cắt ảnh' : 'Cắt ảnh' }}
          </button>
          <button class="button danger" :disabled="!selectedId" @click="deleteSelected">Xóa</button>
        </div>
        <div v-if="error" class="error-banner">{{ error }}</div>
        <div v-if="whiteoutWarning" class="whiteout-warning"><strong>Lưu ý:</strong> Che trắng chỉ che trực quan, không xóa an toàn nội dung gốc. Văn bản bên dưới vẫn có thể tìm kiếm, chọn hoặc khôi phục.<button @click="whiteoutWarning = false">×</button></div>
        <div v-if="selectedGraphic" class="graphic-inspector">
          <strong>{{ { signature: 'Chữ ký', rectangle: 'Chữ nhật', ellipse: 'Elip', line: 'Đường thẳng', arrow: 'Mũi tên', whiteout: 'Che trắng', stamp: 'Con dấu', highlight: 'Tô sáng' }[selectedGraphic.graphic.kind] }}</strong>
          <label>Độ mờ <input type="range" min="0.1" max="1" step="0.05" :value="selectedGraphic.graphic.opacity" @input="patchSelectedGraphic({ opacity: Number(($event.target as HTMLInputElement).value) })" /><span>{{ Math.round(selectedGraphic.graphic.opacity * 100) }}%</span></label>
          <template v-if="'stroke' in selectedGraphic.graphic"><label>Nét <input type="color" :value="selectedGraphic.graphic.stroke" @change="patchSelectedGraphic({ stroke: ($event.target as HTMLInputElement).value } as Partial<GraphicObject>)" /></label><label>Độ dày <input type="number" min="1" max="30" :value="selectedGraphic.graphic.strokeWidth" @change="patchSelectedGraphic({ strokeWidth: Number(($event.target as HTMLInputElement).value) } as Partial<GraphicObject>)" /></label><label v-if="selectedGraphic.graphic.kind === 'rectangle' || selectedGraphic.graphic.kind === 'ellipse'">Nền <input type="color" :value="selectedGraphic.graphic.fill === 'transparent' ? '#ffffff' : selectedGraphic.graphic.fill.slice(0, 7)" @change="patchSelectedGraphic({ fill: ($event.target as HTMLInputElement).value } as Partial<GraphicObject>)" /></label></template>
          <template v-if="'color' in selectedGraphic.graphic"><label>Màu <input type="color" :value="selectedGraphic.graphic.color" @change="patchSelectedGraphic({ color: ($event.target as HTMLInputElement).value } as Partial<GraphicObject>)" /></label></template>
        </div>
        <div v-if="selectedText" class="text-inspector">
          <select :value="selectedText.text.fontFamily" @change="patchSelectedText({ fontFamily: ($event.target as HTMLSelectElement).value as TextObject['fontFamily'] })">
            <option>Be Vietnam Pro</option><option>DejaVu Sans</option><option>Times New Roman</option>
          </select>
          <label>Cỡ <input type="number" min="6" max="144" :value="selectedText.text.fontSize" @change="patchSelectedText({ fontSize: Number(($event.target as HTMLInputElement).value) })" /></label>
          <input class="color-input" type="color" :value="selectedText.text.color" @change="patchSelectedText({ color: ($event.target as HTMLInputElement).value })" />
          <button class="format-button" :class="{ active: selectedText.text.bold }" @click="patchSelectedText({ bold: !selectedText.text.bold })"><b>B</b></button>
          <button class="format-button" :class="{ active: selectedText.text.italic }" @click="patchSelectedText({ italic: !selectedText.text.italic })"><i>I</i></button>
          <button v-for="align in (['left', 'center', 'right'] as const)" :key="align" class="format-button" :class="{ active: selectedText.text.align === align }" @click="patchSelectedText({ align })">{{ { left: '≡', center: '≣', right: '☰' }[align] }}</button>
          <label>Dòng <input type="number" min="0.8" max="3" step="0.1" :value="selectedText.text.lineHeight" @change="patchSelectedText({ lineHeight: Number(($event.target as HTMLInputElement).value) })" /></label>
          <span class="edit-hint">Double-click để sửa nội dung</span>
        </div>
        <div v-if="selectedOverlay" class="image-inspector">
          <div class="size-fields">
            <label>Rộng <input type="number" min="8" :value="Math.round(selectedOverlay.overlay.width)" @change="setDimension('width', ($event.target as HTMLInputElement).value)" /></label>
            <span class="lock-mark" title="Luôn giữ tỷ lệ">🔒</span>
            <label>Cao <input type="number" min="8" :value="Math.round(selectedOverlay.overlay.height)" @change="setDimension('height', ($event.target as HTMLInputElement).value)" /></label>
          </div>
          <label class="image-opacity">Độ mờ <input type="range" min="0.1" max="1" step="0.05" :value="selectedOverlay.overlay.opacity" @input="updateOverlay(selectedOverlay.pageIndex, { ...selectedOverlay.overlay, opacity: Number(($event.target as HTMLInputElement).value) })" /></label>
          <div class="crop-fields">
            <strong>Cắt xén (%)</strong>
            <label v-for="edge in (['left', 'right', 'top', 'bottom'] as const)" :key="edge">
              {{ { left: 'Trái', right: 'Phải', top: 'Trên', bottom: 'Dưới' }[edge] }}
              <input type="range" min="0" max="90" :value="cropPercent(selectedOverlay.overlay, edge)" @input="setCrop(edge, ($event.target as HTMLInputElement).value)" />
              <span>{{ cropPercent(selectedOverlay.overlay, edge) }}</span>
            </label>
            <button class="button crop-reset" @click="resetCrop">Đặt lại cắt xén</button>
          </div>
        </div>
        <div class="document-scroll">
          <PdfPage
            v-for="(page, index) in pages"
            :key="index"
            :model="page"
            :page-number="index + 1"
            :zoom="zoom"
            :selected-id="selectedId"
            :crop-mode="cropMode && selectedId !== null"
            :editing-text-id="editingTextId"
            :assets="assets"
            @select="(id) => { activePageIndex = index; selectedId = id; if (!id) { cropMode = false; editingTextId = null } }"
            @edit-text="(id) => { selectedId = id; editingTextId = id; cropMode = false }"
            @finish-edit="editingTextId = null"
            @toggle-crop="() => { cropMode = !cropMode }"
            @change="(overlay) => updateOverlay(index, overlay)"
            @text-change="(text) => updateText(index, text)"
            @graphic-change="(graphic) => updateGraphic(index, graphic)"
            @drop-page="(overlay, clientX, clientY) => moveOverlayToPage(index, overlay, clientX, clientY)"
          />
        </div>
      </section>
    </main>

    <main v-else class="welcome">
      <div class="welcome-card" :class="{ loading }">
        <span class="eyebrow">PHASE 1</span>
        <h1>Đặt ảnh lên PDF.<br /><em>Đúng chỗ, đúng nét.</em></h1>
        <p>Chèn chữ ký, con dấu hoặc hình ảnh mà không làm phẳng nội dung PDF gốc.</p>
        <button class="button primary upload-button" :disabled="loading" @click="pdfInput?.click()">
          {{ loading ? 'Đang mở PDF…' : 'Chọn file PDF' }}
        </button>
        <p class="file-note">PDF nhiều trang · xử lý hoàn toàn trên trình duyệt</p>
        <div v-if="error" class="error-banner">{{ error }}</div>
      </div>
    </main>
    <SignatureDialog v-if="signatureOpen && !scannerMode" @close="signatureOpen = false" @insert="insertSignature" />
  </div>
</template>
