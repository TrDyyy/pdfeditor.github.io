<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type Konva from 'konva'
import type { BinaryAsset, GraphicObject, OverlayImage, PageModel, TextObject } from '../types'

const props = defineProps<{
  model: PageModel
  pageNumber: number
  zoom: number
  selectedId: string | null
  cropMode: boolean
  editingTextId: string | null
  assets: Map<string, BinaryAsset>
}>()

const emit = defineEmits<{
  select: [id: string | null]
  change: [overlay: OverlayImage]
  toggleCrop: []
  dropPage: [overlay: OverlayImage, clientX: number, clientY: number]
  textChange: [text: TextObject]
  editText: [id: string]
  finishEdit: []
  graphicChange: [graphic: GraphicObject]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<{ getNode: () => Konva.Stage } | null>(null)
const transformer = ref<{ getNode: () => Konva.Transformer } | null>(null)
const imageElements = ref<Record<string, HTMLImageElement>>({})
const assetElements = ref<Record<string, HTMLImageElement>>({})
const stageWidth = computed(() => props.model.width * props.zoom)
const stageHeight = computed(() => props.model.height * props.zoom)
const activeAnchor = ref<string | null>(null)
const dragHud = ref<{ x: number; y: number; dx: number; dy: number; kind: 'Ảnh' | 'Chữ' } | null>(null)
let dragOrigin: { x: number; y: number } | null = null
const isTextSelected = computed(() => props.model.texts.some((text) => text.id === props.selectedId))
let latestPointer: { x: number; y: number } | null = null
let pointerMoveHandler: ((event: PointerEvent) => void) | null = null
const transformerConfig = computed(() => ({
  keepRatio: !props.cropMode && !isTextSelected.value,
  rotateEnabled: true,
  resizeEnabled: true,
  enabledAnchors: props.cropMode || isTextSelected.value
    ? ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']
    : ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  flipEnabled: false,
  anchorSize: 13,
  anchorFill: props.cropMode ? '#272520' : '#fff',
  borderStroke: props.cropMode ? '#272520' : '#e76035',
  anchorStroke: props.cropMode ? '#fff' : '#e76035',
  anchorStrokeWidth: 2,
  boundBoxFunc: (oldBox: { width: number; height: number }, newBox: { width: number; height: number }) =>
    Math.abs(newBox.width) < 12 || Math.abs(newBox.height) < 12 ? oldBox : newBox,
}))

async function renderPage() {
  if (!canvas.value) return
  const pixelRatio = window.devicePixelRatio || 1
  const viewport = props.model.page.getViewport({ scale: props.zoom })
  canvas.value.width = Math.floor(viewport.width * pixelRatio)
  canvas.value.height = Math.floor(viewport.height * pixelRatio)
  canvas.value.style.width = `${viewport.width}px`
  canvas.value.style.height = `${viewport.height}px`
  const context = canvas.value.getContext('2d')
  if (!context) return
  await props.model.page.render({
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  }).promise
}

function syncImages() {
  const next = { ...imageElements.value }
  for (const overlay of props.model.overlays) {
    if (!next[overlay.id]) {
      const image = new Image()
      image.onload = () => stage.value?.getNode().batchDraw()
      image.src = overlay.source
      next[overlay.id] = image
    }
  }
  imageElements.value = next
  const nextAssets = { ...assetElements.value }
  for (const graphic of props.model.graphics) {
    if (graphic.kind !== 'signature' || nextAssets[graphic.assetId]) continue
    const asset = props.assets.get(graphic.assetId)
    if (!asset) continue
    const image = new Image()
    image.onload = () => stage.value?.getNode().batchDraw()
    image.src = asset.source
    nextAssets[graphic.assetId] = image
  }
  assetElements.value = nextAssets
}

function imageConfig(overlay: OverlayImage) {
  return {
    id: overlay.id,
    image: imageElements.value[overlay.id],
    x: overlay.x * props.zoom,
    y: overlay.y * props.zoom,
    width: overlay.width * props.zoom,
    height: overlay.height * props.zoom,
    cropX: overlay.cropX,
    cropY: overlay.cropY,
    cropWidth: overlay.cropWidth,
    cropHeight: overlay.cropHeight,
    rotation: overlay.rotation,
    opacity: overlay.opacity,
    draggable: true,
  }
}

function textConfig(text: TextObject) {
  return {
    id: text.id,
    text: text.text,
    x: text.x * props.zoom,
    y: text.y * props.zoom,
    width: text.width * props.zoom,
    height: text.height * props.zoom,
    rotation: text.rotation,
    fontFamily: editorFontFamily(text.fontFamily),
    fontSize: text.fontSize * props.zoom,
    fontStyle: `${text.bold ? 'bold' : ''} ${text.italic ? 'italic' : ''}`.trim() || 'normal',
    fill: text.color,
    align: text.align,
    lineHeight: text.lineHeight,
    wrap: 'word',
    padding: 2,
    draggable: props.editingTextId !== text.id,
    visible: props.editingTextId !== text.id,
  }
}

function editorFontFamily(family: TextObject['fontFamily']) {
  return family === 'Times New Roman' ? 'Times New Roman, Noto Serif, serif' : family
}

function graphicConfig(graphic: GraphicObject) {
  return { id: graphic.id, x: graphic.x * props.zoom, y: graphic.y * props.zoom, width: graphic.width * props.zoom, height: graphic.height * props.zoom, rotation: graphic.rotation, opacity: graphic.opacity, draggable: true }
}

function shapeRectConfig(graphic: GraphicObject) {
  const shape = graphic.kind === 'rectangle' || graphic.kind === 'ellipse' || graphic.kind === 'line' || graphic.kind === 'arrow' ? graphic : null
  return { x: 0, y: 0, width: graphic.width * props.zoom, height: graphic.height * props.zoom, fill: shape?.fill ?? (graphic.kind === 'whiteout' ? '#ffffff' : graphic.kind === 'highlight' ? graphic.color : 'transparent'), stroke: shape?.stroke, strokeWidth: (shape?.strokeWidth ?? 0) * props.zoom }
}

function onGraphicTransformEnd(graphic: GraphicObject, event: Konva.KonvaEventObject<Event>) {
  const node = event.target
  emit('graphicChange', { ...graphic, x: node.x() / props.zoom, y: node.y() / props.zoom, width: Math.max(8, graphic.width * node.scaleX()), height: Math.max(2, graphic.height * node.scaleY()), rotation: node.rotation() } as GraphicObject)
  node.scaleX(1); node.scaleY(1)
}

function onGraphicDragEnd(graphic: GraphicObject, event: Konva.KonvaEventObject<DragEvent>) {
  emit('graphicChange', { ...graphic, x: event.target.x() / props.zoom, y: event.target.y() / props.zoom } as GraphicObject)
}

function autoHeight(text: TextObject, value: string) {
  const charactersPerLine = Math.max(1, Math.floor(text.width / (text.fontSize * 0.58)))
  const lines = value.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0)
  return Math.max(text.height, lines * text.fontSize * text.lineHeight + 8)
}

