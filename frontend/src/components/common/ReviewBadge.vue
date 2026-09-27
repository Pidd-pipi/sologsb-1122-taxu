<script setup lang="ts">
import { computed } from 'vue';
import { REVIEW_STATUS_LABEL, type ReviewStatus } from '../../types/review';

const props = defineProps<{
  status: ReviewStatus;
  version?: number;
  comment?: string;
  size?: 'small' | 'default' | 'large';
}>();

const type = computed<'info' | 'danger' | 'success'>(() => {
  if (props.status === 'confirmed') return 'success';
  if (props.status === 'rejected') return 'danger';
  return 'info';
});

const tooltip = computed(() => {
  if (props.status === 'rejected' && props.comment) return `退回意见：${props.comment}`;
  if (props.status === 'pending' && props.version && props.version > 0) {
    return `上一版 v${props.version} 已确认，当前改动尚未复核，台账仍按上一版结论`;
  }
  if (props.status === 'confirmed') return `已确认 v${props.version ?? 1}，台账以本版为准`;
  return '';
});
</script>

<template>
  <el-tooltip v-if="tooltip" :content="tooltip" placement="top" :show-after="200">
    <el-tag :type="type" :size="size" effect="dark">
      {{ REVIEW_STATUS_LABEL[status] }}<template v-if="status === 'confirmed' && version"> · v{{ version }}</template>
    </el-tag>
  </el-tooltip>
  <el-tag v-else :type="type" :size="size" effect="dark">{{ REVIEW_STATUS_LABEL[status] }}</el-tag>
</template>
