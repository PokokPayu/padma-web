import { describe, it, expect } from "vitest";
import { APP_NAME } from "@/lib/constants";

describe("smoke", () => {
  it("konstanta aplikasi tersedia", () => {
    expect(APP_NAME).toBe("PADMA");
  });
});