function updateTextContent(text: TextObject, event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  emit('textChange', { ...text, text: value, height: autoHeight(text, value) })
}

function textareaStyle(text: TextObject) {
  return {
    left: `${text.x * props.zoom}px`,
    top: `${text.y * props.zoom}px`,
    width: `${text.width * props.zoom}px`,
    height: `${text.height * props.zoom}px`,
    transform: `rotate(${text.rotation}deg)`,
    transformOrigin: 'top left',
    fontFamily: editorFontFamily(text.fontFamily),
    fontSize: `${text.fontSize * props.zoom}px`,
    fontWeight: text.bold ? '700' : '400',
    fontStyle: text.italic ? 'italic' : 'normal',
    color: text.color,
    textAlign: text.align,
    lineHeight: String(text.lineHeight),
  }
}

function selectOverlay(id: string, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  event.cancelBubble = true
  emit('select', id)
}

function onTextDragEnd(text: TextObject, event: Konva.KonvaEventObject<DragEvent>) {
  emit('textChange', { ...text, x: event.target.x() / props.zoom, y: event.target.y() / props.zoom })
  finishPrecisionDrag()
}

function onTextTransformEnd(text: TextObject, event: Konva.KonvaEventObject<Event>) {
  const node = event.target
  emit('textChange', {
    ...text,
    x: node.x() / props.zoom,
    y: node.y() / props.zoom,
    width: Math.max(30, (node.width() * node.scaleX()) / props.zoom),
    height: Math.max(text.fontSize * text.lineHeight, (node.height() * node.scaleY()) / props.zoom),
    rotation: node.rotation(),
  })
  node.scaleX(1)
  node.scaleY(1)
}

