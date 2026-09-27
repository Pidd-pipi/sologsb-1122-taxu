<script setup lang="ts">
import { computed } from 'vue';
import { REVIEW_STATUS_TAG, REVIEW_STATUS_TEXT, type ReviewStatus } from '../../types/review';

const props = defineProps<{
  status: ReviewStatus;
  /** 传入轮次时显示「待复核 · 第 N 轮」 */
  round?: number;
}>();

const text = computed(() =>
  props.round !== undefined ? `${REVIEW_STATUS_TEXT[props.status]} · 第${props.round}轮` : REVIEW_STATUS_TEXT[props.status],
);
</script>

<template>
  <el-tag :type="REVIEW_STATUS_TAG[status]" size="small" data-testid="review-status-tag">{{ text }}</el-tag>
</template>
