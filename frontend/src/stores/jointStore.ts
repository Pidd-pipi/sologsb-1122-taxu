import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { touchAndNotify } from './reviewStore';
import type { JointSet, JointSetDraft } from '../types/joint';

interface JointState {
  items: JointSet[];
  loaded: boolean;
}

export const useJointStore = defineStore('joint', {
  state: (): JointState => ({ items: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => a.setNo - b.setNo),
  },
  actions: {
    async load() {
      const rows = await db.joints.toArray();
      rows.sort((a, b) => a.setNo - b.setNo);
      this.items = rows;
      this.loaded = true;
    },
    /** 落库并同步内存的内部方法，不含校审联动 */
    async rawAdd(draft: JointSetDraft): Promise<JointSet> {
      const record: JointSet = { ...toPlain(draft), id: newId('joint') };
      await db.joints.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    async rawRemove(id: string): Promise<JointSet | undefined> {
      const removed = this.items.find((it) => it.id === id);
      await db.joints.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
      return removed;
    },
    async rawUpdate(id: string, patch: Partial<JointSet>): Promise<JointSet | undefined> {
      const before = this.items.find((it) => it.id === id);
      const plain = toPlain(patch);
      await db.joints.update(id, plain);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...plain } : it));
      return before;
    },
    async add(draft: JointSetDraft) {
      const record = await this.rawAdd(draft);
      await touchAndNotify(record.faceId, 'joint', `新增节理 J${record.setNo}`);
      return record;
    },
    async update(id: string, patch: Partial<JointSet>) {
      const before = await this.rawUpdate(id, patch);
      if (before) await touchAndNotify(before.faceId, 'joint', `修改节理 J${before.setNo}`);
    },
    async remove(id: string) {
      const removed = await this.rawRemove(id);
      if (removed) await touchAndNotify(removed.faceId, 'joint', `删除节理 J${removed.setNo}`);
    },
    /** 把同组产状合并到指定组：把被合并组的条数累加到目标组并删除被合并组 */
    async mergeInto(targetId: string, sourceIds: string[]) {
      const target = this.items.find((it) => it.id === targetId);
      if (!target) return;
      const sources = this.items.filter((it) => sourceIds.includes(it.id));
      const extra = sources.reduce((s, j) => s + j.jointCount, 0);
      await this.rawUpdate(targetId, { jointCount: target.jointCount + extra });
      for (const s of sources) {
        await this.rawRemove(s.id);
      }
      await touchAndNotify(
        target.faceId,
        'joint',
        `合并节理 ${sources.map((s) => `J${s.setNo}`).join('、')} 入 J${target.setNo}`,
      );
    },
  },
});
