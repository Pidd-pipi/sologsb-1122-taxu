import type { TunnelFace } from './face';
import type { JointSet } from './joint';
import type { RockMassGrade } from './grade';
import type { WaterInflow } from './water';

/** 校审状态：待复核 / 已确认 / 已退回 */
export type ReviewStatus = 'pending' | 'confirmed' | 'rejected';

export const REVIEW_STATUS_TEXT: Record<ReviewStatus, string> = {
  pending: '待复核',
  confirmed: '已确认',
  rejected: '已退回',
};

/** 状态对应的 el-tag 类型 */
export const REVIEW_STATUS_TAG: Record<ReviewStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
};

/** 提交/确认校审时的整份记录快照（基本信息 + 节理 + 涌水 + 最新围岩判定） */
export interface ReviewSnapshot {
  face: TunnelFace;
  joints: JointSet[];
  waters: WaterInflow[];
  /** 快照时的最新围岩级别判定（可能尚未判定） */
  grade?: RockMassGrade;
}

/** 单循环校审记录：每一轮复核一条，历史轮次永久保留 */
export interface ReviewRecord {
  id: string;
  faceId: string;
  /** 校审轮次，从 1 开始，每次确认/退回后再改动即开新一轮 */
  round: number;
  status: ReviewStatus;
  /** 该轮次的整份记录快照；确认轮次的快照即台账结论依据 */
  snapshot: ReviewSnapshot;
  submittedAt: number;
  /** 提交人（地质员） */
  submittedBy: string;
  reviewedAt?: number;
  /** 复核人（项目总工） */
  reviewer?: string;
  /** 复核意见（退回时必填） */
  reviewComment?: string;
}
