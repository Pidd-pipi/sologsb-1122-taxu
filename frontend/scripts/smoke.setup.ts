/** 必须在任何 dexie 模块之前导入：为 Node 环境补上 IndexedDB 全局 */
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

(globalThis as any).indexedDB = indexedDB;
(globalThis as any).IDBKeyRange = IDBKeyRange;
