interface Completion {
  choices?: { message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
}

function message(response: string) {
  try {
    return (JSON.parse(response) as Completion).choices?.[0]?.message ?? {};
  } catch {
    return {};
  }
}

/** What the model said out loud. This is the only part the contract reads. */
export const spoken = (response: string) => {
  const content = message(response).content;
  return typeof content === "string" ? content : "";
};

/** What a thinking model reasoned before it answered. It is inside the signed reply, so it is as verifiable as the answer. */
export const thoughts = (response: string) => {
  const m = message(response);
  const reasoning = m.reasoning_content ?? m.reasoning;
  return typeof reasoning === "string" ? reasoning.trim() : "";
};
