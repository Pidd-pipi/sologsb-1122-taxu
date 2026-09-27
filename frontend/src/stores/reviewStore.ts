import { defineStore } from 'pinia';
import { ElMessage } from 'element-plus';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { useFaceStore } from './faceStore';
import type {
  PendingChange,
  PendingChangeKind,
  ReviewAction,
  ReviewBundle,
  ReviewRecord,
} from '../types/review';
import type { TunnelFace } from '../types/face';
import type { RockGrade } from '../types/grade';

interface ReviewState {
  items: ReviewRecord[];
  loaded: boolean;
}

/** touch 结果：状态是否因改动而转回待复核（用于提示地质员） */
export interface TouchResult {
  flipped: boolean;
  from: 'confirmed' | 'rejected' | null;
}

/**
 * 单循环校审状态机：
 * 新记录为 pending（待复核）→ 总工 confirm（已确认）或 reject（已退回，意见必填）；
 * 已确认/已退回记录一旦改动基本信息、节理、涌水或围岩判定，立即转回 pending，
 * 同时保留上一版确认快照（reviews 表），在重新确认前台账结论不改变。
 */
export const useReviewStore = defineStore('review', {
  state: (): ReviewState => ({ items: [], loaded: false }),
  getters: {
    /** 某掌子面的全部校审记录，新的在前 */
    byFace: (state) => (faceId: string) =>
      state.items
        .filter((it) => it.faceId === faceId)
        .sort((a, b) => b.actedAt - a.actedAt),
    /** 某掌子面最近一次确认记录（含当时整份快照） */
    latestConfirm: (state) => (faceId: string) =>
      state.items
        .filter((it) => it.faceId === faceId && it.action === 'confirm')
        .sort((a, b) => b.actedAt - a.actedAt)[0],
    /** 台账生效级别：只取最近一次确认快照，确认后的未确认改动不改变台账结论 */
    effectiveGrade(): (faceId: string) => RockGrade | undefined {
      return (faceId: string) => this.latestConfirm(faceId)?.bundle?.grades
        .slice()
        .sort((a, b) => b.judgedAt - a.judgedAt)[0]?.grade;
    },
  },
  actions: {
    async load() {
      this.items = await db.reviews.toArray();
      this.loaded = true;
    },

    /** 组装动作发生时的整份记录快照 */
    async buildBundle(face: TunnelFace): Promise<ReviewBundle> {
      const [joints, grades, waters] = await Promise.all([
        db.joints.where('faceId').equals(face.id).toArray(),
        db.grades.where('faceId').equals(face.id).toArray(),
        db.waters.where('faceId').equals(face.id).toArray(),
      ]);
      return {
        face: toPlain(face),
        joints: joints.sort((a, b) => a.setNo - b.setNo),
        grades: grades.sort((a, b) => b.judgedAt - a.judgedAt),
        waters: waters.sort((a, b) => a.chainage - b.chainage),
      };
    },

    /** 把校审动作写入 reviews 表并同步到内存 */
    async writeReview(record: ReviewRecord) {
      await db.reviews.put(toPlain(record));
      this.items = [record, ...this.items.filter((it) => it.id !== record.id)];
    },

    async nextSeq(faceId: string): Promise<number> {
      const seqs = await db.reviews.where('faceId').equals(faceId).primaryKeys();
      return seqs.length + 1;
    },

    /** 总工确认：锁定当时整份记录作为台账生效版本 */
    async confirm(face: TunnelFace, reviewer: string, comment = ''): Promise<ReviewRecord> {
      if (face.reviewStatus === 'confirmed') {
        throw new Error('该记录已确认，无需重复确认');
      }
      const bundle = await this.buildBundle(face);
      const version = face.confirmedVersion + 1;
      const record: ReviewRecord = {
        id: newId('review'),
        faceId: face.id,
        action: 'confirm',
        reviewer: reviewer.trim(),
        comment: comment.trim(),
        actedAt: Date.now(),
        seq: await this.nextSeq(face.id),
        version,
        bundle,
      };
      await this.writeReview(record);
      await this.applyToFace(face.id, {
        reviewStatus: 'confirmed',
        confirmedVersion: version,
        reviewer: reviewer.trim(),
        reviewComment: '',
        reviewedAt: record.actedAt,
        pendingChanges: [],
      });
      return record;
    },

    /** 总工退回：意见必填，地质员据意见修改后重新进入待复核 */
    async reject(face: TunnelFace, reviewer: string, comment: string): Promise<ReviewRecord> {
      if (!comment.trim()) throw new Error('退回时必须填写复核意见');
      if (face.reviewStatus === 'confirmed') {
        throw new Error('已确认记录不能退回，如需改正请直接修改，系统会自动转回待复核');
      }
      const bundle = await this.buildBundle(face);
      const record: ReviewRecord = {
        id: newId('review'),
        faceId: face.id,
        action: 'reject',
        reviewer: reviewer.trim(),
        comment: comment.trim(),
        actedAt: Date.now(),
        seq: await this.nextSeq(face.id),
        version: face.confirmedVersion,
        bundle,
      };
      await this.writeReview(record);
      await this.applyToFace(face.id, {
        reviewStatus: 'rejected',
        reviewer: reviewer.trim(),
        reviewComment: comment.trim(),
        reviewedAt: record.actedAt,
        pendingChanges: face.pendingChanges,
      });
      return record;
    },

    /** 同步更新 faces 表与 faceStore 内存 */
    async applyToFace(faceId: string, patch: Partial<TunnelFace>) {
      const plain = toPlain(patch);
      await db.faces.update(faceId, plain);
      useFaceStore().applyReviewPatch(faceId, plain);
    },

    /**
     * 编录内容改动时调用。
     * - confirmed：转回待复核，上一版确认快照保留在 reviews，台账结论不变
     * - rejected：修改后回到待复核（退回意见保留在时间线）
     * - pending：仅累计未校改动
     */
    async touch(faceId: string, kind: PendingChangeKind, detail: string): Promise<TouchResult> {
      const faceStore = useFaceStore();
      const face = faceStore.byId(faceId);
      if (!face) return { flipped: false, from: null };

      const change: PendingChange = { kind, detail, at: Date.now() };
      const pendingChanges = [...face.pendingChanges, change];

      if (face.reviewStatus === 'confirmed' || face.reviewStatus === 'rejected') {
        const from = face.reviewStatus;
        await this.applyToFace(faceId, {
          reviewStatus: 'pending',
          pendingChanges,
        });
        return { flipped: true, from };
      }
      await this.applyToFace(faceId, { pendingChanges });
      return { flipped: false, from: null };
    },
  },
});

/**
 * 编录改动入口：调用 touch 并在记录从已确认/已退回转回待复核时提示。
 * 供节理、涌水、围岩判定、基本信息等写操作统一调用。
 */
export async function touchAndNotify(
  faceId: string,
  kind: PendingChangeKind,
  detail: string,
): Promise<void> {
  const result = await useReviewStore().touch(faceId, kind, detail);
  if (!result.flipped) return;
  const text = result.from === 'confirmed' ? '已确认记录' : '已退回记录';
  ElMessage.warning(`该改动已使${text}转回待复核，需重新报总工确认；台账仍按上一版确认结论`);
}
