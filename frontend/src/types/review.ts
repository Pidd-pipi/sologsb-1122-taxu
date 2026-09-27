import type { TunnelFace } from './face';
import type { JointSet } from './joint';
import type { RockMassGrade } from './grade';
import type { WaterInflow } from './water';

/** 单循环校审状态 */
export type ReviewStatus = 'pending' | 'rejected' | 'confirmed';

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '待复核',
  rejected: '已退回',
  confirmed: '已确认',
};

/** 校审动作：总工确认 / 退回 */
export type ReviewAction = 'confirm' | 'reject';

export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  confirm: '确认',
  reject: '退回',
};

/** 已确认后到下一次确认前，发生改动的台账内容分类 */
export type PendingChangeKind = 'basic' | 'joint' | 'water' | 'grade';

export const PENDING_CHANGE_KIND_LABEL: Record<PendingChangeKind, string> = {
  basic: '基本信息',
  joint: '节理',
  water: '涌水',
  grade: '围岩判定',
};

/** 一条尚未经总工确认的改动 */
export interface PendingChange {
  kind: PendingChangeKind;
  /** 改动摘要，如「新增节理 J3」 */
  detail: string;
  at: number;
}

/** 总工确认/退回那一刻，整份编录记录的全量快照 */
export interface ReviewBundle {
  face: TunnelFace;
  joints: JointSet[];
  grades: RockMassGrade[];
  waters: WaterInflow[];
}

/** 一条校审记录（确认件或退回件） */
export interface ReviewRecord {
  id: string;
  faceId: string;
  action: ReviewAction;
  /** 校审人（项目总工） */
  reviewer: string;
  /** 退回意见（退回必填）/ 确认备注 */
  comment: string;
  actedAt: number;
  /** 该掌子面校审动作序号（确认与退回统一编号，从 1 开始） */
  seq: number;
  /** 版本号：第几次确认；退回记录沿用当前已确认版本号（未确认过为 0） */
  version: number;
  /** 动作发生时的整份记录快照 */
  bundle: ReviewBundle;
}