function clearSelection(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  // Transformer handles bubble through the layer to the stage. Only a click
  // whose actual target is the empty stage should clear the current image.
  if (event.target === event.target.getStage()) emit('select', null)
}

function onDragEnd(overlay: OverlayImage, event: Konva.KonvaEventObject<DragEvent>) {
  const updated = { ...overlay, x: event.target.x() / props.zoom, y: event.target.y() / props.zoom }
  const nativeEvent = event.evt as MouseEvent | TouchEvent
  const point = 'changedTouches' in nativeEvent ? nativeEvent.changedTouches[0] : nativeEvent
  const clientX = latestPointer?.x ?? point.clientX
  const clientY = latestPointer?.y ?? point.clientY
  stopGlobalDragTracking()
  finishPrecisionDrag()
  emit('dropPage', updated, clientX, clientY)
}

function startPrecisionDrag(kind: 'Ảnh' | 'Chữ', event: Konva.KonvaEventObject<DragEvent>) {
  dragOrigin = { x: event.target.x(), y: event.target.y() }
  updatePrecisionDrag(kind, event)
}

function updatePrecisionDrag(kind: 'Ảnh' | 'Chữ', event: Konva.KonvaEventObject<DragEvent>) {
  const node = event.target
  const nativeEvent = event.evt as DragEvent | MouseEvent | TouchEvent
  const shiftKey = 'shiftKey' in nativeEvent && nativeEvent.shiftKey
  if (shiftKey && dragOrigin) {
    const deltaX = node.x() - dragOrigin.x; const deltaY = node.y() - dragOrigin.y
    if (Math.abs(deltaX) >= Math.abs(deltaY)) node.y(dragOrigin.y)
    else node.x(dragOrigin.x)
  }
  // Keep model coordinates on whole document pixels at every zoom level.
  const x = Math.round(node.x() / props.zoom); const y = Math.round(node.y() / props.zoom)
  node.position({ x: x * props.zoom, y: y * props.zoom })
  const originX = (dragOrigin?.x ?? node.x()) / props.zoom; const originY = (dragOrigin?.y ?? node.y()) / props.zoom
  dragHud.value = { x, y, dx: Math.round(x - originX), dy: Math.round(y - originY), kind }
}

function finishPrecisionDrag() {
  dragHud.value = null
  dragOrigin = null
}

function onOverlayDragStart(event: Konva.KonvaEventObject<DragEvent>) {
  startGlobalDragTracking(event)
  startPrecisionDrag('Ảnh', event)
}

function markDropTarget(clientX: number, clientY: number) {
  document.querySelectorAll('.page-surface.drop-target').forEach((element) => element.classList.remove('drop-target'))
  const target = document.elementFromPoint(clientX, clientY)?.closest('.page-surface')
  target?.classList.add('drop-target')
}

function startGlobalDragTracking(event: Konva.KonvaEventObject<DragEvent>) {
  const nativeEvent = event.evt as MouseEvent | TouchEvent
  const point = 'touches' in nativeEvent ? nativeEvent.touches[0] : nativeEvent
  latestPointer = point ? { x: point.clientX, y: point.clientY } : null
  pointerMoveHandler = (pointerEvent: PointerEvent) => {
    latestPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
    markDropTarget(pointerEvent.clientX, pointerEvent.clientY)
  }
  window.addEventListener('pointermove', pointerMoveHandler, true)
}

function stopGlobalDragTracking() {
  if (pointerMoveHandler) window.removeEventListener('pointermove', pointerMoveHandler, true)
  pointerMoveHandler = null
  latestPointer = null
  document.querySelectorAll('.page-surface.drop-target').forEach((element) => element.classList.remove('drop-target'))
}

function onDragMove(event: Konva.KonvaEventObject<DragEvent>) {
  updatePrecisionDrag('Ảnh', event)
  const nativeEvent = event.evt as MouseEvent | TouchEvent
  const point = 'touches' in nativeEvent ? nativeEvent.touches[0] : nativeEvent
  const scroller = document.querySelector<HTMLElement>('.document-scroll')
  if (!point || !scroller) return
  const bounds = scroller.getBoundingClientRect()
  const margin = 55
  const speed = 18
  if (point.clientY < bounds.top + margin) scroller.scrollBy({ top: -speed })
  else if (point.clientY > bounds.bottom - margin) scroller.scrollBy({ top: speed })
  if (point.clientX < bounds.left + margin) scroller.scrollBy({ left: -speed })
  else if (point.clientX > bounds.right - margin) scroller.scrollBy({ left: speed })
}

