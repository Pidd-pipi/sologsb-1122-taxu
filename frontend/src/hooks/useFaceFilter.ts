import { computed, ref } from 'vue';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { useReviewStore } from '../stores/reviewStore';
import type { TunnelFace } from '../types/face';
import type { RockGrade } from '../types/grade';
import type { ReviewStatus } from '../types/review';

export interface FaceFilters {
  chainageFrom: number;
  chainageTo: number;
  lithology: string;
  grade: string;
  method: string;
  status: ReviewStatus | 'all';
  keyword: string;
}

export interface FaceRow {
  face: TunnelFace;
  /** 台账生效级别：只取最近一次总工确认，未确认则为空 */
  grade?: RockGrade;
  lastRecordedAt: number;
}

export const DEFAULT_FACE_FILTERS: FaceFilters = {
  chainageFrom: 0,
  chainageTo: 999999,
  lithology: 'all',
  grade: 'all',
  method: 'all',
  status: 'all',
  keyword: '',
};

/**
 * 按里程区间、岩性、围岩级别、开挖方式、校审状态过滤。
 * 围岩级别仅采用总工确认的台账生效结论。
 * 被掌子面台账（/faces）消费。
 */
export function useFaceFilter(initial?: Partial<FaceFilters>) {
  const faceStore = useFaceStore();
  const gradeStore = useGradeStore();
  const reviewStore = useReviewStore();
  const filters = ref<FaceFilters>({ ...DEFAULT_FACE_FILTERS, ...initial });

  const options = computed(() => ({
    lithologies: Array.from(new Set(faceStore.items.map((it) => it.lithology))).filter(Boolean),
    methods: Array.from(new Set(faceStore.items.map((it) => it.excavationMethod))).filter(Boolean),
    grades: Array.from(
      new Set(
        faceStore.items
          .map((it) => reviewStore.effectiveGrade(it.id))
          .filter((g): g is RockGrade => Boolean(g)),
      ),
    ),
  }));

  const result = computed<FaceRow[]>(() => {
    const f = filters.value;
    const kw = f.keyword.trim().toUpperCase();
    const rows = faceStore.items
      .filter((face) => {
        if (face.chainage < f.chainageFrom || face.chainage > f.chainageTo) return false;
        if (f.lithology !== 'all' && face.lithology !== f.lithology) return false;
        if (f.method !== 'all' && face.excavationMethod !== f.method) return false;
        if (f.status !== 'all' && face.reviewStatus !== f.status) return false;
        const grade = reviewStore.effectiveGrade(face.id);
        if (f.grade !== 'all' && grade !== f.grade) return false;
        if (kw) {
          const hit =
            face.faceNo.toUpperCase().includes(kw) ||
            face.geologist.includes(kw) ||
            face.lithology.includes(kw);
          if (!hit) return false;
        }
        return true;
      })
      .map((face) => ({
        face,
        grade: reviewStore.effectiveGrade(face.id),
        lastRecordedAt: face.recordedAt,
      }));
    rows.sort((a, b) => b.face.chainage - a.face.chainage);
    return rows;
  });

  const gradeDistribution = computed(() => {
    const order: RockGrade[] = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];
    return order.map((grade) => ({
      grade,
      count: result.value.filter((row) => row.grade === grade).length,
    }));
  });

  function reset() {
    filters.value = { ...DEFAULT_FACE_FILTERS };
  }

  return { filters, result, options, gradeDistribution, reset, faceStore, gradeStore, reviewStore };
}
