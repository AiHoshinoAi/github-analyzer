<script setup lang="ts">
import * as echarts from "echarts";
import type { ECharts, EChartsOption } from "echarts";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  option: EChartsOption;
  empty?: string;
}>();

const chartEl = ref<HTMLDivElement | null>(null);
let chart: ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

function renderChart() {
  if (!chartEl.value) {
    return;
  }

  chart ??= echarts.init(chartEl.value);
  chart.setOption(props.option, true);
}

onMounted(async () => {
  await nextTick();
  renderChart();

  if (chartEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartEl.value);
  }
});

watch(
  () => props.option,
  () => {
    renderChart();
  },
  { deep: true }
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <div class="chart-shell">
    <div ref="chartEl" class="chart-canvas" />
  </div>
</template>
