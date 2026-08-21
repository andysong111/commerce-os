const REQUIRED_KEYS = [
  "KEYWORD_ENGINE_OPENAI_API_KEY",
  "SHOPLING_CATEGORY_OPENAI_API_KEY",
  "PRODUCT_TITLE_OPENAI_API_KEY",
  "OPS_AI_HELP_OPENAI_API_KEY",
];

if (process.env.VERCEL_ENV !== "production") {
  console.log("OpenAI production key verification skipped outside Vercel Production.");
  process.exit(0);
}

const missing = REQUIRED_KEYS.filter((name) => !String(process.env[name] ?? "").trim());
if (missing.length) {
  console.error(`OpenAI production key verification failed: missing ${missing.join(", ")}`);
  process.exit(1);
}

for (const name of REQUIRED_KEYS) {
  const key = String(process.env[name] ?? "").trim();
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const code = error instanceof Error ? error.name : "NETWORK_ERROR";
    console.error(`OpenAI production key verification failed for ${name}: ${code}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`OpenAI production key verification failed for ${name}: HTTP ${response.status}`);
    process.exit(1);
  }
  console.log(`OpenAI production key verified: ${name}`);
}

console.log("All dedicated OpenAI production keys verified.");
