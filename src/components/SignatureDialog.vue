<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { deleteSignature, listSignatures, saveSignature, type SavedSignature } from '../signatureDb'

const emit = defineEmits<{ close: []; insert: [blob: Blob, name: string] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const mode = ref<'draw' | 'upload' | 'library'>('draw')
const color = ref('#111111')
const strokeWidth = ref(3)
const drawing = ref(false)
const hasInk = ref(false)
const saveToLibrary = ref(false)
const saved = ref<SavedSignature[]>([])
const previews = new Map<string, string>()
let lastPoint: { x: number; y: number } | null = null

function context() {
  const ctx = canvas.value?.getContext('2d')
  if (ctx) { ctx.lineCap = 'round'; ctx.lineJoin = 'round' }
  return ctx
}

function point(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: (event.clientX - rect.left) * (canvas.value!.width / rect.width), y: (event.clientY - rect.top) * (canvas.value!.height / rect.height) }
}

function start(event: PointerEvent) {
  const ctx = context(); if (!ctx) return
  drawing.value = true; hasInk.value = true
  canvas.value?.setPointerCapture(event.pointerId)
  const p = point(event); lastPoint = p; ctx.beginPath(); ctx.moveTo(p.x, p.y)
}

function move(event: PointerEvent) {
  if (!drawing.value) return
  const ctx = context(); if (!ctx) return
  const p = point(event); ctx.strokeStyle = color.value; ctx.lineWidth = strokeWidth.value
  if (lastPoint) ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, (lastPoint.x + p.x) / 2, (lastPoint.y + p.y) / 2)
  else ctx.lineTo(p.x, p.y)
  ctx.stroke(); lastPoint = p
}

function end() { drawing.value = false; lastPoint = null }
function clear() { context()?.clearRect(0, 0, canvas.value?.width ?? 0, canvas.value?.height ?? 0); hasInk.value = false }

async function insertDrawing() {
  if (!canvas.value || !hasInk.value) return
  const blob = await new Promise<Blob>((resolve, reject) => canvas.value!.toBlob((value) => value ? resolve(value) : reject(), 'image/png'))
  if (saveToLibrary.value) await saveSignature({ id: crypto.randomUUID(), name: 'Chữ ký vẽ', blob, createdAt: Date.now() })
  emit('insert', blob, 'signature.png')
}

async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (saveToLibrary.value) await saveSignature({ id: crypto.randomUUID(), name: file.name, blob: file, createdAt: Date.now() })
  emit('insert', file, file.name)
}

async function removeSaved(id: string) { await deleteSignature(id); saved.value = await listSignatures() }
async function showLibrary() { mode.value = 'library'; saved.value = await listSignatures() }
function blobUrl(item: SavedSignature) {
  let url = previews.get(item.id)
  if (!url) { url = globalThis.URL.createObjectURL(item.blob); previews.set(item.id, url) }
  return url
}
onMounted(async () => { await nextTick(); clear() })
onBeforeUnmount(() => previews.forEach((url) => globalThis.URL.revokeObjectURL(url)))
</script>

<template>
  <div class="dialog-backdrop" @mousedown.self="emit('close')">
    <section class="signature-dialog" role="dialog" aria-modal="true" aria-label="Tạo chữ ký trực quan">
      <header><div><h2>Chèn chữ ký</h2><p>Chữ ký trực quan, không phải chữ ký số mật mã.</p></div><button class="dialog-close" @click="emit('close')">×</button></header>
      <nav class="dialog-tabs">
        <button :class="{ active: mode === 'draw' }" @click="mode = 'draw'">Vẽ chữ ký</button>
        <button :class="{ active: mode === 'upload' }" @click="mode = 'upload'">Tải ảnh lên</button>
        <button :class="{ active: mode === 'library' }" @click="showLibrary">Thư viện</button>
      </nav>
      <div v-show="mode === 'draw'" class="signature-draw">
        <canvas ref="canvas" width="720" height="260" @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end" />
        <div class="signature-controls"><label>Màu <input v-model="color" type="color" /></label><label>Nét <input v-model.number="strokeWidth" type="range" min="1" max="12" /></label><button class="button" @click="clear">Vẽ lại</button></div>
      </div>
      <div v-if="mode === 'upload'" class="signature-upload"><label class="upload-zone">Chọn PNG, JPEG hoặc WebP<input type="file" accept="image/png,image/jpeg,image/webp" @change="upload" /></label></div>
      <div v-if="mode === 'library'" class="signature-library">
        <p v-if="!saved.length">Chưa có chữ ký đã lưu.</p>
        <article v-for="item in saved" :key="item.id"><img :src="blobUrl(item)" :alt="item.name" /><span>{{ item.name }}</span><button @click="emit('insert', item.blob, item.name)">Dùng</button><button class="delete-saved" @click="removeSaved(item.id)">Xóa</button></article>
      </div>
      <footer><label><input v-model="saveToLibrary" type="checkbox" /> Lưu vào thư viện trên thiết bị này</label><button v-if="mode === 'draw'" class="button primary" :disabled="!hasInk" @click="insertDrawing">Chèn chữ ký</button></footer>
    </section>
  </div>
</template>
