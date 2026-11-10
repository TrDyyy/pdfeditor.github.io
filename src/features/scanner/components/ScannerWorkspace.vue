<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import CornerCropEditor from './CornerCropEditor.vue'
import { decodeScanImage } from '../services/imageDecoder'
import { detectDocument } from '../services/documentDetector'
import { disposeScannerWorker } from '../services/scannerWorkerClient'
import { renderPerspective } from '../services/perspectiveTransform'
import { exportScan } from '../services/scannerExport'
import { defaultCorners } from '../composables/useCropSelection'
import type { DetectionResult, ScannerAsset, ScannerDocument, ScannerPage, ScanRotation } from '../types/scanner.types'
import type { ScanExportFormat, ScanPageSize, ScanQuality } from '../services/scannerExport'

defineEmits<{ back: [] }>()
const input = ref<HTMLInputElement | null>(null)
const outputCanvas = ref<HTMLCanvasElement | null>(null)
const asset = ref<ScannerAsset | null>(null)
const page = ref<ScannerPage | null>(null)
const documentModel = ref<ScannerDocument | null>(null)
const detection = ref<DetectionResult | null>(null)
const busy = ref(false)
const dragging = ref(false)
const error = ref('')
const note = ref('')
const hasPreview = ref(false)
const exporting = ref(false)
const exportQuality = ref<ScanQuality>('standard')
const exportPageSize = ref<ScanPageSize>('a4')
const rotation = computed(() => page.value?.settings.rotation ?? 0)

async function receiveFiles(files: FileList | File[]) {
  const file = Array.from(files)[0]
  if (!file) return
  busy.value = true; error.value = ''; note.value = ''; hasPreview.value = false
  if (asset.value) URL.revokeObjectURL(asset.value.sourceUrl)
  try {
    const decoded = await decodeScanImage(file)
    asset.value = decoded
    const now = new Date().toISOString()
    const scanPage: ScannerPage = {
      id: crypto.randomUUID(), sourceAssetId: decoded.id, originalWidth: decoded.image.naturalWidth, originalHeight: decoded.image.naturalHeight, order: 0,
      settings: { corners: defaultCorners(decoded.image.naturalWidth, decoded.image.naturalHeight), rotation: 0, filter: 'original', brightness: 0, contrast: 0, sharpen: 0, threshold: 128 },
    }
    page.value = scanPage
    documentModel.value = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), pages: [scanPage], createdAt: now, updatedAt: now }
    await autoDetect()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Không thể mở ảnh.'
  } finally { busy.value = false }
}

function chooseImage() {
  input.value?.click()
}

function onFileChange(event: Event) {
  const element = event.target as HTMLInputElement
  const files = element.files ? Array.from(element.files) : []
  element.value = ''
  void receiveFiles(files)
}

async function autoDetect() {
  if (!asset.value || !page.value) return
  busy.value = true; error.value = ''; note.value = 'Đang tìm mép giấy…'
  try {
    detection.value = await detectDocument(asset.value.image)
    page.value = { ...page.value, settings: { ...page.value.settings, corners: detection.value.corners } }
    note.value = detection.value.confidence === 'low'
      ? 'Không tìm thấy mép giấy đủ tin cậy. Hãy chỉnh bốn góc thủ công rồi cập nhật preview.'
      : `Đã phát hiện tài liệu — độ tin cậy ${detection.value.confidence === 'high' ? 'cao' : 'trung bình'}. Kiểm tra bốn góc rồi cập nhật preview.`
    await nextTick()
    await updatePreview(false)
  } catch (cause) {
    detection.value = { corners: page.value.settings.corners, confidence: 'low', areaRatio: 0 }
    error.value = cause instanceof Error ? cause.message : 'Không thể nhận diện ảnh.'
    note.value = 'Bạn vẫn có thể kéo bốn góc để crop thủ công.'
  } finally { busy.value = false }
}

