import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskZeno } from "../AskZeno";
import { ASK_PAGES } from "../../../../server/agent/ask-pages";
import { LearnZeno } from "../LearnZeno";

/**
 * Zeno on the learning page: the buttons exist only where the agent does, a button asks its own
 * fixed question in one press — exactly one request, carrying that text and nothing else — and a
 * press while an answer is still streaming sends nothing over it.
 */

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const encoder = new TextEncoder();

/** A fetch stub whose response stream stays open until the test closes it. */
function heldStream() {
  let push: (chunk: string) => void = () => {};
  let close: () => void = () => {};
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            push = (chunk) => controller.enqueue(encoder.encode(chunk));
            close = () => controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ),
  );
  return { fetchSpy, push: (chunk: string) => push(chunk), close: () => close() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LearnZeno", () => {
  it("renders no launcher and no ask buttons where the agent is switched off", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <LearnZeno enabled={false}>
        <AskZeno question="What does shielding do?" />
      </LearnZeno>,
    );
    expect(screen.queryByRole("button", { name: /ask zeno/i })).toBeNull();
    expect(screen.queryByText("What does shielding do?")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks a button's question in one press, and the answer lands in the drawer", async () => {
    const stream = heldStream();
    render(
      <LearnZeno enabled>
        <AskZeno question="What does shielding do?" />
      </LearnZeno>,
    );
    const drawer = screen.getByRole("dialog", { hidden: true });
    expect(drawer.hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Ask Zeno: What does shielding do?" }));

    expect(drawer.hidden).toBe(false);
    // The standing warning sits in the drawer, above the composer it is about.
    expect(screen.getByText("never paste a viewing key or seed phrase")).toBeTruthy();
    await vi.waitFor(() => expect(stream.fetchSpy).toHaveBeenCalledTimes(1));
    const body = String(stream.fetchSpy.mock.calls[0]?.[1]?.body);
    // The button's own question, and the page it was asked from — nothing else.
    expect(JSON.parse(body)).toEqual({
      messages: [{ role: "user", content: "What does shielding do?" }],
      page: "learn",
    });
    // A page the server would refuse is a 400 on every question, so the two lists must agree.
    expect(ASK_PAGES).toContain(JSON.parse(body).page);

    stream.push(sse("delta", { text: "It moves ZEC into a pool where amounts are encrypted." }));
    stream.push(sse("done", { stopReason: "complete" }));
    stream.close();
    expect(
      await screen.findByText("It moves ZEC into a pool where amounts are encrypted."),
    ).toBeTruthy();
    // The transcript shows the question exactly as it was sent.
    expect(
      screen.getByText("What does shielding do?", { selector: "article p *, article p" }),
    ).toBeTruthy();
    // Asked, not typed: the composer is left empty for the reader's own follow-up.
    expect(screen.getByRole("textbox")).toHaveProperty("value", "");
  });

  it("sends nothing over an answer that is still streaming", async () => {
    const stream = heldStream();
    render(
      <LearnZeno enabled>
        <AskZeno question="What does shielding do?" />
        <AskZeno question="What is a viewing key?" />
      </LearnZeno>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Zeno: What does shielding do?" }));
    await vi.waitFor(() => expect(stream.fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Ask Zeno: What is a viewing key?" }));
    expect(stream.fetchSpy).toHaveBeenCalledTimes(1);
    // Nor does it overwrite the composer behind the running answer.
    expect(screen.getByRole("textbox")).toHaveProperty("value", "");
    stream.close();
  });

  it("opens from the launcher without sending, and closes from its own button and Escape", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <LearnZeno enabled>
        <AskZeno question="What does shielding do?" />
      </LearnZeno>,
    );
    const drawer = screen.getByRole("dialog", { hidden: true });
    fireEvent.click(screen.getByRole("button", { name: "ask zeno" }));
    expect(drawer.hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close Zeno" }));
    expect(drawer.hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "ask zeno" }));
    expect(drawer.hidden).toBe(false);
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(drawer.hidden).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
