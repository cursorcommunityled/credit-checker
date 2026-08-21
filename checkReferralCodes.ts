import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { createReadStream } from "node:fs";
import { request } from "undici";
import { cwd } from "node:process";
import { isAbsolute, relative, resolve } from "node:path";

interface ReferralStatus {
  url: string;
  status: "active" | "redeemed" | "unknown";
  lastChecked: string;
}

const REFERRAL_REGEX = /https?:\/\/cursor\.com\/referral\?code=([A-Z0-9]+)/i;
const API_ENDPOINT = "https://cursor.com/api/dashboard/check-referral-code";
const DELAY_MS = Math.min(Math.max(parseInt(process.env.CHECK_DELAY_MS ?? "500", 10) || 500, 250), 10_000);
const DEFAULT_INPUT_PATH = "links.md";

function resolveWithinCwd(input: string): string {
  const root = cwd();
  const resolved = resolve(root, input);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path must stay inside the working directory");
  }
  return resolved;
}

async function readReferralLinks(path: string): Promise<string[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const urls: string[] = [];
  for await (const line of rl) {
    const match = line.match(REFERRAL_REGEX);
    if (match) {
      urls.push(match[0]);
    }
  }

  return urls;
}

async function checkReferral(code: string, retries = 3): Promise<"active" | "redeemed" | "unknown"> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS * attempt));
      }

      const headers: Record<string, string> = {
        "accept": "*/*",
        "content-type": "application/json",
        "origin": "https://cursor.com",
        "referer": `https://cursor.com/referral?code=${code}`,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" +
          " AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      };

      const { body, statusCode } = await request(API_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ referralCode: code }),
      });

      if (statusCode === 200) {
        const json = await body.json();

        // Active link returns: { isValid: true, userIsEligible: true, metadata: {...} }
        if (json && typeof json === "object" && "isValid" in json) {
          const { isValid, userIsEligible } = json as { isValid: boolean; userIsEligible: boolean };
          if (isValid && userIsEligible) {
            return "active";
          }
          return "redeemed";
        }

        // Empty object {} means already redeemed
        if (json && typeof json === "object" && Object.keys(json).length === 0) {
          return "redeemed";
        }

        // metadata.title "already been used" or "expired" = redeemed (Cursor frontend logic)
        const meta = (json as { metadata?: { title?: string } })?.metadata;
        const title = meta?.title?.toLowerCase() ?? "";
        if (title.includes("already been used") || title.includes("expired")) {
          return "redeemed";
        }

        return "unknown";
      }

      // HTTP 500 likely means auth required or rate limiting, not "redeemed"
      if (statusCode === 500) {
        const text = await body.text();
        console.warn(`HTTP 500 for ${code} (attempt ${attempt + 1}/${retries}): ${text}`);
        if (attempt < retries - 1) continue;
        return "unknown";
      }

      const text = await body.text();
      console.warn(`Unexpected response for ${code}: HTTP ${statusCode} -> ${text}`);
      return "unknown";
    } catch (error) {
      console.error(`Error checking code ${code} (attempt ${attempt + 1}/${retries}):`, error);
      if (attempt < retries - 1) continue;
      return "unknown";
    }
  }
  return "unknown";
}

function extractCode(url: string): string | null {
  const match = url.match(REFERRAL_REGEX);
  return match?.[1] ?? null;
}

function buildTable(statuses: ReferralStatus[]): string {
  const lines = ["| URL | Status | Last Checked |", "| --- | --- | --- |"];
  for (const item of statuses) {
    lines.push(`| ${item.url} | ${item.status} | ${item.lastChecked} |`);
  }
  return lines.join("\n");
}

function buildActiveLinksMarkdown(
  activeLinks: ReferralStatus[],
  totalCount: number
): string {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const totalValue = activeLinks.length * 20;
  const successRate = Math.round((activeLinks.length / totalCount) * 100);

  const lines = [
    "# Active Cursor Referral Links",
    "",
    `**Last Checked:** ${dateStr}`,
    `**Total Active:** ${activeLinks.length} of ${totalCount} checked`,
    `**Total Credits Available:** $${totalValue.toFixed(2)}`,
    `**Success Rate:** ${successRate}%`,
    "",
    "---",
    "",
    "## Available Links",
    "",
  ];

  activeLinks.forEach((link) => {
    lines.push(link.url);
  });

  lines.push("");

  return lines.join("\n");
}

