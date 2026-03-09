import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { createReadStream } from "node:fs";
import { request } from "undici";

interface ReferralStatus {
  url: string;
  status: "active" | "redeemed" | "unknown";
  lastChecked: string;
}

const REFERRAL_REGEX = /https?:\/\/cursor\.com\/referral\?code=([A-Z0-9]+)/i;
const API_ENDPOINT = "https://cursor.com/api/dashboard/check-referral-code";
const DELAY_MS = parseInt(process.env.CHECK_DELAY_MS ?? "500", 10);

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

async function main() {
  const path = process.argv[2] ?? "ep02.md";
  const backupPath = `${path}.bak`;

  const original = await readFile(path, "utf8");
  await writeFile(backupPath, original, "utf8");

  let urls = await readReferralLinks(path);
  urls = [...new Set(urls)];
  const statuses: ReferralStatus[] = [];

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

    console.log(`[${i + 1}/${urls.length}] Checking ${code}...`);
    const status = await checkReferral(code);
    statuses.push({ url, status, lastChecked: timestamp });

    // Delay between different codes to avoid rate limiting
    if (i < urls.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  const table = buildTable(statuses);
  await writeFile(path, `${table}\n`, "utf8");
  console.log(`All results saved to: ${path}`);

  const activeLinks = statuses.filter((s) => s.status === "active");
  if (activeLinks.length > 0) {
    const dateStr = new Date().toISOString().split("T")[0];
    const activeFilename = `active-links-${dateStr}.md`;
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

