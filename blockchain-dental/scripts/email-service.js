/**
 * email-service.js
 * 고객이 청약 시 등록한 이메일로 증권 발급/청구 처리 결과를 실제로 이메일 발송하는 서비스.
 *
 * frontend/app.js는 PolicyCreated/ClaimApproved/ClaimRejected/ClaimPaid 이벤트가
 * 감지될 때마다(해당 지갑에 등록된 이메일이 있는 경우만) 이 서비스의 웹훅으로 POST
 * 요청을 보낸다 (notifyN8nCertReady/notifyN8nClaimUpdate, EMAIL_NOTIFY_WEBHOOK_URL).
 * 이 서비스는 그 요청을 받아 실제로 SMTP 메일을 발송한다 — 기본 대상은 로컬
 * Docker로 띄운 Mailpit(../docker-compose.yml)이라 실 이메일 계정 없이도
 * http://localhost:8025 에서 발송된 메일을 바로 확인할 수 있다.
 *
 * 증권 발급(policy_issued) 메일에는 scripts/certificate-service.js가 만드는 PDF
 * 증권 서류를 파일로 첨부한다 — 다만 그 서비스가 PDF를 쓰는 데 몇 초 걸릴 수
 * 있어(AI 요약 생성 포함), 요청을 받으면 즉시 202로 응답한 뒤 백그라운드에서
 * 파일이 생길 때까지 잠깐 기다렸다가(최대 EMAIL_CERT_WAIT_SEC초) 보낸다. 시간
 * 안에 파일이 안 생기면 첨부 없이 다운로드 링크만 넣어 발송한다(발송 자체는
 * 항상 성공시키는 게 목표).
 *
 * 실행: node scripts/email-service.js
 *
 * 환경변수 (.env):
 *  EMAIL_SERVICE_PORT : 이 서비스가 웹훅을 받는 포트 (기본 5679)
 *  RPC_URL             : JSON-RPC 엔드포인트 (기본 http://127.0.0.1:8545) — 증권
 *                        상세 정보(보험료/보장한도/만기일)를 메일 본문에 넣기 위해 읽기 전용 조회
 *  SMTP_*              : scripts/lib/mailer.js 참고 (기본값 = 로컬 Mailpit)
 */

require("dotenv").config();
const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const { ethers } = require("ethers");

const { sendMail } = require("./lib/mailer");

process.on("unhandledRejection", (reason) => {
  console.error("⚠️  처리되지 않은 오류(무시하고 계속 실행):", reason?.message || reason);
});

// ── 설정 ──────────────────────────────────────────────────────────
const PORT           = Number(process.env.EMAIL_SERVICE_PORT || 5679);
const RPC_URL         = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONFIG_PATH    = path.join(__dirname, "..", "frontend", "config.json");
const CERT_DIR         = path.join(__dirname, "..", "frontend", "certificates");
const CERT_WAIT_SEC = Number(process.env.EMAIL_CERT_WAIT_SEC || 20);

const POLICY_ABI = [
  "function getPolicy(uint256) view returns (tuple(uint256 id, address patient, string patientName, uint256 monthlyPremium, uint256 coverageLimit, uint256 totalPaid, uint256 totalClaimed, uint256 lastPaymentTime, uint256 nextDueTime, bool active, uint256 createdAt, uint256 maturityDate, uint256 maturityRefundRate, bool maturityPaid))",
];

