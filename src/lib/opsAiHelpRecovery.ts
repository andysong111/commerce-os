import {
  answerOpsAiHelpQuestion,
  buildOpsAiKnowledgeSections,
  parseOpsAiHelpInput,
  type OpsAiHelpResult,
} from "@/lib/opsAiHelp";
import { isExplicitOpsAiHelpActionIntent } from "@/lib/opsAiHelpIntent";
import {
  isOpsHelpActionRequest,
  selectOpsAiKnowledge,
  type OpsAiKnowledgeSection,
} from "@/lib/opsAiKnowledge";

type OpsAiAnswerer = typeof answerOpsAiHelpQuestion;

function outOfScopeResult(): OpsAiHelpResult {
  return {
    status: "out_of_scope",
    answer:
      "이 상담원은 현재 Commerce OS 기능의 사용법과 오류 확인만 안내합니다. 신규 개발, 기능 추가, 코드 수정, 배포 또는 실제 데이터 변경은 처리하지 않습니다.",
    steps: [],
    warnings: ["개발 작업은 관리자용 개발 대화에서 별도로 요청하세요."],
    sources: [],
    cached: true,
  };
}

function sourceResult(section: OpsAiKnowledgeSection) {
  return {
    id: section.id,
    title: section.title,
    route: section.route,
    version: section.version,
  };
}

function compactSentences(value: string, maxLength = 520) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [normalized];
  return sentences.slice(0, 2).join(" ").trim().slice(0, maxLength);
}

function locationAnswer(section: OpsAiKnowledgeSection) {
  if (section.route?.startsWith("http")) {
    return `운영 대시보드에서 ‘${section.title}’ 카드를 눌러 연결된 운영 화면을 열면 됩니다.`;
  }
  if (section.route) {
    return `왼쪽 메뉴 또는 운영 대시보드 검색에서 ‘${section.title}’을 열면 됩니다.`;
  }
  return `운영 대시보드에서 ‘${section.title}’ 관련 기능을 검색해 여세요.`;
}

export function buildOpsAiHelpRecoveryResult(inputValue: unknown): OpsAiHelpResult {
  const input = parseOpsAiHelpInput(inputValue);
  const selected = selectOpsAiKnowledge(
    input.question,
    input.page,
    buildOpsAiKnowledgeSections(),
    5,
  );

  if (!selected.length) {
    return {
      status: "insufficient_evidence",
      answer:
        "현재 질문과 연결되는 운영 근거를 찾지 못했습니다. 보고 있는 화면명, 오류 문구 또는 눌렀던 버튼명을 알려주세요.",
      steps: [],
      warnings: ["근거가 없는 동작은 추측하지 않습니다."],
      sources: [],
      cached: false,
    };
  }

  const asksLocation = /어디서|어디에|어디\s*있|위치|이용|열어|접속/i.test(
    input.question,
  );
  const primary = asksLocation
    ? selected.find((section) => Boolean(section.route)) ?? selected[0]
    : selected[0];
  const answer = asksLocation
    ? locationAnswer(primary)
    : compactSentences(primary.content) ||
      "선택한 기능의 화면 설명과 상태 배지를 먼저 확인하세요.";

  const steps: string[] = [];
  if (primary.route) {
    steps.push(
      primary.route.startsWith("http")
        ? `운영 대시보드에서 ‘${primary.title}’ 카드를 누릅니다.`
        : `왼쪽 메뉴나 검색에서 ‘${primary.title}’을 엽니다.`,
    );
  }
  steps.push("화면 상단 설명과 상태·안전 배지를 확인한 뒤 입력을 진행합니다.");

  return {
    status: "answered",
    answer,
    steps: steps.slice(0, 3),
    warnings: [
      "실제 주문·가격·재고가 바뀌는지는 해당 화면의 안전 표시를 기준으로 확인하세요.",
    ],
    sources: selected.slice(0, 3).map(sourceResult),
    cached: false,
  };
}

function isRecoverableAnswerFormatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /답변 형식|답변이 비어|Unexpected end of JSON|JSON.*parse/i.test(message);
}

export async function answerOpsAiHelpWithRecovery(
  inputValue: unknown,
  options: {
    answerer?: OpsAiAnswerer;
    model?: string;
  } = {},
): Promise<OpsAiHelpResult> {
  const input = parseOpsAiHelpInput(inputValue);
  if (
    isOpsHelpActionRequest(input.question) ||
    isExplicitOpsAiHelpActionIntent(input.question)
  ) {
    return outOfScopeResult();
  }

  const answerer = options.answerer ?? answerOpsAiHelpQuestion;
  const model =
    options.model?.trim() ||
    process.env.OPS_AI_HELP_MODEL?.trim() ||
    "gpt-5-mini";

  try {
    return await answerer(input, { model });
  } catch (error) {
    if (!isRecoverableAnswerFormatError(error)) throw error;
    return buildOpsAiHelpRecoveryResult(input);
  }
}