function onTransformEnd(overlay: OverlayImage, event: Konva.KonvaEventObject<Event>) {
  const node = event.target
  const renderedWidth = Math.max(8, (node.width() * node.scaleX()) / props.zoom)
  const renderedHeight = Math.max(8, (node.height() * node.scaleY()) / props.zoom)
  if (props.cropMode && activeAnchor.value) {
    const anchor = activeAnchor.value
    const scaleX = overlay.width / overlay.cropWidth
    const scaleY = overlay.height / overlay.cropHeight
    let cropX = overlay.cropX
    let cropY = overlay.cropY
    let cropWidth = overlay.cropWidth
    let cropHeight = overlay.cropHeight
    if (anchor.includes('left')) {
      const rightEdge = overlay.cropX + overlay.cropWidth
      cropX = Math.max(0, Math.min(rightEdge - 1, rightEdge - renderedWidth / scaleX))
      cropWidth = rightEdge - cropX
    } else if (anchor.includes('right')) {
      cropWidth = Math.max(1, Math.min(overlay.naturalWidth - cropX, renderedWidth / scaleX))
    }
    if (anchor.includes('top')) {
      const bottomEdge = overlay.cropY + overlay.cropHeight
      cropY = Math.max(0, Math.min(bottomEdge - 1, bottomEdge - renderedHeight / scaleY))
      cropHeight = bottomEdge - cropY
    } else if (anchor.includes('bottom')) {
      cropHeight = Math.max(1, Math.min(overlay.naturalHeight - cropY, renderedHeight / scaleY))
    }
    node.scaleX(1)
    node.scaleY(1)
    emit('change', {
      ...overlay,
      x: node.x() / props.zoom,
      y: node.y() / props.zoom,
      width: cropWidth * scaleX,
      height: cropHeight * scaleY,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
    })
    activeAnchor.value = null
    return
  }
  const updated = {
    ...overlay,
    x: node.x() / props.zoom,
    y: node.y() / props.zoom,
    width: Math.max(8, (node.width() * node.scaleX()) / props.zoom),
    height: Math.max(8, (node.height() * node.scaleY()) / props.zoom),
    rotation: node.rotation(),
  }
  node.scaleX(1)
  node.scaleY(1)
  emit('change', updated)
}

function onTransformStart() {
  activeAnchor.value = transformer.value?.getNode().getActiveAnchor() ?? null
}

async function attachTransformer() {
  await nextTick()
  const transformerNode = transformer.value?.getNode()
  const stageNode = stage.value?.getNode()
  if (!transformerNode || !stageNode) return
  const selected = props.selectedId ? stageNode.findOne(`#${props.selectedId}`) : undefined
  transformerNode.nodes(selected ? [selected] : [])
  transformerNode.getLayer()?.batchDraw()
}

watch(() => props.zoom, renderPage)
watch(() => [props.model.overlays, props.model.graphics, props.assets], () => { syncImages(); void attachTransformer() }, { deep: true, immediate: true })
watch(() => props.selectedId, attachTransformer)
watch(() => props.cropMode, attachTransformer)
onMounted(renderPage)
</script>

