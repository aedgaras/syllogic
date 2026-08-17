import sharp from "sharp";

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PROFILE_IMAGE_DIMENSION = 1024;

export async function normalizeProfileImage(file: File): Promise<Buffer> {
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Profile photo must be 5 MB or smaller");
  }

  const input = Buffer.from(await file.arrayBuffer());
  if (!input.length) {
    throw new Error("Profile photo is empty");
  }

  try {
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_PROFILE_IMAGE_DIMENSION * MAX_PROFILE_IMAGE_DIMENSION * 16,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "gif"].includes(metadata.format)) {
      throw new Error("Only JPEG, PNG, WebP, and GIF profile photos are supported");
    }

    // Decode and re-encode to strip active content and untrusted metadata.
    return await image
      .rotate()
      .resize(MAX_PROFILE_IMAGE_DIMENSION, MAX_PROFILE_IMAGE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Only ")) throw error;
    throw new Error("Profile photo is not a valid supported image");
  }
}
