import { classifyTicket } from "../src/services/classifier.js";

export default class ThreadlineClassifierProvider {
  id() {
    return "threadline-classifier";
  }

  async callApi(prompt, context) {
    const conversation = context.vars.conversation;
    const result = await classifyTicket(conversation);

    if (!result) {
      return { error: "classifyTicket returned null (see logged error above)" };
    }

    return { output: JSON.stringify(result) };
  }
}