<template>
  <article class="pdf-page" :data-page="pageNumber">
    <div class="page-label">Trang {{ pageNumber }}</div>
    <div class="page-surface" :style="{ width: `${stageWidth}px`, height: `${stageHeight}px` }">
      <canvas ref="canvas" />
      <v-stage ref="stage" class="overlay-stage" :config="{ width: stageWidth, height: stageHeight }" @mousedown="clearSelection" @touchstart="clearSelection">
        <v-layer>
          <v-group
            v-for="graphic in model.graphics"
            :key="graphic.id"
            :config="graphicConfig(graphic)"
            @mousedown="selectOverlay(graphic.id, $event)"
            @touchstart="selectOverlay(graphic.id, $event)"
            @dragend="onGraphicDragEnd(graphic, $event)"
            @transformend="onGraphicTransformEnd(graphic, $event)"
          >
            <v-image v-if="graphic.kind === 'signature'" :config="{ image: assetElements[graphic.assetId], width: graphic.width * zoom, height: graphic.height * zoom }" />
            <v-rect v-else-if="graphic.kind === 'rectangle' || graphic.kind === 'whiteout' || graphic.kind === 'highlight'" :config="shapeRectConfig(graphic)" />
            <v-ellipse v-else-if="graphic.kind === 'ellipse'" :config="{ x: graphic.width * zoom / 2, y: graphic.height * zoom / 2, radiusX: graphic.width * zoom / 2, radiusY: graphic.height * zoom / 2, fill: graphic.fill, stroke: graphic.stroke, strokeWidth: graphic.strokeWidth * zoom }" />
            <v-line v-else-if="graphic.kind === 'line'" :config="{ points: [0, graphic.height * zoom / 2, graphic.width * zoom, graphic.height * zoom / 2], stroke: graphic.stroke, strokeWidth: graphic.strokeWidth * zoom, lineCap: 'round' }" />
            <v-arrow v-else-if="graphic.kind === 'arrow'" :config="{ points: [0, graphic.height * zoom / 2, graphic.width * zoom, graphic.height * zoom / 2], stroke: graphic.stroke, fill: graphic.stroke, strokeWidth: graphic.strokeWidth * zoom, pointerLength: 10 * zoom, pointerWidth: 10 * zoom }" />
            <template v-else-if="graphic.kind === 'stamp'">
              <v-rect :config="{ width: graphic.width * zoom, height: graphic.height * zoom, cornerRadius: 5, stroke: graphic.color, strokeWidth: 4 * zoom }" />
              <v-text :config="{ text: graphic.label, width: graphic.width * zoom, height: graphic.height * zoom, align: 'center', verticalAlign: 'middle', fontFamily: 'DejaVu Sans', fontStyle: 'bold', fontSize: Math.min(24, graphic.height * .38) * zoom, fill: graphic.color }" />
            </template>
          </v-group>
          <v-image
            v-for="overlay in model.overlays"
            :key="overlay.id"
            :config="imageConfig(overlay)"
            @mousedown="selectOverlay(overlay.id, $event)"
            @touchstart="selectOverlay(overlay.id, $event)"
            @dblclick="emit('toggleCrop')"
            @dbltap="emit('toggleCrop')"
            @dragstart="onOverlayDragStart"
            @dragmove="onDragMove"
            @dragend="onDragEnd(overlay, $event)"
            @transformstart="onTransformStart"
            @transformend="onTransformEnd(overlay, $event)"
          />
          <v-text
            v-for="text in model.texts"
            :key="text.id"
            :config="textConfig(text)"
            @mousedown="selectOverlay(text.id, $event)"
            @touchstart="selectOverlay(text.id, $event)"
            @dblclick="emit('editText', text.id)"
            @dbltap="emit('editText', text.id)"
            @dragstart="startPrecisionDrag('Chữ', $event)"
            @dragmove="updatePrecisionDrag('Chữ', $event)"
            @dragend="onTextDragEnd(text, $event)"
            @transformend="onTextTransformEnd(text, $event)"
          />
          <v-transformer ref="transformer" :config="transformerConfig" />
        </v-layer>
      </v-stage>
      <template v-if="dragHud">
        <div class="alignment-guide vertical" :style="{ left: `${dragHud.x * zoom}px` }" />
        <div class="alignment-guide horizontal" :style="{ top: `${dragHud.y * zoom}px` }" />
        <div class="coordinate-hud" :style="{ left: `${dragHud.x * zoom + 10}px`, top: `${dragHud.y * zoom + 10}px` }">
          <strong>{{ dragHud.kind }}</strong> X {{ dragHud.x }} px · Y {{ dragHud.y }} px
          <small>Δ {{ dragHud.dx >= 0 ? '+' : '' }}{{ dragHud.dx }}, {{ dragHud.dy >= 0 ? '+' : '' }}{{ dragHud.dy }} · Giữ Shift để khóa trục</small>
        </div>
      </template>
      <textarea
        v-for="text in model.texts.filter((item) => item.id === editingTextId)"
        :key="`editor-${text.id}`"
        class="text-editor"
        :style="textareaStyle(text)"
        :value="text.text"
        autofocus
        @input="updateTextContent(text, $event)"
        @keydown.esc="emit('finishEdit')"
        @blur="emit('finishEdit')"
      />
    </div>
  </article>
</template>
