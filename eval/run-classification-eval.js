import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { classifyTicket } from "../src/services/classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Free-tier Gemini is roughly 15 requests/minute -- pace calls well under
// that so a full eval run never gets rate-limited mid-way through.
const DELAY_MS = 4500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toConversation(testCase) {
  if (testCase.conversation) return testCase.conversation;
  if (testCase.message) return [{ direction: "inbound", body: testCase.message }];
  throw new Error(`Test case ${testCase.id} has neither "conversation" nor "message"`);
}

async function main() {
  const datasetPath = join(__dirname, "classification-eval-set.json");
  const cases = JSON.parse(readFileSync(datasetPath, "utf8"));

  let pass = 0;
  let fail = 0;
  let errored = 0;
  const failures = [];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    const conversation = toConversation(testCase);

    const result = await classifyTicket(conversation);

    if (!result) {
      errored++;
      failures.push({ id: testCase.id, reason: "classifyTicket returned null (see error logged above)" });
      console.log(`[${testCase.id}] ERROR — classification failed`);
    } else {
      const categoryOk = result.category === testCase.expectedCategory;
      const priorityOk = result.priority === testCase.expectedPriority;
      if (categoryOk && priorityOk) {
        pass++;
        console.log(`[${testCase.id}] PASS — ${result.category}/${result.priority}`);
      } else {
        fail++;
        failures.push({
          id: testCase.id,
          expected: `${testCase.expectedCategory}/${testCase.expectedPriority}`,
          got: `${result.category}/${result.priority}`,
          notes: testCase.notes,
        });
        console.log(
          `[${testCase.id}] FAIL — expected ${testCase.expectedCategory}/${testCase.expectedPriority}, got ${result.category}/${result.priority}`
        );
      }
    }

    if (i < cases.length - 1) await sleep(DELAY_MS);
  }

  console.log("\n--- Summary ---");
  console.log(`${pass} passed, ${fail} failed, ${errored} errored, ${cases.length} total`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  [${f.id}] ${f.reason || `expected ${f.expected}, got ${f.got}`}${f.notes ? ` -- ${f.notes}` : ""}`);
    }
  }

  process.exit(fail > 0 || errored > 0 ? 1 : 0);
}

main();
