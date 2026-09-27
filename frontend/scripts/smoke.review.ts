/**
 * 单循环校审状态机冒烟测试（Node + fake-indexeddb，不走浏览器）。
 * 临时验证脚本：esbuild 打包后在 node 中运行。
 */
import './smoke.setup';

import { setActivePinia, createPinia } from 'pinia';

setActivePinia(createPinia());

import { ensureSeedData, db } from '../src/utils/db';
import { useFaceStore } from '../src/stores/faceStore';
import { useJointStore } from '../src/stores/jointStore';
import { useGradeStore } from '../src/stores/gradeStore';
import { useReviewStore } from '../src/stores/reviewStore';
import { useFaceFilter } from '../src/hooks/useFaceFilter';

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  }
}

async function main(): Promise<void> {
  await ensureSeedData();
  const faceStore = useFaceStore();
  const jointStore = useJointStore();
  const gradeStore = useGradeStore();
  const reviewStore = useReviewStore();
  await faceStore.load();
  await jointStore.load();
  await gradeStore.load();
  await reviewStore.load();

  const { result } = useFaceFilter();
  const ledgerGrade = (faceId: string) => result.value.find((r) => r.face.id === faceId)?.grade;

  const [f1, f2] = [...faceStore.items].sort((a, b) => a.chainage - b.chainage);

  console.log('— 种子数据 —');
  assert(reviewStore.statusByFace(f1.id) === 'confirmed', 'ZK-102 初始为已确认');
  assert(reviewStore.statusByFace(f2.id) === 'pending', 'ZK-103 初始为待复核');
  assert(reviewStore.latestConfirmedByFace(f1.id)?.snapshot.grade?.grade === 'Ⅲ', '确认快照级别为 Ⅲ');
  assert(ledgerGrade(f1.id) === 'Ⅲ', '台账级别 Ⅲ');

  console.log('— 已确认后改基本信息 —');
  await faceStore.update(f1.id, { lithology: '砂岩' });
  await reviewStore.touchFace(f1.id);
  assert(reviewStore.statusByFace(f1.id) === 'pending', '改动后转回待复核');
  assert(reviewStore.latestByFace(f1.id)?.round === 2, '开启第 2 轮');
  assert(reviewStore.latestConfirmedByFace(f1.id)?.round === 1, '第 1 轮确认快照保留');
  assert(reviewStore.latestConfirmedByFace(f1.id)?.snapshot.face.lithology === '石灰岩', '上一版快照岩性仍为石灰岩');
  assert(reviewStore.latestByFace(f1.id)?.snapshot.face.lithology === '砂岩', '待复核快照已是砂岩');

  console.log('— 确认前改围岩判定不影响台账结论 —');
  await gradeStore.addGrade({
    faceId: f1.id,
    grade: 'Ⅳ',
    bqValue: 300,
    rqd: 60,
    jv: 8,
    kv: 0.5,
    groundwater: '线状出水',
    spanWidth: 12.6,
    correction: 0.2,
    correctedBq: 280,
    supportSuggestion: 'test',
    manualAdjusted: false,
  });
  await reviewStore.touchFace(f1.id);
  assert(reviewStore.latestByFace(f1.id)?.round === 2, '待复核期间改动不新开轮次');
  assert(reviewStore.latestByFace(f1.id)?.snapshot.grade?.grade === 'Ⅳ', '待复核快照已含新判定 Ⅳ');
  assert(ledgerGrade(f1.id) === 'Ⅲ', '台账结论仍按上一确认版 Ⅲ');

  console.log('— 总工确认后台账更新 —');
  const okConfirm = await reviewStore.confirm(f1.id, '林正', '同意');
  assert(okConfirm === true, '确认成功');
  assert(reviewStore.statusByFace(f1.id) === 'confirmed', '状态为已确认');
  assert(ledgerGrade(f1.id) === 'Ⅳ', '台账结论更新为 Ⅳ');
  assert(reviewStore.latestConfirmedByFace(f1.id)?.snapshot.face.lithology === '砂岩', '确认的是当时整份记录（砂岩）');

  console.log('— 退回流程 —');
  const okReject = await reviewStore.reject(f2.id, '林正', '节理组产状不全，请补测');
  assert(okReject === true, '退回成功');
  assert(reviewStore.statusByFace(f2.id) === 'rejected', '状态为已退回');
  assert(reviewStore.latestByFace(f2.id)?.reviewComment === '节理组产状不全，请补测', '退回意见已留档');
  await jointStore.add({
    faceId: f2.id,
    setNo: 2,
    dipDirection: 200,
    dipAngle: 60,
    spacing: 50,
    persistence: 2,
    aperture: 1,
    fillMaterial: '无',
    roughness: '平整',
    waterWet: '潮湿',
    jointCount: 3,
  });
  await reviewStore.touchFace(f2.id);
  assert(reviewStore.statusByFace(f2.id) === 'pending', '退回后修改 → 转回待复核');
  assert(reviewStore.latestByFace(f2.id)?.round === 2, '退回后开启第 2 轮');
  assert(reviewStore.byFace(f2.id).length === 2, '历史保留 2 轮');

  console.log('— 新建编录 —');
  const created = await faceStore.add({
    faceNo: 'ZK-104',
    chainage: 12486,
    mileageRange: [12486, 12489],
    excavationMethod: '台阶法',
    faceSize: '12.6×9.8',
    lithology: '砂岩',
    weathering: '微风化',
    rockStrength: 40,
    attitude: { strike: 10, dipDirection: 100, dipAngle: 30 },
    geologist: '岑柏川',
  });
  await reviewStore.touchFace(created.id);
  assert(reviewStore.statusByFace(created.id) === 'pending', '新记录先显示待复核');
  assert(reviewStore.latestByFace(created.id)?.round === 1, '新记录为第 1 轮');

  console.log('— v2 老数据（无校审记录）—');
  await db.reviews.clear();
  reviewStore.items = [];
  assert(reviewStore.statusByFace(f1.id) === 'pending', '无记录按待复核处理');
  const okLegacy = await reviewStore.confirm(f1.id, '林正', '');
  assert(okLegacy === true, '老数据可直接确认（自动补第 1 轮）');
  assert(reviewStore.latestByFace(f1.id)?.round === 1, '补建第 1 轮即确认');

  if (failed > 0) {
    console.error(`\n${failed} 项失败`);
    process.exit(1);
  }
  console.log('\n全部通过');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
