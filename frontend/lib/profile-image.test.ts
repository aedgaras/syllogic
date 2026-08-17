import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeProfileImage } from "./profile-image";

describe("normalizeProfileImage", () => {
  it("rejects SVG even when presented as an image", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const file = new File([svg], "avatar.png", { type: "image/png" });
    await expect(normalizeProfileImage(file)).rejects.toThrow(
      /supported image/,
    );
  });

  it("decodes and re-encodes raster images as WebP", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const output = await normalizeProfileImage(
      new File([png], "avatar.svg", { type: "image/svg+xml" }),
    );
    expect((await sharp(output).metadata()).format).toBe("webp");
  });
});
