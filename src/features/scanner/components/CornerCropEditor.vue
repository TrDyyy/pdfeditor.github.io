<script setup lang="ts">
import { computed, ref } from 'vue'
import { isValidQuadrilateral } from '../composables/useCropSelection'
import type { ScanCorners } from '../types/scanner.types'

const props = defineProps<{ source: string; width: number; height: number; corners: ScanCorners }>()
const emit = defineEmits<{ update: [corners: ScanCorners] }>()
const svg = ref<SVGSVGElement | null>(null)
const dragging = ref<number | null>(null)
const points = computed(() => props.corners.map((point) => `${point.x},${point.y}`).join(' '))
const handleRadius = computed(() => Math.max(props.width, props.height) * 0.013)

function start(index: number, event: PointerEvent) {
  event.preventDefault()
  dragging.value = index
  svg.value?.setPointerCapture(event.pointerId)
}

function move(event: PointerEvent) {
  if (dragging.value === null || !svg.value) return
  const rect = svg.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(props.width, (event.clientX - rect.left) / rect.width * props.width))
  const y = Math.max(0, Math.min(props.height, (event.clientY - rect.top) / rect.height * props.height))
  const next = props.corners.map((point) => ({ ...point })) as ScanCorners
  next[dragging.value] = { x, y }
  if (isValidQuadrilateral(next, props.width, props.height)) emit('update', next)
}

function end() { dragging.value = null }
</script>

<template>
  <div class="corner-editor">
    <div class="corner-stage">
      <img :src="source" alt="Ảnh tài liệu gốc" draggable="false" />
      <svg ref="svg" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" @pointermove.prevent="move" @pointerup="end" @pointercancel="end">
        <polygon :points="points" />
        <g v-for="(point, index) in corners" :key="index" class="corner-handle" @pointerdown.stop="start(index, $event)">
          <circle class="corner-hit-area" :cx="point.x" :cy="point.y" :r="handleRadius * 2.4" />
          <circle :cx="point.x" :cy="point.y" :r="handleRadius" />
        </g>
      </svg>
    </div>
  </div>
</template>
