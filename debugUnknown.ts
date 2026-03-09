import { request } from "undici";

const API_ENDPOINT = "https://cursor.com/api/dashboard/check-referral-code";
const UNKNOWN_CODES = [
  "ACNJSH5X8BMG",
  "KZNF9LOYPE2",
  "WVIOWKTLAGS",
  "ABVVJ4COYVUF",
  "0MIIXP4CWDA0",
];

async function debugCode(code: string) {
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
    origin: "https://cursor.com",
    referer: `https://cursor.com/referral?code=${code}`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  };

  const { body, statusCode } = await request(API_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ referralCode: code }),
  });

  const text = await body.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { code, statusCode, raw: text, parsed };
}

async function main() {
  console.log("Debugging unknown codes - raw API responses:\n");
  for (const code of UNKNOWN_CODES) {
    const result = await debugCode(code);
    console.log("---", result.code, "---");
    console.log("HTTP Status:", result.statusCode);
    console.log("Response:", JSON.stringify(result.parsed, null, 2));
    console.log("");
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch(console.error);
