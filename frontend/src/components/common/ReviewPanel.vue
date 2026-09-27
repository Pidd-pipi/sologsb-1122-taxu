<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useReviewStore } from '../../stores/reviewStore';
import GradeTag from './GradeTag.vue';
import ReviewStatusTag from './ReviewStatusTag.vue';
import { attitudeText, formatChainage } from '../../utils/geoMath';
import type { ReviewRecord } from '../../types/review';

const props = defineProps<{ faceId: string }>();

const reviewStore = useReviewStore();

const LS_REVIEWER_KEY = 'gbtunnelface:reviewer';

const latest = computed(() => reviewStore.latestByFace(props.faceId));
const history = computed(() => reviewStore.byFace(props.faceId));
const confirmed = computed(() => reviewStore.latestConfirmedByFace(props.faceId));
const status = computed(() => latest.value?.status ?? 'pending');

const reviewer = ref(readReviewer());
const comment = ref('');
const acting = ref(false);

function readReviewer(): string {
  try {
    return window.localStorage.getItem(LS_REVIEWER_KEY) || '项目总工';
  } catch {
    return '项目总工';
  }
}

function rememberReviewer(name: string): void {
  try {
    window.localStorage.setItem(LS_REVIEWER_KEY, name);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

async function doConfirm() {
  const name = reviewer.value.trim();
  if (!name) {
    ElMessage.warning('请填写复核总工姓名');
    return;
  }
  acting.value = true;
  try {
    const ok = await reviewStore.confirm(props.faceId, name, comment.value.trim());
    if (ok) {
      rememberReviewer(name);
      comment.value = '';
      ElMessage.success('已确认，台账结论按本轮快照归档');
    } else {
      ElMessage.warning('当前没有待复核的记录');
    }
  } finally {
    acting.value = false;
  }
}

async function doReject() {
  const name = reviewer.value.trim();
  if (!name) {
    ElMessage.warning('请填写复核总工姓名');
    return;
  }
  if (!comment.value.trim()) {
    ElMessage.warning('退回时必须写明复核意见');
    return;
  }
  acting.value = true;
  try {
    const ok = await reviewStore.reject(props.faceId, name, comment.value.trim());
    if (ok) {
      rememberReviewer(name);
      comment.value = '';
      ElMessage.success('已退回，请地质员按意见修改');
    } else {
      ElMessage.warning('当前没有待复核的记录');
    }
  } finally {
    acting.value = false;
  }
}

/** 退回后未改动内容，直接重新提交一轮待复核 */
async function resubmit() {
  await reviewStore.touchFace(props.faceId);
  ElMessage.success('已重新提交，等待总工复核');
}

const snapshotOf = ref<ReviewRecord | null>(null);

function openSnapshot(row: ReviewRecord) {
  snapshotOf.value = row;
}

function fmtTime(ts?: number): string {
  return ts ? new Date(ts).toLocaleString('zh-CN') : '—';
}
</script>

<template>
  <el-card shadow="never" data-testid="review-panel">
    <template #header>
      <div class="card-head">
        <strong>单循环校审</strong>
        <ReviewStatusTag :status="status" :round="latest?.round" />
        <span v-if="latest" class="muted">
          提交人 {{ latest.submittedBy }} · {{ fmtTime(latest.submittedAt) }}
        </span>
      </div>
    </template>

    <el-alert
      v-if="status === 'rejected' && latest"
      type="error"
      show-icon
      :closable="false"
      class="block"
      :title="`退回意见（${latest.reviewer ?? '总工'} · ${fmtTime(latest.reviewedAt)}）：${latest.reviewComment ?? ''}`"
    >
      <el-button size="small" type="primary" plain @click="resubmit">修改完毕，重新提交复核</el-button>
    </el-alert>

    <el-alert
      v-else-if="status === 'pending' && confirmed"
      type="warning"
      show-icon
      :closable="false"
      class="block"
      :title="`当前改动尚未确认，台账结论仍按第 ${confirmed.round} 轮确认版本（${fmtTime(confirmed.reviewedAt)}）`"
    />

    <el-alert
      v-else-if="status === 'confirmed' && latest"
      type="success"
      show-icon
      :closable="false"
      class="block"
      :title="`总工 ${latest.reviewer ?? ''} 已于 ${fmtTime(latest.reviewedAt)} 确认本轮整份记录`"
    >
      <span v-if="latest.reviewComment">确认意见：{{ latest.reviewComment }}</span>
      <span v-else>后续任何改动都会自动转回待复核，并保留本轮快照。</span>
    </el-alert>

    <div v-if="status === 'pending'" class="review-box">
      <div class="review-title">总工复核</div>
      <el-form label-width="90px" size="small">
        <el-form-item label="复核总工">
          <el-input v-model="reviewer" placeholder="项目总工姓名" style="width: 220px" />
        </el-form-item>
        <el-form-item label="复核意见">
          <el-input
            v-model="comment"
            type="textarea"
            :rows="2"
            placeholder="确认可不填；退回必须写明意见"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="success" :loading="acting" @click="doConfirm">确认通过</el-button>
          <el-button type="danger" plain :loading="acting" @click="doReject">退回</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-table :data="history" size="small" border>
      <el-table-column label="轮次" width="70">
        <template #default="{ row }">第 {{ row.round }} 轮</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><ReviewStatusTag :status="row.status" /></template>
      </el-table-column>
      <el-table-column label="提交" width="160">
        <template #default="{ row }">{{ row.submittedBy }} · {{ fmtTime(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="复核" width="170">
        <template #default="{ row }">
          <span v-if="row.reviewedAt">{{ row.reviewer }} · {{ fmtTime(row.reviewedAt) }}</span>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="意见" min-width="160">
        <template #default="{ row }">{{ row.reviewComment || '—' }}</template>
      </el-table-column>
      <el-table-column label="快照" width="90">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click="openSnapshot(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      :model-value="snapshotOf !== null"
      width="640px"
      :title="snapshotOf ? `第 ${snapshotOf.round} 轮快照 · ${snapshotOf.snapshot.face.faceNo}` : ''"
      @close="snapshotOf = null"
    >
      <template v-if="snapshotOf">
        <el-alert
          v-if="confirmed && snapshotOf.id === confirmed.id"
          type="success"
          :closable="false"
          show-icon
          title="本轮快照是当前台账结论的依据"
          style="margin-bottom: 10px"
        />
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="里程桩号">
            {{ formatChainage(snapshotOf.snapshot.face.chainage) }}
          </el-descriptions-item>
          <el-descriptions-item label="开挖方式">{{ snapshotOf.snapshot.face.excavationMethod }}</el-descriptions-item>
          <el-descriptions-item label="岩性 / 风化">
            {{ snapshotOf.snapshot.face.lithology }} / {{ snapshotOf.snapshot.face.weathering }}
          </el-descriptions-item>
          <el-descriptions-item label="饱和抗压强度">
            {{ snapshotOf.snapshot.face.rockStrength }} MPa
          </el-descriptions-item>
          <el-descriptions-item label="岩层产状">
            走向 {{ snapshotOf.snapshot.face.attitude.strike }}° ·
            {{ attitudeText(snapshotOf.snapshot.face.attitude.dipDirection, snapshotOf.snapshot.face.attitude.dipAngle) }}
          </el-descriptions-item>
          <el-descriptions-item label="编录时间">
            {{ fmtTime(snapshotOf.snapshot.face.recordedAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="节理组">{{ snapshotOf.snapshot.joints.length }} 组</el-descriptions-item>
          <el-descriptions-item label="涌水记录">{{ snapshotOf.snapshot.waters.length }} 条</el-descriptions-item>
        </el-descriptions>
        <div class="snap-grade">
          <template v-if="snapshotOf.snapshot.grade">
            <GradeTag :grade="snapshotOf.snapshot.grade.grade" />
            <span class="muted">
              [BQ] = {{ snapshotOf.snapshot.grade.correctedBq }}（BQ {{ snapshotOf.snapshot.grade.bqValue }}）
            </span>
            <p class="support">{{ snapshotOf.snapshot.grade.supportSuggestion }}</p>
          </template>
          <span v-else class="muted">该轮次尚未判定围岩级别</span>
        </div>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.block {
  margin-bottom: 10px;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.review-box {
  border: 1px dashed #d8b356;
  border-radius: 6px;
  padding: 10px 12px 0;
  margin-bottom: 12px;
  background: #fffaf0;
}
.review-title {
  font-weight: 600;
  color: #8a6d1a;
  margin-bottom: 8px;
}
.snap-grade {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.support {
  margin: 4px 0 0;
  color: #2f3a46;
}
</style>
