import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { classifyTicket } from "../src/services/classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Free-tier Gemini is roughly 15 requests/minute -- pace calls well under
// that so a full eval run never gets rate-limited mid-way through.
const DELAY_MS = 4500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRIORITY_ORDER = ["low", "medium", "high", "urgent"];

function toConversation(testCase) {
  if (testCase.conversation) return testCase.conversation;
  if (testCase.message) return [{ direction: "inbound", body: testCase.message }];
  throw new Error(`Test case ${testCase.id} has neither "conversation" nor "message"`);
}

async function main() {
  const datasetFile = process.argv[2] || "classification-eval-set.json";
  const datasetPath = join(__dirname, datasetFile);
  const cases = JSON.parse(readFileSync(datasetPath, "utf8"));
  console.log(`Running eval set: ${datasetFile}\n`);

  let pass = 0;
  let fail = 0;
  let errored = 0;
  let categoryCorrect = 0;
  let priorityCorrect = 0;
  let underCalled = 0; // actual priority lower than expected -- the risky direction for a support line
  let overCalled = 0; // actual priority higher than expected -- costs a little agent time, not risky
  const failures = [];

  // matrix[expected][actual] = count
  const matrix = {};
  for (const exp of PRIORITY_ORDER) {
    matrix[exp] = {};
    for (const act of PRIORITY_ORDER) matrix[exp][act] = 0;
  }

  let scored = 0; // cases where we got a result at all (excludes errored)

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    const conversation = toConversation(testCase);

    const result = await classifyTicket(conversation);

    if (!result) {
      errored++;
      failures.push({ id: testCase.id, reason: "classifyTicket returned null (see error logged above)" });
      console.log(`[${testCase.id}] ERROR — classification failed`);
    } else {
      scored++;
      const categoryOk = result.category === testCase.expectedCategory;
      const priorityOk = result.priority === testCase.expectedPriority;
      if (categoryOk) categoryCorrect++;
      if (priorityOk) priorityCorrect++;

      if (matrix[testCase.expectedPriority] && result.priority in matrix[testCase.expectedPriority]) {
        matrix[testCase.expectedPriority][result.priority]++;
      }
      if (!priorityOk) {
        const expIdx = PRIORITY_ORDER.indexOf(testCase.expectedPriority);
        const actIdx = PRIORITY_ORDER.indexOf(result.priority);
        if (expIdx >= 0 && actIdx >= 0) {
          if (actIdx < expIdx) underCalled++;
          else if (actIdx > expIdx) overCalled++;
        }
      }

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

  console.log("\n--- Category vs priority accuracy ---");
  if (scored > 0) {
    console.log(`Category accuracy: ${categoryCorrect}/${scored} (${((categoryCorrect / scored) * 100).toFixed(1)}%)`);
    console.log(`Priority accuracy: ${priorityCorrect}/${scored} (${((priorityCorrect / scored) * 100).toFixed(1)}%)`);
  } else {
    console.log("No scored cases (all errored).");
  }

  console.log("\n--- Priority confusion matrix (rows = expected, columns = got) ---");
  const colWidth = 8;
  const pad = (s) => String(s).padEnd(colWidth);
  console.log(pad("") + PRIORITY_ORDER.map(pad).join(""));
  for (const exp of PRIORITY_ORDER) {
    console.log(pad(exp) + PRIORITY_ORDER.map((act) => pad(matrix[exp][act])).join(""));
  }

  const priorityMisses = underCalled + overCalled;
  console.log("\n--- Priority error skew ---");
  if (priorityMisses === 0) {
    console.log("No priority misses.");
  } else {
    console.log(
      `Under-called (marked calmer than expected -- the risky direction): ${underCalled}/${priorityMisses} (${((underCalled / priorityMisses) * 100).toFixed(1)}%)`
    );
    console.log(
      `Over-called (marked more urgent than expected -- costs agent time, not risk): ${overCalled}/${priorityMisses} (${((overCalled / priorityMisses) * 100).toFixed(1)}%)`
    );
  }

  process.exit(fail > 0 || errored > 0 ? 1 : 0);
}

main();
