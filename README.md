# Cursor Referral Link Checker

Batch-check Cursor referral links from a markdown file and separate links that are still usable from ones that have already been redeemed.

This repo uses a built-in API-based checker. It does not need browser automation, Playwright, or a manual login flow.

## What It Does

The checker reads referral URLs from a markdown file, extracts the referral codes, checks each code against Cursor's referral API, and then writes the results back to disk.

For each run it will:

1. Read referral links from your input markdown file
2. Deduplicate repeated links
3. Check each code and classify it as `active`, `redeemed`, or `unknown`
4. Overwrite the input file with a results table
5. Save a backup copy of the original file as `<input>.bak`
6. Create `active-links-YYYY-MM-DD.md` with only the active links

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy `links-template.md` to `links.md`

3. Add your referral URLs

4. Run the checker:

```bash
npm run check
```

## Usage

Run against the default file `links.md`:

```bash
npm run check
```

Run against a different markdown file:

```bash
npm run check -- my-referrals.md
```

Show command help:

```bash
npm run check -- --help
```

Slow the requests down if you hit rate limits:

```bash
# Windows PowerShell
$env:CHECK_DELAY_MS="2000"
npm run check

# Mac/Linux
CHECK_DELAY_MS=2000 npm run check
```

## Input Format

The checker accepts any markdown file that contains Cursor referral URLs. The links do not need to be in a specific layout, as long as the URL appears in the file.

Example plain list:

```markdown
https://cursor.com/referral?code=CODE1
https://cursor.com/referral?code=CODE2
https://cursor.com/referral?code=CODE3
```

Example markdown table:

```markdown
| URL |
| --- |
| https://cursor.com/referral?code=CODE1 |
| https://cursor.com/referral?code=CODE2 |
```

## Terminal Output

The checker prints progress in the terminal while it runs. Each line shows the referral code being checked and the result:

```text
[12/50] Checking ABC123... active
[13/50] Checking XYZ789... redeemed
[14/50] Checking QWE456... unknown
```

## Output Files

After a run, you should expect these files:

- `links.md` or your custom input file: replaced with a markdown table of results
- `links.md.bak` or `<input>.bak`: backup of the original content before rewriting
- `active-links-YYYY-MM-DD.md`: active links only, plus a simple summary

## Status Meanings

- `active`: the referral link appears to still be valid and eligible
- `redeemed`: the referral link appears to have already been used or expired
- `unknown`: the API response could not be classified, often because of rate limiting or an unexpected response

Current classification logic is based on the API response shape:

- Active links usually return data such as `{ isValid: true, userIsEligible: true, ... }`
- Redeemed links often return `{}` or metadata indicating the link has already been used or expired

## How It Works

The main checker lives in `checkReferralCodes.ts` and uses `undici` to make direct HTTP requests to Cursor's referral endpoint:

- It scans the input file line by line
- It extracts referral codes from `cursor.com/referral?code=...` URLs
- It posts each code to Cursor's API
- It retries transient failures
- It writes both the table output and the active-links file

## Project Files

```text
credit-checker/
├── checkReferralCodes.ts       # Main checker
├── debugUnknown.ts             # Helper for inspecting hard-to-classify API responses
├── links-template.md           # Starter input file
├── README.md
├── package.json
└── tsconfig.json
```

## Notes

- The input file is rewritten in place, so the `.bak` file is important
- Duplicate referral URLs are checked only once per run
- If no active links are found, the results table is still written back to the input file
