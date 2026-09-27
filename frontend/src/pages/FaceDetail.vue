<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { useJointStore } from '../stores/jointStore';
import { useReviewStore, touchAndNotify } from '../stores/reviewStore';
import { useGradeCalc } from '../hooks/useGradeCalc';
import SketchCanvas from '../components/common/SketchCanvas.vue';
import GradeTag from '../components/common/GradeTag.vue';
import ReviewBadge from '../components/common/ReviewBadge.vue';
import { attitudeText, formatChainage } from '../utils/geoMath';
import { GRADE_SUPPORT, ROCK_GRADES, type RockGrade } from '../types/grade';
import {
  EXCAVATION_METHODS,
  LITHOLOGIES,
  WEATHERINGS,
  type TunnelFace,
} from '../types/face';
import {
  PENDING_CHANGE_KIND_LABEL,
  REVIEW_ACTION_LABEL,
  type ReviewRecord,
} from '../types/review';

const route = useRoute();
const router = useRouter();
const faceStore = useFaceStore();
const jointStore = useJointStore();
const gradeStore = useGradeStore();
const reviewStore = useReviewStore();

const faceId = computed(() => String(route.params.id ?? ''));
const face = computed(() => faceStore.byId(faceId.value));
const joints = computed(() => jointStore.byFace(faceId.value));
const grades = computed(() => gradeStore.byFace(faceId.value));
const latest = computed(() => grades.value[0]);

const reviewHistory = computed(() => reviewStore.byFace(faceId.value));
const confirmedRecord = computed(() => reviewStore.latestConfirm(faceId.value));
const confirmedGrade = computed(() => confirmedRecord.value?.bundle.grades[0]);
const previousConfirm = computed(
  () => reviewStore.byFace(faceId.value).filter((r) => r.action === 'confirm')[1],
);
/** 台账生效级别：仅来自最近一次确认快照 */
const effectiveGrade = computed<RockGrade | undefined>(() => reviewStore.effectiveGrade(faceId.value));

const { result, patch } = useGradeCalc(() => joints.value);
const segmentCount = ref(0);

/** SketchCanvas 变更回调（用命名函数避免模板内联箭头参数丢类型） */
function onSketchChange(segs: { id: string }[]): void {
  segmentCount.value = segs.length;
}

/** 台账结论：相邻两版确认级别的比对 */
const gradeCompare = computed(() => {
  const cur = confirmedGrade.value;
  if (!cur) return '本掌子面尚无总工确认的级别结论';
  const prev = previousConfirm.value?.bundle.grades[0];
  if (!prev) return `首次确认结论为 ${cur.grade} 级围岩（v${confirmedRecord.value?.version}）`;
  const delta = ROCK_GRADES.indexOf(cur.grade) - ROCK_GRADES.indexOf(prev.grade);
  if (delta === 0) return `与上一版确认结论一致（${cur.grade} 级）`;
  return delta > 0
    ? `较上一版确认结论变差 ${delta} 级：${prev.grade} → ${cur.grade}`
    : `较上一版确认结论变好 ${-delta} 级：${prev.grade} → ${cur.grade}`;
});

/* ---------------- 总工确认 / 退回 ---------------- */

const REVIEWER_LS_KEY = 'gbtunnelface:reviewer';

const actionVisible = ref<'confirm' | 'reject' | null>(null);
const actionReviewer = ref('');
const actionComment = ref('');
const actionError = ref('');
const submitting = ref(false);

function openAction(action: 'confirm' | 'reject') {
  if (!face.value || face.value.reviewStatus === 'confirmed') return;
  actionVisible.value = action;
  actionReviewer.value = window.localStorage.getItem(REVIEWER_LS_KEY) ?? '项目总工';
  actionComment.value = '';
  actionError.value = '';
}