async function updatePreview(showBusy = true) {
  if (!asset.value || !page.value || !outputCanvas.value) return
  if (showBusy) busy.value = true
  error.value = ''
  try {
    const result = await renderPerspective(asset.value.image, page.value.settings, outputCanvas.value)
    hasPreview.value = true
    const size = `${result.sourceWidth}×${result.sourceHeight}px → preview ${result.width}×${result.height}px`
    note.value = result.scale < 0.6 ? `Preview đã giảm kích thước để thao tác mượt (${size}).` : `Đã tạo preview (${size}).`
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Không thể chỉnh phối cảnh.' }
  finally { if (showBusy) busy.value = false }
}

function resetCorners() {
  if (!page.value) return
  page.value = { ...page.value, settings: { ...page.value.settings, corners: defaultCorners(page.value.originalWidth, page.value.originalHeight), rotation: 0 } }
  detection.value = null; hasPreview.value = false; note.value = 'Đã đặt lại vùng crop thủ công.'
}

function rotate() {
  if (!page.value) return
  const next = ((page.value.settings.rotation + 90) % 360) as ScanRotation
  page.value = { ...page.value, settings: { ...page.value.settings, rotation: next } }
  void updatePreview()
}

function setFilter(filter: ScannerPage['settings']['filter']) {
  if (!page.value) return
  page.value = { ...page.value, settings: { ...page.value.settings, filter } }
  void updatePreview()
}

function setAdjustment(key: 'brightness' | 'contrast' | 'sharpen' | 'threshold', event: Event) {
  if (!page.value) return
  const value = Number((event.target as HTMLInputElement).value)
  page.value = { ...page.value, settings: { ...page.value.settings, [key]: value } }
  void updatePreview()
}

async function downloadScan(format: ScanExportFormat) {
  if (!asset.value || !page.value || !documentModel.value) return
  exporting.value = true; error.value = ''; note.value = 'Đang xử lý ảnh gốc để xuất file…'
  try {
    const result = await exportScan(asset.value, page.value, documentModel.value.name, format, exportQuality.value, exportPageSize.value)
    note.value = `Đã xuất ${result.width}×${result.height}px · ${(result.bytes / 1024 / 1024).toFixed(1)} MB.`
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Không thể xuất tài liệu.' }
  finally { exporting.value = false }
}

function onDrop(event: DragEvent) { dragging.value = false; if (event.dataTransfer?.files.length) void receiveFiles(event.dataTransfer.files) }
onBeforeUnmount(() => {
  if (asset.value) URL.revokeObjectURL(asset.value.sourceUrl)
  disposeScannerWorker()
})
</script>

<template>
  <main class="scanner-workspace" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop">
    <header class="scanner-header"><div><button class="scanner-back" @click="$emit('back')">← PDF Editor</button><span class="scanner-kicker">OFFLINE DOCUMENT SCANNER</span><h1>Chỉnh ảnh chụp thành tài liệu thẳng.</h1><p>Nhận diện cục bộ trên thiết bị, luôn cho phép chỉnh tay bốn góc.</p></div><button v-if="asset" class="button ghost" @click="chooseImage">Đổi ảnh</button></header>
    <input ref="input" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" @change="onFileChange" />

    <section v-if="!asset" class="scanner-empty" :class="{ dragging }" @click="chooseImage">
      <span class="scanner-upload-icon">⌑</span><h2>Thả ảnh tài liệu vào đây</h2><p>JPG, PNG hoặc WebP · tối đa 35 MB · xử lý trên thiết bị</p><button class="button primary" @click.stop="chooseImage">Chọn ảnh</button>
    </section>

    <template v-else-if="page">
      <div class="scanner-status"><span v-if="busy" class="scanner-spinner" />{{ busy ? 'Đang xử lý…' : note }}<button v-if="detection?.confidence === 'low'" @click="autoDetect">Thử nhận diện lại</button></div>
      <div v-if="error" class="error-banner scanner-error">{{ error }}</div>
      <section class="scanner-grid">
        <article class="scanner-panel"><header><div><span>01</span><h2>Chỉnh bốn góc</h2></div><div><button @click="resetCorners">Đặt lại</button><button @click="autoDetect">Tự nhận diện</button></div></header>
          <CornerCropEditor :source="asset.sourceUrl" :width="page.originalWidth" :height="page.originalHeight" :corners="page.settings.corners" @update="page = { ...page, settings: { ...page.settings, corners: $event } }; hasPreview = false" />
          <p class="scanner-help">Kéo từng điểm cam vào đúng bốn góc tờ giấy. Tọa độ được lưu theo ảnh gốc, không phụ thuộc kích thước màn hình.</p>
        </article>
        <article class="scanner-panel"><header><div><span>02</span><h2>Perspective preview</h2></div><div><button @click="rotate">Xoay {{ (rotation + 90) % 360 }}°</button><button class="process-button" @click="updatePreview()">Cập nhật preview</button></div></header>
          <div class="scan-output" :class="{ empty: !hasPreview }"><canvas ref="outputCanvas" /><p v-if="!hasPreview">Bấm “Cập nhật preview” sau khi chỉnh góc.</p></div>
          <p class="scanner-help">Preview được tối ưu để thao tác nhanh. Khi tải file, ứng dụng xử lý lại trực tiếp từ ảnh gốc.</p>
        </article>
      </section>
      <section class="scanner-tools">
        <article class="scanner-tool-card">
          <div class="scanner-tool-title"><span>03</span><div><h2>Làm sạch bản scan</h2><p>Chọn kiểu hiển thị rồi tinh chỉnh nếu cần.</p></div></div>
          <div class="scan-filter-tabs">
            <button :class="{ active: page.settings.filter === 'original' }" @click="setFilter('original')">Gốc</button>
            <button :class="{ active: page.settings.filter === 'document' }" @click="setFilter('document')">Tài liệu</button>
            <button :class="{ active: page.settings.filter === 'grayscale' }" @click="setFilter('grayscale')">Thang xám</button>
            <button :class="{ active: page.settings.filter === 'black-white' }" @click="setFilter('black-white')">Đen trắng</button>
          </div>
          <div class="scan-adjustments">
            <label>Sáng <output>{{ page.settings.brightness }}</output><input type="range" min="-50" max="50" :value="page.settings.brightness" @change="setAdjustment('brightness', $event)" /></label>
            <label>Tương phản <output>{{ page.settings.contrast }}</output><input type="range" min="-50" max="80" :value="page.settings.contrast" @change="setAdjustment('contrast', $event)" /></label>
            <label>Độ nét <output>{{ page.settings.sharpen }}</output><input type="range" min="0" max="100" :value="page.settings.sharpen" @change="setAdjustment('sharpen', $event)" /></label>
            <label v-if="page.settings.filter === 'black-white'">Ngưỡng <output>{{ page.settings.threshold }}</output><input type="range" min="40" max="220" :value="page.settings.threshold" @change="setAdjustment('threshold', $event)" /></label>
          </div>
        </article>
        <article class="scanner-tool-card">
          <div class="scanner-tool-title"><span>04</span><div><h2>Xuất tài liệu</h2><p>Tiêu chuẩn tương đương khoảng 300 DPI cho trang A4.</p></div></div>
          <div class="scan-export-options">
            <label>Chất lượng<select v-model="exportQuality"><option value="compact">Nhẹ · 3.5 MP</option><option value="standard">Tiêu chuẩn · 8.7 MP</option><option value="sharp">Sắc nét · 12 MP</option></select></label>
            <label>Khổ PDF<select v-model="exportPageSize"><option value="a4">A4</option><option value="content">Theo tỷ lệ ảnh</option></select></label>
          </div>
          <div class="scan-export-actions"><button :disabled="exporting" @click="downloadScan('png')">Tải PNG</button><button :disabled="exporting" @click="downloadScan('jpeg')">Tải JPEG</button><button class="primary" :disabled="exporting" @click="downloadScan('pdf')">{{ exporting ? 'Đang xuất…' : 'Tải PDF' }}</button></div>
        </article>
      </section>
    </template>
    <div v-if="dragging" class="scanner-drop-mask">Thả để mở ảnh</div>
  </main>
</template>
