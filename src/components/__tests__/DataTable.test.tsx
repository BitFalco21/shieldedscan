import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "../DataTable";

function table(density?: "regular" | "compact") {
  return render(
    <DataTable
      caption="Blocks"
      density={density}
      columns={[
        { label: "HEIGHT" },
        { label: "SIZE", align: "right" },
        { label: "FEE", align: "right", control: <button type="button">filter</button> },
      ]}
    >
      <tr>
        <td>1</td>
        <td>2</td>
        <td>3</td>
      </tr>
    </DataTable>,
  );
}

describe("DataTable", () => {
  it("pulls a right-aligned label flush with the figures under it", () => {
    // `.microlabel` tracks the last letter too, so a right-aligned label would end ~2px short of
    // its column's edge. The last letter alone carries no tracking; the label's text is
    // unchanged. Never a negative margin: that would push a last column's label past the table.
    table();
    const size = screen.getByRole("columnheader", { name: "SIZE" });
    expect(size.textContent).toBe("SIZE");
    const last = size.querySelector("span");
    expect(last?.textContent).toBe("E");
    expect(last?.className).toBe("tracking-normal");
    expect(size.innerHTML).not.toContain("-me-");
    // A left-aligned label is untouched; a label beside a control keeps the control's layout.
    expect(screen.getByText("HEIGHT").tagName).toBe("TH");
    expect(screen.getByText("HEIGHT").children).toHaveLength(0);
    expect(screen.getByText("FEE").className).toContain("inline-flex");
  });

  it("sets row height on the table — regular by default, compact on request", () => {
    expect(table().container.querySelector("table")?.className).toBe("data-table w-full text-sm");
    // Separate classes, not a substring: "text-smdata-table-compact" contains the compact name
    // and applies neither class.
    const compact = table("compact").container.querySelector("table");
    expect(compact?.classList.contains("text-sm")).toBe(true);
    expect(compact?.classList.contains("data-table-compact")).toBe(true);
  });
});