async function submitAction() {
  if (!face.value || !actionVisible.value) return;
  actionError.value = '';
  if (!actionReviewer.value.trim()) {
    actionError.value = '请填写复核人（项目总工）姓名';
    return;
  }
  if (actionVisible.value === 'reject' && !actionComment.value.trim()) {
    actionError.value = '退回时必须写明复核意见，便于地质员整改';
    return;
  }
  submitting.value = true;
  try {
    if (actionVisible.value === 'confirm') {
      const record = await reviewStore.confirm(face.value, actionReviewer.value, actionComment.value);
      ElMessage.success(`已确认 v${record.version}，台账结论以本版整份记录为准`);
    } else {
      await reviewStore.reject(face.value, actionReviewer.value, actionComment.value);
      ElMessage.success('已退回并记录意见');
    }
    window.localStorage.setItem(REVIEWER_LS_KEY, actionReviewer.value.trim());
    actionVisible.value = null;
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    submitting.value = false;
  }
}

/* ---------------- 版本快照查看 ---------------- */

const snapshot = ref<ReviewRecord | null>(null);
function openSnapshot(record: ReviewRecord) {
  snapshot.value = record;
}

/* ---------------- 基本信息编辑（改动已确认记录会转回待复核） ---------------- */

const editVisible = ref(false);
const editError = ref('');
const editForm = reactive({
  faceNo: '',
  chainage: 0,
  mileageRange: [0, 0] as [number, number],
  excavationMethod: '台阶法' as TunnelFace['excavationMethod'],
  faceSize: '',
  lithology: '',
  weathering: '微风化' as TunnelFace['weathering'],
  rockStrength: 0,
  attitude: { strike: 0, dipDirection: 0, dipAngle: 0 },
});

const BASIC_FIELD_LABELS: Record<keyof typeof editForm, string> = {
  faceNo: '掌子面编号',
  chainage: '里程桩号',
  mileageRange: '编录里程区间',
  excavationMethod: '开挖方式',
  faceSize: '断面尺寸',
  lithology: '岩性',
  weathering: '风化程度',
  rockStrength: '饱和抗压强度',
  attitude: '岩层产状',
};

function openEdit() {
  if (!face.value) return;
  const f = face.value;
  editForm.faceNo = f.faceNo;
  editForm.chainage = f.chainage;
  editForm.mileageRange = [...f.mileageRange] as [number, number];
  editForm.excavationMethod = f.excavationMethod;
  editForm.faceSize = f.faceSize;
  editForm.lithology = f.lithology;
  editForm.weathering = f.weathering;
  editForm.rockStrength = f.rockStrength;
  editForm.attitude = { ...f.attitude };
  editError.value = '';
  editVisible.value = true;
}

async function submitEdit() {
  if (!face.value) return;
  editError.value = '';
  if (!editForm.faceNo.trim()) {
    editError.value = '掌子面编号必填';
    return;
  }
  if (
    faceStore.items.some(
      (it) => it.id !== face.value!.id && it.faceNo === editForm.faceNo.trim(),
    )
  ) {
    editError.value = '掌子面编号已存在，请更换';
    return;
  }
  if (editForm.mileageRange[1] < editForm.mileageRange[0]) {
    editError.value = '编录里程区间终点不能小于起点';
    return;
  }
  if (editForm.rockStrength <= 0 || editForm.rockStrength > 300) {
    editError.value = '饱和抗压强度需在 0 ~ 300 MPa 之间';
    return;
  }

  // 找出发生变化的字段用于改动清单
  const before = face.value;
  const changed: string[] = [];
  (Object.keys(BASIC_FIELD_LABELS) as (keyof typeof editForm)[]).forEach((key) => {
    const oldVal = key === 'mileageRange' || key === 'attitude' ? JSON.stringify(before[key]) : before[key];
    const newVal = key === 'mileageRange' || key === 'attitude' ? JSON.stringify(editForm[key]) : editForm[key];
    if (oldVal !== newVal) changed.push(BASIC_FIELD_LABELS[key]);
  });
  if (changed.length === 0) {
    editVisible.value = false;
    return;
  }

  const patchData: Partial<TunnelFace> = {
    faceNo: editForm.faceNo.trim(),
    chainage: editForm.chainage,
    mileageRange: [...editForm.mileageRange] as [number, number],
    excavationMethod: editForm.excavationMethod,
    faceSize: editForm.faceSize,
    lithology: editForm.lithology,
    weathering: editForm.weathering,
    rockStrength: editForm.rockStrength,
    attitude: { ...editForm.attitude },
  };
  await faceStore.update(before.id, patchData);
  await touchAndNotify(before.id, 'basic', `修改基本信息：${changed.join('、')}`);
  editVisible.value = false;
  ElMessage.success('基本信息已保存');
}

