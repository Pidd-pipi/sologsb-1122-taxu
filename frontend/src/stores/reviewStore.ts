import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { useFaceStore } from './faceStore';
import { useJointStore } from './jointStore';
import { useGradeStore } from './gradeStore';
import type { ReviewRecord, ReviewSnapshot, ReviewStatus } from '../types/review';

interface ReviewState {
  items: ReviewRecord[];
  loaded: boolean;
}

/**
 * 单循环校审：每个掌子面同一时刻只有最新一轮生效。
 * - 新建编录 / 已确认（或已退回）后再改动 → 开启新一轮「待复核」，上一轮快照留档；
 * - 待复核期间继续改动 → 只刷新当前轮快照，不新开轮次；
 * - 总工确认时按当时整份记录冻结快照，台账结论以最近一轮「已确认」快照为准。
 */
export const useReviewStore = defineStore('review', {
  state: (): ReviewState => ({ items: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.round - a.round),
    latestByFace: (state) => (faceId: string): ReviewRecord | undefined =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.round - a.round)[0],
    statusByFace: (state) => (faceId: string): ReviewStatus => {
      const latest = state.items
        .filter((it) => it.faceId === faceId)
        .sort((a, b) => b.round - a.round)[0];
      return latest?.status ?? 'pending';
    },
    /** 最近一轮已确认记录（台账结论依据），可能为空 */
    latestConfirmedByFace: (state) => (faceId: string): ReviewRecord | undefined =>
      state.items
        .filter((it) => it.faceId === faceId && it.status === 'confirmed')
        .sort((a, b) => b.round - a.round)[0],
  },
  actions: {
    async load() {
      const rows = await db.reviews.toArray();
      rows.sort((a, b) => b.submittedAt - a.submittedAt);
      this.items = rows;
      this.loaded = true;
    },
    async ensureLoaded() {
      if (!this.loaded) await this.load();
    },
    /** 取当前整份记录快照（基本信息 + 节理 + 涌水 + 最新围岩判定） */
    buildSnapshot(faceId: string): ReviewSnapshot | undefined {
      const faceStore = useFaceStore();
      const jointStore = useJointStore();
      const gradeStore = useGradeStore();
      const face = faceStore.byId(faceId);
      if (!face) return undefined;
      return toPlain({
        face,
        joints: jointStore.byFace(faceId),
        waters: gradeStore.watersByFace(faceId),
        grade: gradeStore.latestByFace(faceId),
      });
    },
    /**
     * 编录内容发生变化（基本信息 / 节理 / 涌水 / 围岩判定）后调用：
     * 已确认或已退回 → 自动转回新一轮待复核，上一版快照留在历史中；
     * 待复核 → 刷新当前轮快照；无记录 → 建立第 1 轮。
     */
    async touchFace(faceId: string) {
      await this.ensureLoaded();
      const snapshot = this.buildSnapshot(faceId);
      if (!snapshot) return undefined;
      const now = Date.now();
      const actor = snapshot.face.geologist;
      const latest = this.latestByFace(faceId);
      if (latest && latest.status === 'pending') {
        const patch = { snapshot, submittedAt: now, submittedBy: actor };
        await db.reviews.update(latest.id, toPlain(patch));
        this.items = this.items.map((it) => (it.id === latest.id ? { ...it, ...patch } : it));
        return this.items.find((it) => it.id === latest.id);
      }
      const record: ReviewRecord = {
        id: newId('review'),
        faceId,
        round: (latest?.round ?? 0) + 1,
        status: 'pending',
        snapshot,
        submittedAt: now,
        submittedBy: actor,
      };
      await db.reviews.put(toPlain(record));
      this.items = [record, ...this.items];
      return record;
    },
    /** 总工确认：按当时整份记录冻结快照 */
    async confirm(faceId: string, reviewer: string, comment: string) {
      await this.ensureLoaded();
      // 老数据可能还没有校审记录，先补建第 1 轮待复核
      const latest = this.latestByFace(faceId) ?? (await this.touchFace(faceId));
      if (!latest || latest.status !== 'pending') return false;
      const snapshot = this.buildSnapshot(faceId);
      if (!snapshot) return false;
      const patch: Partial<ReviewRecord> = {
        status: 'confirmed',
        snapshot,
        reviewedAt: Date.now(),
        reviewer,
        reviewComment: comment,
      };
      await db.reviews.update(latest.id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === latest.id ? { ...it, ...patch } : it));
      return true;
    },
    /** 总工退回：必须写明意见，快照定格在退回时刻 */
    async reject(faceId: string, reviewer: string, comment: string) {
      await this.ensureLoaded();
      const latest = this.latestByFace(faceId) ?? (await this.touchFace(faceId));
      if (!latest || latest.status !== 'pending') return false;
      const snapshot = this.buildSnapshot(faceId);
      if (!snapshot) return false;
      const patch: Partial<ReviewRecord> = {
        status: 'rejected',
        snapshot,
        reviewedAt: Date.now(),
        reviewer,
        reviewComment: comment,
      };
      await db.reviews.update(latest.id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === latest.id ? { ...it, ...patch } : it));
      return true;
    },
  },
});