function log(msg)  { console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toLocaleTimeString("ko-KR")}] ⚠️  ${msg}`); }

function fmtAmount(raw, decimals) {
  if (decimals === 0) return "₩" + Number(raw).toLocaleString("ko-KR");
  return "$" + (Number(raw) / 1e6).toFixed(2);
}
function fmtDate(unixSeconds) {
  if (!unixSeconds) return "-";
  return new Date(Number(unixSeconds) * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " (KST)";
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 관리자용 Chrome / 고객용 Edge 등 프론트엔드를 여러 탭에서 동시에 열어두면, 각 탭이
// 독립적으로 온체인 이벤트를 감지해 이 웹훅을 각각 호출한다 — 같은 이벤트 1건에
// 이메일이 탭 개수만큼 중복 발송되는 문제(2026-09-19 발견)를 막기 위해, 이벤트를
// 식별하는 키(type+currency+정책/청구ID) 단위로 서버에서 한 번만 발송하도록 함.
// 프론트엔드 쪽 이벤트 리스너 중복 문제와는 별개 — 이건 서로 다른 탭(별도 프로세스)이
// 각자 정상적으로 감지해서 보내는 것이라 클라이언트 쪽에서는 막을 수 없다.
const sentNotifications = new Set();
// payload.type별로 식별자 필드가 다르다(policy_issued→policyId, claim_*→claimId,
// altinvest_*→investor+fundId) — 셋 다 포함해두면 어떤 타입이든 값이 있는
// 필드만 키에 남고, 없는 필드는 빈 문자열이 되어 서로 충돌하지 않는다.
function notifyKey(payload) {
  const id = payload.policyId ?? payload.claimId ?? "";
  const investorPart = payload.investor ? `${payload.investor}:${payload.fundId ?? ""}` : "";
  return `${payload.type}:${payload.currency}:${id}:${investorPart}`;
}

// PDF가 아직 없으면(certificate-service.js가 만드는 중일 수 있음) 최대
// CERT_WAIT_SEC초 동안 1초 간격으로 재확인한다.
async function waitForCertFile(certFileName) {
  const filePath = path.join(CERT_DIR, certFileName);
  const deadline = Date.now() + CERT_WAIT_SEC * 1000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return filePath;
    await sleep(1000);
  }
  return fs.existsSync(filePath) ? filePath : null;
}

// 메일 본문에 보험료/보장한도/만기일을 넣기 위한 참고용 조회 — 읽기 전용,
// 실패해도(컨트랙트 미배포 등) 메일 발송 자체는 계속 진행한다.
async function fetchPolicyDetails(currency, policyId) {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const addr = currency === "KRW" ? config.contracts?.DentalInsuranceKRW : config.contracts?.DentalInsurance;
    if (!addr) return null;
    const decimals = currency === "KRW" ? 0 : 6;
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(addr, POLICY_ABI, provider);
    const p = await contract.getPolicy(policyId);
    return {
      monthlyPremium: fmtAmount(p.monthlyPremium, decimals),
      coverageLimit:  fmtAmount(p.coverageLimit, decimals),
      maturityDate:   fmtDate(p.maturityDate),
    };
  } catch (e) {
    warn(`증권 상세 조회 실패(메일 본문에는 생략하고 계속 진행): ${e.message}`);
    return null;
  }
}

// ── 이메일 본문 ───────────────────────────────────────────────────
function wrapHtml(title, bodyHtml) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head>
<body style="font-family:'Malgun Gothic',sans-serif;background:#f3f4f6;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:#1d4ed8;color:#fff;padding:20px 24px">
      <div style="font-size:13px;opacity:.85">라이나생명 블록체인치아보험</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px">${title}</div>
    </div>
    <div style="padding:24px;color:#111827;font-size:14px;line-height:1.6">${bodyHtml}</div>
    <div style="padding:16px 24px;color:#9ca3af;font-size:11px;border-top:1px solid #f3f4f6">
      이 메일은 블록체인에서 발송되었습니다. 궁금하신 사항은 언제든지 연락 부탁드립니다.
    </div>
  </div>
</body></html>`;
}

async function handlePolicyIssued(payload) {
  const { email, policyId, patientName, currency, certFileName, certUrl } = payload;
  const details = await fetchPolicyDetails(currency, policyId);

  const filePath = await waitForCertFile(certFileName);
  const attachments = filePath ? [{ filename: certFileName, path: filePath }] : [];
  if (!filePath) warn(`증권 PDF(${certFileName})가 ${CERT_WAIT_SEC}초 안에 생성되지 않아 첨부 없이 링크만 발송합니다.`);

  const detailRows = details ? `
    <tr><td style="color:#6b7280;padding:4px 0">월 보험료</td><td style="padding:4px 0">${details.monthlyPremium}</td></tr>
    <tr><td style="color:#6b7280;padding:4px 0">보장 한도</td><td style="padding:4px 0">${details.coverageLimit}</td></tr>
    <tr><td style="color:#6b7280;padding:4px 0">만기일</td><td style="padding:4px 0">${details.maturityDate}</td></tr>` : "";

  const html = wrapHtml("보험증권이 발급되었습니다", `
    <p>${patientName} 고객님, 블록체인 치아보험 증권이 정상적으로 발급되었습니다.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      <tr><td style="color:#6b7280;padding:4px 0">증권 번호</td><td style="padding:4px 0">#${policyId} (${currency})</td></tr>
      ${detailRows}
    </table>
    <p>${filePath ? "증권 서류(PDF)를 이 메일에 첨부해 드렸습니다." : "증권 서류가 아직 준비 중이라 첨부하지 못했습니다 — 아래 링크로 잠시 후 다시 확인해 주세요."}</p>
    <p><a href="${certUrl}" style="color:#1d4ed8">증권 서류 다운로드 링크 →</a></p>
  `);

  return sendMail({ to: email, subject: `[블록체인치아보험] 증권 #${policyId} 발급 완료`, html, attachments });
}

const CLAIM_LABELS = {
  claim_approved: { title: "보험금 청구가 승인되었습니다", verb: "승인" },
  claim_rejected: { title: "보험금 청구가 거절되었습니다", verb: "거절" },
  claim_paid:     { title: "보험금이 지급되었습니다",       verb: "지급" },
};

