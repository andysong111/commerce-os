import { readFileSync, writeFileSync } from "node:fs";

const path = "public/product-launch-tracker-app/detail-page-dock.js";
const source = readFileSync(path, "utf8");
const before = `  const shouldStart = window.confirm(
    "승준컴 로컬 수집기가 꺼져 있거나 Chrome 연결 권한이 아직 허용되지 않았습니다.

확인을 누르면 수집기를 자동 실행하고 약 12초 동안 다시 연결합니다.",
  );`;
const after = `  const shouldStart = window.confirm(
    "승준컴 로컬 수집기가 꺼져 있거나 Chrome 연결 권한이 아직 허용되지 않았습니다.\\n\\n확인을 누르면 수집기를 자동 실행하고 약 12초 동안 다시 연결합니다.",
  );`;
if (!source.includes(before)) throw new Error("local collector confirmation copy target not found");
writeFileSync(path, source.replace(before, after));
