import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { touchAndNotify } from './reviewStore';
import type { RockMassGrade, RockMassGradeDraft } from '../types/grade';
import type { WaterInflow, WaterInflowDraft } from '../types/water';

interface GradeState {
  items: RockMassGrade[];
  waters: WaterInflow[];
  loaded: boolean;
}

export const useGradeStore = defineStore('grade', {
  state: (): GradeState => ({ items: [], waters: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.judgedAt - a.judgedAt),
    latestByFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.judgedAt - a.judgedAt)[0],
    watersByFace: (state) => (faceId: string) =>
      state.waters.filter((it) => it.faceId === faceId).sort((a, b) => a.chainage - b.chainage),
  },
  actions: {
    async load() {
      const grades = await db.grades.toArray();
      this.items = grades.sort((a, b) => b.judgedAt - a.judgedAt);
      const waters = await db.waters.toArray();
      this.waters = waters.sort((a, b) => a.chainage - b.chainage);
      this.loaded = true;
    },
    async addGrade(draft: RockMassGradeDraft) {
      const record: RockMassGrade = { ...toPlain(draft), id: newId('grade'), judgedAt: Date.now() };
      await db.grades.put(toPlain(record));
      this.items = [record, ...this.items];
      await touchAndNotify(
        record.faceId,
        'grade',
        `${record.manualAdjusted ? '人工修正' : '保存'}围岩判定为 ${record.grade} 级`,
      );
      return record;
    },
    async addWater(draft: WaterInflowDraft) {
      const record: WaterInflow = { ...toPlain(draft), id: newId('water'), measuredAt: Date.now() };
      await db.waters.put(toPlain(record));
      this.waters = [...this.waters, record].sort((a, b) => a.chainage - b.chainage);
      await touchAndNotify(
        record.faceId,
        'water',
        `新增涌水记录：${record.position}（${record.type} ${record.estimatedFlow} L/min）`,
      );
      return record;
    },
    async removeWater(id: string) {
      const removed = this.waters.find((it) => it.id === id);
      await db.waters.delete(id);
      this.waters = this.waters.filter((it) => it.id !== id);
      if (removed) {
        await touchAndNotify(
          removed.faceId,
          'water',
          `删除涌水记录：${removed.position}（${removed.type}）`,
        );
      }
    },
  },
});
