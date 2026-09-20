(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('sci_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sci_' + k, JSON.stringify(v)); } catch (e) {} },
};

// 공개본(GitHub Pages)은 데이터가 비밀번호로 암호화되어 있음: window.SCI_ENC
const ENC = window.SCI_ENC || null;
async function hashPw(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sci-tool:' + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const storedHash = async () => store.get('pwHash', null) || hashPw('7890');

function boot(D) {

/* =========================================================
   1. 데이터 준비
   ========================================================= */
const LV = {2:'전사', 3:'사업부', 4:'실', 5:'팀', 6:'그룹', 7:'파트', 8:'섹션'};
const CATS = ['C1','C2','C3','C4','C5','C6','C7','C8','C9','C10'];
const catName = c => D.categories[c][0];
const ITEMS = D.items.map(x => x[0]);
const Q = D.questions.map(q => q[0]);
const qShort = k => Q[k].length > 30 ? Q[k].slice(0, 29) + '…' : Q[k];

// 항목 ↔ 자유기술 주제 (브리핑의 주제 관찰용)
const ITEM_CATS = [['C2','C1'],['C1'],['C10','C4'],['C2'],['C3'],['C7','C9'],['C4'],['C4','C7'],['C5'],['C5','C9'],['C6'],['C6','C8']];
// 과제 근거: 해당 이슈를 직접 묻는 문항(0부터) / 포괄 지표 문항
const DQ = { C1: [3, 4, 2], C2: [1], C3: [10, 11], C4: [16, 17, 15, 18, 5], C5: [23, 25, 12], C6: [26, 28], C7: [13, 27], C8: [], C9: [14], C10: [6, 7, 8] };
const REF_Q = [9, 19, 29];
const SRC = { LLM: 'LLM 개별 분석', '사전': 'AI 사전 분류', '규칙': '규칙 기반 임시 분류', '검토': '사람 검토 완료' };
const SENTS = ['긍정', '중립', '혼합', '판단보류', '부정'];
const SENT_KEY = { '긍정': 'P', '중립': 'U', '혼합': 'M', '판단보류': 'H', '부정': 'N' };
const SENT_COLOR = { P: 'var(--pos)', U: '#b8bfca', M: '#8b7fd1', H: '#dfe3e8', N: 'var(--neg)' };
const TYPES = ['칭찬·인정', '감사·격려', '문제 제기', '개선 요청', '의견 없음'];
const SIG = { 2: '우선 검토', 1: '일반 검토' };
const SCOPE = { org: '선택 조직', sub: '예하조직 포함', all: '전사 전체' };

const O = D.orgs.map((r, i) => ({ i, level: r[0], name: r[1], code: r[2], target: r[3], resp: r[4],
  rate: r[3] ? r[4] / r[3] : 0, t: [r[5], r[6], r[7]], area: r[8], areaPrev: r[9], items: r[10], qs: r[11],
  parent: r[12], leader: r[13] || '', kids: [], end: i + 1 }));
O.forEach(o => { if (o.parent >= 0) O[o.parent].kids.push(o.i); });
for (let i = O.length - 1; i >= 0; i--) { const o = O[i]; o.end = o.kids.length ? O[o.kids[o.kids.length - 1]].end : i + 1; }

// text: [org, qtype, core, raw, signal, keywords, intensity, reason] / core: [cat, sent, type, summary, src]
const T = D.texts, C = D.cores;
const tOrder = T.map((_, i) => i).sort((a, b) => T[a][0] - T[b][0] || a - b);
const tStart = new Int32Array(O.length + 1);
{ let p = 0; for (let i = 0; i <= O.length; i++) { while (p < tOrder.length && T[tOrder[p]][0] < i) p++; tStart[i] = p; } }
const textsIn = i => tOrder.slice(tStart[i], tStart[O[i].end]);
const ownTexts = i => textsIn(i).filter(ti => T[ti][0] === i);

const settings = { get minN() { return store.get('minN', 5); }, get minRaw() { return Math.max(store.get('minRaw', 10), this.minN); } };
const ok = o => o.resp >= settings.minN;
const rawOk = o => o.resp >= settings.minRaw;
const caution = o => ok(o) && (o.resp < 10 || o.rate < 0.5);

// 사람 검토(오분류 수정) — 이 PC에 저장, 내보내기 후 빌드에 반영
let OVR = store.get('overrides', {});
const tkey = ti => O[T[ti][0]].code + '|' + T[ti][3];
const cls = ti => { const v = OVR[tkey(ti)]; return v ? [v.category, v.sentiment, v.type, v.summary, '검토'] : C[T[ti][2]]; };
let hasOvr = Object.keys(OVR).length > 0;
const clsFast = ti => hasOvr ? cls(ti) : C[T[ti][2]];

const aggCache = new Map();
function agg(i) {
  if (aggCache.has(i)) return aggCache.get(i);
  const blank = () => ({ n: 0, none: 0, P: 0, U: 0, M: 0, H: 0, N: 0, req: 0, iss: 0, sum: {} });
  const a = Object.assign(blank(), { hi: 0, mid: 0, q: [0, 0, 0], cat: {}, src: {} });
  Object.keys(D.categories).forEach(c => a.cat[c] = blank());
  for (const ti of textsIn(i)) {
    const t = T[ti], c = clsFast(ti), ca = a.cat[c[0]] || a.cat.C0;
    a.n++; ca.n++; a.q[t[1]]++; a.src[c[4]] = (a.src[c[4]] || 0) + 1;
    if (t[4] === 2) a.hi++; else if (t[4] === 1) a.mid++;
    if (c[2] === '의견 없음') { a.none++; ca.none++; continue; }
    const k = SENT_KEY[c[1]] || 'H'; a[k]++; ca[k]++;
    const req = c[2] === '개선 요청';
    if (req) { a.req++; ca.req++; }
    if (k === 'N' || k === 'M' || req) { a.iss++; ca.iss++; }
    const s = ca.sum[c[3]] || (ca.sum[c[3]] = { n: 0, sent: c[1], type: c[2], cat: c[0] }); s.n++;
  }
  a.content = a.n - a.none;
  aggCache.set(i, a); return a;
}
const resetAgg = () => { aggCache.clear(); if (typeof segCache !== 'undefined') segCache.clear(); hasOvr = Object.keys(OVR).length > 0; };
const isIssue = s => s.sent === '부정' || s.sent === '혼합' || s.type === '개선 요청';
function topSummaries(a, pred, n) {
  const all = [];
  for (const c of [...CATS, 'C0']) for (const [k, s] of Object.entries(a.cat[c].sum)) if (pred(s)) all.push([k, s.n, s.cat, s.sent]);
  return all.sort((x, y) => y[1] - x[1]).slice(0, n);
}

/* =========================================================
   2. 분석 로직 (수치 → 관찰 → 제안)
   ========================================================= */
const f1 = v => v == null ? '-' : (+v).toFixed(1);
const num = v => (+v).toLocaleString('ko-KR');
const pct = v => (isFinite(v) ? Math.round(v * 100) : 0) + '%';
const sg = v => v == null ? '-' : (v > 0 ? '+' : '') + (+v).toFixed(1);
const dl = v => v == null ? '<span class="flat">-</span>' : `<span class="${v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat'}">${v > 0.05 ? '▲' : v < -0.05 ? '▼' : '–'} ${Math.abs(v).toFixed(1)}</span>`;
const sgw = v => Math.abs(v) < 0.05 ? '변동 없음' : `${Math.abs(v).toFixed(1)}점 ${v > 0 ? '상승' : '하락'}`;
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

function bench(o) {
  if (o.i === 0) return { label: '전사 평균', items: ITEMS.map(() => mean(o.items)), qs: o.qs.map(() => mean(o.qs)) };
  return { label: '전사', items: O[0].items, qs: O[0].qs };
}
const gaps = o => { const b = bench(o); return o.items.map((v, k) => v - b.items[k]); };

function rankInLevel(o) {
  const peers = O.filter(x => x.level === o.level && ok(x)).sort((a, b) => b.t[0] - a.t[0]);
  const r = peers.indexOf(o) + 1;
  return { r, n: peers.length, top: peers.length ? r / peers.length : 0 };
}

function risks(o) {
  const r = [], a = agg(o.i), b = bench(o), d1 = o.t[0] - o.t[1];
  if (d1 <= -3) r.push(['high', '종합점수 전년 대비 큰 폭 하락', `2025 ${f1(o.t[1])}점 → 2026 ${f1(o.t[0])}점 (${sg(d1)}점)`, 'org']);
  else if (d1 <= -1.5) r.push(['mid', '종합점수 전년 대비 하락', `2025 ${f1(o.t[1])}점 → 2026 ${f1(o.t[0])}점 (${sg(d1)}점)`, 'org']);
  if (o.i !== 0 && o.t[0] - O[0].t[0] <= -3) r.push(['mid', '전사 대비 종합점수 낮음', `전사 ${f1(O[0].t[0])}점 대비 ${sg(o.t[0] - O[0].t[0])}점`, 'org']);
  o.area.forEach((v, k) => { const d = v - o.areaPrev[k]; if (d <= -3) r.push(['mid', `'${D.areas[k]}' 영역 하락`, `${f1(o.areaPrev[k])} → ${f1(v)}점 (${sg(d)})`, 'org']); });
  const weak = gaps(o).map((v, k) => [k, v]).filter(x => x[1] <= -5).sort((x, y) => x[1] - y[1]);
  if (weak.length) r.push([weak[0][1] <= -10 ? 'high' : 'mid', `항목 점수 낮음 ${weak.length}개 (${b.label} 대비 -5점 이하)`, weak.map(([k, v]) => `${ITEMS[k]} ${f1(o.items[k])}(${sg(v)})`).join(', '), 'org']);
  if (o.rate < 0.7) r.push(['mid', '응답률 낮음', `${pct(o.rate)} (${num(o.resp)}/${num(o.target)}명) · 대표성 해석 주의`, 'org']);
  const co = agg(0);
  if (o.i !== 0 && a.content >= 10 && a.N / a.content - co.N / co.content >= 0.1) r.push(['mid', '자유기술 부정 비중 높음', `${pct(a.N / a.content)} (전사 ${pct(co.N / co.content)}) · 분모: 내용 있는 응답`, 'sub']);
  if (a.hi) r.push(['high', `우선 검토 신호 ${a.hi}건`, '괴롭힘·차별 등 표현이 포함된 응답 · 사실 판단 전 HR 검토 필요', 'sub']);
  return r.sort((x, y) => (x[0] === 'high' ? 0 : 1) - (y[0] === 'high' ? 0 : 1));
}

function briefing(o) {
  const a = agg(o.i), g = gaps(o), b = bench(o), d1 = o.t[0] - o.t[1];
  const idx = g.map((_, k) => k).sort((x, y) => g[y] - g[x]);
  const st = idx.slice(0, 2).filter(k => g[k] > 0), wk = idx.slice(-2).reverse().filter(k => g[k] < 0);
  const issues = CATS.map(c => [c, a.cat[c].iss]).sort((x, y) => y[1] - x[1]);
  const sec = [];
  sec.push(['수치', `2026 종합점수 ${f1(o.t[0])}점으로 전년(${f1(o.t[1])}점) 대비 ${sgw(d1)}` +
    (o.i ? `, 전사(${f1(O[0].t[0])}점) 대비 ${sg(o.t[0] - O[0].t[0])}점입니다.` : '입니다.') + ` 응답률 ${pct(o.rate)}(${num(o.resp)}명).`]);
  sec.push(['강점', st.map(k => `${ITEMS[k]} ${f1(o.items[k])}점(${b.label} 대비 ${sg(g[k])})`).join(', ') || `${b.label}보다 높은 항목이 없습니다.`]);
  sec.push(['약점', wk.map(k => `${ITEMS[k]} ${f1(o.items[k])}점(${b.label} 대비 ${sg(g[k])})`).join(', ') || `${b.label}보다 낮은 항목이 없습니다.`]);
  if (a.content) {
    const inTop = Object.entries(a.cat[issues[0][0]].sum).filter(([, x]) => isIssue(x)).sort((x, y) => y[1].n - x[1].n).slice(0, 2);
    sec.push(['자유기술', `내용 있는 응답 ${num(a.content)}건(문장 수) 중 부정 ${pct(a.N / a.content)}, 혼합 ${pct(a.M / a.content)}. 개선 의견(부정·혼합·요청)이 가장 많은 주제는 '${catName(issues[0][0])}'(${issues[0][1]}건)이며 주로 ${inTop.map(([k, x]) => `'${k}'(${x.n}건)`).join(', ')} 내용입니다.`]);
  }
  const top3 = issues.slice(0, 3).map(x => x[0]);
  const weakList = wk.length ? wk : [idx[idx.length - 1]];
  const links = [...new Set(weakList.flatMap(k => ITEM_CATS[k]).filter(c => top3.includes(c)))];
  sec.push(['관찰', links.length
    ? `점수의 약점 항목(${weakList.map(k => ITEMS[k]).join('·')})과 자유기술 상위 주제('${links.map(catName).join("', '")}')에서 관련 주제가 함께 관찰됩니다. 두 결과의 관계와 원인은 추가 확인이 필요합니다.`
    : `점수의 약점 항목(${weakList.map(k => ITEMS[k]).join('·')})과 자유기술 상위 주제('${top3.slice(0, 2).map(catName).join("', '")}')가 서로 다른 영역에 있습니다. 각각 별도로 확인이 필요합니다.`]);
  const rs = risks(o);
  let caut = rs.length ? `검토 필요 사항 ${rs.length}건: ${rs.slice(0, 3).map(x => x[1]).join(', ')}.` : '기준에 해당하는 검토 필요 사항은 없습니다.';
  if (a.hi) caut += ' 민감 이슈는 사실 판단 없이 HR/윤리 검토를 권고합니다.';
  if (caution(o)) caut += ` 표본(${o.resp}명)·응답률(${pct(o.rate)})이 낮아 해석에 주의가 필요합니다.`;
  sec.push(['주의', caut]);
  return sec;
}

const ACT = {
  C1: { t: '회의·보고 방식 간소화', lead: '정례 회의의 목적·참석자를 재점검하고, 보고서는 핵심 요약(1page) 원칙을 4주간 시범 운영합니다.', hr: '보고 간소화 가이드와 협업툴 활용 교육을 지원합니다.', long: '결재 라인 단축, 반복 업무 자동화(RPA·AI) 적용 대상을 검토합니다.', done: '정례 회의 목록 재점검 및 폐지·통합 대상 합의' },
  C2: { t: '업무 분장·우선순위 재정비', lead: '업무 분장표를 구성원과 함께 점검하고, 당분간 하지 않을 일(Stop list)과 우선순위를 합의합니다.', hr: '업무량·충원 요청 이력을 기반으로 인력 운영 현황 진단을 지원합니다.', long: '핵심 업무 백업(다기능화) 체계와 결원 대비 인력 계획을 수립합니다.', done: '업무 분장표 갱신 및 Stop list 공유' },
  C3: { t: '역할(R&R) 정리와 협업 창구 지정', lead: '주요 업무별 역할·책임(RACI)을 정리해 공유하고, 유관 부서 협업 창구를 지정합니다.', hr: '조직 간 R&R 조정 워크숍 진행을 지원합니다.', long: '조직 개편 후 R&R 정비 여부를 점검하는 절차를 마련합니다.', done: '주요 업무 RACI 표 작성·공유' },
  C4: { t: '업무 지시·피드백 방식 개선', lead: '업무 지시 시 목적·배경·우선순위를 함께 설명하고, 월 1회 이상 성과 피드백 면담을 운영합니다.', hr: '리더 피드백·코칭 프로그램과 다면 피드백을 연계합니다.', long: '리더십 진단 결과와 리더 육성 프로그램을 연결합니다.', done: '구성원별 월 1회 피드백 면담 실시' },
  C5: { t: '정보 공유 루틴과 의견 회신', lead: '주요 결정사항을 정해진 주기로 공유하고, 수렴한 의견의 반영 여부를 구성원에게 회신합니다.', hr: '타운홀·소통 채널 운영을 지원합니다.', long: '부서 간 정보 공유 채널(플랫폼)을 정비합니다.', done: '결정사항 공유 주기 확정 및 의견 회신 2회 이상' },
  C6: { t: '평가 기준·결과 설명 강화', lead: '평가 전 기대 수준을 합의하고, 평가 후 기준과 결과를 1:1로 설명합니다.', hr: '평가·보상 기준 설명자료를 제공하고 공정성 인식을 점검합니다.', long: '평가 변별력과 보상 경쟁력에 대한 제도 검토를 요청합니다.', done: '평가 기준 설명 면담 완료율 100%' },
  C7: { t: '상호 존중 그라운드 룰 수립', lead: '부서 공통의 업무 매너·근태 원칙을 구성원과 합의해 공지합니다. 개별 사안은 부서장이 직접 판단하지 않고 HR과 협의합니다.', hr: '확인 필요 신호에 대해 HR/윤리 채널 검토를 진행하고 존중 문화 교육을 지원합니다.', long: '건강한 조직문화 모니터링(정기 펄스 서베이 등)을 운영합니다.', done: '그라운드 룰 합의·공지, 신호 건 HR 검토 완료' },
  C8: { t: '근무환경·도구 불편 개선', lead: '장비·공간·시스템 불편 사항을 목록화하여 유관 부서에 공식 건의합니다.', hr: '총무·IT 부서와 개선 요청을 연계합니다.', long: 'AI·디지털 도구 도입 로드맵에 부서 요구를 반영합니다.', done: '불편 사항 목록 작성 및 유관 부서 건의' },
  C9: { t: '의견 개진이 쉬운 회의 방식', lead: '회의에서 저연차 우선 발언, 익명 의견 수렴 등 발언 부담을 낮추는 방식을 운영합니다.', hr: '심리적 안전감 워크숍을 지원합니다.', long: '직급과 무관한 의사결정 참여 방식을 제도화합니다.', done: '익명 의견 수렴 1회 이상 및 결과 공유' },
  C10: { t: '성장·커리어 지원 강화', lead: '분기 1회 커리어 면담을 실시하고, 교육 참여 시간을 업무 일정에 반영해 보장합니다.', hr: '직무교육·멘토링 매칭을 지원합니다.', long: '직무전환·경력경로 제도 활용을 활성화합니다.', done: '구성원별 커리어 면담 1회 실시' },
};
const STATE_TXT = { both: '점수·의견 함께 관찰', split: '문항 간 결과 엇갈림', mixedHigh: '점수·의견 엇갈림', mixed: '점수·의견 엇갈림', scoreOnly: '점수 중심', text: '의견 중심(관련 문항 없음)' };

function proposals(o) {
  const a = agg(o.i), b = bench(o);
  const total = CATS.reduce((s, c) => s + a.cat[c].iss, 0) || 1;
  return CATS.map(c => {
    const ca = a.cat[c], issue = ca.iss, share = issue / total;
    const dq = DQ[c].map(k => ({ k, v: o.qs[k], gap: o.qs[k] - b.qs[k] }));
    const worst = dq.length ? Math.min(...dq.map(x => x.gap)) : null;
    const scoreLow = worst != null && worst <= -3;
    const sums = Object.entries(ca.sum).filter(([, s]) => isIssue(s)).sort((x, y) => y[1].n - x[1].n).slice(0, 3);
    const kidsIss = o.kids.map(i => O[i]).filter(ok).map(x => [x, agg(x.i).cat[c].iss]).filter(x => x[1] > 0).sort((p, q) => q[1] - p[1]);
    const split = dq.some(x => x.gap >= 3) && dq.some(x => x.gap <= -3);
    const st = !dq.length ? 'text' : scoreLow && issue ? (split ? 'split' : 'both') : issue ? (worst >= 0 ? 'mixedHigh' : 'mixed') : 'scoreOnly';
    return { c, issue, share, dq, worst, sums, pos: ca.P, kidsIss, st, score: share * 100 + (worst != null ? Math.max(0, -worst) * 3 : 0) };
  }).filter(x => x.issue > 0 || (x.worst != null && x.worst <= -3)).sort((x, y) => y.score - x.score).slice(0, 5);
}

/* =========================================================
   3. 공통 UI 조각
   ========================================================= */
const state = { view: 'home', org: 0, tab: {}, f: {}, page: {}, chat: [], edit: null, review: null, expanded: new Set(store.get('expanded', [0])) };
const bar = (label, v, max, opts = {}) => {
  const lo = opts.min ?? 0, w = Math.max(0, Math.min(100, (v - lo) / (max - lo) * 100));
  const mk = opts.mark != null ? `<span class="mark" style="left:${Math.max(0, Math.min(100, (opts.mark - lo) / (max - lo) * 100))}%"></span>` : '';
  return `<div class="bar-row"><span class="nm" title="${esc(label)}">${esc(label)}</span><div class="bar"><i class="${opts.cls || ''}" style="width:${w}%${opts.color ? `;background:${opts.color}` : ''}"></i>${mk}</div><span class="val">${opts.val ?? f1(v)}</span></div>`;
};
const donut = v => {
  const r = 26, c = 2 * Math.PI * r;
  return `<svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="${r}" fill="none" stroke="#eef0f3" stroke-width="8"/><circle cx="34" cy="34" r="${r}" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * v} ${c}" transform="rotate(-90 34 34)"/></svg>`;
};
const tag = (text, cls = '', title = '') => `<span class="tag ${cls}" ${title ? `title="${esc(title)}"` : ''}>${esc(text)}</span>`;
const scope = k => `<span class="scope" title="${k === 'org' ? '선택한 조직의 집계 값(점수집계표 기준)' : k === 'sub' ? '선택한 조직과 모든 예하조직의 응답을 합산' : '회사 전체 값'}">${SCOPE[k]}</span>`;
const sentTag = s => tag(s, s === '긍정' ? 'pos' : s === '부정' ? 'neg' : s === '혼합' ? 'mix' : '');
const sigTag = l => l === 2 ? tag(SIG[2], 'high') : l === 1 ? tag(SIG[1], 'mid') : '';
const intenTag = v => v >= 3 ? tag('강', 'high') : v === 2 ? tag('중', 'mid') : v === 1 ? tag('약') : '';
const srcTag = s => tag(SRC[s] || s, s === '검토' ? 'pos' : s === '규칙' ? 'mid' : s === 'LLM' ? 'acc' : '');
const table = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map(h => `<th class="${/\((명|건)\)|점수$|%|률$|대비|^순위$|^\d{4}$|평균|차이|배수|건당|^건수$|^잘하는 점$|^노력할 점$|^부서장에게$|^신호\(/.test(h) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="muted">해당 데이터가 없습니다.</td></tr>`}</tbody></table></div>`;
const orgLabel = o => `${esc(o.name)} <span class="muted">${LV[o.level] || ''}</span>`;
const limitCard = o => `<div class="card limit"><h3>분석 제한</h3><p>${esc(o.name)}의 응답자는 ${o.resp}명으로 최소 집계 기준(${settings.minN}명) 미만입니다.<br>개인정보 보호를 위해 부서 단위 결과를 공개하지 않으며, 상위 조직 결과에는 합산되어 반영됩니다.</p></div>`;
const reliTag = o => !ok(o) ? tag('분석 제한', 'high', `응답 ${settings.minN}명 미만`) : caution(o) ? tag('표본·응답률 주의', 'mid', '응답 10명 미만 또는 응답률 50% 미만') : tag('응답 기준 충족', 'acc', '응답 10명 이상 · 응답률 50% 이상 (통계적 신뢰도 검증 결과는 아님)');
const pageHead = (title, desc, actions = '') => `<div class="page-head"><div><h2>${title}</h2><p>${desc}</p></div><div class="actions">${actions}</div></div>`;
const tabs = (key, list) => { const cur = state.tab[key] || list[0][0]; return `<div class="tabs">${list.map(([k, l]) => `<button data-tab="${key}:${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>`; };
const curTab = (key, def) => state.tab[key] || def;
const briefHtml = o => `<div class="brief">${briefing(o).map(([k, v]) => `<div class="brief-sec"><span class="k">${k}</span><p>${esc(v)}</p></div>`).join('')}</div><p class="src">자동 생성 요약 · 진단 점수와 자유기술 분류 결과만을 근거로 작성됩니다.</p>`;
const highlight = (raw, kw) => { let h = esc(raw); if (kw) kw.split(',').forEach(k => { if (k) h = h.split(esc(k)).join(`<mark>${esc(k)}</mark>`); }); return h; };
const pager = (key, total, p, pages, per) => `<div class="pager"><span>${total ? `${p * per + 1}–${Math.min(total, (p + 1) * per)} / ${num(total)}` : ''}</span><span><button class="btn" data-page="${key}:${p - 1}" ${p <= 0 ? 'disabled' : ''}>이전</button> ${p + 1} / ${pages} <button class="btn" data-page="${key}:${p + 1}" ${p >= pages - 1 ? 'disabled' : ''}>다음</button></span></div>`;
const selectBox = (fkey, key, label, opts) => { const f = state.f[fkey]; return `<select class="select" data-f="${fkey}:${key}"><option value="">${label}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`; };
const now = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
function download(name, text, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name; link.click();
}
const csv = rows => '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

/* =========================================================
   4. 페이지
   ========================================================= */
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const VIEWS = [
  ['home', '홈', svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M12 4.5v15"/>')],
  ['report', '부서별 결과 리포트', svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M8 4.5v15M12 4.5v15M16 4.5v15"/>')],
  ['low', '저조부서 심층분석', svg('<path d="M4 5v14h16"/><path d="M7.5 9l4 4 3-3 4.5 5"/><path d="M19 11.5V15h-3.5"/>')],
  ['signal', '조직문화 저해 사례', svg('<path d="M6 21V4"/><path d="M6 4.5h11l-2.2 4 2.2 4H6z" fill="currentColor"/>')],
  ['ask', 'AI분석', svg('<path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z"/>')],
  ['settings', '데이터 관리/설정', svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>')],
];
// 이전 메뉴(서술형·제언)는 리포트 탭으로 이동
const VIEW_ALIAS = { text: ['report', 'good'], prop: ['report', 'lead'] };
function setView(v) {
  if (VIEW_ALIAS[v]) { state.view = VIEW_ALIAS[v][0]; state.tab.report = VIEW_ALIAS[v][1]; } else state.view = v;
}
const REPORT_TABS = [['sum', '종합 요약'], ['q', '항목 · 문항'], ['good', '잘하고 있는 점'], ['bad', '노력해야 할 점'], ['lead', '부서장 제언'], ['hr', 'HR 제언']];
const TASK_STATUS = ['미착수', '진행 중', '완료', '보류'];
const taskKey = (o, c) => o.code + '|' + c;

/* ---- 조직문화 건강 유형 (4분위: 점수 75점 × 전년 대비) ---- */
const HEALTH_CUT = 75;
const HEALTH = [
  { key: '우수', desc: `${HEALTH_CUT}점 이상 · 전년 대비 유지/상승`, color: '#1f8a5c', bg: '#d3eee0' },
  { key: '양호', desc: `${HEALTH_CUT}점 이상 · 전년 대비 하락`, color: '#3b6fd4', bg: '#dce7fb' },
  { key: '개선', desc: `${HEALTH_CUT}점 미만 · 전년 대비 유지/상승`, color: '#c2861a', bg: '#fbf0d6' },
  { key: '주의', desc: `${HEALTH_CUT}점 미만 · 전년 대비 하락`, color: '#c0443e', bg: '#f4d3d1' },
];
// 원점수 기준: 전년 대비 0 이상은 유지·상승. 비교 점수가 없으면 판정하지 않는다.
const healthOf = (v, prev) => !Number.isFinite(v) || !Number.isFinite(prev) ? null : HEALTH[(v >= HEALTH_CUT ? 0 : 2) + (v >= prev ? 0 : 1)];
const healthTag = h => h ? `<span class="hl-tag" style="background:${h.bg};color:${h.color}">${h.key}</span>` : '<span class="hl-tag muted">비교 불가</span>';
const healthCount = list => { const c = HEALTH.map(() => 0); list.forEach(x => { const h = healthOf(x.t[0], x.t[1]); if (h) c[HEALTH.indexOf(h)]++; }); return c; };
const healthStack = (list, h = 10) => {
  const cnt = healthCount(list), n = cnt.reduce((a, b) => a + b, 0) || 1;
  return `<div class="band-stack" style="height:${h}px">${cnt.map((c, i) => c ? `<i style="width:${c / n * 100}%;background:${HEALTH[i].color}" title="${HEALTH[i].key} ${c}개"></i>` : '').join('')}</div>`;
};
// 2×2 기준표: 위 = 전년 대비 유지·상승, 아래 = 하락 / 왼쪽 = 75점 미만, 오른쪽 = 75점 이상
function healthMatrix(cnt, total) {
  const cell = i => { const h = HEALTH[i]; return `<div class="hq" style="background:${h.bg}"><b style="color:${h.color}">${h.key}</b><span>${h.desc.replace(' · ', '<br>')}</span>${cnt ? `<em>${num(cnt[i])}개 · ${pct(cnt[i] / (total || 1))}</em>` : ''}</div>`; };
  return `<div class="health-matrix"><div class="hq-y"><span>전년 대비<br>유지·상승 ↑</span><span>전년 대비<br>하락 ↓</span></div>
    <div class="hq-grid">${cell(2)}${cell(0)}${cell(3)}${cell(1)}</div>
    <div class="hq-x"><span>← ${HEALTH_CUT}점 미만</span><span>평균점수 ${HEALTH_CUT}점</span><span>${HEALTH_CUT}점 이상 →</span></div></div>`;
}
const AREA_COLOR = [['#f7f0a4', '#4d4300'], ['#c3c9e9', '#232c58'], ['#3e4e8e', '#ffffff']];
const areaBox = (o, k, sm) => { const v = o.area[k], d = v - o.areaPrev[k], h = healthOf(v, o.areaPrev[k]);
  return `<div class="area-box ${sm ? 'sm' : ''}" style="background:${AREA_COLOR[k][0]};color:${AREA_COLOR[k][1]}"><div class="ab-name">${D.areas[k]}</div><div class="ab-type">${h ? h.key : '-'}</div><div class="ab-val">(${f1(v)}, ${sg(d)})</div></div>`; };
const heat = gap => gap >= 2 ? 'h-good2' : gap >= 0.5 ? 'h-good' : gap > -0.5 ? 'h-mid' : gap > -2 ? 'h-bad' : 'h-bad2';

function viewHome() {
  const co = O[0], ca = agg(0), d1 = co.t[0] - co.t[1];
  const f = state.f.home || (state.f.home = { lv: '5' });
  const lv = +f.lv;
  const units = O.filter(x => x.level === lv && ok(x) && Number.isFinite(x.t[0]) && Number.isFinite(x.t[1]));
  const hcnt = healthCount(units), hN = hcnt.reduce((a, b) => a + b, 0) || 1;
  const keep = units.filter(x => x.t[0] - x.t[1] >= 0).length, dropN = units.filter(x => x.t[0] - x.t[1] <= -1.5);
  const bus = O.filter(x => x.level === 3);
  const buOf = x => { let y = x; while (y && y.level > 3) y = O[y.parent]; return y && y.level === 3 ? y : null; };
  // 하락 조직 쏠림은 건수가 아니라 '사업부별 하락 비율'로 비교 (조직이 많은 사업부가 건수로 불리하지 않도록)
  const buUnits = {}; units.forEach(x => { const b = buOf(x); if (b) (buUnits[b.i] = buUnits[b.i] || [0, 0])[0]++; });
  dropN.forEach(x => { const b = buOf(x); if (b) buUnits[b.i][1]++; });
  const allDrop = dropN.length / (units.length || 1);
  const buRate = Object.entries(buUnits).filter(([, [n]]) => n >= 5).map(([i, [n, d]]) => ({ i: +i, n, d, r: d / n })).sort((x, y) => y.r - x.r);
  const hotBu = buRate.find(x => x.r >= allDrop * 1.3 && x.r - allDrop >= 0.05);
  const areaCh = co.area.map((v, k) => [k, v - co.areaPrev[k]]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const itemLow = co.items.map((v, k) => [k, v]).sort((x, y) => x[1] - y[1]).slice(0, 2);
  const im = segment(co, 'improve'), impPred = segPred('improve');
  const impCats = {}; Object.values(im.sum).filter(impPred).forEach(v => { if (v.cat !== 'C0') impCats[v.cat] = (impCats[v.cat] || 0) + v.n; });
  const impFocus = Object.values(im.sum).filter(impPred).reduce((acc, v) => acc + v.n, 0) || 1;
  const topImp = Object.entries(impCats).sort((x, y) => y[1] - x[1]);
  const QSHORT = ['잘하고 있는 점', '노력해야 할 점', '부서장 제언'];
  const qStat = [0, 1, 2].map(() => ({ n: 0, none: 0 }));
  textsIn(0).forEach(ti => { const st = qStat[T[ti][1]]; st.n++; if (clsFast(ti)[2] === '의견 없음') st.none++; });
  const goodTop = themes(co, 'good').list.slice(0, 2);

  // ② 전사 브리핑 (데이터에서 계산한 사실만)
  const lvName = LV[lv];
  const brief = [
    `전사 SCI는 <b>${f1(co.t[0])}점</b>으로 전년(${f1(co.t[1])}점) 대비 <b>${Math.abs(d1).toFixed(1)}점 ${d1 >= 0 ? '상승' : '하락'}</b>했습니다.`,
    `${lvName} 단위 건강 유형은 ${HEALTH.map((h, i) => `${h.key} <b>${pct(hcnt[i] / hN)}</b>`).join(' · ')}입니다(${HEALTH_CUT}점 × 전년 대비 기준).`,
    `전년 비교 가능한 ${lvName} ${num(units.length)}개 중 <b>${pct(keep / (units.length || 1))}</b>는 전년 수준 이상을 유지했고, ${num(dropN.length)}개(${pct(allDrop)})는 1.5점 이상 하락했습니다.${hotBu ? ` 사업부별 하락 비율은 <b>${esc(O[hotBu.i].name)}</b>가 ${lvName} ${num(hotBu.n)}개 중 ${num(hotBu.d)}개(${pct(hotBu.r)})로 전사 평균(${pct(allDrop)})보다 높습니다.` : buRate.length > 1 ? ` 사업부별 하락 비율은 ${pct(buRate[buRate.length - 1].r)}~${pct(buRate[0].r)}입니다. 이 비율만으로 특정 사업부 집중 여부를 단정하지 않습니다.` : ''}`,
    `영역 중 가장 크게 움직인 것은 <b>'${D.areas[areaCh[0][0]]}'</b>(전년 대비 ${sg(areaCh[0][1])}점)이며, 항목에서는 ${itemLow.map(([k, v]) => `${ITEMS[k]}(${f1(v)})`).join('·')}이 가장 낮습니다.`,
    goodTop.length ? `자유기술 '잘하고 있는 점'에서는 <b>${catName(goodTop[0].cat)}</b>(${pct(goodTop[0].share)})${goodTop[1] ? `, <b>${catName(goodTop[1].cat)}</b>(${pct(goodTop[1].share)})` : ''} 관련 의견이 가장 많았습니다.` : '',
    topImp.length ? `자유기술 '노력해야 할 점'에서는 <b>${catName(topImp[0][0])}</b>(${pct(topImp[0][1] / impFocus)}), <b>${catName(topImp[1]?.[0] || topImp[0][0])}</b>(${pct((topImp[1]?.[1] || 0) / impFocus)}) 관련 의견이 가장 많았습니다.` : '',
    `현재 HR 확인이 필요한 <b>우선 검토 신호는 ${num(ca.hi)}건</b>, 일반 검토 신호는 ${num(ca.mid)}건입니다.`,
  ].filter(Boolean);

  // 전사 Trend
  const tv = [co.t[2], co.t[1], co.t[0]], tlo = Math.min(...tv) - 1.5, thi = Math.max(...tv) + 1.5;
  const tx = i => 30 + i * 110, ty = v => 88 - (v - tlo) / (thi - tlo) * 70;
  const homeTrend = `<svg viewBox="0 0 280 110" class="home-trend" aria-label="전사 SCI 추이">
    <path d="${tv.map((v, i) => `${i ? 'L' : 'M'}${tx(i)},${ty(v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${tv.map((v, i) => `<circle cx="${tx(i)}" cy="${ty(v).toFixed(1)}" r="${i === 2 ? 5 : 3.5}" fill="${i === 2 ? 'var(--accent)' : '#fff'}" stroke="var(--accent)" stroke-width="2"/><text x="${tx(i)}" y="${(ty(v) - 10).toFixed(1)}" text-anchor="middle" class="t-val">${f1(v)}</text><text x="${tx(i)}" y="106" text-anchor="middle" class="t-yr">${2024 + i}</text>`).join('')}
  </svg>`;
  const areaPrevAvg = mean(co.areaPrev), mismatch = Math.abs(areaPrevAvg - co.t[1]) > 0.5;

  // 사업부 Heatmap
  const heatRows = bus.map(x => {
    if (!ok(x)) return `<tr><td>${esc(x.name)}</td><td colspan="5" class="muted">분석 제한</td></tr>`;
    const dx = x.t[0] - x.t[1], kids = O.slice(x.i + 1, x.end).filter(y => y.level === lv && ok(y)), kc = healthCount(kids);
    return `<tr class="click" data-org="${x.i}" data-go="report">
      <td class="hm-name">${esc(x.name.replace(/사업부$/, ''))}<span class="muted">사업부</span></td>
      <td class="hm-lead">${esc(x.leader || '-')}</td>
      <td class="hm ${heat(x.t[0] - co.t[0])}"><b>${f1(x.t[0])}</b></td>
      <td class="hm ${dx >= 0.05 ? 'h-good' : dx <= -1.5 ? 'h-bad2' : dx < -0.05 ? 'h-bad' : 'h-mid'}">${dl(dx)}</td>
      <td>${healthTag(healthOf(x.t[0], x.t[1]))}</td>
      <td class="hm-dist">${kids.length ? healthStack(kids, 8) + `<span class="muted">${lvName} ${kids.length}개 · ${HEALTH.map((h, i) => `${h.key} ${kc[i]}`).join(' · ')}</span>` : '<span class="muted">-</span>'}</td></tr>`;
  }).join('');

  const unitSel = `<select class="select sm-select" data-f="home:lv">${[4, 5, 6, 7].filter(l => O.some(x => x.level === l)).map(l => `<option value="${l}" ${lv === l ? 'selected' : ''}>${LV[l]} 기준</option>`).join('')}</select>`;
  return `
  <div class="page-head"><div><h2>2026 전사 조직문화 Overview</h2><p>우리 회사 조직문화에 지금 무슨 일이 일어나고 있는가 · 홈은 항상 전사 기준이며, 조직을 누르면 부서별 결과 리포트로 이동합니다.</p></div></div>

  <div class="grid g4 snap">
    <div class="card kpi"><div class="label">전사 SCI ${scope('all')}</div><div class="value">${f1(co.t[0])}<small>점</small></div><div class="foot muted">2026 진단 ${healthTag(healthOf(co.t[0], co.t[1]))}</div></div>
    <div class="card kpi"><div class="label">전년 대비</div><div class="value ${d1 >= 0 ? 'up' : 'down'}">${sg(d1)}<small>점</small></div><div class="foot muted">2025 ${f1(co.t[1])}점</div></div>
    <div class="card kpi"><div class="label">응답률</div><div class="value">${pct(co.rate)}</div><div class="foot muted">${num(co.resp)} / ${num(co.target)}명</div></div>
    <div class="card kpi"><div class="label">자유기술</div><div class="value">${num(ca.n - ca.none)}<small>건</small></div>
      <div class="kpi-lines">${QSHORT.map((q, i) => `<div><span>${q}</span><b>${num(qStat[i].n - qStat[i].none)}건</b></div>`).join('')}
        <div class="src">의견 없음·무의미 응답 ${num(ca.none)}건 제외 · 문장 수</div></div></div>
  </div>

  <div class="grid g2 mt">
    <div class="card"><h3>영역별 건강유형 ${scope('all')} <small>2026 점수(전년 대비)</small></h3>
      <div class="bars area-bars">${co.area.map((v, k) => { const dv = v - co.areaPrev[k];
        const hl = healthOf(v, co.areaPrev[k]);
        return bar(D.areas[k], v, 100, { min: 60, mark: co.areaPrev[k], color: hl ? hl.color : null,
          val: `${f1(v)} <small class="${dv >= 0 ? 'up' : 'down'}">${sg(dv)}</small> ${healthTag(hl)}` }); }).join('')}</div>
      <p class="src">막대 = 2026 점수(60~100점 구간) · 세로선 = 전년 점수 · 막대 색 = 건강 유형</p></div>
    <div class="card"><h3>전사 Trend <small>2024 → 2026</small></h3>${homeTrend}
      ${mismatch ? `<p class="src">참고: 영역 전년 점수 평균(${f1(areaPrevAvg)})과 전년 종합점수(${f1(co.t[1])})가 일치하지 않습니다. 원천 데이터 확인이 필요합니다.</p>` : ''}</div>
  </div>

  <div class="card mt home-dist"><h3>예하 조직 결과 ${scope('all')} <span>${unitSel}</span></h3>
    ${healthStack(units, 14)}
    <div class="hl-legend">${HEALTH.map((h, i) => `<span><i style="background:${h.color}"></i>${h.key} <b>${num(hcnt[i])}개</b> · ${pct(hcnt[i] / hN)}</span>`).join('')}</div>
    <p class="src" style="margin:6px 0 16px">${lvName} ${num(units.length)}개 기준(응답 ${settings.minN}명 이상) · SCI는 조직문화 건강도를 ${HEALTH_CUT}점과 전년 대비 변화로 4가지 유형(${HEALTH.map(h => h.key).join('·')})으로 구분합니다.</p>
    <div class="tbl-wrap"><table class="tbl heatmap"><thead><tr><th>사업부</th><th>부서장</th><th>2026 SCI</th><th>전년 대비</th><th>건강 유형</th><th>${lvName} 분포 (건강 유형)</th></tr></thead><tbody>${heatRows}</tbody></table></div>
    <p class="src">SCI 색은 전사 대비 차이(초록: 높음 · 주황: 낮음), 분포 막대 색은 건강 유형(우수·양호·개선·주의)입니다. 행을 누르면 해당 사업부의 결과 리포트로 이동합니다.</p>
  </div>

  <div class="card mt home-brief"><h3>2026 전사 조직문화 브리핑 ${scope('all')}</h3>
      <ol>${brief.map(x => `<li>${x}</li>`).join('')}</ol>
      <p class="src">자동 생성 요약 · 점수집계표와 자유기술 분류 결과에서 계산한 사실만 사용합니다. 전년 자유기술 데이터가 없어 의견의 증감은 판단하지 않습니다.</p></div>

  <div class="card mt home-more">
    <div><b>세부 결과는 부서별 결과 리포트에서 확인하세요.</b>
      <p class="muted">조직별 점수·항목·문항, 자유기술 분석(잘하고 있는 점 / 노력해야 할 점), 부서장 제언, HR 제언을 볼 수 있습니다. 왼쪽 조직 트리에서 조직을 선택해도 이동합니다.</p></div>
    <button class="btn primary" data-org="0" data-go="report">부서별 결과 리포트 열기 →</button>
  </div>`;
}

function viewReport() {
  const o = O[state.org];
  if (state.tab.report === 'txt') state.tab.report = 'good';   // 이전 '서술형 분석' 탭 링크 호환
  const tb = curTab('report', 'sum');
  const acts = ok(o) ? `<button class="btn" data-act="print">인쇄 / PDF</button><button class="btn" data-act="csv">예하조직 CSV</button>${tb === 'lead' || tb === 'hr' ? '<button class="btn" data-act="exportTasks">과제 관리 CSV</button>' : ''}` : '';
  const head = pageHead(`${esc(o.name)} ${o.leader ? `<span class="lead-chip">부서장 ${esc(o.leader)}</span>` : ''} ${reliTag(o)}`, `${LV[o.level]} · 대상 ${num(o.target)}명 · 응답 ${num(o.resp)}명 · 2026 진단`, acts);
  if (!ok(o)) return head + limitCard(o);
  const body = tb === 'q' ? questionsBody(o) : tb === 'good' ? voiceTab(o, 'good') : tb === 'bad' ? voiceTab(o, 'improve') : tb === 'lead' || tb === 'hr' ? propBody(o, tb) : summaryBody(o);
  return head + tabs('report', REPORT_TABS) + body;
}

// 세로 막대형 차트 (60~100점 구간)
function columns(list, pair) {
  const h = v => Math.max(0, Math.min(100, (v - 60) / 40 * 100));
  return `<div class="cols" style="--n:${list.length}">${list.map(x => `<div class="col">
    <div class="col-plot ${pair ? 'pair' : ''}">
      ${pair ? `<div class="col-bar prev" style="height:${h(x.prev)}%" title="2025 ${f1(x.prev)}점"><span class="col-val muted">${f1(x.prev)}</span></div>` : ''}
      <div class="col-bar ${x.cls || ''}" style="height:${h(x.v)}%" title="${esc(x.label)} ${f1(x.v)}점"><span class="col-val ${h(x.v) >= 16 ? 'in' : ''}">${f1(x.v)}</span></div>
      ${x.mark != null ? `<div class="col-mark" style="bottom:${h(x.mark)}%" title="비교 기준 ${f1(x.mark)}점"></div>` : ''}
    </div>
    <div class="col-lab">${esc(x.label)}</div>${x.sub ? `<div class="col-sub">${x.sub}</div>` : ''}
  </div>`).join('')}</div>`;
}

function summaryBody(o) {
  const b = bench(o), g = gaps(o), rk = rankInLevel(o), rs = risks(o);
  const idx = g.map((_, k) => k).sort((x, y) => g[y] - g[x]);
  return `
    ${caution(o) ? `<div class="notice warn"><b>표본·응답률 주의</b> 응답 ${o.resp}명, 응답률 ${pct(o.rate)}로 결과 해석에 주의가 필요합니다.</div>` : ''}
    <div class="grid g5">
      <div class="card kpi"><div class="label">SCI 종합점수 ${scope('org')}</div><div class="value">${f1(o.t[0])}<small>점</small></div><div class="foot">2026 진단 ${healthTag(healthOf(o.t[0], o.t[1]))}</div><div class="src">2024 ${f1(o.t[2])} · 2025 ${f1(o.t[1])} · 2026 ${f1(o.t[0])}</div></div>
      <div class="card kpi"><div class="label">응답률 ${scope('org')}</div><div class="donut">${donut(o.rate)}<div><div class="value" style="font-size:24px">${pct(o.rate)}</div><div class="foot muted">${num(o.resp)} / ${num(o.target)}명</div></div></div></div>
      <div class="card kpi"><div class="label">전년비 ${scope('org')}</div><div class="value ${o.t[0] - o.t[1] >= 0 ? 'up' : 'down'}">${sg(o.t[0] - o.t[1])}<small>점</small></div><div class="foot muted">2025 ${f1(o.t[1])}점</div></div>
      <div class="card kpi"><div class="label">${o.i ? '전사 대비' : '2024 대비'} ${scope(o.i ? 'all' : 'org')}</div><div class="value">${o.i ? sg(o.t[0] - O[0].t[0]) : sg(o.t[0] - o.t[2])}<small>점</small></div><div class="foot muted">${o.i ? `전사 ${f1(O[0].t[0])}점` : `2024 ${f1(o.t[2])}점`}</div></div>
      <div class="card kpi"><div class="label">${LV[o.level]} 단위 순위 ${scope('all')}</div><div class="value">${rk.n > 1 ? rk.r : '-'}<small>/ ${rk.n}</small></div><div class="foot muted">${rk.n > 1 ? (rk.top <= 0.5 ? `상위 ${Math.max(1, Math.round(rk.top * 100))}%` : `하위 ${Math.max(1, Math.round((1 - rk.top) * 100 + 100 / rk.n))}%`) : '비교 대상 없음'}</div></div>
    </div>
    <p class="src">전년 비교 참고: 과거 연도의 응답 규모와 조직 개편 여부는 데이터에 없어 확인되지 않았습니다. 조직 구성이 달라졌다면 직접 비교에 주의하세요.</p>
    <div class="grid g-chart2 mt">
      <div class="card"><h3>영역 · 항목별 결과 ${scope('org')} <small>영역: 건강 유형 (점수, 전년 대비) · 항목 막대의 세로선: ${b.label} · 괄호: ${b.label} 대비</small></h3>
        <div class="ai-grid fill">${o.area.map((_, k) => `<div class="ai-col">${areaBox(o, k, true)}
          <div class="bars">${ITEMS.map((_, j) => j).filter(j => D.items[j][1] === k).map(j => bar(ITEMS[j], o.items[j], 100, { min: 60, mark: b.items[j], cls: g[j] <= -3 ? 'neg' : '', val: `${f1(o.items[j])} <span class="${g[j] >= 0 ? 'up' : 'down'}">(${sg(g[j])})</span>` })).join('')}</div></div>`).join('')}</div>
        <p class="src">영역 건강 유형: ${HEALTH.map(h => `${h.key} ${h.desc}`).join(' / ')}. 막대가 빨간 항목은 ${b.label}보다 3점 이상 낮습니다.</p></div>
      <div class="card"><h3>강점 · 약점 <small>${b.label} 대비</small></h3>
        <div class="muted" style="font-size:12px;margin-bottom:2px">강점</div>
        <div class="list">${idx.slice(0, 3).filter(k => g[k] > 0).map(k => `<div class="list-item"><span>${ITEMS[k]} <span class="muted">${f1(o.items[k])}</span></span><span class="up">${sg(g[k])}</span></div>`).join('') || `<p class="muted">${b.label}보다 높은 항목 없음</p>`}</div>
        <div class="muted" style="font-size:12px;margin:14px 0 2px">약점</div>
        <div class="list">${idx.slice(-3).reverse().filter(k => g[k] < 0).map(k => `<div class="list-item"><span>${ITEMS[k]} <span class="muted">${f1(o.items[k])}</span></span><span class="down">${sg(g[k])}</span></div>`).join('') || `<p class="muted">${b.label}보다 낮은 항목 없음</p>`}</div>
      </div>
    </div>
    <div class="card mt"><h3>예하조직 결과 <small>직속 예하조직 · 행 클릭 시 해당 조직으로 이동</small></h3>${subTable(o)}</div>
    <div class="card mt"><h3>종합 브리핑 ${scope('org')}</h3>
      <div class="grid brief-grid"><div>${briefHtml(o)}</div>
        <div><div class="muted" style="font-size:12px;margin-bottom:4px">검토 필요 사항 ${rs.length}건</div>${rs.length ? `<div class="list">${rs.map(r => `<div class="list-item"><div class="l"><div>${tag(r[0] === 'high' ? '우선' : '참고', r[0])} ${esc(r[1])}</div><div class="muted" style="font-size:12px;white-space:normal">${esc(r[2])}</div></div>${scope(r[3])}</div>`).join('')}</div>` : '<p class="muted">기준에 해당하는 사항이 없습니다.</p>'}</div>
      </div></div>`;
}

function questionsBody(o) {
  const b = bench(o), g = gaps(o);
  return `<div class="card"><h3>문항별 점수 ${scope('org')} <small>표시선: ${b.label} · 3점 이상 낮은 문항 강조</small></h3>
    ${ITEMS.map((it, k) => `<div style="margin:14px 0 6px;font-weight:600">${it} <span class="muted" style="font-weight:400">${f1(o.items[k])}점 (${sg(g[k])})</span></div>
    <div class="bars">${D.questions.map((q, qi) => q[1] === k ? `<div class="bar-row" style="grid-template-columns:1fr 160px 90px"><span class="nm" style="white-space:normal">${esc(q[0])}</span><div class="bar"><i class="${o.qs[qi] - b.qs[qi] <= -3 ? 'neg' : ''}" style="width:${Math.max(0, (o.qs[qi] - 50) * 2)}%"></i><span class="mark" style="left:${Math.max(0, (b.qs[qi] - 50) * 2)}%"></span></div><span class="val">${f1(o.qs[qi])} <span class="${o.qs[qi] - b.qs[qi] >= 0 ? 'up' : 'down'}" style="font-size:12px">(${sg(o.qs[qi] - b.qs[qi])})</span></span></div>` : '').join('')}</div>`).join('')}
    <p class="src">문항별 전년 점수는 데이터에 없어 문항 단위 추세는 판단할 수 없습니다.</p></div>`;
}

function subTable(o) {
  const rows = o.kids.map(i => O[i]);
  if (!rows.length) return '<p class="muted">예하조직이 없습니다.</p>';
  const lead = x => `<td class="lead-cell">${x.leader ? esc(x.leader) : '<span class="muted">-</span>'}</td>`;
  return table(['조직명', '부서장', '응답인원(명)', '응답률', '종합점수', '전년 대비', '전사 대비', '최저 항목'], rows.map(x => {
    if (!ok(x)) return `<tr><td>${orgLabel(x)}</td>${lead(x)}<td class="num">${x.resp}</td><td colspan="5" class="muted">분석 제한 (응답 ${settings.minN}명 미만 · 비공개)</td></tr>`;
    const g = gaps(x), wk = g.indexOf(Math.min(...g));
    return `<tr class="click" data-org="${x.i}"><td>${orgLabel(x)} ${caution(x) ? tag('표본·응답률 주의', 'mid') : ''}</td>${lead(x)}<td class="num">${num(x.resp)}</td><td class="num">${pct(x.rate)}</td><td class="num">${f1(x.t[0])}</td><td class="num">${dl(x.t[0] - x.t[1])}</td><td class="num">${sg(x.t[0] - O[0].t[0])}</td><td>${ITEMS[wk]} <span class="down">${sg(g[wk])}</span></td></tr>`;
  }));
}

// 서술형 분석: 문항 기준으로 분리 (잘하고 있는 점 문항 / 노력해야 할 점 문항). '부서장에게 하고 싶은 말'은 부서장 제언 탭에서 분석
const SEGS = {
  good: { name: '잘하고 있는 점', q: 0, desc: "'잘하고 있는 점' 문항 내 분류 결과" },
  improve: { name: '개선이 필요한 점', q: 1, desc: "'노력해야 할 점' 문항 내 분류 결과" },
};
const INS = D.insight || { exp: {}, pairs: [], keep: {}, improve: {}, strength: {}, issue: {} };
const segCache = new Map();
const segPred = key => key === 'good' ? v => v.sent === '긍정' : v => v.type === '개선 요청' || v.sent === '부정' || v.sent === '혼합';
const expTitle = (label, key) => INS.exp[label] || (key === 'good' ? `'${label}' 경험을 긍정적으로 언급합니다` : `'${label}'에 대한 개선 의견이 있습니다`);
// 구성원의 목소리: 실제 원문에서 호칭·조직 표현만 비식별 처리 (AI가 만든 문장을 원문처럼 인용하지 않음)
const deid = t => String(t).replace(/(사업부장|센터장|그룹장|부서장|실장|팀장|파트장|리더)님/g, 'OO님').replace(/(우리|저희|현|지금)\s?(사업부|파트|부서|조직|실|팀|그룹)/g, '우리 조직').replace(/현업/g, '우리 조직');

function segment(o, key) {
  const ck = o.i + '|' + key;
  if (segCache.has(ck)) return segCache.get(ck);
  const seg = SEGS[key], r = { n: 0, none: 0, P: 0, U: 0, N: 0, M: 0, H: 0, req: 0, sum: {} };
  for (const ti of textsIn(o.i)) {
    const t = T[ti]; if (t[1] !== seg.q) continue;
    const c = clsFast(ti);
    if (c[2] === '의견 없음') { r.none++; continue; }
    r.n++; r[SENT_KEY[c[1]] || 'H']++; if (c[2] === '개선 요청') r.req++;
    const sm = r.sum[c[3]] || (r.sum[c[3]] = { n: 0, cat: c[0], sent: c[1], type: c[2], src: {}, ex: [], seen: new Set() });
    sm.n++; sm.src[c[4]] = (sm.src[c[4]] || 0) + 1;
    if (sm.ex.length < 12 && rawOk(O[t[0]])) { const d = deid(t[3]); if (!sm.seen.has(d)) { sm.seen.add(d); sm.ex.push([ti, d]); } }
  }
  segCache.set(ck, r);
  return r;
}

// ---- 자유기술 탭 (잘하고 있는 점 / 노력해야 할 점): 결론 → 근거 → 구성원 목소리 → 상세 데이터 ----
const STRONG_RE = /폭언|욕설|막말|모욕|인격|괴롭|협박|갑질|차별|고성|소리|눈치|두렵|지옥|번아웃|힘듭|참을|막막|무시/;
const clip = (t, max) => t.length > max ? t.slice(0, max).replace(/[\s,·]+$/, '') + '…' : t;
const tidy = x => String(x).replace(/[\u200b\u200c\uFEFF]/g, '').replace(/^[\s\-–—*>·●■◆\d.)\]]+/, '')
  .replace(/^(또한|그리고|그래서|그런데|하지만|다만|특히|아울러|더불어|그러나)[,\s]*/, '').trim();
// 긴 응답에서 핵심 문장 1개만 발췌 (저해 키워드·강한 표현·적정 길이·종결형 우선)
function keySentence(raw, kws) {
  const parts = String(raw).split(/\n+|(?<=[.!?])\s+/).map(tidy).filter(x => x.length >= 20 && !/^[(\[].*[)\]]$/.test(x));
  if (!parts.length) return tidy(String(raw)).slice(0, 160);
  const ks = (kws || '').split(',').filter(Boolean);
  const sc = x => (ks.some(k => x.includes(k)) ? 3 : 0) + (STRONG_RE.test(x) ? 2 : 0) + (x.length >= 30 && x.length <= 110 ? 2 : 0) + (/(다|요|까|죠|음|함)[.?!]?$/.test(x) ? 1 : 0);
  return parts.slice().sort((a, b) => sc(b) - sc(a) || a.length - b.length)[0];
}
const voiceQuote = ti => clip(deid(keySentence(T[ti][3], T[ti][5])), 120);

// 문항 안에서 주제(카테고리)별 합계 · 대표 경험 · 전사 비중
function themes(o, key) {
  const r = segment(o, key), pred = segPred(key), co = o.i === 0 ? r : segment(O[0], key);
  const roll = rr => { const m = {}; let tot = 0;
    Object.entries(rr.sum).forEach(([l, v]) => { if (!pred(v) || v.cat === 'C0') return; const e = m[v.cat] || (m[v.cat] = { n: 0, labels: [] }); e.n += v.n; e.labels.push([l, v]); tot += v.n; });
    return [m, tot || 1]; };
  const [m, tot] = roll(r), [cm, ctot] = roll(co);
  const list = Object.entries(m).sort((x, y) => y[1].n - x[1].n).map(([c, e]) => { e.labels.sort((x, y) => y[1].n - x[1].n);
    return { cat: c, n: e.n, share: e.n / tot, cshare: cm[c] ? cm[c].n / ctot : 0, label: e.labels[0][0], sm: e.labels[0][1] }; });
  return { r, list, tot };
}

function insightTop3(o, key, home) {
  const th = themes(o, key), top = th.list.slice(0, 3), isGood = key === 'good';
  const title = home ? `💬 이번 진단에서 구성원이 가장 많이 이야기한 것 <small>전사 '노력해야 할 점' · Top 3 Insight</small>`
    : `💬 구성원들은 지금 이렇게 말하고 있습니다 ${scope('sub')} <small>Top 3 Insight · 숫자 + 해석 + 실제 목소리</small>`;
  if (!top.length) return `<div class="card mt"><h3>${title}</h3><p class="muted">분석할 응답이 없습니다.</p></div>`;
  const cards = top.map((x, i) => {
    const cand = (x.sm.ex || []).map(([ti]) => voiceQuote(ti)).filter(t => t.length >= 25);
    const q = cand.sort((a, b) => (STRONG_RE.test(b) - STRONG_RE.test(a)) || b.length - a.length)[0] || '';
    const gap = o.i !== 0 ? x.share - x.cshare : null;
    return `<div class="v-ins ${isGood ? 'good' : 'bad'}">
      <div class="v-ins-h"><span class="v-no">${i + 1}</span><span class="v-cat">${esc(catName(x.cat))}</span></div>
      <h4>${esc(expTitle(x.label, key))}</h4><p class="src">위 세부 의견 ${num(x.sm.n)}건 · 아래 숫자는 카테고리 전체 합계</p>
      <div class="v-num"><b>${num(x.n)}건</b><span>${isGood ? '긍정 응답' : '개선 의견'}의 ${pct(x.share)}</span>${gap == null || Math.abs(gap) < 0.005 ? '' : `<span class="${(gap > 0) === isGood ? 'better' : 'worse'}">전사 대비 ${gap > 0 ? '+' : ''}${(gap * 100).toFixed(0)}%p</span>`}</div>
      ${q ? `<blockquote class="v-q">${esc(q)}</blockquote>` : '<p class="muted" style="font-size:12.5px;margin:0">원문 공개 기준을 충족하는 응답이 없습니다.</p>'}
      <p class="v-act"><b>AI Insight</b> ${esc((isGood ? INS.keep : INS.improve)[x.cat] || '')}</p></div>`;
  }).join('');
  return `<div class="card mt"><h3>${title}</h3>
    <p class="v-lead"><b>${esc(catName(top[0].cat))}</b> 이야기가 가장 많습니다 — ${esc(expTitle(top[0].label, key))}</p>
    <div class="grid g3 v-ins-grid">${cards}</div>
    <p class="src">큰 숫자는 주제(카테고리) 합계이고, 세부 의견 건수는 별도로 표시합니다. 건수는 문장 수이며 작성자 수가 아닙니다. 한 줄 해석은 분류 결과를 풀어쓴 문장이며, 인용문만 실제 응답입니다(호칭·조직 표현 비식별, 긴 문장은 핵심만 발췌).</p>
    ${home ? `<div class="v-more"><span class="click" data-org="0" data-go="report" data-tabset="report:bad">노력해야 할 점 전체 분석 →</span></div>` : ''}</div>`;
}

function catShare(o, key) {
  const th = themes(o, key), isGood = key === 'good', max = th.list[0]?.n || 1;
  return `<div class="card mt"><h3>카테고리별 비중 ${scope('sub')} <small>${isGood ? '긍정' : '부정·혼합·개선 요청'}으로 분류된 ${num(th.tot)}건 기준${o.i ? ' · 회색 글씨: 전사 비중' : ''}</small></h3>
    ${th.list.length ? `<div class="bars cat-bars">${th.list.map(x => bar(catName(x.cat), x.n, max, { cls: isGood ? 'pos' : 'neg', val: `${num(x.n)}건 · <b>${pct(x.share)}</b>${o.i ? ` <span class="muted">${pct(x.cshare)}</span>` : ''}` })).join('')}</div>` : '<p class="muted">분석할 응답이 없습니다.</p>'}</div>`;
}

function kpwCard(o) {
  const g = segment(o, 'good'), im = segment(o, 'improve');
  const top = (r, pick, key) => Object.entries(r.sum).filter(([, v]) => pick(v) && v.cat !== 'C0').sort((x, y) => y[1].n - x[1].n).slice(0, 3)
    .map(([l, v]) => `<li><span>${esc(expTitle(l, key))}</span><b>${num(v.n)}건</b></li>`).join('');
  const want = {}; [g, im].forEach(r => Object.entries(r.sum).forEach(([l, v]) => { if (v.type === '개선 요청' && v.cat !== 'C0') want[l] = (want[l] || 0) + v.n; }));
  const wantHtml = Object.entries(want).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([l, n]) => `<li><span>${esc(expTitle(l, 'improve'))}</span><b>${num(n)}건</b></li>`).join('');
  const col = (cls, icon, t, sub, body) => `<div class="kpw ${cls}"><div class="kpw-h">${icon} <b>${t}</b><small>${sub}</small></div><ul>${body || '<li class="muted">해당 응답이 없습니다.</li>'}</ul></div>`;
  return `<div class="card mt"><h3>Keep · Problem · Want ${scope('sub')} <small>두 문항을 함께 봅니다</small></h3>
    <div class="grid g3">
      ${col('keep', '👍', 'Keep', '구성원이 유지하고 싶어 하는 것', top(g, v => v.sent === '긍정', 'good'))}
      ${col('prob', '⚠️', 'Problem', '현재 가장 불편한 것', top(im, v => v.sent === '부정' || v.sent === '혼합', 'improve'))}
      ${col('want', '💡', 'Want', '구성원이 원하는 변화', wantHtml)}
    </div>
    <p class="src">Keep은 '잘하고 있는 점' 문항의 긍정 응답, Problem은 '노력해야 할 점' 문항의 부정·혼합 응답, Want는 두 문항의 '개선 요청' 응답에서 많이 나온 순서입니다. 문장 수 기준이며 작성자 수가 아닙니다. Problem과 Want는 중복될 수 있어 합산하지 않습니다.</p></div>`;
}

function voiceSpot(o, key) {
  const isGood = key === 'good', r = segment(o, key), qn = SEGS[key].q, seen = new Set(), out = [];
  const list = textsIn(o.i).filter(ti => T[ti][1] === qn && rawOk(O[T[ti][0]])).map(ti => ({ ti, t: T[ti], c: clsFast(ti) }))
    .filter(x => x.c[2] !== '의견 없음' && x.c[0] !== 'C0' && (isGood ? x.c[1] === '긍정' : x.c[1] !== '긍정'));
  list.forEach(x => { x.q = voiceQuote(x.ti); });
  const score = x => isGood ? Math.min(x.q.length, 100) / 10 + (r.sum[x.c[3]]?.n || 0) / 50
    : x.t[4] * 10 + (STRONG_RE.test(x.q) ? 4 : 0) + (x.c[1] === '부정' ? 2 : 0) + Math.min(x.q.length, 100) / 50;
  list.filter(x => x.q.length >= 30).sort((a, b) => score(b) - score(a)).forEach(x => { if (out.length < 3 && !seen.has(x.c[3])) { seen.add(x.c[3]); out.push(x); } });
  return `<div class="card mt"><h3>가장 주목해야 할 목소리 ${scope('sub')} <small>원문 + 해석</small></h3>
    ${out.length ? out.map(x => { const n = r.sum[x.c[3]]?.n || 1; return `<figure class="bigq ${isGood ? 'good' : 'bad'}"><blockquote>${esc(x.q)}</blockquote>
      <figcaption>${esc(O[x.t[0]].name)} · ${esc(catName(x.c[0]))}${x.t[4] ? ' · ' + SIG[x.t[4]] : ''}</figcaption>
      <div class="bq-say"><b>해석</b> ${esc(expTitle(x.c[3], key))} — 같은 내용으로 분류된 응답 ${num(n)}건${!isGood && x.t[4] === 2 ? ' · 조직문화 저해 사례의 우선 검토 대상' : ''}</div></figure>`; }).join('')
      : '<p class="muted">원문 공개 기준을 충족하는 응답이 없습니다.</p>'}
    <p class="src">${isGood ? '구체적인 경험이 드러나는 긍정 응답' : '저해 신호와 표현 강도가 높은 응답'}을 주제별로 1건씩 자동 선정했습니다. 한 사람의 의견이므로 조직 전체의 사실로 단정하지 마세요. 호칭·조직 표현은 비식별 처리했고, 응답 ${settings.minRaw}명 이상 조직의 원문만 사용합니다.</p></div>`;
}

function rawTable(o, key) {
  const f = state.f.text || (state.f.text = { c: '', s: '', y: '', src: '', k: '' });
  ['c', 's', 'y', 'src', 'k'].forEach(k => { if (f[k] === undefined) f[k] = ''; });
  const all = textsIn(o.i).filter(ti => T[ti][1] === SEGS[key].q);
  const hidden = all.filter(ti => !rawOk(O[T[ti][0]])).length;
  const kw = f.k.trim();
  const rows = all.filter(ti => { const t = T[ti]; if (!rawOk(O[t[0]])) return false; const c = clsFast(ti);
    return (!f.c || c[0] === f.c) && (!f.s || (f.s === '의견 없음' ? c[2] === '의견 없음' : c[1] === f.s && c[2] !== '의견 없음')) && (!f.y || c[2] === f.y) && (!f.src || c[4] === f.src) && (!kw || t[3].includes(kw) || c[3].includes(kw)); });
  const pg = state.page.text || 0, per = 20, pages = Math.max(1, Math.ceil(rows.length / per)), p = Math.min(pg, pages - 1);
  return `<div class="card mt"><h3>실제 DATA 필터로 보기 <small>'${D.qtypes[SEGS[key].q]}' 문항 ${num(rows.length)}건${hidden ? ` · 응답 ${settings.minRaw}명 미만 조직의 원문 ${num(hidden)}건 비공개(집계에는 포함)` : ''}</small></h3>
    <div class="filters">
      ${selectBox('text', 'c', '전체 주제', [...CATS, 'C0'].map(c => [c, catName(c)]))}
      ${selectBox('text', 's', '전체 감정', [...SENTS, '의견 없음'].map(x => [x, x]))}
      ${selectBox('text', 'y', '전체 유형', TYPES.map(x => [x, x]))}
      ${selectBox('text', 'src', '전체 분류 출처', Object.entries(SRC))}
      <input class="input" data-f="text:k" placeholder="키워드 검색 (원문·요약)" value="${esc(f.k)}" style="flex:1;min-width:160px">
    </div>
    ${table(['조직', '원문', '요약', '주제', '감정', '유형', '분류 출처', ''], rows.slice(p * per, p * per + per).map(ti => { const t = T[ti], c = clsFast(ti);
      const main = `<tr><td style="white-space:nowrap">${esc(O[t[0]].name)}</td><td class="raw">${highlight(deid(t[3]), kw)}</td><td class="sum">${esc(c[3])}</td><td style="white-space:nowrap">${catName(c[0])}</td><td>${c[2] === '의견 없음' ? '<span class="muted">-</span>' : sentTag(c[1])}</td><td style="white-space:nowrap">${esc(c[2])}</td><td>${srcTag(c[4])}</td><td><button class="btn sm" data-edit="${ti}">수정</button></td></tr>`;
      return main + (state.edit === ti ? editRow(ti, c) : ''); }))}
    ${pager('text', rows.length, p, pages, per)}
    <p class="src">오분류는 '수정'으로 고치고 사유를 남길 수 있습니다. 수정 결과는 이 PC에 저장되며, 데이터 관리/설정 > 데이터 현황에서 내보내 다음 데이터 갱신에 반영할 수 있습니다.</p></div>`;
}

function voiceTab(o, key, print) {
  return `<p class="src" style="margin:0 0 12px">${esc(o.name)} ${scope('sub')} · '${D.qtypes[SEGS[key].q]}' 문항 분석 대상 ${num(segment(o, key).n)}건(의견 없음 제외, 문장 수) · 결론 → 근거 → 구성원 목소리 → 상세 데이터 순서입니다.</p>
    ${insightTop3(o, key)}${catShare(o, key)}${kpwCard(o)}${voiceSpot(o, key)}${print ? '' : rawTable(o, key)}`;
}

function editRow(ti, c) {
  const v = OVR[tkey(ti)];
  const opt = (arr, cur) => arr.map(([val, l]) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `<tr class="edit-row"><td colspan="8"><form id="ovrForm" data-ti="${ti}" class="inline-form">
    <label>주제<select class="select" name="category">${opt([...CATS, 'C0'].map(x => [x, catName(x)]), c[0])}</select></label>
    <label>감정<select class="select" name="sentiment">${opt(SENTS.map(x => [x, x]), c[1])}</select></label>
    <label>유형<select class="select" name="type">${opt(TYPES.map(x => [x, x]), c[2])}</select></label>
    <label style="flex:1;min-width:180px">요약<input class="input" name="summary" value="${esc(c[3])}" maxlength="40" required></label>
    <label style="flex:2;min-width:220px">수정 사유 (필수)<input class="input" name="reason" value="${esc(v?.reason || '')}" required placeholder="예: 긍정 문장인데 부정으로 분류됨"></label>
    <div class="inline-actions"><button class="btn primary">저장</button> <button type="button" class="btn" data-act="cancelEdit">취소</button>${v ? ` <button type="button" class="btn" data-act="clearOvr" data-key="${esc(tkey(ti))}">원래 분류로</button>` : ''}</div>
    ${v ? `<div class="muted" style="font-size:12px;width:100%">최근 수정 ${esc(v.at)} · 기존 분류: ${esc(catName(C[T[ti][2]][0]))} / ${esc(C[T[ti][2]][1])} (${esc(SRC[C[T[ti][2]][4]] || '')})</div>` : ''}
  </form></td></tr>`;
}

const REV_STATUS = ['미확인', '검토 중', '확인 완료', '해당 없음'];
const rkey = ti => O[T[ti][0]].code + '|' + T[ti][3];

function signalMatches(ti, f, rev) {
 const t=T[ti],c=clsFast(ti);
 return t[4]>0 && (!f.l||t[4]===+f.l) && (!f.c||c[0]===f.c) && (!f.st||(rev[rkey(ti)]?.status||'미확인')===f.st);
}
function signalOrgRows(o,f,rev) {
 const stat={};
 textsIn(o.i).filter(ti=>ok(O[T[ti][0]])&&signalMatches(ti,f,rev)).forEach(ti=>{const t=T[ti],v=stat[t[0]]||(stat[t[0]]=[0,0]);v[t[4]===2?0:1]++;});
 return Object.entries(stat).map(([i,[h,m]])=>{const x=O[i],n=ownTexts(x.i).length;return {x,h,m,n,rate:n?(h+m)/n*100:0};}).sort((a,b)=>(b.n>=20)-(a.n>=20)||b.h-a.h||b.rate-a.rate);
}
function viewSignal() {
  const o = O[state.org];
  const head = pageHead('조직문화 저해 사례', `${esc(o.name)} ${scope('sub')} · 자유기술 중 조직문화 저해 가능성을 확인해야 하는 응답의 검토 우선순위`,
    ok(o) ? '<button class="btn primary" data-act="exportSignalXlsx" title="현재 필터 기준 검토 목록 + 조직별 신호 규모">엑셀 다운로드</button><button class="btn" data-act="exportReview">검토 기록 CSV</button>' : '');
  if (!ok(o)) return head + limitCard(o);
  const f = state.f.sig || (state.f.sig = { l: '', c: '', st: '' });
  const rev = store.get('review', {});
  const all = textsIn(o.i).filter(ti => T[ti][4] > 0);
  const vis = all.filter(ti => rawOk(O[T[ti][0]]));
  const stOf = ti => rev[rkey(ti)]?.status || '미확인';
  const rows = vis.filter(ti => { const t = T[ti], c = clsFast(ti); return (!f.l || t[4] === +f.l) && (!f.c || c[0] === f.c) && (!f.st || stOf(ti) === f.st); })
    .sort((x, y) => T[y][4] - T[x][4] || T[y][6] - T[x][6] || T[x][0] - T[y][0]);
  const cmpRows = signalOrgRows(o,f,rev).slice(0,10);
  const hi = vis.filter(ti => T[ti][4] === 2).length;
  const done = vis.filter(ti => ['확인 완료', '해당 없음'].includes(stOf(ti))).length;
  const pg = state.page.sig || 0, per = 20, pages = Math.max(1, Math.ceil(rows.length / per)), p = Math.min(pg, pages - 1);
  const dropped = o.i === 0 && D.meta.sigDropped ? D.meta.sigDropped.high + D.meta.sigDropped.mid : 0;
  return head + `
  <div class="notice warn"><div><b>문제가 확인된 사례가 아닙니다.</b> 표현·분류 기준으로 <b>검토가 필요한 응답</b>을 골라 우선순위를 매긴 것이며, 특정 개인의 행위를 단정하지 않습니다. 인사·징계·괴롭힘 관련 사안은 HR/윤리/법무 검토를 거쳐 판단하십시오.</div></div>
  <div class="grid g4">
    <div class="card kpi"><div class="label">검토 대상</div><div class="value">${num(vis.length)}<small>건</small></div><div class="foot muted">${all.length - vis.length ? `응답 ${settings.minRaw}명 미만 조직 ${all.length - vis.length}건 원문 비공개` : '원문 공개 범위 전체'}${dropped ? ` · 감정 강도 '약' ${num(dropped)}건 제외` : ''}</div></div>
    <div class="card kpi"><div class="label">우선 검토</div><div class="value" style="color:var(--high)">${num(hi)}<small>건</small></div><div class="foot muted">괴롭힘·차별·폭언 등 표현 포함</div></div>
    <div class="card kpi"><div class="label">일반 검토</div><div class="value" style="color:var(--mid)">${num(vis.length - hi)}<small>건</small></div><div class="foot muted">무례·태만·의견 무시 등 태도 서술</div></div>
    <div class="card kpi"><div class="label">검토 진행</div><div class="value">${vis.length ? pct(done / vis.length) : '-'}</div><div class="foot muted">확인 완료·해당 없음 ${num(done)}건</div></div>
  </div>
  <div class="card mt"><h3>검토 목록</h3>
    <div class="filters">${selectBox('sig', 'l', '전체 우선순위', [[2, SIG[2]], [1, SIG[1]]])}${selectBox('sig', 'c', '전체 주제', CATS.map(c => [c, catName(c)]))}${selectBox('sig', 'st', '전체 검토 상태', REV_STATUS.map(s => [s, s]))}</div>
    ${table(['우선순위', '감정 강도', '조직', '원문', '판정 이유', '검토 상태', ''], rows.slice(p * per, p * per + per).map(ti => { const t = T[ti], c = clsFast(ti), r = rev[rkey(ti)];
      const main = `<tr><td>${sigTag(t[4])}</td><td>${intenTag(t[6])}</td><td style="white-space:nowrap">${esc(O[t[0]].name)}<div class="muted" style="font-size:12px">${D.qtypes[t[1]]}</div></td><td class="raw">${highlight(deid(t[3]), t[5])}<div class="muted" style="font-size:12px;margin-top:2px">요약: ${esc(c[3])}</div></td><td class="why" style="font-size:12px">${esc(t[7] || '-')}<div style="margin-top:4px">${srcTag(c[4])}</div></td><td style="white-space:nowrap">${tag(r?.status || '미확인', r?.status === '확인 완료' ? 'pos' : r?.status === '검토 중' ? 'acc' : '')}${r ? `<div class="muted" style="font-size:12px;margin-top:2px">${esc(r.owner || '')}${r.owner ? ' · ' : ''}${esc(r.at)}</div>` : ''}</td><td><button class="btn sm" data-review="${ti}">기록</button></td></tr>`;
      return main + (state.review === ti ? reviewRow(ti, r) : ''); }))}
    ${pager('sig', rows.length, p, pages, per)}
    <p class="src">검토 기록(상태·담당자·판정 이유·변경 이력)은 현재 이 PC 브라우저에 저장됩니다. 여러 담당자가 함께 관리하려면 서버 저장소 연동이 필요하며, 그 전까지는 'CSV'로 내보내 공유하세요.</p>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>조직별 신호 규모 ${scope('sub')} <small>현재 필터 · 직접 응답 · 상위 10개</small></h3>
      ${table(['조직', '우선(건)', '전체(건)', '자유기술(건)', '100건당', '응답인원(명)'], cmpRows.map(r => `<tr class="click" data-org="${r.x.i}"><td>${orgLabel(r.x)}</td><td class="num">${r.h}</td><td class="num">${r.h + r.m}</td><td class="num">${num(r.n)}</td><td class="num">${r.n >= 20 ? f1(r.rate) : '<span class="muted">표본 적음</span>'}</td><td class="num">${num(r.x.resp)}</td></tr>`))}
      <p class="src">Excel에는 화면의 10개 제한 없이 전체 조직이 포함됩니다. 큰 조직이 건수만으로 불리하게 보이지 않도록 자유기술 100건당 신호 수를 함께 표시합니다. 자유기술 20건 미만 조직은 비율을 산출하지 않습니다.</p></div>
    <div class="card"><h3>판정 기준</h3><div class="sub" style="font-size:13px">
      <p style="margin:0 0 6px"><b>우선 검토</b> · 괴롭힘·폭언·차별·갑질 등 인권·윤리 침해 가능성이 있는 표현이 긍정이 아닌 응답에 포함된 경우 (고발성 키워드 또는 LLM 판정)</p>
      <p style="margin:0 0 6px"><b>일반 검토</b> · '상호존중·업무 태도', '의견 개진·조직 유연성' 주제의 부정 응답 중 무례·태만·의견 무시 등 태도 서술</p>
      <p style="margin:0 0 6px"><b>감정 강도</b> · 약(완곡·추정·요청형) / 중(문제·피해 단정) / 강(격앙·직접적 폭언 묘사). '너무·매우·솔직히·!' 등 강조 표현은 한 단계 상향. <b>'약'은 검토 대상에서 제외</b>합니다.</p>
      <p style="margin:0" class="muted">'프로젝트'의 '프로', '책임감'의 '책임', 인프라 불편의 '불편' 등 문맥상 오탐은 제외합니다.</p></div></div>
  </div>`;
}

function reviewRow(ti, r) {
  return `<tr class="edit-row"><td colspan="7"><form id="reviewForm" data-ti="${ti}" class="inline-form">
    <label>검토 상태<select class="select" name="status">${REV_STATUS.map(s => `<option ${(r?.status || '미확인') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label>담당자<input class="input" name="owner" value="${esc(r?.owner || '')}" placeholder="이름 또는 부서"></label>
    <label style="flex:1;min-width:260px">판정 이유 / 조치 내용<input class="input" name="reason" value="${esc(r?.reason || '')}" required placeholder="예: HR 면담 결과 업무 분장 갈등으로 확인, 윤리 이슈 아님"></label>
    <div class="inline-actions"><button class="btn primary">저장</button> <button type="button" class="btn" data-act="cancelReview">닫기</button></div>
    ${r?.history?.length ? `<div class="hist">변경 이력${r.history.slice().reverse().map(h => `<div>${esc(h.at)} · ${esc(h.status)} · ${esc(h.owner || '-')} · ${esc(h.reason)}</div>`).join('')}</div>` : ''}
  </form></td></tr>`;
}

function propEvidence(o, x, lt) {
  const a = agg(o.i), b = bench(o), ca = a.cat[x.c];
  const li = (k, v) => `<li><span class="ev-k">${k}</span><div>${v}</div></li>`;
  const dq = x.dq.length ? x.dq.map(d => `"${esc(qShort(d.k))}" ${f1(d.v)}점(<span class="${d.gap >= 0 ? 'up' : 'down'}">${sg(d.gap)}</span>)`).join(', ') : '<span class="muted">이 주제를 직접 묻는 진단 문항이 없습니다.</span>';
  const ref = REF_Q.map(k => `${esc(qShort(k))} ${f1(o.qs[k])}점(${sg(o.qs[k] - b.qs[k])})`).join(', ');
  const obs = {
    both: `관련 문항 점수가 ${b.label}보다 낮고(최저 ${sg(x.worst)}점) 같은 주제의 개선 의견도 관찰됩니다. 두 결과의 관계와 원인은 추가 확인이 필요합니다.`,
    mixedHigh: `관련 문항 점수는 ${b.label}과 같거나 높지만(최저 ${sg(x.worst)}점) 개선 의견이 ${x.issue}건 있습니다. 전반적 인식은 양호하나 일부 구성원·예하조직의 경험일 수 있습니다.`,
    mixed: `관련 문항 점수 차이는 크지 않지만(최저 ${sg(x.worst)}점) 개선 의견이 ${x.issue}건 있습니다. 점수와 의견의 정도가 다르게 나타납니다.`,
    split: `관련 문항 중 ${x.dq.filter(d => d.gap <= -3).map(d => `"${esc(qShort(d.k))}"(${sg(d.gap)})`).join(', ')}은(는) ${b.label}보다 낮지만, ${x.dq.filter(d => d.gap >= 3).map(d => `"${esc(qShort(d.k))}"(${sg(d.gap)})`).join(', ')}은(는) 높습니다. 같은 주제 안에서도 결과가 엇갈리며, 개선 의견 ${x.issue}건이 어느 쪽과 관련되는지는 추가 확인이 필요합니다.`,
    scoreOnly: `관련 문항 점수는 낮지만(최저 ${sg(x.worst)}점) 같은 주제의 자유기술 의견은 없습니다. 점수가 낮은 이유는 자유기술로 설명되지 않습니다.`,
    text: '이 주제를 직접 측정하는 문항이 없어 자유기술 의견만 근거입니다.',
  }[x.st];
  const more = [];
  if (x.st === 'text') more.push('진단 문항으로 수준을 확인할 수 없음 → 부서 간담회 등으로 확인');
  if (x.st === 'split') more.push('점수가 낮은 문항과 높은 문항 중 어느 쪽이 개선 의견의 내용과 관련되는지 원문으로 확인');
  if (x.st === 'mixedHigh' || x.st === 'mixed') more.push('의견이 특정 예하조직·직무·연차에 집중되는지 확인' + (x.kidsIss.length ? ` (의견이 많은 예하조직: ${x.kidsIss.slice(0, 2).map(([k, n]) => `${esc(k.name)} ${n}건`).join(', ')})` : ''));
  if (x.st === 'scoreOnly') more.push('점수가 낮은 이유를 구성원 인터뷰로 확인');
  if (x.issue && x.issue < 5) more.push(`개선 의견이 ${x.issue}건으로 적어 대표성이 제한됨`);
  more.push('자유기술 건수는 문장 수이며 작성자 수가 아님 · 문항별 전년 점수가 없어 추세는 판단 불가');
  return `<div class="ev"><ul>
    ${li('직접 근거 · 점수', dq)}
    ${li('직접 근거 · 자유기술', `'${catName(x.c)}' 개선 의견 ${x.issue}건 (부정 ${ca.N} · 혼합 ${ca.M} · 요청 ${ca.req}) · 내용 있는 응답 ${num(a.content)}건 중 ${pct(x.issue / (a.content || 1))}${x.sums.length ? `<br>주요 내용: ${x.sums.map(([k, s]) => `'${esc(k)}'(${s.n})`).join(', ')}` : ''}${x.pos ? `<br>같은 주제의 긍정 의견 ${x.pos}건` : ''}`)}
    ${li('참고 근거', `${ref} <span class="muted">— 포괄적 만족 지표로, 이 과제를 직접 설명하지는 않습니다.</span>`)}
    ${li('결과 관찰', obs)}
    ${lt?.why ? li('LLM 근거 해석', `${esc(lt.why)} <span class="muted">(LLM 작성 · 위 수치와 대조해 확인하세요)</span>`) : ''}
    ${li('추가 확인', (lt?.check ? [esc(lt.check) + ' <span class="muted">(LLM)</span>', ...more] : more).join('<br>'))}
  </ul></div>`;
}

function trackForm(o, x, lt) {
  const k = taskKey(o, x.c), tk = store.get('tasks', {})[k] || {};
  const metric = tk.metric ?? lt?.metric ?? (x.st === 'lead' ? `'부서장에게 하고 싶은 말' 중 '${catName(x.c)}' 요청 건수` : [...x.dq.slice(0, 2).map(d => `문항 "${qShort(d.k)}"`), `'${catName(x.c)}' 개선 의견 건수`].join(' / '));
  return `<details class="track"><summary>실행 관리 ${tag(tk.status || '미착수', tk.status === '완료' ? 'pos' : tk.status === '진행 중' ? 'acc' : '')}${tk.owner ? ` <span class="muted">담당 ${esc(tk.owner)}</span>` : ''}${tk.at ? ` <span class="muted">· ${esc(tk.at)}</span>` : ''}</summary>
    <form class="inline-form track-form" data-task="${esc(k)}" data-cat="${x.c}">
      <label>담당자<input class="input" name="owner" value="${esc(tk.owner || '')}" placeholder="이름"></label>
      <label>진행 상태<select class="select" name="status">${TASK_STATUS.map(s => `<option ${(tk.status || '미착수') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>목표 시점<input class="input" type="month" name="due" value="${esc(tk.due || '')}"></label>
      <label style="flex:1;min-width:220px">완료 기준<input class="input" name="done" value="${esc(tk.done ?? lt?.done ?? ACT[x.c].done)}"></label>
      <label style="flex:1;min-width:260px">후속 확인 지표 (다음 진단)<input class="input" name="metric" value="${esc(metric)}"></label>
      <div class="inline-actions"><button class="btn primary">저장</button></div>
    </form></details>`;
}

const PROP_SYS = `당신은 조직문화 진단 결과를 실행 과제로 전환하는 '조직문화 진단 AI 분석 Agent'다.
[절대 원칙] 제공된 데이터에 없는 사실·숫자를 만들지 않는다. 상관관계를 인과로 단정하지 않고 원인은 가설로 표현한다. 특정 개인·소수 집단을 식별하거나 비난하지 않는다. 민감한 인사·괴롭힘 이슈는 사실 판단 없이 HR/윤리 검토를 권고한다. 표본이 작거나 결과가 엇갈리면 그대로 밝힌다.
[작성 원칙] 부서장이 실제로 실행할 수 있는 구체적 행동으로 쓴다. 제공된 '검토 대상 주제'만 사용하고 순서를 유지한다. 한국어로 간결하게 쓴다.
JSON 객체 하나만 출력한다: {"tasks":[{"topic":"C4","title":"과제명(20자 이내)","lead":"부서장이 1~3개월 안에 할 행동 1~2문장","hr":"HR 지원 내용 1문장","long":"중장기 조직·제도 과제 1문장","done":"측정 가능한 완료 기준 1문장","metric":"다음 진단에서 확인할 지표","why":"제공된 수치를 인용해 근거를 연결하는 1~2문장","check":"현재 데이터로 확인할 수 없어 추가 확인할 사항 1문장"}]}`;
const llmPropKey = (o, field = 'lead') => o.code + '|' + (field === 'hr' ? 'hr' : 'lead') + '|' + D.meta.built;
const llmPending = new Set();

/* ---- 부서장 제언: '부서장에게 하고 싶은 말' 문항만 분석 ---- */
const LEAD_Q = 2;
const ATTN_STRONG = /폭언|막말|욕설|차별|갑질|무시|화가|억울|모욕|괴롭/;
const ATTN_RE = /너무|매우|정말|심각|도저히|전혀|절대|더 이상|반드시|당장|!|솔직히|답답|힘들|지치|실망|불만|폭언|막말|욕설|차별|갑질|무시|화가|억울|모욕|괴롭/;
const leadIssue = v => v.type === '개선 요청' || v.sent === '부정' || v.sent === '혼합';

function leadAnalysis(o) {
  const r = { n: 0, none: 0, P: 0, U: 0, N: 0, M: 0, H: 0, req: 0, cat: {}, sum: {}, attn: {}, attnN: 0, attnHidden: 0 };
  for (const ti of textsIn(o.i)) {
    const t = T[ti]; if (t[1] !== LEAD_Q) continue;
    const c = clsFast(ti); r.n++;
    if (c[2] === '의견 없음') { r.none++; continue; }
    const k = SENT_KEY[c[1]] || 'H'; r[k]++;
    const ca = r.cat[c[0]] || (r.cat[c[0]] = { n: 0, P: 0, U: 0, N: 0, M: 0, H: 0, req: 0 }); ca.n++; ca[k]++;
    const isReq = c[2] === '개선 요청'; if (isReq) { r.req++; ca.req++; }
    const sm = r.sum[c[3]] || (r.sum[c[3]] = { n: 0, cat: c[0], sent: c[1], type: c[2], ex: null }); sm.n++;
    if (sm.ex == null && rawOk(O[t[0]])) sm.ex = ti;
    const m = t[3].match(ATTN_RE);
    if ((k === 'N' || k === 'M' || isReq) && (t[4] > 0 || m)) {
      r.attnN++;
      if (!rawOk(O[t[0]])) { r.attnHidden++; continue; }
      const why = t[4] > 0 ? `확인 필요 신호(${SIG[t[4]]})` : `강조 표현 '${m[0]}'`;
      const lv = t[4] === 2 || (m && ATTN_STRONG.test(m[0])) ? 2 : 1;
      const key = c[3] + '|' + why;
      const g = r.attn[key] || (r.attn[key] = { sum: c[3], cat: c[0], why, lv, n: 0, ex: ti }); g.n++;
    }
  }
  r.content = r.n - r.none;
  return r;
}

function leadProposals(o, r = leadAnalysis(o)) {
  const total = Object.values(r.cat).reduce((acc, ca) => acc + ca.req + ca.N + ca.M, 0) || 1;
  return CATS.map(c => {
    const ca = r.cat[c]; if (!ca) return null;
    const issue = ca.req + ca.N + ca.M; if (!issue) return null;
    const sums = Object.entries(r.sum).filter(([, v]) => v.cat === c && leadIssue(v)).sort((x, y) => y[1].n - x[1].n).slice(0, 3);
    const attn = Object.values(r.attn).filter(g => g.cat === c).reduce((acc, g) => acc + g.n, 0);
    return { c, issue, share: issue / total, sums, pos: ca.P, attn, dq: [], st: 'lead', kidsIss: [], ca };
  }).filter(Boolean).sort((x, y) => y.issue - x.issue).slice(0, 5);
}

function leadAnalysisCards(o, r) {
  const den = r.content || 1;
  const sentStack = x => `<div class="stack">${['P', 'U', 'M', 'H', 'N'].map(k => x[k] ? `<i style="width:${x[k] / x.n * 100}%;background:${SENT_COLOR[k]}"></i>` : '').join('')}</div>`;
  const sentList = ['긍정', '중립', '부정', '혼합', '판단보류'].filter(sn => sn === '긍정' || sn === '중립' || sn === '부정' || r[SENT_KEY[sn]]);
  const legend = `<span class="legend">${sentList.map(sn => `<span><i style="background:${SENT_COLOR[SENT_KEY[sn]]}"></i>${sn}</span>`).join('')}</span>`;
  const cats = Object.entries(r.cat).sort((x, y) => y[1].n - x[1].n);
  const maxN = cats.length ? cats[0][1].n : 1;
  const ex = ti => ti == null ? '' : `<div class="quote">“${esc(T[ti][3])}” <span class="muted">— ${esc(O[T[ti][0]].name)}</span></div>`;
  const sums = Object.entries(r.sum).sort((x, y) => y[1].n - x[1].n);
  const common = (pred, lim) => sums.filter(([, v]) => pred(v)).slice(0, lim).map(([k, v]) => `<div class="op"><div class="op-h"><b>${esc(k)}</b><span class="muted">${num(v.n)}건 · ${pct(v.n / den)}</span></div><div class="chips" style="margin-top:2px">${tag(catName(v.cat))}${sentTag(v.sent)}</div>${ex(v.ex)}</div>`).join('') || '<p class="muted">해당 의견이 없습니다.</p>';
  const attn = Object.values(r.attn).sort((x, y) => y.lv - x.lv || y.n - x.n).slice(0, 8);
  return `
  <div class="card"><h3>부서장에게 하고 싶은 말 ${scope('sub')} <small>'부서장에게 하고 싶은 말' 문항 응답만 분석</small></h3>
    <div class="grid lead-top">
      <div>
        <div class="seg-kpi"><span class="seg-n">${num(r.content)}<small>건</small></span><span class="muted">분석 대상(내용 있는 응답)</span></div>
        <div class="muted" style="font-size:13px;margin-top:4px">전체 ${num(r.n)}건 중 <b>무의미 응답 ${num(r.none)}건(${pct(r.none / (r.n || 1))})은 별도 제외</b> · "없음", "잘 모르겠습니다" 등</div>
      </div>
      <div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">감정 비율 · 분모 ${num(r.content)}건</div>
        <div class="stack" style="height:12px">${['P', 'U', 'M', 'H', 'N'].map(k => r[k] ? `<i style="width:${r[k] / den * 100}%;background:${SENT_COLOR[k]}"></i>` : '').join('')}</div>
        <div class="sent-row">${sentList.map(sn => { const k = SENT_KEY[sn]; return `<div><span class="dot" style="background:${SENT_COLOR[k]}"></span>${sn}<b>${pct(r[k] / den)}</b><span class="muted">${num(r[k])}건</span></div>`; }).join('')}</div>
      </div>
    </div>
  </div>
  <div class="card mt"><h3>카테고리별 의견 ${scope('sub')} ${legend}</h3>
    <div class="bars">${cats.map(([c, ca]) => `<div class="bar-row" style="grid-template-columns:150px 1fr 150px"><span class="nm">${catName(c)}</span><div style="width:${ca.n / maxN * 100}%;min-width:2px">${sentStack(ca)}</div><span class="val">${num(ca.n)}건 <span class="muted" style="font-size:12px">긍정 ${num(ca.P)} · 요청 ${num(ca.req)}${ca.N ? ` · 부정 ${num(ca.N)}` : ''}</span></span></div>`).join('')}</div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>많이 나온 공통 의견 · 감사·긍정</h3>${common(v => v.sent === '긍정', 5)}</div>
    <div class="card"><h3>많이 나온 공통 의견 · 요청·개선</h3>${common(leadIssue, 5)}</div>
  </div>
  <div class="card mt"><h3>주의 깊게 봐야 할 의견 <small>요청·부정 의견 중 강조·격한 표현 또는 확인 필요 신호 포함 · ${num(r.attnN)}건</small></h3>
    ${attn.length ? attn.map(g => `<div class="op"><div class="op-h"><b>${esc(g.sum)}</b><span class="muted">${num(g.n)}건</span></div><div class="chips" style="margin-top:2px">${tag(g.lv === 2 ? '우선 확인' : '표현 주의', g.lv === 2 ? 'high' : 'mid')}${tag(g.why)}${tag(catName(g.cat))}</div>${ex(g.ex)}</div>`).join('')
      : '<p class="muted">강조·격한 표현이 포함된 의견이 없습니다.</p>'}
    <p class="src">강조 표현('너무', '솔직히', '!' 등)이나 격한 표현('무시', '막말' 등)이 있으면 표시합니다. 표현의 강도이며 사실 판단이 아닙니다.${r.attnHidden ? ` 응답 ${settings.minRaw}명 미만 조직의 ${num(r.attnHidden)}건은 원문을 표시하지 않습니다.` : ''}</p>
  </div>`;
}

function leadEvidence(o, x, r, lt) {
  const li = (k, v) => `<li><span class="ev-k">${k}</span><div>${v}</div></li>`;
  const exTi = x.sums.length ? r.sum[x.sums[0][0]].ex : null;
  return `<div class="ev"><ul>
    ${li('구성원 요청', `'${catName(x.c)}' 요청·개선 의견 ${num(x.issue)}건 (개선 요청 ${num(x.ca.req)}${x.ca.N ? ` · 부정 ${num(x.ca.N)}` : ''}${x.ca.M ? ` · 혼합 ${num(x.ca.M)}` : ''}) · 분석 대상 ${num(r.content)}건 중 ${pct(x.issue / (r.content || 1))}`)}
    ${x.sums.length ? li('주요 내용', x.sums.map(([k, v]) => `'${esc(k)}'(${v.n}건)`).join(', ')) : ''}
    ${exTi != null ? li('원문 예시', `“${esc(T[exTi][3])}”`) : ''}
    ${li('유지할 점', x.pos ? `같은 주제의 감사·긍정 의견 ${num(x.pos)}건 — 현재 잘하고 있는 부분은 유지하면서 요청을 반영할 수 있습니다.` : '같은 주제의 감사·긍정 의견은 없습니다.')}
    ${x.attn ? li('주의 깊게 볼 의견', `강조 표현 등이 포함된 의견 ${num(x.attn)}건`) : ''}
    ${lt?.why ? li('LLM 근거 해석', `${esc(lt.why)} <span class="muted">(LLM 작성 · 위 건수와 대조해 확인하세요)</span>`) : ''}
    ${li('추가 확인', [lt?.check ? esc(lt.check) + ' <span class="muted">(LLM)</span>' : '', x.issue < 5 ? `요청이 ${x.issue}건으로 적어 대표성이 제한됨` : '', "'부서장에게 하고 싶은 말' 문항만 근거이며 진단 점수는 반영하지 않음 · 건수는 문장 수이며 작성자 수가 아님"].filter(Boolean).join('<br>'))}
  </ul></div>`;
}

function llmPropPrompt(o, ps, field) {
  if (field === 'lead') {
    const r = leadAnalysis(o);
    const lines = [`[조직] ${o.name}(${LV[o.level]}) · '부서장에게 하고 싶은 말' 문항 분석 대상 ${r.content}건(무의미 응답 ${r.none}건 제외, 문장 수) · 긍정 ${r.P} / 중립 ${r.U} / 부정 ${r.N}`,
      '[근거 범위] 이 과제는 부서장에게 하고 싶은 말 응답만 근거로 한다. 진단 점수는 사용하지 않는다.', '[검토 대상 주제] (요청 건수 순)'];
    ps.forEach(x => {
      lines.push(`- ${x.c} ${catName(x.c)} | 요청·개선 의견 ${x.issue}건(개선 요청 ${x.ca.req}, 부정 ${x.ca.N}, 혼합 ${x.ca.M}) · 같은 주제 감사·긍정 ${x.pos}건 · 강조 표현 의견 ${x.attn}건`);
      lines.push(`  주요 내용: ${x.sums.map(([k, v]) => `'${k}'(${v.n})`).join(', ') || '없음'}`);
    });
    return lines.join('\n');
  }
  const a = agg(o.i), b = bench(o);
  const lines = [`[조직] ${o.name}(${LV[o.level]}) · 응답 ${o.resp}명(응답률 ${pct(o.rate)}) · ${caution(o) ? '표본·응답률 주의' : '응답 기준 충족'}`,
    `[종합] 2026 ${f1(o.t[0])}점, 전년 대비 ${sg(o.t[0] - o.t[1])}${o.i ? `, 전사 대비 ${sg(o.t[0] - O[0].t[0])}` : ''} · 자유기술 내용 있는 응답 ${a.content}건(문장 수, 작성자 수 아님)`,
    `[참고 지표(포괄 만족, 과제의 직접 근거 아님)] ${REF_Q.map(k => `${Q[k]} ${f1(o.qs[k])}(${b.label} 대비 ${sg(o.qs[k] - b.qs[k])})`).join(' / ')}`,
    '[검토 대상 주제] (우선순위 순)'];
  ps.forEach(x => {
    const ca = a.cat[x.c];
    lines.push(`- ${x.c} ${catName(x.c)} | 결과 상태: ${STATE_TXT[x.st]}`);
    lines.push(`  직접 문항: ${x.dq.length ? x.dq.map(d => `"${Q[d.k]}" ${f1(d.v)}점(${b.label} 대비 ${sg(d.gap)})`).join('; ') : '없음(이 주제를 직접 묻는 문항 없음)'}`);
    lines.push(`  자유기술 개선 의견 ${x.issue}건(부정 ${ca.N}, 혼합 ${ca.M}, 요청 ${ca.req}) · 같은 주제 긍정 ${x.pos}건 · 주요 내용: ${x.sums.map(([k, v]) => `'${k}'(${v.n})`).join(', ') || '없음'}`);
    if (x.kidsIss.length) lines.push(`  의견이 많은 예하조직: ${x.kidsIss.slice(0, 3).map(([k, n]) => `${k.name} ${n}건`).join(', ')}`);
  });
  return lines.join('\n');
}

async function genLLMProps(o, ps, field) {
  const k = llmPropKey(o, field);
  if (llmPending.has(k)) return;
  llmPending.add(k); state.llmErr = null;
  try {
    const t = await llmChat([{ role: 'system', content: PROP_SYS }, { role: 'user', content: llmPropPrompt(o, ps, field) }], 900000, true);
    const m = t.match(/\{[\s\S]*\}/), obj = JSON.parse(m ? m[0] : t), cand = new Set(ps.map(x => x.c));
    const cut = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const tasks = {};
    (obj.tasks || []).forEach(x => {
      const c = String(x.topic || '').trim().toUpperCase();
      if (!cand.has(c) || tasks[c] || !x.title || !x.lead) return;
      tasks[c] = { title: cut(x.title, 40), lead: cut(x.lead, 300), hr: cut(x.hr, 200), long: cut(x.long, 200), done: cut(x.done, 120), metric: cut(x.metric, 160), why: cut(x.why, 300), check: cut(x.check, 200) };
    });
    if (!Object.keys(tasks).length) throw new Error('LLM 응답에서 유효한 과제를 찾지 못했습니다.');
    const cache = store.get('llmProps', {}); cache[k] = { model: llmCfg().model, at: now(), tasks }; store.set('llmProps', cache);
  } catch (e) {
    state.llmErr = { k, msg: e.message };
  } finally {
    llmPending.delete(k);
    const tb = curTab('report', 'sum');
    if (state.view === 'report' && ['lead', 'hr'].includes(tb) && llmPropKey(O[state.org], tb) === k) render();
  }
}

function propBody(o, field) {
  const isHr = field === 'hr';
  const r = isHr ? null : leadAnalysis(o);
  const ps = isHr ? proposals(o) : leadProposals(o, r);
  const cfg = llmCfg(), pk = llmPropKey(o, field), L = llmOn() ? store.get('llmProps', {})[pk] : null;
  const pending = llmPending.has(pk), err = state.llmErr && state.llmErr.k === pk ? state.llmErr.msg : '';
  if (llmOn() && ps.length && !L && !pending && !err) setTimeout(() => genLLMProps(o, ps, field), 0);
  const llmNote = !cfg.on ? '' : !SERVED ? fileNote
    : L ? `<div class="notice info" style="justify-content:space-between"><div><b>LLM 작성</b> 로컬 LLM(${esc(L.model)})이 아래 근거 데이터로 과제 문안을 작성했습니다 · ${esc(L.at)}. 건수·점수 근거는 데이터에서 직접 계산한 값입니다.</div><button class="btn sm" data-act="regenProps">다시 작성</button></div>`
    : pending || !err ? `<div class="notice info"><div><span class="spin"></span><b>로컬 LLM 작성 중</b> ${esc(cfg.model)}이 이 조직의 과제 문안을 작성하고 있습니다. 완료 전까지 기본 문안을 표시합니다.</div></div>`
    : `<div class="notice warn" style="justify-content:space-between"><div><b>LLM 작성 실패</b> ${esc(err)} · 기본 문안을 표시합니다.</div><button class="btn sm" data-act="regenProps">다시 시도</button></div>`;
  const intro = isHr
    ? '<b>HR 제언(검토용)</b> 진단 점수와 자유기술 전체를 근거로, HR이 지원할 내용과 중장기 조직·제도 과제를 제안합니다. 우선순위 = 주제별 개선 의견 비중 + 해당 이슈를 직접 묻는 문항의 점수 격차.'
    : "<b>부서장 제언(검토용)</b> '부서장에게 하고 싶은 말' 문항 응답만 분석해 도출했습니다. 우선순위 = 주제별 요청·개선 의견 건수. 진단 점수 기반 과제는 HR 제언 탭에서 확인할 수 있습니다.";
  const cards = ps.length ? ps.map((x, n) => { const lt = L?.tasks?.[x.c]; return `
    <div class="prop"><div class="no">${n + 1}</div><div>
      <h4>${esc(lt?.title || ACT[x.c].t)}</h4>
      <p>${esc((lt && lt[field]) || ACT[x.c][field])}</p>
      ${isHr ? `<p class="muted" style="font-size:13px"><b>중장기</b> · ${esc((lt && lt.long) || ACT[x.c].long)}</p>` : ''}
      <div class="chips">${tag(catName(x.c), 'acc')}${isHr ? tag(STATE_TXT[x.st], x.st === 'both' ? '' : 'mid') + tag('HR 지원') + tag('단기~중장기') : tag(`구성원 요청 ${num(x.issue)}건`) + tag('부서장 주도') + tag('단기(1~3개월)')}${lt ? tag('LLM 작성', 'llm') : tag('기본 문안')}</div>
      ${isHr ? propEvidence(o, x, lt) : leadEvidence(o, x, r, lt)}
      ${isHr ? '' : trackForm(o, x, lt)}
    </div></div>`; }).join('') : `<p class="muted">${isHr ? '근거가 충분한 개선 과제가 도출되지 않았습니다.' : "'부서장에게 하고 싶은 말'에 요청·개선 의견이 없어 도출된 제언이 없습니다."}</p>`;
  return `
  ${llmNote}
  ${isHr ? '' : leadAnalysisCards(o, r)}
  <div class="notice info ${isHr ? '' : 'mt'}"><div>${intro} 원인은 검증이 필요한 가설이며, 실행 전 구성원과의 대화로 확인하시길 권장합니다.</div></div>
  ${caution(o) ? `<div class="notice warn"><b>표본·응답률 주의</b> 응답 ${o.resp}명 · 응답률 ${pct(o.rate)}</div>` : ''}
  <div class="card"><h3>${isHr ? 'HR 제언' : '부서장 제언'} ${scope('sub')}</h3>${cards}</div>`;
}

/* ---- 결과 리포트 인쇄 (A4) ---- */
const PRINT_SECS = { sum: '종합 요약', q: '항목 · 문항', good: '잘하고 있는 점', bad: '노력해야 할 점', lead: '부서장 제언', hr: 'HR 제언' };
const PRINT_DESC = {
  sum: '핵심 지표·건강 유형, 영역·항목 결과, 강점·약점, 예하조직 결과, 종합 브리핑',
  q: '12개 항목별 30개 문항 점수와 전사 대비 차이',
  good: 'Top 3 Insight, 카테고리별 비중, Keep·Problem·Want, 주목할 목소리',
  bad: 'Top 3 Insight, 카테고리별 비중, Keep·Problem·Want, 주목할 목소리',
  lead: "'부서장에게 하고 싶은 말' 분석과 부서장 제언",
  hr: '진단 점수·자유기술 기반 HR 지원·중장기 과제',
};

function openPrintDialog() {
  const o = O[state.org], saved = store.get('printSecs', Object.keys(PRINT_SECS)).flatMap(k => k === 'txt' ? ['good', 'bad'] : [k]), cover = store.get('printCover', true);
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="prTitle">
    <h3 id="prTitle">결과 리포트 인쇄</h3>
    <p class="muted" style="margin:0 0 12px;font-size:13px">${esc(o.name)} · A4 세로 · 선택한 항목을 순서대로 한 권의 리포트로 구성합니다.</p>
    <form id="printForm">
      <div class="pr-opts">${Object.entries(PRINT_SECS).map(([k, l]) => `<label class="pr-opt"><input type="checkbox" name="sec" value="${k}" ${saved.includes(k) ? 'checked' : ''}><span><b>${l}</b><small>${PRINT_DESC[k]}</small></span></label>`).join('')}</div>
      <div class="pr-opt-row"><button type="button" class="btn sm" data-act="prAll">전체 선택</button><button type="button" class="btn sm" data-act="prNone">선택 해제</button>
        <label class="chk"><input type="checkbox" name="cover" ${cover ? 'checked' : ''}> 표지·목차 포함</label></div>
      <p class="src" style="margin:10px 0 0">PDF로 저장하려면 인쇄 창의 대상에서 'PDF로 저장'을 선택하세요. 배경 그래픽 옵션을 켜면 차트 색이 그대로 인쇄됩니다.</p>
      <p id="prMsg" class="err-msg" style="margin:6px 0 0"></p>
      <div class="modal-actions"><button type="button" class="btn" data-act="closeModal">취소</button><button class="btn primary">인쇄</button></div>
    </form></div>`;
  m.hidden = false;
  m.querySelector('input[name=sec]').focus();
}
const closeModal = () => { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; };

function printReport(o, secs, cover) {
  const body = {
    sum: () => summaryBody(o),
    q: () => questionsBody(o),
    good: () => voiceTab(o, 'good', true),
    bad: () => voiceTab(o, 'improve', true),
    lead: () => propBody(o, 'lead'),
    hr: () => propBody(o, 'hr'),
  };
  const path = []; for (let x = o; x; x = x.parent >= 0 ? O[x.parent] : null) path.unshift(x.name);
  const list = Object.keys(PRINT_SECS).filter(k => secs.includes(k));
  const d1 = o.t[0] - o.t[1];
  const coverHtml = cover ? `<section class="pr-cover">
      <div class="pr-brand"><span class="brand-mark sm">sci</span><span>Culture Insight<small>조직문화 진단 워크스페이스</small></span></div>
      <div class="pr-kicker">2026 SCI 조직문화 진단</div>
      <h1 class="pr-title">결과 리포트</h1>
      <div class="pr-org-name">${esc(o.name)}</div>
      <div class="pr-path">${path.map(esc).join(' › ')}</div>
      <table class="pr-facts"><tbody>
        <tr><th>조직 단위</th><td>${LV[o.level]}</td><th>진단 연도</th><td>2026</td></tr>
        <tr><th>대상 인원</th><td>${num(o.target)}명</td><th>응답 인원</th><td>${num(o.resp)}명 (응답률 ${pct(o.rate)})</td></tr>
        <tr><th>종합점수</th><td>${f1(o.t[0])}점 (전년 대비 ${sg(d1)})</td><th>전사 대비</th><td>${o.i ? `${sg(o.t[0] - O[0].t[0])}점 (전사 ${f1(O[0].t[0])})` : '-'}</td></tr>
        <tr><th>응답 기준</th><td>${caution(o) ? '표본·응답률 주의' : '응답 기준 충족'}</td><th>출력일</th><td>${now().slice(0, 10)}</td></tr>
      </tbody></table>
      <div class="pr-toc"><h2>목차</h2><ol>${list.map(k => `<li><span>${PRINT_SECS[k]}</span><small>${PRINT_DESC[k]}</small></li>`).join('')}</ol></div>
      <div class="pr-note"><b>읽기 전 참고</b> 점수와 의견은 구성원 인식에 기반한 진단 결과이며, 원인은 검증이 필요한 가설입니다. 자유기술 건수는 문장 수이며 작성자 수가 아닙니다. 응답 ${settings.minN}명 미만 조직은 결과를 공개하지 않았고, 원문은 응답 ${settings.minRaw}명 이상 조직만 비식별 처리해 인용했습니다. 개인 평가 자료로 사용하지 마십시오.</div>
      <div class="pr-foot">데이터 기준 ${esc(D.meta.built)}</div>
    </section>` : `<div class="pr-mini"><b>${esc(o.name)}</b> 조직문화 진단 결과 리포트 · 2026 · 응답 ${num(o.resp)}명(${pct(o.rate)}) · 출력 ${now().slice(0, 10)}</div>`;
  const sections = list.map((k, i) => {
    const html = body[k]().replace(/<details class="more">/g, '<details class="more" open>');
    return `<section class="pr-sec ${i || cover ? 'pr-break' : ''}">
      <header class="pr-sec-h"><span class="pr-no">${String(i + 1).padStart(2, '0')}</span><h2>${PRINT_SECS[k]}</h2><span class="pr-sec-org">${esc(o.name)} · 2026 SCI 진단</span></header>
      ${html}</section>`;
  }).join('');
  return coverHtml + sections + `<div class="pr-end">본 리포트는 Culture Insight에서 자동 생성되었습니다 · 데이터 기준 ${esc(D.meta.built)}</div>`;
}

function runPrint(secs, cover) {
  const o = O[state.org], area = $('#printArea');
  area.innerHTML = printReport(o, secs, cover);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

/* ---- 저조부서 심층분석 ---- */
const SIZE_BANDS = [['', '전체 규모'], ['0-9', '10명 미만'], ['10-29', '10~29명'], ['30-99', '30~99명'], ['100-299', '100~299명'], ['300-', '300명 이상']];
const inBand = (o, band) => { if (!band) return true; const [lo, hi] = band.split('-'); return o.target >= +lo && (hi === '' || o.target <= +hi); };

function lowFilter() {
  const f = state.f.low || (state.f.low = { lv: '5', size: '', mode: 'bottom', n: '10', cut: '80', gap: '-3', hide: '' });
  const sc = O[state.org];
  const pool = O.slice(sc.i + (sc.kids.length ? 1 : 0), sc.end).filter(x => x.level > 2 && (!f.lv || String(x.level) === f.lv) && inBand(x, f.size));
  const excluded = pool.filter(x => !ok(x)).length;
  const valid = pool.filter(ok).sort((a, b) => a.t[0] - b.t[0]);
  let groups;
  if (f.mode === 'bottom') {
    const n = Math.max(1, Math.min(200, parseInt(f.n, 10) || 10));
    const lvls = f.lv ? [+f.lv] : [...new Set(valid.map(x => x.level))].sort((a, b) => a - b);
    groups = lvls.map(lv => [LV[lv], valid.filter(x => x.level === lv).slice(0, n)]).filter(g => g[1].length);
  } else {
    const cut = parseFloat(f.mode === 'cut' ? f.cut : f.gap);
    const rows = isNaN(cut) ? [] : valid.filter(x => f.mode === 'cut' ? x.t[0] <= cut : x.t[0] - O[0].t[0] <= cut);
    groups = [[f.lv ? LV[+f.lv] : '전체 단위', rows]];
  }
  return { f, sc, pool, excluded, valid, groups };
}

function trendSvg(o) {
  const v = [o.t[2], o.t[1], o.t[0]].map(Number), lo = Math.min(...v) - 1, hi = Math.max(...v) + 1;
  const x = i => 8 + i * 37, y = val => 24 - (val - lo) / (hi - lo || 1) * 18;
  const d = v.map((val, i) => `${i ? 'L' : 'M'}${x(i)},${y(val).toFixed(1)}`).join(' ');
  const up = v[2] - v[1];
  return `<svg class="trend" viewBox="0 0 90 30" width="90" height="30" aria-label="2024 ${f1(v[0])}, 2025 ${f1(v[1])}, 2026 ${f1(v[2])}"><path d="${d}" fill="none" stroke="${up < -0.05 ? 'var(--neg)' : up > 0.05 ? 'var(--pos)' : '#9aa3b2'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${v.map((val, i) => `<circle cx="${x(i)}" cy="${y(val).toFixed(1)}" r="${i === 2 ? 3 : 2.2}" fill="${i === 2 ? 'var(--text)' : '#b8bfca'}"/>`).join('')}</svg>`;
}

function lowIssues(o) {
  const b = bench(o), g = gaps(o), a = agg(o.i), d1 = o.t[0] - o.t[1], dc = o.t[0] - O[0].t[0];
  const weak = g.map((v, k) => [k, v]).filter(x => x[1] < 0).sort((x, y) => x[1] - y[1]).slice(0, 3);
  const areaDrop = o.area.map((v, k) => [k, v - o.areaPrev[k]]).filter(x => x[1] <= -2).sort((x, y) => x[1] - y[1]);
  const im = segment(o, 'improve'), pred = segPred('improve');
  const exps = Object.entries(im.sum).filter(([, v]) => pred(v) && v.cat !== 'C0').sort((x, y) => y[1].n - x[1].n).slice(0, 2);
  const lead = leadAnalysis(o), leadTop = Object.entries(lead.sum).filter(([, v]) => leadIssue(v)).sort((x, y) => y[1].n - x[1].n)[0];
  const trend = Math.abs(d1) < 0.05 ? '전년과 같은 수준입니다' : `전년 대비 ${Math.abs(d1).toFixed(1)}점 ${d1 > 0 ? '상승했습니다' : '하락했습니다'}`;
  const sentence = `종합 ${f1(o.t[0])}점으로 전사보다 ${Math.abs(dc).toFixed(1)}점 ${dc < 0 ? '낮고' : '높고'}, ${trend}.` +
    (weak.length ? ` 특히 ${weak.slice(0, 2).map(([k]) => ITEMS[k]).join('·')} 항목이 낮습니다.` : '');
  const items = [];
  if (weak.length) items.push(['낮은 항목', weak.map(([k, v]) => `${ITEMS[k]} ${f1(o.items[k])}(${sg(v)})`).join(', ')]);
  if (areaDrop.length) items.push(['영역 하락', areaDrop.map(([k, v]) => `${D.areas[k]} ${sg(v)}`).join(', ')]);
  if (exps.length) items.push(['구성원 의견', exps.map(([l, v]) => `“${esc(expTitle(l, 'improve'))}”(${v.n}건)`).join(' · ')]);
  if (leadTop) items.push(['부서장에게 요청', `‘${esc(leadTop[0])}’(${leadTop[1].n}건)`]);
  if (a.hi || a.mid) items.push(['확인 필요 신호', `우선 검토 ${a.hi}건 · 일반 검토 ${a.mid}건 (사실 판단 전)`]);
  if (caution(o)) items.push(['해석 주의', `응답 ${o.resp}명 · 응답률 ${pct(o.rate)}`]);
  if (!im.n) items.push(['자료 부족', "'노력해야 할 점' 응답이 없어 구성원 의견 요약을 제공하지 않습니다."]);
  return { sentence, items };
}

function viewLow() {
  const { f, sc, pool, excluded, valid, groups } = lowFilter();
  const rows = groups.flatMap(g => g[1]);
  const hide = f.hide === 'on';
  const lvOpts = [...new Set(O.slice(sc.i, sc.end).map(x => x.level))].filter(l => l > 2).sort((a, b) => a - b).map(l => [String(l), LV[l]]);
  const sel = (k, opts) => `<select class="select" data-f="low:${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const criterion = f.mode === 'bottom' ? `${f.lv ? LV[+f.lv] : '단위별'} 종합점수 하위 ${esc(f.n)}개` : f.mode === 'cut' ? `종합점수 ${esc(f.cut)}점 이하` : `전사 대비 ${esc(f.gap)}점 이하`;
  const pg = state.page.low || 0, per = 15, pages = Math.max(1, Math.ceil(rows.length / per)), p = Math.min(pg, pages - 1);
  const pageRows = new Set(rows.slice(p * per, p * per + per));
  const rowHtml = x => { const is = lowIssues(x), par = x.parent >= 0 ? O[x.parent].name : '';
    return `<tr><td class="low-name"><a class="click" data-org="${x.i}" data-go="report">${esc(x.name)}</a><div class="low-leader">부서장 ${hide ? '<span class="muted">가림</span>' : esc(x.leader || '-')}</div><div class="muted" style="font-size:12px">${LV[x.level]} · ${esc(par)}</div><div class="muted" style="font-size:12px">대상 ${num(x.target)}명 · 응답 ${num(x.resp)}명(${pct(x.rate)})</div>${caution(x) ? tag('표본·응답률 주의', 'mid') : ''}</td>
      <td class="num"><b style="font-size:16px">${f1(x.t[0])}</b></td>
      <td>${trendSvg(x)}<div class="muted" style="font-size:11.5px;white-space:nowrap">${f1(x.t[2])} → ${f1(x.t[1])} → ${f1(x.t[0])}</div><div style="font-size:12px">전년 ${dl(x.t[0] - x.t[1])}</div></td>
      <td class="num"><span class="${x.t[0] - O[0].t[0] >= 0 ? 'up' : 'down'}" style="font-weight:600">${sg(x.t[0] - O[0].t[0])}</span></td>
      <td class="low-issue"><p>${is.sentence}</p><ul>${is.items.map(([k, v]) => `<li><span class="ev-k">${k}</span><span>${v}</span></li>`).join('')}</ul></td></tr>`; };
  let body = '';
  if (!rows.length) body = '<p class="muted">조건에 해당하는 부서가 없습니다. 기준을 조정해 보세요.</p>';
  else body = groups.map(([name, list]) => { const vis = list.filter(x => pageRows.has(x)); if (!vis.length) return '';
    return `${groups.length > 1 ? `<div class="sub-h">${esc(name)} <small>${list.length}개</small></div>` : ''}${table(['부서명', '종합점수', '변화추이 (2024→2026)', '전사 대비', '주요 이슈 및 문제점'], vis.map(rowHtml))}`; }).join('');
  return pageHead('저조부서 심층분석', `${esc(sc.name)} ${scope('sub')} · 조직 단위·규모별로 점수가 낮은 부서를 골라 주요 이슈를 요약합니다.`,
    `<button class="btn" data-act="exportLow" ${rows.length ? '' : 'disabled'}>목록 CSV</button>`) + `
  <div class="card low-filter">
    <div class="filters" style="margin:0">
      <label>조직 단위 ${sel('lv', [['', '전체 단위(단위별로 구분)'], ...lvOpts])}</label>
      <label>인원 규모 ${sel('size', SIZE_BANDS)}</label>
      <label>기준 ${sel('mode', [['bottom', '종합점수 하위 N개'], ['cut', '종합점수 X점 이하'], ['gap', '전사 대비 X점 이하']])}</label>
      ${f.mode === 'bottom' ? `<label>개수 ${sel('n', [['5', '5개'], ['10', '10개'], ['20', '20개'], ['30', '30개'], ['50', '50개']])}</label>`
        : f.mode === 'cut' ? `<label>점수(이하)<input class="input" type="text" inputmode="decimal" data-f="low:cut" value="${esc(f.cut)}" style="width:90px"></label>`
        : `<label>전사 대비(점 이하)<input class="input" type="text" inputmode="decimal" data-f="low:gap" value="${esc(f.gap)}" style="width:90px"></label>`}
      <label class="chk"><input type="checkbox" data-act="lowHide" ${hide ? 'checked' : ''}> 부서장명 가리기</label>
    </div>
    <div class="src" style="margin-top:10px">기준: ${criterion} · 대상 ${num(valid.length)}개 부서 중 <b>${num(rows.length)}개</b> 해당 · 응답 ${settings.minN}명 미만 ${num(excluded)}개 부서는 비공개 원칙에 따라 제외 · 전사 종합점수 ${f1(O[0].t[0])}점</div>
  </div>
  <div class="notice warn mt"><div><b>해석 유의</b> 부서장명은 결과 확인과 후속 면담을 위한 참고 정보입니다. 점수와 의견은 부서 구성원의 인식이며, 부서장 개인에 대한 평가 자료로 사용하지 마세요. 원인은 검증이 필요한 가설로 보고, 민감한 이슈는 HR 검토를 거쳐 판단하십시오.</div></div>
  <div class="card mt">${body}${rows.length ? pager('low', rows.length, p, pages, per) : ''}
    <p class="src">주요 이슈는 진단 점수(전사 대비 낮은 항목·영역 하락), ‘노력해야 할 점’과 ‘부서장에게 하고 싶은 말’의 분류 결과, 확인 필요 신호를 자동 요약한 것입니다. 부서명을 누르면 부서별 결과 리포트로 이동합니다.</p></div>`;
}

/* =========================================================
   5. 자연어 질의 (규칙 분석 엔진 + 선택: 로컬 LLM)
   ========================================================= */
const CAT_ALIAS = [['C1', /회의|보고|결재|관행|비효율|업무방식/], ['C2', /인력|업무량|편중|충원|쏠림|과부하|업무 배분/], ['C3', /R&R|역할|협업|떠넘/i], ['C4', /리더|리더십|의사결정|피드백|방향 제시/],
  ['C5', /소통|정보\s?공유|통보/], ['C6', /평가|보상|성과급|처우|승진|고과/], ['C7', /매너|태도|차별|무례|태만|존중/], ['C8', /환경|인프라|장비|시설|시스템|공간/],
  ['C9', /수직|경직|권위|상명하복|눈치|의견 개진/], ['C10', /성장|교육|커리어|역량\s?개발|경력/]];

function nlLocal(q, scopeI) {
  let s = q;
  let org = null;
  for (const o of O) if (s.includes(o.name) && (!org || o.name.length > org.name.length)) org = o;
  if (org) s = s.replace(org.name, ' ');
  let sc = org || O[scopeI], expanded = '';
  const nm = s.match(/(\d+)\s*(개|곳|위|개\s?조직)/), N = nm ? Math.min(30, +nm[1]) : 5;
  const lvm = s.replace(/(팀장|그룹장|파트장|실장|사업부장|부서장)/g, '').match(/(사업부|그룹|파트|섹션|팀|실)(?=\s*(별|단위|중|들|은|는|이|가|의|을|를|에서|\s|\?|$))/);
  const lv = lvm ? lvm[1] : null;
  const item = ITEMS.findIndex(it => s.includes(it));
  const area = D.areas.findIndex(ar => s.includes(ar));
  const cat = (CAT_ALIAS.find(([, re]) => re.test(s)) || [])[0];
  const pool = () => O.slice(sc.i + 1, sc.end).filter(x => (!lv || LV[x.level] === lv) && ok(x));
  const widen = min => { const from = sc; while (pool().length < min && sc.parent >= 0) sc = O[sc.parent]; if (sc !== from) expanded = `선택 조직(${from.name}) 하위에 비교 대상이 부족하여 '${sc.name}' 범위로 확장했습니다. `; };
  const scopeTxtF = () => `${expanded}${sc.name}${lv ? ` 산하 ${lv}` : ' 산하 조직'}`;
  const rowsOf = (arr, cols) => arr.map(x => `<tr class="click" data-org="${x.i}">${cols.map(fn => fn(x)).join('')}</tr>`);
  const tdN = v => `<td class="num">${v}</td>`;
  const cTag = x => caution(x) ? tag('표본·응답률 주의', 'mid') : '';
  const out = (p, tbl, basis) => ({ html: `${p.map(x => `<p>${x}</p>`).join('')}${tbl || ''}<div class="basis">${basis}</div>` });
  const lowWord = /낮|최하|하위|나쁜|취약|부족/.test(s), highWord = /높|최고|상위|좋|우수/.test(s);
  const limited = () => out([`${esc(sc.name)}은(는) 응답자 ${sc.resp}명으로 최소 집계 기준(${settings.minN}명) 미만이어서 조회할 수 없습니다.`], '', '원칙: 소수 응답 집단 비공개');

  if (!ok(sc) && org) return limited();

  if (/공통|특징|차이/.test(s) && /우수|높|잘|상위|좋/.test(s)) {
    widen(8); const arr = pool().sort((a, b) => b.t[0] - a.t[0]);
    if (arr.length < 8) return out([`비교할 조직이 부족합니다(${arr.length}개). 상위 조직을 선택하거나 단위를 바꿔 질문해 주세요.`], '', '필요 데이터: 비교 가능한 조직 8개 이상');
    const k = Math.max(3, Math.round(arr.length * 0.2)), top = arr.slice(0, k), bot = arr.slice(-k);
    const itemDiff = ITEMS.map((it, j) => [it, mean(top.map(x => x.items[j])) - mean(bot.map(x => x.items[j])), j]).sort((a, b) => b[1] - a[1]);
    const negShare = (g, c) => { const t = g.reduce((acc, x) => { const a = agg(x.i); acc[0] += a.cat[c].N; acc[1] += a.content; return acc; }, [0, 0]); return t[1] ? t[0] / t[1] : 0; };
    const catDiff = CATS.map(c => [c, negShare(bot, c) - negShare(top, c)]).sort((a, b) => b[1] - a[1]);
    return out([`${esc(scopeTxtF())} 중 종합점수 상위 ${k}개와 하위 ${k}개 조직을 비교했습니다.`,
      `<b>점수 차이가 가장 큰 항목</b>: ${itemDiff.slice(0, 3).map(x => `${x[0]}(${sg(x[1])}점)`).join(', ')}`,
      `<b>하위 그룹에서 부정 비중이 더 높은 주제</b>: ${catDiff.slice(0, 3).map(x => `${catName(x[0])}(${sg(x[1] * 100)}%p)`).join(', ')}`,
      '관찰: 상위 그룹은 위 항목의 점수가 함께 높게 나타납니다. 이 차이가 종합점수 차이의 원인인지는 추가 확인이 필요합니다.'],
      table(['항목', '상위 그룹 평균', '하위 그룹 평균', '차이'], itemDiff.map(([it, d, j]) => `<tr><td>${it}</td>${tdN(f1(mean(top.map(x => x.items[j]))))}${tdN(f1(mean(bot.map(x => x.items[j]))))}${tdN(sg(d))}</tr>`)),
      `근거: 점수집계표 12개 항목 평균, 자유기술 부정 비중(분모: 내용 있는 응답) · 대상 ${arr.length}개 조직(응답 ${settings.minN}명 이상)`);
  }
  const quoted = q.match(/['"‘“](.+?)['"’”]/);
  if (quoted || /언급|포함|키워드/.test(s)) {
    const w = quoted ? quoted[1] : null;
    if (!w) return out(["검색할 단어를 따옴표로 감싸 주세요. 예: '회의' 언급 응답은?"], '', '');
    const inScope = textsIn(sc.i).filter(ti => T[ti][3].includes(w));
    const hits = inScope.filter(ti => rawOk(O[T[ti][0]]));
    const byCat = {}; inScope.forEach(ti => { const c = clsFast(ti); byCat[c[0]] = (byCat[c[0]] || 0) + 1; });
    return out([`${esc(sc.name)} 범위(예하조직 포함)에서 '${esc(w)}'가 포함된 응답은 ${num(inScope.length)}건(문장 수)입니다.`, Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${catName(c)} ${n}건`).join(' · ')],
      table(['조직', '원문', '감정'], hits.slice(0, 8).map(ti => `<tr><td>${esc(O[T[ti][0]].name)}</td><td>${highlight(T[ti][3], w)}</td><td>${sentTag(clsFast(ti)[1])}</td></tr>`)), `근거: 자유기술 원문 검색(최대 8건 표시 · 응답 ${settings.minRaw}명 미만 조직 원문 제외)`);
  }
  if (/저해|괴롭|신호|확인 필요|갑질|폭언|차별/.test(s)) {
    widen(3);
    const arr = pool().map(x => { const own = ownTexts(x.i); return Object.assign(x, { _h: own.filter(ti => T[ti][4] === 2).length, _m: own.filter(ti => T[ti][4] > 0).length, _n: own.length }); })
      .filter(x => x._m).sort((a, b) => b._h - a._h || b._m / b._n - a._m / a._n).slice(0, N);
    return out([`${esc(scopeTxtF())} 중 확인 필요 신호가 있는 조직입니다. 신호는 사실 확인 전 단계이며 HR/윤리 검토가 필요합니다.`],
      table(['조직', '단위', '우선 검토(건)', '전체(건)', '자유기술(건)', '응답인원(명)'], rowsOf(arr, [x => `<td>${esc(x.name)}</td>`, x => `<td>${LV[x.level]}</td>`, x => tdN(x._h), x => tdN(x._m), x => tdN(x._n), x => tdN(x.resp)])),
      '근거: 자유기술 중 고발성 키워드·태도 분류 신호(조직 직접 응답 기준, 감정 강도 약 제외)');
  }
  if (/응답률/.test(s)) {
    widen(3);
    const arr = pool().sort((a, b) => highWord && !lowWord ? b.rate - a.rate : a.rate - b.rate).slice(0, N);
    return out([`${esc(scopeTxtF())} 중 응답률이 ${highWord && !lowWord ? '높은' : '낮은'} 조직입니다. 응답률이 낮은 조직은 결과 대표성에 주의가 필요합니다.`],
      table(['조직', '단위', '대상(명)', '응답(명)', '응답률'], rowsOf(arr, [x => `<td>${esc(x.name)}</td>`, x => `<td>${LV[x.level]}</td>`, x => tdN(x.target), x => tdN(x.resp), x => tdN(pct(x.rate))])), '근거: 점수집계표 대상인원·응답인원');
  }
  if (/전년|작년|대비|변화/.test(s) && /하락|떨어|감소|악화|낮아|상승|올|향상|개선|높아/.test(s)) {
    widen(3);
    const up = /상승|올|향상|개선|높아/.test(s) && !/하락|떨어|감소|악화/.test(s);
    const col = item >= 0 || area >= 0 ? (area >= 0 ? x => x.area[area] - x.areaPrev[area] : null) : x => x.t[0] - x.t[1];
    if (!col) return out(['항목별 전년 점수는 데이터에 없어 비교할 수 없습니다. 전년 비교는 종합점수와 3개 영역(즐거운 일·함께하는 동료·자랑스러운 회사)만 가능합니다.'], '', '부족한 데이터: 항목·문항별 전년 점수');
    const arr = pool().sort((a, b) => up ? col(b) - col(a) : col(a) - col(b)).slice(0, N);
    const label = area >= 0 ? `'${D.areas[area]}' 영역` : '종합점수';
    return out([`${esc(scopeTxtF())} 중 전년 대비 ${label} ${up ? '상승' : '하락'} 폭이 큰 조직입니다.`],
      table(['조직', '단위', '2025', '2026', '전년 대비', '응답인원(명)'], rowsOf(arr, [x => `<td>${esc(x.name)} ${cTag(x)}</td>`, x => `<td>${LV[x.level]}</td>`,
        x => tdN(f1(area >= 0 ? x.areaPrev[area] : x.t[1])), x => tdN(f1(area >= 0 ? x.area[area] : x.t[0])), x => tdN(dl(col(x))), x => tdN(x.resp)])),
      `근거: 점수집계표 2025·2026 ${label} · 대상 ${pool().length}개 조직 · 과거 응답 규모와 조직 개편 여부는 확인되지 않음`);
  }
  if (cat && !/강점|약점|제언|과제/.test(s) && item < 0) {
    widen(3);
    const arr = pool().map(x => { const a = agg(x.i); return Object.assign(x, { _c: a.cat[cat].iss, _n: a.content, _r: a.content ? a.cat[cat].iss / a.content : 0 }); }).filter(x => x._n >= 10)
      .sort((a, b) => b._r - a._r).slice(0, N);
    return out([`${esc(scopeTxtF())} 중 '${catName(cat)}' 주제의 개선 의견(부정·혼합·요청) 비중이 높은 조직입니다.`],
      table(['조직', '단위', '개선 의견(건)', '내용 있는 응답(건)', '비중'], rowsOf(arr, [x => `<td>${esc(x.name)}</td>`, x => `<td>${LV[x.level]}</td>`, x => tdN(x._c), x => tdN(x._n), x => tdN(pct(x._r))])),
      '근거: 자유기술 분류 결과(예하조직 포함) · 내용 있는 응답 10건 이상 조직 · 건수는 문장 수이며 대표성을 보장하지 않음');
  }
  if (/강점|약점|잘하는 점|부족한 점/.test(s)) {
    if (!ok(sc)) return limited();
    const g = gaps(sc), b = bench(sc), idx = g.map((_, k) => k).sort((x, y) => g[y] - g[x]);
    return out([`<b>${esc(sc.name)}</b>의 ${b.label} 대비 강점과 약점입니다.`,
      `강점: ${idx.slice(0, 3).filter(k => g[k] > 0).map(k => `${ITEMS[k]} ${f1(sc.items[k])}점(${sg(g[k])})`).join(', ') || '없음'}`,
      `약점: ${idx.slice(-3).reverse().filter(k => g[k] < 0).map(k => `${ITEMS[k]} ${f1(sc.items[k])}점(${sg(g[k])})`).join(', ') || '없음'}`], '', `근거: 점수집계표 12개 항목 · 비교 기준 ${b.label}`);
  }
  if (/제언|과제|개선 방안|무엇을|우선/.test(s)) {
    if (!ok(sc)) return limited();
    const ps = proposals(sc).slice(0, 3);
    return out([`<b>${esc(sc.name)}</b> 부서장이 우선 검토할 과제(제안)입니다.`, ...ps.map((x, n) => `${n + 1}. <b>${ACT[x.c].t}</b> — ${esc(ACT[x.c].lead)}<br><span class="muted">${STATE_TXT[x.st]} · '${catName(x.c)}' 개선 의견 ${x.issue}건${x.dq.length ? ` · 직접 문항 최저 ${sg(x.worst)}점` : ''}</span>`)],
      '', '제안은 검토용이며 원인은 검증이 필요한 가설입니다. 근거 상세는 부서별 결과 리포트 > 부서장 제언 탭에서 확인하세요.');
  }
  if ((item >= 0 || area >= 0) && (lowWord || highWord)) {
    widen(3);
    const val = x => item >= 0 ? x.items[item] : x.area[area];
    const arr = pool().sort((a, b) => lowWord ? val(a) - val(b) : val(b) - val(a)).slice(0, N);
    const label = item >= 0 ? ITEMS[item] : D.areas[area];
    return out([`${esc(scopeTxtF())} 중 '${label}' 점수가 ${lowWord ? '낮은' : '높은'} 조직입니다.`],
      table(['조직', '단위', `${label} 점수`, '전사 대비', '응답인원(명)'], rowsOf(arr, [x => `<td>${esc(x.name)} ${cTag(x)}</td>`, x => `<td>${LV[x.level]}</td>`, x => tdN(f1(val(x))),
        x => tdN(sg(val(x) - (item >= 0 ? O[0].items[item] : O[0].area[area]))), x => tdN(x.resp)])), `근거: 점수집계표 '${label}' · 대상 ${pool().length}개 조직`);
  }
  if ((lowWord || highWord) && /조직|팀|그룹|파트|실|사업부|점수|어디/.test(s)) {
    widen(3);
    const arr = pool().sort((a, b) => lowWord ? a.t[0] - b.t[0] : b.t[0] - a.t[0]).slice(0, N);
    return out([`${esc(scopeTxtF())} 중 종합점수가 ${lowWord ? '낮은' : '높은'} 조직입니다.`],
      table(['조직', '단위', '종합점수', '전년 대비', '응답인원(명)'], rowsOf(arr, [x => `<td>${esc(x.name)} ${cTag(x)}</td>`, x => `<td>${LV[x.level]}</td>`, x => tdN(f1(x.t[0])), x => tdN(dl(x.t[0] - x.t[1])), x => tdN(x.resp)])),
      `근거: 점수집계표 2026 종합점수 · 대상 ${pool().length}개 조직`);
  }
  if (org || /요약|결과|현황|브리핑/.test(s)) {
    if (!ok(sc)) return limited();
    return out([`<b>${esc(sc.name)}</b> 요약입니다.`, ...briefing(sc).map(([k, v]) => `<b>${k}</b> · ${esc(v)}`)], '', '근거: 점수집계표 및 자유기술 분류 결과');
  }
  return out(['질문을 이해하지 못했습니다. 아래와 같이 질문해 보세요.',
    '· 전년 대비 가장 많이 하락한 팀은? · 소통 점수가 낮은 그룹 10개 · 업무 배분 관련 의견이 많은 조직은?<br>· 우수 조직의 공통 특징은? · 마케팅팀 강점과 약점 · 확인 필요 신호가 많은 조직은? · \'회의\' 언급 응답은?'], '', '조회 범위는 좌측에서 선택한 조직(또는 질문에 포함된 조직명)입니다.');
}

function llmContext(sc) {
  const lines = [], a = agg(sc.i), b = bench(sc);
  lines.push(`[분석 범위] ${sc.name}(${LV[sc.level]}) / 점수는 선택 조직 값, 자유기술은 예하조직 포함 합산 / 최소 집계 기준 ${settings.minN}명 (미만 조직은 '분석 제한')`);
  lines.push(`[전사 기준] 종합 ${f1(O[0].t[0])}, 항목: ${ITEMS.map((it, k) => `${it} ${f1(O[0].items[k])}`).join(', ')}`);
  if (ok(sc)) {
    lines.push(`[${sc.name} 점수] 대상 ${sc.target}명, 응답 ${sc.resp}명(응답률 ${pct(sc.rate)}), 종합 2024 ${f1(sc.t[2])} / 2025 ${f1(sc.t[1])} / 2026 ${f1(sc.t[0])} (과거 응답 규모·조직 개편 여부는 미확인)`);
    lines.push(`영역(2026, 전년): ${D.areas.map((ar, k) => `${ar} ${f1(sc.area[k])}(${f1(sc.areaPrev[k])})`).join(', ')}`);
    lines.push(`항목(2026, ${b.label} 대비): ${ITEMS.map((it, k) => `${it} ${f1(sc.items[k])}(${sg(sc.items[k] - b.items[k])})`).join(', ')}`);
    lines.push(`문항(2026, ${b.label} 대비): ${Q.map((q, qi) => `${q} ${f1(sc.qs[qi])}(${sg(sc.qs[qi] - b.qs[qi])})`).join(' | ')}`);
    lines.push(`[자유기술 분류] 전체 ${a.n}건(문장 수, 작성자 수 아님), 의견 없음 ${a.none}, 내용 있는 응답 ${a.content}: 긍정 ${a.P} / 중립 ${a.U} / 혼합 ${a.M} / 판단보류 ${a.H} / 부정 ${a.N}, 개선요청 ${a.req}, 확인필요신호 우선 ${a.hi} 일반 ${a.mid}`);
    lines.push('주제별(내용 있는 응답/긍정/부정/혼합/요청): ' + [...CATS, 'C0'].map(c => { const x = a.cat[c]; return `${catName(c)} ${x.n - x.none}/${x.P}/${x.N}/${x.M}/${x.req}`; }).join(', '));
    lines.push('주요 요약(건수): ' + topSummaries(a, () => true, 25).map(s => `${s[0]}[${catName(s[2])},${s[3]}] ${s[1]}`).join('; '));
    lines.push('검토 필요 사항: ' + (risks(sc).map(r => `${r[1]}(${r[2]})`).join('; ') || '없음'));
  }
  const sub = O.slice(sc.i + 1, sc.end).filter(x => x.level <= sc.level + 1).slice(0, 60);
  if (sub.length) {
    lines.push('[예하조직] 이름|단위|응답|응답률|2026|2025|최저항목(전사대비)|부정%(내용있는응답)|신호우선/전체');
    sub.forEach(x => {
      if (!ok(x)) { lines.push(`${x.name}|${LV[x.level]}|분석 제한`); return; }
      const g = gaps(x), wk = g.indexOf(Math.min(...g)), xa = agg(x.i);
      lines.push(`${x.name}|${LV[x.level]}|${x.resp}|${pct(x.rate)}|${f1(x.t[0])}|${f1(x.t[1])}|${ITEMS[wk]}(${sg(g[wk])})|${xa.content ? pct(xa.N / xa.content) : '-'}|${xa.hi}/${xa.hi + xa.mid}`);
    });
  }
  return lines.join('\n');
}

const SYS_PROMPT = `당신은 조직문화 진단 데이터를 분석하는 '조직문화 진단 AI 분석 Agent'다.
당신의 역할은 진단 결과를 정확하고 중립적으로 해석하고, 근거가 확인 가능한 실행과제로 전환하는 것이다.

[절대 원칙]
1. 제공된 데이터에 없는 사실을 만들지 않는다.
2. 수치, 원문, 계산 결과, 해석, 제안사항을 구분한다. (답변에서 [수치] [관찰] [제안] 표시를 사용)
3. 상관관계를 인과관계로 단정하지 않는다. 실제 상관분석을 하지 않았으므로 '함께 관찰된다', '관계와 원인은 추가 확인이 필요하다'로 표현한다.
4. 특정 개인이나 소수 집단을 식별하거나 비난하지 않는다.
5. 소수 응답 집단은 개인정보 보호를 위해 집계하지 않거나 '분석 제한'으로 표시한다.
6. 표본 수와 응답률이 낮으면 결과의 해석상 주의를 명시한다. 자유기술 건수는 문장 수이며 작성자 수로 해석하지 않는다.
7. 서술형 응답은 대표성을 과장하지 않는다. 대표 문장은 개인정보와 식별정보를 제거한 뒤 제시한다.
8. 민감한 인사·징계·괴롭힘 이슈는 사실판단이나 법률판단을 하지 않고, HR/윤리/법무 검토를 권고한다.
9. 모든 핵심 결론에는 데이터 근거를 연결한다. 해당 이슈를 직접 묻는 문항과 포괄적 만족 지표(직무·부서·회사 만족)를 구분하고, 점수와 의견이 엇갈리면 그대로 설명한다.
10. 데이터가 부족하면 먼저 필요한 데이터와 부족한 이유를 말하고, 가능한 범위만 분석한다.

답변은 한국어로, 간결한 문단과 목록으로 작성한다. 마크다운 표는 쓰지 않는다.`;

const SERVED = location.protocol.startsWith('http');   // '실행.bat'(로컬 서버)으로 열었는지
const llmCfg = () => store.get('llm', { url: SERVED ? location.origin + '/llm' : 'http://127.0.0.1:11434/v1', model: 'qwen2.5-sci', key: '', on: false });
const llmOn = () => llmCfg().on && SERVED;
const fileNote = '<div class="notice warn"><div><b>LLM 기능은 <code>실행.bat</code>으로 열어야 동작합니다.</b> index.html을 직접 열면 브라우저 보안 정책(CORS) 때문에 로컬 LLM에 연결할 수 없어 기본 문안·규칙 분석으로 표시합니다.</div></div>';

async function llmChat(messages, timeoutMs = 600000, json = false) {
  const cfg = llmCfg(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: Object.assign({ 'content-type': 'application/json' }, cfg.key ? { authorization: 'Bearer ' + cfg.key } : {}),
      body: JSON.stringify(Object.assign({ model: cfg.model, temperature: 0.2, stream: false, messages }, json ? { response_format: { type: 'json_object' } } : {})),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${res.status}`);
    return String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '응답 시간 초과' : /Failed to fetch|NetworkError/.test(e.message) ? '로컬 LLM 서버에 연결할 수 없습니다(주소·실행 여부·CORS 허용 확인)' : e.message);
  } finally { clearTimeout(timer); }
}

async function nlLLM(q, sc, local) {
  return llmChat([{ role: 'system', content: SYS_PROMPT },
    { role: 'user', content: `<데이터>\n${llmContext(sc)}\n</데이터>\n\n<규칙 조회 결과>\n${local}\n</규칙 조회 결과>\n\n질문: ${q}` }]);
}
const mdLite = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>');

function viewAsk() {
  const o = O[state.org], useLLM = llmOn();
  const sugg = ['전년 대비 가장 많이 하락한 팀은?', '소통 점수가 낮은 그룹 10개', '업무 배분 관련 의견이 많은 조직은?', '우수 조직의 공통 특징은?', '강점과 약점을 알려줘', '확인 필요 신호가 많은 조직은?', "'회의' 언급 응답은?"];
  return pageHead('AI분석', `조회 범위: <b>${esc(o.name)}</b> ${scope('sub')} · 질문에 조직명을 넣으면 해당 조직으로 조회합니다.`,
    `<label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" data-act="llm" ${useLLM ? 'checked' : ''}> 로컬 LLM으로 답변</label><button class="btn" data-go="settings" data-tabset="settings:ai">LLM 설정</button>`) + `
  ${llmCfg().on && !SERVED ? fileNote : ''}
  <div class="suggest">${sugg.map(x => `<button data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>
  <div class="chat" id="chat">${state.chat.length ? state.chat.map(m => m.role === 'user' ? `<div class="msg user">${esc(m.text)}</div>` : `<div class="msg bot">${m.html}</div>`).join('') : `<div class="msg bot"><p>데이터에 대해 궁금한 점을 물어보세요.</p><div class="basis">${useLLM ? `로컬 LLM 모드(${esc(llmCfg().model)}): 집계 데이터를 사내 LLM 서버로 보내 답변을 생성합니다. 응답 ${settings.minN}명 미만 조직과 자유기술 원문은 보내지 않습니다.` : '규칙 분석 모드: 이 PC 안에서 데이터만으로 답변합니다. LLM을 사용하지 않습니다.'}</div></div>`}</div>
  <form class="ask" id="askForm"><input id="askInput" placeholder="궁금한 내용을 입력하세요" autocomplete="off"><button class="btn primary">질문</button></form>`;
}

async function ask(q) {
  q = q.trim(); if (!q) return;
  const sc = O[state.org];
  state.chat.push({ role: 'user', text: q });
  const local = nlLocal(q, state.org);
  if (!llmOn()) { state.chat.push({ role: 'bot', html: local.html }); render(); return scrollChat(); }
  const pending = { role: 'bot', html: '<p class="muted">로컬 LLM이 데이터를 분석하고 있습니다…</p>' };
  state.chat.push(pending); render(); scrollChat();
  try {
    const plain = local.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const t = await nlLLM(q, sc, plain);
    pending.html = `<div class="llm">${mdLite(t)}</div><div class="basis">로컬 LLM(${esc(llmCfg().model)}) 답변 · 근거: 집계 데이터(점수·분류 건수) · 규칙 조회 결과는 아래 참고</div><details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:12px">규칙 조회 결과 보기</summary>${local.html}</details>`;
  } catch (e) {
    pending.html = `<p class="err-msg">로컬 LLM 호출 실패: ${esc(e.message)}</p><p class="muted">규칙 분석 결과로 대신 답변합니다.</p>${local.html}`;
  }
  render(); scrollChat();
}
const scrollChat = () => { const c = $('#askInput'); if (c) { c.focus(); c.scrollIntoView({ block: 'end' }); } };

/* =========================================================
   6. 데이터 관리 / 설정
   ========================================================= */
function dataChecks() {
  return O.map(o => {
    const own = ownTexts(o.i); if (!own.length) return null;
    const q = [0, 0, 0], seen = new Map();
    own.forEach(ti => { q[T[ti][1]]++; seen.set(T[ti][3], (seen.get(T[ti][3]) || 0) + 1); });
    const dup = [...seen.values()].reduce((s, v) => s + (v > 1 ? v - 1 : 0), 0);
    const over = q.some(v => v > o.resp);
    return { o, n: own.length, ratio: o.resp ? own.length / o.resp : Infinity, q, dup, over };
  }).filter(r => r && (r.ratio > 3 || r.over)).sort((a, b) => b.ratio - a.ratio);
}

function viewSettings() {
  const tb = curTab('settings', 'data');
  let body = '';
  if (tb === 'data') {
    const checks = dataChecks(), src = agg(0).src, nOvr = Object.keys(OVR).length;
    const pg = state.page.chk || 0, per = 15, pages = Math.max(1, Math.ceil(checks.length / per)), p = Math.min(pg, pages - 1);
    body = `<div class="grid g2">
      <div class="card"><h3>적재된 데이터 <small>생성 ${esc(D.meta.built)}</small></h3>
        ${table(['구분', '파일', '건수'], D.meta.sources.map(s => `<tr><td>${esc(s.kind)}</td><td>${esc(s.file)}</td><td class="num">${num(s.rows)}</td></tr>`))}
        <div class="list mt">
          <div class="list-item"><span>조직 수 / 점수 비공개(응답 ${settings.minN}명 미만)</span><span>${num(O.length)} / ${O.filter(o => !ok(o)).length}개</span></div>
          <div class="list-item"><span>원문 비공개(응답 ${settings.minRaw}명 미만)</span><span>${O.filter(o => ok(o) && !rawOk(o)).length}개 조직 추가</span></div>
          <div class="list-item"><span>조직 매칭 실패 응답</span><span>${D.meta.unmatched}건</span></div>
          <div class="list-item"><span>부서장 사번 / 성명</span><span>적재하지 않음 / 저조부서 심층분석에만 표시</span></div>
        </div></div>
      <div class="card"><h3>분류 출처 · 사람 검토</h3>
        <div class="list">${Object.entries(SRC).map(([k, l]) => `<div class="list-item"><span>${srcTag(k)}</span><span>${num(src[k] || 0)}건</span></div>`).join('')}</div>
        <p class="src"><b>AI 사전 분류</b>: 반복되는 핵심 문장을 AI가 판독한 사전을 적용 · <b>규칙 기반 임시 분류</b>: 사전에 없는 문장을 키워드로 분류 · <b>LLM 개별 분석</b>: 로컬 LLM이 응답마다 판정 · <b>사람 검토 완료</b>: 담당자가 수정한 결과</p>
        <div class="mt"><button class="btn" data-act="exportOvr" ${nOvr ? '' : 'disabled'}>사람 검토 결과 내보내기 (${nOvr}건)</button></div>
        <p class="src">내보낸 <code>review_overrides.json</code>을 <code>app\\build</code> 폴더에 넣고 <code>데이터 갱신.bat</code>을 실행하면 분류에 반영됩니다.</p></div>
    </div>
    <div class="card mt"><h3>데이터 점검 목록 <small>${checks.length}개 조직</small></h3>
      <p class="sub" style="margin:0 0 10px;font-size:13px">한 사람은 문항(3개)마다 최대 1건씩 작성할 수 있으므로, <b>자유기술 건수가 응답인원의 3배를 넘거나 한 문항의 건수가 응답인원보다 많으면</b> 실제로는 나올 수 없는 값입니다. 조직 코드 매핑 오류, 중복 적재, 예하조직 응답의 상위 코드 적재(조사 범위) 여부를 확인하세요.</p>
      ${table(['조직', '응답인원(명)', '자유기술(건)', '배수', '잘하는 점', '노력할 점', '부서장에게', '동일 문장 중복(건)'], checks.slice(p * per, p * per + per).map(r => `<tr class="click" data-org="${r.o.i}"><td>${orgLabel(r.o)}</td><td class="num">${num(r.o.resp)}</td><td class="num">${num(r.n)}</td><td class="num">${isFinite(r.ratio) ? r.ratio.toFixed(1) : '-'}</td>${r.q.map(v => `<td class="num ${v > r.o.resp ? 'down' : ''}">${v}</td>`).join('')}<td class="num">${r.dup}</td></tr>`))}
      ${pager('chk', checks.length, p, pages, per)}
      <div><button class="btn" data-act="exportCheck">점검 목록 CSV</button></div></div>
    <div class="card mt"><h3>데이터 갱신 방법</h3>
      <ol class="steps">
        <li><code>DB</code> 폴더에 새 엑셀 파일을 넣습니다. (파일명에 <code>결과데이터</code>, <code>자유기술</code> 포함, 기존 양식 유지)</li>
        <li><code>app</code> 폴더의 <code>데이터 갱신.bat</code>을 실행합니다. 로컬 LLM에 연결되면 응답을 개별 분석하고, 연결되지 않으면 사전·규칙으로 분류합니다.</li>
        <li>이 화면을 새로고침하면 반영됩니다.</li>
      </ol></div>`;
  } else if (tb === 'rule') {
    body = `<div class="grid g2">
      <div class="card"><h3>공개 · 집계 기준</h3><div class="form">
        <label>점수 공개 기준 (정량 응답인원)<select class="select" data-act="minN">${[5, 7, 10].map(n => `<option value="${n}" ${settings.minN === n ? 'selected' : ''}>${n}명 미만 비공개</option>`).join('')}</select></label>
        <label>자유기술 원문 공개 기준 (정량 응답인원)<select class="select" data-act="minRaw">${[5, 10, 15, 20].map(n => `<option value="${n}" ${store.get('minRaw', 10) === n ? 'selected' : ''}>${n}명 미만 조직 원문 비공개</option>`).join('')}</select></label>
        <p class="muted" style="margin:0;font-size:13px">자유기술은 작성자 수를 알 수 없어, 정량 응답인원이 기준 이상이어도 특정 문장을 한 사람이 작성했을 수 있습니다. 그래서 원문은 점수보다 높은 기준을 적용하고, 비공개 조직의 응답도 상위 조직 집계에는 포함합니다.</p>
        <p class="muted" style="margin:0;font-size:13px"><b>응답 기준 충족</b>: 응답 10명 이상이고 응답률 50% 이상 (통계적 신뢰도 검증 결과는 아님)<br><b>표본·응답률 주의</b>: 응답 10명 미만 또는 응답률 50% 미만<br><b>검토 필요 사항</b>: 종합점수 전년 대비 -1.5점 이하(-3점 이하 우선), 전사 대비 -3점 이하, 영역 -3점 이하 하락, 항목 -5점 이하, 응답률 70% 미만, 자유기술 부정 비중 전사 대비 +10%p 이상</p></div></div>
      <div class="card"><h3>감정 · 유형 기준</h3><div class="sub" style="font-size:13px">
        <p style="margin:0 0 6px"><b>의견 없음</b>(유형): "없음", "잘 모르겠습니다" 등 분석할 내용이 없는 응답 → 감정 비율의 분모에서 제외</p>
        <p style="margin:0 0 6px"><b>긍정 / 부정 / 중립</b>: 칭찬·만족 / 문제 제기 / 사실 서술·개선 요청</p>
        <p style="margin:0 0 6px"><b>혼합</b>: 긍정과 부정이 한 문장에 함께 있음 · <b>판단보류</b>: 의미를 판단하기 어려움 (LLM 개별 분석·사람 검토에서 부여)</p>
        <p style="margin:0">개선 의견 = 부정 + 혼합 + 개선 요청</p></div></div>
    </div>
    <div class="card mt"><h3>자유기술 주제</h3>${table(['주제(화면 표시)', '원 분류 체계', '정의', '직접 근거 문항'], [...CATS, 'C0'].map(c => `<tr><td style="white-space:nowrap">${catName(c)}</td><td class="muted" style="white-space:nowrap">${esc(D.categories[c][2] || '')}</td><td class="sub">${esc(D.categories[c][1])}</td><td class="sub" style="font-size:12px">${(DQ[c] || []).map(k => esc(qShort(k))).join('<br>') || '<span class="muted">없음</span>'}</td></tr>`))}
    <p class="src">주제명은 긍정·부정과 무관한 중립 표현입니다. 포괄 지표(${REF_Q.map(k => esc(qShort(k))).join(', ')})는 과제의 참고 근거로만 사용합니다.</p></div>`;
  } else if (tb === 'sec') {
    body = ENC ? `<div class="grid g2"><div class="card"><h3>비밀번호</h3><p class="sub" style="margin:0;font-size:13px">이 공개본의 데이터는 발행할 때 정한 비밀번호로 <b>암호화</b>되어 있어, 화면에서 비밀번호를 바꿀 수 없습니다. 비밀번호를 바꾸려면 새 비밀번호로 다시 발행해야 합니다.</p></div>
    <div class="card"><h3>공개본 보안</h3><div class="sub" style="font-size:13px"><p style="margin:0 0 6px">데이터 파일은 비밀번호에서 만든 키(PBKDF2-SHA256)로 AES-256-GCM 암호화되어, 저장소 파일을 내려받아도 비밀번호 없이는 읽을 수 없습니다.</p><p style="margin:0" class="muted">비밀번호를 아는 사람은 누구나 볼 수 있으므로 비밀번호 공유 범위를 관리하세요. 조직별 권한 구분은 서버 로그인이 필요합니다.</p></div></div></div>` : `<div class="grid g2"><div class="card"><h3>비밀번호 변경</h3><form class="form" id="pwForm">
      <label>현재 비밀번호<input class="input" type="password" name="cur" required></label>
      <label>새 비밀번호 (4자리 이상)<input class="input" type="password" name="n1" minlength="4" required></label>
      <label>새 비밀번호 확인<input class="input" type="password" name="n2" minlength="4" required></label>
      <div><button class="btn primary">변경</button> <span id="pwMsg"></span></div>
    </form></div>
    <div class="card"><h3>현재 보안 수준과 운영 전 보완 사항</h3><div class="sub" style="font-size:13px">
      <p style="margin:0 0 8px"><b>현재</b>: 화면 진입 비밀번호(해시)는 이 PC 브라우저에 저장됩니다. 데이터 파일(data.js)은 PC에 그대로 있으므로, 파일을 직접 열면 비밀번호 없이 내용을 볼 수 있습니다. 즉 <b>화면 잠금</b>이며 데이터 접근 차단은 아닙니다.</p>
      <p style="margin:0 0 4px"><b>공용 운영 전 필요</b></p>
      <ol class="steps"><li>서버에서 로그인(사내 SSO)과 세션 확인</li><li>사용자별 조회 가능 조직 권한(예: 부서장은 소속 조직만)</li><li>데이터는 권한 확인 후 서버에서만 제공</li><li>검토 기록·과제 관리의 공통 저장소와 변경 이력(감사 로그)</li></ol>
      <p class="src">그 전까지는 데이터 폴더를 접근 권한이 통제된 위치에 두고, 분석 담당자만 사용하세요.</p></div></div></div>`;
  } else {
    const cfg = llmCfg();
    body = `<div class="grid g2"><div class="card"><h3>로컬 LLM 연동 <small>AI 분석(질의응답)용</small></h3><form class="form" id="llmForm">
      <p class="sub" style="margin:0;font-size:13px"><code>실행.bat</code>으로 열면 기본 주소 <code>${esc(location.origin)}/llm</code>이 <code>build/llm_config.json</code>에 지정한 LLM 서버로 요청을 중계합니다. 사내 LLM으로 바꿀 때는 llm_config.json만 수정하면 됩니다.</p>
      ${SERVED ? '' : '<p class="err-msg" style="margin:0">현재 index.html을 직접 열어 LLM에 연결할 수 없습니다. 실행.bat으로 여세요.</p>'}
      <label>API 주소<input class="input" name="url" value="${esc(cfg.url)}" placeholder="http://서버주소:11434/v1"></label>
      <label>모델명<input class="input" name="model" value="${esc(cfg.model)}" placeholder="qwen2.5-sci"></label>
      <label>API 키 (필요한 경우만)<input class="input" type="password" name="key" value="${esc(cfg.key)}"></label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="on" ${cfg.on ? 'checked' : ''}> AI 분석에서 로컬 LLM 사용</label>
      <div><button class="btn primary">저장</button> <button type="button" class="btn" data-act="llmtest">연결 테스트</button> <span id="llmMsg"></span></div>
      <p class="muted" style="margin:0;font-size:12.5px">설정은 이 PC 브라우저에만 저장됩니다. 현재 설치된 모델: Ollama <code>qwen2.5-sci</code> (Qwen2.5 7B, 컨텍스트 8K). 노트북 CPU에서는 답변에 수 분이 걸릴 수 있습니다.</p>
    </form></div>
    <div class="card"><h3>자유기술 개별 분석 (데이터 갱신)</h3><div class="sub" style="font-size:13px">
      <p style="margin:0 0 8px"><code>데이터 갱신.bat</code>을 실행하면 <code>build/llm_config.json</code>에 지정한 로컬 LLM이 응답마다 주제·감정·유형·요약·감정 강도·확인 필요 신호를 판정합니다.</p>
      <ol class="steps"><li>llm_config.json의 <code>base_url</code>, <code>model</code>을 사내 LLM에 맞게 수정</li><li>시험 실행: <code>LLM 시험 분류.bat</code> (200건)</li><li>결과 확인 후 <code>데이터 갱신.bat</code>으로 전체 실행 (중단해도 이어서 진행)</li></ol></div></div></div>`;
  }
  return pageHead('데이터 관리/설정', '데이터 현황과 점검, 분석 기준, 보안, LLM 연동을 관리합니다.') +
    tabs('settings', [['data', '데이터 현황'], ['rule', '분석 기준'], ['sec', '보안'], ['ai', 'LLM 연동']]) + body;
}

/* =========================================================
   7. 트리 · 라우팅 · 이벤트
   ========================================================= */
function renderTree() {
  const q = $('#orgSearch').value.trim();
  const box = $('#orgTree');
  if (q) {
    const hits = O.filter(o => o.name.includes(q)).slice(0, 60);
    box.innerHTML = hits.map(o => `<div class="tree-row ${o.i === state.org ? 'on' : ''}" data-org="${o.i}"><span class="tree-tg"></span><span class="tree-name">${esc(o.name)}</span>${ok(o) ? '' : '<span class="tree-lim">제한</span>'}</div>`).join('') || '<p class="muted" style="padding:6px">검색 결과가 없습니다.</p>';
    return;
  }
  const rows = [];
  const walk = (i, d) => {
    const o = O[i], open = state.expanded.has(i);
    rows.push(`<div class="tree-row ${i === state.org ? 'on' : ''}" data-org="${i}" style="padding-left:${4 + d * 12}px">${o.kids.length ? `<span class="tree-tg ${open ? 'open' : ''}" data-toggle="${i}" title="${open ? '접기' : '펼치기'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '<span class="tree-tg empty"></span>'}<span class="tree-name">${esc(o.name)}</span>${ok(o) ? '' : '<span class="tree-lim">제한</span>'}</div>`);
    if (open) o.kids.forEach(k => walk(k, d + 1));
  };
  walk(0, 0);
  box.innerHTML = rows.join('');
}

function render() {
  const o = O[state.org];
  $('#nav').innerHTML = VIEWS.map(([k, l, ic]) => `${k === 'settings' ? '<div class="sep"></div>' : ''}<button data-go="${k}" class="${state.view === k ? 'on' : ''}"><span class="ico">${ic}</span>${l}</button>`).join('');
  const path = []; for (let x = o; x; x = x.parent >= 0 ? O[x.parent] : null) path.unshift(x);
  const shown = path.length > 3 ? [path[0], null, ...path.slice(-2)] : path;
  $('#crumb').innerHTML = state.view === 'home' ? `<b>${esc(O[0].name)}</b><span>·</span><span>전사 기준</span>` : shown.map((x, n) => x === null ? '<span>…</span><span>›</span>' : n === shown.length - 1 ? `<b>${esc(x.name)}</b>` : `<span>${esc(x.name)}</span><span>›</span>`).join('');
  $('#topMeta').textContent = `${VIEWS.find(v => v[0] === state.view)[1]} · 데이터 기준 ${D.meta.built}`;
  const fn = { home: viewHome, report: viewReport, low: viewLow, signal: viewSignal, ask: viewAsk, settings: viewSettings }[state.view] || viewHome;
  $('#view').innerHTML = fn();
  renderTree();
  try { history.replaceState(null, '', `#${state.view}/${state.org}`); } catch (e) {}
  if (state.view === 'report') $('#topMeta').textContent = `부서별 결과 리포트 · ${(REPORT_TABS.find(t => t[0] === curTab('report', 'sum')) || REPORT_TABS[0])[1]} · 데이터 기준 ${D.meta.built}`;
}

function selectOrg(i) {
  state.org = +i; state.page = {}; state.edit = state.review = null;
  for (let x = O[i]; x && x.parent >= 0; x = O[x.parent]) state.expanded.add(x.parent);
  store.set('expanded', [...state.expanded]);
  render();
  const on = $('#orgTree .on'); if (on) on.scrollIntoView({ block: 'nearest' });
}

function csvExport() {
  const o = O[state.org];
  const lines = [['조직명', '단위', '대상인원', '응답인원', '응답률', '2026', '2025', '2024', ...D.areas, ...ITEMS, '자유기술(문장수)', '의견없음', '내용있는응답', '부정', '신호우선', '신호일반']];
  [o, ...o.kids.map(i => O[i])].forEach(x => {
    if (!ok(x)) { lines.push([x.name, LV[x.level], x.target, x.resp, '분석 제한']); return; }
    const a = agg(x.i);
    lines.push([x.name, LV[x.level], x.target, x.resp, (x.rate * 100).toFixed(1), ...x.t.map(f1), ...x.area.map(f1), ...x.items.map(f1), a.n, a.none, a.content, a.N, a.hi, a.mid]);
  });
  download(`${o.name}_예하조직_결과.csv`, csv(lines), 'text/csv');
}

// ---- 엑셀(.xlsx) 생성: 외부 라이브러리 없이 무압축 ZIP으로 작성 (사내 오프라인 환경 대응) ----
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  files.forEach(f => {
    const nm = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data), sz = data.length;
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, sz, 4], [22, sz, 4], [26, nm.length, 2], [28, 0, 2]]
      .forEach(([p, v, n]) => n === 4 ? h.setUint32(p, v, true) : h.setUint16(p, v, true));
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, sz, 4], [24, sz, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
      .forEach(([p, v, n]) => n === 4 ? c.setUint32(p, v, true) : c.setUint16(p, v, true));
    cen.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + sz;
  });
  const cs = cen.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
// sheets: [{ name, rows: [[...]], widths: [..], wrap: [열 번호] }] · 첫 행은 머리글(굵게·틀 고정)
function xlsx(sheets) {
  const x = v => String(v ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = n => { let r = ''; n++; while (n) { const m = (n - 1) % 26; r = String.fromCharCode(65 + m) + r; n = Math.floor((n - 1) / 26); } return r; };
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheetXml = sh => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${(sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`
    + sh.rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => { const ref = col(j) + (i + 1), st = i === 0 ? 1 : (sh.wrap || []).includes(j) ? 2 : 0;
      return typeof v === 'number' && isFinite(v) ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`; }).join('')}</row>`).join('')
    + `</sheetData></worksheet>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>${sheets.map((sh, i) => `<sheet name="${x(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${RNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${RNS}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EBF6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) })),
  ];
  return zipStore(files);
}
function downloadBlob(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }

function exportSignalXlsx() {
  if (!ok(O[state.org])) return;
  const o = O[state.org], f = state.f.sig || { l: '', c: '', st: '' }, rev = store.get('review', {});
  const all = textsIn(o.i).filter(ti => T[ti][4] > 0), vis = all.filter(ti => rawOk(O[T[ti][0]]));
  const stOf = ti => rev[rkey(ti)]?.status || '미확인';
  const rows = vis.filter(ti => { const t = T[ti], c = clsFast(ti); return (!f.l || t[4] === +f.l) && (!f.c || c[0] === f.c) && (!f.st || stOf(ti) === f.st); })
    .sort((x, y) => T[y][4] - T[x][4] || T[y][6] - T[x][6] || T[x][0] - T[y][0]);
  const s1 = [['우선순위', '감정 강도', '조직', '조직 단위', '부서장', '상위 조직', '문항', '원문(호칭·조직 표현 비식별)', '요약', '주제', '감정', '판정 이유', '검토 상태', '담당자', '검토 일시']];
  rows.forEach(ti => { const t = T[ti], c = clsFast(ti), r = rev[rkey(ti)], x = O[t[0]];
    s1.push([SIG[t[4]], ['', '약', '중', '강'][t[6]] || '', x.name, LV[x.level], x.leader, x.parent >= 0 ? O[x.parent].name : '', D.qtypes[t[1]], deid(t[3]), c[3], catName(c[0]), c[1], t[7] || '', stOf(ti), r?.owner || '', r?.at || '']); });
  const s2 = [['조직', '조직 단위', '부서장', '상위 조직', '우선 검토(건)', '일반 검토(건)', '전체(건)', '자유기술(건)', '자유기술 100건당', '응답인원(명)']];
  signalOrgRows(o,f,rev).forEach(r=>s2.push([r.x.name,LV[r.x.level],r.x.leader,r.x.parent>=0?O[r.x.parent].name:'',r.h,r.m,r.h+r.m,r.n,r.n>=20?+r.rate.toFixed(1):'표본 적음',r.x.resp]));
  downloadBlob(`조직문화저해사례_${o.name}_${now().slice(0, 10)}.xlsx`, xlsx([
    { name: '검토 목록', rows: s1, widths: [10, 8, 22, 8, 14, 22, 18, 70, 28, 16, 8, 40, 10, 12, 16], wrap: [7, 11] },
    { name: '조직별 신호 규모', rows: s2, widths: [26, 8, 14, 24, 12, 12, 10, 12, 14, 12] },
    { name: '집계 기준', rows: [['항목','내용'],['조직 범위',o.name+' 및 예하조직'],['우선순위',SIG[f.l]||'전체'],['주제',f.c?catName(f.c):'전체'],['검토 상태',f.st||'전체'],['검토목록 건수',s1.length-1],['조직 수',s2.length-1],['최소 집계 응답인원',settings.minN],['원문 공개 최소 응답인원',settings.minRaw],['분모','해당 조직 직접 자유기술 문장 수. 20건 미만은 비율 비공개.'],['주의','확인 필요 신호이며 사실·법률 판단이 아님. HR/윤리/법무 검토 필요.'],['범위','페이지 제한 없이 필터에 해당하는 전체 목록. 원문 공개 기준과 집계 기준은 다름.'],['생성 일시',now()]], widths:[28,90],wrap:[1] },
  ]));
}

function exportAction(a) {
  if (a === 'exportSignalXlsx') { exportSignalXlsx(); return; }
  if (a === 'exportOvr') {
    const items = Object.entries(OVR).map(([key, v]) => Object.assign({ key }, v));
    download('review_overrides.json', JSON.stringify({ version: 1, exported: now(), items }, null, 2), 'application/json');
  }
  if (a === 'exportReview') {
    const rev = store.get('review', {}), rows = [['조직코드', '원문', '상태', '담당자', '판정 이유', '최종 수정', '변경 이력']];
    Object.entries(rev).forEach(([k, r]) => { const cut = k.indexOf('|'); rows.push([k.slice(0, cut), k.slice(cut + 1), r.status, r.owner, r.reason, r.at, (r.history || []).map(h => `${h.at} ${h.status} ${h.owner || '-'} ${h.reason}`).join(' / ')]); });
    download(`확인필요신호_검토기록_${now().slice(0, 10)}.csv`, csv(rows), 'text/csv');
  }
  if (a === 'exportTasks') {
    const tasks = store.get('tasks', {}), rows = [['조직', '주제', '과제', '담당자', '진행 상태', '목표 시점', '완료 기준', '후속 확인 지표', '최종 수정']];
    const byCode = new Map(O.map(o => [o.code, o]));
    Object.entries(tasks).forEach(([k, t]) => { const [code, c] = k.split('|'); rows.push([byCode.get(code)?.name || code, catName(c), ACT[c]?.t, t.owner, t.status, t.due, t.done, t.metric, t.at]); });
    download(`개선과제_관리_${now().slice(0, 10)}.csv`, csv(rows), 'text/csv');
  }
  if (a === 'exportLow') {
    const { groups, f } = lowFilter(), rows = [['조직 단위', '부서명', '상위 조직', '부서장', '대상인원', '응답인원', '응답률', '2024', '2025', '2026', '전년 대비', '전사 대비', '주요 이슈 요약']];
    const strip = t => String(t).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    groups.forEach(([, list]) => list.forEach(x => { const is = lowIssues(x);
      rows.push([LV[x.level], x.name, x.parent >= 0 ? O[x.parent].name : '', f.hide === 'on' ? '' : x.leader, x.target, x.resp, (x.rate * 100).toFixed(1), f1(x.t[2]), f1(x.t[1]), f1(x.t[0]), sg(x.t[0] - x.t[1]), sg(x.t[0] - O[0].t[0]), strip([is.sentence, ...is.items.map(([k, v]) => `[${k}] ${v}`)].join(' / '))]); }));
    download(`저조부서_심층분석_${now().slice(0, 10)}.csv`, csv(rows), 'text/csv');
  }
  if (a === 'exportCheck') {
    const rows = [['조직', '조직코드', '응답인원', '자유기술 건수', '배수', '잘하고 있는 점', '노력해야 할 점', '부서장에게 하고 싶은 말', '동일 문장 중복']];
    dataChecks().forEach(r => rows.push([r.o.name, r.o.code, r.o.resp, r.n, isFinite(r.ratio) ? r.ratio.toFixed(2) : '', ...r.q, r.dup]));
    download(`데이터점검목록_${now().slice(0, 10)}.csv`, csv(rows), 'text/csv');
  }
}

function bind() {
  document.addEventListener('click', e => {
    // 왼쪽 조직 트리: 현재 화면을 유지한 채 조직만 변경
    if (e.target.closest('#orgTree [data-org]') && !e.target.closest('[data-toggle]')) { if (state.view === 'home') setView('report'); selectOrg(e.target.closest('[data-org]').dataset.org); return; }
    const tg = e.target.closest('[data-toggle]');
    if (tg) { const i = +tg.dataset.toggle; state.expanded.has(i) ? state.expanded.delete(i) : state.expanded.add(i); store.set('expanded', [...state.expanded]); renderTree(); return; }
    if (e.target.closest('form, summary, details .inline-form')) { if (!e.target.closest('[data-act]')) return; }
    const ts = e.target.closest('[data-tabset]'); if (ts) { const [k, v] = ts.dataset.tabset.split(':'); state.tab[k] = v; }
    const ed = e.target.closest('[data-edit]'); if (ed) { state.edit = state.edit === +ed.dataset.edit ? null : +ed.dataset.edit; render(); return; }
    const rv = e.target.closest('[data-review]'); if (rv) { state.review = state.review === +rv.dataset.review ? null : +rv.dataset.review; render(); return; }
    const org = e.target.closest('[data-org]');
    const go = e.target.closest('[data-go]');
    if (org && go) { setView(go.dataset.go); selectOrg(org.dataset.org); window.scrollTo(0, 0); return; }
    if (org) { if (state.view === 'home') state.view = 'report'; if (state.view === 'settings') state.view = 'report'; selectOrg(org.dataset.org); return; }
    if (go) { setView(go.dataset.go); state.edit = state.review = null; render(); window.scrollTo(0, 0); return; }
    const tab = e.target.closest('[data-tab]'); if (tab) { const [k, v] = tab.dataset.tab.split(':'); state.tab[k] = v; render(); return; }
    const pg = e.target.closest('[data-page]'); if (pg && !pg.disabled) { const [k, v] = pg.dataset.page.split(':'); state.page[k] = Math.max(0, +v); state.edit = state.review = null; render(); return; }
    const qb = e.target.closest('[data-q]'); if (qb) { ask(qb.dataset.q); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'print') { if (state.view === 'report') openPrintDialog(); else window.print(); }
      if (a === 'closeModal') closeModal();
      if (a === 'prAll' || a === 'prNone') document.querySelectorAll('#printForm input[name=sec]').forEach(x => { x.checked = a === 'prAll'; });
      if (a === 'csv') csvExport();
      if (a === 'cancelEdit') { state.edit = null; render(); }
      if (a === 'regenProps') { const pk = llmPropKey(O[state.org], curTab('report', 'sum')), cache = store.get('llmProps', {}); delete cache[pk]; store.set('llmProps', cache); state.llmErr = null; render(); }
      if (a === 'cancelReview') { state.review = null; render(); }
      if (a === 'clearOvr') { delete OVR[act.dataset.key]; store.set('overrides', OVR); resetAgg(); state.edit = null; render(); }
      if (a.startsWith('export')) exportAction(a);
      if (a === 'llmtest') {
        const msg = $('#llmMsg'); msg.className = 'muted'; msg.textContent = '테스트 중…';
        llmChat([{ role: 'user', content: '연결 테스트입니다. OK라고만 답하세요.' }], 60000)
          .then(t => { msg.className = 'ok-msg'; msg.textContent = '연결 성공: ' + t.slice(0, 30); })
          .catch(er => { msg.className = 'err-msg'; msg.textContent = er.message; });
      }
    }
  });
  document.addEventListener('change', e => {
    const f = e.target.dataset.f;
    if (f) { const [k, key] = f.split(':'); state.f[k][key] = e.target.value; state.page[k] = 0; state.edit = state.review = null; render(); return; }
    const act = e.target.dataset.act;
    if (act === 'minN') { store.set('minN', +e.target.value); resetAgg(); render(); }
    if (act === 'lowHide') { state.f.low.hide = e.target.checked ? 'on' : ''; render(); return; }
    if (act === 'minRaw') { store.set('minRaw', +e.target.value); segCache.clear(); render(); }
    if (act === 'llm') { store.set('llm', Object.assign(llmCfg(), { on: e.target.checked })); render(); }
  });
  let timer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('input', e => {
    const f = e.target.tagName === 'INPUT' ? e.target.dataset.f : null;   // 선택 상자는 change 이벤트에서 처리
    if (f) { const [k, key] = f.split(':'); state.f[k][key] = e.target.value; state.page[k] = 0; clearTimeout(timer);
      timer = setTimeout(() => { const pos = e.target.selectionStart; render(); const el = document.querySelector(`[data-f="${f}"]`); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 250); }
    if (e.target.id === 'orgSearch') renderTree();
  });
  document.addEventListener('submit', async e => {
    e.preventDefault();
    const fm = e.target, d = new FormData(fm);
    if (fm.id === 'printForm') {
      const secs = d.getAll('sec'), cover = d.get('cover') === 'on';
      if (!secs.length) { $('#prMsg').textContent = '인쇄할 항목을 하나 이상 선택하세요.'; return; }
      store.set('printSecs', secs); store.set('printCover', cover);
      closeModal(); runPrint(secs, cover); return;
    }
    if (fm.id === 'askForm') { const v = $('#askInput').value; $('#askInput').value = ''; ask(v); }
    if (fm.id === 'ovrForm') {
      const ti = +fm.dataset.ti;
      OVR[tkey(ti)] = { category: d.get('category'), sentiment: d.get('sentiment'), type: d.get('type'), summary: String(d.get('summary')).trim(), reason: String(d.get('reason')).trim(), at: now() };
      store.set('overrides', OVR); resetAgg(); state.edit = null; render();
    }
    if (fm.id === 'reviewForm') {
      const ti = +fm.dataset.ti, rev = store.get('review', {}), k = rkey(ti), prev = rev[k] || { history: [] };
      const entry = { status: d.get('status'), owner: String(d.get('owner')).trim(), reason: String(d.get('reason')).trim(), at: now() };
      rev[k] = Object.assign({}, entry, { history: [...(prev.history || []), entry] });
      store.set('review', rev); state.review = null; render();
    }
    if (fm.classList.contains('track-form')) {
      const tasks = store.get('tasks', {});
      tasks[fm.dataset.task] = { owner: String(d.get('owner')).trim(), status: d.get('status'), due: d.get('due'), done: String(d.get('done')).trim(), metric: String(d.get('metric')).trim(), at: now() };
      store.set('tasks', tasks); render();
    }
    if (fm.id === 'pwForm') {
      const msg = $('#pwMsg');
      if (await hashPw(d.get('cur')) !== await storedHash()) { msg.className = 'err-msg'; msg.textContent = '현재 비밀번호가 일치하지 않습니다.'; return; }
      if (d.get('n1') !== d.get('n2')) { msg.className = 'err-msg'; msg.textContent = '새 비밀번호가 서로 다릅니다.'; return; }
      store.set('pwHash', await hashPw(d.get('n1'))); fm.reset(); msg.className = 'ok-msg'; msg.textContent = '변경되었습니다.';
    }
    if (fm.id === 'llmForm') {
      store.set('llm', { url: String(d.get('url')).trim(), model: String(d.get('model')).trim(), key: String(d.get('key')).trim(), on: d.get('on') === 'on' });
      render(); const m = $('#llmMsg'); if (m) { m.className = 'ok-msg'; m.textContent = '저장되었습니다.'; }
    }
  });
  $('#lockBtn').addEventListener('click', () => { try { sessionStorage.removeItem('sci_auth'); sessionStorage.removeItem('sci_key'); } catch (e) {} location.reload(); });
}

function start() {
  const m = location.hash.match(/^#(\w+)\/(\d+)$/);
  if (m && (VIEWS.some(v => v[0] === m[1]) || VIEW_ALIAS[m[1]]) && O[+m[2]]) { setView(m[1]); state.org = +m[2]; }
  $('#lock').hidden = true; $('#app').hidden = false;
  bind(); selectOrg(state.org);
}

return start;
}

// 암호화 데이터 복호화 (PBKDF2-SHA256 → AES-256-GCM → gzip 해제)
const b64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function deriveKey(pw) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(ENC.salt), iterations: ENC.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}
async function decryptData(key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(ENC.iv) }, key, b64(ENC.ct));
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}
const session = {
  get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} },
  del: k => { try { sessionStorage.removeItem(k); } catch (e) {} },
};
const launch = data => boot(data)();

// 로그인 (5회 실패 시 30초 잠금)
(function gate() {
  const showForm = () => {
    $('#pw').focus();
    let fails = 0, until = 0, busy = false;
    $('#lockForm').addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('#lockMsg'), pw = $('#pw').value;
      if (busy) return;
      if (Date.now() < until) { msg.textContent = `잠시 후 다시 시도하세요. (${Math.ceil((until - Date.now()) / 1000)}초)`; return; }
      let data = null;
      if (ENC) {
        busy = true; msg.textContent = '확인 중…';
        try {
          const key = await deriveKey(pw);
          data = await decryptData(key);
          const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
          session.set('sci_key', btoa(String.fromCharCode(...raw)));
        } catch (er) { data = null; }
        busy = false; msg.textContent = '';
      } else if (await hashPw(pw) === await storedHash()) {
        data = window.SCI_DATA; session.set('sci_auth', '1');
      }
      if (data) return launch(data);
      fails++; $('#pw').value = '';
      if (fails >= 5) { until = Date.now() + 30000; fails = 0; msg.textContent = '5회 실패하여 30초간 입력이 제한됩니다.'; }
      else msg.textContent = `비밀번호가 올바르지 않습니다. (${fails}/5)`;
    });
  };
  if (ENC) {
    const saved = session.get('sci_key');
    if (!saved) return showForm();
    crypto.subtle.importKey('raw', b64(saved), 'AES-GCM', true, ['decrypt']).then(decryptData).then(launch)
      .catch(() => { session.del('sci_key'); showForm(); });
    return;
  }
  if (session.get('sci_auth') === '1') return launch(window.SCI_DATA);
  showForm();
})();
})();
