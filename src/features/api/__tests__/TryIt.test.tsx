import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiParam } from "@/api-catalogue";
import { TryIt } from "../TryIt";

const FROM: ApiParam = {
  name: "from",
  kind: "query",
  type: "YYYY-MM-DD",
  required: true,
  description: "First UTC day.",
  example: "2026-09-01",
};

const LIMIT: ApiParam = {
  name: "limit",
  kind: "query",
  type: "1–100",
  required: false,
  description: "Rows per page.",
};

describe("TryIt", () => {
  it("previews the request with the prefilled example and leaves an empty optional out", () => {
    render(<TryIt method="GET" path="/v1/analytics/window" params={[FROM, LIMIT]} />);
    expect(screen.getByText(/\/v1\/analytics\/window\?from=2026-09-01$/)).toBeTruthy();
  });

  it("will not send while a required query parameter is empty", () => {
    render(<TryIt method="GET" path="/v1/analytics/window" params={[FROM, LIMIT]} />);
    const send = screen.getByRole("button", { name: "SEND REQUEST" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);

    fireEvent.change(screen.getByPlaceholderText("YYYY-MM-DD"), { target: { value: "  " } });
    expect(send.disabled).toBe(true);
    expect(screen.getByText("fill the required parameter first")).toBeTruthy();
  });

  it("does not hold back an empty optional parameter", () => {
    render(<TryIt method="GET" path="/v1/analytics/window" params={[FROM, LIMIT]} />);
    fireEvent.change(screen.getByPlaceholderText("1–100"), { target: { value: "" } });
    const send = screen.getByRole("button", { name: "SEND REQUEST" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });
});