async function handleClaimUpdate(payload) {
  const { type, email, claimId, policyId, patientName, currency, amountFormatted, treatmentCode, reason } = payload;
  const label = CLAIM_LABELS[type];

  const html = wrapHtml(label.title, `
    <p>${patientName ? `${patientName} 고객님, ` : ""}청구하신 보험금이 <strong>${label.verb}</strong>되었습니다.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      <tr><td style="color:#6b7280;padding:4px 0">청구 번호</td><td style="padding:4px 0">#${claimId} (증권 #${policyId}, ${currency})</td></tr>
      <tr><td style="color:#6b7280;padding:4px 0">치료 코드</td><td style="padding:4px 0">${treatmentCode || "-"}</td></tr>
      <tr><td style="color:#6b7280;padding:4px 0">${label.verb} 금액</td><td style="padding:4px 0">${amountFormatted || "-"}</td></tr>
      ${reason ? `<tr><td style="color:#6b7280;padding:4px 0">거절 사유</td><td style="padding:4px 0">${reason}</td></tr>` : ""}
    </table>
    <p>자세한 내역은 블록체인 치아보험 앱의 "보험금 청구" 탭에서 확인하실 수 있습니다.</p>
  `);

  return sendMail({ to: email, subject: `[블록체인치아보험] 청구 #${claimId} ${label.verb} 안내`, html });
}

const ALTINVEST_LABELS = {
  altinvest_early_exit: { title: "대체투자 조기 해지가 완료되었습니다" },
};

async function handleAltInvestUpdate(payload) {
  const { type, email, fundName, currency, amountFormatted, penaltyFormatted, payoutFormatted } = payload;
  const label = ALTINVEST_LABELS[type] || { title: "대체투자 처리 결과 안내" };

  const html = wrapHtml(label.title, `
    <p>대체투자 펀드 <strong>${fundName || "-"}</strong> (${currency}) 포지션을 조기 해지하셨습니다.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      <tr><td style="color:#6b7280;padding:4px 0">해지 금액(원금+이자)</td><td style="padding:4px 0">${amountFormatted || "-"}</td></tr>
      <tr><td style="color:#6b7280;padding:4px 0">조기해지 페널티</td><td style="padding:4px 0">${penaltyFormatted || "-"}</td></tr>
      <tr><td style="color:#6b7280;padding:4px 0">실수령액</td><td style="padding:4px 0">${payoutFormatted || "-"}</td></tr>
    </table>
    <p>자세한 내역은 블록체인 앱의 "🪙 대체투자" 탭에서 확인하실 수 있습니다.</p>
  `);

  return sendMail({ to: email, subject: `[블록체인] ${fundName || "대체투자"} 조기해지 안내`, html });
}

// ── HTTP 서버 (프론트엔드가 보내는 웹훅 수신) ────────────────────
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy(); // 과도하게 큰 요청 방지
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// 프론트엔드(http://localhost:3000)가 이 서비스(http://localhost:5679)를 fetch로
// 호출하는 건 포트가 달라 브라우저 기준 cross-origin 요청이다. CORS 헤더 없이는
// (특히 JSON POST라 브라우저가 먼저 보내는 OPTIONS preflight가 막혀) 브라우저에서
// 호출 시 "Failed to fetch"로 조용히 실패한다 — 서버 로그엔 아무것도 안 남아 원인
// 파악이 어려움 (2026-09-18 발견: 실제 브라우저로 청약 테스트했는데 메일이 전혀
// 발송되지 않음). curl/Node 스크립트로 직접 호출한 테스트는 브라우저가 아니라
// CORS 제한을 받지 않아 이 문제를 놓쳤었다 — 웹훅을 브라우저 fetch로 호출하는
// 서비스를 새로 만들 땐 반드시 실제 브라우저로도 확인할 것.
function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/notify") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
    return;
  }

  if (!payload.email || !payload.type) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "email과 type은 필수입니다" }));
    return;
  }

  // 첨부 파일 대기(policy_issued)는 수 초~수십 초 걸릴 수 있어, 웹훅 호출자(프론트엔드)를
  // 붙잡아두지 않고 즉시 202로 응답한 뒤 백그라운드에서 실제 발송을 진행한다.
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, accepted: true }));

  const key = notifyKey(payload);
  if (sentNotifications.has(key)) {
    log(`⏭️  중복 알림 스킵 (이미 발송됨) → key: ${key}`);
    return;
  }
  sentNotifications.add(key); // 비동기 발송 시작 전에 먼저 등록 — 거의 동시에 도착하는 다른 탭의 요청과 경합 방지

  try {
    let result;
    if (payload.type === "policy_issued") {
      result = await handlePolicyIssued(payload);
    } else if (payload.type.startsWith("altinvest_")) {
      result = await handleAltInvestUpdate(payload);
    } else {
      result = await handleClaimUpdate(payload);
    }

    if (result.sent) {
      log(`📧 발송 완료 → ${payload.email} (type: ${payload.type})`);
    } else {
      sentNotifications.delete(key); // 발송 실패는 "이미 처리됨"이 아니므로 재시도 가능하게 풀어줌
      warn(`발송 실패 → ${payload.email} (type: ${payload.type}): ${result.reason} ${result.detail || ""}`);
    }
  } catch (e) {
    sentNotifications.delete(key);
    warn(`처리 중 오류 (type: ${payload.type}): ${e.message}`);
  }
});

server.listen(PORT, () => {
  log(`✅ 이메일 발송 서비스 대기 중 — http://localhost:${PORT}/notify`);
  log(`   SMTP 대상: Mailpit(기본) — 발송된 메일은 http://localhost:8025 에서 확인`);
});