onMounted(async () => {
  await faceStore.load();
  await jointStore.load();
  await gradeStore.load();
  await reviewStore.load();
  if (face.value) {
    patch({ rockStrength: face.value.rockStrength, spanWidth: Number(face.value.faceSize.split('×')[0]) || 12 });
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>掌子面详情 · {{ face?.faceNo ?? '未找到' }}</h2>
      <ReviewBadge
        v-if="face"
        :status="face.reviewStatus"
        :version="face.confirmedVersion"
        :comment="face.reviewComment"
        size="large"
      />
      <GradeTag v-if="effectiveGrade" :grade="effectiveGrade" />
      <el-tag v-else type="warning" effect="plain">台账暂无生效级别</el-tag>
      <el-tag type="info" effect="plain">节理 {{ joints.length }} 组</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="router.push(`/faces/${faceId}/joints`)">节理录入</el-button>
      <el-button @click="router.push(`/faces/${faceId}/water`)">涌水记录</el-button>
      <el-button @click="router.push(`/grade/${faceId}`)">围岩级别判定</el-button>
      <el-button @click="router.push('/faces')">返回台账</el-button>
    </div>

    <el-alert v-if="!face" type="warning" :closable="false" show-icon title="未找到该掌子面（可能已被删除）" />

    <template v-if="face">
      <!-- 单循环校审 -->
      <el-card shadow="never" class="review-card">
        <template #header>
          <div class="card-head">
            <strong>单循环校审</strong>
            <ReviewBadge
              :status="face.reviewStatus"
              :version="face.confirmedVersion"
              :comment="face.reviewComment"
            />
            <span v-if="face.reviewedAt" class="muted">
              最近校审 {{ new Date(face.reviewedAt).toLocaleString('zh-CN') }}
              <template v-if="face.reviewer">· {{ face.reviewer }}</template>
            </span>
          </div>
        </template>

        <el-alert
          v-if="face.reviewStatus === 'rejected' && face.reviewComment"
          type="error"
          :closable="false"
          show-icon
          class="reject-alert"
          :title="`退回意见${face.reviewer ? `（${face.reviewer}）` : ''}：${face.reviewComment}`"
          description="请按意见修改基本信息、节理、涌水或围岩判定后重新提交确认"
        />
        <el-alert
          v-else-if="face.reviewStatus === 'pending' && face.confirmedVersion > 0"
          type="warning"
          :closable="false"
          show-icon
          title="已有确认版本被改动，当前内容待总工复核"
          description="复核通过前台账仍按上一版确认结论，下方改动清单可查看差异"
        />
        <el-alert
          v-else-if="face.reviewStatus === 'pending'"
          type="info"
          :closable="false"
          show-icon
          title="本循环编录已提交，等待项目总工复核"
        />
        <el-alert
          v-else
          type="success"
          :closable="false"
          show-icon
          :title="`总工已确认 v${face.confirmedVersion}，台账结论以当时整份记录为准`"
          description="此后如修改基本信息、节理、涌水或围岩判定，记录将自动转回待复核，上一版快照保留在下方版本记录"
        />

        <div v-if="face.pendingChanges.length" class="changes">
          <div class="changes-title">未确认改动（{{ face.pendingChanges.length }}）</div>
          <el-tag
            v-for="(c, i) in face.pendingChanges"
            :key="i"
            size="small"
            class="change-tag"
            :type="c.kind === 'grade' ? 'warning' : 'info'"
          >
            {{ PENDING_CHANGE_KIND_LABEL[c.kind] }} · {{ c.detail }}
            <span class="muted">{{ new Date(c.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
          </el-tag>
        </div>

        <div class="review-actions">
          <el-button
            type="success"
            :disabled="face.reviewStatus === 'confirmed'"
            @click="openAction('confirm')"
          >
            总工确认
          </el-button>
          <el-button
            type="danger"
            plain
            :disabled="face.reviewStatus === 'confirmed'"
            @click="openAction('reject')"
          >
            退回修改
          </el-button>
          <span v-if="face.reviewStatus === 'confirmed'" class="muted">
            需修改时直接改动各编录内容即可，系统会自动转回待复核
          </span>
        </div>

        <el-divider content-position="left">校审与版本记录</el-divider>
        <el-timeline v-if="reviewHistory.length" class="timeline">
          <el-timeline-item
            v-for="r in reviewHistory"
            :key="r.id"
            :type="r.action === 'confirm' ? 'success' : 'danger'"
            :timestamp="`#${r.seq} · ${new Date(r.actedAt).toLocaleString('zh-CN')}`"
          >
            <div class="tl-row">
              <el-tag :type="r.action === 'confirm' ? 'success' : 'danger'" size="small">
                {{ REVIEW_ACTION_LABEL[r.action]
                }}<template v-if="r.action === 'confirm'"> v{{ r.version }}</template>
              </el-tag>
              <span class="muted">{{ r.reviewer }}</span>
              <el-button link type="primary" size="small" @click="openSnapshot(r)">查看当时整份记录</el-button>
            </div>
            <div v-if="r.comment" class="tl-comment">“{{ r.comment }}”</div>
            <div v-else-if="r.action === 'confirm'" class="muted">
              锁定级别
              <GradeTag
                v-if="r.bundle.grades[0]"
                :grade="r.bundle.grades[0].grade"
                style="margin-left: 6px"
              />
              <span v-else class="muted" style="margin-left: 6px">（当时未判定级别）</span>
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="尚无校审记录" :image-size="50" />
      </el-card>

      <div class="grid">
        <div class="left">
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <strong>基本信息</strong>
                <el-button link type="primary" size="small" @click="openEdit">编辑基本信息</el-button>
              </div>
            </template>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="掌子面编号">{{ face.faceNo }}</el-descriptions-item>
              <el-descriptions-item label="里程桩号">{{ formatChainage(face.chainage) }}</el-descriptions-item>
              <el-descriptions-item label="编录里程区间">
                {{ formatChainage(face.mileageRange[0]) }} ~ {{ formatChainage(face.mileageRange[1]) }}
              </el-descriptions-item>
              <el-descriptions-item label="开挖方式">{{ face.excavationMethod }}</el-descriptions-item>
              <el-descriptions-item label="开挖断面尺寸">{{ face.faceSize }} m</el-descriptions-item>
              <el-descriptions-item label="岩性 / 风化">{{ face.lithology }} / {{ face.weathering }}</el-descriptions-item>
              <el-descriptions-item label="饱和抗压强度">{{ face.rockStrength }} MPa</el-descriptions-item>
              <el-descriptions-item label="岩层产状">
                走向 {{ face.attitude.strike }}° · {{ attitudeText(face.attitude.dipDirection, face.attitude.dipAngle) }}
              </el-descriptions-item>
              <el-descriptions-item label="地质员">{{ face.geologist }}</el-descriptions-item>
              <el-descriptions-item label="编录时间">
                {{ new Date(face.recordedAt).toLocaleString('zh-CN') }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never">
            <template #header><strong>台账结论（最近总工确认）</strong></template>
            <div v-if="confirmedGrade" class="grade-box">
              <div class="grade-line">
                <GradeTag :grade="confirmedGrade.grade" />
                <el-tag type="success" size="small" effect="plain">
                  v{{ confirmedRecord?.version }} · {{ confirmedRecord?.reviewer }} 确认
                </el-tag>
              </div>
              <span class="muted">[BQ] = {{ confirmedGrade.correctedBq }}（BQ {{ confirmedGrade.bqValue }}，修正 {{ confirmedGrade.correction }}）</span>
              <p class="support">{{ confirmedGrade.supportSuggestion || GRADE_SUPPORT[confirmedGrade.grade] }}</p>
              <p class="muted">{{ gradeCompare }}</p>
              <el-button link type="primary" size="small" @click="openSnapshot(confirmedRecord!)">
                查看确认时整份记录
              </el-button>
            </div>
            <el-alert
              v-else
              type="warning"
              :closable="false"
              show-icon
              title="本循环尚未经总工确认，台账暂无生效级别结论"
            />

            <el-divider content-position="left">当前编录（未经确认不影响台账）</el-divider>
            <div v-if="latest" class="grade-box">
              <div class="grade-line">
                <GradeTag :grade="latest.grade" />
                <el-tag size="small" :type="face.reviewStatus === 'confirmed' ? 'success' : 'warning'">
                  {{ face.reviewStatus === 'confirmed' ? '即确认版本' : '待复核，未生效' }}
                </el-tag>
              </div>
              <span class="muted">[BQ] = {{ latest.correctedBq }}（BQ {{ latest.bqValue }}，修正 {{ latest.correction }}）</span>
            </div>
            <div v-else>
              <p class="muted">尚未保存级别判定，按当前参数实时试算（仅供参考）：</p>
              <GradeTag :grade="result.grade" />
              <p class="support">{{ result.support }}</p>
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header><strong>节理组列表（{{ joints.length }} 组）</strong></template>
            <el-table :data="joints" size="small" border>
              <el-table-column label="组号" width="70">
                <template #default="{ row }">J{{ row.setNo }}</template>
              </el-table-column>
              <el-table-column label="产状" width="140">
                <template #default="{ row }">{{ attitudeText(row.dipDirection, row.dipAngle) }}</template>
              </el-table-column>
              <el-table-column prop="spacing" label="间距 cm" width="90" />
              <el-table-column prop="persistence" label="延伸 m" width="90" />
              <el-table-column prop="aperture" label="张开 mm" width="90" />
              <el-table-column prop="fillMaterial" label="充填" width="90" />
              <el-table-column prop="waterWet" label="渗水" width="90" />
              <el-table-column prop="jointCount" label="条数" width="80" />
            </el-table>
            <el-empty v-if="joints.length === 0" description="暂无节理组记录" :image-size="60" />
          </el-card>
        </div>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>岩性素描图</strong>
              <span class="muted">已布置 {{ segmentCount }} 条结构面线段（自动保存在浏览器本地）</span>
            </div>
          </template>
          <SketchCanvas
            :face-id="face.id"
            :lithology="face.lithology"
            :attitude="face.attitude"
            @change="onSketchChange"
          />
        </el-card>
      </div>
    </template>

    <!-- 总工确认 / 退回 -->
    <el-dialog
      :model-value="actionVisible !== null"
      :title="actionVisible === 'confirm' ? '总工确认整份编录' : '退回地质员修改'"
      width="520px"
      @update:model-value="(v: boolean) => !v && (actionVisible = null)"
    >
      <el-alert v-if="actionError" :title="actionError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-alert
        v-if="actionVisible === 'confirm'"
        type="info"
        :closable="false"
        style="margin-bottom: 12px"
        title="确认将锁定此刻的整份记录（基本信息、节理、涌水、围岩判定）作为台账生效版本"
      />
      <el-form label-width="92px">
        <el-form-item label="复核人" required>
          <el-input v-model="actionReviewer" placeholder="项目总工姓名" />
        </el-form-item>
        <el-form-item :label="actionVisible === 'reject' ? '退回意见' : '备注'">
          <el-input
            v-model="actionComment"
            type="textarea"
            :rows="3"
            :placeholder="actionVisible === 'reject' ? '必填：写明需整改的问题，如节理产状与素描不符、涌水量异常等' : '可选'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="actionVisible = null">取消</el-button>
        <el-button
          :type="actionVisible === 'confirm' ? 'success' : 'danger'"
          :loading="submitting"
          @click="submitAction"
        >
          {{ actionVisible === 'confirm' ? '确认通过' : '退回修改' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 基本信息编辑 -->
    <el-dialog v-model="editVisible" v-if="face" title="编辑基本信息" width="680px">
      <el-alert
        v-if="face.reviewStatus !== 'pending'"
        type="warning"
        :closable="false"
        style="margin-bottom: 10px"
        :title="face.reviewStatus === 'confirmed' ? '本版已总工确认，保存后将转回待复核并保留上一版快照' : '记录处于退回状态，保存后将重新回到待复核'"
      />
      <el-alert v-if="editError" :title="editError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form :model="editForm" label-width="120px">
        <el-form-item label="掌子面编号" required>
          <el-input v-model="editForm.faceNo" placeholder="如 ZK-104" />
        </el-form-item>
        <el-form-item label="里程桩号 m">
          <el-input-number v-model="editForm.chainage" :min="0" :max="999999" :step="1" />
          <span class="hint">{{ formatChainage(editForm.chainage) }}</span>
        </el-form-item>
        <el-form-item label="编录里程区间 m">
          <el-input-number v-model="editForm.mileageRange[0]" :min="0" :max="999999" />
          <span style="margin: 0 6px">—</span>
          <el-input-number v-model="editForm.mileageRange[1]" :min="0" :max="999999" />
        </el-form-item>
        <el-form-item label="开挖方式">
          <el-select v-model="editForm.excavationMethod">
            <el-option v-for="m in EXCAVATION_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="断面尺寸 m">
          <el-input v-model="editForm.faceSize" placeholder="宽×高，如 12.6×9.8" />
        </el-form-item>
        <el-form-item label="岩性">
          <el-select v-model="editForm.lithology">
            <el-option v-for="l in LITHOLOGIES" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="风化程度">
          <el-select v-model="editForm.weathering">
            <el-option v-for="w in WEATHERINGS" :key="w" :label="w" :value="w" />
          </el-select>
        </el-form-item>
        <el-form-item label="饱和抗压强度">
          <el-input-number v-model="editForm.rockStrength" :min="1" :max="300" :step="1" />
          <span class="hint">MPa</span>
        </el-form-item>
        <el-form-item label="岩层产状">
          <span class="hint">走向</span>
          <el-input-number v-model="editForm.attitude.strike" :min="0" :max="360" />
          <span class="hint">倾向</span>
          <el-input-number v-model="editForm.attitude.dipDirection" :min="0" :max="360" />
          <span class="hint">倾角</span>
          <el-input-number v-model="editForm.attitude.dipAngle" :min="0" :max="90" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="submitEdit">保存修改</el-button>
      </template>
    </el-dialog>

    <!-- 历史版本快照 -->
    <el-drawer
      v-model="snapshot"
      :title="snapshot
        ? `${snapshot.action === 'confirm' ? `确认版本 v${snapshot.version}` : '退回记录'} · ${new Date(snapshot.actedAt).toLocaleString('zh-CN')}`
        : ''"
      size="640px"
    >
      <template v-if="snapshot">
        <div class="snapshot-meta muted">校审人：{{ snapshot.reviewer }} · 记录序号 #{{ snapshot.seq }}</div>
        <el-alert
          v-if="snapshot.comment"
          :type="snapshot.action === 'confirm' ? 'success' : 'error'"
          :closable="false"
          class="snapshot-comment"
          :title="snapshot.comment"
        />
        <h4>基本信息</h4>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="掌子面编号">{{ snapshot.bundle.face.faceNo }}</el-descriptions-item>
          <el-descriptions-item label="里程桩号">{{ formatChainage(snapshot.bundle.face.chainage) }}</el-descriptions-item>
          <el-descriptions-item label="编录里程区间">
            {{ formatChainage(snapshot.bundle.face.mileageRange[0]) }} ~
            {{ formatChainage(snapshot.bundle.face.mileageRange[1]) }}
          </el-descriptions-item>
          <el-descriptions-item label="开挖方式">{{ snapshot.bundle.face.excavationMethod }}</el-descriptions-item>
          <el-descriptions-item label="断面尺寸">{{ snapshot.bundle.face.faceSize }} m</el-descriptions-item>
          <el-descriptions-item label="岩性 / 风化">
            {{ snapshot.bundle.face.lithology }} / {{ snapshot.bundle.face.weathering }}
          </el-descriptions-item>
          <el-descriptions-item label="饱和抗压强度">{{ snapshot.bundle.face.rockStrength }} MPa</el-descriptions-item>
          <el-descriptions-item label="岩层产状">
            走向 {{ snapshot.bundle.face.attitude.strike }}° ·
            {{ attitudeText(snapshot.bundle.face.attitude.dipDirection, snapshot.bundle.face.attitude.dipAngle) }}
          </el-descriptions-item>
          <el-descriptions-item label="地质员">{{ snapshot.bundle.face.geologist }}</el-descriptions-item>
        </el-descriptions>

        <h4>围岩判定（{{ snapshot.bundle.grades.length }} 条）</h4>
        <el-table :data="snapshot.bundle.grades" size="small" border>
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ new Date(row.judgedAt).toLocaleString('zh-CN') }}</template>
          </el-table-column>
          <el-table-column label="级别" width="70">
            <template #default="{ row }"><GradeTag :grade="row.grade" /></template>
          </el-table-column>
          <el-table-column prop="bqValue" label="BQ" width="80" />
          <el-table-column prop="correctedBq" label="[BQ]" width="80" />
          <el-table-column prop="groundwater" label="出水" min-width="100" />
        </el-table>

        <h4>节理组（{{ snapshot.bundle.joints.length }} 组）</h4>
        <el-table :data="snapshot.bundle.joints" size="small" border>
          <el-table-column label="组号" width="70">
            <template #default="{ row }">J{{ row.setNo }}</template>
          </el-table-column>
          <el-table-column label="产状" min-width="130">
            <template #default="{ row }">{{ attitudeText(row.dipDirection, row.dipAngle) }}</template>
          </el-table-column>
          <el-table-column prop="spacing" label="间距 cm" width="90" />
          <el-table-column prop="fillMaterial" label="充填" width="90" />
          <el-table-column prop="waterWet" label="渗水" width="80" />
          <el-table-column prop="jointCount" label="条数" width="70" />
        </el-table>

        <h4>涌水记录（{{ snapshot.bundle.waters.length }} 条）</h4>
        <el-table :data="snapshot.bundle.waters" size="small" border>
          <el-table-column label="里程" width="110">
            <template #default="{ row }">{{ formatChainage(row.chainage) }}</template>
          </el-table-column>
          <el-table-column prop="position" label="部位" min-width="120" />
          <el-table-column prop="type" label="类型" width="80" />
          <el-table-column prop="estimatedFlow" label="L/min" width="80" />
          <el-table-column prop="changeTrend" label="趋势" width="80" />
        </el-table>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.review-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.reject-alert,
.changes {
  margin-top: 2px;
}
.changes-title {
  font-size: 13px;
  color: #5b6470;
  margin-bottom: 6px;
}
.change-tag {
  margin: 0 8px 8px 0;
}
.review-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.timeline {
  padding-left: 4px;
}
.tl-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tl-comment {
  margin-top: 4px;
  color: #b03a2e;
  font-size: 13px;
}
.grid {
  display: grid;
  grid-template-columns: 620px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.hint {
  margin-left: 8px;
  color: #97a0ad;
  font-size: 12px;
}
.support {
  margin: 8px 0;
  color: #2f3a46;
}
.grade-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.grade-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.snapshot-meta {
  margin-bottom: 8px;
}
.snapshot-comment {
  margin-bottom: 14px;
}
h4 {
  margin: 16px 0 8px;
}
</style>