function summarize(statuses: ReferralStatus[]): string {
  const redeemed = statuses.filter((s) => s.status === "redeemed").length;
  const active = statuses.filter((s) => s.status === "active");
  const unknown = statuses.filter((s) => s.status === "unknown").length;

  const summaryLines = [
    "",
    "=".repeat(60),
    "SUMMARY",
    "=".repeat(60),
    `Checked ${statuses.length} referral links.`,
    `${active.length} active | ${redeemed} redeemed | ${unknown} unknown`,
    "",
  ];

  if (active.length > 0) {
    summaryLines.push("Active links saved to active-links-{date}.md");
    summaryLines.push("");
  } else {
    summaryLines.push("No active links found - all have been redeemed.");
    summaryLines.push("");
  }

  return summaryLines.join("\n");
}

function printUsage() {
  console.log("Cursor Referral Link Checker");
  console.log("============================");
  console.log("");
  console.log("Checks referral links directly via Cursor's API.");
  console.log("");
  console.log("Usage:");
  console.log("  npm run check");
  console.log("  npm run check -- my-referrals.md");
  console.log("");
  console.log("Default input file:");
  console.log(`  ${DEFAULT_INPUT_PATH}`);
  console.log("");
  console.log("To get started:");
  console.log("  1. Copy links-template.md to links.md");
  console.log("  2. Add your referral URLs");
  console.log("  3. Run: npm run check");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  let inputPath: string;
  try {
    inputPath = resolveWithinCwd(process.argv[2] ?? DEFAULT_INPUT_PATH);
  } catch {
    console.error("Error: input path must be inside the current working directory.");
    process.exitCode = 1;
    return;
  }
  const backupPath = `${inputPath}.bak`;

  console.log("Cursor Referral Link Checker");
  console.log("============================");
  console.log("");
  console.log("Using the direct API checker. No browser needed.");
  console.log("");

  let original: string;
  try {
    original = await readFile(inputPath, "utf8");
  } catch {
    console.error(`Error: Could not read file '${inputPath}'`);
    console.error("Make sure the file exists and contains referral URLs.");
    console.error("");
    printUsage();
    process.exitCode = 1;
    return;
  }

  await writeFile(backupPath, original, "utf8");
  console.log(`Backup created: ${backupPath}`);

  let urls = await readReferralLinks(inputPath);
  urls = [...new Set(urls)];
  const statuses: ReferralStatus[] = [];

  console.log(`Found ${urls.length} referral links`);

  if (urls.length === 0) {
    console.error("Error: No referral links found in file.");
    console.error("Add Cursor referral URLs in this format:");
    console.error("  https://cursor.com/referral?code=YOUR_CODE");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`Checking ${urls.length} referral codes (deduplicated)...`);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const code = extractCode(url);
    const timestamp = new Date().toISOString();

    if (!code) {
      console.warn(`Could not extract code from ${url}`);
      statuses.push({ url, status: "unknown", lastChecked: timestamp });
      continue;
    }

    process.stdout.write(`[${i + 1}/${urls.length}] Checking ${code}... `);
    const status = await checkReferral(code);
    console.log(status);
    statuses.push({ url, status, lastChecked: timestamp });

    // Delay between different codes to avoid rate limiting
    if (i < urls.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log("");
  const table = buildTable(statuses);
  await writeFile(inputPath, `${table}\n`, "utf8");
  console.log(`All results saved to: ${inputPath}`);

  const activeLinks = statuses.filter((s) => s.status === "active");
  if (activeLinks.length > 0) {
    const dateStr = new Date().toISOString().split("T")[0];
    const activeFilename = resolveWithinCwd(`active-links-${dateStr}.md`);
    const activeMd = buildActiveLinksMarkdown(activeLinks, statuses.length);
    await writeFile(activeFilename, activeMd, "utf8");
    console.log(`Active links saved to: ${activeFilename}`);
  }

  const summary = summarize(statuses);
  console.log(summary);
}

main().catch((error) => {
  console.error("Failed to process referral codes:", error);
  process.exitCode = 1;
});
